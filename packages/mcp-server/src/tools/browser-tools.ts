import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { BrowserAgentPlanner } from "../qa/planner.js";
import { recordedStepsToCase } from "../qa/recorder.js";
import { type RecordedStep } from "../qa/types.js";
import { type BridgeRequest, type BrowserStatus } from "@majuntao-1/browser-bridge-shared";
import { ObservationCache } from "../utils/cache.js";

export type BrowserToolBridge = {
  getStatus: () => BrowserStatus | Promise<BrowserStatus>;
  setVariable: (name: string, value: any) => Promise<void>;
  getVariable: (name: string) => Promise<any>;
  getAllVariables: () => Promise<Record<string, any>>;
  clearVariables: () => Promise<void>;
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

const selectOptionSchema = optionalTabId.extend({
  label: z.string().min(1),
  option: z.string().min(1),
  exact: z.boolean().optional(),
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
  url: z.string().url(),
  timeoutMs: z.number().int().positive().optional(),
  waitUntil: z.enum(["commit", "ready"]).optional()
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

const pageModelSchema = optionalTabId.extend({
  visibleOnly: z.boolean().optional(),
  viewportOnly: z.boolean().optional(),
  maxTextLength: z.number().int().min(0).max(20_000).optional(),
  maxElements: z.number().int().min(0).max(300).optional(),
  maxHeadings: z.number().int().min(0).max(200).optional(),
  maxRegions: z.number().int().min(0).max(120).optional(),
  maxTables: z.number().int().min(0).max(50).optional(),
  maxTableRows: z.number().int().min(0).max(30).optional()
});

const screenshotSchema = optionalTabId.extend({
  format: z.enum(["png", "jpeg"]).optional(),
  quality: z.number().int().min(0).max(100).optional(),
  mode: z.enum(["visible", "cdp"]).optional(),
  scale: z.number().min(0.1).max(4).optional()
});

const screenObserveSchema = optionalTabId.extend({
  format: z.enum(["png", "jpeg"]).optional(),
  quality: z.number().int().min(0).max(100).optional(),
  withGrid: z.boolean().optional(),
  gridSize: z.number().int().min(20).max(400).optional(),
  scale: z.number().min(0.1).max(4).optional()
});

const screenClickSchema = optionalTabId.extend({
  x: z.number(),
  y: z.number(),
  button: z.enum(["left", "middle", "right"]).optional(),
  clickCount: z.number().int().min(1).max(3).optional(),
  delayMs: z.number().int().nonnegative().max(2000).optional()
});

const screenTypeSchema = optionalTabId.extend({
  text: z.string()
});

const screenPointSchema = z.object({
  x: z.number(),
  y: z.number()
});

const screenDragSchema = optionalTabId.extend({
  from: screenPointSchema,
  to: screenPointSchema,
  button: z.enum(["left", "middle", "right"]).optional(),
  steps: z.number().int().min(1).max(120).optional(),
  durationMs: z.number().int().nonnegative().max(10000).optional()
});

const screenScrollSchema = optionalTabId.extend({
  x: z.number().optional(),
  y: z.number().optional(),
  deltaX: z.number().optional(),
  deltaY: z.number().optional()
});

const screenPressSchema = optionalTabId.extend({
  key: z.string().min(1)
});

const visualObserveSchema = screenObserveSchema.extend({
  includeTargets: z.boolean().optional(),
  maxTargets: z.number().int().positive().max(200).optional()
});

const visualClickTextSchema = optionalTabId.extend({
  text: z.string().min(1),
  exact: z.boolean().optional(),
  prefer: z.enum(["top", "bottom", "left", "right", "largest", "smallest"]).optional(),
  timeoutMs: z.number().int().positive().optional()
});

const visualSelectSchema = optionalTabId.extend({
  label: z.string().min(1),
  option: z.string().min(1),
  exact: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional()
});

const visualTaskSchema = optionalTabId.extend({
  instruction: z.string().min(1),
  timeoutMs: z.number().int().positive().optional()
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
  target: stepTargetSchema.optional(),
  url: z.string().url().optional(),
  value: z.string().optional(),
  option: z.string().optional(),
  label: z.string().optional(),
  exact: z.boolean().optional(),
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
  maxTextLength: z.number().int().min(0).max(20_000).optional(),
  maxElements: z.number().int().min(0).max(300).optional(),
  maxHeadings: z.number().int().min(0).max(200).optional(),
  maxRegions: z.number().int().min(0).max(120).optional(),
  maxTables: z.number().int().min(0).max(50).optional(),
  maxTableRows: z.number().int().min(0).max(30).optional(),
  format: z.enum(["png", "jpeg"]).optional(),
  quality: z.number().int().min(0).max(100).optional(),
  withGrid: z.boolean().optional(),
  gridSize: z.number().int().min(20).max(400).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  from: screenPointSchema.optional(),
  to: screenPointSchema.optional(),
  button: z.enum(["left", "middle", "right"]).optional(),
  clickCount: z.number().int().min(1).max(3).optional(),
  steps: z.number().int().min(1).max(120).optional(),
  durationMs: z.number().int().nonnegative().max(10000).optional(),
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
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
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  handler: (args: unknown) => Promise<unknown>;
};

export const browserReadOnlyAnnotations = {
  readOnlyHint: true,
  openWorldHint: true
} as const;

export const browserNonDestructiveAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true
} as const;

export function createBrowserTools(bridge: BrowserToolBridge): BrowserToolDefinition[] {
  // 观察结果缓存：快速连续观察调用从 2 次往返 → 0 次往返
  const observationCache = new ObservationCache(2000);

  const tools: BrowserToolDefinition[] = [
    {
      name: "browser_console_monitor",
      description: "启动控制台监听，捕获指定时间内的所有 console 日志（log, warn, error）和未捕获的异常。这对于调试页面报错或观察交互产生的日志非常有用。durationMs 默认为 5000ms。",
      inputSchema: schema({
        tabId: { type: "number" },
        durationMs: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = optionalTabId.extend({
          durationMs: z.number().int().positive().optional()
        }).parse(args ?? {});
        return bridge.call("browser_console_monitor", parsed, {
          tabId: parsed.tabId,
          timeoutMs: (parsed.durationMs ?? 5000) + 2000
        });
      }
    },
    {
      name: "browser_status",
      description: "返回 Chrome 插件是否已连接到本地浏览器桥接服务。",
      inputSchema: schema({}),
      handler: async () => bridge.getStatus()
    },
    {
      name: "browser_get_ax_tree",
      description: "[DEPRECATED since v0.4.0] Use browser_get_page_model 获取更精简的语义化页面模型。AX Tree 返回体积较大，将在 v0.6.0 移除。",
      inputSchema: schema({
        tabId: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = optionalTabId.parse(args ?? {});
        return bridge.call("browser_get_ax_tree", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_observe",
      description: "【推荐】获取当前页面的简化无障碍树（Text-based AOM）。如果返回结果过于简单或为空，说明该页面非标准或正在加载，请务必尝试 browser_visual_observe 或直接使用 browser_visual_task 操作。",
      inputSchema: schema({
        tabId: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = optionalTabId.parse(args ?? {});
        return bridge.call("browser_observe", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_mock_network",
      description: "在指定时间内拦截并模拟特定的网络请求。支持设置 URL 匹配模式、响应码、响应体和内容类型。常用于模拟 API 报错或特定返回数据。",
      inputSchema: schema({
        tabId: { type: "number" },
        urlPattern: { type: "string" },
        responseCode: { type: "number" },
        responseBody: { type: "string" },
        contentType: { type: "string" },
        durationMs: { type: "number" }
      }, ["urlPattern"]),
      handler: async (args) => {
        const parsed = optionalTabId.extend({
          urlPattern: z.string().min(1),
          responseCode: z.number().int().positive().optional(),
          responseBody: z.string().optional(),
          contentType: z.string().optional(),
          durationMs: z.number().int().positive().optional()
        }).parse(args ?? {});
        return bridge.call("browser_mock_network", parsed, {
          tabId: parsed.tabId,
          timeoutMs: (parsed.durationMs ?? 10000) + 2000
        });
      }
    },
    {
      name: "browser_wait_for_request",
      description: "等待符合特定模式（URL 或关键字）的网络请求完成。常用于单页应用（SPA）中等待点击按钮后的 API 数据回包。支持设置超时时间。",
      inputSchema: schema({
        tabId: { type: "number" },
        urlPattern: { type: "string" },
        timeoutMs: { type: "number" }
      }, ["urlPattern"]),
      handler: async (args) => {
        const parsed = optionalTabId.extend({
          urlPattern: z.string().min(1),
          timeoutMs: z.number().int().positive().optional()
        }).parse(args ?? {});
        return bridge.call("browser_wait_for_request", parsed, {
          tabId: parsed.tabId,
          timeoutMs: (parsed.timeoutMs ?? 10000) + 2000
        });
      }
    },
    {
      name: "browser_get_active_tab",
      description: "返回当前活动的 Chrome 标签页。",
      inputSchema: schema({}),
      handler: async () => bridge.call("browser_get_active_tab")
    },
    {
      name: "browser_get_page_text",
      description: "[DEPRECATED since v0.4.0] Use browser_get_page_model 或 browser_observe 获取更结构化的页面信息。此工具将保留但不再推荐使用。",
      inputSchema: schema({ tabId: { type: "number" } }),
      handler: async (args) => {
        const parsed = optionalTabId.parse(args ?? {});
        return bridge.call("browser_get_page_text", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_get_page_snapshot",
      description: "[DEPRECATED since v0.4.0] Use browser_get_page_model 获取低 token 的语义化页面模型。此工具返回完整快照，token 消耗较高，将在 v0.6.0 移除。",
      inputSchema: schema({ tabId: { type: "number" } }),
      handler: async (args) => {
        const parsed = optionalTabId.parse(args ?? {});
        return bridge.call("browser_get_page_snapshot", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_get_page_model",
      description: "返回低 token 的语义化页面模型 JSON：标题结构、主要区域、可交互元素、表单、表格样例和页面消息。默认替代完整 HTML/DOM/snapshot，用于让 Agent 先理解页面再按需操作。",
      inputSchema: schema({
        tabId: { type: "number" },
        visibleOnly: { type: "boolean" },
        viewportOnly: { type: "boolean" },
        maxTextLength: { type: "number" },
        maxElements: { type: "number" },
        maxHeadings: { type: "number" },
        maxRegions: { type: "number" },
        maxTables: { type: "number" },
        maxTableRows: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = pageModelSchema.parse(args ?? {});
        return bridge.call("browser_get_page_model", parsed, { tabId: parsed.tabId });
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
      description: "[DEPRECATED since v0.4.0] Use browser_act({ action: 'click' }) 或 browser_click_semantic_btn 替代。将在 v0.6.0 移除。",
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
      description: "[DEPRECATED since v0.4.0] Use browser_act({ action: 'type' }) 或 browser_fill_form_smart 批量填写替代。将在 v0.6.0 移除。",
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
      name: "browser_select_option",
      description: "【推荐优先使用】按表单标签选择下拉项。适合 Ant Design/Arco/Element 等自定义 Select。该工具内部会先尝试 DOM 标签定位，定位失败或超时时自动切到视觉下拉选择兜底；Agent 不应自行把一次下拉选择拆成读模型、点坐标、再读模型的多轮过程。系统默认超时 60s。",
      inputSchema: schema({
        tabId: { type: "number" },
        label: { type: "string" },
        option: { type: "string" },
        exact: { type: "boolean" },
        timeoutMs: { type: "number" }
      }, ["label", "option"]),
      handler: async (args) => {
        const parsed = selectOptionSchema.parse(args ?? {});
        return bridge.call("browser_select_option", parsed, {
          tabId: parsed.tabId,
          timeoutMs: parsed.timeoutMs ?? 60000
        });
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
      name: "browser_get_form_structure",
      description: "提取当前页面的完整表单模型，返回所有字段的标签、类型、选项、必填状态和框架识别结果。一次调用即可看到整个表单结构，减少多次 browser_find 调用。支持 AntD、Element UI、Arco 和原生 HTML 表单。",
      inputSchema: schema({
        tabId: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = optionalTabId.parse(args ?? {});
        return bridge.call("browser_get_form_structure", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_fill_form_smart",
      description: "批量智能填写表单字段，自动处理不同 UI 框架的组件差异（AntD Select、Element UI DatePicker 等）。每个字段填写后自动验证，失败字段可单独报告，不影响已成功字段。支持 dryRun 模式预览匹配结果。",
      inputSchema: schema({
        tabId: { type: "number" },
        dryRun: { type: "boolean", description: "仅返回匹配字段和策略，不实际填写" },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "字段标签，如'用户名'、'开始日期'" },
              value: { type: "string", description: "要填写的值" },
              selector: { type: "string", description: "可选：直接指定 CSS 选择器" },
              elementId: { type: "string", description: "可选：直接指定元素 ID" },
              replace: { type: "boolean", description: "是否替换现有值（默认 true）" }
            },
            required: ["label", "value"],
            additionalProperties: false
          }
        }
      }, ["fields"]),
      handler: async (args) => {
        const parsed = optionalTabId.extend({
          dryRun: z.boolean().optional(),
          fields: z.array(z.object({
            label: z.string(),
            value: z.string(),
            selector: z.string().optional(),
            elementId: z.string().optional(),
            replace: z.boolean().optional()
          })).min(1).max(30)
        }).parse(args ?? {});
        return bridge.call("browser_fill_form_smart", parsed, {
          tabId: parsed.tabId,
          timeoutMs: 60_000
        });
      }
    },
    {
      name: "browser_click_semantic_btn",
      description: "根据语义（如'查询'、'保存'、'提交'）直接点击按钮，自动处理遮挡、滚动和同义词匹配。支持上下文过滤（如'弹窗内'、'表单底部'）。",
      inputSchema: schema({
        tabId: { type: "number" },
        semantic: { type: "string", description: "按钮语义，如'查询'、'确认'、'取消'" },
        context: { type: "string", description: "上下文区域，如'表单底部'、'弹窗'" }
      }, ["semantic"]),
      handler: async (args) => {
        const parsed = optionalTabId.extend({
          semantic: z.string().min(1),
          context: z.string().optional()
        }).parse(args ?? {});
        return bridge.call("browser_click_semantic_btn", parsed, {
          tabId: parsed.tabId,
          timeoutMs: 15_000
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
      description: "[DEPRECATED since v0.4.0] Use browser_screen_press 替代（CDP 更通用）。将在 v0.6.0 移除。",
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
      description: "截取当前标签页或指定标签页，并直接返回 MCP image content。默认截取可视区域；需要更清晰截图时传 mode='cdp'，可配合 scale。需要看图判断页面时应直接调用本工具或 browser_screen_observe，不要通过 browser_run_steps 的截图步骤替代。",
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
      name: "browser_screen_observe",
      description: "视觉优先观察当前标签页。直接返回 MCP image content、viewport 尺寸、DPR 和坐标系信息；坐标统一为 viewport CSS pixels。可开启 withGrid 叠加坐标网格，适合 Canvas、设计器和可视化平台操作前定位。需要看图时优先单独调用本工具。",
      inputSchema: schema({
        tabId: { type: "number" },
        format: { type: "string", enum: ["png", "jpeg"] },
        quality: { type: "number" },
        withGrid: { type: "boolean" },
        gridSize: { type: "number" },
        scale: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = screenObserveSchema.parse(args ?? {});
        return bridge.call("browser_screen_observe", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_screen_click",
      description: "按 viewport CSS pixel 坐标点击当前标签页。适合 Canvas、WebGL、设计器画布、复杂浮层等 DOM 定位不可靠的场景。建议先用 browser_screen_observe 看截图和坐标。",
      inputSchema: schema({
        tabId: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "middle", "right"] },
        clickCount: { type: "number" },
        delayMs: { type: "number" }
      }, ["x", "y"]),
      handler: async (args) => {
        const parsed = screenClickSchema.parse(args ?? {});
        return bridge.call("browser_screen_click", parsed, {
          tabId: parsed.tabId,
          timeoutMs: (parsed.delayMs ?? 0) + 5000
        });
      }
    },
    {
      name: "browser_screen_type",
      description: "向当前焦点按 CDP 输入文本。通常先用 browser_screen_click 点中输入区域或画布文本编辑点，再调用本工具。",
      inputSchema: schema({
        tabId: { type: "number" },
        text: { type: "string" }
      }, ["text"]),
      handler: async (args) => {
        const parsed = screenTypeSchema.parse(args ?? {});
        return bridge.call("browser_screen_type", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_screen_drag",
      description: "按 viewport CSS pixel 坐标拖拽。适合拖动画布节点、设计器组件、范围选择、滑块等视觉操作。",
      inputSchema: schema({
        tabId: { type: "number" },
        from: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" } },
          required: ["x", "y"],
          additionalProperties: false
        },
        to: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" } },
          required: ["x", "y"],
          additionalProperties: false
        },
        button: { type: "string", enum: ["left", "middle", "right"] },
        steps: { type: "number" },
        durationMs: { type: "number" }
      }, ["from", "to"]),
      handler: async (args) => {
        const parsed = screenDragSchema.parse(args ?? {});
        return bridge.call("browser_screen_drag", parsed, {
          tabId: parsed.tabId,
          timeoutMs: (parsed.durationMs ?? 300) + 5000
        });
      }
    },
    {
      name: "browser_screen_scroll",
      description: "按 CDP 发送鼠标滚轮事件。x/y 是滚动发生位置，deltaX/deltaY 是滚动量；不传坐标时默认在视口中心滚动。",
      inputSchema: schema({
        tabId: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        deltaX: { type: "number" },
        deltaY: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = screenScrollSchema.parse(args ?? {});
        return bridge.call("browser_screen_scroll", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_screen_press",
      description: "按 CDP 向页面发送按键，例如 Enter、Escape、Tab、ArrowDown、Backspace。适合视觉操作后的键盘确认或快捷键。",
      inputSchema: schema({
        tabId: { type: "number" },
        key: { type: "string" }
      }, ["key"]),
      handler: async (args) => {
        const parsed = screenPressSchema.parse(args ?? {});
        return bridge.call("browser_screen_press", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_visual_observe",
      description: "【Visual Mode 入口】像 Computer Use 一样观察当前浏览器可视区域：返回截图、坐标系、viewport 和可见文本/控件候选目标。处理 Canvas、设计器、复杂浮层、自定义下拉时优先使用本工具，而不是 page_model/CDP。",
      inputSchema: schema({
        tabId: { type: "number" },
        format: { type: "string", enum: ["png", "jpeg"] },
        quality: { type: "number" },
        withGrid: { type: "boolean" },
        gridSize: { type: "number" },
        scale: { type: "number" },
        includeTargets: { type: "boolean" },
        maxTargets: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = visualObserveSchema.parse(args ?? {});
        return bridge.call("browser_visual_observe", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_visual_click_text",
      description: "【Visual Mode】按当前屏幕上可见文本点击目标，内部会定位文本/控件候选并用坐标点击。适合点击“查询”“保存”“运力开放平台”等屏幕上看得见的目标，避免手动坐标和 CDP 试探。",
      inputSchema: schema({
        tabId: { type: "number" },
        text: { type: "string" },
        exact: { type: "boolean" },
        prefer: { type: "string", enum: ["top", "bottom", "left", "right", "largest", "smallest"] },
        timeoutMs: { type: "number" }
      }, ["text"]),
      handler: async (args) => {
        const parsed = visualClickTextSchema.parse(args ?? {});
        return bridge.call("browser_visual_click_text", parsed, {
          tabId: parsed.tabId,
          timeoutMs: parsed.timeoutMs
        });
      }
    },
    {
      name: "browser_visual_select",
      description: "【Visual Mode】按视觉流程选择下拉：先在屏幕上找到 label 附近的下拉控件并坐标点击，再等待并点击屏幕上的 option 文本。适合“选择业务类型为运力开放平台”这类任务。",
      inputSchema: schema({
        tabId: { type: "number" },
        label: { type: "string" },
        option: { type: "string" },
        exact: { type: "boolean" },
        timeoutMs: { type: "number" }
      }, ["label", "option"]),
      handler: async (args) => {
        const parsed = visualSelectSchema.parse(args ?? {});
        return bridge.call("browser_visual_select", parsed, {
          tabId: parsed.tabId,
          timeoutMs: parsed.timeoutMs
        });
      }
    },
    {
      name: "browser_visual_task",
      description: "【推荐优先使用】执行简单视觉任务闭环（如：点击、输入、选择）。当前支持中文指令中的“选择<字段>为<选项>”和“点击<文本>”，内部使用截图/视觉候选/坐标点击，不走 page_model/CDP 调试链路，更稳定且抗干扰。",
      inputSchema: schema({
        tabId: { type: "number" },
        instruction: { type: "string" },
        timeoutMs: { type: "number" }
      }, ["instruction"]),
      handler: async (args) => {
        const parsed = visualTaskSchema.parse(args ?? {});
        return bridge.call("browser_visual_task", parsed, {
          tabId: parsed.tabId,
          timeoutMs: parsed.timeoutMs ?? 60000
        });
      }
    },
    {
      name: "browser_save_screenshot",
      description: "[DEPRECATED since v0.4.0] Use browser_screenshot({ save: true, path: '...' }) 替代。将在 v0.6.0 移除。",
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
      description: "[DEPRECATED since v0.4.0] Use browser_pdf({ save: true, path: '...' }) 替代。将在 v0.6.0 移除。",
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
      description: "在宿主页面的 window 上下文中执行自定义 JavaScript 表达式并返回结果。可用于读取 window.__vm__、检查全局变量、调用页面方法等。表达式在页面 MAIN world 中执行，拥有完整访问权限。传 mode='cdp' 可使用更强大的 CDP 模式，支持异步等待和更复杂的对象返回。",
      inputSchema: schema({
        tabId: { type: "number" },
        expression: { type: "string" },
        mode: { type: "string", enum: ["default", "cdp"] }
      }, ["expression"]),
      handler: async (args) => {
        const parsed = optionalTabId.extend({
          expression: z.string().min(1),
          mode: z.enum(["default", "cdp"]).optional()
        }).parse(args ?? {});
        return bridge.call("browser_evaluate", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_smart_act",
      description: "增强版浏览器操作（推荐）：自动尝试多种定位策略（语义、选择器、视觉），并在失败时自动进行视觉自愈。支持点击 (click)、输入 (type)、悬停 (hover)、清除 (clear)、等待 (waitFor) 和文本断言 (assertText)。相比 browser_act 更慢但更稳定，适用于复杂、动态或难以定位的页面。如果 DOM 定位失败，它会返回当前页面的截图，此时请你（AI 模型）根据截图识别目标并使用 browser_screen_click 提供精确坐标。",
      inputSchema: schema({
        tabId: { type: "number" },
        action: {
          type: "string",
          enum: ["click", "type", "hover", "clear", "waitFor", "assertText"]
        },
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
        timeoutMs: { type: "number" }
      }, ["action"]),
      handler: async (args) => {
        const tabId = (args as any).tabId;
        try {
          return await bridge.call("browser_smart_act", args as Record<string, unknown>, {
            tabId,
            timeoutMs: (args as any).timeoutMs
          });
        } catch (error: any) {
          // 核心逻辑：当 DOM 定位分值低或未找到元素时，自动开启“视觉地基” (Visual Grounding) 模式
          if (error.message.includes("ELEMENT_NOT_FOUND") || error.message.includes("AMBIGUOUS_TARGET")) {
            try {
              // 自动截图，为视觉模型提供地基
              const screenshot = await bridge.call<Record<string, unknown>>("browser_screenshot", { 
                tabId,
                mode: "cdp",
                scale: 1 
              });
              
              // 包装响应，包含截图和引导指令，形成闭环
              return {
                ok: false,
                error: `DOM_POSITIONING_FAILED: 无法精确定位 "${(args as any).query || (args as any).target || '目标'}".`,
                visualGrounding: {
                  screenshot,
                  instruction: `DOM 定位失败。请分析上方截图，找到目标 "${(args as any).query || (args as any).target}" 的视觉位置，并调用 browser_screen_click(x, y) 执行点击。坐标系为截图上的 CSS 像素坐标。`,
                  viewport: (screenshot as any).viewport
                }
              };
            } catch (ssError) {
              throw error; // 截图也失败则抛出原始错误
            }
          }
          throw error;
        }
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
      description: "[DEPRECATED since v0.4.0] Use browser_act({ action: 'click' }) 或 browser_click_semantic_btn 替代。将在 v0.6.0 移除。",
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
      description: "在新的 Chrome 标签页中打开 URL。内网 SPA/认证跳转较慢时建议 waitUntil='commit'，页面开始导航即返回；如果返回的 tab.url 暂时为空，不代表页面没打开，应继续用 browser_list_tabs、browser_observe 或 visual 工具确认当前标签页，避免重复开新标签。",
      inputSchema: schema({
        url: { type: "string" },
        timeoutMs: { type: "number" },
        waitUntil: { type: "string", enum: ["commit", "ready"] }
      }, ["url"]),
      handler: async (args) => {
        const parsed = openUrlSchema.parse(args ?? {});
        return bridge.call("browser_open_url", parsed, {
          timeoutMs: parsed.timeoutMs ?? (parsed.waitUntil === "commit" ? 5000 : 15000)
        });
      }
    },
    {
      name: "browser_open_incognito",
      description: "在新的 Chrome 隐身窗口中打开 URL。这可以用于测试未登录状态或干净的沙盒环境。注意：需要在插件管理页开启“在隐身模式下启用”。",
      inputSchema: schema({ url: { type: "string" } }, ["url"]),
      handler: async (args) => bridge.call("browser_open_incognito", openUrlSchema.parse(args ?? {}))
    },
    {
      name: "browser_navigate_and_observe",
      description: "打开 URL 并立即返回页面业务摘要（表单/按钮/列表），将 open_url + get_page_model 两步合为一步，减少初次加载的 MCP 往返次数。",
      inputSchema: schema({
        url: { type: "string" },
        waitForSelector: { type: "string", description: "等待特定选择器出现后再采集页面信息" },
        timeoutMs: { type: "number" }
      }, ["url"]),
      handler: async (args) => {
        const parsed = z.object({
          url: z.string().url(),
          waitForSelector: z.string().optional(),
          timeoutMs: z.number().int().positive().optional()
        }).parse(args ?? {});

        // 1. 打开 URL
        const openResult = await bridge.call<{ tabId: number; url: string }>(
          "browser_open_url",
          { url: parsed.url, waitUntil: "ready" },
          { timeoutMs: parsed.timeoutMs ?? 15_000 }
        );

        // 2. 等待特定选择器（如果指定）
        if (parsed.waitForSelector && openResult.tabId) {
          try {
            await bridge.call(
              "browser_wait_for",
              { selector: parsed.waitForSelector, timeoutMs: 5_000 },
              { tabId: openResult.tabId, timeoutMs: 7_000 }
            );
          } catch {
            // 等待超时不阻塞，继续采集
          }
        }

        // 3. 采集页面模型
        if (openResult.tabId) {
          const pageModel = await bridge.call(
            "browser_get_page_model",
            { visibleOnly: true, viewportOnly: true, maxElements: 50 },
            { tabId: openResult.tabId }
          );

          return {
            ...openResult,
            pageModel
          };
        }

        return openResult;
      }
    },
    {
      name: "browser_activate_tab",
      description: "通过 tabId 激活指定 Chrome 标签页。",
      inputSchema: schema({ tabId: { type: "number" } }, ["tabId"]),
      handler: async (args) => bridge.call("browser_activate_tab", activateTabSchema.parse(args ?? {}))
    },
    {
      name: "browser_type",
      description: "[DEPRECATED since v0.4.0] Use browser_act({ action: 'type' }) 或 browser_fill_form_smart 批量填写替代。将在 v0.6.0 移除。",
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
      description: "[DEPRECATED since v0.4.0] Use browser_screen_scroll 替代（CDP 更通用）。将在 v0.6.0 移除。",
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
      description: "等待匹配选择器或可见文本的元素出现。默认超时 30s。",
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
          timeoutMs: parsed.timeoutMs ?? 30000
        });
      }
    },
    {
      name: "browser_run_steps",
      description: "按顺序执行结构化浏览器操作步骤，适合明确的批量操作。支持 open、click、hover、type、selectOption、clear、scroll、waitFor、pressKey、assertText、getText、pageModel、snapshot、screenshot、screenObserve、screenClick、screenType、screenDrag、screenScroll、screenPress、pdf、sleep。表单下拉选择优先使用 selectOption，不要拆成点击下拉再读模型。执行用户明确任务时应尽量一次性组合 open/selectOption/click/assertText 等步骤，最终只向用户报告结果；不要把中间重试、工具选择、截图是否展开等内部过程当作用户可见结论。",
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
                enum: ["open", "activateTab", "click", "hover", "type", "selectOption", "fillForm", "clear", "scroll", "waitFor", "pressKey", "assertText", "getText", "pageModel", "snapshot", "screenshot", "screenObserve", "screenClick", "screenType", "screenDrag", "screenScroll", "screenPress", "pdf", "sleep"]
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
              label: { type: "string" },
              option: { type: "string" },
              exact: { type: "boolean" },
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
              maxTextLength: { type: "number" },
              maxElements: { type: "number" },
              maxHeadings: { type: "number" },
              maxRegions: { type: "number" },
              maxTables: { type: "number" },
              maxTableRows: { type: "number" },
              format: { type: "string", enum: ["png", "jpeg"] },
              quality: { type: "number" },
              withGrid: { type: "boolean" },
              gridSize: { type: "number" },
              x: { type: "number" },
              y: { type: "number" },
              from: {
                type: "object",
                properties: { x: { type: "number" }, y: { type: "number" } },
                required: ["x", "y"],
                additionalProperties: false
              },
              to: {
                type: "object",
                properties: { x: { type: "number" }, y: { type: "number" } },
                required: ["x", "y"],
                additionalProperties: false
              },
              button: { type: "string", enum: ["left", "middle", "right"] },
              clickCount: { type: "number" },
              steps: { type: "number" },
              durationMs: { type: "number" },
              deltaX: { type: "number" },
              deltaY: { type: "number" },
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
          timeoutMs: parsed.timeoutMs ?? Math.max(30_000, parsed.steps.length * 8_000)
        });
      }
    },
    {
      name: "browser_route",
      description: "声明式网络路由。支持拦截匹配指定模式的请求，并返回自定义的响应码、响应体和 Header。常用于 Mock 接口或模拟异常场景。支持一次性或持续拦截。",
      inputSchema: schema({
        tabId: { type: "number" },
        urlPattern: { type: "string" },
        responseCode: { type: "number" },
        responseBody: { type: "string" },
        contentType: { type: "string" },
        headers: { type: "object" },
        durationMs: { type: "number" }
      }, ["urlPattern"]),
      handler: async (args) => {
        const parsed = optionalTabId.extend({
          urlPattern: z.string().min(1),
          responseCode: z.number().int().positive().optional(),
          responseBody: z.string().optional(),
          contentType: z.string().optional(),
          headers: z.record(z.string()).optional(),
          durationMs: z.number().int().positive().optional()
        }).parse(args ?? {});
        return bridge.call("browser_route", parsed, {
          tabId: parsed.tabId,
          timeoutMs: (parsed.durationMs ?? 10000) + 2000
        });
      }
    },
    {
      name: "browser_export_session",
      description: "导出当前浏览器的会话数据，包括指定域名的 Cookies 和 LocalStorage。返回加密（或 base64）的 JSON 字符串，可用于后续恢复登录态。",
      inputSchema: schema({
        tabId: { type: "number" },
        domain: { type: "string" }
      }),
      handler: async (args) => {
        const parsed = optionalTabId.extend({
          domain: z.string().optional()
        }).parse(args ?? {});
        return bridge.call("browser_export_session", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_import_session",
      description: "导入会话数据以恢复登录态。接收由 browser_export_session 生成的数据字符串。注意：导入后可能需要刷新页面生效。",
      inputSchema: schema({
        tabId: { type: "number" },
        sessionData: { type: "string" }
      }, ["sessionData"]),
      handler: async (args) => {
        const parsed = optionalTabId.extend({
          sessionData: z.string().min(1)
        }).parse(args ?? {});
        return bridge.call("browser_import_session", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_close_tab",
      description: "关闭指定的 Chrome 标签页。如果不提供 tabId，则关闭当前活动标签页。",
      inputSchema: schema({
        tabId: { type: "number" }
      }),
      handler: async (args) => {
        const parsed = optionalTabId.parse(args ?? {});
        return bridge.call("browser_close_tab", parsed, { tabId: parsed.tabId });
      }
    },
    {
      name: "browser_new_tab",
      description: "创建一个新的空白标签页或打开指定 URL 的标签页。",
      inputSchema: schema({
        url: { type: "string" }
      }),
      handler: async (args) => {
        const parsed = z.object({ url: z.string().url().optional() }).parse(args ?? {});
        return bridge.call("browser_new_tab", parsed);
      }
    },
    {
      name: "browser_new_context",
      description: "开启一个新的隐私会话环境（隐身窗口）。这提供了一个干净的 Cookie 和存储环境，防止会话污染。",
      inputSchema: schema({
        url: { type: "string" }
      }),
      handler: async (args) => {
        const parsed = z.object({ url: z.string().url().optional() }).parse(args ?? {});
        return bridge.call("browser_new_context", parsed);
      }
    },
    {
      name: "browser_toggle_recording",
      description: "开启或关闭用户操作录制。开启后，用户在浏览器中的点击和输入将被记录，可随后通过 browser_get_recorded_steps 获取。",
      inputSchema: schema({
        enabled: { type: "boolean" }
      }, ["enabled"]),
      handler: async (args) => {
        const parsed = z.object({ enabled: z.boolean() }).parse(args ?? {});
        return bridge.call("browser_toggle_recording", parsed);
      }
    },
    {
      name: "browser_get_recorded_steps",
      description: "获取最近录制的用户操作步骤。返回原始步骤列表。",
      inputSchema: schema({}),
      handler: async () => {
        return bridge.call("browser_get_recorded_steps", {});
      }
    },
    {
      name: "browser_generate_script",
      description: "【自动化核心】将最近录制的用户操作转换为可直接运行的 browser_run_steps 脚本。它会自动清洗冗余操作（如重复滚动、输入中间态）、合并步骤并添加必要的断言和截图。生成的 JSON 可以直接作为 browser_run_steps 的输入。",
      inputSchema: schema({
        title: { type: "string" }
      }),
      handler: async (args) => {
        const parsed = z.object({ title: z.string().optional() }).parse(args ?? {});
        const steps = await bridge.call<RecordedStep[]>("browser_get_recorded_steps", {});
        if (!steps || steps.length === 0) {
          throw new Error("NO_STEPS_RECORDED: 当前没有录制的步骤。请先调用 browser_toggle_recording(enabled=true) 并在页面上进行操作。");
        }
        
        const qaCase = recordedStepsToCase(steps, { title: parsed.title });
        return {
          ok: true,
          title: qaCase.title,
          stepsCount: qaCase.steps.length,
          payload: {
            steps: qaCase.steps,
            stopOnError: true,
            delayMs: 500
          },
          instruction: "你可以复制上面的 payload.steps 数组到 browser_run_steps 中执行自动化流程。"
        };
      }
    },
    {
      name: "browser_agent_goal",
      description: "【Agentic Planner】下达一个模糊的高级目标（如“对比三家店的价格”），系统会启动一个 ReAct (Thought-Action-Observation) 循环来拆解并执行任务。它会自动决定何时搜索、何时提取数据、何时跳转。",
      inputSchema: schema({
        goal: { type: "string" },
        maxSteps: { type: "number" }
      }, ["goal"]),
      handler: async (args) => {
        const { goal, maxSteps = 10 } = z.object({
          goal: z.string().min(1),
          maxSteps: z.number().int().positive().optional()
        }).parse(args ?? {});
        
        const planner = new BrowserAgentPlanner(goal);
        let currentObs = await bridge.call<any>("browser_get_active_tab");
        // 初始化观察
        const initialModel = await bridge.call<any>("browser_get_page_model", { visibleOnly: true });
        
        const results = [];
        for (let i = 0; i < maxSteps; i++) {
          const { thought, action, isDone } = await planner.nextStep({
            url: initialModel.url,
            title: initialModel.title,
            summary: initialModel.summary?.textSample || "",
          });
          
          results.push({ step: i + 1, thought, action });
          if (isDone) break;
          
          // 执行动作
          await bridge.call("browser_run_steps", { steps: [action] });
        }
        
        return { ok: true, goal, completedSteps: results };
      }
    },
    {
      name: "browser_set_variable",
      description: "【跨页上下文】在 MCP 会话存储中设置一个变量。该变量可以被后续的工具调用通过 {{varName}} 语法引用，实现跨页面、跨标签页的数据传递（例如：记录订单号并在另一个页面查询）。",
      inputSchema: schema({
        name: { type: "string" },
        value: { type: "any" }
      }, ["name", "value"]),
      handler: async (args) => {
        const { name, value } = z.object({
          name: z.string().min(1),
          value: z.any()
        }).parse(args ?? {});
        await bridge.setVariable(name, value);
        return { ok: true, name, value };
      }
    },
    {
      name: "browser_get_variables",
      description: "【跨页上下文】获取当前所有已设置的会话变量。",
      inputSchema: schema({}),
      handler: async () => {
        return { ok: true, variables: await bridge.getAllVariables() };
      }
    },
    {
      name: "browser_run_skill",
      description: "【技能系统】运行预设的复杂流（Skill）。Skill 是经过优化的步骤集合，支持参数化调用。系统会自动将参数注入到步骤的 {{paramName}} 中。",
      inputSchema: schema({
        skillId: { type: "string" },
        parameters: { type: "object" }
      }, ["skillId"]),
      handler: async (args) => {
        const { skillId, parameters = {} } = z.object({
          skillId: z.string().min(1),
          parameters: z.record(z.any()).optional()
        }).parse(args ?? {});
        
        // 1. 设置参数到上下文
        for (const [key, val] of Object.entries(parameters)) {
          await bridge.setVariable(key, val);
        }
        
        // 2. 获取 Skill 定义 (这里简单模拟，实际可以从文件读取)
        const skills: Record<string, any> = {
          "search-and-compare": {
            steps: [
              { action: "open", url: "https://www.google.com/search?q={{keyword}}" },
              { action: "pageModel", visibleOnly: true },
              { action: "screenshot" }
            ]
          }
        };
        
        const skill = skills[skillId];
        if (!skill) {
          throw new Error(`SKILL_NOT_FOUND: 未找到 ID 为 ${skillId} 的技能`);
        }
        
        // 3. 运行步骤 (插值会在 bridge.call 内部自动完成)
        return bridge.call("browser_run_steps", { steps: skill.steps });
      }
    }
  ];

  return tools.map(withDefaultAnnotations);
}

function withDefaultAnnotations(tool: BrowserToolDefinition): BrowserToolDefinition {
  if (tool.annotations) {
    return tool;
  }

  if (READ_ONLY_TOOLS.has(tool.name)) {
    return { ...tool, annotations: browserReadOnlyAnnotations };
  }

  return { ...tool, annotations: browserNonDestructiveAnnotations };
}

const READ_ONLY_TOOLS = new Set<string>([
  "browser_status",
  "browser_get_active_tab",
  "browser_list_tabs",
  "browser_get_page_text",
  "browser_get_page_snapshot",
  "browser_get_page_model",
  "browser_get_interactives",
  "browser_find",
  "browser_observe",
  "browser_get_ax_tree",
  "browser_get_selected_text",
  "browser_get_links",
  "browser_get_audit_log",
  "browser_screenshot",
  "browser_screen_observe",
  "browser_visual_observe",
  "browser_pdf",
  "browser_capture_page",
  "browser_console_monitor",
  "browser_network_analysis",
  "browser_get_recorded_steps",
  "browser_generate_script",
  "browser_get_variables",
  "browser_get_form_structure",
  "browser_navigate_and_observe"
]);

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
      // 记录降级日志，便于调试
      console.warn(`[capturePage] ${format} failed, trying next format:`, message);
    }
  }

  throw new Error("INTERNAL_ERROR: 所有捕获格式均失败");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
