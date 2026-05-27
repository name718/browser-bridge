export type BridgeTool =
  | "browser_status"
  | "browser_get_active_tab"
  | "browser_get_page_text"
  | "browser_get_page_snapshot"
  | "browser_get_page_model"
  | "browser_get_interactives"
  | "browser_find"
  | "browser_act"
  | "browser_find_and_click"
  | "browser_find_and_type"
  | "browser_fill_form"
  | "browser_hover"
  | "browser_press_key"
  | "browser_assert_text"
  | "browser_get_selected_text"
  | "browser_get_links"
  | "browser_get_audit_log"
  | "browser_screenshot"
  | "browser_save_screenshot"
  | "browser_click"
  | "browser_list_tabs"
  | "browser_open_url"
  | "browser_activate_tab"
  | "browser_type"
  | "browser_clear"
  | "browser_scroll"
  | "browser_wait_for"
  | "browser_get_ax_tree"
  | "browser_wait_for_request"
  | "browser_console_monitor"
  | "browser_run_steps"
  | "browser_pdf"
  | "browser_save_pdf"
  | "browser_capture_page"
  | "browser_evaluate"
  | "browser_cdp"
  | "browser_cdp_session"
  | "browser_responsive"
  | "browser_network_analysis";

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
  | "INTERNAL_ERROR"
  | "DEBUGGER_BUSY";

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
