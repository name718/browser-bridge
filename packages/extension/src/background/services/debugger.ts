import {
  type BridgeRequest,
  type BrowserTab
} from '@majuntao-1/browser-bridge-shared';
import { assertUrlAllowed } from '../security.js';
import { appendAuditLog } from '../audit.js';

/**
 * 通用 Debugger 任务包装器
 */


// Debugger Connection Pool
const attachedTabs = new Map<number, {
  lastUsed: number;
  timer: any;
}>();

const IDLE_TIMEOUT_MS = 30000; // 30 seconds idle timeout

const attachingTabs = new Map<number, Promise<void>>();

async function attachDebugger(tabId: number): Promise<void> {
  const existing = attachedTabs.get(tabId);
  if (existing) {
    existing.lastUsed = Date.now();
    if (existing.timer) clearTimeout(existing.timer);
    existing.timer = setTimeout(() => detachDebugger(tabId), IDLE_TIMEOUT_MS);
    return;
  }

  const inProgress = attachingTabs.get(tabId);
  if (inProgress) return inProgress;

  const promise = (async () => {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      attachedTabs.set(tabId, {
        lastUsed: Date.now(),
        timer: setTimeout(() => detachDebugger(tabId), IDLE_TIMEOUT_MS)
      });
    } catch (error: any) {
      if (error?.message?.includes('already attached') || error?.message?.includes('Another debugger')) {
        return;
      }
      throw error;
    } finally {
      attachingTabs.delete(tabId);
    }
  })();

  attachingTabs.set(tabId, promise);
  return promise;
}

async function detachDebugger(tabId: number): Promise<void> {
  const existing = attachedTabs.get(tabId);
  if (existing) {
    if (existing.timer) clearTimeout(existing.timer);
    attachedTabs.delete(tabId);
  }
  try {
    await chrome.debugger.detach({ tabId });
  } catch { /* ignore */ }
}

export async function withDebugger<T>(tabId: number, task: (debuggee: chrome.debugger.Debuggee) => Promise<T>): Promise<T> {
  await attachDebugger(tabId);
  try {
    return await task({ tabId });
  } finally {
    // Keep attached for pool, so don't detach here
    const existing = attachedTabs.get(tabId);
    if (existing) {
      existing.lastUsed = Date.now();
      if (existing.timer) clearTimeout(existing.timer);
      existing.timer = setTimeout(() => detachDebugger(tabId), IDLE_TIMEOUT_MS);
    }
  }
}


/**
 * 发送 CDP 命令的 Promise 封装
 */
export function sendDebuggerCommand(
  tabId: number,
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error('INTERNAL_ERROR: ' + chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function stringToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(binary);
}

export async function executeCdp(request: BridgeRequest, getActiveTab: () => Promise<BrowserTab>): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const method = typeof params.method === 'string' ? params.method : '';
  if (!method.includes('.')) {
    throw new Error('INVALID_PARAMS: method 必须是 Domain.method 格式');
  }

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) {
    throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');
  }

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  if (!tab.url || /^(chrome|chrome-extension|about|edge|brave):/.test(tab.url)) {
    throw new Error('UNSUPPORTED_PAGE: 当前页面不支持 CDP 操作');
  }

  return withDebugger(tabId, async () => {
    try {
      const cdpParams = isRecord(params.params) ? params.params : undefined;
      const result = await sendDebuggerCommand(tabId, method, cdpParams);
      await appendAuditLog({ tool: 'browser_cdp', url: tab.url, ok: true });
      return { tabId, url: tab.url, title: tab.title, method, result };
    } catch (error) {
      await appendAuditLog({
        tool: 'browser_cdp',
        url: tab.url,
        ok: false,
        errorCode: error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_ERROR'
      });
      throw error;
    }
  });
}

export async function executeCdpSession(request: BridgeRequest, getActiveTab: () => Promise<BrowserTab>): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const enableDomains = Array.isArray(params.enable) ? params.enable.filter((d: unknown): d is string => typeof d === 'string') : [];
  if (enableDomains.length === 0) {
    throw new Error('INVALID_PARAMS: enable 参数必填，至少一个 CDP 域名');
  }

  const durationMs = typeof params.durationMs === 'number' ? Math.max(params.durationMs, 100) : 3000;

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) {
    throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');
  }

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  const events: Array<{ method: string; params: Record<string, unknown> }> = [];
  const listener = (source: chrome.debugger.Debuggee, method: string, eventParams?: unknown) => {
    if (source.tabId === tabId) {
      events.push({ method, params: (eventParams && typeof eventParams === 'object' ? eventParams as Record<string, unknown> : {}) });
    }
  };

  return withDebugger(tabId, async () => {
    chrome.debugger.onEvent.addListener(listener);
    try {
      for (const domain of enableDomains) {
        try {
          await sendDebuggerCommand(tabId, domain + '.enable');
        } catch { /* ignore */ }
      }
      await delay(durationMs);
      await appendAuditLog({ tool: 'browser_cdp_session', url: tab.url, ok: true });
      return {
        tabId,
        url: tab.url,
        title: tab.title,
        durationMs,
        eventCount: events.length,
        events
      };
    } catch (error) {
      await appendAuditLog({
        tool: 'browser_cdp_session',
        url: tab.url,
        ok: false,
        errorCode: error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_ERROR'
      });
      throw error;
    } finally {
      chrome.debugger.onEvent.removeListener(listener);
    }
  });
}

