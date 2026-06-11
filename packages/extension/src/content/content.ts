import {
  type BrowserElement,
  type BrowserActAction,
  type BrowserActResult,
  type BrowserFindResult,
  type BrowserPageModel,
  type BridgeRequest,
  type PageSnapshot
} from "@majuntao-1/browser-bridge-shared";
import { getFormStructure, fillFormSmart } from "./form-engine.js";
import { getSynonyms } from "./synonyms.js";

const ELEMENT_ATTR = "data-browser-bridge-id";
const ACTIONABLE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='option']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='textbox']",
  "[class*='select-selector']",
  "[class*='Select-selector']",
  "[class*='select-selection']",
  "[class*='Select-selection']",
  "[class*='select-trigger']",
  "[class*='Select-trigger']",
  "[onclick]",
  "[contenteditable='true']"
].join(",");

const FLOATING_OPTION_SELECTOR = [
  "[role='option']",
  "[role='menuitem']",
  "[role='treeitem']",
  ".ant-select-item-option",
  ".arco-select-option",
  ".el-select-dropdown__item",
  "[class*='dropdown'] [class*='item']",
  "[class*='Dropdown'] [class*='item']",
  "[class*='popup'] [class*='item']",
  "[class*='Popup'] [class*='item']",
  "[class*='option']",
  "[class*='Option']"
].join(",");

const HIGH_RISK_TEXT_PATTERNS = [
  /delete/i,
  /remove/i,
  /destroy/i,
  /drop/i,
  /pay/i,
  /purchase/i,
  /submit/i,
  /send/i,
  /publish/i,
  /approve/i,
  /reject/i,
  /删除/,
  /移除/,
  /支付/,
  /购买/,
  /提交/,
  /发送/,
  /发布/,
  /审批/,
  /通过/,
  /拒绝/
];

let activeOperations = 0;
const recentLogs: Array<{ type: string; message: string }> = [];
let isRecording = false;
let lastRecordedUrl = location.href;
let inputRecordTimer: number | undefined;
let scrollRecordTimer: number | undefined;
let lastScrollX = window.scrollX;
let lastScrollY = window.scrollY;
let recordingListenersAttached = false;
let urlPollTimer: number | undefined;

// Recording 事件处理器（定义为命名函数，便于动态挂载/卸载）
function handleRecordClick(event: Event) {
  const target = event.target as HTMLElement;
  if (!target) return;
  const input = target.closest("input[type='checkbox'], input[type='radio']") as HTMLInputElement | null;
  recordStep({
    action: input ? (input.checked ? "check" : "uncheck") : "click",
    ...getRecordedTarget(target)
  });
}

function handleRecordChange(event: Event) {
  const target = event.target as HTMLElement;
  if (!target) return;
  const action = target instanceof HTMLSelectElement ? "select" : "type";
  recordStep({
    action,
    ...getRecordedTarget(target),
    value: shouldMaskValue(target) ? undefined : getElementValue(target),
    masked: shouldMaskValue(target) || undefined
  });
}

function handleRecordInput(event: Event) {
  const target = event.target as HTMLElement;
  if (!target || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) return;
  if (target instanceof HTMLInputElement && ["checkbox", "radio", "file"].includes(target.type)) return;
  if (inputRecordTimer) window.clearTimeout(inputRecordTimer);
  inputRecordTimer = window.setTimeout(() => {
    recordStep({
      action: "type",
      ...getRecordedTarget(target),
      value: shouldMaskValue(target) ? undefined : getElementValue(target),
      masked: shouldMaskValue(target) || undefined
    });
  }, 450);
}

function handleRecordKeydown(event: KeyboardEvent) {
  if (!["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  recordStep({
    action: "pressKey",
    key: event.key,
    ...getRecordedTarget(event.target as HTMLElement)
  });
}

function handleRecordSubmit(event: Event) {
  recordStep({
    action: "submit",
    ...getRecordedTarget(event.target as HTMLElement)
  });
}

function handleRecordScroll() {
  if (scrollRecordTimer) window.clearTimeout(scrollRecordTimer);
  scrollRecordTimer = window.setTimeout(() => {
    const dx = window.scrollX - lastScrollX;
    const dy = window.scrollY - lastScrollY;
    lastScrollX = window.scrollX;
    lastScrollY = window.scrollY;
    if (Math.abs(dx) < 80 && Math.abs(dy) < 80) return;
    recordStep({
      action: "scroll",
      direction: Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? "down" : "up") : (dx > 0 ? "right" : "left"),
      amount: Math.round(Math.max(Math.abs(dx), Math.abs(dy)))
    });
  }, 300);
}

function pollUrlChange() {
  if (location.href === lastRecordedUrl) return;
  lastRecordedUrl = location.href;
  recordStep({
    action: "waitFor",
    text: document.title || undefined
  });
}

/**
 * 动态挂载/卸载 Recording 事件监听器
 *
 * 只在录制状态时挂载监听器，避免非录制状态下的无用事件处理开销。
 */
function setRecordingListeners(recording: boolean): void {
  if (recording && !recordingListenersAttached) {
    document.addEventListener("click", handleRecordClick, { capture: true });
    document.addEventListener("change", handleRecordChange, { capture: true });
    document.addEventListener("input", handleRecordInput, { capture: true });
    document.addEventListener("keydown", handleRecordKeydown, { capture: true });
    document.addEventListener("submit", handleRecordSubmit, { capture: true });
    window.addEventListener("scroll", handleRecordScroll, { capture: true });
    urlPollTimer = window.setInterval(pollUrlChange, 500);
    recordingListenersAttached = true;
  } else if (!recording && recordingListenersAttached) {
    document.removeEventListener("click", handleRecordClick, { capture: true });
    document.removeEventListener("change", handleRecordChange, { capture: true });
    document.removeEventListener("input", handleRecordInput, { capture: true });
    document.removeEventListener("keydown", handleRecordKeydown, { capture: true });
    document.removeEventListener("submit", handleRecordSubmit, { capture: true });
    window.removeEventListener("scroll", handleRecordScroll, { capture: true });
    if (urlPollTimer !== undefined) {
      window.clearInterval(urlPollTimer);
      urlPollTimer = undefined;
    }
    if (inputRecordTimer !== undefined) {
      window.clearTimeout(inputRecordTimer);
      inputRecordTimer = undefined;
    }
    if (scrollRecordTimer !== undefined) {
      window.clearTimeout(scrollRecordTimer);
      scrollRecordTimer = undefined;
    }
    recordingListenersAttached = false;
  }
}

function recordStep(step: Record<string, unknown>): void {
  chrome.runtime.sendMessage({
    type: "browser_bridge_record_step",
    step: {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      url: location.href,
      title: document.title,
      ...step
    }
  });
}

function getRecordedTarget(target: HTMLElement | null): Record<string, unknown> {
  if (!target) return {};
  const element = target.closest(ACTIONABLE_SELECTOR) as HTMLElement | null ?? target;
  const rect = element.getBoundingClientRect();
  const text = getElementText(element);
  const label = getAssociatedLabel(element);
  const ariaLabel = element.getAttribute("aria-label") || undefined;
  const placeholder = getPlaceholder(element) || undefined;
  const testId = element.getAttribute("data-testid")
    || element.getAttribute("data-test")
    || element.getAttribute("data-cy")
    || undefined;

  return {
    text: text || label || undefined,
    role: element.getAttribute("role") || inferRole(element),
    ariaLabel,
    placeholder,
    testId,
    selector: testId ? undefined : buildSelectorHint(element),
    selectorHint: buildSelectorHint(element),
    nearText: getNearText(element),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  };
}

function getAssociatedLabel(element: HTMLElement): string {
  const id = element.id;
  if (id) {
    const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
    if (label?.textContent) return normalizeText(label.textContent);
  }
  const parentLabel = element.closest("label");
  return parentLabel?.textContent ? normalizeText(parentLabel.textContent) : "";
}

function getNearText(element: HTMLElement): string | undefined {
  const parent = element.closest("label, .form-item, .form-group, [class*='form'], [class*='field']") ?? element.parentElement;
  const text = parent?.textContent ? normalizeText(parent.textContent) : "";
  return text && text.length <= 120 ? text : undefined;
}

function shouldMaskValue(element: HTMLElement): boolean {
  const combined = `${getPlaceholder(element)} ${element.getAttribute("aria-label") ?? ""} ${getAssociatedLabel(element)}`;
  return element instanceof HTMLInputElement && element.type === "password"
    || /password|密码|token|secret|验证码|verification/i.test(combined);
}

// Capture recent console logs for diagnostics
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
console.error = (...args) => {
  recentLogs.push({ type: "error", message: args.join(" ") });
  if (recentLogs.length > 20) recentLogs.shift();
  originalConsoleError.apply(console, args);
};
console.warn = (...args) => {
  recentLogs.push({ type: "warn", message: args.join(" ") });
  if (recentLogs.length > 20) recentLogs.shift();
  originalConsoleWarn.apply(console, args);
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "browser_bridge_ping") {
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "browser_bridge_hide_status") {
    const overlay = document.getElementById("browser-bridge-agent-overlay");
    if (overlay) overlay.style.visibility = "hidden";
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "browser_bridge_show_status") {
    const overlay = document.getElementById("browser-bridge-agent-overlay");
    if (overlay) overlay.style.visibility = "visible";
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "browser_bridge_draw_overlay") {
    drawVisualOverlay();
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "browser_bridge_remove_overlay") {
    removeVisualOverlay();
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "browser_bridge_toggle_recording") {
    isRecording = Boolean(message.enabled);
    setRecordingListeners(isRecording);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "agent_session_status") {
    isStickyMask = Boolean(message.active);
    updateOverlay(isStickyMask ? "SESSION_ACTIVE" : undefined);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type !== "browser_bridge_request") {
    if (message?.type === "browser_bridge_confirm") {
      void showConfirmationOverlay(String(message.reason ?? "高风险操作"))
        .then((confirmed) => sendResponse({ confirmed }));
      return true;
    }
    return false;
  }

  const request = message.request as BridgeRequest;
  console.log(`[BrowserBridge] 收到请求: ${request.tool}`, request.params);
  
  activeOperations++;
  updateOverlay(request.tool, request.params);

  void handleRequest(request)
    .then((data) => {
      console.log(`[BrowserBridge] 请求成功: ${request.tool}`);
      sendResponse({ ok: true, data });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[BrowserBridge] 请求失败: ${request.tool}`, message);
      const [code, detail] = message.includes(": ")
        ? message.split(/: (.*)/s, 2)
        : ["INTERNAL_ERROR", message];
      
      // Enrich error with diagnostics
      const diagnostics = getDiagnostics(request);
      
      sendResponse({
        ok: false,
        error: {
          code,
          message: detail || message,
          diagnostics
        }
      });
    })
    .finally(() => {
      activeOperations--;
      updateOverlay();
    });
  return true;
});

// Initialization: Query agent session status
void chrome.runtime.sendMessage({ type: "get_agent_session_status" }).then((response) => {
  if (response?.active !== undefined) {
    isStickyMask = Boolean(response.active);
    if (isStickyMask) updateOverlay("SESSION_ACTIVE");
  }
});

function getDiagnostics(request: BridgeRequest): Record<string, unknown> {
  const diagnostics: Record<string, unknown> = {
    url: location.href,
    recentLogs: [...recentLogs]
  };

  const params = request.params ?? {};
  const elementId = String(params.elementId ?? "");
  const selector = String(params.selector ?? "");

  if (elementId) {
    const el = document.querySelector(`[${ELEMENT_ATTR}="${cssEscape(elementId)}"]`);
    if (el) {
      diagnostics.htmlSnippet = el.outerHTML.slice(0, 1000);
    }
  } else if (selector) {
    try {
      const el = document.querySelector(selector);
      if (el) {
        diagnostics.htmlSnippet = el.outerHTML.slice(0, 1000);
      }
    } catch { /* ignore */ }
  }

  return diagnostics;
}

function drawVisualOverlay(): void {
  removeVisualOverlay();
  const overlay = document.createElement("div");
  overlay.id = "browser-bridge-visual-mapping";
  overlay.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2147483646;";
  document.body.appendChild(overlay);

  const elements = getActionableElements({ visibleOnly: true, viewportOnly: true });
  elements.forEach((el, index) => {
    const rect = el.getBoundingClientRect();
    const box = document.createElement("div");
    const id = index + 1;
    
    // Assign a temporary ID attribute so Agent can reference it
    el.setAttribute("data-bb-temp-id", String(id));
    
    box.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 2px solid #ef4444;
      background: rgba(239, 68, 68, 0.1);
      box-sizing: border-box;
      pointer-events: none;
    `;
    
    const label = document.createElement("div");
    label.innerText = String(id);
    label.style.cssText = `
      position: absolute;
      top: -20px;
      left: 0;
      background: #ef4444;
      color: white;
      font-size: 12px;
      padding: 0 4px;
      border-radius: 2px;
      line-height: 18px;
      white-space: nowrap;
    `;
    
    box.appendChild(label);
    overlay.appendChild(box);
  });
}

