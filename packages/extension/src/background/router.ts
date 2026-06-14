import {
  type BridgeErrorCode,
  type BridgeRequest,
  type BridgeResponse
} from '@majuntao-1/browser-bridge-shared';
import { getSessionTrustAgentFully, setSessionTrustAgentFully } from './security.js';
import { getAuditLog } from './audit.js';
import * as TabsService from './services/tabs.js';
import * as ContentScriptService from './services/content-script.js';
import * as DebuggerService from './services/debugger.js';
import * as TaskOrchestrator from './services/task-orchestrator.js';
import * as SessionService from './services/session.js';
import * as RecorderService from './services/recorder.js';
import * as VisualService from './services/visual.js';
import * as AgentSessionService from './services/agent-session.js';


export async function handleBridgeRequest(request: BridgeRequest): Promise<BridgeResponse> {
  try {
    const data = await dispatchRequest(request);
    return { id: request.id, ok: true, data };
  } catch (error: any) {
    // Self-healing: if DOM click/type fails, try visual fallback
    if (error?.message?.includes('ELEMENT_NOT_FOUND') && (request.tool === 'browser_click' || request.tool === 'browser_type')) {
      const query = request.params?.query || request.params?.text || request.params?.label;
      if (typeof query === 'string' && query.length > 0) {
        console.log('[Self-Healing] DOM target not found, trying visual fallback for:', query);
        try {
          const visualTool = request.tool === 'browser_click' ? 'browser_visual_click_text' : 'browser_visual_task';
          const visualParams = request.tool === 'browser_click' 
            ? { text: query, exact: request.params?.exact }
            : { instruction: '点击 ' + query };
          const visualData = await VisualService.runVisualMode({ ...request, tool: visualTool as any, params: visualParams });
          return { id: request.id, ok: true, data: visualData };
        } catch (visualError) {
          console.error('[Self-Healing] Visual fallback also failed:', visualError);
        }
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    const [code, detail] = message.includes(': ')
      ? message.split(/: (.*)/s, 2)
      : ['INTERNAL_ERROR', message];

    return {
      id: request.id,
      ok: false,
      error: {
        code: code as BridgeErrorCode,
        message: detail || message,
        details: error.details
      }
    };
  }
}

async function dispatchRequest(request: BridgeRequest): Promise<unknown> {
  switch (request.tool) {
    case 'browser_get_active_tab':
      return TabsService.getActiveTab();
    case 'browser_list_tabs':
      return TabsService.listTabs();
    case 'browser_open_url':
      return TabsService.openUrl(String(request.params?.url ?? ''), {
        waitUntil: request.params?.waitUntil === 'commit' ? 'commit' : 'ready',
        timeoutMs: typeof request.params?.timeoutMs === 'number' ? request.params.timeoutMs : undefined
      });
    case 'browser_open_incognito':
      return TabsService.openIncognito(String(request.params?.url ?? ''));
    case 'browser_activate_tab':
      return TabsService.activateTab(Number(request.params?.tabId));
    case 'browser_get_page_text':
    case 'browser_get_page_snapshot':
    case 'browser_get_page_model':
    case 'browser_get_interactives':
    case 'browser_find':
    case 'browser_act':
    case 'browser_assert_text':
    case 'browser_get_selected_text':
    case 'browser_get_links':
      return ContentScriptService.sendToContentScript(request);
    case 'browser_use':
      const use = request.params?.use !== false;
      setSessionTrustAgentFully(use && request.params?.trustAgentFully === true);
      await AgentSessionService.broadcastAgentSessionStatus(use);
      if (use) {
        // Pre-warming: ensure content script and debugger are ready for active tab
        try {
          const activeTab = await TabsService.getActiveTab();
          if (activeTab.id) {
            await ContentScriptService.ensureContentScript(activeTab.id);
            await DebuggerService.withDebugger(activeTab.id, async () => {});
          }
        } catch { /* ignore pre-warm failures */ }
      }
      return { ok: true, isAgentSessionActive: AgentSessionService.isAgentSessionActive, trustAgentFully: getSessionTrustAgentFully() };
    case 'browser_get_ax_tree':
      return DebuggerService.getAXTree(request, TabsService.getActiveTab);
    case 'browser_observe':
      return DebuggerService.observePage(request, TabsService.getActiveTab);
    case 'browser_mock_network':
      return DebuggerService.mockNetwork(request, TabsService.getActiveTab);
    case 'browser_wait_for_request':
      return waitForNetworkRequest(request); // Still in background.ts for now
    case 'browser_console_monitor':
      return DebuggerService.monitorConsole(request, TabsService.getActiveTab);
    case 'browser_get_audit_log':
      return getAuditLog(typeof request.params?.limit === 'number' ? request.params.limit : 20);
    case 'browser_run_steps':
      return TaskOrchestrator.runSteps(request);
    case 'browser_pdf':
      return DebuggerService.capturePdf(request, TabsService.getActiveTab);
    case 'browser_evaluate':
      return evaluateScript(request); // Still in background.ts for now
    case 'browser_smart_act':
      return VisualService.smartAct(request);
    case 'browser_cdp':
      return DebuggerService.executeCdp(request, TabsService.getActiveTab);
    case 'browser_cdp_session':
      return DebuggerService.executeCdpSession(request, TabsService.getActiveTab);
    case 'browser_responsive':
      return DebuggerService.captureResponsive(request, TabsService.getActiveTab);
    case 'browser_network_analysis':
      return DebuggerService.runNetworkAnalysis(request, TabsService.getActiveTab);
    case 'browser_route':
      return DebuggerService.browserRoute(request, TabsService.getActiveTab);
    case 'browser_export_session':
      return SessionService.exportSession(request);
    case 'browser_import_session':
      return SessionService.importSession(request);
    case 'browser_close_tab':
      return TabsService.closeTab(Number(request.params?.tabId));
    case 'browser_new_tab':
      return newTab(request); // Still in background.ts
    case 'browser_new_context':
      return newContext(request); // Still in background.ts
    case 'browser_toggle_recording':
      return RecorderService.toggleRecording(request);
    case 'browser_get_recorded_steps':
      return RecorderService.getRecordedSteps();
    case 'browser_screen_observe':
    case 'browser_visual_observe':
      return VisualService.screenObserve(request, TabsService.getActiveTab);
    case 'browser_visual_click_text':
    case 'browser_visual_select':
    case 'browser_visual_task':
    case 'browser_visual_resolve_text':
      return VisualService.runVisualMode(request);
    case 'browser_screen_click':
    case 'browser_screen_type':
    case 'browser_screen_drag':
    case 'browser_screen_scroll':
    case 'browser_screen_press':
      return DebuggerService.runScreenInput(request, TabsService.getActiveTab);
    case 'browser_screenshot':
    case 'browser_click':
    case 'browser_find_and_click':
    case 'browser_find_and_type':
    case 'browser_fill_form':
    case 'browser_hover':
    case 'browser_press_key':
    case 'browser_type':
    case 'browser_clear':
    case 'browser_scroll':
    case 'browser_wait_for':
    case 'browser_select_option':
      return VisualService.selectOptionWithFallback(request);
    default:
      throw new Error('INTERNAL_ERROR: 不支持的工具 ' + request.tool);
  }
}

async function waitForNetworkRequest(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = (typeof request.params === 'object' && request.params !== null) ? request.params : {};
  const urlPattern = typeof params.urlPattern === 'string' ? params.urlPattern : '';
  if (!urlPattern) throw new Error('INVALID_PARAMS: urlPattern 参数必填');
  const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : 10000;
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await TabsService.getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.webRequest.onCompleted.removeListener(listener);
      reject(new Error('ACTION_TIMEOUT: 在 ' + timeoutMs + 'ms 内未检测到符合模式 ' + urlPattern + ' 的请求'));
    }, timeoutMs);
    const listener = (details: chrome.webRequest.WebResponseCacheDetails) => {
      if (details.tabId === tabId && details.url.includes(urlPattern)) {
        clearTimeout(timeout);
        chrome.webRequest.onCompleted.removeListener(listener);
        resolve({ ok: true, url: details.url, method: details.method, statusCode: details.statusCode, timeStamp: details.timeStamp });
      }
    };
    chrome.webRequest.onCompleted.addListener(listener, { urls: ['<all_urls>'], tabId });
  });
}

