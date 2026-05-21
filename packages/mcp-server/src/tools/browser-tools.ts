import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
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

const actSchema = optionalTabId.extend({
  action: z.enum(["click", "type", "hover", "clear", "waitFor", "assertText"]),
  target: z.string().optional(),
  query: z.string().optional(),
  text: z.string().optional(),
  value: z.string().optional(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  placeholder: z.string().optional(),
  href: z.string().optional(),
  selector: z.string().optional(),
  elementId: z.string().optional(),
  nearText: z.string().optional(),
  replace: z.boolean().optional(),
  visibleOnly: z.boolean().optional(),
  viewportOnly: z.boolean().optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
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
  quality: z.number().int().min(0).max(100).optional(),
  mode: z.enum(["visible", "cdp"]).optional(),
  scale: z.number().min(0.1).max(4).optional()
});

const pdfSchema = optionalTabId.extend({
  landscape: z.boolean().optional(),
  printBackground: z.boolean().optional(),
  scale: z.number().min(0.1).max(2).optional(),
  paperWidth: z.number().positive().optional(),
  paperHeight: z.number().positive().optional(),
  marginTop: z.number().min(0).optional(),
  marginBottom: z.number().min(0).optional(),
  marginLeft: z.number().min(0).optional(),
  marginRight: z.number().min(0).optional(),
  pageRanges: z.string().optional(),
  preferCSSPageSize: z.boolean().optional(),
  returnFormat: z.enum(["resource", "text"]).optional()
});

const savePdfSchema = pdfSchema.extend({
  path: z.string().optional(),
  filename: z.string().optional()
});

const capturePageSchema = optionalTabId.extend({
  preferredFormat: z.array(z.enum(["pdf", "screenshot", "text"])).optional(),
  pdf: pdfSchema.partial().optional(),
  screenshot: screenshotSchema.partial().optional(),
  savePath: z.string().optional(),
  saveFilename: z.string().optional(),
  returnFormat: z.enum(["resource", "text"]).optional()
});

const saveScreenshotSchema = screenshotSchema.extend({
  path: z.string().optional(),
  filename: z.string().optional()
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
    "pdf",
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
  quality: z.number().int().min(0).max(100).optional(),
  landscape: z.boolean().optional(),
  printBackground: z.boolean().optional(),
  scale: z.number().min(0.1).max(2).optional(),
  paperWidth: z.number().positive().optional(),
  paperHeight: z.number().positive().optional(),
  marginTop: z.number().min(0).optional(),
  marginBottom: z.number().min(0).optional(),
  marginLeft: z.number().min(0).optional(),
  marginRight: z.number().min(0).optional(),
  pageRanges: z.string().optional(),
  preferCSSPageSize: z.boolean().optional()
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
      description: "调试/兜底工具：返回页面标题、URL、大段可见文本和可操作元素列表，消耗 token 较高。点击、输入、等待等操作应优先使用 browser_act、browser_find_and_click、browser_find_and_type 或 browser_run_steps。",
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
      name: "browser_act",
      description: "低 token 意图式浏览器操作。直接传 action 和 target/query，由浏览器端查找元素、校验置信度并执行，避免先拉取完整 DOM/snapshot。适合点击按钮、输入文本、悬停、清空、等待元素和断言文本。",
      inputSchema: schema({
        action: { type: "string", enum: ["click", "type", "hover", "clear", "waitFor", "assertText"] },
        target: { type: "string" },
        query: { type: "string" },
        text: { type: "string" },
        value: { type: "string" },
        role: { type: "string" },
        ariaLabel: { type: "string" },
        placeholder: { type: "string" },
        href: { type: "string" },
        selector: { type: "string" },
        elementId: { type: "string" },
        nearText: { type: "string" },
        replace: { type: "boolean" },
        visibleOnly: { type: "boolean" },
        viewportOnly: { type: "boolean" },
        confidenceThreshold: { type: "number" },
        timeoutMs: { type: "number" },
        tabId: { type: "number" }
      }, ["action"]),
      handler: async (args) => {
        const parsed = actSchema.parse(args ?? {});
        return bridge.call("browser_act", parsed, {
          tabId: parsed.tabId,
          timeoutMs: parsed.timeoutMs
        });
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
      description: "截取当前标签页或指定标签页，并直接返回 MCP image content。默认截取可视区域；需要更清晰截图时传 mode='cdp'，可配合 scale。",
      inputSchema: schema({
        tabId: { type: "number" },
        format: { type: "string", enum: ["png", "jpeg"] },
        quality: { type: "number" },
        mode: { type: "string", enum: ["visible", "cdp"] },
        scale: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = screenshotSchema.parse(args ?? {});
        return bridge.call("browser_screenshot", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_save_screenshot",
      description: "截取当前标签页或指定标签页，并由本地 MCP 服务保存为图片文件。仅在需要落盘或避免大图进入模型上下文时使用；直接给 Agent 看图请用 browser_screenshot。",
      inputSchema: schema({
        tabId: { type: "number" },
        format: { type: "string", enum: ["png", "jpeg"] },
        quality: { type: "number" },
        mode: { type: "string", enum: ["visible", "cdp"] },
        scale: { type: "number" },
        path: { type: "string" },
        filename: { type: "string" }
      }),
      handler: async (args) => {
        const parsed = saveScreenshotSchema.parse(args ?? {});
        const result = await bridge.call<Record<string, unknown>>("browser_screenshot", {
          tabId: parsed.tabId,
          format: parsed.format,
          quality: parsed.quality,
          mode: parsed.mode,
          scale: parsed.scale
        }, { tabId: parsed.tabId });
        return saveScreenshotResult(result, {
          path: parsed.path,
          filename: parsed.filename
        });
      }
    },
    {
      name: "browser_pdf",
      description: "将当前标签页或指定标签页导出为 PDF（类似 Cmd+P），返回 base64 编码的 PDF 数据。比截图更结构化，比 DOM 解析更省 token。returnFormat='resource'(默认) 返回 MCP resource 类型，returnFormat='text' 返回纯文本 base64。",
      inputSchema: schema({
        tabId: { type: "number" },
        landscape: { type: "boolean" },
        printBackground: { type: "boolean" },
        scale: { type: "number" },
        paperWidth: { type: "number" },
        paperHeight: { type: "number" },
        marginTop: { type: "number" },
        marginBottom: { type: "number" },
        marginLeft: { type: "number" },
        marginRight: { type: "number" },
        pageRanges: { type: "string" },
        preferCSSPageSize: { type: "boolean" },
        returnFormat: { type: "string", enum: ["resource", "text"] }
      }),
      handler: async (args) => {
        const parsed = pdfSchema.parse(args ?? {});
        const result = await bridge.call<Record<string, unknown>>("browser_pdf", parsed, { tabId: parsed.tabId });
        if (parsed.returnFormat) result._returnFormat = parsed.returnFormat;
        return result;
      }
    },
    {
      name: "browser_save_pdf",
      description: "将当前标签页或指定标签页导出为 PDF 并保存到本地文件。默认保存到桌面，只返回文件路径和元数据，避免把大 PDF base64 塞进模型上下文。",
      inputSchema: schema({
        tabId: { type: "number" },
        landscape: { type: "boolean" },
        printBackground: { type: "boolean" },
        scale: { type: "number" },
        paperWidth: { type: "number" },
        paperHeight: { type: "number" },
        marginTop: { type: "number" },
        marginBottom: { type: "number" },
        marginLeft: { type: "number" },
        marginRight: { type: "number" },
        pageRanges: { type: "string" },
        preferCSSPageSize: { type: "boolean" },
        path: { type: "string" },
        filename: { type: "string" }
      }),
      handler: async (args) => {
        const parsed = savePdfSchema.parse(args ?? {});
        const result = await bridge.call<Record<string, unknown>>("browser_pdf", {
          tabId: parsed.tabId,
          landscape: parsed.landscape,
          printBackground: parsed.printBackground,
          scale: parsed.scale,
          paperWidth: parsed.paperWidth,
          paperHeight: parsed.paperHeight,
          marginTop: parsed.marginTop,
          marginBottom: parsed.marginBottom,
          marginLeft: parsed.marginLeft,
          marginRight: parsed.marginRight,
          pageRanges: parsed.pageRanges,
          preferCSSPageSize: parsed.preferCSSPageSize
        }, { tabId: parsed.tabId });
        return savePdfResult(result, {
          path: parsed.path,
          filename: parsed.filename
        });
      }
    },
    {
      name: "browser_capture_page",
      description: "智能页面捕获工具。按优先级尝试 PDF → 截图 → DOM 文本，自动降级。AI Agent 读取页面内容的首选工具。",
      inputSchema: schema({
        tabId: { type: "number" },
        preferredFormat: {
          type: "array",
          items: { type: "string", enum: ["pdf", "screenshot", "text"] }
        },
        pdf: { type: "object" },
        screenshot: { type: "object" },
        savePath: { type: "string" },
        saveFilename: { type: "string" },
        returnFormat: { type: "string", enum: ["resource", "text"] }
      }),
      handler: async (args) => {
        const parsed = capturePageSchema.parse(args ?? {});
        return capturePage(bridge, parsed);
      }
    },
    {
      name: "browser_evaluate",
      description: "在宿主页面的 window 上下文中执行自定义 JavaScript 表达式并返回结果。可用于读取 window.__vm__、检查全局变量、调用页面方法等。表达式在页面 MAIN world 中执行，拥有完整访问权限。",
      inputSchema: schema({
        tabId: { type: "number" },
        expression: { type: "string" }
      }, ["expression"]),
      handler: async (args) => {
        const parsed = optionalTabId.extend({ expression: z.string().min(1) }).parse(args ?? {});
        return bridge.call("browser_evaluate", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_cdp",
      description: "在浏览器端发送一次性 CDP (Chrome DevTools Protocol) 命令并返回结果。可用于获取 Performance 指标、DOM 树、网络详情等深度数据。method 格式为 'Domain.method'，如 'Performance.getMetrics'、'DOM.getDocument'、'Runtime.evaluate'。",
      inputSchema: schema({
        tabId: { type: "number" },
        method: { type: "string" },
        params: { type: "object" }
      }, ["method"]),
      handler: async (args) => {
        const parsed = optionalTabId.extend({
          method: z.string().min(1),
          params: z.record(z.unknown()).optional()
        }).parse(args ?? {});
        return bridge.call("browser_cdp", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_cdp_session",
      description: "开启 CDP 域监听，收集指定时间内的所有事件。用于抓包网络请求、收集性能事件、记录 HeapProfiler 数据等。enable 传入 CDP 域名数组（如 ['Network', 'Performance']），durationMs 为监听时长（默认 3000ms）。",
      inputSchema: schema({
        tabId: { type: "number" },
        enable: {
          type: "array",
          items: { type: "string" }
        },
        durationMs: { type: "number" }
      }, ["enable"]),
      handler: async (args) => {
        const parsed = optionalTabId.extend({
          enable: z.array(z.string().min(1)).min(1),
          durationMs: z.number().int().positive().optional()
        }).parse(args ?? {});
        return bridge.call("browser_cdp_session", parsed, {
          tabId: parsed.tabId,
          timeoutMs: (parsed.durationMs ?? 3000) + 5000
        });
      }
    },
    {
      name: "browser_responsive",
      description: "在多个视口尺寸下截取页面截图，用于响应式布局测试。默认使用 Desktop(1920x1080)、Tablet(768x1024)、Mobile(375x812) 三种尺寸。也可自定义视口列表。",
      inputSchema: schema({
        tabId: { type: "number" },
        viewports: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              width: { type: "number" },
              height: { type: "number" }
            },
            required: ["name", "width", "height"],
            additionalProperties: false
          }
        },
        url: { type: "string" }
      }),
      handler: async (args) => {
        const parsed = optionalTabId.extend({
          viewports: z.array(z.object({
            name: z.string(),
            width: z.number().int().positive(),
            height: z.number().int().positive()
          })).optional(),
          url: z.string().optional()
        }).parse(args ?? {});
        return bridge.call("browser_responsive", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_network_analysis",
      description: "开启 Network 域监听，收集指定时间内的网络请求，分析慢请求、传输大小和请求类型分布。适合页面加载性能分析。",
      inputSchema: schema({
        tabId: { type: "number" },
        durationMs: { type: "number" },
        slowThresholdMs: { type: "number" },
        url: { type: "string" }
      }),
      handler: async (args) => {
        const parsed = optionalTabId.extend({
          durationMs: z.number().int().positive().optional(),
          slowThresholdMs: z.number().int().positive().optional(),
          url: z.string().optional()
        }).parse(args ?? {});
        return bridge.call("browser_network_analysis", parsed, {
          tabId: parsed.tabId,
          timeoutMs: (parsed.durationMs ?? 3000) + 5000
        });
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
      description: "按顺序执行结构化浏览器操作步骤。支持 open、click、hover、type、clear、scroll、waitFor、pressKey、assertText、getText、snapshot、screenshot、pdf、sleep 等动作。",
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
              landscape: { type: "boolean" },
              printBackground: { type: "boolean" },
              scale: { type: "number" },
              paperWidth: { type: "number" },
              paperHeight: { type: "number" },
              marginTop: { type: "number" },
              marginBottom: { type: "number" },
              marginLeft: { type: "number" },
              marginRight: { type: "number" },
              pageRanges: { type: "string" },
              preferCSSPageSize: { type: "boolean" },
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

async function saveScreenshotResult(
  result: Record<string, unknown>,
  options: { path?: string; filename?: string }
): Promise<Record<string, unknown>> {
  const dataUrl = typeof result.dataUrl === "string" ? result.dataUrl : undefined;
  if (!dataUrl) {
    throw new Error("INTERNAL_ERROR: 截图结果缺少 dataUrl");
  }

  const [header, data] = dataUrl.split(",", 2);
  if (!data) {
    throw new Error("INTERNAL_ERROR: 截图 dataUrl 格式不正确");
  }

  const mimeType = typeof result.mimeType === "string"
    ? result.mimeType
    : header.match(/^data:(.*);base64$/)?.[1] ?? "image/png";
  const ext = mimeType === "image/jpeg" ? "jpg" : "png";
  const target = resolve(options.path ?? defaultScreenshotPath(options.filename, ext));

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(data, "base64"));

  return {
    saved: true,
    path: target,
    tabId: result.tabId,
    url: result.url,
    title: result.title,
    mimeType,
    bytes: Buffer.byteLength(data, "base64")
  };
}

function defaultScreenshotPath(filename: string | undefined, ext: string): string {
  const safeName = sanitizeFilename(filename ?? `browser-bridge-screenshot-${timestamp()}.${ext}`);
  const name = safeName.endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`;
  return join(homedir(), "Desktop", name);
}

function sanitizeFilename(value: string): string {
  return value.replace(/[/:\\]/g, "-").replace(/\s+/g, " ").trim() || `browser-bridge-screenshot-${timestamp()}.png`;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function savePdfResult(
  result: Record<string, unknown>,
  options: { path?: string; filename?: string }
): Promise<Record<string, unknown>> {
  const data = typeof result.data === "string" ? result.data : undefined;
  if (!data) {
    throw new Error("INTERNAL_ERROR: PDF 结果缺少 data");
  }

  const target = resolve(options.path ?? defaultPdfPath(options.filename));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(data, "base64"));

  return {
    saved: true,
    path: target,
    tabId: result.tabId,
    url: result.url,
    title: result.title,
    mimeType: "application/pdf",
    bytes: Buffer.byteLength(data, "base64")
  };
}

function defaultPdfPath(filename: string | undefined): string {
  const safeName = sanitizeFilename(filename ?? `browser-bridge-pdf-${timestamp()}.pdf`);
  const name = safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`;
  return join(homedir(), "Desktop", name);
}

async function capturePage(
  bridge: BrowserToolBridge,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const preferredFormat = Array.isArray(params.preferredFormat)
    ? params.preferredFormat
    : ["pdf", "screenshot", "text"];

  const tabId = typeof params.tabId === "number" ? params.tabId : undefined;

  for (const format of preferredFormat) {
    try {
      if (format === "pdf") {
        const pdfParams = isRecord(params.pdf) ? params.pdf : {};
        const result = await bridge.call<Record<string, unknown>>("browser_pdf", {
          ...pdfParams,
          tabId: tabId ?? pdfParams.tabId
        }, { tabId });

        const returnFormat = typeof params.returnFormat === "string" ? params.returnFormat : undefined;
        if (returnFormat) result._returnFormat = returnFormat;

        if (params.savePath || params.saveFilename) {
          const saved = await savePdfResult(result, {
            path: typeof params.savePath === "string" ? params.savePath : undefined,
            filename: typeof params.saveFilename === "string" ? params.saveFilename : undefined
          });
          return { format: "pdf", ...saved };
        }
        return { format: "pdf", ...result };
      }

      if (format === "screenshot") {
        const ssParams = isRecord(params.screenshot) ? params.screenshot : {};
        const result = await bridge.call<Record<string, unknown>>("browser_screenshot", {
          ...ssParams,
          tabId: tabId ?? ssParams.tabId
        }, { tabId });

        if (params.savePath || params.saveFilename) {
          const saved = await saveScreenshotResult(result, {
            path: typeof params.savePath === "string" ? params.savePath : undefined,
            filename: typeof params.saveFilename === "string" ? params.saveFilename : undefined
          });
          return { format: "screenshot", ...saved };
        }
        return { format: "screenshot", ...result };
      }

      if (format === "text") {
        const result = await bridge.call<Record<string, unknown>>("browser_get_page_text", {
          tabId
        }, { tabId });
        return { format: "text", ...result };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (format === preferredFormat[preferredFormat.length - 1]) {
        throw error;
      }
      // continue to next format
      void message;
    }
  }

  throw new Error("INTERNAL_ERROR: 所有捕获格式均失败");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
