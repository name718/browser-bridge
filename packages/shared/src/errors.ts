/**
 * 结构化错误码系统
 *
 * 替代字符串匹配（如 error.message.includes("ELEMENT_NOT_FOUND")），
 * 提供 machine-readable 的错误码和可序列化的跨进程序列化格式。
 *
 * 注意：protocol.ts 中有同名的 BridgeError / BridgeErrorCode 类型（旧协议兼容）。
 * 本模块导出的版本功能更强（enum + class），通过 index.ts 用别名导出避免冲突。
 */

/**
 * 错误码枚举（结构化版本，比 protocol.ts 中的字符串联合类型更易用）
 */
export enum ErrorCode {
  BROWSER_NOT_CONNECTED = "BROWSER_NOT_CONNECTED",
  TAB_NOT_FOUND = "TAB_NOT_FOUND",
  TAB_NOT_ACTIVE = "TAB_NOT_ACTIVE",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  DOMAIN_NOT_ALLOWED = "DOMAIN_NOT_ALLOWED",
  CONTENT_SCRIPT_NOT_READY = "CONTENT_SCRIPT_NOT_READY",
  ELEMENT_NOT_FOUND = "ELEMENT_NOT_FOUND",
  ELEMENT_NOT_VISIBLE = "ELEMENT_NOT_VISIBLE",
  ELEMENT_DISABLED = "ELEMENT_DISABLED",
  ACTION_TIMEOUT = "ACTION_TIMEOUT",
  USER_CONFIRMATION_REQUIRED = "USER_CONFIRMATION_REQUIRED",
  USER_REJECTED = "USER_REJECTED",
  UNSUPPORTED_PAGE = "UNSUPPORTED_PAGE",
  INVALID_PARAMS = "INVALID_PARAMS",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  DEBUGGER_BUSY = "DEBUGGER_BUSY",
  // 新增的结构化错误码
  AMBIGUOUS_TARGET = "AMBIGUOUS_TARGET",
  ELEMENT_NOT_INTERACTABLE = "ELEMENT_NOT_INTERACTABLE",
  TIMEOUT = "TIMEOUT",
  CONNECTION_LOST = "CONNECTION_LOST",
  NAVIGATION_FAILED = "NAVIGATION_FAILED",
  SENSITIVE_FIELD = "SENSITIVE_FIELD",
}

/**
 * 可序列化的错误载荷（跨进程传输格式）
 *
 * Extension Content Script、Background、MCP Server 之间
 * 不能依赖 error instanceof StructuredBridgeError，错误必须以协议对象传输。
 */
export interface StructuredBridgeErrorPayload {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    /** 是否可重试（仅连接丢失、超时、内容脚本未就绪等瞬时问题） */
    retryable?: boolean;
    /** 降级策略提示 */
    fallback?: "none" | "semantic" | "visual";
  };
}

/**
 * 结构化错误类（MCP Server 端使用）
 *
 * 比 protocol.ts 中的 BridgeError 类型更强大：
 * - 继承 Error，可被 throw/catch
 * - 携带 retryable 和 fallback 信息
 * - 支持 toPayload() / fromPayload() 序列化
 *
 * 注意：跨进程边界时应序列化为 StructuredBridgeErrorPayload，
 * 不要依赖 instanceof 检查。
 */
export class StructuredBridgeError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;
  public readonly retryable: boolean;
  public readonly fallback: "none" | "semantic" | "visual";

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      details?: Record<string, unknown>;
      retryable?: boolean;
      fallback?: "none" | "semantic" | "visual";
    } = {}
  ) {
    super(message);
    this.name = "StructuredBridgeError";
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
    this.fallback = options.fallback ?? "none";
  }

  /** 转换为可序列化的 StructuredBridgeErrorPayload */
  toPayload(): StructuredBridgeErrorPayload {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        retryable: this.retryable,
        fallback: this.fallback,
      },
    };
  }

  /** 从 StructuredBridgeErrorPayload 创建 StructuredBridgeError */
  static fromPayload(payload: StructuredBridgeErrorPayload): StructuredBridgeError {
    return new StructuredBridgeError(payload.error.code, payload.error.message, {
      details: payload.error.details,
      retryable: payload.error.retryable,
      fallback: payload.error.fallback,
    });
  }
}

