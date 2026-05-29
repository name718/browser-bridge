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
let currentBridgeUrl = DEFAULT_BRIDGE_URL;
let lastError = "";
let lastEventAt = "";
let connecting = false;

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
      lastEventAt
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

  if (!isRecord(envelope) || envelope.kind !== "request" || !isRecord(envelope.payload)) {
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
  socket?.close(1000, "Bridge URL updated");
  void connect();
}

function scheduleReconnect(): void {
  clearReconnect();
  reconnectTimer = window.setTimeout(() => {
    void connect();
  }, 1500);
}

function clearReconnect(): void {
  if (reconnectTimer !== undefined) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
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
    lastEventAt
  }).catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function startHeartbeat(): void {
  if (heartbeatTimer !== undefined) {
    return;
  }
  heartbeatTimer = window.setInterval(() => {
    if (socket?.readyState !== WebSocket.OPEN) {
      void connect();
    }
  }, 20_000);
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
