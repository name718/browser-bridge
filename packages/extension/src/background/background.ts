import {
  type BrowserTab,
  type BrowserRunStepsResult,
  type BrowserStep,
  type BrowserStepAction,
  type BrowserStepResult,
  type BridgeErrorCode,
  type BridgeRequest,
  type BridgeResponse
} from "@browser-bridge/shared";
import { DEFAULT_BRIDGE_URL } from "../shared/config.js";
import {
  assertActionAllowed,
  assertUrlAllowed,
  getActionRisk,
  getSecurityConfig
} from "./security.js";
import { appendAuditLog, getAuditLog } from "./audit.js";

let connected = false;
let currentBridgeUrl = DEFAULT_BRIDGE_URL;
let lastBridgeError = "";
let offscreenCreation: Promise<void> | undefined;

void ensureOffscreenDocument();
setupKeepalive();

chrome.runtime.onStartup.addListener(() => {
  void ensureOffscreenDocument();
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureOffscreenDocument();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "popup_status") {
    void getPopupStatus().then(sendResponse);
    return true;
  }
  if (message?.type === "popup_save_bridge") {
    void setBridgeUrl(String(message.bridgeUrl ?? "")).then(() => {
      sendResponse({ ok: true, bridgeUrl: currentBridgeUrl });
    });
    return true;
  }
  if (message?.type === "offscreen_status") {
    connected = Boolean(message.connected);
    currentBridgeUrl = typeof message.bridgeUrl === "string" ? message.bridgeUrl : currentBridgeUrl;
    lastBridgeError = typeof message.lastError === "string" ? message.lastError : "";
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "offscreen_bridge_request") {
    void handleBridgeRequest(message.request as BridgeRequest).then(sendResponse);
    return true;
  }
  if (message?.type === "popup_save_security") {
    void chrome.storage.local.set(message.security ?? {}).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
  return false;
});