/** 默认的错误码到重试/降级策略映射 */
const DEFAULT_STRATEGY: Record<
  ErrorCode,
  { retryable: boolean; fallback: "none" | "semantic" | "visual" }
> = {
  [ErrorCode.ELEMENT_NOT_FOUND]: { retryable: false, fallback: "visual" },
  [ErrorCode.AMBIGUOUS_TARGET]: { retryable: false, fallback: "semantic" },
  [ErrorCode.ELEMENT_NOT_INTERACTABLE]: { retryable: false, fallback: "visual" },
  [ErrorCode.ELEMENT_NOT_VISIBLE]: { retryable: false, fallback: "visual" },
  [ErrorCode.ELEMENT_DISABLED]: { retryable: false, fallback: "none" },
  [ErrorCode.TIMEOUT]: { retryable: true, fallback: "none" },
  [ErrorCode.CONNECTION_LOST]: { retryable: true, fallback: "none" },
  [ErrorCode.NAVIGATION_FAILED]: { retryable: true, fallback: "none" },
  [ErrorCode.SENSITIVE_FIELD]: { retryable: false, fallback: "none" },
  [ErrorCode.PERMISSION_DENIED]: { retryable: false, fallback: "none" },
  [ErrorCode.DOMAIN_NOT_ALLOWED]: { retryable: false, fallback: "none" },
  [ErrorCode.CONTENT_SCRIPT_NOT_READY]: { retryable: true, fallback: "none" },
  [ErrorCode.TAB_NOT_FOUND]: { retryable: false, fallback: "none" },
  [ErrorCode.TAB_NOT_ACTIVE]: { retryable: false, fallback: "none" },
  [ErrorCode.INVALID_PARAMS]: { retryable: false, fallback: "none" },
  [ErrorCode.INTERNAL_ERROR]: { retryable: false, fallback: "none" },
  [ErrorCode.USER_REJECTED]: { retryable: false, fallback: "none" },
  [ErrorCode.USER_CONFIRMATION_REQUIRED]: { retryable: false, fallback: "none" },
  [ErrorCode.UNSUPPORTED_PAGE]: { retryable: false, fallback: "none" },
  [ErrorCode.BROWSER_NOT_CONNECTED]: { retryable: true, fallback: "none" },
  [ErrorCode.DEBUGGER_BUSY]: { retryable: true, fallback: "none" },
  [ErrorCode.ACTION_TIMEOUT]: { retryable: true, fallback: "none" },
};

/**
 * 从旧的 Error 对象规范化为 StructuredBridgeError
 *
 * 兼容现有的 throw new Error("ELEMENT_NOT_FOUND: ...") 模式，
 * 在边界层统一转成 StructuredBridgeError。
 */
export function normalizeBridgeError(error: unknown): StructuredBridgeError {
  if (error instanceof StructuredBridgeError) {
    return error;
  }

  if (error instanceof Error) {
    // 尝试从 message 前缀提取错误码（兼容旧代码）
    for (const code of Object.values(ErrorCode)) {
      if (error.message.startsWith(code) || error.message.includes(code)) {
        const strategy = DEFAULT_STRATEGY[code];
        return new StructuredBridgeError(code, error.message, {
          retryable: strategy.retryable,
          fallback: strategy.fallback,
        });
      }
    }
    return new StructuredBridgeError(ErrorCode.INTERNAL_ERROR, error.message);
  }

  return new StructuredBridgeError(
    ErrorCode.INTERNAL_ERROR,
    String(error)
  );
}
