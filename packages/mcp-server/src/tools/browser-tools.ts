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
  query: z.string().optional(),
  elementId: z.string().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  placeholder: z.string().optional(),
  href: z.string().optional(),
  nearText: z.string().optional(),
  visibleOnly: z.boolean().optional(),
  viewportOnly: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional()
});

const typeSchema = optionalTabId.extend({
  query: z.string().optional(),
  elementId: z.string().optional(),
  selector: z.string().optional(),
  ariaLabel: z.string().optional(),
  placeholder: z.string().optional(),
  text: z.string(),
  replace: z.boolean().optional(),
  nearText: z.string().optional(),
  visibleOnly: z.boolean().optional(),
  viewportOnly: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional()
});

const clearSchema = optionalTabId.extend({
  query: z.string().optional(),
  elementId: z.string().optional(),
  selector: z.string().optional(),
  placeholder: z.string().optional(),
  ariaLabel: z.string().optional(),
  nearText: z.string().optional(),
  visibleOnly: z.boolean().optional(),
  viewportOnly: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional()
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
  query: z.string().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  placeholder: z.string().optional(),
  nearText: z.string().optional(),
  timeoutMs: z.number().int().positive().optional()
});

const findSchema = optionalTabId.extend({
  query: z.string().optional(),
  text: z.string().optional(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  placeholder: z.string().optional(),
  href: z.string().optional(),
  selector: z.string().optional(),
  elementId: z.string().optional(),
  nearText: z.string().optional(),
  visibleOnly: z.boolean().optional(),
  viewportOnly: z.boolean().optional(),
  limit: z.number().int().positive().max(50).optional(),
  timeoutMs: z.number().int().positive().optional()
});

const pressKeySchema = optionalTabId.extend({
  key: z.string()
});

const assertTextSchema = optionalTabId.extend({
  text: z.string().optional(),
  contains: z.string().optional(),
  timeoutMs: z.number().int().positive().optional()
});

const getInteractivesSchema = optionalTabId.extend({
  limit: z.number().int().positive().max(200).optional(),
  viewportOnly: z.boolean().optional()
});

const screenshotSchema = optionalTabId.extend({
  format: z.enum(["png", "jpeg"]).optional(),
  quality: z.number().int().min(0).max(100).optional()
});

const stepTargetSchema = z.object({
  query: z.string().optional(),
  elementId: z.string().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  placeholder: z.string().optional(),
  href: z.string().optional(),
  nearText: z.string().optional()
}).partial();

const formFieldSchema = stepTargetSchema.extend({
  value: z.string(),
  replace: z.boolean().optional()
});

const fillFormSchema = optionalTabId.extend({
  fields: z.array(formFieldSchema).min(1).max(30),
  timeoutMs: z.number().int().positive().optional()
});

const runStepSchema = stepTargetSchema.extend({
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
    "snapshot",
    "screenshot",
    "sleep"
  ]),
  description: z.string().optional(),
  tabId: z.number().int().positive().optional(),
  target: stepTargetSchema.optional(),
  url: z.string().url().optional(),
  value: z.string().optional(),
  fields: z.array(formFieldSchema).optional(),
  replace: z.boolean().optional(),
  direction: z.enum(["up", "down", "left", "right"]).optional(),
  amount: z.number().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  delayMs: z.number().int().nonnegative().optional(),
  key: z.string().optional(),
  contains: z.string().optional(),
  visibleOnly: z.boolean().optional(),
  viewportOnly: z.boolean().optional(),
  format: z.enum(["png", "jpeg"]).optional(),
  quality: z.number().int().min(0).max(100).optional()
});

