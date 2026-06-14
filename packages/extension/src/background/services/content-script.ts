import {
  type BridgeRequest
} from '@majuntao-1/browser-bridge-shared';
import { assertActionAllowed, getActionRisk, getSessionTrustAgentFully } from '../security.js';
import { appendAuditLog } from '../audit.js';
import { resolveTargetTab } from './tabs.js';

export async function sendToContentScript(request: BridgeRequest): Promise<unknown> {
  const { tabId, tab } = await resolveTargetTab(request, { waitForUrl: true, timeoutMs: 10000 });
  
  const confirmedHighRisk = await confirmHighRiskAction(tabId, request);
  const bypassContentRiskPrompt = confirmedHighRisk || getSessionTrustAgentFully();

  const isSearchOrAct = [
    'browser_click', 'browser_type', 'browser_hover', 'browser_find',
    'browser_act', 'browser_find_and_click', 'browser_find_and_type', 'browser_select_option', 'browser_clear'
  ].includes(request.tool);

  const buildMessage = () => ({
    type: 'browser_bridge_request',
    request: {
      ...request,
      tabId,
      params: {
        ...(typeof request.params === 'object' && request.params !== null ? request.params : {}),
        __confirmedHighRisk: bypassContentRiskPrompt
      }
    }
  });

  const sendToFrame = async (frameId?: number): Promise<{ response: any; frameId?: number } | null> => {
    try {
      const msg = buildMessage();
      const response = frameId !== undefined
        ? await chrome.tabs.sendMessage(tabId, msg, { frameId })
        : await chrome.tabs.sendMessage(tabId, msg);
      if (response?.ok) return { response, frameId };
    } catch { /* ignore */ }
    return null;
  };

  try {
    if (isSearchOrAct && chrome.webNavigation?.getAllFrames) {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      if (frames && frames.length > 1) {
        const framePromises = frames.map(frame => sendToFrame(frame.frameId));
        const results = await Promise.allSettled(framePromises);

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value?.response) {
            const { response } = result.value;
            await appendAuditLog({ tool: request.tool, url: tab.url, ok: true });
            return response.data;
          }
        }

        await ensureContentScript(tabId);
        const retryResult = await sendToFrame(0);
        if (retryResult?.response) {
          await appendAuditLog({ tool: request.tool, url: tab.url, ok: true });
          return retryResult.response.data;
        }

        throw new Error('ELEMENT_NOT_FOUND: 在所有 Frame 中均未找到目标元素');
      }
    }

    let result = await sendToFrame(0);
    if (!result) {
      await ensureContentScript(tabId);
      result = await sendToFrame(0);
    }

    if (!result?.response) {
      throw new Error('CONTENT_SCRIPT_NOT_READY: 页面脚本请求失败');
    }

    const { response } = result;

    if (!response.ok) {
      const error = new Error((response?.error?.code ?? 'INTERNAL_ERROR') + ': ' + (response?.error?.message ?? '页面脚本请求失败'));
      (error as any).details = response?.error?.diagnostics;
      throw error;
    }

    await appendAuditLog({ tool: request.tool, url: tab.url, ok: true });
    return response.data;
  } catch (error) {
    if (error instanceof Error && !error.message.includes(': 页面脚本请求失败')) {
      await appendAuditLog({
        tool: request.tool,
        url: tab.url,
        ok: false,
        errorCode: error.message.split(':', 1)[0]
      });
    }
    throw error;
  }
}

export async function confirmHighRiskAction(tabId: number, request: BridgeRequest): Promise<boolean> {
  try {
    await assertActionAllowed(request);
    return false;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('USER_CONFIRMATION_REQUIRED:')) {
      throw error;
    }
  }

  const risk = await getActionRisk(request);
  const confirmed = await confirmInPage(tabId, risk.reason ?? '高风险浏览器操作需要确认');
  if (!confirmed) {
    throw new Error('USER_REJECTED: 用户已取消高风险浏览器操作');
  }
  return true;
}

export async function confirmInPage(tabId: number, reason: string): Promise<boolean> {
  await ensureContentScript(tabId);
  const response = await chrome.tabs.sendMessage(tabId, {
    type: 'browser_bridge_confirm',
    reason
  });
  return Boolean(response?.confirmed);
}

export async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'browser_bridge_ping' });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js']
    });
  }
}
