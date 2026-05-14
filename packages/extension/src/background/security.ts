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
    throw new Error("TAB_NOT_FOUND: Tab URL is unavailable");
  }

  const parsed = parseUrl(url);
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("UNSUPPORTED_PAGE: Only http and https pages are supported");
  }

  const config = await getSecurityConfig();
  if (matchesAny(url, config.denylist)) {
    throw new Error("DOMAIN_NOT_ALLOWED: URL is denied by Browser Bridge security config");
  }

  if (!matchesAny(url, config.allowlist)) {
    throw new Error("DOMAIN_NOT_ALLOWED: URL is not allowed by Browser Bridge security config");
  }
}

export async function assertActionAllowed(request: BridgeRequest): Promise<void> {
  const config = await getSecurityConfig();

  if (request.tool === "browser_screenshot" && !config.screenshotEnabled) {
    throw new Error("PERMISSION_DENIED: Screenshots are disabled by Browser Bridge security config");
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
    throw new Error("USER_CONFIRMATION_REQUIRED: High-risk browser action was blocked");
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

