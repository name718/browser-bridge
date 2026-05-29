import {
  type BrowserElement,
  type BrowserActAction,
  type BrowserActResult,
  type BrowserFindResult,
  type BrowserPageModel,
  type BridgeRequest,
  type PageSnapshot
} from "@majuntao-1/browser-bridge-shared";

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
  "[onclick]",
  "[contenteditable='true']"
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

// Session Recording functionality
document.addEventListener("click", (event) => {
  if (!isRecording) return;
  const target = event.target as HTMLElement;
  if (!target) return;
  
  // Try to generate a selector or use text
  const text = getElementText(target);
  const selector = buildSelectorHint(target);
  
  chrome.runtime.sendMessage({
    type: "browser_bridge_record_step",
    step: {
      action: "click",
      text: text || undefined,
      selector: text ? undefined : selector,
      url: location.href
    }
  });
}, true);

document.addEventListener("change", (event) => {
  if (!isRecording) return;
  const target = event.target as HTMLElement;
  if (!target) return;
  
  const value = getElementValue(target);
  const placeholder = getPlaceholder(target);
  const ariaLabel = target.getAttribute("aria-label");
  const selector = buildSelectorHint(target);
  
  chrome.runtime.sendMessage({
    type: "browser_bridge_record_step",
    step: {
      action: "type",
      value,
      placeholder: placeholder || undefined,
      ariaLabel: ariaLabel || undefined,
      selector: (!placeholder && !ariaLabel) ? selector : undefined,
      url: location.href
    }
  });
}, true);

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
  updateOverlay(request.tool);

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

function updateOverlay(tool?: string) {
  if (activeOperations > 0) {
    showSciFiOverlay(tool);
  } else {
    hideSciFiOverlay();
  }
}

