import {
  type BrowserElement,
  type BrowserFindResult,
  type BridgeRequest,
  type PageSnapshot
} from "@browser-bridge/shared";

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "browser_bridge_ping") {
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

  void handleRequest(message.request as BridgeRequest)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const [code, detail] = message.includes(": ")
        ? message.split(/: (.*)/s, 2)
        : ["INTERNAL_ERROR", message];
      sendResponse({
        ok: false,
        error: {
          code,
          message: detail || message
        }
      });
    });
  return true;
});

async function handleRequest(request: BridgeRequest): Promise<unknown> {
  switch (request.tool) {
    case "browser_get_page_text":
      return getVisibleText();
    case "browser_get_page_snapshot":
      return getPageSnapshot();
    case "browser_get_interactives":
      return getInteractives(request.params ?? {});
    case "browser_find":
      return findElements(request.params ?? {});
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
  const elements = getActionableElements({ visibleOnly: true })
    .slice(0, 300)
    .map(toBrowserElement);

  return {
    tabId: -1,
    url: location.href,
    title: document.title,
    text: getVisibleText(),
    elements
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

function getVisibleText(): string {
  const text = document.body?.innerText ?? "";
  return text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 120_000);
}

function toBrowserElement(element: HTMLElement, index: number): BrowserElement {
  const elementId = ensureElementId(element, index);
  const rect = element.getBoundingClientRect();
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
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    }
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

async function findTargetWithRetry(
  params: Record<string, unknown>,
  options: { allowText?: boolean; timeoutMs?: number } = {}
): Promise<HTMLElement> {
  const timeoutMs = options.timeoutMs ?? numberParam(params, "timeoutMs") ?? 1200;
  const start = Date.now();
  let lastError: unknown;

  while (Date.now() - start <= timeoutMs) {
    try {
      return findTarget(params, options);
    } catch (error) {
      lastError = error;
      await delay(80);
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
  }
  if (!element && selector) {
    element = document.querySelector(selector);
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
  if (!isVisible(element)) {
    throw new Error("ELEMENT_NOT_VISIBLE: 元素不可见");
  }
  if (isDisabled(element)) {
    throw new Error("ELEMENT_DISABLED: 元素已禁用");
  }
  return element;
}

function findBestElement(params: Record<string, unknown>): HTMLElement | null {
  return scoreElements(params)
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.element ?? null;
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
  element.scrollIntoView({ block: "center", inline: "center" });
  await delay(30);
  dispatchPointerEvent(element, "mouseover");
  dispatchPointerEvent(element, "mousemove");
  dispatchPointerEvent(element, "mousedown");
  element.click();
  dispatchPointerEvent(element, "mouseup");
  return { clicked: true, element: toBrowserElement(element, 0) };
}

async function hoverElement(params: Record<string, unknown>): Promise<{ hovered: boolean; element: BrowserElement }> {
  const element = await findTargetWithRetry(params, { allowText: true });
  element.scrollIntoView({ block: "center", inline: "center" });
  await delay(30);
  dispatchPointerEvent(element, "mouseover");
  dispatchPointerEvent(element, "mouseenter");
  dispatchPointerEvent(element, "mousemove");
  return { hovered: true, element: toBrowserElement(element, 0) };
}

async function assertElementClickSafe(element: HTMLElement): Promise<void> {
  const text = [
    getElementText(element),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("value")
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  if (HIGH_RISK_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
    const confirmed = await showConfirmationOverlay(`点击目标看起来是高风险操作。\n\n${text}`);
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

async function typeIntoElement(params: Record<string, unknown>): Promise<{ typed: boolean; element: BrowserElement }> {
  const element = await findTargetWithRetry(params, { allowText: false });
  const text = stringParam(params, "text");
  if (!text) {
    throw new Error("INVALID_PARAMS: text 参数必填");
  }
  setElementValue(element, text, params.replace === true);
  return { typed: true, element: toBrowserElement(element, 0) };
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
  const timeoutMs = numberParam(params, "timeoutMs");
  for (const [index, field] of fields.entries()) {
    if (!isRecord(field) || typeof field.value !== "string") {
      results.push({ index, ok: false, error: "字段必须包含 value" });
      continue;
    }
    try {
      const element = await findTargetWithRetry(field, { allowText: false, timeoutMs });
      setElementValue(element, field.value, field.replace !== false);
      results.push({ index, ok: true, element: toBrowserElement(element, index) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ index, ok: false, error: message });
    }
  }

  const failed = results.find((result) => !result.ok);
  if (failed) {
    throw new Error(`ELEMENT_NOT_FOUND: 表单第 ${failed.index + 1} 项填写失败：${failed.error}`);
  }

  return { filled: true, fields: results };
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
