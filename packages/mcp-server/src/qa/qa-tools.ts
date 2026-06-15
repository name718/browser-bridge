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
  type QaConsoleSummary,
  type QaDiagnosticSummary,
  type QaDiagnosticsPolicy,
  type QaEvidenceKind,
  type QaExecutableStep,
  type QaFailureCategory,
  type QaLocatorMetadata,
  type QaNetworkSummary,
  type QaObservePolicy,
  type QaPlanInput,
  type QaPreflightPolicy,
  type QaPreflightResult,
  type QaReplayFile,
  type QaRunInput,
  type QaRunResult,
  type QaSummary,
  type QaSemanticCase,
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

const preflightSchema = z.object({
  enabled: z.boolean().optional(),
  requireConnected: z.boolean().optional(),
  requireActiveTab: z.boolean().optional(),
  checkBaseUrlReachable: z.boolean().optional(),
  failOnExistingConsoleError: z.boolean().optional()
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

const semanticCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  priority: z.enum(["P0", "P1", "P2"]).optional(),
  type: z.enum(["main", "negative", "edge", "regression", "exploratory", "recorded"]).optional(),
  route: z.string().optional(),
  riskSource: z.array(z.string()).optional(),
  preconditions: z.array(z.string()).optional(),
  steps: z.array(z.string()).min(1),
  expected: z.array(z.string()).optional(),
  trace: z.record(z.unknown()).optional()
}).passthrough();

