import { type BridgeRequest } from "@browser-bridge/shared";

export type SecurityConfig = {
  allowlist: string[];
  denylist: string[];
  blockHighRiskActions: boolean;
  screenshotEnabled: boolean;
};

const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  allowlist: ["http://*", "https://*"],
  denylist: [],
  blockHighRiskActions: true,
  screenshotEnabled: true
};

const HIGH_RISK_TEXT_PATTERNS = [
  /delete/i,
  /remove/i,
  /destroy/i,
  /drop/i,
  /pay/i,
  /purchase/i,
  /submit/i,
  /send/i,
  /publish/i,
  /approve/i,
  /reject/i,
  /删除/,
  /移除/,
  /支付/,
  /购买/,
  /提交/,
  /发送/,
  /发布/,
  /审批/,
  /通过/,
  /拒绝/
];

export async function getSecurityConfig(): Promise<SecurityConfig> {
  const stored = await chrome.storage.local.get([
    "allowlist",
    "denylist",
    "blockHighRiskActions",
    "screenshotEnabled"
  ]);

  return {
    allowlist: stringArray(stored.allowlist) ?? DEFAULT_SECURITY_CONFIG.allowlist,
    denylist: stringArray(stored.denylist) ?? DEFAULT_SECURITY_CONFIG.denylist,
    blockHighRiskActions:
      typeof stored.blockHighRiskActions === "boolean"
        ? stored.blockHighRiskActions
        : DEFAULT_SECURITY_CONFIG.blockHighRiskActions,
    screenshotEnabled:
      typeof stored.screenshotEnabled === "boolean"
        ? stored.screenshotEnabled
        : DEFAULT_SECURITY_CONFIG.screenshotEnabled
  };
}

export async function assertUrlAllowed(url: string | undefined): Promise<void> {
  if (!url) {
    throw new Error("TAB_NOT_FOUND: 标签页 URL 不可用");
  }

  const parsed = parseUrl(url);
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("UNSUPPORTED_PAGE: 仅支持 http 和 https 页面");
  }

  const config = await getSecurityConfig();
  if (matchesAny(url, config.denylist)) {
    throw new Error("DOMAIN_NOT_ALLOWED: 当前 URL 被浏览器桥接安全配置拒绝");
  }

  if (!matchesAny(url, config.allowlist)) {
    throw new Error("DOMAIN_NOT_ALLOWED: 当前 URL 不在浏览器桥接允许列表中");
  }
}

export async function assertActionAllowed(request: BridgeRequest): Promise<void> {
  const config = await getSecurityConfig();

  if (request.tool === "browser_screenshot" && !config.screenshotEnabled) {
    throw new Error("PERMISSION_DENIED: 浏览器桥接安全配置已禁用截图");
  }

  if (!config.blockHighRiskActions || request.tool !== "browser_click") {
    return;
  }

  const text = [
    request.params?.text,
    request.params?.selector,
    request.params?.elementId
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  if (HIGH_RISK_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new Error("USER_CONFIRMATION_REQUIRED: 高风险浏览器操作已被拦截");
  }
}

function matchesAny(url: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchPattern(url, pattern));
}

function matchPattern(url: string, pattern: string): boolean {
  if (pattern === "*") {
    return true;
  }

  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(url);
}

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings : undefined;
}