async function handleBridgeRequest(request: BridgeRequest): Promise<BridgeResponse> {
  try {
    const data = await dispatchRequest(request);
    return { id: request.id, ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const [code, detail] = message.includes(": ")
      ? message.split(/: (.*)/s, 2)
      : ["INTERNAL_ERROR", message];
    return {
      id: request.id,
      ok: false,
      error: {
        code: code as BridgeErrorCode,
        message: detail || message
      }
    };
  }
}

async function dispatchRequest(request: BridgeRequest): Promise<unknown> {
  switch (request.tool) {
    case "browser_get_active_tab":
      return getActiveTab();
    case "browser_list_tabs":
      return listTabs();
    case "browser_open_url":
      return openUrl(String(request.params?.url ?? ""));
    case "browser_activate_tab":
      return activateTab(Number(request.params?.tabId));
    case "browser_get_page_text":
    case "browser_get_page_snapshot":
    case "browser_get_interactives":
    case "browser_find":
    case "browser_act":
    case "browser_assert_text":
    case "browser_get_selected_text":
    case "browser_get_links":
      return sendToContentScript(request);
    case "browser_get_audit_log":
      return getAuditLog(typeof request.params?.limit === "number" ? request.params.limit : 20);
    case "browser_run_steps":
      return runSteps(request);
    case "browser_screenshot":
    case "browser_click":
    case "browser_find_and_click":
    case "browser_find_and_type":
    case "browser_fill_form":
    case "browser_hover":
    case "browser_press_key":
    case "browser_type":
    case "browser_clear":
    case "browser_scroll":
    case "browser_wait_for":
      return sendToContentScript(request);
    default:
      throw new Error(`INTERNAL_ERROR: 不支持的工具 ${request.tool}`);
  }
}

async function runSteps(request: BridgeRequest): Promise<BrowserRunStepsResult> {
  const params = isRecord(request.params) ? request.params : {};
  const steps = Array.isArray(params.steps) ? params.steps : undefined;
  if (!steps?.length) {
    throw new Error("INVALID_PARAMS: steps 参数必填");
  }
  if (steps.length > 50) {
    throw new Error("INVALID_PARAMS: steps 最多支持 50 步");
  }

  let currentTabId = request.tabId ?? numberParam(params, "tabId");
  const stopOnError = params.stopOnError !== false;
  const defaultDelayMs = numberParam(params, "delayMs") ?? 0;
  const screenshotOnError = params.screenshotOnError === true;
  const results: BrowserStepResult[] = [];

  for (const [index, rawStep] of steps.entries()) {
    if (!isRecord(rawStep)) {
      const result = makeStepError(index, "sleep", undefined, "INVALID_PARAMS", "步骤必须是对象", 0, currentTabId);
      results.push(result);
      if (stopOnError) {
        return { ok: false, stoppedAt: index, tabId: currentTabId, results };
      }
      continue;
    }

    const startedAt = Date.now();
    let action: BrowserStepAction = "sleep";
    const description = stringParam(rawStep, "description");
    try {
      action = parseStepAction(rawStep.action);
      const step = rawStep as BrowserStep;
      const data = await runStep(step, currentTabId);
      currentTabId = extractTabId(data) ?? numberParam(rawStep, "tabId") ?? currentTabId;
      results.push({
        index,
        action,
        description,
        ok: true,
        elapsedMs: Date.now() - startedAt,
        tabId: currentTabId,
        data: sanitizeStepData(action, data)
      });

      const delayMs = numberParam(rawStep, "delayMs") ?? defaultDelayMs;
      if (delayMs > 0) {
        await delay(delayMs);
      }
    } catch (error) {
      const { code, message } = normalizeError(error);
      const errorScreenshot = screenshotOnError
        ? await takeErrorScreenshot(currentTabId)
        : undefined;
      results.push(makeStepError(
        index,
        action,
        description,
        code,
        message,
        Date.now() - startedAt,
        currentTabId,
        errorScreenshot
      ));
      if (stopOnError) {
        return { ok: false, stoppedAt: index, tabId: currentTabId, results };
      }
    }
  }

  return { ok: results.every((result) => result.ok), tabId: currentTabId, results };
}

async function runStep(step: BrowserStep, currentTabId?: number): Promise<unknown> {
  switch (step.action) {
    case "open":
      if (!step.url) {
        throw new Error("INVALID_PARAMS: open 步骤需要 url");
      }
      return openUrl(step.url);
    case "activateTab":
      return activateTab(requiredTabId(step, currentTabId));
    case "click":
      return sendToContentScript(stepRequest("browser_find_and_click", step, currentTabId, targetParams(step)));
    case "hover":
      return sendToContentScript(stepRequest("browser_hover", step, currentTabId, targetParams(step)));
    case "type":
      return sendToContentScript(stepRequest("browser_find_and_type", step, currentTabId, {
        ...targetParams(step),
        text: step.value ?? step.text,
        replace: step.replace
      }));
    case "fillForm":
      return sendToContentScript(stepRequest("browser_fill_form", step, currentTabId, {
        fields: step.fields,
        timeoutMs: step.timeoutMs
      }));
    case "clear":
      return sendToContentScript(stepRequest("browser_clear", step, currentTabId, targetParams(step)));
    case "scroll":
      return sendToContentScript(stepRequest("browser_scroll", step, currentTabId, {
        direction: step.direction ?? "down",
        amount: step.amount
      }));
    case "waitFor":
      return sendToContentScript(stepRequest("browser_wait_for", step, currentTabId, targetParams(step)));
    case "pressKey":
      return sendToContentScript(stepRequest("browser_press_key", step, currentTabId, { key: step.key }));
    case "assertText":
      return sendToContentScript(stepRequest("browser_assert_text", step, currentTabId, {
        text: step.text,
        contains: step.contains
      }));
    case "getText":
      return sendToContentScript(stepRequest("browser_get_page_text", step, currentTabId, {}));
    case "snapshot":
      return sendToContentScript(stepRequest("browser_get_page_snapshot", step, currentTabId, {}));
    case "screenshot":
      return sendToContentScript(stepRequest("browser_screenshot", step, currentTabId, {
        format: step.format,
        quality: step.quality
      }));
    case "sleep":
      await delay(step.delayMs ?? step.timeoutMs ?? 500);
      return { slept: true };
    default:
      throw new Error(`INVALID_PARAMS: 不支持的步骤动作 ${(step as BrowserStep).action}`);
  }
}

async function getActiveTab(): Promise<BrowserTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("TAB_NOT_ACTIVE: 未找到活动标签页");
  }
  return normalizeTab(tab);
}