function removeVisualOverlay(): void {
  const overlay = document.getElementById("browser-bridge-visual-mapping");
  if (overlay) overlay.remove();
  
  document.querySelectorAll("[data-bb-temp-id]").forEach(el => {
    el.removeAttribute("data-bb-temp-id");
  });
}

let lastActiveTime = 0;
const MIN_OVERLAY_TIME = 800; // ms
let isStickyMask = false;

let autoCloseTimer: any = null;
const AUTO_CLOSE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

const TOOL_NAME_MAP: Record<string, string> = {
  "BROWSER_OPEN_URL": "打开链接",
  "BROWSER_CLICK": "点击元素",
  "BROWSER_TYPE": "输入文本",
  "BROWSER_FIND": "查找元素",
  "BROWSER_GET_PAGE_TEXT": "读取文本",
  "BROWSER_GET_PAGE_MODEL": "解析页面数据",
  "BROWSER_SCREENSHOT": "屏幕截图",
  "BROWSER_EVALUATE": "执行脚本",
  "BROWSER_WAIT_FOR": "等待元素",
  "BROWSER_ACT": "执行操作",
  "BROWSER_USE": "协议激活",
  "SESSION_ACTIVE": "会话激活"
};

function updateOverlay(tool?: string, params?: Record<string, any>) {
  if (activeOperations > 0 || isStickyMask) {
    lastActiveTime = Date.now();
    showSciFiOverlay(tool, params);

    // Auto-close if agent forgets browser_use(false)
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(() => {
      if (isStickyMask) {
        console.warn("[BrowserBridge] 自动关闭超时的持久化蒙层");
        isStickyMask = false;
        hideSciFiOverlay();
      }
    }, AUTO_CLOSE_TIMEOUT);
  } else {
    const elapsed = Date.now() - lastActiveTime;
    const remaining = Math.max(0, MIN_OVERLAY_TIME - elapsed);
    setTimeout(() => {
      if (activeOperations === 0 && !isStickyMask) {
        hideSciFiOverlay();
      }
    }, remaining);
  }
}

function showSciFiOverlay(tool?: string, params?: Record<string, any>) {
  let overlay = document.getElementById("browser-bridge-agent-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "browser-bridge-agent-overlay";
    overlay.style.cssText = `
      position: fixed;
      top: 8px;
      right: 8px;
      width: 240px;
      pointer-events: none;
      z-index: 2147483647;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      transition: opacity 0.2s ease, transform 0.2s ease;
    `;

    const container = document.createElement("div");
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: #0f172a;
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(15, 23, 42, 0.1);
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.12);
      padding: 6px 10px;
      overflow: hidden;
    `;

    const statusBadge = document.createElement("div");
    statusBadge.id = "bb-status-badge";
    statusBadge.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    `;

    const dot = document.createElement("div");
    dot.style.cssText = `
      width: 8px;
      height: 8px;
      flex: 0 0 auto;
      background: #16a34a;
      border-radius: 999px;
      box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.14);
      animation: bb-agent-pulse 1.4s ease-in-out infinite;
    `;

    const statusText = document.createElement("div");
    statusText.id = "bb-status-text";
    statusText.style.cssText = `
      color: #0f172a;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;
    statusText.innerText = "Browser Bridge 正在操作";

    statusBadge.appendChild(dot);
    statusBadge.appendChild(statusText);

    const logContainer = document.createElement("div");
    logContainer.id = "bb-log-container";
    logContainer.style.cssText = `
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 10px;
      color: #475569;
      line-height: 1.4;
      max-height: 56px;
      overflow: hidden;
    `;

    if (!document.getElementById("bb-overlay-style")) {
      const style = document.createElement("style");
      style.id = "bb-overlay-style";
      style.textContent = `
        @keyframes bb-agent-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(0.72); opacity: 0.55; }
        }
      `;
      document.head.appendChild(style);
    }

    container.appendChild(statusBadge);
    container.appendChild(logContainer);
    overlay.appendChild(container);
    document.documentElement.appendChild(overlay);
  } else {
    overlay.style.display = "block";
    overlay.style.opacity = "1";
    overlay.style.transform = "translateY(0)";
  }

  if (tool) {
    const logContainer = document.getElementById("bb-log-container");
    if (logContainer) {
      const entry = document.createElement("div");
      entry.style.cssText = `
        opacity: 0;
        transform: translateY(-4px);
        transition: all 0.18s ease;
        padding-top: 5px;
        border-top: 1px solid rgba(15, 23, 42, 0.08);
      `;
      
      let paramText = "";
      if (params) {
        const entries = Object.entries(params)
          .filter(([key, val]) => val !== undefined && key !== "__confirmedHighRisk" && key !== "use")
          .map(([key, val]) => {
            const str = typeof val === "object" ? JSON.stringify(val) : String(val);
            const truncated = str.length > 30 ? str.substring(0, 27) + "..." : str;
            return `<span style="color:#64748b;font-size:10px;margin-right:6px;">${key}: ${truncated}</span>`;
          });
        if (entries.length > 0) {
          paramText = `<div style="display:flex;flex-wrap:wrap;margin-top:2px;">${entries.join("")}</div>`;
        }
      }

      entry.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="color:#2563eb;font-weight:700;font-size:11px;">${TOOL_NAME_MAP[tool.toUpperCase()] || tool.toUpperCase().replace("BROWSER_", "")}</span>
        </div>
        ${paramText}
      `;

      logContainer.appendChild(entry);
      requestAnimationFrame(() => {
        entry.style.opacity = "1";
        entry.style.transform = "translateY(0)";
      });
      if (logContainer.childNodes.length > 2) {
        logContainer.removeChild(logContainer.firstChild!);
      }
    }
    const statusText = document.getElementById("bb-status-text");
    if (statusText) {
      const translated = TOOL_NAME_MAP[tool.toUpperCase()] || tool.toUpperCase().replace("BROWSER_", "");
      statusText.innerText = `Browser Bridge：${translated}`;
    }
  }
}

function hideSciFiOverlay() {
  const overlay = document.getElementById("browser-bridge-agent-overlay");
  if (overlay) {
    overlay.style.opacity = "0";
    overlay.style.transform = "translateY(-6px)";
    setTimeout(() => {
      if (activeOperations === 0) {
        overlay.style.display = "none";
        const logContainer = document.getElementById("bb-log-container");
        if (logContainer) logContainer.innerHTML = "";
      }
    }, 300);
  }
}

async function handleRequest(request: BridgeRequest): Promise<unknown> {
  switch (request.tool) {
    case "browser_get_page_text":
      return getVisibleText();
    case "browser_get_page_snapshot":
      return getPageSnapshot();
    case "browser_get_page_model":
      return getPageModel(request.params ?? {});
    case "browser_get_interactives":
      return getInteractives(request.params ?? {});
    case "browser_find":
      return findElements(request.params ?? {});
    case "browser_act":
      return act(request.params ?? {}, request.timeoutMs);
    case "browser_assert_text":
      return assertText(request.params ?? {}, request.timeoutMs);
    case "browser_get_selected_text":
      return getSelectedText();
    case "browser_get_links":
      return getLinks();
    case "browser_click":
    case "browser_find_and_click":
      return clickElement(request.params ?? {});
    case "browser_hover":
      return hoverElement(request.params ?? {});
    case "browser_type":
    case "browser_find_and_type":
      return typeIntoElement(request.params ?? {});
    case "browser_select_option":
      return selectOption(request.params ?? {}, request.timeoutMs);
    case "browser_fill_form":
      return fillForm(request.params ?? {});
    case "browser_clear":
      return clearElement(request.params ?? {});
    case "browser_scroll":
      return scrollPage(request.params ?? {});
    case "browser_press_key":
      return pressKey(request.params ?? {});
    case "browser_wait_for":
      return waitForElement(request.params ?? {}, request.timeoutMs);
    case "browser_visual_observe":
      return visualObserve(request.params ?? {});
    case "browser_visual_click_text":
      return visualClickText(request.params ?? {}, request.timeoutMs);
    case "browser_visual_select":
      return visualSelect(request.params ?? {}, request.timeoutMs);
    case "browser_visual_task":
      return visualTask(request.params ?? {}, request.timeoutMs);
    case "browser_visual_resolve_text":
      return visualClickText(request.params ?? {}, request.timeoutMs);
    case "browser_get_form_structure":
      return getFormStructure();
    case "browser_fill_form_smart":
      return fillFormSmart(
        Array.isArray(request.params?.fields) ? request.params.fields : [],
        { dryRun: request.params?.dryRun === true }
      );
    case "browser_click_semantic_btn":
      return clickSemanticButton(request.params ?? {});
    default:
      throw new Error(`INTERNAL_ERROR: 不支持的页面工具 ${request.tool}`);
  }
}

function getSelectedText(): { text: string } {
  return { text: window.getSelection()?.toString() ?? "" };
}

function visualObserve(params: Record<string, unknown>): {
  url: string;
  title: string;
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
  targets: VisualTarget[];
} {
  const maxTargets = Math.min(numberParam(params, "maxTargets") ?? 120, 200);
  return {
    url: location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    },
    targets: getVisualTargets().slice(0, maxTargets)
  };
}

type VisualTarget = {
  text?: string;
  role: string;
  tagName: string;
  elementId: string;
  rect: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  source: "interactive" | "option" | "text";
};

function visualClickText(params: Record<string, unknown>, requestTimeoutMs?: number): {
  matched: VisualTarget;
  actions: Array<Record<string, unknown>>;
} {
  const text = stringParam(params, "text");
  if (!text) {
    throw new Error("INVALID_PARAMS: text 参数必填");
  }
  const target = findVisualTargetByText(text, {
    exact: params.exact === true,
    prefer: stringParam(params, "prefer"),
    timeoutMs: numberParam(params, "timeoutMs") ?? requestTimeoutMs
  });
  return {
    matched: target,
    actions: [{
      tool: "browser_screen_click",
      x: target.center.x,
      y: target.center.y,
      delayMs: 60,
      afterDelayMs: 200,
      reason: `点击可见文本「${text}」`
    }]
  };
}

function visualSelect(params: Record<string, unknown>, requestTimeoutMs?: number): {
  label: string;
  option: string;
  matched: VisualTarget;
  actions: Array<Record<string, unknown>>;
} {
  const label = stringParam(params, "label");
  const option = stringParam(params, "option");
  if (!label || !option) {
    throw new Error("INVALID_PARAMS: label 和 option 参数必填");
  }

  const timeoutMs = numberParam(params, "timeoutMs") ?? requestTimeoutMs ?? 5000;
  const controlTarget = findVisualSelectControlByLabel(label);
  if (!controlTarget) {
    throw new Error(`ELEMENT_NOT_FOUND: 未找到标签「${label}」附近的可视下拉控件`);
  }

  return {
    label,
    option,
    matched: controlTarget,
    actions: [
      {
        tool: "browser_screen_click",
        x: controlTarget.center.x,
        y: controlTarget.center.y,
        delayMs: 60,
        afterDelayMs: 250,
        reason: `展开「${label}」下拉`
      },
      {
        tool: "browser_screen_click",
        x: "__resolve_after_open__",
        y: "__resolve_after_open__",
        label,
        option,
        exact: params.exact !== false,
        timeoutMs,
        reason: `点击选项「${option}」`
      }
    ]
  };
}