export async function getAXTree(request: BridgeRequest, getActiveTab: () => Promise<BrowserTab>): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  return withDebugger(tabId, async (debuggee) => {
    try {
      await chrome.debugger.sendCommand(debuggee, 'Accessibility.enable', {});
      const result = await chrome.debugger.sendCommand(debuggee, 'Accessibility.getFullAXTree', {});
      await appendAuditLog({ tool: 'browser_get_ax_tree', url: tab.url, ok: true });
      return { tabId, url: tab.url, title: tab.title, axTree: result };
    } catch (error) {
      await appendAuditLog({
        tool: 'browser_get_ax_tree',
        url: tab.url,
        ok: false,
        errorCode: error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_ERROR'
      });
      throw error;
    }
  });
}

export async function observePage(request: BridgeRequest, getActiveTab: () => Promise<BrowserTab>): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  return withDebugger(tabId, async (debuggee) => {
    try {
      await chrome.debugger.sendCommand(debuggee, 'Accessibility.enable', {});
      
      let result = (await chrome.debugger.sendCommand(debuggee, 'Accessibility.getFullAXTree', {})) as { nodes: any[] };
      let simplified = simplifyAXTree(result.nodes);

      if (simplified.split('\n').length <= 3) {
        await delay(200);
        result = (await chrome.debugger.sendCommand(debuggee, 'Accessibility.getFullAXTree', { depth: -1 })) as { nodes: any[] };
        simplified = simplifyAXTree(result.nodes);
      }

      if (simplified.split('\n').length <= 2) {
        const doc = await chrome.debugger.sendCommand(debuggee, 'DOM.getDocument', { depth: 0 }) as { root: { nodeId: number } };
        if (doc?.root?.nodeId) {
          const partial = await chrome.debugger.sendCommand(debuggee, 'Accessibility.getPartialAXTree', {
            nodeId: doc.root.nodeId,
            fetchRelativeTree: true
          }) as { nodes: any[] };
          if (partial?.nodes?.length > 0) {
            simplified = simplifyAXTree(partial.nodes);
          }
        }
      }

      await appendAuditLog({ tool: 'browser_observe', url: tab.url, ok: true });
      return {
        tabId,
        url: tab.url,
        title: tab.title,
        axTree: simplified || 'AXTree 为空或过于简单。'
      };
    } catch (error) {
      await appendAuditLog({
        tool: 'browser_observe',
        url: tab.url,
        ok: false,
        errorCode: error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_ERROR'
      });
      throw error;
    }
  });
}

function simplifyAXTree(nodes: any[]): string {
  if (!nodes || nodes.length === 0) return '';
  const nodeMap = new Map();
  nodes.forEach((n) => nodeMap.set(n.nodeId, n));

  function processNode(nodeId: string, depth: number = 0): string {
    const node = nodeMap.get(nodeId);
    if (!node || node.ignored) return '';

    const role = node.role?.value || 'unknown';
    const name = node.name?.value || '';
    const value = node.value?.value || '';
    const description = node.description?.value || '';
    
    const isChecked = node.properties?.find((p: any) => p.name === 'checked')?.value?.value;
    const isPressed = node.properties?.find((p: any) => p.name === 'pressed')?.value?.value;
    const isExpanded = node.properties?.find((p: any) => p.name === 'expanded')?.value?.value;
    const isFocused = node.properties?.find((p: any) => p.name === 'focused')?.value?.value;
    const level = node.properties?.find((p: any) => p.name === 'level')?.value?.value;

    const isGeneric = [
      'GenericContainer', 'Box', 'Section', 'WebArea', 'RootWebArea', 
      'none', 'presentation', 'group', 'StaticText', 'paragraph', 'listitem', 'list'
    ].includes(role);
    
    let line = '';
    const indent = '  '.repeat(depth);

    if (!isGeneric || name || value || description) {
      let prefix = '';
      if (role.includes('heading')) prefix = '#'.repeat(level || 3) + ' ';
      else if (role === 'button') prefix = '[Btn] ';
      else if (role === 'link') prefix = '[Link] ';
      else if (role === 'checkbox') prefix = isChecked ? '[x] ' : '[ ] ';
      else if (role === 'radio') prefix = isChecked ? '(x) ' : '( ) ';
      else if (role === 'textbox' || role === 'searchbox') prefix = '[Input] ';
      
      line = indent + prefix + role;
      if (name) line += ' "' + name + '"';
      if (value) line += ' val="' + value + '"';
      if (description) line += ' desc="' + description + '"';
      
      const states = [];
      if (isFocused) states.push('focused');
      if (isExpanded === true) states.push('expanded');
      if (isExpanded === false) states.push('collapsed');
      if (isPressed) states.push('pressed');
      if (states.length > 0) line += ' (' + states.join(', ') + ')';
      
      line += ' [' + nodeId + ']\n';
    }

    let children = '';
    if (node.childIds) {
      for (const childId of node.childIds) {
        children += processNode(childId, line ? depth + 1 : depth);
      }
    }

    return line + children;
  }

  return processNode(nodes[0].nodeId);
}