async function listTabs(): Promise<BrowserTab[]> {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => tab.id).map(normalizeTab);
}

async function openUrl(url: string): Promise<BrowserTab> {
  if (!url) {
    throw new Error("INVALID_PARAMS: url 参数必填");
  }
  await assertUrlAllowed(url);
  const tab = await chrome.tabs.create({ url, active: true });
  return normalizeTab(tab);
}

async function activateTab(tabId: number): Promise<BrowserTab> {
  if (!Number.isFinite(tabId)) {
    throw new Error("INVALID_PARAMS: tabId 参数必填");
  }
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (!tab) {
    throw new Error("TAB_NOT_FOUND: 未找到标签页");
  }
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return normalizeTab(tab);
}

async function sendToContentScript(request: BridgeRequest): Promise<unknown> {
  const requestedTabId = request.tabId ?? Number(request.params?.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) {
    throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");
  }

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  const confirmedHighRisk = await confirmHighRiskAction(tabId, request);

  if (request.tool === "browser_screenshot") {
    return captureScreenshot(tab, request);
  }

  try {
    await ensureContentScript(tabId);
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "browser_bridge_request",
      request: {
        ...request,
        tabId,
        params: {
          ...(isRecord(request.params) ? request.params : {}),
          __confirmedHighRisk: confirmedHighRisk
        }
      }
    });

    if (!response?.ok) {
      const code = response?.error?.code ?? "INTERNAL_ERROR";
      const message = response?.error?.message ?? "页面脚本请求失败";
      throw new Error(`${code}: ${message}`);
    }

    await appendAuditLog({ tool: request.tool, url: tab.url, ok: true });

    if (response.data && typeof response.data === "object" && "tabId" in response.data) {
      return { ...response.data, tabId };
    }

    return response.data;
  } catch (error) {
    if (error instanceof Error && !error.message.includes(": 页面脚本请求失败")) {
      await appendAuditLog({
        tool: request.tool,
        url: tab.url,
        ok: false,
        errorCode: error.message.split(":", 1)[0]
      });
    }
    throw error;
  }
}

async function confirmHighRiskAction(tabId: number, request: BridgeRequest): Promise<boolean> {
  try {
    await assertActionAllowed(request);
    return false;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("USER_CONFIRMATION_REQUIRED:")) {
      throw error;
    }
  }

  const risk = await getActionRisk(request);
  const confirmed = await confirmInPage(tabId, risk.reason ?? "高风险浏览器操作需要确认");
  if (!confirmed) {
    throw new Error("USER_REJECTED: 用户已取消高风险浏览器操作");
  }
  return true;
}

async function confirmInPage(tabId: number, reason: string): Promise<boolean> {
  await ensureContentScript(tabId);
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "browser_bridge_confirm",
    reason
  });
  return Boolean(response?.confirmed);
}

async function captureScreenshot(
  tab: chrome.tabs.Tab,
  request: BridgeRequest
): Promise<Record<string, unknown>> {
  if (!tab.id) {
    throw new Error("TAB_NOT_FOUND: 标签页没有 ID");
  }

  const params = isRecord(request.params) ? request.params : {};
  const requestedFormat = params.format === "jpeg" ? "jpeg" : "png";
  const quality = typeof params.quality === "number" ? params.quality : undefined;
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: requestedFormat,
    quality
  });

  await appendAuditLog({ tool: request.tool, url: tab.url, ok: true });

  return {
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    mimeType: requestedFormat === "jpeg" ? "image/jpeg" : "image/png",
    dataUrl
  };
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "browser_bridge_ping" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  }
}

