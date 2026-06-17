import { describe, expect, it } from "vitest";
import { createBrowserTools, type BrowserToolBridge } from "../../packages/mcp-server/src/tools/browser-tools";

describe("browser_request tool", () => {
  it("forwards page request params to the bridge", async () => {
    const calls: Array<{
      tool: string;
      params?: Record<string, unknown>;
      options?: { tabId?: number; timeoutMs?: number };
    }> = [];
    const bridge: BrowserToolBridge = {
      getStatus: async () => ({ connected: true, protocolVersion: "test" }),
      setVariable: async () => undefined,
      getVariable: async () => undefined,
      getAllVariables: async () => ({}),
      clearVariables: async () => undefined,
      call: async (tool, params, options) => {
        calls.push({ tool, params, options });
        return { ok: true };
      }
    };

    const requestTool = createBrowserTools(bridge).find((tool) => tool.name === "browser_request");
    expect(requestTool).toBeDefined();

    const result = await requestTool!.handler({
      tabId: 7,
      url: "/copywriter/productDemand/queryListWithCopy",
      method: "POST",
      headers: { "x-requested-with": "browser-bridge" },
      body: { productId: "41943" },
      credentials: "include",
      responseType: "json",
      timeoutMs: 12000
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        tool: "browser_request",
        params: {
          tabId: 7,
          url: "/copywriter/productDemand/queryListWithCopy",
          method: "POST",
          headers: { "x-requested-with": "browser-bridge" },
          body: { productId: "41943" },
          credentials: "include",
          responseType: "json",
          timeoutMs: 12000
        },
        options: {
          tabId: 7,
          timeoutMs: 12000
        }
      }
    ]);
  });
});