function visualTask(params: Record<string, unknown>, requestTimeoutMs?: number): {
  instruction: string;
  actions: Array<Record<string, unknown>>;
  parsed: unknown;
} {
  const instruction = stringParam(params, "instruction");
  if (!instruction) {
    throw new Error("INVALID_PARAMS: instruction 参数必填");
  }

  const selectMatches = [...instruction.matchAll(/(?:选择|设置|选中|将|把)?\s*([^，,。；;]+?)\s*(?:为|=|选择为)\s*([^，,。；;]+?)(?=(?:，|,|。|；|;|然后|并|$))/g)];
  const clickMatches = [...instruction.matchAll(/(?:点击|点)\s*([^，,。；;]+?)(?=(?:，|,|。|；|;|然后|并|$))/g)];
  const actions: Array<Record<string, unknown>> = [];
  const parsed: Array<Record<string, string>> = [];

  for (const match of selectMatches) {
    const label = normalizeInstructionSlot(match[1]);
    const option = normalizeInstructionSlot(match[2]);
    if (!label || !option) continue;
    const plan = visualSelect({ label, option, timeoutMs: requestTimeoutMs }, requestTimeoutMs);
    actions.push(...plan.actions);
    parsed.push({ action: "select", label, option });
  }

  for (const match of clickMatches) {
    const text = normalizeInstructionSlot(match[1]);
    if (!text) continue;
    const plan = visualClickText({ text, timeoutMs: requestTimeoutMs }, requestTimeoutMs);
    actions.push(...plan.actions);
    parsed.push({ action: "click", text });
  }

  if (actions.length === 0) {
    throw new Error("INVALID_PARAMS: 当前 visual_task 只支持“选择X为Y”和“点击X”这类简单指令");
  }

  return { instruction, actions, parsed };
}

