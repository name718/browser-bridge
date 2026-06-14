import { type BrowserTab } from '@majuntao-1/browser-bridge-shared';
import { assertUrlAllowed } from '../security.js';

export async function getActiveTab(): Promise<BrowserTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('TAB_NOT_ACTIVE: 未找到活动标签页');
  }
  return normalizeTab(tab);
}

export async function listTabs(): Promise<BrowserTab[]> {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => tab.id).map((tab) => normalizeTab(tab));
}

export async function openUrl(
  url: string,
  options: { waitUntil?: 'commit' | 'ready'; timeoutMs?: number } = {}
): Promise<BrowserTab> {
  if (!url) {
    throw new Error('INVALID_PARAMS: url 参数必填');
  }
  await assertUrlAllowed(url);
  const tab = await chrome.tabs.create({ url, active: true });
  if (options.waitUntil === 'commit') {
    void waitForTabUrl(tab.id, url, { timeoutMs: options.timeoutMs ?? 3000 }).catch(() => undefined);
    return normalizeTab(tab, url);
  }
  return normalizeTab(await waitForTabUrl(tab.id, url, { timeoutMs: options.timeoutMs }));
}

export async function openIncognito(url: string): Promise<BrowserTab> {
  if (!url) {
    throw new Error('INVALID_PARAMS: url 参数必填');
  }

  const isAllowed = await chrome.extension.isAllowedIncognitoAccess();
  if (!isAllowed) {
    throw new Error('PERMISSION_DENIED: 插件未被允许访问隐身模式');
  }

  await assertUrlAllowed(url);
  const window = await chrome.windows.create({ url, incognito: true });
  const tab = window.tabs?.[0];
  if (!tab || tab.id === undefined) {
    throw new Error('INTERNAL_ERROR: 无法创建隐身标签页');
  }
  return normalizeTab(await waitForTabUrl(tab.id, url));
}

export async function activateTab(tabId: number): Promise<BrowserTab> {
  if (!Number.isFinite(tabId)) {
    throw new Error('INVALID_PARAMS: tabId 参数必填');
  }
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (!tab) {
    throw new Error('TAB_NOT_FOUND: 未找到标签页');
  }
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return normalizeTab(tab);
}

export async function closeTab(tabId: number): Promise<void> {
  await chrome.tabs.remove(tabId);
}

export function normalizeTab(tab: chrome.tabs.Tab, fallbackUrl?: string): BrowserTab {
  if (!tab.id) {
    throw new Error('TAB_NOT_FOUND: 标签页没有 ID');
  }
  return {
    id: tab.id,
    windowId: tab.windowId,
    active: Boolean(tab.active),
    title: tab.title,
    url: tab.url ?? tab.pendingUrl ?? fallbackUrl
  };
}

export async function waitForTabUrl(
  tabId: number | undefined,
  expectedUrl: string,
  options: { timeoutMs?: number } = {}
): Promise<chrome.tabs.Tab> {
  if (!tabId) {
    throw new Error('TAB_NOT_FOUND: 标签页没有 ID');
  }

  const timeoutMs = options.timeoutMs ?? 10000;
  const deadline = Date.now() + timeoutMs;
  const expected = new URL(expectedUrl);

  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) {
      try {
        const current = new URL(tab.url);
        if (current.origin === expected.origin || tab.status === 'complete') {
          return tab;
        }
      } catch {
        if (tab.status === 'complete') {
          return tab;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    throw new Error('ACTION_TIMEOUT: 标签页 URL 不可用');
  }
  return tab;
}

export async function getTabWhenUrlReady(tabId: number, timeoutMs = 5000): Promise<chrome.tabs.Tab> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) {
      return tab;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const tab = await chrome.tabs.get(tabId);
  if (tab.url) {
    return tab;
  }
  throw new Error('ACTION_TIMEOUT: 标签页 URL 不可用');
}
