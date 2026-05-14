import {
  type BrowserTab,
  type BridgeErrorCode,
  type BridgeRequest,
  type BridgeResponse
} from "@browser-bridge/shared";
import { BRIDGE_URL, EXTENSION_VERSION } from "../shared/config.js";
import {
  assertActionAllowed,
  assertUrlAllowed,
  getActionRisk,
  getSecurityConfig
} from "./security.js";
import { appendAuditLog, getAuditLog } from "./audit.js";

const PROTOCOL_VERSION = "0.1.0";
let socket: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
let connected = false;

connect();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "popup_status") {
    void getSecurityConfig().then((security) => {
      void getAuditLog(8).then((audit) => {
        sendResponse({ connected, bridgeUrl: BRIDGE_URL, security, audit });
      });
    });
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

function connect(): void {
  clearReconnect();

  socket = new WebSocket(BRIDGE_URL);

  socket.addEventListener("open", () => {
    connected = true;
    socket?.send(JSON.stringify({
      kind: "hello",
      payload: {
        type: "extension_hello",
        extensionVersion: EXTENSION_VERSION,
        protocolVersion: PROTOCOL_VERSION
      }
    }));
  });

  socket.addEventListener("message", (event) => {
    void handleSocketMessage(String(event.data));
  });

  socket.addEventListener("close", () => {
    connected = false;
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    connected = false;
  });
}

async function handleSocketMessage(raw: string): Promise<void> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return;
  }

  if (!isRecord(envelope) || envelope.kind !== "request" || !isRecord(envelope.payload)) {
    return;
  }

  const request = envelope.payload as BridgeRequest;
  const response = await handleBridgeRequest(request);
  socket?.send(JSON.stringify({ kind: "response", payload: response }));
}

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
    case "browser_get_selected_text":
    case "browser_get_links":
      return sendToContentScript(request);
    case "browser_get_audit_log":
      return getAuditLog(typeof request.params?.limit === "number" ? request.params.limit : 20);
    case "browser_screenshot":
    case "browser_click":
    case "browser_type":
    case "browser_clear":
    case "browser_scroll":
    case "browser_wait_for":
      return sendToContentScript(request);
    default:
      throw new Error(`INTERNAL_ERROR: 不支持的工具 ${request.tool}`);
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

function scheduleReconnect(): void {
  clearReconnect();
  reconnectTimer = globalThis.setTimeout(connect, 1500);
}

function clearReconnect(): void {
  if (reconnectTimer !== undefined) {
    globalThis.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