function normalizeInstructionSlot(value: string): string {
  return normalizeText(value)
    .replace(/^(类型|字段|筛选项|下拉框)/, "")
    .replace(/^(业务)?/, (prefix) => prefix)
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

function getVisualTargets(): VisualTarget[] {
  const targets: VisualTarget[] = [];
  const seen = new Set<string>();
  const push = (element: HTMLElement, source: VisualTarget["source"]) => {
    if (!isVisible(element) || !isInViewport(element)) return;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const text = getElementText(element) || getAccessibilityName(element) || getElementValue(element);
    if (!text && source === "text") return;
    const key = `${source}:${text ?? ""}:${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({
      text: truncate(text, 160),
      role: element.getAttribute("role") || inferRole(element),
      tagName: element.tagName.toLowerCase(),
      elementId: ensureElementId(element, targets.length),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      center: {
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2)
      },
      source
    });
  };

  for (const element of getActionableElements({ visibleOnly: true, viewportOnly: true })) {
    push(element, element.matches(FLOATING_OPTION_SELECTOR) ? "option" : "interactive");
  }

  for (const element of Array.from(document.querySelectorAll<HTMLElement>(FLOATING_OPTION_SELECTOR))) {
    push(element, "option");
  }

  for (const element of Array.from(document.querySelectorAll<HTMLElement>("button,a,label,span,div,p,td,th"))) {
    const text = normalizeText(element.innerText || element.textContent || "");
    const rect = element.getBoundingClientRect();
    if (text && text.length <= 80 && rect.width > 4 && rect.height > 4) {
      push(element, "text");
    }
  }

  return targets.sort((a, b) => {
    const sourceRank = (target: VisualTarget) => target.source === "option" ? 0 : target.source === "interactive" ? 1 : 2;
    const rankDelta = sourceRank(a) - sourceRank(b);
    if (rankDelta !== 0) return rankDelta;
    return a.rect.y - b.rect.y || a.rect.x - b.rect.x;
  });
}

function findVisualTargetByText(
  text: string,
  options: { exact?: boolean; prefer?: string; timeoutMs?: number } = {}
): VisualTarget {
  const normalized = normalizeText(text);
  const candidates = getVisualTargets()
    .filter((target) => {
      const targetText = normalizeText(target.text ?? "");
      return targetText && (options.exact ? targetText === normalized : targetText.includes(normalized));
    });
  const best = choosePreferredVisualTarget(candidates, options.prefer);
  if (best) return best;
  throw new Error(`ELEMENT_NOT_FOUND: 屏幕上未找到可见文本「${text}」`);
}

function choosePreferredVisualTarget(candidates: VisualTarget[], prefer?: string): VisualTarget | undefined {
  if (candidates.length === 0) return undefined;
  const sorted = [...candidates];
  switch (prefer) {
    case "bottom":
      sorted.sort((a, b) => b.rect.y - a.rect.y);
      break;
    case "left":
      sorted.sort((a, b) => a.rect.x - b.rect.x);
      break;
    case "right":
      sorted.sort((a, b) => b.rect.x - a.rect.x);
      break;
    case "largest":
      sorted.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
      break;
    case "smallest":
      sorted.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
      break;
    case "top":
    default:
      sorted.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
      break;
  }
  return sorted[0];
}

function findVisualSelectControlByLabel(label: string): VisualTarget | null {
  const normalizedLabel = normalizeText(label);
  const labelElements = Array.from(document.querySelectorAll<HTMLElement>("label,span,div"))
    .filter((element) => isVisible(element) && isInViewport(element))
    .filter((element) => normalizeText(element.innerText || element.textContent || "").includes(normalizedLabel));

  for (const labelElement of labelElements) {
    const labelRect = labelElement.getBoundingClientRect();
    const controls = getActionableElements({ visibleOnly: true, viewportOnly: true })
      .filter((element) => isSelectLikeVisualControl(element))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.x >= labelRect.x - 20 && rect.y >= labelRect.y - 24 && rect.y <= labelRect.y + 80)
      .sort((a, b) => {
        const ad = Math.abs(a.rect.y - labelRect.y) + Math.max(0, a.rect.x - labelRect.right);
        const bd = Math.abs(b.rect.y - labelRect.y) + Math.max(0, b.rect.x - labelRect.right);
        return ad - bd;
      });

    const control = controls[0]?.element;
    if (control) {
      const rect = control.getBoundingClientRect();
      return {
        text: getElementText(control) || getAccessibilityName(control) || label,
        role: control.getAttribute("role") || inferRole(control),
        tagName: control.tagName.toLowerCase(),
        elementId: ensureElementId(control, 0),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        center: {
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2)
        },
        source: "interactive"
      };
    }
  }

  const fallback = findControlByLabel(label);
  if (!fallback) return null;
  const rect = fallback.getBoundingClientRect();
  return {
    text: getElementText(fallback) || getAccessibilityName(fallback) || label,
    role: fallback.getAttribute("role") || inferRole(fallback),
    tagName: fallback.tagName.toLowerCase(),
    elementId: ensureElementId(fallback, 0),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    center: {
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2)
    },
    source: "interactive"
  };
}

function isSelectLikeVisualControl(element: HTMLElement): boolean {
  const role = element.getAttribute("role");
  const className = String(element.getAttribute("class") ?? "");
  return element instanceof HTMLSelectElement
    || role === "combobox"
    || element.getAttribute("aria-haspopup") === "listbox"
    || /select|Select|dropdown|Dropdown/.test(className)
    || (element instanceof HTMLInputElement && element.readOnly);
}

function getLinks(): { links: Array<{ text?: string; href: string; visible: boolean; rect?: DOMRectInit }> } {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .slice(0, 500)
    .map((link) => {
      const rect = link.getBoundingClientRect();
      return {
        text: getElementText(link),
        href: link.href,
        visible: isVisible(link),
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        }
      };
    });
  return { links };
}

function getPageSnapshot(): PageSnapshot {
  const allElements = getActionableElements({ visibleOnly: true });
  const foldedElements: BrowserElement[] = [];
  const signatureMap = new Map<string, number>();

  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i];

    // Visual importance filtering
    const style = window.getComputedStyle(el);
    const opacity = parseFloat(style.opacity || "1");
    const rect = el.getBoundingClientRect();
    if (opacity < 0.05 || (rect.width < 5 && rect.height < 5)) {
      continue; // Skip practically invisible or tiny elements
    }

    const parent = el.parentElement;
    // Semantic signature: Parent + Tag + Role
    const signature = `${parent?.tagName}-${el.tagName}-${el.getAttribute("role") || inferRole(el)}`;

    const count = signatureMap.get(signature) || 0;
    if (count < 3) { // Stricter compression: keep first 3 of same signature
      const browserEl = toBrowserElement(el, i);
      // Remove extremely long hints or values to save tokens
      if (browserEl.selectorHint && browserEl.selectorHint.length > 50) {
        browserEl.selectorHint = undefined;
      }
      foldedElements.push(browserEl);
      signatureMap.set(signature, count + 1);
    } else if (count === 3) {
      foldedElements.push({
        elementId: `folded-${i}`,
        role: "text",
        tagName: "span",
        text: `[... ${el.tagName.toLowerCase()} items hidden]`,
        visible: true,
        disabled: false,
        rect: elementRect(el)
      });
      signatureMap.set(signature, count + 1);
    }

    if (foldedElements.length >= 250) break; // Harder limit to protect context window
  }

  return {
    tabId: -1,
    url: location.href,
    title: document.title,
    text: getVisibleText().slice(0, 10000), // Cap text length
    elements: foldedElements
  };
}
function getInteractives(params: Record<string, unknown>): {
  url: string;
  title: string;
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
  elements: BrowserElement[];
} {
  const limit = Math.min(numberParam(params, "limit") ?? 80, 200);
  const viewportOnly = params.viewportOnly !== false;
  const elements = getActionableElements({ visibleOnly: true, viewportOnly })
    .slice(0, limit)
    .map(toBrowserElement);

  return {
    url: location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    },
    elements
  };
}

function getPageModel(params: Record<string, unknown>): BrowserPageModel {
  const visibleOnly = params.visibleOnly !== false;
  const viewportOnly = params.viewportOnly === true;
  const maxTextLength = clamp(numberParam(params, "maxTextLength") ?? 2000, 0, 20_000);
  const maxElements = clamp(numberParam(params, "maxElements") ?? 120, 0, 300);
  const maxHeadings = clamp(numberParam(params, "maxHeadings") ?? 60, 0, 200);
  const maxRegions = clamp(numberParam(params, "maxRegions") ?? 40, 0, 120);
  const maxTables = clamp(numberParam(params, "maxTables") ?? 10, 0, 50);
  const maxTableRows = clamp(numberParam(params, "maxTableRows") ?? 5, 0, 30);
  const fullText = getVisibleText();

  const interactives = getActionableElements({ visibleOnly, viewportOnly })
    .slice(0, maxElements)
    .map(toPageModelElement);

  return {
    tabId: -1,
    url: location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    },
    summary: {
      textSample: truncate(fullText, maxTextLength),
      textLength: fullText.length,
      truncated: fullText.length > maxTextLength
    },
    outline: getPageOutline({ visibleOnly, viewportOnly, limit: maxHeadings }),
    regions: getPageRegions({ visibleOnly, viewportOnly, limit: maxRegions }),
    interactives,
    floatingOptions: getFloatingOptions({ visibleOnly, viewportOnly }),
    forms: getPageForms({ visibleOnly, viewportOnly, maxElements }),
    tables: getPageTables({ visibleOnly, viewportOnly, maxTables, maxTableRows }),
    messages: getPageMessages({ visibleOnly, viewportOnly }),
    limits: {
      maxTextLength,
      maxElements,
      maxHeadings,
      maxRegions,
      maxTables,
      maxTableRows
    }
  };
}

function getPageOutline(options: {
  visibleOnly: boolean;
  viewportOnly: boolean;
  limit: number;
}): BrowserPageModel["outline"] {
  return Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,[role='heading']"))
    .filter((element) => includeElementInModel(element, options))
    .slice(0, options.limit)
    .map((element, index) => ({
      level: headingLevel(element),
      text: truncate(getElementText(element), 160) ?? "",
      elementId: ensureElementId(element, index),
      rect: elementRect(element)
    }))
    .filter((heading) => Boolean(heading.text));
}

function getPageRegions(options: {
  visibleOnly: boolean;
  viewportOnly: boolean;
  limit: number;
}): BrowserPageModel["regions"] {
  const selector = [
    "main",
    "nav",
    "header",
    "footer",
    "aside",
    "section",
    "article",
    "form",
    "[role='main']",
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    "[role='complementary']",
    "[role='region']",
    "[role='dialog']"
  ].join(",");

  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .filter((element) => includeElementInModel(element, options))
    .slice(0, options.limit)
    .map((element, index) => ({
      elementId: ensureElementId(element, index),
      role: element.getAttribute("role") || inferLandmarkRole(element),
      tagName: element.tagName.toLowerCase(),
      name: accessibleName(element),
      textSample: truncate(getElementText(element), 240),
      rect: elementRect(element)
    }));
}

function getPageForms(options: {
  visibleOnly: boolean;
  viewportOnly: boolean;
  maxElements: number;
}): BrowserPageModel["forms"] {
  return Array.from(document.querySelectorAll<HTMLFormElement>("form"))
    .filter((form) => includeElementInModel(form, options))
    .slice(0, 20)
    .map((form, index) => {
      const fields = Array.from(form.querySelectorAll<HTMLElement>(ACTIONABLE_SELECTOR))
        .filter((element) => includeElementInModel(element, options))
        .slice(0, Math.min(options.maxElements, 40))
        .map(toPageModelElement);
      return {
        elementId: ensureElementId(form, index),
        name: accessibleName(form),
        fields
      };
    });
}

function getPageTables(options: {
  visibleOnly: boolean;
  viewportOnly: boolean;
  maxTables: number;
  maxTableRows: number;
}): BrowserPageModel["tables"] {
  return Array.from(document.querySelectorAll<HTMLTableElement>("table"))
    .filter((table) => includeElementInModel(table, options))
    .slice(0, options.maxTables)
    .map((table, index) => {
      const rows = Array.from(table.rows);
      const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th, tr:first-child th"))
        .map((cell) => normalizeText(cell.innerText || cell.textContent || ""))
        .filter(Boolean)
        .slice(0, 20);
      const bodyRows = rows
        .filter((row) => row.cells.length > 0 && !row.closest("thead"))
        .slice(0, options.maxTableRows)
        .map((row) => Array.from(row.cells)
          .map((cell) => truncate(normalizeText(cell.innerText || cell.textContent || ""), 80) ?? "")
          .slice(0, 20));

      return {
        elementId: ensureElementId(table, index),
        caption: truncate(table.caption?.innerText || table.getAttribute("aria-label") || undefined, 120),
        headers,
        rowCount: rows.filter((row) => !row.closest("thead")).length,
        sampleRows: bodyRows,
        rect: elementRect(table)
      };
    });
}

function getPageMessages(options: {
  visibleOnly: boolean;
  viewportOnly: boolean;
}): BrowserPageModel["messages"] {
  const selector = [
    "[role='alert']",
    "[role='status']",
    "[aria-live]",
    ".error",
    ".warning",
    ".success",
    ".toast",
    ".message",
    ".notification"
  ].join(",");

  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .filter((element) => includeElementInModel(element, options))
    .slice(0, 30)
    .map((element, index) => ({
      elementId: ensureElementId(element, index),
      role: element.getAttribute("role") || "message",
      text: truncate(getElementText(element), 240) ?? "",
      rect: elementRect(element)
    }))
    .filter((message) => Boolean(message.text));
}

function getFloatingOptions(options: {
  visibleOnly: boolean;
  viewportOnly: boolean;
}): BrowserElement[] {
  const seenText = new Set<string>();
  return Array.from(document.querySelectorAll<HTMLElement>(FLOATING_OPTION_SELECTOR))
    .filter((element) => includeElementInModel(element, options))
    .map((element, index) => toPageModelElement(element, index))
    .filter((element) => {
      const key = `${element.role}:${normalizeText(element.text ?? element.ariaLabel ?? "")}:${element.rect?.x}:${element.rect?.y}`;
      if (!element.text && !element.ariaLabel) return false;
      if (seenText.has(key)) return false;
      seenText.add(key);
      return true;
    })
    .slice(0, 80);
}

function getVisibleText(): string {
  const lines: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (!isVisible(element)) return;

      const tagName = element.tagName.toLowerCase();
      if (tagName === "script" || tagName === "style" || tagName === "noscript") return;

      if (tagName === "h1" || tagName === "h2" || tagName === "h3" || tagName === "h4" || tagName === "h5" || tagName === "h6") {
        const level = parseInt(tagName[1]);
        lines.push(`\n${"#".repeat(level)} ${element.innerText.trim()}\n`);
      } else if (tagName === "table") {
        lines.push(`\n${processTable(element as HTMLTableElement)}\n`);
      } else if (tagName === "p" || tagName === "div" || tagName === "section" || tagName === "article") {
        // Continue walking children but maybe add newlines for block elements
        for (const child of Array.from(node.childNodes)) {
          walk(child);
        }
        lines.push("\n");
      } else if (tagName === "li") {
        lines.push("- ");
        for (const child of Array.from(node.childNodes)) {
          walk(child);
        }
        lines.push("\n");
      } else {
        for (const child of Array.from(node.childNodes)) {
          walk(child);
        }
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) {
        lines.push(text + " ");
      }
    }
  };

  function processTable(table: HTMLTableElement): string {
    const rows = Array.from(table.rows).slice(0, 20); // Limit rows
    if (rows.length === 0) return "";
    
    const markdownRows = rows.map(row => {
      const cells = Array.from(row.cells).slice(0, 10); // Limit columns
      return `| ${cells.map(cell => cell.innerText.trim().replace(/\|/g, "\\|")).join(" | ")} |`;
    });

    if (markdownRows.length > 0) {
      const firstRowCells = Array.from(rows[0].cells).slice(0, 10);
      const separator = `| ${firstRowCells.map(() => "---").join(" | ")} |`;
      markdownRows.splice(1, 0, separator);
    }

    return markdownRows.join("\n");
  }

  if (document.body) {
    walk(document.body);
  }
  
  return lines.join("").replace(/\n{3,}/g, "\n\n").trim().slice(0, 120_000);
}

function toBrowserElement(element: HTMLElement, index: number): BrowserElement {
  const elementId = ensureElementId(element, index);
  const input = element instanceof HTMLInputElement ? element : undefined;
  const value = input?.type === "password" ? undefined : getElementValue(element);

  return {
    elementId,
    role: element.getAttribute("role") || inferRole(element),
    tagName: element.tagName.toLowerCase(),
    text: getElementText(element),
    ariaLabel: element.getAttribute("aria-label") || undefined,
    placeholder: getPlaceholder(element),
    value,
    href: element instanceof HTMLAnchorElement ? element.href : undefined,
    visible: isVisible(element),
    disabled: isDisabled(element),
    selectorHint: buildSelectorHint(element),
    rect: elementRect(element)
  };
}

function toPageModelElement(element: HTMLElement, index: number): BrowserElement {
  const model = toBrowserElement(element, index);
  return {
    ...model,
    text: truncate(model.text, 160),
    ariaLabel: truncate(model.ariaLabel, 120),
    placeholder: truncate(model.placeholder, 120),
    value: truncate(model.value, 160)
  };
}

function ensureElementId(element: HTMLElement, index: number): string {
  const existing = element.getAttribute(ELEMENT_ATTR);
  if (existing) {
    return existing;
  }
  const id = `bb-${Date.now().toString(36)}-${index.toString(36)}`;
  element.setAttribute(ELEMENT_ATTR, id);
  return id;
}

function findElements(params: Record<string, unknown>): BrowserFindResult {
  const limit = Math.min(numberParam(params, "limit") ?? 8, 50);
  const query = stringParam(params, "query") ?? stringParam(params, "text");
  const matches = scoreElements(params)
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((match, index) => ({
      ...toBrowserElement(match.element, index),
      confidence: Math.min(1, Number(match.score.toFixed(2))),
      reasons: match.reasons
    }));

  return {
    matched: matches.length > 0,
    query,
    count: matches.length,
    matches
  };
}

async function act(
  params: Record<string, unknown>,
  requestTimeoutMs?: number
): Promise<BrowserActResult> {
  const action = parseActAction(stringParam(params, "action"));
  const target = stringParam(params, "target");
  const normalizedParams = normalizeActParams(params, target, requestTimeoutMs);

  if (action === "assertText") {
    const result = await assertText({
      ...normalizedParams,
      text: stringParam(params, "text") ?? target ?? stringParam(params, "query"),
      contains: stringParam(params, "text") ?? target ?? stringParam(params, "query")
    }, requestTimeoutMs);
    return { ok: true, action, result };
  }

  if (action === "waitFor") {
    const result = await waitForElement(normalizedParams, requestTimeoutMs);
    return {
      ok: true,
      action,
      matched: isRecord(result) && isRecord(result.element)
        ? compactBrowserElement(result.element)
        : undefined,
      result: compactActResult(result)
    };
  }

  const match = await resolveActTarget(normalizedParams, action);

  let result: unknown;
  switch (action) {
    case "click":
      result = await clickElement({ ...normalizedParams, elementId: match.elementId });
      break;
    case "type":
      result = await typeIntoElement({
        ...normalizedParams,
        elementId: match.elementId,
        text: stringParam(params, "value") ?? stringParam(params, "text"),
        replace: params.replace
      });
      break;
    case "hover":
      result = await hoverElement({ ...normalizedParams, elementId: match.elementId });
      break;
    case "clear":
      result = await clearElement({ ...normalizedParams, elementId: match.elementId });
      break;
    default:
      throw new Error(`INVALID_PARAMS: 不支持的 browser_act 动作 ${action}`);
  }

  return {
    ok: true,
    action,
    matched: compactMatchedElement(match.element, match.confidence, match.reasons),
    result: compactActResult(result)
  };
}

async function resolveActTarget(
  params: Record<string, unknown>,
  action: BrowserActAction
): Promise<{
  element: HTMLElement;
  elementId: string;
  confidence: number;
  reasons: string[];
}> {
  const elementId = stringParam(params, "elementId");
  const selector = stringParam(params, "selector");

  if (elementId || selector) {
    const element = await findTargetWithRetry(params, { allowText: action !== "type" && action !== "clear" });
    return {
      element,
      elementId: ensureElementId(element, 0),
      confidence: 1,
      reasons: ["确定定位"]
    };
  }

  const results = scoreElements(params);
  const bestMatches = results.filter((match) => match.score > 0).sort((a, b) => b.score - a.score);
  
  if (bestMatches.length === 0) {
    throw new Error("ELEMENT_NOT_FOUND: 未找到匹配的元素");
  }

  const best = bestMatches[0];
  const confidence = Math.min(1, Number(best.score.toFixed(2)));
  const threshold = numberParam(params, "confidenceThreshold") ?? defaultActThreshold(action);

  if (confidence < threshold) {
    throw new Error(`ELEMENT_NOT_FOUND: 最高候选置信度 ${confidence} 低于阈值 ${threshold}`);
  }

  // Strict Mode: Check for ambiguity among high-confidence matches
  const strictMode = params.strict !== false;
  if (strictMode && bestMatches.length > 1) {
    const secondBest = bestMatches[1];
    // If the difference in score is very small, it's ambiguous
    if (best.score - secondBest.score < 0.05 && secondBest.score > threshold) {
      const bestDesc = getElementDescription(best.element);
      const secondDesc = getElementDescription(secondBest.element);
      throw new Error(`AMBIGUOUS_TARGET: 找到多个相似的匹配目标，请提供更精确的描述。\n1. ${bestDesc}\n2. ${secondDesc}`);
    }
  }

  return {
    element: best.element,
    elementId: ensureElementId(best.element, 0),
    confidence,
    reasons: best.reasons
  };
}

function getElementDescription(el: HTMLElement): string {
  const role = el.getAttribute("role") || inferRole(el);
  const name = getAccessibilityName(el);
  const tag = el.tagName.toLowerCase();
  return `[${role}] ${name ? `"${name}"` : tag}${el.id ? ` #${el.id}` : ""}`;
}

function normalizeActParams(
  params: Record<string, unknown>,
  target?: string,
  requestTimeoutMs?: number
): Record<string, unknown> {
  return {
    ...params,
    query: stringParam(params, "query") ?? target,
    text: stringParam(params, "text") ?? target,
    timeoutMs: numberParam(params, "timeoutMs") ?? requestTimeoutMs
  };
}

function parseActAction(action: string | undefined): BrowserActAction {
  switch (action) {
    case "click":
    case "type":
    case "hover":
    case "clear":
    case "waitFor":
    case "assertText":
      return action;
    default:
      throw new Error("INVALID_PARAMS: browser_act.action 必须是 click、type、hover、clear、waitFor 或 assertText");
  }
}

function defaultActThreshold(action: BrowserActAction): number {
  return action === "click" || action === "type" ? 0.42 : 0.32;
}

function compactMatchedElement(
  element: HTMLElement,
  confidence: number,
  reasons: string[]
): BrowserActResult["matched"] {
  return {
    elementId: ensureElementId(element, 0),
    role: element.getAttribute("role") || inferRole(element),
    tagName: element.tagName.toLowerCase(),
    text: truncate(getElementText(element), 80),
    ariaLabel: truncate(element.getAttribute("aria-label") ?? undefined, 80),
    placeholder: truncate(getPlaceholder(element), 80),
    confidence,
    reasons: reasons.slice(0, 4)
  };
}

function compactBrowserElement(element: Record<string, unknown>): BrowserActResult["matched"] {
  return {
    elementId: String(element.elementId ?? ""),
    role: String(element.role ?? ""),
    tagName: String(element.tagName ?? ""),
    text: truncate(typeof element.text === "string" ? element.text : undefined, 80),
    ariaLabel: truncate(typeof element.ariaLabel === "string" ? element.ariaLabel : undefined, 80),
    placeholder: truncate(typeof element.placeholder === "string" ? element.placeholder : undefined, 80)
  };
}

function compactActResult(result: unknown): unknown {
  if (!isRecord(result)) {
    return result;
  }
  return Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== "element" && key !== "fields")
  );
}

async function findTargetWithRetry(
  params: Record<string, unknown>,
  options: { allowText?: boolean; timeoutMs?: number } = {}
): Promise<HTMLElement> {
  // 快速路径：如果有 elementId，直接查询，不需要重试轮询
  const elementId = stringParam(params, "elementId");
  if (elementId) {
    const el = document.querySelector<HTMLElement>(`[${ELEMENT_ATTR}="${cssEscape(elementId)}"]`)
      ?? (/^\d+$/.test(elementId) ? document.querySelector<HTMLElement>(`[data-bb-temp-id="${cssEscape(elementId)}"]`) : null);
    if (el) return el;
    // elementId 存在但元素不存在，可能已从 DOM 移除，走全量扫描
  }

  const timeoutMs = options.timeoutMs ?? numberParam(params, "timeoutMs") ?? 3000;
  const start = Date.now();
  let lastError: unknown;

  while (Date.now() - start <= timeoutMs) {
    try {
      return findTarget(params, options);
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("ELEMENT_NOT_FOUND: 未找到元素");
}

function findTarget(params: Record<string, unknown>, options: { allowText?: boolean } = {}): HTMLElement {
  const elementId = stringParam(params, "elementId");
  const selector = stringParam(params, "selector");
  const query = stringParam(params, "query");
  const text = stringParam(params, "text");
  const role = stringParam(params, "role");
  const ariaLabel = stringParam(params, "ariaLabel");
  const placeholder = stringParam(params, "placeholder");
  const href = stringParam(params, "href");

  let element: Element | null = null;
  if (elementId) {
    element = findInDeepScope(`[${ELEMENT_ATTR}="${cssEscape(elementId)}"]`);
    if (!element && /^\d+$/.test(elementId)) {
      element = findInDeepScope(`[data-bb-temp-id="${cssEscape(elementId)}"]`);
    }
  }

  if (!element && selector) {
    element = resolveSelector(selector);
  }

  if (!element && (query || text || role || ariaLabel || placeholder || href)) {
    const matches = scoreElements(params);
    if (matches.length > 0 && matches[0].score > 0.1) {
      element = matches[0].element;
    }
  }

  if (!element || !(element instanceof HTMLElement)) {
    throw new Error("ELEMENT_NOT_FOUND: 无法精确定位目标元素，建议使用 browser_find 查找候选。");
  }

  return element;
}

function resolveSelector(selector: string): HTMLElement | null {
  try {
    if (/^\d+$/.test(selector)) {
      return findInDeepScope(`[data-bb-temp-id="${cssEscape(selector)}"]`);
    }
    if (selector.startsWith("text=")) {
      return findByText(selector.slice(5));
    }
    if (selector.startsWith("xpath=")) {
      const result = document.evaluate(selector.slice(6), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      const node = result.singleNodeValue;
      return node instanceof HTMLElement ? node : null;
    }
    if (selector.startsWith("role=")) {
      const match = selector.match(/^role=([^\[]+)(?:\[name=(?:"([^"]+)"|'([^']+)')\])?$/);
      if (match) {
        const role = match[1];
        const name = match[2] || match[3];
        return findByRole(role, name);
      }
    }
    if (selector.startsWith("id=")) {
      return document.getElementById(selector.slice(3));
    }
    if (selector.startsWith("data-testid=")) {
      const value = cssEscape(selector.slice(12));
      return findInDeepScope(`[data-testid="${value}"],[data-test="${value}"],[data-cy="${value}"]`);
    }

    const cleanSelector = selector.startsWith("css=") ? selector.slice(4) : selector;
    return findInDeepScope(cleanSelector);
  } catch (error) {
    return null;
  }
}

function findInDeepScope(selector: string): HTMLElement | null {
  const walk = (root: Document | ShadowRoot | Element): HTMLElement | null => {
    const el = root.querySelector(selector);
    if (el instanceof HTMLElement) return el;
    
    // Check shadow roots of children
    const children = root instanceof Document ? [document.documentElement] : Array.from(root.children);
    for (const child of children) {
      if (child.shadowRoot) {
        const found = walk(child.shadowRoot);
        if (found) return found;
      }
      const foundInChild = walk(child);
      if (foundInChild) return foundInChild;
    }
    return null;
  };
  return walk(document);
}

function findBestElement(params: Record<string, unknown>): HTMLElement | null {
  return findBestScoredElement(params)?.element ?? null;
}

function findBestScoredElement(params: Record<string, unknown>): {
  element: HTMLElement;
  score: number;
  reasons: string[];
} | null {
  return scoreElements(params)
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

/** 中文同义词映射：提升中文 UI 场景的命中率 */
const CHINESE_SYNONYMS: Record<string, string[]> = {
  "确定": ["确认", "ok", "好", "是", "yes", "sure", "agree"],
  "确认": ["确定", "ok", "好", "是", "yes"],
  "取消": ["关闭", "cancel", "不", "否", "close"],
  "提交": ["保存", "submit", "save", "发送", "send"],
  "保存": ["提交", "save", "submit"],
  "删除": ["移除", "remove", "delete", "清除"],
  "移除": ["删除", "remove", "delete"],
  "查询": ["搜索", "查找", "search", "find"],
  "搜索": ["查询", "查找", "search", "find"],
  "新建": ["创建", "新增", "add", "create", "new"],
  "创建": ["新建", "新增", "add", "create"],
  "编辑": ["修改", "edit", "modify", "update"],
  "修改": ["编辑", "edit", "modify", "update"],
  "刷新": ["reload", "refresh", "重新加载"],
  "返回": ["后退", "back", "go back"],
  "登录": ["登陆", "sign in", "log in", "login"],
  "登出": ["退出", "sign out", "log out", "logout"],
  "上一步": ["后退", "previous", "back"],
  "下一步": ["继续", "next", "continue", "前进"],
  "全选": ["select all", "check all"],
  "导入": ["import", "上传", "upload"],
  "导出": ["export", "下载", "download"],
  "开启": ["启用", "打开", "enable", "turn on", "open"],
  "关闭": ["禁用", "关掉", "disable", "turn off", "close"],
};

function getSynonymBoost(query: string, elementText: string): { boost: number; reason: string } | null {
  if (!query || !elementText) return null;
  const queryLower = query.toLowerCase();
  const textLower = elementText.toLowerCase();

  // 检查 query 是否在同义词表中，且 elementText 包含同义词
  for (const [key, synonyms] of Object.entries(CHINESE_SYNONYMS)) {
    const keyLower = key.toLowerCase();
    if (queryLower === keyLower || synonyms.some(s => s.toLowerCase() === queryLower)) {
      // query 匹配了某个同义词组，检查 elementText 是否包含组内任何词
      const allTerms = [keyLower, ...synonyms.map(s => s.toLowerCase())];
      if (allTerms.some(term => textLower.includes(term))) {
        return { boost: 0.3, reason: `同义词匹配(${key})` };
      }
    }
  }
  return null;
}

function scoreElements(params: Record<string, unknown>): Array<{
  element: HTMLElement;
  score: number;
  reasons: string[];
}> {
  const query = normalizeText(stringParam(params, "query") ?? stringParam(params, "text") ?? "");
  const role = normalizeText(stringParam(params, "role") ?? "");
  const ariaLabel = normalizeText(stringParam(params, "ariaLabel") ?? "");
  const placeholder = normalizeText(stringParam(params, "placeholder") ?? "");
  const href = stringParam(params, "href");
  const nearText = normalizeText(stringParam(params, "nearText") ?? "");
  const visibleOnly = params.visibleOnly !== false;
  const viewportOnly = params.viewportOnly === true;

  const queryLower = query.toLowerCase();
  const queryClean = queryLower.replace(/\s+/g, "");

  const rectCache = new Map<HTMLElement, DOMRect>();
  const elements = getActionableElements({ visibleOnly, viewportOnly, rectCache });

  // 第一轮：快速粗筛（只用直接文本匹配，不调用 getNearbyText）
  const quickResults = elements.map((element) => {
    const accName = normalizeText(getAccessibilityName(element));
    const elementRole = normalizeText(element.getAttribute("role") || inferRole(element));
    const elementAria = normalizeText(element.getAttribute("aria-label") ?? "");
    const elementPlaceholder = normalizeText(getPlaceholder(element) ?? "");
    const elementValue = normalizeText(getElementValue(element) ?? "");
    const rect = rectCache.get(element) || element.getBoundingClientRect();

    let score = 0;
    const reasons: string[] = [];

    // 1. 语义匹配 (Semantic Matching)
    if (query) {
      const accNameClean = accName.toLowerCase().replace(/\s+/g, "");
      if (accNameClean === queryClean) {
        score += 0.8;
        reasons.push("名称精确匹配");
      } else if (accNameClean.includes(queryClean)) {
        score += 0.5;
        reasons.push("名称包含匹配");
      } else {
        score += scoreTextField(query, elementAria, 0.4, "aria-label", reasons);
        score += scoreTextField(query, elementPlaceholder, 0.35, "placeholder", reasons);
        score += scoreTextField(query, elementValue, 0.3, "值", reasons);
      }
    }

    // 2. 图像/图标特征匹配
    if (query && score < 0.4) {
      const className = (element.className || "").toString();
      const innerHtml = element.innerHTML;
      if (className.toLowerCase().includes(queryLower) || innerHtml.toLowerCase().includes(queryLower)) {
        score += 0.35;
        reasons.push("图标/图像特征匹配");
      }
    }

    // 3. 视觉权重
    const area = rect.width * rect.height;
    if (area > 2000) {
      score += 0.05;
      if (area > 8000) score += 0.05;
    }
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distToCenter = Math.sqrt(Math.pow(centerX - window.innerWidth / 2, 2) + Math.pow(centerY - window.innerHeight / 2, 2));
    if (distToCenter < 300) score += 0.05;

    // 4. 语义继承（轻量级：只用 parentElement.innerText）
    if (query && score < 0.5) {
      const parent = element.parentElement;
      if (parent) {
        const parentText = normalizeText(parent.innerText || "");
        if (parentText.includes(query)) {
          score += 0.25;
          reasons.push("父容器语义继承");
        }
      }
    }

    if (role && elementRole === role) {
      score += 0.3;
      reasons.push("Role 匹配");
    }

    if (isDisabled(element)) score -= 0.8;

    return { element, score, reasons, rect };
  });

  // 第二轮：只对候选者计算 getNearbyText（expensive）和 nearText 匹配
  if (nearText) {
    for (const result of quickResults) {
      if (result.score > 0.1) {
        const context = normalizeText(getNearbyText(result.element));
        if (context.includes(nearText)) {
          result.score += 0.2;
          result.reasons.push("上下文匹配");
        }
      }
    }
  }

  return quickResults;
}

function scoreTextField(
  query: string,
  value: string,
  weight: number,
  label: string,
  reasons: string[]
): number {
  if (!query || !value) {
    return 0;
  }
  if (value === query) {
    reasons.push(`${label} 精确匹配`);
    return weight;
  }
  if (value.includes(query)) {
    reasons.push(`${label} 包含匹配`);
    return weight * 0.78;
  }
  if (query.includes(value) && value.length >= 2) {
    reasons.push(`${label} 被查询包含`);
    return weight * 0.5;
  }
  return 0;
}

async function clickElement(params: Record<string, unknown>): Promise<{ clicked: boolean; element: BrowserElement }> {
  const element = await findTargetWithRetry(params, { allowText: true });
  if (params.__confirmedHighRisk !== true && await isHighRiskBlockingEnabled()) {
    await assertElementClickSafe(element);
  }

  await ensureElementActionable(element);
  element.scrollIntoView({ block: "center", inline: "center" });
  await delay(150); // Wait for scroll to settle

  showVisualRipple(element);

  // 首先尝试标准的事件分发
  dispatchPointerEvent(element, "mouseover");
  dispatchPointerEvent(element, "mousemove");
  dispatchPointerEvent(element, "mousedown");

  // 某些复杂的按钮可能不响应标准的 .click()，我们这里执行它
  element.click();

  dispatchPointerEvent(element, "mouseup");

  // 降级策略: 如果定义了 forceCdp 或标准点击可能无效，可以使用 CDP
  if (params.forceCdp === true) {
    const rect = element.getBoundingClientRect();
    await chrome.runtime.sendMessage({
      type: "browser_bridge_cdp_input",
      action: "click",
      params: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      }
    });
  }

  return { clicked: true, element: toBrowserElement(element, 0) };
}

/**
 * 语义按钮点击 — 根据语义（如"查询"、"保存"、"提交"）直接点击按钮
 *
 * 支持同义词匹配和上下文过滤，自动处理遮挡和滚动。
 */
async function clickSemanticButton(params: Record<string, unknown>): Promise<{
  clicked: boolean;
  element: BrowserElement;
  matchedText: string;
}> {
  const semantic = stringParam(params, "semantic");
  if (!semantic) {
    throw new Error("INVALID_PARAMS: semantic 参数必填");
  }
  const context = stringParam(params, "context");

  // 同义词扩展
  const synonyms = getSynonyms(semantic);
  const allTerms = [semantic, ...synonyms];

  // 候选按钮收集
  const candidates: Array<{ element: HTMLElement; score: number; matchedTerm: string }> = [];

  for (const term of allTerms) {
    const results = scoreElements({
      query: term,
      role: "button",
      visibleOnly: true,
    });

    for (const result of results) {
      if (result.score > 0.2) {
        candidates.push({
          element: result.element,
          score: result.score,
          matchedTerm: term,
        });
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error(`ELEMENT_NOT_FOUND: 未找到语义为「${semantic}」的按钮`);
  }

  // 上下文过滤
  let filtered = candidates;
  if (context) {
    const contextLower = context.toLowerCase();
    const contextFiltered = candidates.filter((c) => {
      const parent = c.element.closest("[class*='modal'], [class*='dialog'], [class*='form'], [class*='toolbar'], [class*='header'], [class*='footer']");
      if (parent) {
        const parentClass = (parent.className?.toString() || "").toLowerCase();
        return parentClass.includes(contextLower);
      }
      return true;
    });
    if (contextFiltered.length > 0) filtered = contextFiltered;
  }

  // 选择得分最高的
  filtered.sort((a, b) => b.score - a.score);
  const best = filtered[0];

  // 遮挡处理
  const rect = best.element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  if (centerY < 0 || centerY > window.innerHeight) {
    best.element.scrollIntoView({ block: "center", inline: "center" });
    await delay(150);
  }

  // 点击
  await ensureElementActionable(best.element);
  showVisualRipple(best.element);
  dispatchPointerEvent(best.element, "mouseover");
  dispatchPointerEvent(best.element, "mousemove");
  dispatchPointerEvent(best.element, "mousedown");
  best.element.click();
  dispatchPointerEvent(best.element, "mouseup");
  best.element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

  return {
    clicked: true,
    element: toBrowserElement(best.element, 0),
    matchedText: best.matchedTerm,
  };
}

async function hoverElement(params: Record<string, unknown>): Promise<{ hovered: boolean; element: BrowserElement }> {
  const element = await findTargetWithRetry(params, { allowText: true });

  await ensureElementActionable(element);
  element.scrollIntoView({ block: "center", inline: "center" });
  await delay(150);

  showVisualRipple(element);
  dispatchPointerEvent(element, "mouseover");
  dispatchPointerEvent(element, "mouseenter");
  dispatchPointerEvent(element, "mousemove");
  element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
  element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true, view: window }));
  element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window }));

  return { hovered: true, element: toBrowserElement(element, 0) };
}

async function typeIntoElement(params: Record<string, unknown>): Promise<{ typed: boolean; element: BrowserElement }> {
  const element = await findTargetWithRetry(params, { allowText: true });
  const text = stringParam(params, "text") ?? "";
  const replace = params.replace === true;

  assertEditableElement(element);
  await ensureElementActionable(element);
  element.scrollIntoView({ block: "center", inline: "center" });
  await delay(150);

  showVisualRipple(element, "#3b82f6"); // Blue ripple for typing

  element.focus();
  if (replace) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.value = "";
    } else if (element.isContentEditable) {
      element.textContent = "";
    }
  }

  if (params.forceCdp === true) {
    await chrome.runtime.sendMessage({
      type: "browser_bridge_cdp_input",
      action: "type",
      params: { text }
    });
  } else {
    for (const char of text) {
      const keyEventInit = {
        key: char,
        code: `Key${char.toUpperCase()}`,
        bubbles: true
      };
      element.dispatchEvent(new KeyboardEvent("keydown", keyEventInit));
      element.dispatchEvent(new KeyboardEvent("keypress", keyEventInit));

      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.value += char;
        element.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (element.isContentEditable) {
        element.textContent += char;
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }

      element.dispatchEvent(new KeyboardEvent("keyup", keyEventInit));
      await delay(Math.random() * 20 + 10); // Human-like delay
    }
  }

  element.dispatchEvent(new Event("change", { bubbles: true }));
  return { typed: true, element: toBrowserElement(element, 0) };
}

async function selectOption(
  params: Record<string, unknown>,
  requestTimeoutMs?: number
): Promise<{ selected: boolean; control: BrowserElement; optionText: string }> {
  const label = stringParam(params, "label");
  const option = stringParam(params, "option");
  if (!label || !option) {
    throw new Error("INVALID_PARAMS: label 和 option 参数必填");
  }

  const timeoutMs = numberParam(params, "timeoutMs") ?? requestTimeoutMs ?? 5000;
  const exact = params.exact !== false;
  const control = findControlByLabel(label);
  if (!control) {
    throw new Error(`ELEMENT_NOT_FOUND: 未找到标签为「${label}」的下拉控件`);
  }

  await ensureElementActionable(control);
  control.scrollIntoView({ block: "center", inline: "center" });
  await delay(120);

  if (control instanceof HTMLSelectElement) {
    selectNativeOption(control, option, exact);
    return {
      selected: true,
      control: toBrowserElement(control, 0),
      optionText: option
    };
  }

  await openSelectControl(control);
  const optionElement = await waitForOptionElement(option, exact, timeoutMs);
  if (params.__confirmedHighRisk !== true && await isHighRiskBlockingEnabled()) {
    await assertElementClickSafe(optionElement);
  }
  showVisualRipple(optionElement, "#22c55e");
  dispatchPointerEvent(optionElement, "mouseover");
  dispatchPointerEvent(optionElement, "mousemove");
  dispatchPointerEvent(optionElement, "mousedown");
  optionElement.click();
  dispatchPointerEvent(optionElement, "mouseup");
  optionElement.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  await delay(150);

  return {
    selected: true,
    control: toBrowserElement(control, 0),
    optionText: getElementText(optionElement) ?? option
  };
}

function findControlByLabel(label: string): HTMLElement | null {
  const normalizedLabel = normalizeText(label);
  const labels = Array.from(document.querySelectorAll<HTMLElement>("label,[class*='label'],[class*='Label'],.ant-form-item-label,.arco-form-label-item,.el-form-item__label"));
  const labelElement = labels.find((element) => normalizeText(element.innerText || element.textContent || "").includes(normalizedLabel));

  if (labelElement) {
    const htmlFor = labelElement.getAttribute("for");
    if (htmlFor) {
      const byFor = document.getElementById(htmlFor);
      if (byFor instanceof HTMLElement) return normalizeSelectControl(byFor);
    }

    const container = labelElement.closest<HTMLElement>(
      ".ant-form-item,.arco-form-item,.el-form-item,[class*='form-item'],[class*='FormItem'],[class*='field'],[class*='Field']"
    ) ?? labelElement.parentElement;
    const inContainer = container ? findSelectControlIn(container) : null;
    if (inContainer) return inContainer;
  }

  // 优化：只查询可能包含标签文本的元素，而非 body * 全量遍历
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    "label, span, div, p, td, th, li, dt, option, h1, h2, h3, h4, h5, h6, legend, [class*='label'], [class*='Label'], [class*='text'], [class*='Text']"
  ))
    .filter((element) => isVisible(element) && normalizeText(element.innerText || element.textContent || "").includes(normalizedLabel))
    .slice(0, 80);

  for (const candidate of candidates) {
    const container = candidate.closest<HTMLElement>(
      ".ant-form-item,.arco-form-item,.el-form-item,[class*='form-item'],[class*='FormItem'],[class*='field'],[class*='Field'],tr,li"
    ) ?? candidate.parentElement;
    const control = container ? findSelectControlIn(container) : null;
    if (control) return control;
  }

  return null;
}

function findSelectControlIn(container: HTMLElement): HTMLElement | null {
  const selectors = [
    "select",
    "[role='combobox']",
    "[aria-haspopup='listbox']",
    ".ant-select",
    ".arco-select",
    ".el-select",
    "[class*='select']",
    "[class*='Select']",
    "input[readonly]",
    "input[autocomplete='off']"
  ];

  for (const selector of selectors) {
    const elements = Array.from(container.querySelectorAll<HTMLElement>(selector))
      .filter((element) => isVisible(element) && !isDisabled(element));
    if (elements.length > 0) {
      const actionable = elements.find((element) => element.matches(ACTIONABLE_SELECTOR) || element.querySelector(ACTIONABLE_SELECTOR));
      return normalizeSelectControl(actionable ?? elements[0]);
    }
  }

  return null;
}

function normalizeSelectControl(element: HTMLElement): HTMLElement {
  return element.closest<HTMLElement>(".ant-select,.arco-select,.el-select,[role='combobox'],[class*='select'],[class*='Select']") ?? element;
}

function selectNativeOption(select: HTMLSelectElement, optionText: string, exact: boolean): void {
  const normalizedOption = normalizeText(optionText);
  const option = Array.from(select.options).find((item) => {
    const text = normalizeText(item.textContent || item.label || item.value);
    return exact ? text === normalizedOption : text.includes(normalizedOption);
  });
  if (!option) {
    throw new Error(`ELEMENT_NOT_FOUND: 下拉选项「${optionText}」不存在`);
  }
  select.value = option.value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

async function openSelectControl(control: HTMLElement): Promise<void> {
  showVisualRipple(control, "#22c55e");
  const target = findClickableSelectTarget(control);
  target.focus();
  dispatchPointerEvent(target, "mouseover");
  dispatchPointerEvent(target, "mousemove");
  dispatchPointerEvent(target, "mousedown");
  target.click();
  dispatchPointerEvent(target, "mouseup");
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  await delay(200);
}

function findClickableSelectTarget(control: HTMLElement): HTMLElement {
  const preferred = control.querySelector<HTMLElement>(
    ".ant-select-selector,.arco-select-view,.el-select__wrapper,[role='combobox'],input,[class*='selector'],[class*='Selector']"
  );
  if (preferred && isVisible(preferred)) {
    return preferred;
  }
  return control;
}

async function waitForOptionElement(optionText: string, exact: boolean, timeoutMs: number): Promise<HTMLElement> {
  const start = Date.now();
  let found: HTMLElement | null = null;
  while (Date.now() - start <= timeoutMs) {
    found = findVisibleOptionElement(optionText, exact);
    if (found) return found;
    await delay(100);
  }
  throw new Error(`ELEMENT_NOT_FOUND: 未找到可见下拉选项「${optionText}」`);
}

function findVisibleOptionElement(optionText: string, exact: boolean): HTMLElement | null {
  const normalizedOption = normalizeText(optionText);
  const selectors = [
    "[role='option']",
    ".ant-select-item-option",
    ".arco-select-option",
    ".el-select-dropdown__item",
    "[class*='option']",
    "[class*='Option']",
    "li",
    "div"
  ].join(",");

  const matches = Array.from(document.querySelectorAll<HTMLElement>(selectors))
    .filter((element) => isVisible(element) && isInViewport(element))
    .map((element) => ({ element, text: normalizeText(element.innerText || element.textContent || "") }))
    .filter(({ text }) => text && (exact ? text === normalizedOption : text.includes(normalizedOption)));

  return matches
    .sort((a, b) => {
      const aRole = a.element.getAttribute("role") === "option" ? 0 : 1;
      const bRole = b.element.getAttribute("role") === "option" ? 0 : 1;
      if (aRole !== bRole) return aRole - bRole;
      const aRect = a.element.getBoundingClientRect();
      const bRect = b.element.getBoundingClientRect();
      return area(aRect) - area(bRect);
    })[0]?.element ?? null;
}

function area(rect: DOMRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}
async function ensureElementActionable(element: HTMLElement, timeoutMs: number = 4000): Promise<void> {
  // 快速通过路径：大多数元素已经可交互，单次检查即可确认
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const isVisibleNow = style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  const isDisabledNow = element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";

  if (isVisibleNow && !isDisabledNow) {
    const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (topEl && (element === topEl || element.contains(topEl) || topEl.contains(element))) {
      return; // 元素可见、未禁用、未被遮挡，直接通过（0ms 延迟）
    }
  }

  // 慢速路径：进入轮询等待
  const start = Date.now();
  let lastRect: DOMRect | undefined;
  let stableCount = 0;
  let failureReason = "未知原因";

  while (Date.now() - start < timeoutMs) {
    if (!isVisible(element)) {
      failureReason = "元素不可见 (display:none, visibility:hidden 或 opacity:0)";
      await delay(200);
      continue;
    }

    if (isDisabled(element)) {
      failureReason = "元素处于禁用状态 (disabled 或 aria-disabled)";
      await delay(200);
      continue;
    }

    const currentRect = element.getBoundingClientRect();
    const isMoving = lastRect && (
      Math.abs(currentRect.top - lastRect.top) > 0.5 ||
      Math.abs(currentRect.left - lastRect.left) > 0.5
    );

    if (!isMoving) {
      stableCount++;
    } else {
      stableCount = 0;
      failureReason = "元素正在移动 (正在执行动画或滚动)";
    }
    lastRect = currentRect;

    if (stableCount < 2) {
      await delay(150);
      continue;
    }

    // Obscuration check
    const points = [
      { x: currentRect.left + currentRect.width / 2, y: currentRect.top + currentRect.height / 2 },
      { x: currentRect.left + 2, y: currentRect.top + 2 },
      { x: currentRect.right - 2, y: currentRect.top + 2 }
    ];

    let obscuredEl: Element | null = null;
    let isObscured = true;
    for (const point of points) {
      const topEl = document.elementFromPoint(point.x, point.y);
      if (topEl && (element === topEl || element.contains(topEl) || topEl.contains(element))) {
        isObscured = false;
        break;
      }
      if (topEl) obscuredEl = topEl;
    }

    if (isObscured) {
      const desc = obscuredEl ? `${obscuredEl.tagName.toLowerCase()}${obscuredEl.className ? `.${obscuredEl.className.split(" ").join(".")}` : ""}` : "未知元素";
      failureReason = `元素被遮挡 (顶层元素为: ${desc})`;
      await delay(250);
      continue;
    }

    return;
  }
  throw new Error(`ACTION_TIMEOUT: 元素在 ${timeoutMs}ms 内未达到可交互状态。原因: ${failureReason}`);
}
function showVisualRipple(element: HTMLElement, color: string = "#ef4444"): void {
  const rect = element.getBoundingClientRect();
  const ripple = document.createElement("div");
  
  ripple.style.cssText = `
    position: fixed;
    top: ${rect.top + rect.height / 2}px;
    left: ${rect.left + rect.width / 2}px;
    width: 2px;
    height: 2px;
    background: transparent;
    border: 4px solid ${color};
    border-radius: 50%;
    pointer-events: none;
    z-index: 2147483647;
    transform: translate(-50%, -50%);
    animation: bb-ripple-animation 0.6s ease-out forwards;
  `;

  if (!document.getElementById("bb-ripple-style")) {
    const style = document.createElement("style");
    style.id = "bb-ripple-style";
    style.textContent = `
      @keyframes bb-ripple-animation {
        0% { width: 0; height: 0; opacity: 1; border-width: 4px; }
        100% { width: 100px; height: 100px; opacity: 0; border-width: 1px; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
}

async function assertElementClickSafe(element: HTMLElement): Promise<void> {
  const directText = [
    getElementText(element),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("value")
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  const contextText = getNearbyText(element);
  const combinedText = `${directText} ${contextText}`;

  if (HIGH_RISK_TEXT_PATTERNS.some((pattern) => pattern.test(combinedText))) {
    const confirmed = await showConfirmationOverlay(`Agent 试图执行高风险浏览器操作。\n\n目标元素及上下文可能涉及敏感动作（如删除、支付）：\n\n【元素文本】: ${directText || "(空)"}\n【附近文本】: ${truncate(contextText, 100) || "(无)"}`);
    if (!confirmed) {
      throw new Error("USER_REJECTED: 用户已取消高风险浏览器操作");
    }
  }
}

function showConfirmationOverlay(reason: string): Promise<boolean> {
  return new Promise((resolve) => {
    document.querySelector("#browser-bridge-confirm-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "browser-bridge-confirm-overlay";
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "background:rgba(11,18,32,.48)",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
    ].join(";");

    const panel = document.createElement("div");
    panel.style.cssText = [
      "box-sizing:border-box",
      "width:min(420px,calc(100vw - 32px))",
      "border-radius:8px",
      "background:#fff",
      "box-shadow:0 18px 50px rgba(0,0,0,.28)",
      "padding:18px",
      "color:#172026"
    ].join(";");

    const title = document.createElement("h2");
    title.textContent = "确认浏览器操作";
    title.style.cssText = "margin:0 0 10px;font-size:18px;line-height:1.3";

    const body = document.createElement("p");
    body.textContent = reason;
    body.style.cssText = "margin:0 0 14px;font-size:13px;line-height:1.5;color:#3c4852;white-space:pre-line";

    const url = document.createElement("p");
    url.textContent = location.href;
    url.style.cssText = [
      "margin:0 0 16px",
      "padding:8px",
      "border-radius:6px",
      "background:#f3f6f8",
      "font-size:12px",
      "line-height:1.4",
      "word-break:break-all",
      "color:#53616c"
    ].join(";");

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:10px;justify-content:flex-end";

    const cancel = document.createElement("button");
    cancel.textContent = "取消";
    cancel.style.cssText = buttonStyle("#eef2f5", "#172026");

    const confirm = document.createElement("button");
    confirm.textContent = "确认执行";
    confirm.style.cssText = buttonStyle("#b42318", "#fff");

    let settled = false;
    const cleanup = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      overlay.remove();
      resolve(value);
    };

    // 60 秒超时自动取消，避免用户不操作时 Promise 永不 resolve
    const timeout = setTimeout(() => cleanup(false), 60_000);

    cancel.addEventListener("click", () => cleanup(false), { once: true });
    confirm.addEventListener("click", () => cleanup(true), { once: true });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        cleanup(false);
      }
    });

    actions.append(cancel, confirm);
    panel.append(title, body, url, actions);
    overlay.append(panel);
    document.documentElement.append(overlay);
  });
}

function buttonStyle(background: string, color: string): string {
  return [
    "border:0",
    "border-radius:6px",
    "padding:8px 12px",
    "font-size:13px",
    "cursor:pointer",
    `background:${background}`,
    `color:${color}`
  ].join(";");
}

async function isHighRiskBlockingEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get("blockHighRiskActions");
  return typeof stored.blockHighRiskActions === "boolean"
    ? stored.blockHighRiskActions
    : true;
}

