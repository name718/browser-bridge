import { z } from "zod";
import { type BrowserBridge } from "../bridge/browser-bridge.js";

const optionalTabId = z.object({
  tabId: z.number().int().positive().optional()
});

const clickSchema = optionalTabId.extend({
  elementId: z.string().optional(),
  selector: z.string().optional(),
  text: z.string().optional()
});

const typeSchema = optionalTabId.extend({
  elementId: z.string().optional(),
  selector: z.string().optional(),
  text: z.string()
});

const clearSchema = optionalTabId.extend({
  elementId: z.string().optional(),
  selector: z.string().optional()
});

const openUrlSchema = z.object({
  url: z.string().url()
});

const activateTabSchema = z.object({
  tabId: z.number().int().positive()
});

const scrollSchema = optionalTabId.extend({
  direction: z.enum(["up", "down", "left", "right"]),
  amount: z.number().positive().optional()
});

const waitForSchema = optionalTabId.extend({
  selector: z.string().optional(),
  text: z.string().optional(),
  timeoutMs: z.number().int().positive().optional()
});

const screenshotSchema = optionalTabId.extend({
  format: z.enum(["png", "jpeg"]).optional(),
  quality: z.number().int().min(0).max(100).optional()
});

export type BrowserToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown) => Promise<unknown>;
};

export function createBrowserTools(bridge: BrowserBridge): BrowserToolDefinition[] {
  return [
    {
      name: "browser_status",
      description: "Return whether the Chrome extension is connected to the local Browser Bridge.",
      inputSchema: schema({}),
      handler: async () => bridge.getStatus()
    },
    {
      name: "browser_get_active_tab",
      description: "Return the active Chrome tab.",
      inputSchema: schema({}),
      handler: async () => bridge.call("browser_get_active_tab")
    },
    {
      name: "browser_get_page_text",
      description: "Return visible text from the active tab or a specified tab.",
      inputSchema: schema({ tabId: { type: "number" } }),
      handler: async (args) => {
        const parsed = optionalTabId.parse(args ?? {});
        return bridge.call("browser_get_page_text", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_get_page_snapshot",
      description: "Return title, URL, visible text, and actionable elements from a page.",
      inputSchema: schema({ tabId: { type: "number" } }),
      handler: async (args) => {
        const parsed = optionalTabId.parse(args ?? {});
        return bridge.call("browser_get_page_snapshot", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_screenshot",
      description: "Capture the visible viewport of the active tab or a specified tab.",
      inputSchema: schema({
        tabId: { type: "number" },
        format: { type: "string", enum: ["png", "jpeg"] },
        quality: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = screenshotSchema.parse(args ?? {});
        return bridge.call("browser_screenshot", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_click",
      description: "Click an element by elementId, selector, or visible text.",
      inputSchema: schema({
        tabId: { type: "number" },
        elementId: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" }
      }),
      handler: async (args) => {
        const parsed = clickSchema.parse(args ?? {});
        return bridge.call("browser_click", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_list_tabs",
      description: "List open Chrome tabs.",
      inputSchema: schema({}),
      handler: async () => bridge.call("browser_list_tabs")
    },
    {
      name: "browser_open_url",
      description: "Open a URL in a new Chrome tab.",
      inputSchema: schema({ url: { type: "string" } }, ["url"]),
      handler: async (args) => bridge.call("browser_open_url", openUrlSchema.parse(args ?? {}))
    },
    {
      name: "browser_activate_tab",
      description: "Activate a Chrome tab by tabId.",
      inputSchema: schema({ tabId: { type: "number" } }, ["tabId"]),
      handler: async (args) => bridge.call("browser_activate_tab", activateTabSchema.parse(args ?? {}))
    },
    {
      name: "browser_type",
      description: "Type text into an element by elementId or selector.",
      inputSchema: schema({
        tabId: { type: "number" },
        elementId: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" }
      }, ["text"]),
      handler: async (args) => {
        const parsed = typeSchema.parse(args ?? {});
        return bridge.call("browser_type", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_clear",
      description: "Clear an input element by elementId or selector.",
      inputSchema: schema({
        tabId: { type: "number" },
        elementId: { type: "string" },
        selector: { type: "string" }
      }),
      handler: async (args) => {
        const parsed = clearSchema.parse(args ?? {});
        return bridge.call("browser_clear", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_scroll",
      description: "Scroll the page up, down, left, or right.",
      inputSchema: schema({
        tabId: { type: "number" },
        direction: { type: "string", enum: ["up", "down", "left", "right"] },
        amount: { type: "number" }
      }, ["direction"]),
      handler: async (args) => {
        const parsed = scrollSchema.parse(args ?? {});
        return bridge.call("browser_scroll", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_wait_for",
      description: "Wait for an element matching a selector or visible text.",
      inputSchema: schema({
        tabId: { type: "number" },
        selector: { type: "string" },
        text: { type: "string" },
        timeoutMs: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = waitForSchema.parse(args ?? {});
        return bridge.call("browser_wait_for", parsed, {
          tabId: parsed.tabId,
          timeoutMs: parsed.timeoutMs
        });
      }
    }
  ];
}

function schema(
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}
