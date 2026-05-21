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

export type BrowserFindParams = {
  tabId?: number;
  query?: string;
  text?: string;
  role?: string;
  ariaLabel?: string;
  placeholder?: string;
  href?: string;
  selector?: string;
  elementId?: string;
  nearText?: string;
  visibleOnly?: boolean;
  viewportOnly?: boolean;
  limit?: number;
  timeoutMs?: number;
};

export type BrowserFindResult = {
  matched: boolean;
  query?: string;
  count: number;
  matches: Array<BrowserElement & {
    confidence: number;
    reasons: string[];
  }>;
};

export type BrowserActAction =
  | "click"
  | "type"
  | "hover"
  | "clear"
  | "waitFor"
  | "assertText";

export type BrowserActParams = BrowserStepTarget & {
  action: BrowserActAction;
  target?: string;
  value?: string;
  replace?: boolean;
  confidenceThreshold?: number;
  timeoutMs?: number;
  visibleOnly?: boolean;
  viewportOnly?: boolean;
};

export type BrowserActResult = {
  ok: boolean;
  action: BrowserActAction;
  matched?: {
    elementId: string;
    role: string;
    tagName: string;
    text?: string;
    ariaLabel?: string;
    placeholder?: string;
    confidence?: number;
    reasons?: string[];
  };
  result?: unknown;
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
  query?: string;
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
  query?: string;
  elementId?: string;
  selector?: string;
  ariaLabel?: string;
  placeholder?: string;
  text: string;
  replace?: boolean;
};

export type BrowserFormField = BrowserStepTarget & {
  value: string;
  replace?: boolean;
};

export type BrowserFillFormParams = {
  tabId?: number;
  fields: BrowserFormField[];
  timeoutMs?: number;
};

export type ClearParams = {
  tabId?: number;
  query?: string;
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
  query?: string;
  selector?: string;
  text?: string;
  timeoutMs?: number;
};

export type ScreenshotParams = {
  tabId?: number;
  format?: "png" | "jpeg";
  quality?: number;
  mode?: "visible" | "cdp";
  scale?: number;
};

export type PdfParams = {
  tabId?: number;
  landscape?: boolean;
  printBackground?: boolean;
  scale?: number;
  paperWidth?: number;
  paperHeight?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  pageRanges?: string;
  preferCSSPageSize?: boolean;
};

export type BrowserPdf = {
  tabId: number;
  url?: string;
  title?: string;
  mimeType: "application/pdf";
  data: string;
};

export type CapturePageFormat = "pdf" | "screenshot" | "text";

export type CapturePageParams = {
  tabId?: number;
  preferredFormat?: CapturePageFormat[];
  pdf?: PdfParams;
  screenshot?: ScreenshotParams;
  savePath?: string;
  saveFilename?: string;
};

export type EvaluateParams = {
  tabId?: number;
  expression: string;
  returnByValue?: boolean;
};

export type CdpParams = {
  tabId?: number;
  method: string;
  params?: Record<string, unknown>;
};

export type CdpSessionParams = {
  tabId?: number;
  enable: string[];
  durationMs?: number;
};

export type CdpEvent = {
  method: string;
  params: Record<string, unknown>;
};

export type ResponsiveViewport = {
  name: string;
  width: number;
  height: number;
};

export type ResponsiveParams = {
  tabId?: number;
  viewports?: ResponsiveViewport[];
  url?: string;
};

export type NetworkAnalysisParams = {
  tabId?: number;
  durationMs?: number;
  slowThresholdMs?: number;
  url?: string;
};

export type BrowserStepAction =
  | "open"
  | "activateTab"
  | "click"
  | "hover"
  | "type"
  | "fillForm"
  | "clear"
  | "scroll"
  | "waitFor"
  | "pressKey"
  | "assertText"
  | "getText"
  | "snapshot"
  | "screenshot"
  | "pdf"
  | "sleep";

export type BrowserStepTarget = {
  query?: string;
  elementId?: string;
  selector?: string;
  text?: string;
  role?: string;
  ariaLabel?: string;
  placeholder?: string;
  href?: string;
  nearText?: string;
};

export type BrowserStep = BrowserStepTarget & {
  action: BrowserStepAction;
  description?: string;
  tabId?: number;
  target?: BrowserStepTarget;
  url?: string;
  value?: string;
  fields?: BrowserFormField[];
  replace?: boolean;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  timeoutMs?: number;
  delayMs?: number;
  key?: string;
  contains?: string;
  visibleOnly?: boolean;
  viewportOnly?: boolean;
  format?: "png" | "jpeg";
  quality?: number;
  landscape?: boolean;
  printBackground?: boolean;
  scale?: number;
  paperWidth?: number;
  paperHeight?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  pageRanges?: string;
  preferCSSPageSize?: boolean;
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
