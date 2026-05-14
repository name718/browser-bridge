#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { BrowserBridge } from "./bridge/browser-bridge.js";
import { createBrowserTools } from "./tools/browser-tools.js";
import { Logger } from "./logger/logger.js";
import { sanitizeForLog } from "./security/sanitize.js";

const logger = new Logger("mcp-server");
const bridgePort = Number(process.env.BROWSER_BRIDGE_PORT ?? 17321);
const bridge = new BrowserBridge(bridgePort);
const tools = createBrowserTools(bridge);
const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

bridge.start();

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
  tools: tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }))
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = toolMap.get(request.params.name);
  if (!tool) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  logger.info("tool call", {
    name: request.params.name,
    arguments: sanitizeForLog(request.params.arguments)
  });

  try {
    const result = await tool.handler(request.params.arguments ?? {});
    if (request.params.name === "browser_screenshot") {
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
    logger.warn("tool failed", { name: request.params.name, message });
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
logger.info("mcp server started", { bridgePort });

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
