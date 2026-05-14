import {
  type BridgeErrorCode,
  type BridgeRequest,
  type BridgeResponse
} from "@browser-bridge/shared";
import {
  DEFAULT_BRIDGE_URL,
  EXTENSION_VERSION,
  PROTOCOL_VERSION
} from "../shared/config.js";

let socket: WebSocket | undefined;
let reconnectTimer: number | undefined;
let currentBridgeUrl = DEFAULT_BRIDGE_URL;

void connect();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "offscreen_get_status") {
    sendResponse({
      connected: socket?.readyState === WebSocket.OPEN,
      bridgeUrl: currentBridgeUrl
    });
    return true;
  }

  if (message?.type === "offscreen_set_bridge_url") {
    currentBridgeUrl = normalizeBridgeUrl(String(message.bridgeUrl ?? ""));
    reconnectNow();
    sendResponse({ ok: true, bridgeUrl: currentBridgeUrl });
    return true;
  }

  return false;
});

async function connect(): Promise<void> {
  clearReconnect();
  currentBridgeUrl = await getBridgeUrl();
  socket = new WebSocket(currentBridgeUrl);

  socket.addEventListener("open", () => {
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
    publishStatus(false);
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
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
  socket?.send(JSON.stringify({ kind: "response", payload: response }));
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

async function getBridgeUrl(): Promise<string> {
  const stored = await chrome.storage.local.get("bridgeUrl");
  return typeof stored.bridgeUrl === "string" && stored.bridgeUrl.trim()
    ? stored.bridgeUrl.trim()
    : DEFAULT_BRIDGE_URL;
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
    bridgeUrl: currentBridgeUrl
  }).catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
