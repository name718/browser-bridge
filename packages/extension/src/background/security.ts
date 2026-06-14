import { type BridgeRequest } from "@majuntao-1/browser-bridge-shared";

export type SecurityConfig = {
  allowlist: string[];
  denylist: string[];
  blockHighRiskActions: boolean;
  screenshotEnabled: boolean;
  pdfEnabled: boolean;
};

export type RiskCheck = {
  risky: boolean;
  reason?: string;
};

const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  allowlist: ["http://*", "https://*"],
  denylist: [],
  blockHighRiskActions: true,
  screenshotEnabled: true,
  pdfEnabled: true
};

let sessionTrustAgentFully = false;

export function setSessionTrustAgentFully(trusted: boolean): void {
  sessionTrustAgentFully = trusted;
}

export function getSessionTrustAgentFully(): boolean {
  return sessionTrustAgentFully;
}

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
    "screenshotEnabled",
    "pdfEnabled"
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
        : DEFAULT_SECURITY_CONFIG.screenshotEnabled,
    pdfEnabled:
      typeof stored.pdfEnabled === "boolean"
        ? stored.pdfEnabled
        : DEFAULT_SECURITY_CONFIG.pdfEnabled
  };
}

// URL 校验缓存：同一 URL 不重复读 chrome.storage.local
const urlAllowedCache = new Map<string, boolean>();
let lastCacheTime = 0;
const CACHE_TTL_MS = 30_000; // 30 秒过期，避免配置变更后长期不生效

export function invalidateUrlCache(): void {
  urlAllowedCache.clear();
}

export async function assertUrlAllowed(url: string | undefined): Promise<void> {
  if (!url) {
    throw new Error("TAB_NOT_FOUND: 标签页 URL 不可用");
  }

  const parsed = parseUrl(url);
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("UNSUPPORTED_PAGE: 仅支持 http 和 https 页面");
  }

  // 缓存命中检查
  const now = Date.now();
  if (now - lastCacheTime < CACHE_TTL_MS && urlAllowedCache.has(url)) {
    if (!urlAllowedCache.get(url)) {
      throw new Error("DOMAIN_NOT_ALLOWED: 当前 URL 被浏览器桥接安全配置拒绝");
    }
    return;
  }

  const config = await getSecurityConfig();
  const denied = matchesAny(url, config.denylist);
  const allowed = !denied && matchesAny(url, config.allowlist);

  // 更新缓存
  urlAllowedCache.set(url, allowed);
  lastCacheTime = now;

  if (denied) {
    throw new Error("DOMAIN_NOT_ALLOWED: 当前 URL 被浏览器桥接安全配置拒绝");
  }

  if (!allowed) {
    throw new Error("DOMAIN_NOT_ALLOWED: 当前 URL 不在浏览器桥接允许列表中");
  }
}

export async function assertActionAllowed(request: BridgeRequest): Promise<void> {
  const config = await getSecurityConfig();

  if (request.tool === "browser_screenshot" && !config.screenshotEnabled) {
    throw new Error("PERMISSION_DENIED: 浏览器桥接安全配置已禁用截图");
  }

  if (request.tool === "browser_pdf" && !config.pdfEnabled) {
    throw new Error("PERMISSION_DENIED: 浏览器桥接安全配置已禁用 PDF 导出");
  }

  if (sessionTrustAgentFully || !config.blockHighRiskActions || !isClickTool(request.tool)) {
    return;
  }

  const risk = getRequestRisk(request);
  if (risk.risky) {
    throw new Error(`USER_CONFIRMATION_REQUIRED: ${risk.reason ?? "高风险浏览器操作需要确认"}`);
  }
}

export async function getActionRisk(request: BridgeRequest): Promise<RiskCheck> {
  const config = await getSecurityConfig();
  if (sessionTrustAgentFully || !config.blockHighRiskActions || !isClickTool(request.tool)) {
    return { risky: false };
  }
  return getRequestRisk(request);
}

function getRequestRisk(request: BridgeRequest): RiskCheck {
  const text = [
    request.params?.text,
    request.params?.query,
    request.params?.selector,
    request.params?.elementId
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  if (HIGH_RISK_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
    return { risky: true, reason: "点击目标看起来是删除、支付、提交、发送、发布或审批等高风险操作" };
  }
  return { risky: false };
}

function isClickTool(tool: BridgeRequest["tool"]): boolean {
  return tool === "browser_click" || tool === "browser_find_and_click";
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