export async function monitorConsole(request: BridgeRequest, getActiveTab: () => Promise<BrowserTab>): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const durationMs = typeof params.durationMs === 'number' ? Math.max(params.durationMs, 100) : 5000;
  
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  const logs: any[] = [];
  const onEvent = (source: chrome.debugger.Debuggee, method: string, params: any) => {
    if (source.tabId !== tabId) return;
    if (method === 'Runtime.consoleAPICalled') {
      logs.push({
        type: params.type,
        timestamp: Date.now(),
        args: params.args.map((a: any) => a.value || a.description || '[complex object]'),
        stackTrace: params.stackTrace
      });
    } else if (method === 'Runtime.exceptionThrown') {
      logs.push({
        type: 'error',
        timestamp: params.timestamp,
        text: params.exceptionDetails.text,
        exception: params.exceptionDetails.exception?.description || params.exceptionDetails.text,
        stackTrace: params.exceptionDetails.stackTrace
      });
    }
  };

  return withDebugger(tabId, async (debuggee) => {
    chrome.debugger.onEvent.addListener(onEvent);
    try {
      await chrome.debugger.sendCommand(debuggee, 'Runtime.enable', {});
      await delay(durationMs);
      await appendAuditLog({ tool: 'browser_console_monitor', url: tab.url, ok: true });
      return { tabId, url: tab.url, title: tab.title, durationMs, logs };
    } catch (error) {
      await appendAuditLog({
        tool: 'browser_console_monitor',
        url: tab.url,
        ok: false,
        errorCode: error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_ERROR'
      });
      throw error;
    } finally {
      chrome.debugger.onEvent.removeListener(onEvent);
    }
  });
}

export async function mockNetwork(request: BridgeRequest, getActiveTab: () => Promise<BrowserTab>): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const urlPattern = typeof params.urlPattern === 'string' ? params.urlPattern : '';
  if (!urlPattern) throw new Error('INVALID_PARAMS: urlPattern 参数必填');

  const responseCode = typeof params.responseCode === 'number' ? params.responseCode : 200;
  const responseBody = typeof params.responseBody === 'string' ? params.responseBody : '';
  const contentType = typeof params.contentType === 'string' ? params.contentType : 'application/json';
  const durationMs = typeof params.durationMs === 'number' ? Math.max(params.durationMs, 100) : 10000;

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  const onEvent = async (source: chrome.debugger.Debuggee, method: string, eventParams: any) => {
    if (source.tabId !== tabId) return;
    if (method === 'Fetch.requestPaused') {
      const { requestId, request: interceptedRequest } = eventParams;
      if (interceptedRequest.url.includes(urlPattern)) {
        await chrome.debugger.sendCommand(source, 'Fetch.fulfillRequest', {
          requestId,
          responseCode,
          responseHeaders: [
            { name: 'Content-Type', value: contentType },
            { name: 'Access-Control-Allow-Origin', value: '*' }
          ],
          body: stringToBase64(responseBody)
        });
      } else {
        await chrome.debugger.sendCommand(source, 'Fetch.continueRequest', { requestId });
      }
    }
  };

  return withDebugger(tabId, async (debuggee) => {
    chrome.debugger.onEvent.addListener(onEvent);
    try {
      await chrome.debugger.sendCommand(debuggee, 'Fetch.enable', {
        patterns: [{ urlPattern: '*', requestStage: 'Request' }]
      });
      await delay(durationMs);
      await appendAuditLog({ tool: 'browser_mock_network', url: tab.url, ok: true });
      return { ok: true, urlPattern, durationMs };
    } catch (error) {
      await appendAuditLog({
        tool: 'browser_mock_network',
        url: tab.url,
        ok: false,
        errorCode: error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_ERROR'
      });
      throw error;
    } finally {
      chrome.debugger.onEvent.removeListener(onEvent);
      try { await chrome.debugger.sendCommand(debuggee, 'Fetch.disable', {}); } catch { /* ignore */ }
    }
  });
}

