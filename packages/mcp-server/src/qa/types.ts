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

export type QaDecisionFailureCategory =
  | "product_bug"
  | "frontend_bug"
  | "backend_or_data"
  | "environment_blocked"
  | "locator_flaky"
  | "test_case_invalid"
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

export type QaPreflightPolicy = {
  enabled?: boolean;
  requireConnected?: boolean;
  requireActiveTab?: boolean;
  checkBaseUrlReachable?: boolean;
  failOnExistingConsoleError?: boolean;
};

export type QaPreflightCheck = {
  name: string;
  status: "passed" | "failed" | "skipped";
  message: string;
  details?: unknown;
};

export type QaPreflightResult = {
  status: "passed" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  checks: QaPreflightCheck[];
  diagnostics?: string;
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

export type QaSemanticCase = {
  id: string;
  title: string;
  priority?: QaPriority;
  type?: QaCaseInput["type"];
  route?: string;
  riskSource?: string[];
  preconditions?: string[];
  steps: string[];
  expected?: string[];
  trace?: Record<string, unknown>;
};

export type QaRunInput = {
  taskId?: string;
  title?: string;
  baseUrl?: string;
  outputDir?: string;
  semanticCases?: QaSemanticCase[];
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
  preflight?: QaPreflightPolicy;
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

export type QaDiagnosticSummary = {
  category: QaFailureCategory;
  message: string;
  failedStep?: {
    index: number;
    action?: string;
    description?: string;
    error?: {
      code: string;
      message: string;
    };
  };
  currentPage?: {
    tabId?: number;
    url?: string;
    title?: string;
  };
  locator?: {
    strategy: string;
    warnings: string[];
    normalized: Record<string, unknown>;
  };
  evidence: {
    screenshot: boolean;
    pageModel: boolean;
    console: boolean;
    network: boolean;
  };
};

export type QaLocatorMetadata = {
  strategy: string;
  warnings: string[];
  normalized: Record<string, unknown>;
};

export type QaExecutableStep = BrowserStep & {
  _qaLocator?: QaLocatorMetadata;
  _qaReplay?: {
    mode: "smart";
    original: Record<string, unknown>;
    fallbacks: Record<string, unknown>[];
    reason: string;
    confidence: number;
    semanticChanged: false;
  };
};

export type QaCaseResult = {
  id: string;
  title: string;
  priority: QaPriority;
  status: QaCaseStatus;
  elapsedMs: number;
  expected: string[];
  steps: QaExecutableStep[];
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
    diagnosticsSummary?: QaDiagnosticSummary;
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
  preflight?: QaPreflightResult;
  paths: {
    runDir: string;
    summary: string;
    reportMarkdown: string;
    reportHtml: string;
    replayViewer: string;
    ciSummary: string;
    replay: string;
    runConfig: string;
    semanticCases: string;
    executableCases: string;
    workflowState: string;
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