const qaRunSchema = z.object({
  taskId: z.string().optional(),
  title: z.string().optional(),
  baseUrl: z.string().optional(),
  outputDir: z.string().optional(),
  semanticCases: z.array(semanticCaseSchema).optional(),
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
  preflight: preflightSchema,
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
        semanticCases: { type: "array", description: "人审语义用例，和可执行 cases 分离保存到 semantic-cases.json" },
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
        preflight: { type: "object", description: "执行前预检策略：检查 Bridge 连接、活动标签页、baseUrl 可达性和既有 console 错误" },
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
      description: "读取 browser_qa_run 生成的 replay.json 并重新执行。strict 按原步骤回放；smart 会为交互步骤补充有限 locator fallback 和自愈审计元数据。",
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
  const preflight = await runPreflight(bridge, input, diagnosticsDir);

  if (preflight.status === "failed") {
    for (const testCase of cases) {
      const result = makePreflightBlockedCase(testCase, preflight);
      results.push(result);
      await writeJson(join(casesDir, `${result.id}.json`), result);
    }
  } else if (maxParallel > 1 && cases.length > 1) {
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
    runConfig: join(runDir, "run-config.json"),
    semanticCases: join(runDir, "semantic-cases.json"),
    executableCases: join(runDir, "executable-cases.json"),
    workflowState: join(runDir, "workflow-state.json"),
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
    preflight,
    paths
  };

  await writeJson(paths.runConfig, makeRunConfig(input, taskId, title, startedAt));
  await writeJson(paths.semanticCases, makeSemanticCases(input, cases));
  await writeJson(paths.executableCases, makeExecutableCases(input, cases));
  await writeJson(paths.workflowState, makeRunWorkflowState(input, taskId, title, startedAt, finishedAt, paths, summary));
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
  const failedStep = runResult?.results.find((result) => !result.ok);
  const stepError = failedStep?.error;
  const finalError = error ?? consoleError ?? networkError ?? stepError;
  const failureCategory = classifyFailure(finalError, { consoleSummary, networkSummary, runResult });
  const status = error ? "blocked" : (runResult?.ok === false || consoleError || networkError ? "failed" : "passed");
  const diagnosticsSummary = finalError
    ? await buildDiagnosticsSummary(bridge, {
      testCase,
      steps,
      status,
      failureCategory,
      error: finalError,
      failedStep,
      artifacts: {
        beforePageModel,
        finalPageModel,
        failurePageModel,
        screenshot: screenshot?.path,
        failureScreenshot: failureScreenshot?.path,
        console: consolePath,
        network: networkPath
      },
      consoleSummary,
      networkSummary
    })
    : undefined;
  const diagnosticsPath = diagnosticsSummary
    ? await writeJson(join(options.diagnosticsDir, `${testCase.id}.json`), {
      caseId: testCase.id,
      title: testCase.title,
      priority: testCase.priority,
      status,
      failureCategory,
      error: finalError,
      summary: diagnosticsSummary,
      failedStep,
      failedStepInput: typeof failedStep?.index === "number" ? steps[failedStep.index] : undefined,
      stepTimeline: runResult?.results.map((result) => ({
        index: result.index,
        action: result.action,
        description: result.description,
        ok: result.ok,
        elapsedMs: result.elapsedMs,
        tabId: result.tabId,
        error: result.error
      })),
      artifacts: {
        beforePageModel,
        finalPageModel,
        failurePageModel,
        screenshot: screenshot?.path,
        failureScreenshot: failureScreenshot?.path,
        console: consolePath,
        network: networkPath
      },
      consoleSummary,
      networkSummary
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
      diagnostics: diagnosticsPath,
      diagnosticsSummary
    }
  };
}

function summarizeConsole(
  consoleResult: unknown,
  options: { failOnConsoleError?: boolean; failOnUncaughtException?: boolean }
): QaConsoleSummary {
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

async function buildDiagnosticsSummary(
  bridge: BrowserToolBridge,
  input: {
    testCase: NormalizedQaCase;
    steps: QaExecutableStep[];
    status: QaCaseResult["status"];
    failureCategory: QaFailureCategory;
    error: NonNullable<QaCaseResult["error"]>;
    failedStep?: BrowserRunStepsResult["results"][number];
    artifacts: {
      beforePageModel?: string;
      finalPageModel?: string;
      failurePageModel?: string;
      screenshot?: string;
      failureScreenshot?: string;
      console?: string;
      network?: string;
    };
    consoleSummary?: QaConsoleSummary;
    networkSummary?: QaNetworkSummary;
  }
): Promise<QaDiagnosticSummary> {
  const failedStepInput = typeof input.failedStep?.index === "number"
    ? input.steps[input.failedStep.index]
    : undefined;
  const currentPage = await getCurrentPageContext(bridge);
  return {
    category: input.failureCategory,
    message: input.error.message,
    failedStep: input.failedStep
      ? {
        index: input.failedStep.index,
        action: input.failedStep.action,
        description: input.failedStep.description,
        error: input.failedStep.error
      }
      : undefined,
    currentPage,
    locator: failedStepInput ? failedStepInput._qaLocator ?? analyzeLocator(failedStepInput) : undefined,
    evidence: {
      screenshot: Boolean(input.artifacts.failureScreenshot || input.artifacts.screenshot),
      pageModel: Boolean(input.artifacts.failurePageModel || input.artifacts.finalPageModel || input.artifacts.beforePageModel),
      console: Boolean(input.artifacts.console || input.consoleSummary),
      network: Boolean(input.artifacts.network || input.networkSummary)
    }
  };
}

async function getCurrentPageContext(
  bridge: BrowserToolBridge
): Promise<QaDiagnosticSummary["currentPage"] | undefined> {
  try {
    const tab = await bridge.call("browser_get_active_tab", {}, { timeoutMs: 2_000 });
    if (!isRecord(tab)) return undefined;
    return {
      tabId: typeof tab.id === "number" ? tab.id : undefined,
      url: typeof tab.url === "string" ? tab.url : undefined,
      title: typeof tab.title === "string" ? tab.title : undefined
    };
  } catch {
    return undefined;
  }
}

function analyzeLocator(step: BrowserStep): QaLocatorMetadata {
  const normalized = locatorFields(step);
  const warnings: string[] = [];
  let strategy = "none";

  if (typeof normalized.testId === "string") {
    strategy = "data-testid";
  } else if (typeof normalized.role === "string" && typeof normalized.text === "string") {
    strategy = "role+text";
  } else if (typeof normalized.label === "string" || typeof normalized.ariaLabel === "string") {
    strategy = "label";
  } else if (typeof normalized.placeholder === "string") {
    strategy = "placeholder";
  } else if (typeof normalized.text === "string" && typeof normalized.nearText === "string") {
    strategy = "text+nearText";
  } else if (typeof normalized.text === "string" || typeof normalized.query === "string") {
    strategy = "text";
    warnings.push("仅使用文本定位，页面文案变化时可能不稳定");
  } else if (typeof normalized.selector === "string") {
    strategy = "css-selector";
    warnings.push("使用 CSS selector 兜底，结构变化时可能不稳定");
  } else {
    warnings.push("缺少可解释 locator，建议补充 testId、role、label 或 placeholder");
  }

  if (typeof normalized.selector === "string" && normalized.selector.startsWith("data-testid=")) {
    strategy = "data-testid";
  }
  if (strategy === "css-selector" && typeof normalized.selector === "string" && /:nth-child|\s>|\.[a-zA-Z0-9_-]+/.test(normalized.selector)) {
    warnings.push("selector 可能依赖 DOM 结构或样式类，建议补充语义 locator");
  }

  return {
    strategy,
    warnings,
    normalized
  };
}

function locatorFields(step: BrowserStep): Record<string, unknown> {
  const locator = isRecord(step.locator) ? step.locator : {};
  const target = isRecord(step.target) ? step.target : {};
  return {
    testId: step.testId ?? stringField(locator, "testId") ?? stringField(target, "testId"),
    query: step.query ?? stringField(locator, "query") ?? stringField(locator, "label") ?? stringField(target, "query"),
    elementId: step.elementId ?? stringField(locator, "elementId") ?? stringField(target, "elementId"),
    selector: step.selector ?? stringField(locator, "selector") ?? stringField(target, "selector"),
    text: step.text ?? stringField(locator, "text") ?? stringField(locator, "label") ?? stringField(target, "text"),
    role: step.role ?? stringField(locator, "role") ?? stringField(target, "role"),
    ariaLabel: step.ariaLabel ?? stringField(locator, "ariaLabel") ?? stringField(target, "ariaLabel"),
    placeholder: step.placeholder ?? stringField(locator, "placeholder") ?? stringField(target, "placeholder"),
    label: step.label ?? stringField(locator, "label") ?? stringField(target, "label"),
    href: step.href ?? stringField(locator, "href") ?? stringField(target, "href"),
    nearText: step.nearText ?? stringField(locator, "nearText") ?? stringField(target, "nearText")
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

function normalizeStepLocators(step: BrowserStep): QaExecutableStep {
  const locator = isRecord(step.locator) ? step.locator : undefined;
  const target = isRecord(step.target) ? step.target : {};
  const testId = stringField(locator, "testId") ?? step.testId ?? stringField(target, "testId");
  const selector = stringField(locator, "selector") ?? step.selector ?? stringField(target, "selector")
    ?? (testId ? `data-testid=${testId}` : undefined);
  const normalized: QaExecutableStep = {
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
  if (isLocatorAwareAction(normalized.action)) {
    normalized._qaLocator = analyzeLocator(normalized);
  }
  return normalized;
}

function isLocatorAwareAction(action: BrowserStep["action"]): boolean {
  return ["click", "hover", "type", "selectOption", "fillForm", "clear", "waitFor", "assertText"].includes(action);
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
): QaNetworkSummary {
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
      title: `${testCase.title} (replay${input.mode === "smart" ? ", smart" : ""})`,
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
    const taskId = safeName(input.taskId ?? testCase.id ?? "recorded-flow");
    const semanticCases = makeRecordedSemanticCases(testCase, recorded.steps ?? []);
    return runQa(bridge, {
      taskId,
      title: input.title ?? testCase.title,
      outputDir: input.outputDir,
      semanticCases,
      cases: [testCase],
      screenshotOnError: true,
      recordReplay: true
    });
  }

  const taskId = safeName(input.taskId ?? testCase.id ?? "recorded-flow");
  const runDir = resolveRunDir(input.outputDir, taskId);
  await ensureDir(runDir);
  const semanticCases = makeRecordedSemanticCases(testCase, recorded.steps ?? []);
  const executableCases = makeExecutableCases({
    taskId,
    title: input.title ?? testCase.title,
    semanticCases,
    cases: [testCase]
  }, normalizeCases({ taskId, title: input.title ?? testCase.title, cases: [testCase] }));
  const recordingAnalysis = makeRecordingAnalysis(recorded.steps ?? [], testCase);
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
  const semanticCasesPath = await writeJson(join(runDir, "semantic-cases.json"), semanticCases);
  const executableCasesPath = await writeJson(join(runDir, "executable-cases.json"), executableCases);
  const recordingAnalysisPath = await writeJson(join(runDir, "recording-analysis.json"), recordingAnalysis);
  const replayPath = await writeJson(join(runDir, "replay.json"), replay);
  return {
    ok: true,
    recordedCount: recorded.count ?? recorded.steps?.length ?? 0,
    case: testCase,
    casePath,
    semanticCases,
    semanticCasesPath,
    executableCasesPath,
    recordingAnalysis,
    recordingAnalysisPath,
    replayPath
  };
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

async function runPreflight(
  bridge: BrowserToolBridge,
  input: QaRunInput,
  diagnosticsDir: string
): Promise<QaPreflightResult> {
  const started = new Date();
  const policy = mergePreflightPolicy(input.preflight);
  const checks: QaPreflightResult["checks"] = [];

  if (!policy.enabled) {
    return {
      status: "skipped",
      startedAt: started.toISOString(),
      finishedAt: started.toISOString(),
      elapsedMs: 0,
      checks: [{
        name: "preflight_enabled",
        status: "skipped",
        message: "预检未启用"
      }]
    };
  }

  if (policy.requireConnected) {
    try {
      const status = await bridge.getStatus();
      checks.push({
        name: "bridge_connected",
        status: status.connected ? "passed" : "failed",
        message: status.connected ? "Browser Bridge 已连接" : "Browser Bridge 未连接",
        details: status
      });
    } catch (caught) {
      checks.push({
        name: "bridge_connected",
        status: "failed",
        message: normalizeError(caught).message
      });
    }
  }

  if (policy.requireActiveTab) {
    try {
      const tab = await bridge.call("browser_get_active_tab", {}, { timeoutMs: 3_000 });
      const hasUrl = isRecord(tab) && typeof tab.url === "string" && tab.url.length > 0;
      checks.push({
        name: "active_tab",
        status: hasUrl ? "passed" : "failed",
        message: hasUrl ? `当前活动标签页：${tab.url}` : "未找到可用活动标签页",
        details: tab
      });
    } catch (caught) {
      checks.push({
        name: "active_tab",
        status: "failed",
        message: normalizeError(caught).message
      });
    }
  }

  if (policy.checkBaseUrlReachable) {
    if (!input.baseUrl) {
      checks.push({
        name: "base_url_reachable",
        status: "failed",
        message: "启用了 baseUrl 可达性检查，但未提供 baseUrl"
      });
    } else {
      try {
        const tab = await bridge.call("browser_open_url", {
          url: input.baseUrl,
          waitUntil: "ready",
          timeoutMs: input.timeoutMs ?? 15_000
        }, { timeoutMs: input.timeoutMs ?? 15_000 });
        checks.push({
          name: "base_url_reachable",
          status: "passed",
          message: `baseUrl 可访问：${input.baseUrl}`,
          details: tab
        });
      } catch (caught) {
        checks.push({
          name: "base_url_reachable",
          status: "failed",
          message: normalizeError(caught).message
        });
      }
    }
  }

  if (policy.failOnExistingConsoleError) {
    try {
      const consoleResult = await bridge.call("browser_console_monitor", { durationMs: 500 }, { timeoutMs: 2_500 });
      const summary = summarizeConsole(consoleResult, {
        failOnConsoleError: true,
        failOnUncaughtException: true
      });
      checks.push({
        name: "existing_console_errors",
        status: summary.failed ? "failed" : "passed",
        message: summary.failed
          ? `页面已有 console 错误：error ${summary.errorCount}，exception ${summary.exceptionCount}`
          : "未检测到既有 console error/exception",
        details: summary
      });
    } catch (caught) {
      checks.push({
        name: "existing_console_errors",
        status: "failed",
        message: normalizeError(caught).message
      });
    }
  }

  const finished = new Date();
  const result: QaPreflightResult = {
    status: checks.some((check) => check.status === "failed") ? "failed" : "passed",
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    elapsedMs: finished.getTime() - started.getTime(),
    checks
  };
  result.diagnostics = await writeJson(join(diagnosticsDir, "preflight.json"), result);
  return result;
}

function mergePreflightPolicy(policy: QaPreflightPolicy | undefined): Required<QaPreflightPolicy> {
  return {
    enabled: policy?.enabled ?? true,
    requireConnected: policy?.requireConnected ?? true,
    requireActiveTab: policy?.requireActiveTab ?? false,
    checkBaseUrlReachable: policy?.checkBaseUrlReachable ?? false,
    failOnExistingConsoleError: policy?.failOnExistingConsoleError ?? false
  };
}

function makePreflightBlockedCase(
  testCase: NormalizedQaCase,
  preflight: QaPreflightResult
): QaCaseResult {
  const failedChecks = preflight.checks.filter((check) => check.status === "failed");
  const message = failedChecks.map((check) => `${check.name}: ${check.message}`).join("；")
    || "执行前预检失败";
  return {
    id: testCase.id,
    title: testCase.title,
    priority: testCase.priority,
    status: "blocked",
    elapsedMs: 0,
    expected: testCase.expected,
    steps: testCase.steps.map(normalizeStepLocators),
    error: {
      code: "PREFLIGHT_FAILED",
      message
    },
    failureCategory: "environment_error",
    artifacts: {
      diagnostics: preflight.diagnostics
    }
  };
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

function makeRunConfig(
  input: QaRunInput,
  taskId: string,
  title: string,
  startedAt: Date
): Record<string, unknown> {
  return {
    version: "1",
    taskId,
    title,
    createdAt: startedAt.toISOString(),
    baseUrl: input.baseUrl,
    prdPath: input.prdPath,
    branch: input.branch,
    compareBranch: input.compareBranch,
    focus: input.focus ?? [],
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
    preflight: input.preflight,
    recordReplay: input.recordReplay,
    maxParallel: input.maxParallel ?? 1
  };
}

function makeRunWorkflowState(
  input: QaRunInput,
  taskId: string,
  title: string,
  startedAt: Date,
  finishedAt: Date,
  paths: QaRunResult["paths"],
  summary: QaSummary
): Record<string, unknown> {
  return {
    version: "1",
    taskId,
    title,
    createdAt: startedAt.toISOString(),
    updatedAt: finishedAt.toISOString(),
    currentPhase: "confirm_result",
    phases: {
      init: {
        status: "confirmed",
        summary: "browser_qa_run received executable cases and run configuration",
        artifacts: {
          runConfig: paths.runConfig
        }
      },
      generate_semantic_cases: {
        status: "confirmed",
        summary: "semantic cases persisted for review traceability",
        artifacts: {
          semanticCases: paths.semanticCases
        }
      },
      generate_executable_cases: {
        status: "confirmed",
        summary: "executable cases persisted for replay and review",
        artifacts: {
          executableCases: paths.executableCases
        }
      },
      run: {
        status: "confirmed",
        summary: `Executed ${summary.total} cases: passed ${summary.passed}, failed ${summary.failed}, blocked ${summary.blocked}`,
        artifacts: {
          summary: paths.summary,
          ciSummary: paths.ciSummary,
          replay: paths.replay
        }
      },
      confirm_result: {
        status: "awaiting_confirmation",
        summary: "User must confirm whether reruns or case adjustments are needed before final report sign-off."
      },
      report: {
        status: "pending",
        artifacts: {
          reportHtml: paths.reportHtml,
          reportMarkdown: paths.reportMarkdown
        }
      }
    },
    inputs: {
      baseUrl: input.baseUrl,
      branch: input.branch,
      compareBranch: input.compareBranch,
      prdPath: input.prdPath,
      focus: input.focus ?? []
    },
    assumptions: [],
    blockers: summary.blocked > 0 ? ["One or more cases are blocked; inspect summary and diagnostics."] : []
  };
}

function makeSemanticCases(input: QaRunInput, cases: NormalizedQaCase[]): QaSemanticCase[] {
  if (input.semanticCases?.length) {
    return input.semanticCases.map((testCase) => ({
      ...testCase,
      id: safeName(testCase.id)
    }));
  }
  return cases.map((testCase) => ({
    id: testCase.id,
    title: testCase.title,
    priority: testCase.priority,
    type: testCase.type,
    steps: testCase.steps.map(describeSemanticStep),
    expected: testCase.expected,
    trace: {
      generatedFrom: "executable-cases"
    }
  }));
}

function makeExecutableCases(input: QaRunInput, cases: NormalizedQaCase[]): Array<Record<string, unknown>> {
  return cases.map((testCase) => ({
    id: testCase.id,
    title: testCase.title,
    priority: testCase.priority,
    type: testCase.type,
    expected: testCase.expected,
    observe: testCase.observe ?? input.observe,
    diagnostics: testCase.diagnostics ?? input.diagnostics,
    trace: {
      semanticCaseId: input.semanticCases?.find((semanticCase) => safeName(semanticCase.id) === testCase.id || semanticCase.id === testCase.id)?.id
    },
    steps: testCase.steps.map(normalizeStepLocators)
  }));
}

function makeRecordedSemanticCases(testCase: QaCaseInput, recordedSteps: RecordedStep[]): QaSemanticCase[] {
  const semanticSteps = testCase.steps
    .filter((step) => step.action !== "screenshot")
    .map(describeSemanticStep);
  return [{
    id: safeName(testCase.id ?? "recorded-flow"),
    title: testCase.title,
    priority: testCase.priority ?? "P1",
    type: "recorded",
    preconditions: inferRecordingPreconditions(recordedSteps),
    steps: semanticSteps.length ? semanticSteps : ["回放用户录制流程"],
    expected: testCase.expected ?? ["录制流程可以成功回放"],
    trace: {
      generatedFrom: "recording",
      recordedStepCount: recordedSteps.length,
      maskedInputCount: recordedSteps.filter(isRecordedSensitive).length
    }
  }];
}

function makeRecordingAnalysis(recordedSteps: RecordedStep[], testCase: QaCaseInput): Record<string, unknown> {
  const maskedSteps = recordedSteps.filter(isRecordedSensitive);
  const locatorStats = new Map<string, number>();
  for (const step of recordedSteps) {
    const strategy = recordedLocatorStrategy(step);
    locatorStats.set(strategy, (locatorStats.get(strategy) ?? 0) + 1);
  }
  return {
    version: "1",
    recordedCount: recordedSteps.length,
    executableStepCount: testCase.steps.length,
    maskedInputCount: maskedSteps.length,
    maskedInputs: maskedSteps.map((step, index) => ({
      index,
      action: step.action,
      placeholder: step.placeholder,
      ariaLabel: step.ariaLabel,
      nearText: step.nearText,
      reason: "sensitive-input"
    })),
    locatorStats: Array.from(locatorStats.entries()).map(([strategy, count]) => ({ strategy, count })),
    locatorWarnings: recordingLocatorWarnings(recordedSteps),
    suggestedAssertions: suggestRecordingAssertions(recordedSteps, testCase),
    notes: [
      "录制转用例默认不立即执行；建议人工确认语义用例和业务断言后再运行。",
      "敏感输入已脱敏，回放前需由执行环境提供安全测试数据。"
    ]
  };
}

function inferRecordingPreconditions(recordedSteps: RecordedStep[]): string[] {
  const preconditions = new Set<string>();
  if (recordedSteps.some((step) => step.url && /^https?:\/\//.test(step.url))) {
    preconditions.add("目标页面可访问");
  }
  if (recordedSteps.some(isRecordedSensitive)) {
    preconditions.add("敏感输入需使用安全测试数据");
  }
  if (recordedSteps.some((step) => /login|登录|auth|权限/i.test(`${step.url ?? ""} ${step.text ?? ""} ${step.nearText ?? ""}`))) {
    preconditions.add("用户已具备对应登录态和权限");
  }
  return Array.from(preconditions);
}

function isRecordedSensitive(step: RecordedStep): boolean {
  if (step.masked) return true;
  const fieldText = `${step.placeholder ?? ""} ${step.ariaLabel ?? ""} ${step.text ?? ""} ${step.selector ?? ""}`;
  return /password|密码|secret|token|验证码|verification|credit.?card|信用卡|身份证|银行卡/i.test(fieldText);
}

function recordedLocatorStrategy(step: RecordedStep): string {
  if (step.testId) return "data-testid";
  if (step.role && (step.text || step.ariaLabel)) return "role+name";
  if (step.ariaLabel) return "ariaLabel";
  if (step.placeholder) return "placeholder";
  if (step.text && step.nearText) return "text+nearText";
  if (step.text || step.query) return "text";
  if (step.selector || step.selectorHint) return "css-selector";
  if (step.nearText) return "nearText";
  return "none";
}

function recordingLocatorWarnings(recordedSteps: RecordedStep[]): string[] {
  const warnings: string[] = [];
  recordedSteps.forEach((step, index) => {
    const strategy = recordedLocatorStrategy(step);
    if (strategy === "css-selector") {
      warnings.push(`#${index + 1}: 使用 CSS selector 兜底，建议补充 testId、role、label 或 placeholder`);
    }
    if (strategy === "text") {
      warnings.push(`#${index + 1}: 仅使用文本定位，文案变化时可能不稳定`);
    }
    if (strategy === "none") {
      warnings.push(`#${index + 1}: 缺少可解释 locator，可能需要人工修复`);
    }
  });
  return warnings;
}

function suggestRecordingAssertions(recordedSteps: RecordedStep[], testCase: QaCaseInput): string[] {
  const suggestions = new Set<string>();
  const lastText = [...recordedSteps].reverse().find((step) => step.text && step.action !== "type")?.text;
  if (lastText) {
    suggestions.add(`确认页面出现关键文本：${lastText}`);
  }
  const submitLike = recordedSteps.find((step) => /submit|提交|保存|确认|完成/i.test(`${step.text ?? ""} ${step.nearText ?? ""}`));
  if (submitLike) {
    suggestions.add("确认提交后出现成功、状态变化或列表更新");
    suggestions.add("确认提交接口无 4xx/5xx 错误");
  }
  if (!testCase.steps.some((step) => step.action === "assertText")) {
    suggestions.add("补充至少一个业务结果断言，避免只验证流程可点击");
  }
  return Array.from(suggestions);
}

function describeSemanticStep(step: BrowserStep): string {
  switch (step.action) {
    case "open":
      return `打开页面 ${step.url ?? ""}`.trim();
    case "click":
      return `点击 ${step.text ?? step.query ?? step.label ?? step.placeholder ?? step.selector ?? "目标元素"}`;
    case "type":
      return `输入 ${step.value ?? step.text ?? "内容"} 到 ${step.label ?? step.placeholder ?? step.query ?? step.selector ?? "目标输入框"}`;
    case "selectOption":
      return `在 ${step.label ?? step.text ?? "下拉项"} 中选择 ${step.option ?? step.value ?? ""}`.trim();
    case "assertText":
      return `确认页面出现 ${step.contains ?? step.text ?? "预期文本"}`;
    case "waitFor":
      return `等待 ${step.text ?? step.query ?? step.selector ?? "目标状态"}`;
    default:
      return step.description ?? `执行 ${step.action}`;
  }
}

function makeSmartReplaySteps(steps: BrowserStep[]): BrowserStep[] {
  return steps.map((step) => {
    if (!["click", "type", "hover", "clear", "waitFor", "selectOption"].includes(step.action)) {
      return step;
    }
    const fallbacks = buildSmartReplayFallbacks(step);
    const query = step.query
      ?? step.text
      ?? step.label
      ?? step.placeholder
      ?? step.ariaLabel
      ?? step.nearText
      ?? step.selector;
    return {
      ...step,
      query,
      strict: false,
      visibleOnly: step.visibleOnly ?? true,
      timeoutMs: step.timeoutMs ?? 10_000,
      _qaReplay: {
        mode: "smart",
        original: replayOriginalLocator(step),
        fallbacks,
        reason: "补充语义 locator fallback，提高回放时对轻微文案或结构变化的容忍度",
        confidence: smartReplayConfidence(step, fallbacks),
        semanticChanged: false
      }
    };
  });
}

function buildSmartReplayFallbacks(step: BrowserStep): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  const testId = step.testId ?? stringField(isRecord(step.locator) ? step.locator : undefined, "testId");
  const role = step.role ?? stringField(isRecord(step.locator) ? step.locator : undefined, "role");
  const text = step.text ?? step.label ?? stringField(isRecord(step.locator) ? step.locator : undefined, "text") ?? stringField(isRecord(step.locator) ? step.locator : undefined, "label");
  const ariaLabel = step.ariaLabel ?? stringField(isRecord(step.locator) ? step.locator : undefined, "ariaLabel");
  const placeholder = step.placeholder ?? stringField(isRecord(step.locator) ? step.locator : undefined, "placeholder");
  const nearText = step.nearText ?? stringField(isRecord(step.locator) ? step.locator : undefined, "nearText");
  const selector = step.selector ?? stringField(isRecord(step.locator) ? step.locator : undefined, "selector");

  if (testId) candidates.push({ strategy: "data-testid", testId, selector: `data-testid=${testId}` });
  if (role && text) candidates.push({ strategy: "role+text", role, text });
  if (ariaLabel) candidates.push({ strategy: "ariaLabel", ariaLabel });
  if (placeholder) candidates.push({ strategy: "placeholder", placeholder });
  if (text && nearText) candidates.push({ strategy: "text+nearText", text, nearText });
  if (text) candidates.push({ strategy: "text", text });
  if (nearText) candidates.push({ strategy: "nearText", nearText });
  if (selector) candidates.push({ strategy: "css-selector", selector });

  return dedupeFallbacks(candidates);
}

function replayOriginalLocator(step: BrowserStep): Record<string, unknown> {
  return {
    query: step.query,
    elementId: step.elementId,
    selector: step.selector,
    testId: step.testId,
    text: step.text,
    role: step.role,
    ariaLabel: step.ariaLabel,
    placeholder: step.placeholder,
    label: step.label,
    href: step.href,
    nearText: step.nearText,
    locator: step.locator,
    target: step.target
  };
}

function smartReplayConfidence(step: BrowserStep, fallbacks: Record<string, unknown>[]): number {
  if (fallbacks.some((fallback) => fallback.strategy === "data-testid")) return 0.95;
  if (fallbacks.some((fallback) => fallback.strategy === "role+text")) return 0.85;
  if (fallbacks.some((fallback) => fallback.strategy === "placeholder" || fallback.strategy === "ariaLabel")) return 0.78;
  if (fallbacks.some((fallback) => fallback.strategy === "text+nearText")) return 0.72;
  if (step.selector) return 0.55;
  return 0.45;
}

function dedupeFallbacks(values: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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