async function fillForm(params: Record<string, unknown>): Promise<{
  filled: boolean;
  fields: Array<{ index: number; ok: boolean; element?: BrowserElement; error?: string }>;
}> {
  const fields = Array.isArray(params.fields) ? params.fields : undefined;
  if (!fields?.length) {
    throw new Error("INVALID_PARAMS: fields 参数必填");
  }
  if (fields.length > 30) {
    throw new Error("INVALID_PARAMS: fields 最多支持 30 项");
  }

  const results = [];
  for (const [index, field] of fields.entries()) {
    if (!isRecord(field) || typeof field.value !== "string") {
      results.push({ index, ok: false, error: "字段必须包含 value" });
      continue;
    }
    try {
      const result = await typeIntoElement({
        ...field,
        text: field.value,
        replace: field.replace !== false
      });
      results.push({ index, ok: true, element: result.element });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ index, ok: false, error: message });
    }
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    const details = failed
      .map((result) => `#${result.index}: ${result.error ?? "未知错误"}`)
      .join("; ");
    throw new Error(`ELEMENT_NOT_FOUND: 表单填写失败 ${details}`);
  }

  return {
    filled: results.every((r) => r.ok),
    fields: results
  };
}

async function clearElement(params: Record<string, unknown>): Promise<{ cleared: boolean; element: BrowserElement }> {
  const element = await findTargetWithRetry(params, { allowText: false });
  setElementValue(element, "", true);
  return { cleared: true, element: toBrowserElement(element, 0) };
}

