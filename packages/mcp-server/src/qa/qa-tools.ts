import { join, resolve } from "node:path";
import { z } from "zod";
import { type BrowserRunStepsResult, type BrowserStep } from "@majuntao-1/browser-bridge-shared";
import { type BrowserToolBridge, type BrowserToolDefinition } from "../tools/browser-tools.js";
import { ensureDir, readJson, safeName, timestamp, writeDataUrl, writeJson, writeText } from "./artifacts.js";
import { createQaPlan } from "./planner.js";
import { recordedStepsToCase } from "./recorder.js";
import { renderCiSummary, renderHtml, renderMarkdown, renderReplayViewer } from "./reporter.js";
import {
  type QaCaseInput,
  type QaCaseResult,
  type QaPlanInput,
  type QaReplayFile,
  type QaRunInput,
  type QaRunResult,
  type QaSummary,
  type RecordedStep
} from "./types.js";

const stepSchema = z.object({
  action: z.enum([
    "open",
    "activateTab",
    "click",
    "hover",
    "type",
    "fillForm",
    "clear",
    "scroll",
    "waitFor",
    "pressKey",
    "assertText",
    "getText",
    "pageModel",
    "snapshot",
    "screenshot",
    "pdf",
    "sleep"
  ]),
  description: z.string().optional(),
  tabId: z.number().int().positive().optional(),
  target: z.record(z.unknown()).optional(),
  url: z.string().optional(),
  value: z.string().optional(),
  fields: z.array(z.record(z.unknown())).optional(),
  replace: z.boolean().optional(),
  direction: z.enum(["up", "down", "left", "right"]).optional(),
  amount: z.number().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  delayMs: z.number().int().nonnegative().optional(),
  key: z.string().optional(),
  contains: z.string().optional(),
  text: z.string().optional(),
  query: z.string().optional(),
  selector: z.string().optional(),
  elementId: z.string().optional(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  placeholder: z.string().optional(),
  href: z.string().optional(),
  nearText: z.string().optional(),
  visibleOnly: z.boolean().optional(),
  viewportOnly: z.boolean().optional()
}).passthrough();

const caseSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  priority: z.enum(["P0", "P1", "P2"]).optional(),
  steps: z.array(stepSchema).min(1).max(50),
  expected: z.array(z.string()).optional()
});

const qaRunSchema = z.object({
  taskId: z.string().optional(),
  title: z.string().optional(),
  baseUrl: z.string().optional(),
  outputDir: z.string().optional(),
  prdPath: z.string().optional(),
  prdText: z.string().optional(),
  branch: z.string().optional(),
  compareBranch: z.string().optional(),
  focus: z.array(z.string()).optional(),
  cases: z.array(caseSchema).optional(),
  steps: z.array(stepSchema).optional(),
  stopOnError: z.boolean().optional(),
  delayMs: z.number().int().nonnegative().optional(),
  timeoutMs: z.number().int().positive().optional(),
  screenshotOnError: z.boolean().optional(),
  captureConsole: z.boolean().optional(),
  captureNetwork: z.boolean().optional(),
  recordReplay: z.boolean().optional()
}).refine((value) => Boolean(value.cases?.length || value.steps?.length), {
  message: "cases 或 steps 必须至少提供一个"
});

const qaPlanSchema = z.object({
  taskId: z.string().optional(),
  title: z.string().optional(),
  baseUrl: z.string().optional(),
  prdPath: z.string().optional(),
  prdText: z.string().optional(),
  branch: z.string().optional(),
  compareBranch: z.string().optional(),
  focus: z.array(z.string()).optional()
});

const qaReplaySchema = z.object({
  replayPath: z.string().min(1),
  caseId: z.string().optional(),
  mode: z.enum(["strict", "smart"]).optional(),
  outputDir: z.string().optional(),
  stopOnError: z.boolean().optional()
});