const runStepsSchema = optionalTabId.extend({
  steps: z.array(runStepSchema).min(1).max(50),
  stopOnError: z.boolean().optional(),
  delayMs: z.number().int().nonnegative().optional(),
  timeoutMs: z.number().int().positive().optional(),
  screenshotOnError: z.boolean().optional()
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
      name: "browser_get_interactives",
      description: "返回轻量可交互元素摘要，默认比完整 snapshot 更快，适合 Agent 快速选择按钮、输入框和菜单项。",
      inputSchema: schema({
        tabId: { type: "number" },
        limit: { type: "number" },
        viewportOnly: { type: "boolean" }
      }),
      handler: async (args) => {
        const parsed = getInteractivesSchema.parse(args ?? {});
        return bridge.call("browser_get_interactives", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_find",
      description: "在浏览器端按 query、文本、role、placeholder 等快速查找可操作元素，返回置信度排序结果。",
      inputSchema: schema({
        ...stepTargetProperties(),
        tabId: { type: "number" },
        visibleOnly: { type: "boolean" },
        viewportOnly: { type: "boolean" },
        limit: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = findSchema.parse(args ?? {});
        return bridge.call("browser_find", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_find_and_click",
      description: "在浏览器端查找最匹配元素并点击，减少 Agent 拉取 DOM 后再回传 elementId 的往返。",
      inputSchema: schema({
        ...stepTargetProperties(),
        tabId: { type: "number" },
        visibleOnly: { type: "boolean" },
        viewportOnly: { type: "boolean" }
      }),
      handler: async (args) => {
        const parsed = clickSchema.parse(args ?? {});
        return bridge.call("browser_find_and_click", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_find_and_type",
      description: "在浏览器端查找输入目标并输入文本，适合账号、搜索框、筛选条件等场景。",
      inputSchema: schema({
        ...stepTargetProperties(),
        tabId: { type: "number" },
        text: { type: "string" },
        visibleOnly: { type: "boolean" },
        viewportOnly: { type: "boolean" }
      }, ["text"]),
      handler: async (args) => {
        const parsed = typeSchema.parse(args ?? {});
        return bridge.call("browser_find_and_type", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_fill_form",
      description: "一次性填写多个表单字段，插件在浏览器端逐个查找和写入，减少多次 tool call。",
      inputSchema: schema({
        tabId: { type: "number" },
        timeoutMs: { type: "number" },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ...stepTargetProperties(),
              value: { type: "string" },
              replace: { type: "boolean" }
            },
            required: ["value"],
            additionalProperties: false
          }
        }
      }, ["fields"]),
      handler: async (args) => {
        const parsed = fillFormSchema.parse(args ?? {});
        return bridge.call("browser_fill_form", parsed, {
          tabId: parsed.tabId,
          timeoutMs: parsed.timeoutMs
        });
      }
    },
    {
      name: "browser_hover",
      description: "在浏览器端查找元素并触发 hover，适合头像菜单、下拉菜单等场景。",
      inputSchema: schema({
        ...stepTargetProperties(),
        tabId: { type: "number" },
        visibleOnly: { type: "boolean" },
        viewportOnly: { type: "boolean" },
        timeoutMs: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = clickSchema.parse(args ?? {});
        return bridge.call("browser_hover", parsed, {
          tabId: parsed.tabId,
          timeoutMs: parsed.timeoutMs
        });
      }
    },
    {
      name: "browser_press_key",
      description: "向当前页面发送键盘按键，例如 Enter、Escape、Tab、ArrowDown。",
      inputSchema: schema({
        tabId: { type: "number" },
        key: { type: "string" }
      }, ["key"]),
      handler: async (args) => {
        const parsed = pressKeySchema.parse(args ?? {});
        return bridge.call("browser_press_key", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_assert_text",
      description: "断言页面在指定时间内出现文本，用于结构化步骤执行后的快速校验。",
      inputSchema: schema({
        tabId: { type: "number" },
        text: { type: "string" },
        contains: { type: "string" },
        timeoutMs: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = assertTextSchema.parse(args ?? {});
        return bridge.call("browser_assert_text", parsed, {
          tabId: parsed.tabId,
          timeoutMs: parsed.timeoutMs
        });
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
        query: { type: "string" },
        elementId: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" },
        role: { type: "string" },
        ariaLabel: { type: "string" },
        placeholder: { type: "string" },
        href: { type: "string" },
        nearText: { type: "string" },
        visibleOnly: { type: "boolean" },
        viewportOnly: { type: "boolean" }
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
        query: { type: "string" },
        elementId: { type: "string" },
        selector: { type: "string" },
        ariaLabel: { type: "string" },
        placeholder: { type: "string" },
        text: { type: "string" },
        nearText: { type: "string" },
        visibleOnly: { type: "boolean" },
        viewportOnly: { type: "boolean" }
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
        query: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" },
        role: { type: "string" },
        ariaLabel: { type: "string" },
        placeholder: { type: "string" },
        nearText: { type: "string" },
        timeoutMs: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = waitForSchema.parse(args ?? {});
        return bridge.call("browser_wait_for", parsed, {
          tabId: parsed.tabId,
          timeoutMs: parsed.timeoutMs
        });
      }
    },
    {
      name: "browser_run_steps",
      description: "按顺序执行结构化浏览器操作步骤。支持 open、click、hover、type、clear、scroll、waitFor、pressKey、assertText、getText、snapshot、screenshot、sleep 等动作。",
      inputSchema: schema({
        tabId: { type: "number" },
        stopOnError: { type: "boolean" },
        delayMs: { type: "number" },
        timeoutMs: { type: "number" },
        screenshotOnError: { type: "boolean" },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["open", "activateTab", "click", "hover", "type", "fillForm", "clear", "scroll", "waitFor", "pressKey", "assertText", "getText", "snapshot", "screenshot", "sleep"]
              },
              description: { type: "string" },
              tabId: { type: "number" },
              target: {
                type: "object",
                properties: stepTargetProperties(),
                additionalProperties: false
              },
              url: { type: "string" },
              value: { type: "string" },
              fields: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    ...stepTargetProperties(),
                    value: { type: "string" },
                    replace: { type: "boolean" }
                  },
                  required: ["value"],
                  additionalProperties: false
                }
              },
              direction: { type: "string", enum: ["up", "down", "left", "right"] },
              amount: { type: "number" },
              timeoutMs: { type: "number" },
              delayMs: { type: "number" },
              key: { type: "string" },
              contains: { type: "string" },
              visibleOnly: { type: "boolean" },
              viewportOnly: { type: "boolean" },
              format: { type: "string", enum: ["png", "jpeg"] },
              quality: { type: "number" },
              ...stepTargetProperties()
            },
            required: ["action"],
            additionalProperties: false
          }
        }
      }, ["steps"]),
      handler: async (args) => {
        const parsed = runStepsSchema.parse(args ?? {});
        return bridge.call("browser_run_steps", parsed, {
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

function stepTargetProperties(): Record<string, unknown> {
  return {
    query: { type: "string" },
    elementId: { type: "string" },
    selector: { type: "string" },
    text: { type: "string" },
    role: { type: "string" },
    ariaLabel: { type: "string" },
    placeholder: { type: "string" },
    href: { type: "string" },
    nearText: { type: "string" }
  };
}