function scrollPage(params: Record<string, unknown>): { scrolled: boolean } {
  const direction = stringParam(params, "direction") || "down";
  const amount = numberParam(params, "amount") ?? Math.round(window.innerHeight * 0.8);
  const delta = direction === "up" || direction === "left" ? -amount : amount;

  if (direction === "left" || direction === "right") {
    window.scrollBy({ left: delta, behavior: "smooth" });
  } else {
    window.scrollBy({ top: delta, behavior: "smooth" });
  }
  return { scrolled: true };
}

function pressKey(params: Record<string, unknown>): { pressed: boolean; key: string } {
  const key = stringParam(params, "key");
  if (!key) {
    throw new Error("INVALID_PARAMS: key 参数必填");
  }

  const target = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : document.body;

  for (const type of ["keydown", "keypress", "keyup"]) {
    target?.dispatchEvent(new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key
    }));
  }
  applyKeyDefault(key, target);
  return { pressed: true, key };
}

function applyKeyDefault(key: string, target: HTMLElement | null): void {
  if (key === "Enter") {
    if (target instanceof HTMLButtonElement) {
      target.click();
      return;
    }
    const form = target?.closest("form");
    if (form instanceof HTMLFormElement) {
      form.requestSubmit();
    }
    return;
  }

  if (key === "Tab") {
    focusNextElement(false);
  }
}

