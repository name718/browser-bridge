#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { DaemonBridgeClient } from "./bridge/daemon-client.js";
import { createBrowserTools } from "./tools/browser-tools.js";
import { createQaTools } from "./qa/qa-tools.js";
import { isRecord } from "@majuntao-1/browser-bridge-shared";
import { Logger } from "./logger/logger.js";
import { sanitizeForLog } from "./security/sanitize.js";

const logger = new Logger("mcp-server");
const bridgePort = Number(process.env.BROWSER_BRIDGE_PORT ?? 17321);
const apiPort = Number(process.env.BROWSER_BRIDGE_API_PORT ?? 17320);
const bridge = new DaemonBridgeClient(bridgePort, apiPort);
const tools = [
  ...createBrowserTools(bridge),
  ...createQaTools(bridge)
];
const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

let activated = false;

const browserUseTool = {
  name: "browser_use",
  description:
    "激活或关闭浏览器桥接 MCP 工具集。当 use=true 时，会激活工具并打开 Sci-Fi 蒙层（作为 Agent 正在使用浏览器的标识）；当 use=false 时，会关闭蒙层并清除本次会话的完全信任状态。Agent 在开始一系列浏览器操作前应当先询问用户是否允许完全自动化，若用户同意，后续调用应传 trustAgentFully=true 以实现全程无打扰操作。",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
  },
  inputSchema: {
    type: "object",
    properties: {
      use: {
        type: "boolean",
        description: "是否正在使用浏览器。true 开启蒙层，false 关闭蒙层。"
      },
      trustAgentFully: {
        type: "boolean",
        description: "是否在本次 browser_use 会话中完全信任 Agent 操作浏览器。仅当用户明确同意后传 true；use=false 会清除该状态。"
      }
    },
    required: [],
    additionalProperties: false
  }
};

const server = new Server(
  {
    name: "browser-bridge",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [browserUseTool, ...tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations
  }))]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;

  // browser_use 激活开关
  if (name === "browser_use") {
    const args = (request.params.arguments ?? {}) as { use?: boolean; trustAgentFully?: boolean };
    const use = args.use !== false; // 默认 true
    activated = use;
    
    // 通知插件开启/关闭蒙层
    let extensionResult = {};
    try {
      extensionResult = await bridge.call("browser_use", {
        use,
        trustAgentFully: use && args.trustAgentFully === true
      });
    } catch (e) {
      logger.warn("failed to send browser_use to extension", e);
    }

    logger.info("browser-bridge status changed", { activated: use });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ 
            activated: use, 
            trustAgentFully: use && args.trustAgentFully === true,
            message: use ? "浏览器桥接工具已激活且蒙层已开启。" : "浏览器桥接工具已关闭且蒙层将平滑退出。",
            extensionResult 
          }, null, 2)
        }
      ]
    };
  }

  // 自动激活，避免 Agent 首次调用 browser_* 时先失败一轮。
  if (!activated && name.startsWith("browser_")) {
    activated = true;
    try {
      await bridge.call("browser_use", { use: true });
    } catch (e) {
      logger.warn("failed to auto-activate browser bridge", e);
    }
  }

  const tool = toolMap.get(name);
  if (!tool) {
    throw new Error(`未知工具：${name}`);
  }

  logger.info("tool call", {
    name,
    arguments: sanitizeForLog(request.params.arguments)
  });

  try {
    const result = await tool.handler(request.params.arguments ?? {});
    if (name === "browser_screenshot" || name === "browser_screen_observe" || name === "browser_visual_observe") {
      return formatScreenshotResult(result);
    }
    if (name === "browser_pdf") {
      return formatPdfResult(result);
    }
    if (name === "browser_capture_page" && isRecord(result) && result.format === "pdf" && typeof result.data === "string") {
      return formatPdfResult(result);
    }
    if (name === "browser_run_steps") {
      return formatRunStepsResult(result);
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("tool failed", { name, message });
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: message
        }
      ]
    };
  }
});

function formatRunStepsResult(result: unknown): {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
} {
  const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
  const textResult = stripDataUrls(result, images);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(textResult, null, 2)
      },
      ...images
    ]
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
logger.info("mcp server started", {
  apiUrl: `http://127.0.0.1:${apiPort}`,
  bridgeUrl: `ws://127.0.0.1:${bridgePort}`,
  hint: `请在浏览器桥接插件中填写 ws://127.0.0.1:${bridgePort}`
});

function formatScreenshotResult(result: unknown): {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
} {
  if (!isRecord(result) || typeof result.dataUrl !== "string") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  const [header, data] = result.dataUrl.split(",", 2);
  const mimeType = typeof result.mimeType === "string"
    ? result.mimeType
    : header.match(/^data:(.*);base64$/)?.[1] ?? "image/png";

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          tabId: result.tabId,
          url: result.url,
          title: result.title,
          mimeType
        }, null, 2)
      },
      {
        type: "image",
        data,
        mimeType
      }
    ]
  };
}

function stripDataUrls(
  value: unknown,
  images: Array<{ type: "image"; data: string; mimeType: string }>
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripDataUrls(item, images));
  }

  if (!isRecord(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "dataUrl" && typeof entry === "string") {
      const image = dataUrlToImage(entry, typeof value.mimeType === "string" ? value.mimeType : undefined);
      if (image) {
        images.push(image);
        output.imageContentIndex = images.length - 1;
        output.dataUrlLength = entry.length;
      }
      continue;
    }
    output[key] = stripDataUrls(entry, images);
  }
  return output;
}

function dataUrlToImage(
  dataUrl: string,
  fallbackMimeType?: string
): { type: "image"; data: string; mimeType: string } | undefined {
  const [header, data] = dataUrl.split(",", 2);
  if (!data) {
    return undefined;
  }
  const mimeType = fallbackMimeType
    ?? header.match(/^data:(.*);base64$/)?.[1]
    ?? "image/png";
  return { type: "image", data, mimeType };
}

function formatPdfResult(result: unknown): {
  content: Array<
    | { type: "text"; text: string }
    | { type: "resource"; resource: { uri: string; mimeType: string; blob: string } }
  >;
} {
  if (!isRecord(result) || typeof result.data !== "string") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  const metadata = {
    tabId: result.tabId,
    url: result.url,
    title: result.title,
    mimeType: result.mimeType ?? "application/pdf"
  };

  const returnFormat = result._returnFormat === "text" ? "text" : "resource";

  if (returnFormat === "text") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ...metadata,
            data: `data:application/pdf;base64,${result.data}`
          }, null, 2)
        }
      ]
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(metadata, null, 2)
      },
      {
        type: "resource",
        resource: {
          uri: `data:application/pdf;base64,${result.data}`,
          mimeType: "application/pdf",
          blob: result.data
        }
      }
    ]
  };
}
