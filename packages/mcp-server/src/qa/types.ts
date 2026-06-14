import { type BrowserStep, type BrowserRunStepsResult } from "@majuntao-1/browser-bridge-shared";

export type QaPriority = "P0" | "P1" | "P2";
export type QaCaseStatus = "passed" | "failed" | "blocked";
export type QaRisk = "low" | "medium" | "high";
export type QaEvidenceKind = "screenshot" | "console" | "network" | "pageModel";
export type QaFailureCategory =
  | "none"
  | "selector_failed"
  | "assertion_failed"
  | "console_error"
  | "network_error"
  | "test_data_error"
  | "auth_error"
  | "environment_error"
  | "execution_error"
  | "unknown";

export type QaObservePolicy = {
  before?: QaEvidenceKind[];
  afterEachStep?: boolean;
  onFailure?: QaEvidenceKind[];
  final?: QaEvidenceKind[];
};

export type QaDiagnosticsPolicy = {
  failOnConsoleError?: boolean;
  failOnUncaughtException?: boolean;
  failOnNetworkError?: boolean;
  slowRequestThresholdMs?: number;
};

export type QaCaseInput = {
  id?: string;
  title: string;
  priority?: QaPriority;
  type?: "main" | "negative" | "edge" | "regression" | "exploratory" | "recorded";
  steps: BrowserStep[];
  expected?: string[];
  observe?: QaObservePolicy;
  diagnostics?: QaDiagnosticsPolicy;
};

export type QaRunInput = {
  taskId?: string;
  title?: string;
  baseUrl?: string;
  outputDir?: string;
  cases?: QaCaseInput[];
  steps?: BrowserStep[];
  stopOnError?: boolean;
  delayMs?: number;
  timeoutMs?: number;
  screenshotOnError?: boolean;
  captureConsole?: boolean;
  failOnConsoleError?: boolean;
  failOnUncaughtException?: boolean;
  captureNetwork?: boolean;
  observe?: QaObservePolicy;
  diagnostics?: QaDiagnosticsPolicy;
  recordReplay?: boolean;
  prdPath?: string;
  prdText?: string;
  branch?: string;
  compareBranch?: string;
  focus?: string[];
  /** 最大并行数（默认 1 = 顺序执行，最大 5） */
  maxParallel?: number;
  /** 只返回摘要，不返回详细步骤 */
  summaryOnly?: boolean;
};

export type QaStepEvidence = {
  path?: string;
  url?: unknown;
  title?: unknown;
  mimeType?: unknown;
};

export type QaConsoleSummary = {
  errorCount: number;
  warningCount: number;
  exceptionCount: number;
  failed: boolean;
  entries: Array<{
    type: string;
    message: string;
    timestamp?: unknown;
  }>;
};

export type QaNetworkSummary = {
  failedCount: number;
  slowCount: number;
  failed: boolean;
  entries: Array<{
    url?: string;
    method?: string;
    status?: number;
    durationMs?: number;
    errorText?: string;
  }>;
};

export type QaCaseResult = {
  id: string;
  title: string;
  priority: QaPriority;
  status: QaCaseStatus;
  elapsedMs: number;
  expected: string[];
  steps: BrowserStep[];
  runResult?: BrowserRunStepsResult;
  error?: {
    code: string;
    message: string;
  };
  failureCategory: QaFailureCategory;
  artifacts: {
    beforePageModel?: string;
    finalPageModel?: string;
    failurePageModel?: string;
    screenshot?: QaStepEvidence;
    failureScreenshot?: QaStepEvidence;
    console?: string;
    consoleSummary?: QaConsoleSummary;
    network?: string;
    networkSummary?: QaNetworkSummary;
    diagnostics?: string;
  };
};

export type QaSummary = {
  taskId: string;
  title: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  passed: number;
  failed: number;
  blocked: number;
  total: number;
  risk: QaRisk;
};

export type QaRunResult = {
  ok: boolean;
  summary: QaSummary;
  cases: QaCaseResult[];
  paths: {
    runDir: string;
    summary: string;
    reportMarkdown: string;
    reportHtml: string;
    replayViewer: string;
    ciSummary: string;
    replay: string;
    casesDir: string;
    screenshotsDir: string;
    logsDir: string;
    pageModelsDir: string;
    diagnosticsDir: string;
  };
};

export type QaPlanInput = {
  taskId?: string;
  title?: string;
  baseUrl?: string;
  prdPath?: string;
  prdText?: string;
  branch?: string;
  compareBranch?: string;
  focus?: string[];
};

export type QaPlan = {
  taskId: string;
  title: string;
  baseUrl?: string;
  scope: string[];
  regressionAreas: string[];
  risks: Array<{
    level: QaPriority;
    title: string;
    reason: string;
  }>;
  cases: QaCaseInput[];
  sources: {
    prdPath?: string;
    branch?: string;
    compareBranch?: string;
    changedFiles: string[];
  };
};

export type QaReplayFile = {
  version: "1";
  taskId: string;
  title: string;
  baseUrl?: string;
  createdAt: string;
  cases: Array<{
    id: string;
    title: string;
    priority: QaPriority;
    expected: string[];
    steps: BrowserStep[];
  }>;
};

export type QaReplayInput = {
  replayPath: string;
  caseId?: string;
  mode?: "strict" | "smart";
  outputDir?: string;
  stopOnError?: boolean;
};

export type QaReportInput = {
  runDir: string;
  format?: "markdown" | "html" | "viewer" | "ci";
};

export type RecordedStep = {
  id?: string;
  timestamp?: number;
  action: string;
  url?: string;
  title?: string;
  text?: string;
  query?: string;
  role?: string;
  ariaLabel?: string;
  placeholder?: string;
  selector?: string;
  selectorHint?: string;
  testId?: string;
  nearText?: string;
  value?: string;
  key?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  masked?: boolean;
};
