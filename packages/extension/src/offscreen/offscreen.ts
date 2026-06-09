import {
  type BridgeErrorCode,
  type BridgeRequest,
  type BridgeResponse
} from "@majuntao-1/browser-bridge-shared";
import {
  DEFAULT_BRIDGE_URL,
  EXTENSION_VERSION,
  PROTOCOL_VERSION
} from "../shared/config.js";

let socket: WebSocket | undefined;
let reconnectTimer: number | undefined;
let heartbeatTimer: number | undefined;
let pongTimer: number | undefined;
let currentBridgeUrl = DEFAULT_BRIDGE_URL;
let lastError = "";
let lastEventAt = "";
let connecting = false;

/** 指数退避重连：当前重连尝试次数 */
let reconnectAttempt = 0;
/** 最大重连延迟（ms） */
const MAX_RECONNECT_DELAY = 30_000;
/** 心跳间隔（ms） */
const HEARTBEAT_INTERVAL = 10_000;
/** 等待 pong 的超时（ms） */
const PONG_TIMEOUT = 5_000;

/** 断连期间的请求队列 */
const pendingRequests: Array<{
  request: BridgeRequest;
  resolve: (response: BridgeResponse) => void;
}> = [];
const MAX_QUEUE_SIZE = 100;

void connect();
startHeartbeat();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "offscreen_get_status") {
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      void connect();
    }
    sendResponse({
      connected: socket?.readyState === WebSocket.OPEN,
      bridgeUrl: currentBridgeUrl,
      readyState: getDisplayReadyState(),
      lastError,
      lastEventAt,
      pendingRequests: pendingRequests.length
    });
    return true;
  }

  if (message?.type === "offscreen_set_bridge_url") {
    const nextBridgeUrl = normalizeBridgeUrl(String(message.bridgeUrl ?? ""));
    if (nextBridgeUrl === currentBridgeUrl && socket?.readyState === WebSocket.OPEN) {
      sendResponse({ ok: true, bridgeUrl: currentBridgeUrl, unchanged: true });
      return true;
    }
    currentBridgeUrl = nextBridgeUrl;
    reconnectNow();
    sendResponse({ ok: true, bridgeUrl: currentBridgeUrl });
    return true;
  }

  return false;
});

async function connect(): Promise<void> {
  if (connecting) {
    return;
  }
  clearReconnect();
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  connecting = true;
  lastError = "";
  markEvent();
  publishStatus(false);

  try {
    socket = new WebSocket(currentBridgeUrl);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    connecting = false;
    markEvent();
    publishStatus(false);
    scheduleReconnect();
    return;
  }

  socket.addEventListener("open", () => {
    connecting = false;
    lastError = "";
    reconnectAttempt = 0; // 连接成功，重置退避计数
    markEvent();
    publishStatus(true);
    socket?.send(JSON.stringify({
      kind: "hello",
      payload: {
        type: "extension_hello",
        extensionVersion: EXTENSION_VERSION,
        protocolVersion: PROTOCOL_VERSION
      }
    }));

    // 刷新断连期间排队的请求
    flushPendingRequests();
  });

  socket.addEventListener("message", (event) => {
    void handleSocketMessage(String(event.data));
  });

  socket.addEventListener("close", () => {
    connecting = false;
    lastError = "WebSocket 已关闭，正在重连";
    markEvent();
    publishStatus(false);
    socket = undefined;
    clearPongTimer();
    scheduleReconnect();
  });

  socket.addEventListener("error", (event) => {
    connecting = false;
    lastError = `WebSocket 连接失败：${String(event.type)}`;
    markEvent();
    publishStatus(false);
  });
}

async function handleSocketMessage(raw: string): Promise<void> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return;
  }

  if (!isRecord(envelope)) return;

  // 处理 pong 响应（应用层心跳）
  if (envelope.kind === "pong" || envelope.type === "pong") {
    clearPongTimer();
    return;
  }

  if (envelope.kind !== "request" || !isRecord(envelope.payload)) {
    return;
  }

  const request = envelope.payload as BridgeRequest;
  const response = await sendRequestToBackground(request);
  const responsePayload = JSON.stringify({ kind: "response", payload: response });
  socket?.send(responsePayload);
}

