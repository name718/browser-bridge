export type BrowserTab = {
  id: number;
  windowId?: number;
  active: boolean;
  title?: string;
  url?: string;
};

export type BrowserStatus = {
  connected: boolean;
  protocolVersion: string;
  extensionVersion?: string;
  connectedAt?: string;
};

export type PageSnapshot = {
  tabId: number;
  url: string;
  title: string;
  text: string;
  elements: BrowserElement[];
};

export type BrowserScreenshot = {
  tabId: number;
  url?: string;
  title?: string;
  mimeType: "image/png" | "image/jpeg";
  dataUrl: string;
};

export type BrowserLink = {
  text?: string;
  href: string;
  visible: boolean;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type BrowserElement = {
  elementId: string;
  role: string;
  tagName: string;
  text?: string;
  ariaLabel?: string;
  placeholder?: string;
  value?: string;
  href?: string;
  visible: boolean;
  disabled: boolean;
  selectorHint?: string;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type BrowserAuditEntry = {
  at: string;
  tool: string;
  url?: string;
  ok: boolean;
  errorCode?: string;
};

export type ClickParams = {
  tabId?: number;
  elementId?: string;
  selector?: string;
  text?: string;
  role?: string;
  ariaLabel?: string;
  placeholder?: string;
  href?: string;
};

export type TypeParams = {
  tabId?: number;
  elementId?: string;
  selector?: string;
  ariaLabel?: string;
  placeholder?: string;
  text: string;
};

export type ClearParams = {
  tabId?: number;
  elementId?: string;
  selector?: string;
  ariaLabel?: string;
  placeholder?: string;
};

export type ScrollParams = {
  tabId?: number;
  direction: "up" | "down" | "left" | "right";
  amount?: number;
};

export type WaitForParams = {
  tabId?: number;
  selector?: string;
  text?: string;
  timeoutMs?: number;
};

export type ScreenshotParams = {
  tabId?: number;
  format?: "png" | "jpeg";
  quality?: number;
};

export type BrowserStepAction =
  | "open"
  | "activateTab"
  | "click"
  | "type"
  | "clear"
  | "scroll"
  | "waitFor"
  | "getText"
  | "snapshot"
  | "screenshot"
  | "sleep";

export type BrowserStepTarget = {
  elementId?: string;
  selector?: string;
  text?: string;
  role?: string;
  ariaLabel?: string;
  placeholder?: string;
  href?: string;
};

export type BrowserStep = BrowserStepTarget & {
  action: BrowserStepAction;
  description?: string;
  tabId?: number;
  target?: BrowserStepTarget;
  url?: string;
  value?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  timeoutMs?: number;
  delayMs?: number;
  format?: "png" | "jpeg";
  quality?: number;
};

export type BrowserRunStepsParams = {
  steps: BrowserStep[];
  tabId?: number;
  stopOnError?: boolean;
  delayMs?: number;
  timeoutMs?: number;
  screenshotOnError?: boolean;
};

export type BrowserStepResult = {
  index: number;
  action: BrowserStepAction;
  description?: string;
  ok: boolean;
  elapsedMs: number;
  tabId?: number;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
};

export type BrowserRunStepsResult = {
  ok: boolean;
  stoppedAt?: number;
  tabId?: number;
  results: BrowserStepResult[];
};