export async function browserRoute(request: BridgeRequest, getActiveTab: () => Promise<BrowserTab>): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const urlPattern = typeof params.urlPattern === 'string' ? params.urlPattern : '';
  if (!urlPattern) throw new Error('INVALID_PARAMS: urlPattern 参数必填');

  const responseCode = typeof params.responseCode === 'number' ? params.responseCode : 200;
  const responseBody = typeof params.responseBody === 'string' ? params.responseBody : '';
  const contentType = typeof params.contentType === 'string' ? params.contentType : 'application/json';
  const headers = isRecord(params.headers) ? params.headers : {};
  const durationMs = typeof params.durationMs === 'number' ? Math.max(params.durationMs, 100) : 10000;

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  const onEvent = async (source: chrome.debugger.Debuggee, method: string, eventParams: any) => {
    if (source.tabId !== tabId) return;
    if (method === 'Fetch.requestPaused') {
      const { requestId, request: interceptedRequest } = eventParams;
      if (interceptedRequest.url.includes(urlPattern)) {
        const responseHeaders = Object.entries(headers).map(([name, value]) => ({
          name,
          value: String(value)
        }));
        if (!responseHeaders.find(h => h.name.toLowerCase() === 'content-type')) {
          responseHeaders.push({ name: 'Content-Type', value: contentType });
        }
        await chrome.debugger.sendCommand(source, 'Fetch.fulfillRequest', {
          requestId,
          responseCode,
          responseHeaders,
          body: stringToBase64(responseBody)
        });
      } else {
        await chrome.debugger.sendCommand(source, 'Fetch.continueRequest', { requestId });
      }
    }
  };

  return withDebugger(tabId, async (debuggee) => {
    chrome.debugger.onEvent.addListener(onEvent);
    try {
      await chrome.debugger.sendCommand(debuggee, 'Fetch.enable', {
        patterns: [{ urlPattern: '*', requestStage: 'Request' }]
      });
      await delay(durationMs);
      await appendAuditLog({ tool: 'browser_route', url: tab.url, ok: true });
      return { ok: true, urlPattern, durationMs };
    } catch (error) {
      await appendAuditLog({
        tool: 'browser_route',
        url: tab.url,
        ok: false,
        errorCode: error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_ERROR'
      });
      throw error;
    } finally {
      chrome.debugger.onEvent.removeListener(onEvent);
      try { await chrome.debugger.sendCommand(debuggee, 'Fetch.disable', {}); } catch { /* ignore */ }
    }
  });
}

export async function capturePdf(request: BridgeRequest, getActiveTab: () => Promise<BrowserTab>): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  if (!tab.url || /^(chrome|chrome-extension|about|edge|brave):/.test(tab.url)) {
    throw new Error('UNSUPPORTED_PAGE: 当前页面不支持导出 PDF');
  }

  return withDebugger(tabId, async () => {
    try {
      const printOptions: Record<string, unknown> = {
        printBackground: params.printBackground !== false,
        preferCSSPageSize: params.preferCSSPageSize === true
      };
      if (params.landscape === true) printOptions.landscape = true;
      if (typeof params.scale === 'number') printOptions.scale = params.scale;
      if (typeof params.paperWidth === 'number') printOptions.paperWidth = params.paperWidth;
      if (typeof params.paperHeight === 'number') printOptions.paperHeight = params.paperHeight;
      if (typeof params.marginTop === 'number') printOptions.marginTop = params.marginTop;
      if (typeof params.marginBottom === 'number') printOptions.marginBottom = params.marginBottom;
      if (typeof params.marginLeft === 'number') printOptions.marginLeft = params.marginLeft;
      if (typeof params.marginRight === 'number') printOptions.marginRight = params.marginRight;
      if (typeof params.pageRanges === 'string' && params.pageRanges) printOptions.pageRanges = params.pageRanges;

      const result = await sendDebuggerCommand(tabId, 'Page.printToPDF', printOptions);
      const data = (result as Record<string, unknown>)?.data;
      if (typeof data !== 'string') throw new Error('INTERNAL_ERROR: PDF 生成返回数据无效');

      await appendAuditLog({ tool: 'browser_pdf', url: tab.url, ok: true });
      return { tabId, url: tab.url, title: tab.title, mimeType: 'application/pdf', data };
    } catch (error) {
      await appendAuditLog({
        tool: 'browser_pdf',
        url: tab.url,
        ok: false,
        errorCode: error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_ERROR'
      });
      throw error;
    }
  });
}

