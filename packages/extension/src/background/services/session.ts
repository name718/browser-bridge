import {
  type BridgeRequest
} from '@majuntao-1/browser-bridge-shared';
import { assertUrlAllowed } from '../security.js';
import { appendAuditLog } from '../audit.js';
import { getActiveTab } from './tabs.js';

export async function exportSession(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = (typeof request.params === 'object' && request.params !== null) ? request.params : {};
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');

  const tab = await chrome.tabs.get(tabId);
  const url = new URL(tab.url || '');
  const domain = typeof params.domain === 'string' ? params.domain : url.hostname;

  const cookies = await chrome.cookies.getAll({ domain });

  const [{ result: localStorage }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ ...window.localStorage })
  });

  const sessionData = JSON.stringify({
    domain,
    cookies,
    localStorage,
    exportedAt: new Date().toISOString()
  });

  await appendAuditLog({ tool: 'browser_export_session', url: tab.url, ok: true });

  return {
    domain,
    sessionData: btoa(unescape(encodeURIComponent(sessionData)))
  };
}

export async function importSession(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = (typeof request.params === 'object' && request.params !== null) ? request.params : {};
  const sessionDataRaw = typeof params.sessionData === 'string' ? params.sessionData : '';
  if (!sessionDataRaw) throw new Error('INVALID_PARAMS: sessionData 参数必填');

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');

  const tab = await chrome.tabs.get(tabId);
  const sessionData = JSON.parse(decodeURIComponent(escape(atob(sessionDataRaw))));

  if (Array.isArray(sessionData.cookies)) {
    for (const cookie of sessionData.cookies) {
      const { hostOnly, session, ...cookieDetails } = cookie;
      const protocol = cookie.secure ? 'https:' : 'http:';
      const cookieUrl = protocol + '//' + (cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain) + cookie.path;
      await chrome.cookies.set({
        ...cookieDetails,
        url: cookieUrl
      });
    }
  }

  if (sessionData.localStorage && typeof sessionData.localStorage === 'object') {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (data) => {
        Object.entries(data).forEach(([key, value]) => {
          window.localStorage.setItem(key, String(value));
        });
      },
      args: [sessionData.localStorage]
    });
  }

  await appendAuditLog({ tool: 'browser_import_session', url: tab.url, ok: true });

  return { ok: true, domain: sessionData.domain };
}
