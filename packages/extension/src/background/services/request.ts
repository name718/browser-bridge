import {
  type BridgeRequest
} from '@majuntao-1/browser-bridge-shared';
import { appendAuditLog } from '../audit.js';
import { getSecurityConfig, getSessionTrustAgentFully, assertUrlAllowed } from '../security.js';
import { confirmInPage } from './content-script.js';
import { resolveSafeTargetTab } from './tabs.js';

type RequestHeaders = Record<string, string>;

const DEFAULT_MAX_BODY_BYTES = 1_000_000;
const MAX_ALLOWED_BODY_BYTES = 5_000_000;
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-csrf-token',
  'x-xsrf-token'
]);

export async function requestFromPage(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = normalizeParams(request.params);
  const { tabId, tab } = await resolveSafeTargetTab(request, { waitForUrl: true });
  const pageUrl = tab.url;
  if (!pageUrl) throw new Error('TAB_NOT_FOUND: 标签页 URL 不可用');

  const resolvedUrl = resolveRequestUrl(params.url, pageUrl);
  await assertUrlAllowed(resolvedUrl);

  const pageOrigin = new URL(pageUrl).origin;
  const requestOrigin = new URL(resolvedUrl).origin;
  if (!params.allowCrossOrigin && requestOrigin !== pageOrigin) {
    throw new Error('PERMISSION_DENIED: browser_request 默认只允许当前页面同源请求；如确需跨域，请显式传 allowCrossOrigin=true');
  }

  await confirmMutatingRequest(tabId, params.method, resolvedUrl);

  const startedAt = Date.now();
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: executePageRequest,
      args: [{
        url: resolvedUrl,
        method: params.method,
        headers: params.headers,
        body: params.body,
        credentials: params.credentials,
        maxBodyBytes: params.maxBodyBytes,
        responseType: params.responseType
      }]
    });

    const result = results[0]?.result;
    if (!result || typeof result !== 'object') {
      throw new Error('INTERNAL_ERROR: 页面请求没有返回结果');
    }
    if ('error' in result && result.error) {
      throw new Error(String(result.error));
    }

    await appendAuditLog({ tool: request.tool, url: resolvedUrl, ok: true });
    return {
      ...result,
      tabId,
      pageUrl,
      requestedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      request: {
        url: resolvedUrl,
        method: params.method,
        credentials: params.credentials,
        headers: redactHeaders(params.headers)
      }
    };
  } catch (error) {
    await appendAuditLog({
      tool: request.tool,
      url: resolvedUrl,
      ok: false,
      errorCode: error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_ERROR'
    });
    throw error;
  }
}

function normalizeParams(params: BridgeRequest['params']): {
  url: string;
  method: string;
  headers: RequestHeaders;
  body: unknown;
  credentials: RequestCredentials;
  allowCrossOrigin: boolean;
  maxBodyBytes: number;
  responseType: 'auto' | 'json' | 'text';
} {
  const input = (typeof params === 'object' && params !== null) ? params : {};
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!url) throw new Error('INVALID_PARAMS: url 参数必填');

  const method = typeof input.method === 'string' && input.method.trim()
    ? input.method.trim().toUpperCase()
    : 'GET';
  if (!/^[A-Z]+$/.test(method)) {
    throw new Error('INVALID_PARAMS: method 只能包含英文字母');
  }

  const headers = normalizeHeaders(input.headers);
  const body = input.body;
  if ((method === 'GET' || method === 'HEAD') && body !== undefined && body !== null) {
    throw new Error('INVALID_PARAMS: GET/HEAD 请求不能携带 body');
  }

  const credentials = input.credentials === 'omit' || input.credentials === 'same-origin'
    ? input.credentials
    : 'include';
  const responseType = input.responseType === 'json' || input.responseType === 'text'
    ? input.responseType
    : 'auto';

  const requestedMaxBodyBytes = typeof input.maxBodyBytes === 'number'
    ? Math.floor(input.maxBodyBytes)
    : DEFAULT_MAX_BODY_BYTES;
  const maxBodyBytes = Math.min(Math.max(requestedMaxBodyBytes, 1), MAX_ALLOWED_BODY_BYTES);

  return {
    url,
    method,
    headers,
    body,
    credentials,
    allowCrossOrigin: input.allowCrossOrigin === true,
    maxBodyBytes,
    responseType
  };
}

function normalizeHeaders(value: unknown): RequestHeaders {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const headers: RequestHeaders = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === 'string') {
      headers[key] = val;
    }
  }
  return headers;
}

function resolveRequestUrl(url: string, pageUrl: string): string {
  try {
    return new URL(url, pageUrl).toString();
  } catch {
    throw new Error('INVALID_PARAMS: url 不是有效地址');
  }
}

async function confirmMutatingRequest(tabId: number, method: string, url: string): Promise<void> {
  if (method === 'GET' || method === 'HEAD' || getSessionTrustAgentFully()) {
    return;
  }
  const config = await getSecurityConfig();
  if (!config.blockHighRiskActions) {
    return;
  }
  const confirmed = await confirmInPage(tabId, `Agent 试图通过浏览器登录态发送 ${method} 请求。\n\n${url}`);
  if (!confirmed) {
    throw new Error('USER_REJECTED: 用户已取消浏览器请求');
  }
}

function redactHeaders(headers: RequestHeaders): RequestHeaders {
  const redacted: RequestHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return redacted;
}

async function executePageRequest(options: {
  url: string;
  method: string;
  headers: RequestHeaders;
  body: unknown;
  credentials: RequestCredentials;
  maxBodyBytes: number;
  responseType: 'auto' | 'json' | 'text';
}): Promise<Record<string, unknown>> {
  try {
    const headers = new Headers(options.headers);
    let body: BodyInit | undefined;
    if (options.body !== undefined && options.body !== null) {
      if (typeof options.body === 'string') {
        body = options.body;
      } else {
        body = JSON.stringify(options.body);
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json');
        }
      }
    }

    const startedAt = performance.now();
    const response = await fetch(options.url, {
      method: options.method,
      headers,
      body,
      credentials: options.credentials
    });
    const arrayBuffer = await response.arrayBuffer();
    const bytes = arrayBuffer.byteLength;
    const truncated = bytes > options.maxBodyBytes;
    const slice = truncated ? arrayBuffer.slice(0, options.maxBodyBytes) : arrayBuffer;
    const text = new TextDecoder().decode(slice);
    const responseHeaders: RequestHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const contentType = response.headers.get('content-type') ?? '';
    const shouldParseJson = options.responseType === 'json' ||
      (options.responseType === 'auto' && contentType.includes('application/json'));
    let data: unknown;
    let parseError: string | undefined;
    if (shouldParseJson && text) {
      try {
        data = JSON.parse(text);
      } catch (error: any) {
        parseError = error?.message ?? String(error);
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      redirected: response.redirected,
      headers: responseHeaders,
      body: data,
      bodyText: data === undefined ? text : undefined,
      bodyBytes: bytes,
      truncated,
      parseError,
      elapsedMs: Math.round(performance.now() - startedAt)
    };
  } catch (error: any) {
    return {
      error: 'INTERNAL_ERROR: ' + (error?.message ?? String(error))
    };
  }
}
