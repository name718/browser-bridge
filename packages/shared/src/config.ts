/**
 * 集中管理的超时配置
 *
 * 替代散布在代码库中的硬编码超时值。
 * MCP Server 端可通过 BB_TIMEOUT_* 环境变量覆盖。
 */

export const TIMEOUTS = {
  // 连接
  CONNECTION_WAIT: 15_000,
  MAX_RECONNECT_WAIT: 25_000,
  DAEMON_START_DEADLINE: 10_000,
  HEALTH_CHECK: 2_000,

  // 页面操作
  PAGE_LOAD_READY: 15_000,
  PAGE_LOAD_COMMIT: 5_000,
  ELEMENT_WAIT: 4_000,
  WAIT_FOR: 30_000,

  // 工具特定
  SELECT_OPTION: 60_000,
  VISUAL_TASK: 60_000,
  RUN_STEP_PER_STEP: 8_000,
  CONSOLE_MONITOR: 5_000,

  // MCP Server
  DEFAULT_TOOL_TIMEOUT: 10_000,
  DAEMON_HTTP_OVERHEAD: 5_000,
} as const;

export type TimeoutKey = keyof typeof TIMEOUTS;

/**
 * 获取超时值，支持环境变量覆盖
 *
 * 环境变量格式：BB_TIMEOUT_PAGE_LOAD_READY=20000
 */
export function getTimeout(
  key: TimeoutKey,
  env: Record<string, string | undefined> = {}
): number {
  const envKey = `BB_TIMEOUT_${key}`;
  const envVal = env[envKey];
  if (envVal !== undefined) {
    const parsed = parseInt(envVal, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return TIMEOUTS[key];
}