function showSciFiOverlay(tool?: string) {
  let overlay = document.getElementById("browser-bridge-agent-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "browser-bridge-agent-overlay";
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 20, 40, 0.15);
      pointer-events: none;
      z-index: 2147483646;
      border: 4px double rgba(0, 255, 255, 0.3);
      box-sizing: border-box;
      box-shadow: inset 0 0 100px rgba(0, 255, 255, 0.1);
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      padding: 30px;
    `;

    const scanLine = document.createElement("div");
    scanLine.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 2px;
      background: rgba(0, 255, 255, 0.5);
      box-shadow: 0 0 10px rgba(0, 255, 255, 0.8);
      animation: bb-scan 4s linear infinite;
    `;

    const container = document.createElement("div");
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 10px;
    `;

    const statusText = document.createElement("div");
    statusText.id = "bb-status-text";
    statusText.style.cssText = `
      color: #00ffff;
      font-size: 16px;
      font-weight: bold;
      text-shadow: 0 0 8px #00ffff;
      background: rgba(0, 40, 80, 0.85);
      padding: 8px 16px;
      border-radius: 4px;
      border-right: 4px solid #00ffff;
      letter-spacing: 1px;
      animation: bb-pulse 1.5s ease-in-out infinite;
    `;
    statusText.innerText = "AGENT ACTIVE";

    const logContainer = document.createElement("div");
    logContainer.id = "bb-log-container";
    logContainer.style.cssText = `
      color: rgba(0, 255, 255, 0.8);
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      background: rgba(0, 20, 40, 0.7);
      padding: 10px;
      border-radius: 4px;
      max-width: 300px;
      text-align: right;
      border-right: 2px solid rgba(0, 255, 255, 0.4);
    `;

    const corners = ["top-left", "top-right", "bottom-left", "bottom-right"];
    corners.forEach(corner => {
      const el = document.createElement("div");
      el.style.cssText = `
        position: absolute;
        width: 40px;
        height: 40px;
        border-color: #00ffff;
        border-style: solid;
        border-width: 0;
        ${corner.includes("top") ? "top: 15px;" : "bottom: 15px;"}
        ${corner.includes("left") ? "left: 15px;" : "right: 15px;"}
        ${corner.includes("top") ? "border-top-width: 2px;" : "border-bottom-width: 2px;"}
        ${corner.includes("left") ? "border-left-width: 2px;" : "border-right-width: 2px;"}
        opacity: 0.6;
      `;
      overlay?.appendChild(el);
    });

    if (!document.getElementById("bb-overlay-style")) {
      const style = document.createElement("style");
      style.id = "bb-overlay-style";
      style.textContent = `
        @keyframes bb-scan {
          0% { top: -10%; }
          100% { top: 110%; }
        }
        @keyframes bb-pulse {
          0%, 100% { opacity: 1; filter: brightness(1.2); }
          50% { opacity: 0.8; filter: brightness(0.8); }
        }
      `;
      document.head.appendChild(style);
    }

    container.appendChild(statusText);
    container.appendChild(logContainer);
    overlay.appendChild(scanLine);
    overlay.appendChild(container);
    document.documentElement.appendChild(overlay);
  } else {
    overlay.style.display = "flex";
  }

  if (tool) {
    const logContainer = document.getElementById("bb-log-container");
    if (logContainer) {
      const entry = document.createElement("div");
      entry.innerText = `> ${tool}`;
      logContainer.appendChild(entry);
      if (logContainer.childNodes.length > 5) {
        logContainer.removeChild(logContainer.firstChild!);
      }
    }
    const statusText = document.getElementById("bb-status-text");
    if (statusText) {
      statusText.innerText = `AGENT: ${tool.toUpperCase().replace("BROWSER_", "")}`;
    }
  }
}

function hideSciFiOverlay() {
  const overlay = document.getElementById("browser-bridge-agent-overlay");
  if (overlay) {
    overlay.style.display = "none";
    const logContainer = document.getElementById("bb-log-container");
    if (logContainer) logContainer.innerHTML = "";
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
    default:
      throw new Error(`INTERNAL_ERROR: 不支持的页面工具 ${request.tool}`);
  }
}

function getSelectedText(): { text: string } {
  return { text: window.getSelection()?.toString() ?? "" };
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
        for (const child of node.childNodes) {
          walk(child);
        }
        lines.push("\n");
      } else if (tagName === "li") {
        lines.push("- ");
        for (const child of node.childNodes) {
          walk(child);
        }
        lines.push("\n");
      } else {
        for (const child of node.childNodes) {
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
  if (stringParam(params, "elementId") || stringParam(params, "selector")) {
    const element = await findTargetWithRetry(params, { allowText: action !== "type" && action !== "clear" });
    return {
      element,
      elementId: ensureElementId(element, 0),
      confidence: 1,
      reasons: ["确定定位"]
    };
  }

  const match = findBestScoredElement(params);
  if (!match) {
    throw new Error("ELEMENT_NOT_FOUND: 未找到元素");
  }

  const confidence = Math.min(1, Number(match.score.toFixed(2)));
  const threshold = numberParam(params, "confidenceThreshold") ?? defaultActThreshold(action);
  if (confidence < threshold) {
    throw new Error(`ELEMENT_NOT_FOUND: 最高候选置信度 ${confidence} 低于阈值 ${threshold}`);
  }

  return {
    element: match.element,
    elementId: ensureElementId(match.element, 0),
    confidence,
    reasons: match.reasons
  };
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
    element = document.querySelector(`[${ELEMENT_ATTR}="${cssEscape(elementId)}"]`);
    // Fallback to temp ID if not found and elementId looks like a number
    if (!element && /^\d+$/.test(elementId)) {
      element = document.querySelector(`[data-bb-temp-id="${cssEscape(elementId)}"]`);
    }
  }

  // Playwright-style selector support
  if (!element && selector) {
    element = resolveSelector(selector);
  }

  if (!element && query) {
    element = findBestElement({ ...params, text: text ?? query });
  }
  if (!element && text && options.allowText !== false) {
    element = findByText(text);
  }
  if (!element && ariaLabel) {
    element = findByAttribute("aria-label", ariaLabel);
  }
  if (!element && placeholder) {
    element = findByAttribute("placeholder", placeholder);
  }
  if (!element && href) {
    element = findByHref(href);
  }
  if (!element && role) {
    element = findByRole(role, options.allowText === false ? undefined : text);
  }
  if (!element) {
    element = findBestElement(params);
  }

  if (!element || !(element instanceof HTMLElement)) {
    throw new Error("ELEMENT_NOT_FOUND: 未找到元素");
  }

  return element;
}

/**
 * 解析 Playwright 风格的选择器
 * 支持: text=, xpath=, role=, css=, id=, data-testid=
 */
function resolveSelector(selector: string): HTMLElement | null {
  try {
    // Support numeric ID directly from visual overlay
    if (/^\d+$/.test(selector)) {
      return document.querySelector(`[data-bb-temp-id="${cssEscape(selector)}"]`) as HTMLElement | null;
    }
    if (selector.startsWith("text=")) {
      return findByText(selector.slice(5));
    }
    if (selector.startsWith("xpath=")) {
      const result = document.evaluate(
        selector.slice(6),
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      const node = result.singleNodeValue;
      return node instanceof HTMLElement ? node : null;
    }
    if (selector.startsWith("role=")) {
      // 简化版 role 选择器: role=button[name="Submit"]
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
      return document.querySelector(`[data-testid="${cssEscape(selector.slice(12))}"]`) as HTMLElement | null;
    }

    // 默认作为 CSS 选择器
    const cleanSelector = selector.startsWith("css=") ? selector.slice(4) : selector;
    return document.querySelector(cleanSelector) as HTMLElement | null;
  } catch (error) {
    console.warn("[BrowserBridge] 选择器解析失败:", selector, error);
    return null;
  }
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

  return getActionableElements({ visibleOnly, viewportOnly }).map((element) => {
    const elementText = normalizeText(getElementText(element) ?? "");
    const elementRole = normalizeText(element.getAttribute("role") || inferRole(element));
    const elementAria = normalizeText(element.getAttribute("aria-label") ?? "");
    const elementTitle = normalizeText(element.getAttribute("title") ?? "");
    const elementPlaceholder = normalizeText(getPlaceholder(element) ?? "");
    const elementValue = normalizeText(getElementValue(element) ?? "");
    const elementHref = element instanceof HTMLAnchorElement ? element.href : undefined;
    const context = normalizeText(getNearbyText(element));
    let score = 0;
    const reasons: string[] = [];

    if (query) {
      score += scoreTextField(query, elementText, 0.62, "文本", reasons);
      score += scoreTextField(query, elementAria, 0.58, "aria-label", reasons);
      score += scoreTextField(query, elementPlaceholder, 0.56, "placeholder", reasons);
      score += scoreTextField(query, elementTitle, 0.46, "title", reasons);
      score += scoreTextField(query, elementValue, 0.28, "value", reasons);
      score += scoreTextField(query, context, 0.22, "附近文本", reasons);
    }

    if (role && elementRole === role) {
      score += 0.22;
      reasons.push("role 精确匹配");
    }
    if (ariaLabel) {
      score += scoreTextField(ariaLabel, elementAria, 0.5, "aria-label", reasons);
    }
    if (placeholder) {
      score += scoreTextField(placeholder, elementPlaceholder, 0.5, "placeholder", reasons);
    }
    if (href && (elementHref === href || element.getAttribute("href") === href)) {
      score += 0.5;
      reasons.push("href 精确匹配");
    }
    if (nearText) {
      score += scoreTextField(nearText, context, 0.24, "nearText", reasons);
    }
    if (isInViewport(element)) {
      score += 0.08;
      reasons.push("当前视口");
    }
    if (isDisabled(element)) {
      score -= 0.45;
      reasons.push("已禁用降权");
    }

    return { element, score, reasons };
  });
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

async function typeIntoElement(params: Record<string, unknown>): Promise<{ typed: boolean; element: BrowserElement }> {
  const element = await findTargetWithRetry(params, { allowText: true });
  const text = stringParam(params, "text") ?? "";
  const replace = params.replace === true;

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
async function ensureElementActionable(element: HTMLElement, timeoutMs: number = 3000): Promise<void> {
  const start = Date.now();
  let lastRect: DOMRect | undefined;
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    if (!isVisible(element)) {
      await delay(150);
      continue;
    }

    if (isDisabled(element)) {
      await delay(150);
      continue;
    }

    // 稳定性检查 (Check if element is moving)
    const currentRect = element.getBoundingClientRect();
    if (lastRect &&
        Math.abs(currentRect.top - lastRect.top) < 0.5 &&
        Math.abs(currentRect.left - lastRect.left) < 0.5 &&
        Math.abs(currentRect.width - lastRect.width) < 0.5 &&
        Math.abs(currentRect.height - lastRect.height) < 0.5) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastRect = currentRect;

    if (stableCount < 2) {
      await delay(100);
      continue;
    }

    // 遮挡检查 (Obscuration check)
    // 检查元素的中心点或四个角是否至少有一个是可点击的
    const points = [
      { x: currentRect.left + currentRect.width / 2, y: currentRect.top + currentRect.height / 2 },
      { x: currentRect.left + 2, y: currentRect.top + 2 },
      { x: currentRect.right - 2, y: currentRect.top + 2 },
      { x: currentRect.left + 2, y: currentRect.bottom - 2 },
      { x: currentRect.right - 2, y: currentRect.bottom - 2 }
    ];

    let isObscured = true;
    for (const point of points) {
      const topEl = document.elementFromPoint(point.x, point.y);
      if (topEl && (element === topEl || element.contains(topEl) || topEl.contains(element))) {
        isObscured = false;
        break;
      }
    }

    if (isObscured) {
      // 如果完全被遮挡，等待一会再试（可能是临时的 loading 层）
      await delay(200);
      continue;
    }

    return; // 准备就绪
  }
  throw new Error(`ACTION_TIMEOUT: 元素在 ${timeoutMs}ms 内未达到可交互状态（可能被遮挡、正在移动或不可见）`);
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

    const cleanup = (value: boolean) => {
      overlay.remove();
      resolve(value);
    };

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
} = {}): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const elements = Array.from(document.querySelectorAll<HTMLElement>(ACTIONABLE_SELECTOR))
    .filter((element) => {
      if (seen.has(element)) {
        return false;
      }
      seen.add(element);
      if (options.visibleOnly !== false && !isVisible(element)) {
        return false;
      }
      if (options.viewportOnly && !isInViewport(element)) {
        return false;
      }
      return true;
    });

  return elements.sort((a, b) => {
    const aViewport = isInViewport(a) ? 0 : 1;
    const bViewport = isInViewport(b) ? 0 : 1;
    if (aViewport !== bViewport) {
      return aViewport - bViewport;
    }
    const aRect = a.getBoundingClientRect();
    const bRect = b.getBoundingClientRect();
    return aRect.top - bRect.top || aRect.left - bRect.left;
  });
}

function getElementText(element: HTMLElement): string | undefined {
  const text = normalizeText(element.innerText || element.textContent || "");
  return text || undefined;
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

function accessibleName(element: HTMLElement): string | undefined {
  const labelledBy = element.getAttribute("aria-labelledby");
  const labelledByText = labelledBy
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
  const name = normalizeText(
    labelledByText ||
    element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    element.querySelector("h1,h2,h3,h4,h5,h6,legend")?.textContent ||
    ""
  );
  return truncate(name || undefined, 160);
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

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) !== 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
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
