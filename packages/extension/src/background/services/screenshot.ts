import { processImage } from "../utils/image.js";
import {
  type BridgeRequest
} from '@majuntao-1/browser-bridge-shared';
import { appendAuditLog } from '../audit.js';
import * as DebuggerService from './debugger.js';

export async function captureScreenshot(
  tab: chrome.tabs.Tab,
  request: BridgeRequest
): Promise<Record<string, unknown>> {
  if (!tab.id) throw new Error('TAB_NOT_FOUND: 标签页没有 ID');

  const params = (typeof request.params === 'object' && request.params !== null) ? request.params : {};
  const requestedFormat = params.format === 'jpeg' ? 'jpeg' : 'png';
  const quality = typeof params.quality === 'number' ? params.quality : undefined;
  const overlay = params.overlay === true;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'browser_bridge_hide_status' });
  } catch { /* ignore */ }

  if (overlay) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'browser_bridge_draw_overlay' });
      await new Promise(r => setTimeout(r, 100));
    } catch { /* ignore */ }
  }

  try {
    if (params.mode === 'cdp' || typeof params.scale === 'number') {
      return await DebuggerService.captureCdpScreenshot(tab.id, request);
    }

    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: requestedFormat,
      quality
    });

    await appendAuditLog({ tool: request.tool, url: tab.url, ok: true });

    return {
      tabId: tab.id, url: tab.url, title: tab.title,
      mimeType: requestedFormat === 'jpeg' ? 'image/jpeg' : 'image/png',
      dataUrl
    };
  } finally {
    if (overlay) {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'browser_bridge_remove_overlay' }); } catch { /* ignore */ }
    }
    try { await chrome.tabs.sendMessage(tab.id, { type: 'browser_bridge_show_status' }); } catch { /* ignore */ }
  }
}
