import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createQaTools } from "../../packages/mcp-server/src/qa/qa-tools";
import { type BrowserToolBridge } from "../../packages/mcp-server/src/tools/browser-tools";
import { readJson, writeJson } from "../../packages/mcp-server/src/qa/artifacts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("browser_qa_run scripted execution", () => {
  it("normalizes locator steps, captures scripted evidence, and reports diagnostics", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "browser-bridge-qa-"));
    tempDirs.push(outputDir);

    const calls: Array<{ tool: string; params?: Record<string, unknown> }> = [];
    const bridge = createMockBridge(async (tool, params) => {
      calls.push({ tool, params });
      if (tool === "browser_run_steps") {
        return {
          ok: false,
          stoppedAt: 1,
          tabId: 1,
          results: [
            { index: 0, action: "open", ok: true, elapsedMs: 5, tabId: 1, data: { tabId: 1 } },
            {
              index: 1,
              action: "click",
              ok: false,
              elapsedMs: 7,
              tabId: 1,
              error: { code: "ELEMENT_NOT_FOUND", message: "无法定位目标元素" }
            }
          ]
        };
      }
      if (tool === "browser_get_page_model") {
        return { title: "Refund", interactives: [{ text: "确认提交", role: "button" }] };
      }
      if (tool === "browser_screenshot") {
        return {
          dataUrl: "data:image/png;base64,aGVsbG8=",
          mimeType: "image/png",
          url: "https://example.test/refund",
          title: "Refund"
        };
      }
      if (tool === "browser_console_monitor") {
        return { logs: [{ type: "error", text: "boom" }] };
      }
      if (tool === "browser_network_analysis") {
        return { requests: [{ url: "/api/refund", status: 500, durationMs: 1200 }] };
      }
      if (tool === "browser_get_active_tab") {
        return { id: 1, url: "https://example.test/refund", title: "Refund" };
      }
      throw new Error(`Unexpected tool ${tool}`);
    });

    const qaRun = createQaTools(bridge).find((tool) => tool.name === "browser_qa_run");
    expect(qaRun).toBeDefined();

    const result = await qaRun!.handler({
      taskId: "scripted-run",
      title: "Scripted Run",
      outputDir,
      cases: [
        {
          id: "TC-001",
          title: "提交退款",
          priority: "P0",
          steps: [
            { action: "open", url: "https://example.test/refund" },
            {
              action: "click",
              locator: {
                testId: "refund-submit",
                role: "button",
                text: "提交"
              }
            }
          ]
        }
      ],
      observe: {
        before: ["pageModel"],
        afterEachStep: true,
        onFailure: ["screenshot", "console", "network", "pageModel"],
        final: ["screenshot", "console"]
      },
      diagnostics: {
        failOnConsoleError: true,
        failOnUncaughtException: true,
        failOnNetworkError: true,
        slowRequestThresholdMs: 1000
      },
      summaryOnly: true
    });

    const runResult = result as any;
    expect(runResult.ok).toBe(false);
    expect(runResult.summary.failed).toBe(1);
    expect(runResult.cases[0].failureCategory).toBe("console_error");
    expect(runResult.paths.pageModelsDir).toContain("page-models");
    expect(runResult.paths.diagnosticsDir).toContain("diagnostics");
    expect(runResult.paths.runConfig).toContain("run-config.json");
    expect(runResult.paths.semanticCases).toContain("semantic-cases.json");
    expect(runResult.paths.executableCases).toContain("executable-cases.json");
    expect(runResult.paths.workflowState).toContain("workflow-state.json");

    const runStepsCall = calls.find((call) => call.tool === "browser_run_steps");
    expect(runStepsCall?.params?.trace).toBe(true);
    const steps = runStepsCall?.params?.steps as Array<Record<string, unknown>>;
    expect(steps[1]).toMatchObject({
      selector: "data-testid=refund-submit",
      testId: "refund-submit",
      role: "button",
      text: "提交",
      _qaLocator: {
        strategy: "data-testid"
      }
    });

    const summary = await readJson<any>(runResult.paths.summary);
    expect(summary.cases[0].artifacts.beforePageModel).toContain("TC-001-before.json");
    expect(summary.cases[0].artifacts.failurePageModel).toContain("TC-001-failure.json");
    expect(summary.cases[0].artifacts.failureScreenshot.path).toContain("TC-001-failure.png");
    expect(summary.cases[0].artifacts.consoleSummary.failed).toBe(true);
    expect(summary.cases[0].artifacts.networkSummary.failed).toBe(true);
    expect(summary.cases[0].artifacts.diagnostics).toContain("TC-001.json");
    expect(summary.cases[0].artifacts.diagnosticsSummary).toMatchObject({
      category: "console_error",
      failedStep: {
        index: 1,
        action: "click"
      },
      currentPage: {
        url: "https://example.test/refund"
      },
      locator: {
        strategy: "data-testid"
      },
      evidence: {
        screenshot: true,
        pageModel: true,
        console: true,
        network: true
      }
    });
    expect(summary.preflight.status).toBe("passed");
    expect(summary.preflight.diagnostics).toContain("preflight.json");

    const diagnostics = await readJson<any>(summary.cases[0].artifacts.diagnostics);
    expect(diagnostics.failedStepInput).toMatchObject({
      selector: "data-testid=refund-submit",
      testId: "refund-submit"
    });
    expect(diagnostics.stepTimeline).toHaveLength(2);

    const runConfig = await readJson<any>(runResult.paths.runConfig);
    expect(runConfig).toMatchObject({
      taskId: "scripted-run",
      title: "Scripted Run"
    });
    const semanticCases = await readJson<any[]>(runResult.paths.semanticCases);
    expect(semanticCases[0]).toMatchObject({
      id: "TC-001",
      title: "提交退款"
    });
    expect(semanticCases[0].steps[0]).toContain("打开页面");
    const executableCases = await readJson<any[]>(runResult.paths.executableCases);
    expect(executableCases[0].steps[1]._qaLocator.strategy).toBe("data-testid");
    const workflowState = await readJson<any>(runResult.paths.workflowState);
    expect(workflowState).toMatchObject({
      currentPhase: "confirm_result",
      phases: {
        run: {
          status: "confirmed"
        },
        confirm_result: {
          status: "awaiting_confirmation"
        }
      }
    });

    const ciSummary = await readJson<any>(runResult.paths.ciSummary);
    expect(ciSummary.releaseDecision).toMatchObject({
      level: "block",
      label: "不建议发布"
    });
    expect(ciSummary.failureStats).toContainEqual({
      category: "frontend_bug",
      count: 1
    });
    expect(ciSummary.failures[0]).toMatchObject({
      decisionCategory: "frontend_bug"
    });
    expect(ciSummary.evidenceGaps).toEqual([]);
  });

  it("adds locator metadata and warnings for selector fallback steps", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "browser-bridge-qa-"));
    tempDirs.push(outputDir);

    const bridge = createMockBridge(async (tool) => {
      if (tool === "browser_run_steps") {
        return {
          ok: true,
          tabId: 1,
          results: [
            { index: 0, action: "click", ok: true, elapsedMs: 3, tabId: 1, data: {} }
          ]
        };
      }
      throw new Error(`Unexpected tool ${tool}`);
    });

    const qaRun = createQaTools(bridge).find((tool) => tool.name === "browser_qa_run");
    expect(qaRun).toBeDefined();

    const result = await qaRun!.handler({
      taskId: "locator-metadata",
      title: "Locator Metadata",
      outputDir,
      preflight: { enabled: false },
      cases: [
        {
          id: "TC-LOC",
          title: "CSS selector fallback",
          steps: [
            { action: "click", selector: ".ant-modal .footer > button:nth-child(2)" }
          ]
        }
      ],
      observe: {
        final: []
      }
    });

    const runResult = result as any;
    expect(runResult.ok).toBe(true);
    expect(runResult.cases[0].steps[0]._qaLocator).toMatchObject({
      strategy: "css-selector"
    });
    expect(runResult.cases[0].steps[0]._qaLocator.warnings.join(" ")).toContain("DOM 结构");

    const ciSummary = await readJson<any>(runResult.paths.ciSummary);
    expect(ciSummary.failures).toHaveLength(0);
    expect(ciSummary.releaseDecision).toMatchObject({
      level: "pass",
      label: "可发布"
    });
  });

  it("persists provided semantic cases separately from executable cases", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "browser-bridge-qa-"));
    tempDirs.push(outputDir);

    const bridge = createMockBridge(async (tool) => {
      if (tool === "browser_run_steps") {
        return {
          ok: true,
          tabId: 1,
          results: [
            { index: 0, action: "assertText", ok: true, elapsedMs: 2, tabId: 1, data: {} }
          ]
        };
      }
      throw new Error(`Unexpected tool ${tool}`);
    });

    const qaRun = createQaTools(bridge).find((tool) => tool.name === "browser_qa_run");
    expect(qaRun).toBeDefined();

    const result = await qaRun!.handler({
      taskId: "semantic-assets",
      title: "Semantic Assets",
      outputDir,
      preflight: { enabled: false },
      semanticCases: [
        {
          id: "semantic-001",
          title: "用户看到提交成功状态",
          priority: "P0",
          preconditions: ["用户已登录"],
          steps: ["打开详情页", "确认出现提交成功"],
          expected: ["页面展示提交成功"]
        }
      ],
      cases: [
        {
          id: "semantic-001",
          title: "用户看到提交成功状态",
          priority: "P0",
          steps: [{ action: "assertText", contains: "提交成功" }],
          expected: ["页面展示提交成功"]
        }
      ]
    });

    const runResult = result as any;
    const semanticCases = await readJson<any[]>(runResult.paths.semanticCases);
    const executableCases = await readJson<any[]>(runResult.paths.executableCases);
    expect(semanticCases[0]).toMatchObject({
      id: "semantic-001",
      preconditions: ["用户已登录"],
      steps: ["打开详情页", "确认出现提交成功"]
    });
    expect(executableCases[0]).toMatchObject({
      id: "semantic-001",
      trace: {
        semanticCaseId: "semantic-001"
      }
    });
    expect(executableCases[0].steps[0]).toMatchObject({
      action: "assertText",
      contains: "提交成功"
    });
  });

  it("blocks cases when preflight fails before running scripted steps", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "browser-bridge-qa-"));
    tempDirs.push(outputDir);

    const calls: Array<{ tool: string; params?: Record<string, unknown> }> = [];
    const bridge: BrowserToolBridge = {
      getStatus: async () => ({ connected: false, protocolVersion: "test" }),
      setVariable: async () => undefined,
      getVariable: async () => undefined,
      getAllVariables: async () => ({}),
      clearVariables: async () => undefined,
      call: async (tool, params) => {
        calls.push({ tool, params });
        throw new Error(`Unexpected tool ${tool}`);
      }
    };

    const qaRun = createQaTools(bridge).find((tool) => tool.name === "browser_qa_run");
    expect(qaRun).toBeDefined();

    const result = await qaRun!.handler({
      taskId: "preflight-failed",
      title: "Preflight Failed",
      outputDir,
      cases: [
        {
          id: "TC-PRE",
          title: "不会执行的用例",
          priority: "P0",
          steps: [{ action: "open", url: "https://example.test" }]
        }
      ]
    });

    const runResult = result as any;
    expect(runResult.ok).toBe(false);
    expect(runResult.summary.blocked).toBe(1);
    expect(runResult.preflight.status).toBe("failed");
    expect(runResult.cases[0]).toMatchObject({
      status: "blocked",
      failureCategory: "environment_error",
      error: {
        code: "PREFLIGHT_FAILED"
      }
    });
    expect(calls.find((call) => call.tool === "browser_run_steps")).toBeUndefined();

    const summary = await readJson<any>(runResult.paths.summary);
    expect(summary.preflight.checks[0]).toMatchObject({
      name: "bridge_connected",
      status: "failed"
    });
  });

  it("converts recordings into semantic and executable assets with masking analysis", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "browser-bridge-qa-"));
    tempDirs.push(outputDir);

    const bridge = createMockBridge(async (tool) => {
      if (tool === "browser_get_recorded_steps") {
        return {
          count: 4,
          steps: [
            { action: "click", url: "https://example.test/login", text: "登录", role: "button" },
            { action: "input", placeholder: "密码", value: "secret123", selector: "input[type=password]" },
            { action: "click", text: "提交", role: "button", nearText: "登录" },
            { action: "click", selectorHint: ".table .row:nth-child(1) .detail" }
          ]
        };
      }
      throw new Error(`Unexpected tool ${tool}`);
    });

    const fromRecording = createQaTools(bridge).find((tool) => tool.name === "browser_qa_from_recording");
    expect(fromRecording).toBeDefined();

    const result = await fromRecording!.handler({
      taskId: "recorded-assets",
      title: "Recorded Assets",
      outputDir,
      expected: ["登录流程可完成"]
    }) as any;

    expect(result.ok).toBe(true);
    expect(result.semanticCasesPath).toContain("semantic-cases.json");
    expect(result.executableCasesPath).toContain("executable-cases.json");
    expect(result.recordingAnalysisPath).toContain("recording-analysis.json");

    const semanticCases = await readJson<any[]>(result.semanticCasesPath);
    expect(semanticCases[0]).toMatchObject({
      id: "recorded-assets",
      type: "recorded",
      expected: ["登录流程可完成"]
    });
    expect(semanticCases[0].preconditions).toContain("敏感输入需使用安全测试数据");

    const executableCases = await readJson<any[]>(result.executableCasesPath);
    expect(executableCases[0].steps.some((step: any) => step.action === "screenshot")).toBe(true);
    const typeStep = executableCases[0].steps.find((step: any) => step.action === "type");
    expect(typeStep).toMatchObject({
      action: "type",
      value: "",
      _qaLocator: {
        strategy: "placeholder"
      }
    });

    const analysis = await readJson<any>(result.recordingAnalysisPath);
    expect(analysis.maskedInputCount).toBe(1);
    expect(analysis.suggestedAssertions).toContain("补充至少一个业务结果断言，避免只验证流程可点击");
    expect(analysis.locatorWarnings.join(" ")).toContain("CSS selector");
  });

  it("adds auditable locator fallbacks for smart replay", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "browser-bridge-qa-"));
    tempDirs.push(outputDir);
    const replayPath = await writeJson(join(outputDir, "replay.json"), {
      version: "1",
      taskId: "smart-replay",
      title: "Smart Replay",
      baseUrl: "https://example.test",
      createdAt: new Date().toISOString(),
      cases: [
        {
          id: "TC-SMART",
          title: "智能回放",
          priority: "P1",
          expected: ["可点击提交"],
          steps: [
            {
              action: "click",
              role: "button",
              text: "提交",
              nearText: "退款",
              selector: ".footer > button:nth-child(2)"
            }
          ]
        }
      ]
    });

    let runStepsParams: Record<string, unknown> | undefined;
    const bridge = createMockBridge(async (tool, params) => {
      if (tool === "browser_run_steps") {
        runStepsParams = params;
        return {
          ok: true,
          tabId: 1,
          results: [
            { index: 0, action: "click", ok: true, elapsedMs: 2, tabId: 1, data: {} }
          ]
        };
      }
      throw new Error(`Unexpected tool ${tool}`);
    });

    const replay = createQaTools(bridge).find((tool) => tool.name === "browser_qa_replay");
    expect(replay).toBeDefined();

    const result = await replay!.handler({
      replayPath,
      mode: "smart",
      outputDir,
      stopOnError: true
    }) as any;

    expect(result.ok).toBe(true);
    const steps = runStepsParams?.steps as any[];
    expect(steps[0]).toMatchObject({
      strict: false,
      visibleOnly: true,
      query: "提交",
      _qaReplay: {
        mode: "smart",
        semanticChanged: false
      }
    });
    expect(steps[0]._qaReplay.fallbacks).toEqual(expect.arrayContaining([
      expect.objectContaining({ strategy: "role+text", role: "button", text: "提交" }),
      expect.objectContaining({ strategy: "text+nearText", text: "提交", nearText: "退款" }),
      expect.objectContaining({ strategy: "css-selector", selector: ".footer > button:nth-child(2)" })
    ]));
    expect(steps[0]._qaReplay.confidence).toBeGreaterThanOrEqual(0.85);
    const executableCases = await readJson<any[]>(result.paths.executableCases);
    expect(executableCases[0].steps[0]._qaReplay.semanticChanged).toBe(false);
  });
});

function createMockBridge(
  handler: (tool: string, params?: Record<string, unknown>) => Promise<unknown>
): BrowserToolBridge {
  return {
    getStatus: async () => ({ connected: true, protocolVersion: "test" }),
    setVariable: async () => undefined,
    getVariable: async () => undefined,
    getAllVariables: async () => ({}),
    clearVariables: async () => undefined,
    call: async <T = unknown>(tool: any, params?: Record<string, unknown>) => handler(tool, params) as Promise<T>
  };
}