export async function captureCdpScreenshot(
  tabId: number,
  request: BridgeRequest
): Promise<Record<string, unknown>> {
  const tab = await chrome.tabs.get(tabId);
  const params = isRecord(request.params) ? request.params : {};
  const requestedFormat = params.format === 'jpeg' ? 'jpeg' : 'png';
  const quality = typeof params.quality === 'number' ? params.quality : undefined;
  const scale = typeof params.scale === 'number' ? Math.min(Math.max(params.scale, 0.1), 4) : undefined;

  return withDebugger(tabId, async () => {
    try {
      const captureParams: Record<string, unknown> = {
        format: requestedFormat,
        fromSurface: true,
        captureBeyondViewport: false
      };
      if (requestedFormat === 'jpeg' && typeof quality === 'number') {
        captureParams.quality = quality;
      }

      if (scale) {
        const metrics = await sendDebuggerCommand(tabId, 'Page.getLayoutMetrics');
        const cssVisualViewport = isRecord(metrics) && isRecord(metrics.cssVisualViewport)
          ? metrics.cssVisualViewport
          : undefined;
        const width = typeof cssVisualViewport?.clientWidth === 'number' && cssVisualViewport.clientWidth > 0 ? cssVisualViewport.clientWidth : undefined;
        const height = typeof cssVisualViewport?.clientHeight === 'number' && cssVisualViewport.clientHeight > 0 ? cssVisualViewport.clientHeight : undefined;

        if (width && height) {
          captureParams.clip = { x: 0, y: 0, width, height, scale: scale ?? 1 };
        }
      }

      const result = await sendDebuggerCommand(tabId, 'Page.captureScreenshot', captureParams);
      const data = isRecord(result) ? result.data : undefined;
      if (typeof data !== 'string') throw new Error('INTERNAL_ERROR: 截图返回数据无效');

      await appendAuditLog({ tool: request.tool, url: tab.url, ok: true });

      return {
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        mimeType: requestedFormat === 'jpeg' ? 'image/jpeg' : 'image/png',
        dataUrl: 'data:' + (requestedFormat === 'jpeg' ? 'image/jpeg' : 'image/png') + ';base64,' + data,
        mode: 'cdp',
        scale: scale ?? 1
      };
    } catch (error) {
      await appendAuditLog({
        tool: request.tool,
        url: tab.url,
        ok: false,
        errorCode: error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_ERROR'
      });
      throw error;
    }
  });
}

export async function runScreenInput(request: BridgeRequest, getActiveTab: () => Promise<BrowserTab>): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  if (!tab.url || /^(chrome|chrome-extension|about|edge|brave):/.test(tab.url)) {
    throw new Error('UNSUPPORTED_PAGE: 当前页面不支持视觉坐标操作');
  }

  return withDebugger(tabId, async () => {
    try {
      switch (request.tool) {
        case 'browser_screen_click':
          await dispatchScreenClick(tabId, params);
          break;
        case 'browser_screen_type':
          await dispatchScreenType(tabId, params);
          break;
        case 'browser_screen_drag':
          await dispatchScreenDrag(tabId, params);
          break;
        case 'browser_screen_scroll':
          await dispatchScreenScroll(tabId, params);
          break;
        case 'browser_screen_press':
          await dispatchScreenPress(tabId, params);
          break;
        default:
          throw new Error('INVALID_PARAMS: 不支持的视觉操作 ' + request.tool);
      }

      await appendAuditLog({ tool: request.tool, url: tab.url, ok: true });
      return {
        ok: true,
        tabId,
        url: tab.url,
        title: tab.title,
        tool: request.tool,
        coordinateSystem: 'viewport-css-pixels'
      };
    } catch (error) {
      await appendAuditLog({
        tool: request.tool,
        url: tab.url,
        ok: false,
        errorCode: error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_ERROR'
      });
      throw error;
    }
  });
}

export async function dispatchScreenClick(tabId: number, params: Record<string, unknown>): Promise<void> {
  const x = requiredNumber(params.x, 'x');
  const y = requiredNumber(params.y, 'y');
  const button = screenMouseButton(params.button);
  const clickCount = typeof params.clickCount === 'number' ? Math.max(1, Math.min(3, Math.round(params.clickCount))) : 1;
  const delayMs = typeof params.delayMs === 'number' ? Math.max(0, params.delayMs) : 50;

  await sendDebuggerCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await sendDebuggerCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount });
  if (delayMs > 0) await delay(delayMs);
  await sendDebuggerCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount });
}

