import {
  type BridgeRequest
} from '@majuntao-1/browser-bridge-shared';
import { assertUrlAllowed } from '../security.js';
import { appendAuditLog } from '../audit.js';
import { getActiveTab, getViewportInfo } from './tabs.js';
import { sendToContentScript, ensureContentScript } from './content-script.js';
import * as DebuggerService from './debugger.js';

export async function smartAct(request: BridgeRequest): Promise<unknown> {
  const params = (typeof request.params === 'object' && request.params !== null) ? request.params : {};
  const query = typeof params.query === 'string' ? params.query : (typeof params.text === 'string' ? params.text : undefined);
  const hasSelectorHints = params.selector || params.elementId || params.role || params.ariaLabel;
  const isVisualOnlyQuery = params.forceVisual === true;

  if (hasSelectorHints) {
    return sendToContentScript({ ...request, tool: 'browser_act' });
  }

  if (isVisualOnlyQuery && query) {
    return runVisualMode({
      ...request,
      tool: 'browser_visual_click_text',
      params: { ...params, text: query, exact: params.exact === true }
    });
  }

  try {
    return await sendToContentScript({ ...request, tool: 'browser_act' });
  } catch (error: any) {
    if (error?.message?.includes('ELEMENT_NOT_FOUND') && query) {
      try {
        return await runVisualMode({
          ...request,
          tool: 'browser_visual_click_text',
          params: { ...params, text: query, exact: params.exact === true }
        });
      } catch (visualError: any) {
        throw error;
      }
    }
    throw error;
  }
}

export async function selectOptionWithFallback(request: BridgeRequest): Promise<unknown> {
  try {
    return await sendToContentScript(request);
  } catch (error) {
    if (!shouldFallbackToVisualSelect(error)) {
      throw error;
    }
  }

  const params = (typeof request.params === 'object' && request.params !== null) ? request.params : {};
  return runVisualMode({
    ...request,
    tool: 'browser_visual_select',
    params: {
      ...params,
      exact: params.exact !== false
    }
  });
}

function shouldFallbackToVisualSelect(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /^(ELEMENT_NOT_FOUND|ACTION_TIMEOUT|CONTENT_SCRIPT_NOT_READY):/.test(error.message);
}

export async function runVisualMode(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = (typeof request.params === 'object' && request.params !== null) ? request.params : {};
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);
  await ensureContentScript(tabId);

  const contentResponse = await chrome.tabs.sendMessage(tabId, {
    type: 'browser_bridge_request',
    request: { ...request, tabId, params }
  }, { frameId: 0 });

  if (!contentResponse?.ok) {
    throw new Error((contentResponse?.error?.code ?? 'INTERNAL_ERROR') + ': ' + (contentResponse?.error?.message ?? '视觉任务失败'));
  }

  const plan = contentResponse.data;
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const executed: unknown[] = [];
  
  return DebuggerService.withDebugger(tabId, async () => {
    for (const action of actions) {
      if (action.tool === 'browser_screen_click') {
        if (action.x === '__resolve_after_open__' || action.y === '__resolve_after_open__') {
          const resolved = await resolveVisualTextTarget(tabId, {
            text: typeof action.option === 'string' ? action.option : String(action.text ?? ''),
            exact: action.exact !== false,
            timeoutMs: typeof action.timeoutMs === 'number' ? action.timeoutMs : 5000
          });
          action.x = resolved.x;
          action.y = resolved.y;
          action.resolved = resolved;
        }
        await DebuggerService.dispatchScreenClick(tabId, {
          x: action.x,
          y: action.y,
          delayMs: action.delayMs
        });
        executed.push(action);
        if (typeof action.afterDelayMs === 'number' && action.afterDelayMs > 0) {
          await new Promise(r => setTimeout(r, action.afterDelayMs));
        }
        continue;
      }
      throw new Error('INVALID_PARAMS: 不支持的视觉动作 ' + action.tool);
    }

    await appendAuditLog({ tool: request.tool, url: tab.url, ok: true });
    return {
      ok: true, tabId, url: tab.url, title: tab.title,
      tool: request.tool, coordinateSystem: 'viewport-css-pixels',
      plan, executed
    };
  });
}

