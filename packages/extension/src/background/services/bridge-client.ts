import { DEFAULT_BRIDGE_URL } from '../shared/config.js';
import { getSecurityConfig, getSessionTrustAgentFully } from '../security.js';
import { getAuditLog } from '../audit.js';

export let connected = false;
export let currentBridgeUrl = DEFAULT_BRIDGE_URL;
export let lastBridgeError = '';
let offscreenCreation: Promise<void> | undefined;

export async function getPopupStatus(isRecording: boolean, recordedCount: number): Promise<Record<string, unknown>> {
  currentBridgeUrl = await getBridgeUrl();
  await ensureOffscreenDocument();
  await syncBridgeUrlToOffscreen();
  const [security, audit, offscreenStatus] = await Promise.all([
    getSecurityConfig(),
    getAuditLog(8),
    getOffscreenStatus()
  ]);

  connected = Boolean(offscreenStatus.connected);
  currentBridgeUrl = offscreenStatus.bridgeUrl ?? currentBridgeUrl;
  lastBridgeError = offscreenStatus.lastError ?? lastBridgeError;
  return {
    connected,
    bridgeUrl: currentBridgeUrl,
    isRecording,
    recordedCount,
    lastError: lastBridgeError,
    readyState: offscreenStatus.readyState,
    trustAgentFully: getSessionTrustAgentFully(),
    security,
    audit
  };
}

export async function getOffscreenStatus(): Promise<{
  connected: boolean;
  bridgeUrl?: string;
  lastError?: string;
  readyState?: string;
}> {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'offscreen_get_status' });
    return {
      connected: Boolean(status?.connected),
      bridgeUrl: typeof status?.bridgeUrl === 'string' ? status.bridgeUrl : undefined,
      lastError: typeof status?.lastError === 'string' ? status.lastError : undefined,
      readyState: typeof status?.readyState === 'string' ? status.readyState : undefined
    };
  } catch (error) {
    recordBridgeError('读取 offscreen 状态失败');
    return { connected, bridgeUrl: currentBridgeUrl, lastError: lastBridgeError };
  }
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenCreation) return offscreenCreation;
  offscreenCreation = createOffscreenDocument();
  try { await offscreenCreation; } finally { offscreenCreation = undefined; }
}

async function createOffscreenDocument(): Promise<void> {
  const offscreen = chrome.offscreen;
  if (!offscreen) {
    recordBridgeError('当前 Chrome 不支持 offscreen API');
    return;
  }

  try {
    const hasDocument = await offscreen.hasDocument();
    if (hasDocument) return;

    await offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
      justification: '保持浏览器桥接 WebSocket 连接'
    });
    recordBridgeError('');
    await syncBridgeUrlToOffscreen();
  } catch (error) {
    recordBridgeError('创建 offscreen 连接页失败');
  }
}

export async function getBridgeUrl(): Promise<string> {
  const stored = await chrome.storage.local.get('bridgeUrl');
  return typeof stored.bridgeUrl === 'string' && stored.bridgeUrl.trim()
    ? stored.bridgeUrl.trim()
    : DEFAULT_BRIDGE_URL;
}

export async function setBridgeUrl(value: string): Promise<void> {
  const normalized = normalizeBridgeUrl(value);
  await chrome.storage.local.set({ bridgeUrl: normalized });
  currentBridgeUrl = normalized;
  await ensureOffscreenDocument();
  await syncBridgeUrlToOffscreen();
}

export async function syncBridgeUrlToOffscreen(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'offscreen_set_bridge_url',
      bridgeUrl: currentBridgeUrl
    });
  } catch (error) {
    recordBridgeError('通知 offscreen 重连失败');
  }
}

function normalizeBridgeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_BRIDGE_URL;
  if (!/^wss?:\/\//.test(trimmed)) return 'ws://' + trimmed;
  return trimmed;
}

export function recordBridgeError(message: string): void {
  lastBridgeError = message;
  void chrome.storage.local.set({ bridgeLastError: message });
  if (message) console.warn('[浏览器桥接] ' + message);
}

export function updateStatusFromOffscreen(message: any) {
  connected = Boolean(message.connected);
  currentBridgeUrl = typeof message.bridgeUrl === 'string' ? message.bridgeUrl : currentBridgeUrl;
  lastBridgeError = typeof message.lastError === 'string' ? message.lastError : '';
}