const qaReportSchema = z.object({
  runDir: z.string().min(1),
  format: z.enum(["markdown", "html", "viewer", "ci"]).optional()
});

const qaFromRecordingSchema = z.object({
  taskId: z.string().optional(),
  title: z.string().optional(),
  outputDir: z.string().optional(),
  expected: z.array(z.string()).optional(),
  run: z.boolean().optional()
});

export function createQaTools(bridge: BrowserToolBridge): BrowserToolDefinition[] {
  return [
    {
      name: "browser_qa_plan",
      description: "根据 PRD、focus、git diff 和测试环境 URL 生成 AI QA 测试计划。当前实现为本地启发式规划，不调用外部模型。",
      inputSchema: schema({
        taskId: { type: "string" },
        title: { type: "string" },
        baseUrl: { type: "string" },
        prdPath: { type: "string" },
        prdText: { type: "string" },
        branch: { type: "string" },
        compareBranch: { type: "string" },
        focus: { type: "array", items: { type: "string" } }
      }),
      handler: async (args) => createQaPlan(qaPlanSchema.parse(args ?? {}) as QaPlanInput)
    },
    {
      name: "browser_qa_run",
      description: "执行 AI QA 测试任务。MVP 版本支持传入 cases 或 steps，自动执行浏览器步骤，保存 summary、report.md、report.html 和 replay.json。",
      inputSchema: schema({
        taskId: { type: "string" },
        title: { type: "string" },
        baseUrl: { type: "string" },
        outputDir: { type: "string" },
        cases: { type: "array" },
        steps: { type: "array" },
        stopOnError: { type: "boolean" },
        delayMs: { type: "number" },
        timeoutMs: { type: "number" },
        screenshotOnError: { type: "boolean" },
        captureConsole: { type: "boolean" },
        captureNetwork: { type: "boolean" },
        recordReplay: { type: "boolean" }
      }),
      handler: async (args) => runQa(bridge, qaRunSchema.parse(args ?? {}) as unknown as QaRunInput)
    },
    {
      name: "browser_qa_from_recording",
      description: "读取 browser_toggle_recording/browser_get_recorded_steps 录制的用户操作，清洗为 QA case。默认只生成 case/replay；run=true 时立即执行。",
      inputSchema: schema({
        taskId: { type: "string" },
        title: { type: "string" },
        outputDir: { type: "string" },
        expected: { type: "array", items: { type: "string" } },
        run: { type: "boolean" }
      }),
      handler: async (args) => qaFromRecording(bridge, qaFromRecordingSchema.parse(args ?? {}))
    },
    {
      name: "browser_qa_replay",
      description: "读取 browser_qa_run 生成的 replay.json 并重新执行。阶段 2 MVP 支持 strict 回放；smart 模式会记录在结果中，后续阶段增强语义自愈。",
      inputSchema: schema({
        replayPath: { type: "string" },
        caseId: { type: "string" },
        mode: { type: "string", enum: ["strict", "smart"] },
        outputDir: { type: "string" },
        stopOnError: { type: "boolean" }
      }, ["replayPath"]),
      handler: async (args) => replayQa(bridge, qaReplaySchema.parse(args ?? {}))
    },
    {
      name: "browser_qa_report",
      description: "读取 QA run 目录中的 summary.json，并重新生成 Markdown 或 HTML 报告。",
      inputSchema: schema({
        runDir: { type: "string" },
        format: { type: "string", enum: ["markdown", "html", "viewer", "ci"] }
      }, ["runDir"]),
      handler: async (args) => renderQaReport(qaReportSchema.parse(args ?? {}))
    }
  ];
}