export async function dispatchScreenDrag(tabId: number, params: Record<string, unknown>): Promise<void> {
  const from = requiredPoint(params.from, 'from');
  const to = requiredPoint(params.to, 'to');
  const button = screenMouseButton(params.button);
  const steps = typeof params.steps === 'number' ? Math.max(1, Math.min(120, Math.round(params.steps))) : 20;
  const durationMs = typeof params.durationMs === 'number' ? Math.max(0, params.durationMs) : 300;
  const stepDelay = steps > 0 ? durationMs / steps : 0;

  await sendDebuggerCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
  await sendDebuggerCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button, clickCount: 1 });

  for (let index = 1; index <= steps; index++) {
    const progress = index / steps;
    await sendDebuggerCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
      button
    });
    if (stepDelay > 0) await delay(stepDelay);
  }

  await sendDebuggerCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button, clickCount: 1 });
}

export async function dispatchScreenType(tabId: number, params: Record<string, unknown>): Promise<void> {
  const text = typeof params.text === 'string' ? params.text : undefined;
  if (text === undefined) throw new Error('INVALID_PARAMS: text 参数必填');
  await sendDebuggerCommand(tabId, 'Input.insertText', { text });
}

export async function dispatchScreenScroll(tabId: number, params: Record<string, unknown>): Promise<void> {
  const viewport = await getViewportInfo(tabId);
  const x = typeof params.x === 'number' ? params.x : viewport.width / 2;
  const y = typeof params.y === 'number' ? params.y : viewport.height / 2;
  const deltaX = typeof params.deltaX === 'number' ? params.deltaX : 0;
  const deltaY = typeof params.deltaY === 'number' ? params.deltaY : 600;

  await sendDebuggerCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY });
}

export async function dispatchScreenPress(tabId: number, params: Record<string, unknown>): Promise<void> {
  const key = typeof params.key === 'string' ? params.key : '';
  if (!key) throw new Error('INVALID_PARAMS: key 参数必填');
  const keyInfo = keyToCdpInfo(key);
  await sendDebuggerCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...keyInfo });
  await sendDebuggerCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...keyInfo });
}

export async function getViewportInfo(tabId: number): Promise<{
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  visualViewport: {
    offsetLeft: number;
    offsetTop: number;
    pageLeft: number;
    pageTop: number;
    width: number;
    height: number;
    scale: number;
  };
  devicePixelRatio: number;
}> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      visualViewport: {
        offsetLeft: window.visualViewport?.offsetLeft ?? 0,
        offsetTop: window.visualViewport?.offsetTop ?? 0,
        pageLeft: window.visualViewport?.pageLeft ?? window.scrollX,
        pageTop: window.visualViewport?.pageTop ?? window.scrollY,
        width: window.visualViewport?.width ?? window.innerWidth,
        height: window.visualViewport?.height ?? window.innerHeight,
        scale: window.visualViewport?.scale ?? 1
      },
      devicePixelRatio: window.devicePixelRatio || 1
    })
  });
  const value = results[0]?.result;
  if (!isRecord(value)) throw new Error('INTERNAL_ERROR: 无法读取 viewport 信息');
  return value as any;
}

function requiredNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('INVALID_PARAMS: ' + name + ' 参数必填且必须是数字');
  }
  return value;
}

function requiredPoint(value: unknown, name: string): { x: number; y: number } {
  if (!isRecord(value)) throw new Error('INVALID_PARAMS: ' + name + ' 参数必填');
  return { x: requiredNumber(value.x, name + '.x'), y: requiredNumber(value.y, name + '.y') };
}

function screenMouseButton(value: unknown): 'left' | 'middle' | 'right' {
  return value === 'middle' || value === 'right' ? value : 'left';
}

function keyToCdpInfo(key: string): Record<string, unknown> {
  const special: Record<string, { code: string; windowsVirtualKeyCode: number }> = {
    Enter: { code: 'Enter', windowsVirtualKeyCode: 13 },
    Escape: { code: 'Escape', windowsVirtualKeyCode: 27 },
    Tab: { code: 'Tab', windowsVirtualKeyCode: 9 },
    Backspace: { code: 'Backspace', windowsVirtualKeyCode: 8 },
    Delete: { code: 'Delete', windowsVirtualKeyCode: 46 },
    ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    ArrowLeft: { code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
    ArrowRight: { code: 'ArrowRight', windowsVirtualKeyCode: 39 },
    Space: { code: 'Space', windowsVirtualKeyCode: 32 }
  };
  const mapped = special[key];
  if (mapped) return { key, code: mapped.code, windowsVirtualKeyCode: mapped.windowsVirtualKeyCode };
  if (key.length === 1) {
    return {
      key,
      text: key,
      unmodifiedText: key,
      code: /^[a-z]$/i.test(key) ? 'Key' + key.toUpperCase() : undefined,
      windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0)
    };
  }
  return { key, code: key };
}