export async function resolveVisualTextTarget(
  tabId: number,
  options: { text: string; exact: boolean; timeoutMs: number }
): Promise<{ x: number; y: number; matched?: unknown }> {
  const deadline = Date.now() + options.timeoutMs;
  let lastError = '';
  while (Date.now() <= deadline) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'browser_bridge_request',
        request: {
          id: crypto.randomUUID(),
          tool: 'browser_visual_resolve_text',
          tabId,
          params: { text: options.text, exact: options.exact, prefer: 'bottom' }
        }
      }, { frameId: 0 });
      if (response?.ok && response.data?.matched) {
        const center = response.data.matched.center;
        if (center && typeof center.x === 'number' && typeof center.y === 'number') {
          return { x: center.x, y: center.y, matched: response.data.matched };
        }
      }
      lastError = response?.error?.message ?? '未找到目标';
    } catch (error: any) {
      lastError = error.message;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('ELEMENT_NOT_FOUND: 视觉模式未找到文本 「' + options.text + '」: ' + lastError);
}

import { captureScreenshot } from './screenshot.js';

export async function screenObserve(request: BridgeRequest, getActiveTab: () => Promise<any>): Promise<Record<string, unknown>> {
  const params = (typeof request.params === 'object' && request.params !== null) ? request.params : {};
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  const viewport = await DebuggerService.getViewportInfo(tabId);
  
  const result = await captureScreenshot(tab, {
    ...request,
    tool: 'browser_screenshot',
    params: {
      format: params.format,
      quality: params.quality,
      mode: typeof params.scale === 'number' || params.mode === 'cdp' ? 'cdp' : 'visible',
      scale: params.scale
    }
  });

  const withGrid = params.withGrid === true;
  const gridSize = typeof params.gridSize === 'number' && params.gridSize > 0 ? params.gridSize : 100;
  const dataUrl = withGrid && typeof result.dataUrl === 'string'
    ? await addGridOverlay(tabId, result.dataUrl, gridSize)
    : result.dataUrl;

  await appendAuditLog({ tool: 'browser_screen_observe', url: tab.url, ok: true });

  return {
    ...result,
    dataUrl,
    viewport,
    coordinateSystem: 'viewport-css-pixels',
    withGrid,
    gridSize: withGrid ? gridSize : undefined,
    targets: request.tool === 'browser_visual_observe' || params.includeTargets === true
      ? await getVisualTargets(tabId, params)
      : undefined
  };
}

async function getVisualTargets(tabId: number, params: Record<string, unknown>): Promise<unknown> {
  try {
    await ensureContentScript(tabId);
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'browser_bridge_request',
      request: {
        id: crypto.randomUUID(),
        tool: 'browser_visual_observe',
        tabId,
        params: { maxTargets: typeof params.maxTargets === 'number' ? params.maxTargets : 120 }
      }
    }, { frameId: 0 });
    return response?.ok ? response.data?.targets : undefined;
  } catch {
    return undefined;
  }
}

async function addGridOverlay(tabId: number, dataUrl: string, gridSize: number): Promise<string> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (source: string, size: number) => {
      const image = new Image();
      image.src = source;
      await image.decode();

      const ratio = image.width / window.innerWidth;
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) return source;

      context.drawImage(image, 0, 0);
      context.save();
      context.scale(ratio, ratio);
      context.strokeStyle = 'rgba(0, 128, 255, 0.65)';
      context.fillStyle = 'rgba(0, 96, 160, 0.92)';
      context.lineWidth = 1 / ratio;
      context.font = '12px sans-serif';

      for (let x = 0; x <= window.innerWidth; x += size) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, window.innerHeight);
        context.stroke();
        context.fillText(String(x), x + 3, 14);
      }

      for (let y = 0; y <= window.innerHeight; y += size) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(window.innerWidth, y);
        context.stroke();
        context.fillText(String(y), 3, y + 14);
      }

      context.restore();
      return canvas.toDataURL(source.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png');
    },
    args: [dataUrl, gridSize]
  });

  return typeof results[0]?.result === 'string' ? results[0].result : dataUrl;
}
