export type BridgeTool =
  | "browser_status"
  | "browser_get_active_tab"
  | "browser_get_page_text"
  | "browser_get_page_snapshot"
  | "browser_screenshot"
  | "browser_click"
  | "browser_list_tabs"
  | "browser_open_url"
  | "browser_activate_tab"
  | "browser_type"
  | "browser_clear"
  | "browser_scroll"
  | "browser_wait_for";

export type BridgeRequest = {
  id: string;
  tool: BridgeTool;
  params?: Record<string, unknown>;
  tabId?: number;
  timeoutMs?: number;
};

export type BridgeResponse<T = unknown> = {
  id: string;
  ok: boolean;
  data?: T;
  error?: BridgeError;
};

export type BridgeError = {
  code: BridgeErrorCode;
  message: string;
  details?: unknown;
};

export type BridgeErrorCode =
  | "BROWSER_NOT_CONNECTED"
  | "TAB_NOT_FOUND"
  | "TAB_NOT_ACTIVE"
  | "PERMISSION_DENIED"
  | "DOMAIN_NOT_ALLOWED"
  | "CONTENT_SCRIPT_NOT_READY"
  | "ELEMENT_NOT_FOUND"
  | "ELEMENT_NOT_VISIBLE"
  | "ELEMENT_DISABLED"
  | "ACTION_TIMEOUT"
  | "USER_CONFIRMATION_REQUIRED"
  | "USER_REJECTED"
  | "UNSUPPORTED_PAGE"
  | "INVALID_PARAMS"
  | "INTERNAL_ERROR";

export type ExtensionHello = {
  type: "extension_hello";
  extensionVersion: string;
  protocolVersion: string;
};

export type BridgeEnvelope =
  | { kind: "hello"; payload: ExtensionHello }
  | { kind: "request"; payload: BridgeRequest }
  | { kind: "response"; payload: BridgeResponse }
  | { kind: "event"; payload: BridgeEvent };

export type BridgeEvent =
  | { type: "extension_connected"; at: string }
  | { type: "extension_disconnected"; at: string }
  | { type: "heartbeat"; at: string };

export const PROTOCOL_VERSION = "0.1.0";
