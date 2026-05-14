import { z } from "zod";
import { type BridgeRequest, type BrowserStatus } from "@browser-bridge/shared";

export type BrowserToolBridge = {
  getStatus: () => BrowserStatus | Promise<BrowserStatus>;
  call: <T = unknown>(
    tool: BridgeRequest["tool"],
    params?: Record<string, unknown>,
    options?: { tabId?: number; timeoutMs?: number }
  ) => Promise<T>;
};

const optionalTabId = z.object({
  tabId: z.number().int().positive().optional()
});

const clickSchema = optionalTabId.extend({
  elementId: z.string().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  placeholder: z.string().optional(),
  href: z.string().optional()
});

const typeSchema = optionalTabId.extend({
  elementId: z.string().optional(),
  selector: z.string().optional(),
  ariaLabel: z.string().optional(),
  placeholder: z.string().optional(),
  text: z.string()
});

const clearSchema = optionalTabId.extend({
  elementId: z.string().optional(),
  selector: z.string().optional(),
  placeholder: z.string().optional(),
  ariaLabel: z.string().optional()
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

export function createBrowserTools(bridge: BrowserToolBridge): BrowserToolDefinition[] {
  return [
    {
      name: "browser_status",
      description: "返回 Chrome 插件是否已连接到本地浏览器桥接服务。",
      inputSchema: schema({}),
      handler: async () => bridge.getStatus()
    },
    {
      name: "browser_get_active_tab",
      description: "返回当前活动的 Chrome 标签页。",
      inputSchema: schema({}),
      handler: async () => bridge.call("browser_get_active_tab")
    },
    {
      name: "browser_get_page_text",
      description: "返回当前标签页或指定标签页中的可见文本。",
      inputSchema: schema({ tabId: { type: "number" } }),
      handler: async (args) => {
        const parsed = optionalTabId.parse(args ?? {});
        return bridge.call("browser_get_page_text", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_get_page_snapshot",
      description: "返回页面标题、URL、可见文本和可操作元素列表。",
      inputSchema: schema({ tabId: { type: "number" } }),
      handler: async (args) => {
        const parsed = optionalTabId.parse(args ?? {});
        return bridge.call("browser_get_page_snapshot", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_get_selected_text",
      description: "返回页面中当前选中的文本。",
      inputSchema: schema({ tabId: { type: "number" } }),
      handler: async (args) => {
        const parsed = optionalTabId.parse(args ?? {});
        return bridge.call("browser_get_selected_text", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_get_links",
      description: "返回页面中的链接列表。",
      inputSchema: schema({ tabId: { type: "number" } }),
      handler: async (args) => {
        const parsed = optionalTabId.parse(args ?? {});
        return bridge.call("browser_get_links", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_get_audit_log",
      description: "返回最近的浏览器桥接审计日志。",
      inputSchema: schema({ limit: { type: "number" } }),
      handler: async (args) => bridge.call("browser_get_audit_log", (args ?? {}) as Record<string, unknown>)
    },
    {
      name: "browser_screenshot",
      description: "截取当前标签页或指定标签页的可视区域。",
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
      description: "通过 elementId、选择器或可见文本点击页面元素。",
      inputSchema: schema({
        tabId: { type: "number" },
        elementId: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" },
        role: { type: "string" },
        ariaLabel: { type: "string" },
        placeholder: { type: "string" },
        href: { type: "string" }
      }),
      handler: async (args) => {
        const parsed = clickSchema.parse(args ?? {});
        return bridge.call("browser_click", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_list_tabs",
      description: "列出已打开的 Chrome 标签页。",
      inputSchema: schema({}),
      handler: async () => bridge.call("browser_list_tabs")
    },
    {
      name: "browser_open_url",
      description: "在新的 Chrome 标签页中打开 URL。",
      inputSchema: schema({ url: { type: "string" } }, ["url"]),
      handler: async (args) => bridge.call("browser_open_url", openUrlSchema.parse(args ?? {}))
    },
    {
      name: "browser_activate_tab",
      description: "通过 tabId 激活指定 Chrome 标签页。",
      inputSchema: schema({ tabId: { type: "number" } }, ["tabId"]),
      handler: async (args) => bridge.call("browser_activate_tab", activateTabSchema.parse(args ?? {}))
    },
    {
      name: "browser_type",
      description: "通过 elementId 或选择器向页面元素输入文本。",
      inputSchema: schema({
        tabId: { type: "number" },
        elementId: { type: "string" },
        selector: { type: "string" },
        ariaLabel: { type: "string" },
        placeholder: { type: "string" },
        text: { type: "string" }
      }, ["text"]),
      handler: async (args) => {
        const parsed = typeSchema.parse(args ?? {});
        return bridge.call("browser_type", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_clear",
      description: "通过 elementId 或选择器清空输入元素。",
      inputSchema: schema({
        tabId: { type: "number" },
        elementId: { type: "string" },
        selector: { type: "string" },
        ariaLabel: { type: "string" },
        placeholder: { type: "string" }
      }),
      handler: async (args) => {
        const parsed = clearSchema.parse(args ?? {});
        return bridge.call("browser_clear", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_scroll",
      description: "向上、向下、向左或向右滚动页面。",
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
      description: "等待匹配选择器或可见文本的元素出现。",
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