async function runQa(bridge: BrowserToolBridge, input: QaRunInput): Promise<QaRunResult> {
  const startedAt = new Date();
  const taskId = safeName(input.taskId ?? input.title ?? `qa-${timestamp()}`);
  const title = input.title ?? `AI QA Run ${taskId}`;
  const runDir = resolveRunDir(input.outputDir, taskId);
  const casesDir = join(runDir, "cases");
  const screenshotsDir = join(runDir, "screenshots");
  const logsDir = join(runDir, "logs");

  await Promise.all([ensureDir(casesDir), ensureDir(screenshotsDir), ensureDir(logsDir)]);

  const cases = normalizeCases(input);
  const results: QaCaseResult[] = [];

  for (const testCase of cases) {
    const result = await runQaCase(bridge, testCase, {
      stopOnError: input.stopOnError,
      delayMs: input.delayMs,
      timeoutMs: input.timeoutMs,
      screenshotOnError: input.screenshotOnError,
      captureConsole: input.captureConsole,
      captureNetwork: input.captureNetwork,
      screenshotsDir,
      logsDir
    });
    results.push(result);
    await writeJson(join(casesDir, `${result.id}.json`), result);
  }

  const finishedAt = new Date();
  const summary = makeSummary(taskId, title, startedAt, finishedAt, results);
  const replay = makeReplay(input, taskId, title, cases);
  const paths = {
    runDir,
    summary: join(runDir, "summary.json"),
    reportMarkdown: join(runDir, "report.md"),
    reportHtml: join(runDir, "report.html"),
    replayViewer: join(runDir, "replay-viewer.html"),
    ciSummary: join(runDir, "ci-summary.json"),
    replay: join(runDir, "replay.json"),
    casesDir,
    screenshotsDir,
    logsDir
  };

  const runResult: QaRunResult = {
    ok: summary.failed === 0 && summary.blocked === 0,
    summary,
    cases: results,
    paths
  };

  await writeJson(paths.summary, runResult);
  await writeJson(paths.replay, replay);
  await writeText(paths.reportMarkdown, renderMarkdown(runResult));
  await writeText(paths.reportHtml, renderHtml(runResult));
  await writeText(paths.replayViewer, renderReplayViewer(runResult, replay));
  await writeJson(paths.ciSummary, renderCiSummary(runResult));

  return runResult;
}

async function runQaCase(
  bridge: BrowserToolBridge,
  testCase: Required<QaCaseInput>,
  options: {
    stopOnError?: boolean;
    delayMs?: number;
    timeoutMs?: number;
    screenshotOnError?: boolean;
    captureConsole?: boolean;
    captureNetwork?: boolean;
    screenshotsDir: string;
    logsDir: string;
  }
): Promise<QaCaseResult> {
  const started = Date.now();
  let runResult: BrowserRunStepsResult | undefined;
  let error: QaCaseResult["error"];
  let consolePath: string | undefined;
  let networkPath: string | undefined;

  try {
    runResult = await bridge.call<BrowserRunStepsResult>("browser_run_steps", {
      steps: testCase.steps,
      stopOnError: options.stopOnError,
      delayMs: options.delayMs,
      timeoutMs: options.timeoutMs,
      screenshotOnError: options.screenshotOnError ?? true
    }, { timeoutMs: options.timeoutMs });
  } catch (caught) {
    error = normalizeError(caught);
  }

  if (options.captureConsole === true) {
    try {
      const consoleResult = await bridge.call("browser_console_monitor", { durationMs: 500 }, { timeoutMs: 2_500 });
      consolePath = await writeJson(join(options.logsDir, `${testCase.id}-console.json`), consoleResult);
    } catch {
      // Console capture is evidence only; do not change the case result.
    }
  }

  if (options.captureNetwork === true) {
    try {
      const networkResult = await bridge.call("browser_network_analysis", { durationMs: 500 }, { timeoutMs: 3_000 });
      networkPath = await writeJson(join(options.logsDir, `${testCase.id}-network.json`), networkResult);
    } catch {
      // Network capture is evidence only; do not change the case result.
    }
  }

  const screenshot = await captureEvidenceScreenshot(bridge, join(options.screenshotsDir, `${testCase.id}.png`));
  const status = error ? "blocked" : runResult?.ok === false ? "failed" : "passed";

  return {
    id: testCase.id,
    title: testCase.title,
    priority: testCase.priority,
    status,
    elapsedMs: Date.now() - started,
    expected: testCase.expected,
    steps: testCase.steps,
    runResult,
    error,
    artifacts: {
      screenshot,
      console: consolePath,
      network: networkPath
    }
  };
}

