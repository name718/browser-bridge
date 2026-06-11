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
  type QaDiagnosticsPolicy,
  type QaEvidenceKind,
  type QaFailureCategory,
  type QaObservePolicy,
  type QaPlanInput,
  type QaReplayFile,
  type QaRunInput,
  type QaRunResult,
  type QaSummary,
  type RecordedStep
} from "./types.js";

type NormalizedQaCase = Omit<Required<QaCaseInput>, "observe" | "diagnostics"> & {
  observe?: QaObservePolicy;
  diagnostics?: QaDiagnosticsPolicy;
};

const stepSchema = z.object({
  action: z.enum([
    "open",
    "activateTab",
    "click",
    "hover",
    "type",
    "selectOption",
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
    "screenObserve",
    "screenClick",
    "screenType",
    "screenDrag",
    "screenScroll",
    "screenPress",
    "pdf",
  "sleep"
  ]),
  description: z.string().optional(),
  tabId: z.number().int().positive().optional(),
  target: z.record(z.unknown()).optional(),
  locator: z.record(z.unknown()).optional(),
  url: z.string().optional(),
  value: z.string().optional(),
  option: z.string().optional(),
  label: z.string().optional(),
  exact: z.boolean().optional(),
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
  testId: z.string().optional(),
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

const evidenceKindSchema = z.enum(["screenshot", "console", "network", "pageModel"]);
const observeSchema = z.object({
  before: z.array(evidenceKindSchema).optional(),
  afterEachStep: z.boolean().optional(),
  onFailure: z.array(evidenceKindSchema).optional(),
  final: z.array(evidenceKindSchema).optional()
}).optional();

const diagnosticsSchema = z.object({
  failOnConsoleError: z.boolean().optional(),
  failOnUncaughtException: z.boolean().optional(),
  failOnNetworkError: z.boolean().optional(),
  slowRequestThresholdMs: z.number().int().positive().optional()
}).optional();

const caseSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  priority: z.enum(["P0", "P1", "P2"]).optional(),
  steps: z.array(stepSchema).min(1).max(50),
  expected: z.array(z.string()).optional(),
  observe: observeSchema,
  diagnostics: diagnosticsSchema
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
  failOnConsoleError: z.boolean().optional(),
  failOnUncaughtException: z.boolean().optional(),
  captureNetwork: z.boolean().optional(),
  observe: observeSchema,
  diagnostics: diagnosticsSchema,
  recordReplay: z.boolean().optional(),
  /** 最大并行数（默认 1 = 顺序执行，最大 5） */
  maxParallel: z.number().int().min(1).max(5).optional(),
  /** 只返回摘要，不返回详细步骤 */
  summaryOnly: z.boolean().optional()
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
      description: "执行 AI QA 测试任务。支持传入 cases 或 steps，自动执行浏览器步骤，保存 summary、report.md、report.html 和 replay.json。支持并行执行和摘要模式。",
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
        failOnConsoleError: { type: "boolean" },
        failOnUncaughtException: { type: "boolean" },
        captureNetwork: { type: "boolean" },
        observe: { type: "object", description: "脚本化观察策略：before/onFailure/final 可包含 screenshot、console、network、pageModel" },
        diagnostics: { type: "object", description: "失败诊断策略：控制 console/network 是否导致用例失败及慢请求阈值" },
        recordReplay: { type: "boolean" },
        maxParallel: { type: "number", description: "最大并行数（1-5，默认 1 顺序执行）" },
        summaryOnly: { type: "boolean", description: "只返回摘要，不返回详细步骤（减少响应体积）" }
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
  const pageModelsDir = join(runDir, "page-models");
  const diagnosticsDir = join(runDir, "diagnostics");

  await Promise.all([
    ensureDir(casesDir),
    ensureDir(screenshotsDir),
    ensureDir(logsDir),
    ensureDir(pageModelsDir),
    ensureDir(diagnosticsDir)
  ]);

  const cases = normalizeCases(input);
  const maxParallel = input.maxParallel ?? 1;
  const results: QaCaseResult[] = [];

  if (maxParallel > 1 && cases.length > 1) {
    // 并行执行独立用例（每个用例最多 maxParallel 个并行）
    const executing = new Set<Promise<void>>();

    for (const testCase of cases) {
      const runAndSave = async () => {
        const result = await runQaCase(bridge, testCase, {
          stopOnError: input.stopOnError,
          delayMs: input.delayMs,
          timeoutMs: input.timeoutMs,
          screenshotOnError: input.screenshotOnError,
          captureConsole: input.captureConsole,
          failOnConsoleError: input.failOnConsoleError,
          failOnUncaughtException: input.failOnUncaughtException,
          captureNetwork: input.captureNetwork,
          observe: input.observe,
          diagnostics: input.diagnostics,
          screenshotsDir,
          logsDir,
          pageModelsDir,
          diagnosticsDir
        });
        results.push(result);
        await writeJson(join(casesDir, `${result.id}.json`), result);
      };

      const p = runAndSave().then(() => { executing.delete(p); });
      executing.add(p);

      if (executing.size >= maxParallel) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
  } else {
    // 顺序执行（默认）
    for (const testCase of cases) {
      const result = await runQaCase(bridge, testCase, {
        stopOnError: input.stopOnError,
        delayMs: input.delayMs,
        timeoutMs: input.timeoutMs,
        screenshotOnError: input.screenshotOnError,
        captureConsole: input.captureConsole,
        failOnConsoleError: input.failOnConsoleError,
        failOnUncaughtException: input.failOnUncaughtException,
        captureNetwork: input.captureNetwork,
        observe: input.observe,
        diagnostics: input.diagnostics,
        screenshotsDir,
        logsDir,
        pageModelsDir,
        diagnosticsDir
      });
      results.push(result);
      await writeJson(join(casesDir, `${result.id}.json`), result);
    }
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
    logsDir,
    pageModelsDir,
    diagnosticsDir
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

  // summaryOnly 模式：只返回摘要和失败用例详情，减少响应体积
  if (input.summaryOnly) {
    return {
      ...runResult,
      cases: runResult.cases.map((c) => ({
        ...c,
        // 清空步骤详情，只保留摘要信息
        steps: [],
        runResult: undefined,
        artifacts: {
          ...c.artifacts,
          console: undefined,
          network: undefined
        }
      }))
    };
  }

  return runResult;
}

async function runQaCase(
  bridge: BrowserToolBridge,
  testCase: NormalizedQaCase,
  options: {
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
    screenshotsDir: string;
    logsDir: string;
    pageModelsDir: string;
    diagnosticsDir: string;
  }
): Promise<QaCaseResult> {
  const started = Date.now();
  let runResult: BrowserRunStepsResult | undefined;
  let error: QaCaseResult["error"];
  let consolePath: string | undefined;
  let consoleSummary: QaCaseResult["artifacts"]["consoleSummary"];
  let networkPath: string | undefined;
  let networkSummary: QaCaseResult["artifacts"]["networkSummary"];
  let beforePageModel: string | undefined;
  let finalPageModel: string | undefined;
  let failurePageModel: string | undefined;
  let screenshot: QaCaseResult["artifacts"]["screenshot"];
  let failureScreenshot: QaCaseResult["artifacts"]["failureScreenshot"];

  const observe = mergeObservePolicy(options.observe, testCase.observe, {
    captureConsole: options.captureConsole,
    captureNetwork: options.captureNetwork,
    screenshotOnError: options.screenshotOnError
  });
  const diagnostics = mergeDiagnosticsPolicy(options, testCase.diagnostics);
  const steps = testCase.steps.map(normalizeStepLocators);

  if (hasEvidence(observe.before, "pageModel")) {
    beforePageModel = await capturePageModel(bridge, join(options.pageModelsDir, `${testCase.id}-before.json`));
  }

  try {
    runResult = await bridge.call<BrowserRunStepsResult>("browser_run_steps", {
      steps,
      stopOnError: options.stopOnError,
      delayMs: options.delayMs,
      timeoutMs: options.timeoutMs,
      screenshotOnError: hasEvidence(observe.onFailure, "screenshot"),
      trace: observe.afterEachStep === true
    }, { timeoutMs: options.timeoutMs });
  } catch (caught) {
    error = normalizeError(caught);
  }

  const executionFailed = Boolean(error) || runResult?.ok === false;

  if (shouldCaptureEvidence(observe, executionFailed, "console")) {
    try {
      const consoleResult = await bridge.call("browser_console_monitor", { durationMs: 1000 }, { timeoutMs: 3_500 });
      consoleSummary = summarizeConsole(consoleResult, diagnostics);
      consolePath = await writeJson(join(options.logsDir, `${testCase.id}-console.json`), consoleResult);
    } catch {
      // Console capture is evidence only; do not change the case result.
    }
  }

  if (shouldCaptureEvidence(observe, executionFailed, "network")) {
    try {
      const networkResult = await bridge.call("browser_network_analysis", {
        durationMs: 500,
        slowThresholdMs: diagnostics.slowRequestThresholdMs
      }, { timeoutMs: 3_000 });
      networkSummary = summarizeNetwork(networkResult, diagnostics);
      networkPath = await writeJson(join(options.logsDir, `${testCase.id}-network.json`), networkResult);
    } catch {
      // Network capture is evidence only; do not change the case result.
    }
  }

  if (executionFailed && hasEvidence(observe.onFailure, "pageModel")) {
    failurePageModel = await capturePageModel(bridge, join(options.pageModelsDir, `${testCase.id}-failure.json`));
  }

  if (hasEvidence(observe.final, "pageModel")) {
    finalPageModel = await capturePageModel(bridge, join(options.pageModelsDir, `${testCase.id}-final.json`));
  }

  if (executionFailed && hasEvidence(observe.onFailure, "screenshot")) {
    failureScreenshot = await captureEvidenceScreenshot(bridge, join(options.screenshotsDir, `${testCase.id}-failure.png`));
  }
  if (hasEvidence(observe.final, "screenshot")) {
    screenshot = await captureEvidenceScreenshot(bridge, join(options.screenshotsDir, `${testCase.id}.png`));
  }

  const consoleError = consoleSummary?.failed
    ? {
      code: "CONSOLE_ERROR",
      message: `Console 检查失败：error ${consoleSummary.errorCount}，exception ${consoleSummary.exceptionCount}`
    }
    : undefined;
  const networkError = networkSummary?.failed
    ? {
      code: "NETWORK_ERROR",
      message: `Network 检查失败：failed ${networkSummary.failedCount}，slow ${networkSummary.slowCount}`
    }
    : undefined;
  const stepError = runResult?.results.find((result) => !result.ok)?.error;
  const finalError = error ?? consoleError ?? networkError ?? stepError;
  const failureCategory = classifyFailure(finalError, { consoleSummary, networkSummary, runResult });
  const status = error ? "blocked" : (runResult?.ok === false || consoleError || networkError ? "failed" : "passed");
  const diagnosticsPath = executionFailed || consoleError || networkError
    ? await writeJson(join(options.diagnosticsDir, `${testCase.id}.json`), {
      caseId: testCase.id,
      status,
      failureCategory,
      error: finalError,
      failedStep: runResult?.results.find((result) => !result.ok),
      artifacts: {
        beforePageModel,
        finalPageModel,
        failurePageModel,
        screenshot: screenshot?.path,
        failureScreenshot: failureScreenshot?.path,
        console: consolePath,
        network: networkPath
      }
    })
    : undefined;

  return {
    id: testCase.id,
    title: testCase.title,
    priority: testCase.priority,
    status,
    elapsedMs: Date.now() - started,
    expected: testCase.expected,
    steps,
    runResult,
    error: finalError,
    failureCategory,
    artifacts: {
      beforePageModel,
      finalPageModel,
      failurePageModel,
      screenshot,
      failureScreenshot,
      console: consolePath,
      consoleSummary,
      network: networkPath,
      networkSummary,
      diagnostics: diagnosticsPath
    }
  };
}

function summarizeConsole(
  consoleResult: unknown,
  options: { failOnConsoleError?: boolean; failOnUncaughtException?: boolean }
): QaCaseResult["artifacts"]["consoleSummary"] {
  const logs = isRecord(consoleResult) && Array.isArray(consoleResult.logs)
    ? consoleResult.logs.filter(isRecord)
    : [];

  const entries = logs.map((entry) => {
    const message = consoleMessage(entry);
    return {
      type: consoleEntryType(entry, message),
      message,
      timestamp: entry.timestamp
    };
  });
  const errorCount = entries.filter((entry) => entry.type === "error").length;
  const warningCount = entries.filter((entry) => entry.type === "warning" || entry.type === "warn").length;
  const exceptionCount = entries.filter((entry) => entry.type === "exception" || /exception|uncaught/i.test(entry.message)).length;
  const failed = (options.failOnConsoleError === true && errorCount > 0)
    || (options.failOnUncaughtException === true && exceptionCount > 0);

  return {
    errorCount,
    warningCount,
    exceptionCount,
    failed,
    entries
  };
}

function consoleMessage(entry: Record<string, unknown>): string {
  if (typeof entry.exception === "string") return entry.exception;
  if (typeof entry.text === "string") return entry.text;
  if (Array.isArray(entry.args)) return entry.args.map((arg) => String(arg)).join(" ");
  return JSON.stringify(entry);
}

function consoleEntryType(entry: Record<string, unknown>, message: string): string {
  if (typeof entry.exception === "string") return "exception";
  if (/exception|uncaught/i.test(message)) return "exception";
  return typeof entry.type === "string" ? entry.type : "unknown";
}

function mergeObservePolicy(
  runPolicy: QaObservePolicy | undefined,
  casePolicy: QaObservePolicy | undefined,
  legacy: { captureConsole?: boolean; captureNetwork?: boolean; screenshotOnError?: boolean }
): Required<QaObservePolicy> {
  const finalKinds: QaEvidenceKind[] = ["screenshot"];
  if (legacy.captureConsole) finalKinds.push("console");
  if (legacy.captureNetwork) finalKinds.push("network");
  const onFailureKinds: QaEvidenceKind[] = legacy.screenshotOnError === false ? [] : ["screenshot", "pageModel"];
  if (legacy.captureConsole) onFailureKinds.push("console");
  if (legacy.captureNetwork) onFailureKinds.push("network");
  return {
    before: casePolicy?.before ?? runPolicy?.before ?? [],
    afterEachStep: casePolicy?.afterEachStep ?? runPolicy?.afterEachStep ?? false,
    onFailure: casePolicy?.onFailure ?? runPolicy?.onFailure ?? uniqueEvidence(onFailureKinds),
    final: casePolicy?.final ?? runPolicy?.final ?? uniqueEvidence(finalKinds)
  };
}

function mergeDiagnosticsPolicy(
  options: {
    failOnConsoleError?: boolean;
    failOnUncaughtException?: boolean;
    captureNetwork?: boolean;
    diagnostics?: QaDiagnosticsPolicy;
  },
  casePolicy: QaDiagnosticsPolicy | undefined
): Required<QaDiagnosticsPolicy> {
  return {
    failOnConsoleError: casePolicy?.failOnConsoleError
      ?? options.diagnostics?.failOnConsoleError
      ?? options.failOnConsoleError
      ?? false,
    failOnUncaughtException: casePolicy?.failOnUncaughtException
      ?? options.diagnostics?.failOnUncaughtException
      ?? options.failOnUncaughtException
      ?? false,
    failOnNetworkError: casePolicy?.failOnNetworkError
      ?? options.diagnostics?.failOnNetworkError
      ?? options.captureNetwork
      ?? false,
    slowRequestThresholdMs: casePolicy?.slowRequestThresholdMs
      ?? options.diagnostics?.slowRequestThresholdMs
      ?? 1000
  };
}

function uniqueEvidence(values: QaEvidenceKind[]): QaEvidenceKind[] {
  return Array.from(new Set(values));
}

function hasEvidence(values: QaEvidenceKind[] | undefined, kind: QaEvidenceKind): boolean {
  return values?.includes(kind) === true;
}

function shouldCaptureEvidence(
  observe: Required<QaObservePolicy>,
  executionFailed: boolean,
  kind: QaEvidenceKind
): boolean {
  return hasEvidence(observe.final, kind) || (executionFailed && hasEvidence(observe.onFailure, kind));
}

function normalizeStepLocators(step: BrowserStep): BrowserStep {
  const locator = isRecord(step.locator) ? step.locator : undefined;
  const target = isRecord(step.target) ? step.target : {};
  const testId = stringField(locator, "testId") ?? step.testId ?? stringField(target, "testId");
  const selector = stringField(locator, "selector") ?? step.selector ?? stringField(target, "selector")
    ?? (testId ? `data-testid=${testId}` : undefined);
  return {
    ...step,
    target: {
      ...target,
      ...locator
    },
    query: step.query ?? stringField(locator, "query") ?? stringField(locator, "label") ?? stringField(target, "query"),
    elementId: step.elementId ?? stringField(locator, "elementId") ?? stringField(target, "elementId"),
    selector,
    testId,
    text: step.text ?? stringField(locator, "text") ?? stringField(locator, "label") ?? stringField(target, "text"),
    role: step.role ?? stringField(locator, "role") ?? stringField(target, "role"),
    ariaLabel: step.ariaLabel ?? stringField(locator, "ariaLabel") ?? stringField(target, "ariaLabel"),
    placeholder: step.placeholder ?? stringField(locator, "placeholder") ?? stringField(target, "placeholder"),
    label: step.label ?? stringField(locator, "label") ?? stringField(target, "label"),
    href: step.href ?? stringField(locator, "href") ?? stringField(target, "href"),
    nearText: step.nearText ?? stringField(locator, "nearText") ?? stringField(target, "nearText"),
    visibleOnly: step.visibleOnly ?? booleanField(locator, "visibleOnly"),
    viewportOnly: step.viewportOnly ?? booleanField(locator, "viewportOnly")
  };
}

function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const raw = value?.[key];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function booleanField(value: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const raw = value?.[key];
  return typeof raw === "boolean" ? raw : undefined;
}

function summarizeNetwork(
  networkResult: unknown,
  options: Required<QaDiagnosticsPolicy>
): QaCaseResult["artifacts"]["networkSummary"] {
  const rawEntries = extractNetworkEntries(networkResult);
  const entries = rawEntries.map((entry) => ({
    url: typeof entry.url === "string" ? entry.url : typeof entry.requestUrl === "string" ? entry.requestUrl : undefined,
    method: typeof entry.method === "string" ? entry.method : undefined,
    status: typeof entry.status === "number" ? entry.status : typeof entry.statusCode === "number" ? entry.statusCode : undefined,
    durationMs: typeof entry.durationMs === "number" ? entry.durationMs : typeof entry.duration === "number" ? entry.duration : undefined,
    errorText: typeof entry.errorText === "string" ? entry.errorText : typeof entry.error === "string" ? entry.error : undefined
  }));
  const failedCount = entries.filter((entry) => Boolean(entry.errorText) || (typeof entry.status === "number" && entry.status >= 400)).length;
  const slowCount = entries.filter((entry) => typeof entry.durationMs === "number" && entry.durationMs >= options.slowRequestThresholdMs).length;
  return {
    failedCount,
    slowCount,
    failed: options.failOnNetworkError && failedCount > 0,
    entries
  };
}

function extractNetworkEntries(networkResult: unknown): Record<string, unknown>[] {
  if (!isRecord(networkResult)) return [];
  for (const key of ["requests", "entries", "logs", "resources"]) {
    const value = networkResult[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function classifyFailure(
  error: QaCaseResult["error"] | undefined,
  context: {
    consoleSummary?: QaCaseResult["artifacts"]["consoleSummary"];
    networkSummary?: QaCaseResult["artifacts"]["networkSummary"];
    runResult?: BrowserRunStepsResult;
  }
): QaFailureCategory {
  if (!error) return "none";
  if (context.consoleSummary?.failed) return "console_error";
  if (context.networkSummary?.failed) return "network_error";
  const code = error.code.toUpperCase();
  const message = error.message.toLowerCase();
  if (code.includes("ELEMENT") || code.includes("AMBIGUOUS") || message.includes("selector") || message.includes("定位")) {
    return "selector_failed";
  }
  if (code.includes("ASSERT") || message.includes("assert") || message.includes("断言")) {
    return "assertion_failed";
  }
  if (code.includes("BROWSER_NOT_CONNECTED") || code.includes("TAB_") || code.includes("ACTION_TIMEOUT")) {
    return "environment_error";
  }
  if (message.includes("login") || message.includes("登录") || message.includes("auth") || message.includes("unauthorized")) {
    return "auth_error";
  }
  if (context.runResult?.ok === false) return "execution_error";
  return "unknown";
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

async function capturePageModel(
  bridge: BrowserToolBridge,
  path: string
): Promise<string | undefined> {
  try {
    const result = await bridge.call("browser_get_page_model", {
      visibleOnly: true,
      viewportOnly: false,
      maxTextLength: 8000,
      maxElements: 200,
      maxHeadings: 120,
      maxRegions: 80,
      maxTables: 20,
      maxTableRows: 10
    }, { timeoutMs: 5_000 });
    return writeJson(path, result);
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

function normalizeCases(input: QaRunInput): NormalizedQaCase[] {
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
    expected: testCase.expected ?? [],
    observe: testCase.observe,
    diagnostics: testCase.diagnostics
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
  cases: NormalizedQaCase[]
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
