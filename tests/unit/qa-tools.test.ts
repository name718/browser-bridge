import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createQaTools } from "../../packages/mcp-server/src/qa/qa-tools";
import { type BrowserToolBridge } from "../../packages/mcp-server/src/tools/browser-tools";
import { readJson } from "../../packages/mcp-server/src/qa/artifacts";

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

    const runStepsCall = calls.find((call) => call.tool === "browser_run_steps");
    expect(runStepsCall?.params?.trace).toBe(true);
    const steps = runStepsCall?.params?.steps as Array<Record<string, unknown>>;
    expect(steps[1]).toMatchObject({
      selector: "data-testid=refund-submit",
      testId: "refund-submit",
      role: "button",
      text: "提交"
    });

    const summary = await readJson<any>(runResult.paths.summary);
    expect(summary.cases[0].artifacts.beforePageModel).toContain("TC-001-before.json");
    expect(summary.cases[0].artifacts.failurePageModel).toContain("TC-001-failure.json");
    expect(summary.cases[0].artifacts.failureScreenshot.path).toContain("TC-001-failure.png");
    expect(summary.cases[0].artifacts.consoleSummary.failed).toBe(true);
    expect(summary.cases[0].artifacts.networkSummary.failed).toBe(true);
    expect(summary.cases[0].artifacts.diagnostics).toContain("TC-001.json");
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
    call: async (tool, params) => handler(tool, params)
  };
}