function normalizeTab(tab: chrome.tabs.Tab): BrowserTab {
  if (!tab.id) {
    throw new Error("TAB_NOT_FOUND: 标签页没有 ID");
  }
  return {
    id: tab.id,
    windowId: tab.windowId,
    active: Boolean(tab.active),
    title: tab.title,
    url: tab.url
  };
}

function parseStepAction(value: unknown): BrowserStepAction {
  const allowed: BrowserStepAction[] = [
    "open",
    "activateTab",
    "click",
    "hover",
    "type",
    "fillForm",
    "clear",
    "scroll",
    "waitFor",
    "pressKey",
    "assertText",
    "getText",
    "snapshot",
    "screenshot",
    "sleep"
  ];
  if (typeof value === "string" && allowed.includes(value as BrowserStepAction)) {
    return value as BrowserStepAction;
  }
  throw new Error("INVALID_PARAMS: action 不支持或缺失");
}

function targetParams(step: BrowserStep): Record<string, unknown> {
  const target = isRecord(step.target) ? step.target : {};
  return {
    query: step.query ?? target.query,
    elementId: step.elementId ?? target.elementId,
    selector: step.selector ?? target.selector,
    text: step.text ?? target.text,
    role: step.role ?? target.role,
    ariaLabel: step.ariaLabel ?? target.ariaLabel,
    placeholder: step.placeholder ?? target.placeholder,
    href: step.href ?? target.href,
    nearText: step.nearText ?? target.nearText,
    visibleOnly: step.visibleOnly,
    viewportOnly: step.viewportOnly
  };
}

function stepRequest(
  tool: BridgeRequest["tool"],
  step: BrowserStep,
  currentTabId: number | undefined,
  params: Record<string, unknown>
): BridgeRequest {
  return {
    id: crypto.randomUUID(),
    tool,
    tabId: step.tabId ?? currentTabId,
    timeoutMs: step.timeoutMs,
    params: {
      ...params,
      tabId: step.tabId ?? currentTabId,
      timeoutMs: step.timeoutMs
    }
  };
}

function requiredTabId(step: BrowserStep, currentTabId: number | undefined): number {
  const tabId = step.tabId ?? currentTabId;
  if (!tabId) {
    throw new Error("INVALID_PARAMS: activateTab 步骤需要 tabId");
  }
  return tabId;
}

function extractTabId(data: unknown): number | undefined {
  if (isRecord(data) && typeof data.tabId === "number") {
    return data.tabId;
  }
  if (isRecord(data) && typeof data.id === "number") {
    return data.id;
  }
  return undefined;
}

function sanitizeStepData(action: BrowserStepAction, data: unknown): unknown {
  if (action === "screenshot" && isRecord(data)) {
    return {
      tabId: data.tabId,
      url: data.url,
      title: data.title,
      mimeType: data.mimeType,
      dataUrlLength: typeof data.dataUrl === "string" ? data.dataUrl.length : undefined
    };
  }
  return data;
}

function makeStepError(
  index: number,
  action: BrowserStepAction,
  description: string | undefined,
  code: string,
  message: string,
  elapsedMs: number,
  tabId?: number,
  data?: unknown
): BrowserStepResult {
  return {
    index,
    action,
    description,
    ok: false,
    elapsedMs,
    tabId,
    data,
    error: { code, message }
  };
}

async function takeErrorScreenshot(tabId?: number): Promise<unknown> {
  try {
    const id = tabId ?? (await getActiveTab()).id;
    const tab = await chrome.tabs.get(id);
    return sanitizeStepData("screenshot", await captureScreenshot(tab, {
      id: crypto.randomUUID(),
      tool: "browser_screenshot",
      tabId: id,
      params: { format: "png" }
    }));
  } catch {
    return undefined;
  }
}

