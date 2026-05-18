#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { DaemonBridgeClient } from "./bridge/daemon-client.js";
import { createBrowserTools } from "./tools/browser-tools.js";
import { Logger } from "./logger/logger.js";
import { sanitizeForLog } from "./security/sanitize.js";

const logger = new Logger("mcp-server");
const bridgePort = Number(process.env.BROWSER_BRIDGE_PORT ?? 17321);
const apiPort = Number(process.env.BROWSER_BRIDGE_API_PORT ?? 17320);
const bridge = new DaemonBridgeClient(bridgePort, apiPort);
const tools = createBrowserTools(bridge);
const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

let activated = false;

const browserUseTool = {
  name: "browser_use",
  description:
    "激活浏览器桥接 MCP 工具集。调用此工具后，所有 browser_* 工具才可正常使用。未激活时调用任何 browser_* 工具都会被拒绝。",
  inputSchema: {
    type: "object",
    properties: {},
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
    inputSchema: tool.inputSchema
  }))]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;

  // browser_use 激活开关
  if (name === "browser_use") {
    activated = true;
    logger.info("browser-bridge activated by user");
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ activated: true, message: "浏览器桥接工具已激活，现在可以使用所有 browser_* 工具。" }, null, 2)
        }
      ]
    };
  }

  // 未激活时拒绝所有其他 browser_* 工具
  if (!activated && name.startsWith("browser_")) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "浏览器桥接工具未激活。请先调用 browser_use 工具来激活，然后再使用其他 browser_* 工具。"
        }
      ]
    };
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
    if (name === "browser_screenshot") {
      return formatScreenshotResult(result);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
