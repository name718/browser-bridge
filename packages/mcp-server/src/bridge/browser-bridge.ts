import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  type BridgeRequest,
  type BridgeResponse,
  type BrowserStatus,
  PROTOCOL_VERSION
} from "@majuntao-1/browser-bridge-shared";
import { Logger } from "../logger/logger.js";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
};

type ConnectionWaiter = {
  resolve: () => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
};

export class BrowserBridge {
  private readonly logger = new Logger("browser-bridge");
  private readonly pending = new Map<string, PendingRequest>();
  private server?: WebSocketServer;
  private socket?: WebSocket;
  private connectedAt?: string;
  private extensionVersion?: string;
  private readonly connectionWaiters = new Set<ConnectionWaiter>();

  constructor(private readonly port: number) {}

  start(): void {
    if (this.server) {
      return;
    }

    this.server = new WebSocketServer({
      host: "127.0.0.1",
      port: this.port
    });

    this.server.on("connection", (socket) => {
      this.attachSocket(socket);
    });

    this.server.on("listening", () => {
      this.logger.info("bridge listening", {
        port: this.port,
        bridgeUrl: `ws://127.0.0.1:${this.port}`,
        hint: `请在浏览器桥接插件中填写 ws://127.0.0.1:${this.port}`
      });
    });

    this.server.on("error", (error) => {
      this.logger.error("bridge listen failed", {
        port: this.port,
        message: error.message
      });
    });
  }

  getStatus(): BrowserStatus {
    return {
      connected: this.socket?.readyState === WebSocket.OPEN,
      protocolVersion: PROTOCOL_VERSION,
      extensionVersion: this.extensionVersion,
      connectedAt: this.connectedAt
    };
  }

  async call<T = unknown>(
    tool: BridgeRequest["tool"],
    params?: Record<string, unknown>,
    options?: { tabId?: number; timeoutMs?: number }
  ): Promise<T> {
    const socket = await this.getConnectedSocket(options?.timeoutMs);

    const id = randomUUID();
    const timeoutMs = options?.timeoutMs ?? 10_000;
    const request: BridgeRequest = {
      id,
      tool,
      params,
      tabId: options?.tabId,
      timeoutMs
    };

    const result = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACTION_TIMEOUT: ${tool} 在 ${timeoutMs}ms 内未返回`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout
      });
    });

    socket.send(JSON.stringify({ kind: "request", payload: request }));
    return result;
  }

  private async getConnectedSocket(timeoutMs = 15_000): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return this.socket;
    }

    this.logger.info("waiting for extension to reconnect...");
    // 允许更长的等待时间 (25s) 以便插件的 keepalive 定时器能将其唤醒
    await this.waitForConnection(Math.min(timeoutMs, 25_000));

    const socket = this.socket;
    if (socket?.readyState === WebSocket.OPEN) {
      return socket;
    }

    throw new Error(`BROWSER_NOT_CONNECTED: Chrome 插件未连接。请打开“浏览器桥接”插件，并填写 ws://127.0.0.1:${this.port}`);
  }

  private waitForConnection(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiter: ConnectionWaiter = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.connectionWaiters.delete(waiter);
          reject(new Error(`BROWSER_NOT_CONNECTED: Chrome 插件未连接。请打开“浏览器桥接”插件，并填写 ws://127.0.0.1:${this.port}`));
        }, timeoutMs)
      };
      this.connectionWaiters.add(waiter);
    });
  }

  private attachSocket(socket: WebSocket): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1012, "Replacing existing extension connection");
    }

    this.socket = socket;
    this.connectedAt = new Date().toISOString();
    this.extensionVersion = undefined;
    this.logger.info("extension connected");
    this.resolveConnectionWaiters();

    socket.on("message", (raw) => {
      this.handleMessage(raw.toString());
    });

    socket.on("close", () => {
      this.logger.warn("extension disconnected");
      if (this.socket === socket) {
        this.socket = undefined;
        this.connectedAt = undefined;
        this.extensionVersion = undefined;
      }
      this.rejectAll("BROWSER_NOT_CONNECTED: Chrome 插件已断开连接");
    });

    socket.on("error", (error) => {
      this.logger.error("extension socket error", { message: error.message });
    });
  }

  private handleMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      this.logger.warn("invalid json from extension");
      return;
    }

    if (!isRecord(message)) {
      return;
    }

    if (message.kind === "hello" && isRecord(message.payload)) {
      this.extensionVersion = String(message.payload.extensionVersion ?? "unknown");
      this.logger.info("extension hello", {
        extensionVersion: this.extensionVersion,
        protocolVersion: message.payload.protocolVersion
      });
      return;
    }

    if (message.kind !== "response" || !isRecord(message.payload)) {
      return;
    }

    const response = message.payload as BridgeResponse;
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(response.id);

    if (response.ok) {
      pending.resolve(response.data);
      return;
    }

    const code = response.error?.code ?? "INTERNAL_ERROR";
    const detail = response.error?.message ?? "浏览器桥接请求失败";
    pending.reject(new Error(`${code}: ${detail}`));
  }

  private rejectAll(message: string): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
      this.pending.delete(id);
    }
  }

  private resolveConnectionWaiters(): void {
    for (const waiter of this.connectionWaiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve();
      this.connectionWaiters.delete(waiter);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
