/**
 * 指数退避重试机制
 *
 * 应用到关键路径：DaemonBridgeClient.call()、BrowserBridge.call()、capturePage() 等。
 * 仅对 retryable 错误（连接丢失、超时、内容脚本未就绪）进行重试。
 */

export interface RetryOptions {
  /** 最大尝试次数（默认 3） */
  maxAttempts?: number;
  /** 基础延迟（毫秒，默认 500） */
  baseDelay?: number;
  /** 最大延迟（毫秒，默认 10000） */
  maxDelay?: number;
  /** 判断是否应该重试的函数 */
  retryOn?: (error: unknown) => boolean;
}

/**
 * 带指数退避的重试包装器
 *
 * @param fn 要执行的异步函数
 * @param options 重试选项
 * @returns fn 的返回值
 * @throws 最后一次尝试的错误（如果所有重试都失败）
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 500,
    maxDelay = 10_000,
    retryOn,
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // 最后一次尝试失败，或错误不可重试
      if (attempt === maxAttempts) throw error;
      if (retryOn && !retryOn(error)) throw error;

      // 指数退避 + 随机抖动
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      const jitter = delay * 0.1 * Math.random();
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }

  // TypeScript 类型收窄（不可达）
  throw new Error("Unreachable");
}

/**
 * 判断错误是否为可重试的瞬时错误
 */
export function isRetryableError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;
    // BridgeError 的 code 字段
    if (err.code === "TIMEOUT" || err.code === "CONNECTION_LOST" || err.code === "CONTENT_SCRIPT_NOT_READY") {
      return true;
    }
    // BridgeErrorPayload 格式
    if (err.error && typeof err.error === "object") {
      const inner = err.error as Record<string, unknown>;
      if (inner.code === "TIMEOUT" || inner.code === "CONNECTION_LOST") {
        return true;
      }
    }
    // retryable 标记
    if (err.retryable === true) return true;
  }
  // 网络错误
  if (error instanceof Error) {
    if (error.message.includes("ECONNREFUSED") || error.message.includes("ECONNRESET")) {
      return true;
    }
  }
  return false;
}