function normalizeError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(": ")) {
    const [code, detail] = message.split(/: (.*)/s, 2);
    return { code, message: detail || message };
  }
  return { code: "INTERNAL_ERROR", message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function numberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPopupStatus(): Promise<Record<string, unknown>> {
  currentBridgeUrl = await getBridgeUrl();
  await ensureOffscreenDocument();
  await syncBridgeUrlToOffscreen();
  const [security, audit, offscreenStatus] = await Promise.all([
    getSecurityConfig(),
    getAuditLog(8),
    getOffscreenStatus()
  ]);

  connected = Boolean(offscreenStatus.connected);
  currentBridgeUrl = offscreenStatus.bridgeUrl ?? currentBridgeUrl;
  lastBridgeError = offscreenStatus.lastError ?? lastBridgeError;
  return {
    connected,
    bridgeUrl: currentBridgeUrl,
    lastError: lastBridgeError,
    readyState: offscreenStatus.readyState,
    security,
    audit
  };
}

async function getOffscreenStatus(): Promise<{
  connected: boolean;
  bridgeUrl?: string;
  lastError?: string;
  readyState?: string;
}> {
  try {
    const status = await chrome.runtime.sendMessage({ type: "offscreen_get_status" });
    return {
      connected: Boolean(status?.connected),
      bridgeUrl: typeof status?.bridgeUrl === "string" ? status.bridgeUrl : undefined,
      lastError: typeof status?.lastError === "string" ? status.lastError : undefined,
      readyState: typeof status?.readyState === "string" ? status.readyState : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordBridgeError(`读取 offscreen 状态失败：${message}`);
    return { connected, bridgeUrl: currentBridgeUrl, lastError: lastBridgeError };
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenCreation) {
    return offscreenCreation;
  }

  offscreenCreation = createOffscreenDocument();
  try {
    await offscreenCreation;
  } finally {
    offscreenCreation = undefined;
  }
}

async function createOffscreenDocument(): Promise<void> {
  const offscreen = chrome.offscreen;
  if (!offscreen) {
    recordBridgeError("当前 Chrome 不支持 offscreen API，请升级 Chrome 后重试");
    return;
  }

  try {
    const hasDocument = await offscreen.hasDocument();
    if (hasDocument) {
      return;
    }

    await offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
      justification: "保持浏览器桥接 WebSocket 连接"
    });
    recordBridgeError("");
    await syncBridgeUrlToOffscreen();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordBridgeError(`创建 offscreen 连接页失败：${message}`);
  }
}

async function getBridgeUrl(): Promise<string> {
  const stored = await chrome.storage.local.get("bridgeUrl");
  return typeof stored.bridgeUrl === "string" && stored.bridgeUrl.trim()
    ? stored.bridgeUrl.trim()
    : DEFAULT_BRIDGE_URL;
}

async function setBridgeUrl(value: string): Promise<void> {
  const normalized = normalizeBridgeUrl(value);
  await chrome.storage.local.set({ bridgeUrl: normalized });
  currentBridgeUrl = normalized;
  await ensureOffscreenDocument();
  await syncBridgeUrlToOffscreen();
}

async function syncBridgeUrlToOffscreen(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: "offscreen_set_bridge_url",
      bridgeUrl: currentBridgeUrl
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordBridgeError(`通知 offscreen 重连失败：${message}`);
  }
}

function normalizeBridgeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_BRIDGE_URL;
  }
  if (!/^wss?:\/\//.test(trimmed)) {
    return `ws://${trimmed}`;
  }
  return trimmed;
}

function setupKeepalive(): void {
  chrome.alarms.create("browser-bridge-keepalive", { periodInMinutes: 0.4 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "browser-bridge-keepalive") {
      void ensureOffscreenDocument();
    }
  });
}

function recordBridgeError(message: string): void {
  lastBridgeError = message;
  void chrome.storage.local.set({ bridgeLastError: message });
  if (message) {
    console.warn(`[浏览器桥接] ${message}`);
  }
}