async function evaluateScript(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = (typeof request.params === 'object' && request.params !== null) ? request.params : {};
  const expression = typeof params.expression === 'string' ? params.expression : '';
  if (!expression.trim()) throw new Error('INVALID_PARAMS: expression 参数必填');
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await TabsService.getActiveTab()).id;
  if (!tabId) throw new Error('TAB_NOT_FOUND: 缺少标签页 ID');
  const tab = await chrome.tabs.get(tabId);
  if (params.mode === 'cdp') {
    return DebuggerService.withDebugger(tabId, async () => {
      const result = await DebuggerService.sendDebuggerCommand(tabId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      return { tabId, url: tab.url, title: tab.title, expression, result: (result as any).result };
    });
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: (expr: string) => {
      try {
        const result = eval(expr);
        return { value: JSON.parse(JSON.stringify(result)), type: typeof result };
      } catch (error: any) { return { error: error.message, type: 'error' }; }
    },
    args: [expression]
  });
  return { tabId, url: tab.url, title: tab.title, expression, result: results[0]?.result };
}

async function newTab(request: BridgeRequest): Promise<any> {
  const params = (typeof request.params === 'object' && request.params !== null) ? request.params : {};
  const url = typeof params.url === 'string' ? params.url : undefined;
  const tab = await chrome.tabs.create({ url, active: true });
  const readyTab = url && tab.id ? await TabsService.waitForTabUrl(tab.id, url) : tab;
  return TabsService.normalizeTab(readyTab);
}

async function newContext(request: BridgeRequest): Promise<any> {
  const params = (typeof request.params === 'object' && request.params !== null) ? request.params : {};
  const url = typeof params.url === 'string' ? params.url : undefined;
  const isAllowed = await chrome.extension.isAllowedIncognitoAccess();
  if (!isAllowed) throw new Error('PERMISSION_DENIED: 插件未被允许访问隐身模式');
  const window = await chrome.windows.create({ url: url ?? 'about:blank', incognito: true });
  const tab = window.tabs?.[0];
  if (!tab) throw new Error('INTERNAL_ERROR: 无法创建隐身窗口');
  return TabsService.normalizeTab(tab);
}