function focusNextElement(reverse: boolean): void {
  const focusables = getActionableElements({ visibleOnly: true })
    .filter((element) => !isDisabled(element) && isFocusable(element));
  const activeIndex = document.activeElement instanceof HTMLElement
    ? focusables.indexOf(document.activeElement)
    : -1;
  const nextIndex = reverse
    ? (activeIndex <= 0 ? focusables.length - 1 : activeIndex - 1)
    : (activeIndex + 1) % focusables.length;
  focusables[nextIndex]?.focus();
}

async function assertText(
  params: Record<string, unknown>,
  requestTimeoutMs?: number
): Promise<{ asserted: boolean; text: string }> {
  const text = stringParam(params, "text") ?? stringParam(params, "contains");
  if (!text) {
    throw new Error("INVALID_PARAMS: text 或 contains 参数必填");
  }

  const timeoutMs = numberParam(params, "timeoutMs") ?? requestTimeoutMs ?? 5000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getVisibleText().includes(text)) {
      return { asserted: true, text };
    }
    await delay(100);
  }

  throw new Error(`ACTION_TIMEOUT: ${timeoutMs}ms 内未出现文本 ${text}`);
}

async function waitForElement(
  params: Record<string, unknown>,
  requestTimeoutMs?: number
): Promise<{ found: boolean; element?: BrowserElement }> {
  const timeoutMs = numberParam(params, "timeoutMs") ?? requestTimeoutMs ?? 5000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const element = findTarget(params);
      return { found: true, element: toBrowserElement(element, 0) };
    } catch {
      await delay(100);
    }
  }

  throw new Error(`ACTION_TIMEOUT: ${timeoutMs}ms 内未找到元素`);
}

