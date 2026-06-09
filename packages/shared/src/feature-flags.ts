/**
 * Browser Bridge Feature Flag System
 *
 * 新能力默认关闭，完成阶段验收后再按场景灰度打开。
 * 性能缓存类 flag 必须先通过 benchmark，无回归后才能设为默认开启。
 * 工具合并类 flag 永远不默认移除旧工具，只控制新入口推荐和 warning 行为。
 */

export interface BrowserBridgeFeatureFlags {
  /** Smart Form Engine — 智能表单结构提取与框架识别 */
  enableFormEngine: boolean;
  /** 批量智能填表 — 自动处理不同 UI 框架的组件差异 */
  enableSmartFill: boolean;
  /** 工具合并 — 推荐入口与 deprecation warning */
  enableToolConsolidation: boolean;
  /** 结构化错误码 — BridgeErrorPayload 替代字符串匹配 */
  enableStructuredErrors: boolean;
  /** 元素缓存 — 请求级 getActionableElements 缓存 */
  enableElementCache: boolean;
  /** 表单缓存 — 表单结构短 TTL 缓存 */
  enableFormCache: boolean;
  /** WebSocket 心跳 — 应用层心跳检测死连接 */
  enableWebSocketHeartbeat: boolean;
}

export const DEFAULT_FEATURE_FLAGS: BrowserBridgeFeatureFlags = {
  enableFormEngine: false,
  enableSmartFill: false,
  enableToolConsolidation: false,
  enableStructuredErrors: false,
  enableElementCache: false,
  enableFormCache: false,
  enableWebSocketHeartbeat: false,
};

/** 环境变量前缀 */
const ENV_PREFIX = "BB_ENABLE_";

/** Flag 名称到环境变量名的映射 */
const FLAG_ENV_MAP: Record<keyof BrowserBridgeFeatureFlags, string> = {
  enableFormEngine: `${ENV_PREFIX}FORM_ENGINE`,
  enableSmartFill: `${ENV_PREFIX}SMART_FILL`,
  enableToolConsolidation: `${ENV_PREFIX}TOOL_CONSOLIDATION`,
  enableStructuredErrors: `${ENV_PREFIX}STRUCTURED_ERRORS`,
  enableElementCache: `${ENV_PREFIX}ELEMENT_CACHE`,
  enableFormCache: `${ENV_PREFIX}FORM_CACHE`,
  enableWebSocketHeartbeat: `${ENV_PREFIX}WEBSOCKET_HEARTBEAT`,
};

/**
 * 从环境变量解析 Feature Flags（MCP Server 端使用）
 *
 * 环境变量格式：BB_ENABLE_FORM_ENGINE=true / false / 1 / 0
 */
export function resolveFeatureFlagsFromEnv(
  env: Record<string, string | undefined> = {}
): BrowserBridgeFeatureFlags {
  const flags = { ...DEFAULT_FEATURE_FLAGS };

  for (const [flagKey, envKey] of Object.entries(FLAG_ENV_MAP)) {
    const value = env[envKey];
    if (value !== undefined) {
      const normalized = value.toLowerCase().trim();
      (flags as Record<string, boolean>)[flagKey] =
        normalized === "true" || normalized === "1";
    }
  }

  return flags;
}

/**
 * 合并多个 Feature Flag 来源（优先级：运行时 > 环境变量 > 默认值）
 */
export function mergeFeatureFlags(
  ...sources: Partial<BrowserBridgeFeatureFlags>[]
): BrowserBridgeFeatureFlags {
  const merged = { ...DEFAULT_FEATURE_FLAGS };
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) {
        (merged as Record<string, boolean>)[key] = value;
      }
    }
  }
  return merged;
}

/**
 * 将 Feature Flags 序列化为可传输的 Record（用于 WebSocket 握手下发）
 */
export function serializeFeatureFlags(
  flags: BrowserBridgeFeatureFlags
): Record<string, boolean> {
  return { ...flags };
}

/**
 * 从 Record 反序列化 Feature Flags（Extension 端接收握手配置时使用）
 */
export function deserializeFeatureFlags(
  data: Record<string, unknown>
): BrowserBridgeFeatureFlags {
  const flags = { ...DEFAULT_FEATURE_FLAGS };
  for (const key of Object.keys(DEFAULT_FEATURE_FLAGS) as Array<keyof BrowserBridgeFeatureFlags>) {
    if (typeof data[key] === "boolean") {
      flags[key] = data[key] as boolean;
    }
  }
  return flags;
}