async function sendRequestToBackground(request: BridgeRequest): Promise<BridgeResponse> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "offscreen_bridge_request",
      request
    });
    return response as BridgeResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: request.id,
      ok: false,
      error: {
        code: "INTERNAL_ERROR" as BridgeErrorCode,
        message
      }
    };
  }
}

function reconnectNow(): void {
  clearReconnect();
  clearPongTimer();
  reconnectAttempt = 0;
  socket?.close(1000, "Bridge URL updated");
  void connect();
}

/**
 * 指数退避重连调度
 *
 * 延迟序列：1s, 2s, 4s, 8s, 16s, 30s (max)
 * 加 10% 随机抖动避免惊群效应
 */
function scheduleReconnect(): void {
  clearReconnect();
  const baseDelay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
  const jitter = baseDelay * 0.1 * Math.random();
  const delay = baseDelay + jitter;
  reconnectAttempt++;

  reconnectTimer = window.setTimeout(() => {
    void connect();
  }, delay);
}

function clearReconnect(): void {
  if (reconnectTimer !== undefined) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
}

/**
 * 应用层心跳：定期发送 ping，等待 pong 响应
 *
 * 如果在 PONG_TIMEOUT 内未收到 pong，判定为死连接并重连。
 */
function startHeartbeat(): void {
  if (heartbeatTimer !== undefined) {
    return;
  }
  heartbeatTimer = window.setInterval(() => {
    if (socket?.readyState !== WebSocket.OPEN) {
      void connect();
      return;
    }

    // 发送 ping
    try {
      socket.send(JSON.stringify({ kind: "ping", ts: Date.now() }));
    } catch {
      // 发送失败，连接已断开
      socket.close();
      return;
    }

    // 设置 pong 超时
    clearPongTimer();
    pongTimer = window.setTimeout(() => {
      console.warn("[BrowserBridge] No pong received, reconnecting...");
      socket?.close();
    }, PONG_TIMEOUT);
  }, HEARTBEAT_INTERVAL);
}

function clearPongTimer(): void {
  if (pongTimer !== undefined) {
    window.clearTimeout(pongTimer);
    pongTimer = undefined;
  }
}

/**
 * 将断连期间排队的请求刷新到新连接
 */
function flushPendingRequests(): void {
  if (pendingRequests.length === 0 || !socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const queued = pendingRequests.splice(0);
  for (const { request, resolve } of queued) {
    // 重新发送请求
    const envelope = JSON.stringify({ kind: "request", payload: request });
    socket.send(envelope);

    // 注意：这里简化处理，实际应注册 pending response handler
    // 对于排队请求，返回一个超时提示让调用方重试
    resolve({
      id: request.id,
      ok: false,
      error: {
        code: "CONNECTION_LOST" as BridgeErrorCode,
        message: "请求在断连期间排队，已重新发送，请重试"
      }
    });
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

function publishStatus(connected: boolean): void {
  void chrome.runtime.sendMessage({
    type: "offscreen_status",
    connected,
    bridgeUrl: currentBridgeUrl,
    readyState: getDisplayReadyState(),
    lastError,
    lastEventAt,
    pendingRequests: pendingRequests.length
  }).catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getReadyState(value: number | undefined): string {
  switch (value) {
    case WebSocket.CONNECTING:
      return "CONNECTING";
    case WebSocket.OPEN:
      return "OPEN";
    case WebSocket.CLOSING:
      return "CLOSING";
    case WebSocket.CLOSED:
      return "CLOSED";
    default:
      return "未创建";
  }
}

function getDisplayReadyState(): string {
  if (socket?.readyState === WebSocket.OPEN) {
    return "OPEN";
  }
  return connecting ? "初始化中" : getReadyState(socket?.readyState);
}

function markEvent(): void {
  lastEventAt = new Date().toISOString();
}
