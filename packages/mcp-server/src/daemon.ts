#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { BrowserBridge } from "./bridge/browser-bridge.js";
import { Logger } from "./logger/logger.js";

const logger = new Logger("bridge-daemon");
const bridgePort = Number(process.env.BROWSER_BRIDGE_PORT ?? 17321);
const apiPort = Number(process.env.BROWSER_BRIDGE_API_PORT ?? 17320);
const bridge = new BrowserBridge(bridgePort);

bridge.start();

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.on("error", (error) => {
  logger.error("daemon api listen failed", {
    apiPort,
    message: error.message
  });
});

server.listen(apiPort, "127.0.0.1", () => {
  logger.info("daemon api listening", {
    apiUrl: `http://127.0.0.1:${apiPort}`,
    bridgeUrl: `ws://127.0.0.1:${bridgePort}`,
    hint: `请在浏览器桥接插件中填写 ws://127.0.0.1:${bridgePort}`
  });
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    if (request.method === "GET" && request.url === "/status") {
      sendJson(response, 200, {
        ...bridge.getStatus(),
        apiUrl: `http://127.0.0.1:${apiPort}`,
        bridgeUrl: `ws://127.0.0.1:${bridgePort}`
      });
      return;
    }

    if (request.method === "POST" && request.url === "/call") {
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.tool !== "string") {
        sendJson(response, 400, { error: "INVALID_PARAMS: tool 参数必填" });
        return;
      }

      const data = await bridge.call(
        body.tool as never,
        isRecord(body.params) ? body.params : undefined,
        {
          tabId: typeof body.tabId === "number" ? body.tabId : undefined,
          timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined
        }
      );
      sendJson(response, 200, { data });
      return;
    }

    sendJson(response, 404, { error: "NOT_FOUND: 未找到接口" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("daemon request failed", { message });
    sendJson(response, 500, { error: message });
  }
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