async function captureEvidenceScreenshot(
  bridge: BrowserToolBridge,
  path: string
): Promise<QaCaseResult["artifacts"]["screenshot"] | undefined> {
  try {
    const result = await bridge.call<Record<string, unknown>>("browser_screenshot", {
      format: "png",
      mode: "visible"
    });
    if (typeof result.dataUrl !== "string") {
      return undefined;
    }
    const saved = await writeDataUrl(path, result.dataUrl);
    return {
      path: saved,
      url: result.url,
      title: result.title,
      mimeType: result.mimeType
    };
  } catch {
    return undefined;
  }
}

async function replayQa(
  bridge: BrowserToolBridge,
  input: { replayPath: string; caseId?: string; mode?: "strict" | "smart"; outputDir?: string; stopOnError?: boolean }
): Promise<QaRunResult> {
  const replay = await readJson<QaReplayFile>(input.replayPath);
  const cases = replay.cases
    .filter((testCase) => !input.caseId || testCase.id === input.caseId)
    .map((testCase) => ({
      id: testCase.id,
      title: `${testCase.title} (replay${input.mode === "smart" ? ", smart pending" : ""})`,
      priority: testCase.priority,
      expected: testCase.expected,
      steps: input.mode === "smart" ? makeSmartReplaySteps(testCase.steps) : testCase.steps
    }));

  if (!cases.length) {
    throw new Error("INVALID_PARAMS: replay 中没有匹配的 case");
  }

  return runQa(bridge, {
    taskId: `${replay.taskId}-replay-${timestamp()}`,
    title: `${replay.title} Replay`,
    baseUrl: replay.baseUrl,
    outputDir: input.outputDir,
    cases,
    stopOnError: input.stopOnError,
    screenshotOnError: true,
    recordReplay: true
  });
}

async function renderQaReport(input: { runDir: string; format?: "markdown" | "html" | "viewer" | "ci" }): Promise<Record<string, unknown>> {
  const runDir = resolve(input.runDir);
  const result = await readJson<QaRunResult>(join(runDir, "summary.json"));
  const format = input.format ?? "markdown";
  const replay = await readJson<QaReplayFile>(join(runDir, "replay.json")).catch(() => undefined);
  const path = format === "html"
    ? await writeText(join(runDir, "report.html"), renderHtml(result))
    : format === "viewer" && replay
      ? await writeText(join(runDir, "replay-viewer.html"), renderReplayViewer(result, replay))
      : format === "ci"
        ? await writeJson(join(runDir, "ci-summary.json"), renderCiSummary(result))
        : await writeText(join(runDir, "report.md"), renderMarkdown(result));
  return { ok: true, format, path };
}

async function qaFromRecording(
  bridge: BrowserToolBridge,
  input: { taskId?: string; title?: string; outputDir?: string; expected?: string[]; run?: boolean }
): Promise<unknown> {
  const recorded = await bridge.call<{ steps?: RecordedStep[]; count?: number }>("browser_get_recorded_steps", {});
  const testCase = recordedStepsToCase(recorded.steps ?? [], {
    id: input.taskId,
    title: input.title,
    expected: input.expected
  });

  if (input.run === true) {
    return runQa(bridge, {
      taskId: input.taskId ?? testCase.id,
      title: input.title ?? testCase.title,
      outputDir: input.outputDir,
      cases: [testCase],
      screenshotOnError: true,
      recordReplay: true
    });
  }

  const taskId = safeName(input.taskId ?? testCase.id ?? "recorded-flow");
  const runDir = resolveRunDir(input.outputDir, taskId);
  await ensureDir(runDir);
  const replay: QaReplayFile = {
    version: "1",
    taskId,
    title: input.title ?? testCase.title,
    createdAt: new Date().toISOString(),
    cases: [{
      id: testCase.id ?? taskId,
      title: testCase.title,
      priority: testCase.priority ?? "P1",
      expected: testCase.expected ?? [],
      steps: testCase.steps
    }]
  };
  const casePath = await writeJson(join(runDir, "recorded-case.json"), testCase);
  const replayPath = await writeJson(join(runDir, "replay.json"), replay);
  return { ok: true, recordedCount: recorded.count ?? recorded.steps?.length ?? 0, case: testCase, casePath, replayPath };
}