export async function captureResponsive(request: BridgeRequest, getActiveTab: () => Promise<BrowserTab>): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const rawViewports = Array.isArray(params.viewports) ? params.viewports : [];
  const viewports: Array<{ name: string; width: number; height: number }> = rawViewports
    .filter((v: unknown): v is Record<string, unknown> => isRecord(v))
    .map((v) => ({
      name: typeof v.name === 'string' ? v.name : v.width + 'x' + v.height,
      width: typeof v.width === 'number' ? v.width : 1920,
      height: typeof v.height === 'number' ? v.height : 1080
    }));

  if (viewports.length === 0) {
    viewports.push(
      { name: 'Desktop', width: 1920, height: 1080 },
      { name: 'Tablet', width: 768, height: 1024 },
      { name: 'Mobile', width: 375, height: 812 }
    );
  }

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  return withDebugger(tabId, async () => {
    const screenshots: Array<Record<string, unknown>> = [];
    try {
      for (const vp of viewports) {
        await sendDebuggerCommand(tabId, 'Emulation.setDeviceMetricsOverride', {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 1,
          mobile: vp.width < 768
        });
        await delay(500);
        const screenshot = await captureScreenshotWithAttachedDebugger(tabId);
        screenshots.push({ name: vp.name, width: vp.width, height: vp.height, mimeType: 'image/png', dataUrl: screenshot.dataUrl });
      }
      await sendDebuggerCommand(tabId, 'Emulation.clearDeviceMetricsOverride');
      await appendAuditLog({ tool: 'browser_responsive', url: tab.url, ok: true });
      return { tabId, url: tab.url, title: tab.title, viewports: viewports.length, screenshots };
    } catch (error) {
      await appendAuditLog({
        tool: 'browser_responsive',
        url: tab.url,
        ok: false,
        errorCode: error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_ERROR'
      });
      throw error;
    }
  });
}

export async function captureScreenshotWithAttachedDebugger(tabId: number): Promise<{ dataUrl: string }> {
  const result = await sendDebuggerCommand(tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const data = isRecord(result) ? result.data : undefined;
  if (typeof data !== 'string') throw new Error('INTERNAL_ERROR: 截图返回数据无效');
  return { dataUrl: 'data:image/png;base64,' + data };
}

export async function runNetworkAnalysis(request: BridgeRequest, getActiveTab: () => Promise<BrowserTab>): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const durationMs = typeof params.durationMs === 'number' ? Math.max(params.durationMs, 100) : 5000;
  const slowThresholdMs = typeof params.slowThresholdMs === 'number' ? params.slowThresholdMs : 1000;

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  const requests: Map<string, Record<string, unknown>> = new Map();
  const responses: Map<string, Record<string, unknown>> = new Map();
  const listener = (source: chrome.debugger.Debuggee, method: string, eventParams?: unknown) => {
    if (source.tabId !== tabId) return;
    const p = eventParams && typeof eventParams === 'object' ? eventParams as Record<string, unknown> : {};
    const requestId = typeof p.requestId === 'string' ? p.requestId : undefined;
    if (!requestId) return;

    if (method === 'Network.requestWillBeSent') {
      const req = isRecord(p.request) ? p.request : {};
      requests.set(requestId, {
        url: typeof req.url === 'string' ? req.url : '',
        method: typeof req.method === 'string' ? req.method : 'GET',
        type: typeof p.type === 'string' ? p.type : 'Other',
        timestamp: typeof p.timestamp === 'number' ? p.timestamp : 0
      });
    } else if (method === 'Network.responseReceived') {
      const resp = isRecord(p.response) ? p.response : {};
      responses.set(requestId, {
        status: typeof resp.status === 'number' ? resp.status : 0,
        mimeType: typeof resp.mimeType === 'string' ? resp.mimeType : '',
        encodedDataLength: typeof resp.encodedDataLength === 'number' ? resp.encodedDataLength : 0,
        timing: isRecord(resp.timing) ? resp.timing : {}
      });
    }
  };

  return withDebugger(tabId, async () => {
    chrome.debugger.onEvent.addListener(listener);
    try {
      await sendDebuggerCommand(tabId, 'Network.enable');
      await delay(durationMs);

      const allRequests: Array<Record<string, unknown>> = [];
      let totalTransferSize = 0;
      let slowCount = 0;
      const byType: Record<string, number> = {};

      for (const [id, req] of requests) {
        const resp = responses.get(id);
        const duration = resp && isRecord(resp.timing)
          ? (typeof resp.timing.responseTime === 'number' && typeof req.timestamp === 'number'
            ? (resp.timing.responseTime as number) * 1000 - (req.timestamp as number) * 1000
            : 0)
          : 0;

        const transferSize = resp ? (resp.encodedDataLength as number) || 0 : 0;
        totalTransferSize += transferSize;

        const type = (req.type as string) || 'Other';
        byType[type] = (byType[type] || 0) + 1;

        const isSlow = duration > slowThresholdMs;
        if (isSlow) slowCount++;

        allRequests.push({
          url: (req.url as string).substring(0, 120),
          method: req.method,
          type,
          status: resp?.status ?? 'pending',
          durationMs: Math.round(duration),
          sizeKB: Math.round(transferSize / 1024),
          slow: isSlow
        });
      }

      await appendAuditLog({ tool: 'browser_network_analysis', url: tab.url, ok: true });
      return {
        tabId, url: tab.url, title: tab.title, durationMs,
        summary: { totalRequests: allRequests.length, slowRequests: slowCount, totalTransferKB: Math.round(totalTransferSize / 1024), byType },
        slowRequests: allRequests.filter((r) => r.slow).sort((a, b) => (b.durationMs as number) - (a.durationMs as number)),
        allRequests: allRequests.sort((a, b) => (b.durationMs as number) - (a.durationMs as number)).slice(0, 50)
      };
    } catch (error) {
      await appendAuditLog({
        tool: 'browser_network_analysis',
        url: tab.url,
        ok: false,
        errorCode: error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_ERROR'
      });
      throw error;
    } finally {
      chrome.debugger.onEvent.removeListener(listener);
    }
  });
}

