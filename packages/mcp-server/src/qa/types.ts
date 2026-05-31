import { type BrowserStep, type BrowserRunStepsResult } from "@majuntao-1/browser-bridge-shared";

export type QaPriority = "P0" | "P1" | "P2";
export type QaCaseStatus = "passed" | "failed" | "blocked";
export type QaRisk = "low" | "medium" | "high";

export type QaCaseInput = {
  id?: string;
  title: string;
  priority?: QaPriority;
  steps: BrowserStep[];
  expected?: string[];
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
  captureNetwork?: boolean;
  recordReplay?: boolean;
};

export type QaStepEvidence = {
  path?: string;
  url?: unknown;
  title?: unknown;
  mimeType?: unknown;
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
  artifacts: {
    screenshot?: QaStepEvidence;
    console?: string;
    network?: string;
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
    replay: string;
    casesDir: string;
    screenshotsDir: string;
    logsDir: string;
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
  format?: "markdown" | "html";
};