function normalizeCases(input: QaRunInput): Array<Required<QaCaseInput>> {
  const rawCases = input.cases?.length
    ? input.cases
    : [{
      id: input.taskId,
      title: input.title ?? "AI QA Case",
      priority: "P0" as const,
      type: "main" as const,
      steps: input.steps ?? [],
      expected: []
    }];

  return rawCases.map((testCase, index) => ({
    id: safeName(testCase.id ?? `${index + 1}-${testCase.title}`),
    title: testCase.title,
    priority: testCase.priority ?? "P1",
    type: testCase.type ?? "exploratory",
    steps: testCase.steps,
    expected: testCase.expected ?? []
  }));
}

function makeSummary(
  taskId: string,
  title: string,
  startedAt: Date,
  finishedAt: Date,
  cases: QaCaseResult[]
): QaSummary {
  const failed = cases.filter((testCase) => testCase.status === "failed").length;
  const blocked = cases.filter((testCase) => testCase.status === "blocked").length;
  const passed = cases.filter((testCase) => testCase.status === "passed").length;
  const risk = blocked > 0 || failed > 1 ? "high" : failed === 1 ? "medium" : "low";
  return {
    taskId,
    title,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMs: finishedAt.getTime() - startedAt.getTime(),
    passed,
    failed,
    blocked,
    total: cases.length,
    risk
  };
}

function makeReplay(
  input: QaRunInput,
  taskId: string,
  title: string,
  cases: Array<Required<QaCaseInput>>
): QaReplayFile {
  return {
    version: "1",
    taskId,
    title,
    baseUrl: input.baseUrl,
    createdAt: new Date().toISOString(),
    cases: cases.map((testCase) => ({
      id: testCase.id,
      title: testCase.title,
      priority: testCase.priority,
      expected: testCase.expected,
      steps: testCase.steps
    }))
  };
}

function makeSmartReplaySteps(steps: BrowserStep[]): BrowserStep[] {
  return steps.map((step) => {
    if (!["click", "type", "hover", "clear", "waitFor"].includes(step.action)) {
      return step;
    }
    // Smart mode adds 'strict: false' to allow fuzzy matching and self-healing
    const query = step.query ?? step.text ?? step.placeholder ?? step.ariaLabel ?? step.selector;
    return {
      ...step,
      query,
      strict: false, // Enable fuzzy matching/self-healing in the locator engine
      visibleOnly: step.visibleOnly ?? true,
      timeoutMs: step.timeoutMs ?? 10_000
    };
  });
}

function normalizeError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const [code, detail] = message.includes(": ")
    ? message.split(/: (.*)/s, 2)
    : ["INTERNAL_ERROR", message];
  return { code, message: detail || message };
}

function schema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function defaultWorkspaceDir(): string {
  const cwd = process.cwd();
  return cwd.endsWith("packages/mcp-server")
    ? resolve(cwd, "../..")
    : cwd;
}

function resolveRunDir(outputDir: string | undefined, taskId: string): string {
  if (!outputDir) {
    return resolve(defaultWorkspaceDir(), ".browser-bridge", "runs", taskId);
  }
  return resolve(defaultWorkspaceDir(), outputDir);
}