function setElementValue(element: HTMLElement, value: string, replace: boolean): void {
  element.focus();

  if (element instanceof HTMLSelectElement) {
    setSelectValue(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const nextValue = replace ? value : `${element.value}${value}`;
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (element.isContentEditable) {
    if (replace) {
      element.textContent = value;
    } else {
      element.textContent = `${element.textContent ?? ""}${value}`;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  throw new Error("UNSUPPORTED_PAGE: 目标元素不支持文本输入");
}

function setSelectValue(element: HTMLSelectElement, value: string): void {
  const option = Array.from(element.options).find((item) => (
    item.value === value ||
    normalizeText(item.label) === normalizeText(value) ||
    normalizeText(item.textContent ?? "") === normalizeText(value)
  ));
  if (!option) {
    throw new Error(`ELEMENT_NOT_FOUND: 下拉选项不存在 ${value}`);
  }
  element.value = option.value;
}

function findByText(text: string): HTMLElement | null {
  const normalized = normalizeText(text);
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(ACTIONABLE_SELECTOR));
  return candidates.find((element) => normalizeText(getElementText(element) ?? "").includes(normalized)) ?? null;
}

function findByAttribute(attribute: string, value: string): HTMLElement | null {
  const normalized = normalizeText(value);
  const selector = `[${attribute}]`;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
  return candidates.find((element) => normalizeText(element.getAttribute(attribute) ?? "") === normalized) ?? null;
}

function findByHref(href: string): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
  return candidates.find((element) => element.href === href || element.getAttribute("href") === href) ?? null;
}

function findByRole(role: string, text?: string): HTMLElement | null {
  const normalizedRole = normalizeText(role);
  const normalizedText = text ? normalizeText(text) : undefined;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(ACTIONABLE_SELECTOR));
  return candidates.find((element) => {
    const roleMatches = inferRole(element) === normalizedRole || element.getAttribute("role") === normalizedRole;
    if (!roleMatches) {
      return false;
    }
    if (!normalizedText) {
      return true;
    }
    return normalizeText(getElementText(element) ?? "").includes(normalizedText);
  }) ?? null;
}

function getActionableElements(options: {
  visibleOnly?: boolean;
  viewportOnly?: boolean;
  rectCache?: Map<HTMLElement, DOMRect>;
} = {}): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const cache = options.rectCache;

  const addElement = (el: HTMLElement) => {
    if (seen.has(el)) return;
    const rect = el.getBoundingClientRect();
    if (cache) cache.set(el, rect);
    if (rect.width <= 0 || rect.height <= 0) return;
    if (options.visibleOnly !== false) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return;
    }
    if (options.viewportOnly && (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth)) return;
    elements.push(el);
    seen.add(el);
  };

  // Shadow DOM walk：查询可交互元素 + 仅递归有 shadowRoot 的子节点
  // 使用 children 遍历而非 querySelectorAll("*")，避免全量 DOM 扫描的性能开销
  const walkShadowRoots = (root: Document | ShadowRoot) => {
    const matched = root.querySelectorAll<HTMLElement>(ACTIONABLE_SELECTOR);
    for (const el of Array.from(matched)) {
      addElement(el);
    }
    // 只遍历直接子节点的 shadowRoot，避免 querySelectorAll("*") 的巨大开销
    const container = root instanceof Document ? document.documentElement : root;
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i] as HTMLElement;
      if (child.shadowRoot) {
        walkShadowRoots(child.shadowRoot);
      }
      // 递归子节点以找到更深层的 shadowRoot
      if (child.children.length > 0) {
        walkChildrenForShadows(child);
      }
    }
  };

  const walkChildrenForShadows = (parent: Element) => {
    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i] as HTMLElement;
      if (child.shadowRoot) {
        walkShadowRoots(child.shadowRoot);
      }
      if (child.children.length > 0) {
        walkChildrenForShadows(child);
      }
    }
  };

  if (document.body) {
    walkShadowRoots(document);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FLOATING_OPTION_SELECTOR))) {
      const text = normalizeText(el.innerText || el.textContent || "");
      if (text) addElement(el);
    }
  }

  // 排序：用缓存的 rect 避免重复 getBoundingClientRect 调用
  return elements.sort((a, b) => {
    const aViewport = isInViewportCached(a, cache) ? 0 : 1;
    const bViewport = isInViewportCached(b, cache) ? 0 : 1;
    if (aViewport !== bViewport) return aViewport - bViewport;
    const aRect = cache?.get(a) ?? a.getBoundingClientRect();
    const bRect = cache?.get(b) ?? b.getBoundingClientRect();
    return aRect.top - bRect.top || aRect.left - bRect.left;
  });
}

/** 使用缓存 rect 的 isInViewport，避免重复 getBoundingClientRect */
function isInViewportCached(element: HTMLElement, cache?: Map<HTMLElement, DOMRect>): boolean {
  const rect = cache?.get(element) ?? element.getBoundingClientRect();
  return rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
}

function getElementText(element: HTMLElement): string | undefined {
  // Use a more robust way to extract text, especially for nested components like AntD
  const text = normalizeText(element.innerText || element.textContent || "");
  if (text) return text;
  
  // If no direct text, check if it's an icon or has a descriptive class
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return normalizeText(ariaLabel);
  
  const title = element.getAttribute("title");
  if (title) return normalizeText(title);

  return undefined;
}

function getNearbyText(element: HTMLElement): string {
  const parts = [
    element.parentElement?.innerText,
    element.closest("label")?.textContent,
    element.closest("li")?.textContent,
    element.closest("tr")?.textContent,
    element.closest("section")?.querySelector("h1,h2,h3,h4")?.textContent,
    element.closest("form")?.querySelector("label")?.textContent
  ];
  return parts
    .filter((value): value is string => Boolean(value))
    .map((value) => value.slice(0, 500))
    .join(" ");
}

function getElementValue(element: HTMLElement): string | undefined {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value || undefined;
  }
  if (element instanceof HTMLSelectElement) {
    return element.value || undefined;
  }
  return undefined;
}

function getPlaceholder(element: HTMLElement): string | undefined {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.placeholder || undefined;
  }
  return undefined;
}

function assertEditableElement(element: HTMLElement): void {
  if (isEditableElement(element)) {
    return;
  }

  throw new Error("ELEMENT_NOT_FOUND: 未找到可输入的表单控件");
}

function isEditableElement(element: HTMLElement): boolean {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return true;
  }

  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    return !["button", "submit", "reset", "checkbox", "radio", "file", "image", "hidden"].includes(type);
  }

  return element.isContentEditable || element.getAttribute("role") === "textbox";
}

function inferRole(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "a") return "link";
  if (tagName === "button") return "button";
  if (tagName === "textarea") return "textbox";
  if (tagName === "select") return "combobox";
  if (tagName === "input") {
    const type = (element as HTMLInputElement).type;
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "submit" || type === "button") return "button";
    return "textbox";
  }
  return "generic";
}

function inferLandmarkRole(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "main") return "main";
  if (tagName === "nav") return "navigation";
  if (tagName === "header") return "banner";
  if (tagName === "footer") return "contentinfo";
  if (tagName === "aside") return "complementary";
  if (tagName === "form") return "form";
  if (tagName === "article") return "article";
  if (tagName === "section") return "region";
  return inferRole(element);
}

function headingLevel(element: HTMLElement): number {
  const tagName = element.tagName.toLowerCase();
  const match = tagName.match(/^h([1-6])$/);
  if (match) {
    return Number(match[1]);
  }
  const ariaLevel = Number(element.getAttribute("aria-level"));
  return Number.isFinite(ariaLevel) && ariaLevel > 0 ? ariaLevel : 2;
}

function getAccessibilityName(element: HTMLElement): string {
  // 1. aria-labelledby
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy.split(/\s+/)
      .map(id => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return text;
  }

  // 2. aria-label
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel?.trim()) return ariaLabel.trim();

  // 3. Label for / Wrapped label
  const label = getAssociatedLabel(element);
  if (label) return label;

  // 4. Placeholder
  const placeholder = getPlaceholder(element);
  if (placeholder) return placeholder;

  // 5. Alt for images
  if (element instanceof HTMLImageElement) {
    const alt = element.getAttribute("alt");
    if (alt) return alt;
  }

  // 6. Title
  const title = element.getAttribute("title");
  if (title) return title;

  // 7. Text content
  return getElementText(element) ?? "";
}

function accessibleName(element: HTMLElement): string | undefined {
  return getAccessibilityName(element);
}

function includeElementInModel(element: HTMLElement, options: {
  visibleOnly: boolean;
  viewportOnly: boolean;
}): boolean {
  if (options.visibleOnly && !isVisible(element)) {
    return false;
  }
  if (options.viewportOnly && !isInViewport(element)) {
    return false;
  }
  return true;
}

function elementRect(element: HTMLElement): BrowserElement["rect"] {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function buildSelectorHint(element: HTMLElement): string | undefined {
  if (element.id) {
    return `#${cssEscape(element.id)}`;
  }
  const testId = element.getAttribute("data-testid");
  if (testId) {
    return `[data-testid="${cssEscape(testId)}"]`;
  }
  const name = element.getAttribute("name");
  if (name) {
    return `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
  }
  return undefined;
}

/** isVisible 结果缓存 — 在一次请求内避免重复 getComputedStyle 调用 */
const visibilityCache = new WeakMap<HTMLElement, { visible: boolean; time: number }>();
const VISIBILITY_CACHE_TTL = 300; // 300ms

function isVisible(element: HTMLElement): boolean {
  const cached = visibilityCache.get(element);
  if (cached && Date.now() - cached.time < VISIBILITY_CACHE_TTL) {
    return cached.visible;
  }
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const visible =
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) !== 0 &&
    rect.width > 0 &&
    rect.height > 0;
  visibilityCache.set(element, { visible, time: Date.now() });
  return visible;
}

/** 清除可见性缓存（写操作后调用） */
function invalidateVisibilityCache(): void {
  // WeakMap 不支持 clear()，通过创建新实例实现
  // 实际上 WeakMap 会在 GC 时自动清理，这里只是标记意图
}

function isInViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= window.innerHeight &&
    rect.left <= window.innerWidth
  );
}

function isDisabled(element: HTMLElement): boolean {
  return (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true"
  );
}

function isFocusable(element: HTMLElement): boolean {
  return (
    element.tabIndex >= 0 ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLButtonElement ||
    element instanceof HTMLAnchorElement ||
    element.isContentEditable
  );
}

function dispatchPointerEvent(element: HTMLElement, type: string): void {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function numberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cssEscape(value: string): string {
  if ("CSS" in window && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\\"');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