let isGlobalRoutingEnabled = false;
const networkRoutes = new Map<string, {
  responseCode: number;
  responseBody: string;
  contentType: string;
  headers?: Record<string, string>;
}>();

export async function enableNetworkRoutingGlobally() {
  if (isGlobalRoutingEnabled) return;
  isGlobalRoutingEnabled = true;

  chrome.debugger.onEvent.addListener(async (source, method, params: any) => {
    if (method === 'Fetch.requestPaused') {
      const { requestId, request } = params;
      let matched = false;
      for (const [pattern, config] of networkRoutes.entries()) {
        if (request.url.includes(pattern)) {
          matched = true;
          const responseHeaders = Object.entries(config.headers ?? {}).map(([name, value]) => ({ name, value: String(value) }));
          if (!responseHeaders.find(h => h.name.toLowerCase() === 'content-type')) {
            responseHeaders.push({ name: 'Content-Type', value: config.contentType });
          }
          await chrome.debugger.sendCommand(source, 'Fetch.fulfillRequest', {
            requestId,
            responseCode: config.responseCode,
            responseHeaders,
            body: stringToBase64(config.responseBody)
          });
          break;
        }
      }
      if (!matched) {
        await chrome.debugger.sendCommand(source, 'Fetch.continueRequest', { requestId });
      }
    }
  });

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && tab.url && !tab.url.startsWith('chrome')) {
      try {
        await chrome.debugger.attach({ tabId: tab.id }, '1.3');
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Fetch.enable', { patterns: [{ urlPattern: '*' }] });
      } catch { /* ignore */ }
    }
  }
}

export async function handleCdpInput(message: any, getActiveTab: () => Promise<BrowserTab>): Promise<any> {
  const { action, params, tabId: requestedTabId } = message;
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) return { ok: false, error: 'TAB_NOT_FOUND' };
  
  return withDebugger(tabId, async (debuggee) => {
    try {
      if (action === 'click') {
        const { x, y } = params;
        await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: Math.round(x),
          y: Math.round(y),
          button: 'left',
          clickCount: 1
        });
        await delay(50);
        await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: Math.round(x),
          y: Math.round(y),
          button: 'left',
          clickCount: 1
        });
      } else if (action === 'type') {
        const { text } = params;
        for (const char of text) {
          await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
            type: 'keyDown',
            text: char,
            unmodifiedText: char
          });
          await delay(20);
          await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            text: char,
            unmodifiedText: char
          });
        }
      }
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Another debugger') || message.includes('already attached')) {
        return { ok: false, error: 'DEBUGGER_BUSY: 目标标签页已有 DevTools 打开' };
      }
      return { ok: false, error: message };
    }
  });
}
