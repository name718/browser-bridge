import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type BridgeRequest, type BrowserStatus } from "@majuntao-1/browser-bridge-shared";
import { isRecord } from "@majuntao-1/browser-bridge-shared";
import { Logger } from "../logger/logger.js";
import { isRetryableError, withRetry } from "../utils/retry.js";

type DaemonStatus = BrowserStatus & {
  apiUrl?: string;
  bridgeUrl?: string;
};

export class DaemonBridgeClient {
  private readonly logger = new Logger("daemon-client");
  private readonly apiUrl: string;
  private startPromise?: Promise<void>;

  constructor(
    private readonly bridgePort: number,
    private readonly apiPort: number
  ) {
    this.apiUrl = `http://127.0.0.1:${apiPort}`;
  }

  async getStatus(): Promise<DaemonStatus> {
    await this.ensureDaemon();
    return this.request<DaemonStatus>("/status", { method: "GET" });
  }

  async setVariable(name: string, value: any): Promise<void> {
    await this.ensureDaemon();
    await this.request("/vars", {
      method: "POST",
      body: JSON.stringify({ name, value })
    });
  }

  async getVariable(name: string): Promise<any> {
    await this.ensureDaemon();
    const res = await this.request<{ value: any }>(`/vars?name=${encodeURIComponent(name)}`, {
      method: "GET"
    });
    return res.value;
  }

  async getAllVariables(): Promise<Record<string, any>> {
    await this.ensureDaemon();
    const res = await this.request<{ variables: Record<string, any> }>("/vars", {
      method: "GET"
    });
    return res.variables;
  }

  async clearVariables(): Promise<void> {
    await this.ensureDaemon();
    await this.request("/vars", { method: "DELETE" });
  }

  async call<T = unknown>(
    tool: BridgeRequest["tool"],
    params?: Record<string, unknown>,
    options?: { tabId?: number; timeoutMs?: number }
  ): Promise<T> {
    await this.ensureDaemon();
    const result = await withRetry(() => this.request<{ data: T }>("/call", {
      method: "POST",
      body: JSON.stringify({
        tool,
        params,
        tabId: options?.tabId,
        timeoutMs: options?.timeoutMs
      }),
      timeoutMs: options?.timeoutMs ? options.timeoutMs + 5000 : undefined
    }), {
      maxAttempts: isReadOnlyBridgeTool(tool) ? 3 : 2,
      baseDelay: 200,
      retryOn: isRetryableError
    });
    return result.data;
  }

  private async ensureDaemon(): Promise<void> {
    if (await this.isDaemonReady()) {
      return;
    }

    this.startPromise ??= this.startDaemon();
    await this.startPromise;
  }

  private async startDaemon(): Promise<void> {
    const daemonPath = resolve(dirname(fileURLToPath(import.meta.url)), "../daemon.js");
    const child = spawn(process.execPath, [daemonPath], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        BROWSER_BRIDGE_PORT: String(this.bridgePort),
        BROWSER_BRIDGE_API_PORT: String(this.apiPort)
      }
    });
    child.unref();

    this.logger.info("daemon start requested", {
      daemonPath,
      apiUrl: this.apiUrl,
      bridgeUrl: `ws://127.0.0.1:${this.bridgePort}`
    });

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await this.isDaemonReady()) {
        return;
      }
      await delay(100);
    }

    throw new Error(`DAEMON_NOT_READY: daemon 未启动。请手动运行 node ${daemonPath}`);
  }

  private async isDaemonReady(): Promise<boolean> {
    try {
      await this.request("/status", { method: "GET", timeoutMs: 2_000 });
      return true;
    } catch {
      return false;
    }
  }

  private async request<T>(
    path: string,
    options: { method: "GET" | "POST" | "DELETE"; body?: string; timeoutMs?: number }
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    try {
      const response = await fetch(`${this.apiUrl}${path}`, {
        method: options.method,
        body: options.body,
        headers: options.body ? { "content-type": "application/json" } : undefined,
        signal: controller.signal
      });
      const payload = await response.json() as unknown;
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : `DAEMON_ERROR: ${response.status}`;
        throw new Error(message);
      }
      return payload as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isReadOnlyBridgeTool(tool: BridgeRequest["tool"]): boolean {
  return /^(browser_status|browser_get_|browser_list_|browser_observe|browser_screenshot|browser_pdf|browser_capture_page|browser_console_monitor|browser_network_analysis)/.test(tool);
}
