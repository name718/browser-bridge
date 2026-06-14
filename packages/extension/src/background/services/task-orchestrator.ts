import {
  type BridgeRequest,
  type BrowserRunStepsResult,
  type BrowserStep,
  type BrowserStepAction,
  type BrowserStepResult,
  type BridgeErrorCode
} from '@majuntao-1/browser-bridge-shared';
import * as TabsService from './tabs.js';
import * as ContentScriptService from './content-script.js';
import * as DebuggerService from './debugger.js';
import * as VisualService from './visual.js';
import * as ScreenshotService from './screenshot.js';

export async function runSteps(request: BridgeRequest): Promise<BrowserRunStepsResult> {
  const params = (typeof request.params === 'object' && request.params !== null) ? request.params : {};
  const steps = Array.isArray(params.steps) ? params.steps : undefined;
  if (!steps?.length) {
    throw new Error('INVALID_PARAMS: steps 参数必填');
  }

  const firstStep = steps.find(isRecord);
  let currentTabId = request.tabId ?? numberParam(params, 'tabId');
  if (!currentTabId && firstStep?.action !== 'open') {
    currentTabId = (await TabsService.getActiveTab()).id;
  }
  
  const needsDebugger = steps.some(s => 
    isRecord(s) && ['screenClick', 'screenType', 'screenDrag', 'screenScroll', 'screenPress', 'screenshot', 'pdf'].includes(String(s.action))
  );

  const executeSequence = async (debuggee?: chrome.debugger.Debuggee) => {
    const stopOnError = params.stopOnError !== false;
    const defaultDelayMs = numberParam(params, 'delayMs') ?? 0;
    const trace = params.trace === true;
    const results: BrowserStepResult[] = [];

    for (const [index, rawStep] of steps.entries()) {
      if (!isRecord(rawStep)) continue;

      const startedAt = Date.now();
      let action: BrowserStepAction = 'sleep';
      const description = stringParam(rawStep, 'description');

      try {
        action = parseStepAction(rawStep.action);
        const step = rawStep as BrowserStep;

        let beforeSnapshot: any = undefined;
        if (trace && ['click', 'type', 'hover', 'clear', 'pressKey', 'fillForm', 'screenClick', 'screenType', 'screenDrag', 'screenScroll', 'screenPress'].includes(action)) {
          beforeSnapshot = await captureInternalSnapshot(currentTabId);
        }

        const data = await runStep(step, currentTabId);
        currentTabId = extractTabId(data) ?? numberParam(rawStep, 'tabId') ?? currentTabId;

        let afterSnapshot: any = undefined;
        if (['click', 'type', 'scroll', 'screenClick', 'screenType', 'screenScroll'].includes(action)) {
          await new Promise(r => setTimeout(r, 500));
          afterSnapshot = await captureInternalSnapshot(currentTabId);
          const urlChanged = beforeSnapshot && afterSnapshot && beforeSnapshot.url !== afterSnapshot.url;
          
          if (!urlChanged && action === 'click') {
            try {
              const axTreeResult = await DebuggerService.observePage({ id: 'self-healing', tool: 'browser_observe', tabId: currentTabId }) as { axTree: string };
              if (axTreeResult && axTreeResult.axTree.length < 200 && !axTreeResult.axTree.includes('Dialog') && !axTreeResult.axTree.includes('Popup')) {
                console.warn('[Self-Healing] 操作可能未生效');
              }
            } catch { /* ignore */ }
          }
        } else if (trace && beforeSnapshot) {
          afterSnapshot = await captureInternalSnapshot(currentTabId);
        }

        results.push({
          index, action, description, ok: true,
          elapsedMs: Date.now() - startedAt,
          tabId: currentTabId,
          data: {
            ...((sanitizeStepData(action, data) as Record<string, unknown>) || {}),
            trace: beforeSnapshot ? { before: beforeSnapshot, after: afterSnapshot } : undefined
          }
        });

        const delayMs = numberParam(rawStep, 'delayMs') ?? defaultDelayMs;
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      } catch (error) {
        const { code, message } = normalizeError(error);
        const errorScreenshot = await takeErrorScreenshot(currentTabId);
        results.push(makeStepError(index, action, description, code, message, Date.now() - startedAt, currentTabId, errorScreenshot));
        if (stopOnError) return { ok: false, stoppedAt: index, tabId: currentTabId, results };
      }
    }
    return { ok: results.every((result) => result.ok), tabId: currentTabId, results };
  };

  if (needsDebugger && currentTabId) {
    return DebuggerService.withDebugger(currentTabId, () => executeSequence());
  } else {
    return executeSequence();
  }
}

async function captureInternalSnapshot(tabId: number | undefined): Promise<any> {
  try {
    const id = tabId || (await TabsService.getActiveTab()).id;
    const tab = await chrome.tabs.get(id);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png', quality: 50 });
    return { dataUrl, url: tab.url, title: tab.title };
  } catch {
    return undefined;
  }
}

export async function runStep(step: BrowserStep, currentTabId?: number): Promise<unknown> {
  switch (step.action) {
    case 'open':
      if (!step.url) throw new Error('INVALID_PARAMS: open 步骤需要 url');
      return TabsService.openUrl(step.url, { waitUntil: 'commit', timeoutMs: step.timeoutMs ?? 10000 });
    case 'activateTab':
      return TabsService.activateTab(requiredTabId(step, currentTabId));
    case 'click':
      return ContentScriptService.sendToContentScript(stepRequest('browser_find_and_click', step, currentTabId, targetParams(step)));
    case 'hover':
      return ContentScriptService.sendToContentScript(stepRequest('browser_hover', step, currentTabId, targetParams(step)));
    case 'type':
      return ContentScriptService.sendToContentScript(stepRequest('browser_find_and_type', step, currentTabId, {
        ...targetParams(step),
        text: step.value ?? step.text,
        replace: step.replace
      }));
    case 'selectOption':
      return VisualService.selectOptionWithFallback(stepRequest('browser_select_option', step, currentTabId, {
        label: step.label ?? step.text ?? step.query,
        option: step.option ?? step.value,
        exact: step.exact,
        timeoutMs: step.timeoutMs
      }));
    case 'fillForm':
      return ContentScriptService.sendToContentScript(stepRequest('browser_fill_form', step, currentTabId, {
        fields: step.fields,
        timeoutMs: step.timeoutMs
      }));
    case 'clear':
      return ContentScriptService.sendToContentScript(stepRequest('browser_clear', step, currentTabId, targetParams(step)));
    case 'scroll':
      return ContentScriptService.sendToContentScript(stepRequest('browser_scroll', step, currentTabId, {
        direction: step.direction ?? 'down',
        amount: step.amount
      }));
    case 'waitFor':
      return ContentScriptService.sendToContentScript(stepRequest('browser_wait_for', step, currentTabId, targetParams(step)));
    case 'pressKey':
      return ContentScriptService.sendToContentScript(stepRequest('browser_press_key', step, currentTabId, { key: step.key }));
    case 'assertText':
      return ContentScriptService.sendToContentScript(stepRequest('browser_assert_text', step, currentTabId, {
        text: step.text,
        contains: step.contains
      }));
    case 'getText':
      return ContentScriptService.sendToContentScript(stepRequest('browser_get_page_text', step, currentTabId, {}));
    case 'pageModel':
      return ContentScriptService.sendToContentScript(stepRequest('browser_get_page_model', step, currentTabId, {
        visibleOnly: step.visibleOnly,
        viewportOnly: step.viewportOnly,
        maxTextLength: step.maxTextLength,
        maxElements: step.maxElements,
        maxHeadings: step.maxHeadings,
        maxRegions: step.maxRegions,
        maxTables: step.maxTables,
        maxTableRows: step.maxTableRows
      }));
    case 'snapshot':
      return ContentScriptService.sendToContentScript(stepRequest('browser_get_page_snapshot', step, currentTabId, {}));
    case 'screenshot':
      return ContentScriptService.sendToContentScript(stepRequest('browser_screenshot', step, currentTabId, {
        format: step.format,
        quality: step.quality
      }));
    case 'screenObserve':
      return VisualService.screenObserve(stepRequest('browser_screen_observe', step, currentTabId, {
        format: step.format,
        quality: step.quality,
        withGrid: step.withGrid,
        gridSize: step.gridSize,
        scale: step.scale
      }));
    case 'screenClick':
      return DebuggerService.runScreenInput(stepRequest('browser_screen_click', step, currentTabId, {
        x: step.x, y: step.y, button: step.button, clickCount: step.clickCount, delayMs: step.delayMs
      }));
    case 'screenType':
      return DebuggerService.runScreenInput(stepRequest('browser_screen_type', step, currentTabId, {
        text: step.value ?? step.text
      }));
    case 'screenDrag':
      return DebuggerService.runScreenInput(stepRequest('browser_screen_drag', step, currentTabId, {
        from: step.from, to: step.to, button: step.button, steps: step.steps, durationMs: step.durationMs
      }));
    case 'screenScroll':
      return DebuggerService.runScreenInput(stepRequest('browser_screen_scroll', step, currentTabId, {
        x: step.x, y: step.y, deltaX: step.deltaX, deltaY: step.deltaY
      }));
    case 'screenPress':
      return DebuggerService.runScreenInput(stepRequest('browser_screen_press', step, currentTabId, {
        key: step.key
      }));
    case 'pdf':
      return DebuggerService.capturePdf({
        id: crypto.randomUUID(),
        tool: 'browser_pdf',
        tabId: step.tabId ?? currentTabId,
        params: {
          tabId: step.tabId ?? currentTabId,
          landscape: step.landscape,
          printBackground: step.printBackground,
          scale: step.scale,
          paperWidth: step.paperWidth,
          paperHeight: step.paperHeight,
          marginTop: step.marginTop,
          marginBottom: step.marginBottom,
          marginLeft: step.marginLeft,
          marginRight: step.marginRight,
          pageRanges: step.pageRanges,
          preferCSSPageSize: step.preferCSSPageSize
        }
      });
    case 'sleep':
      await new Promise(r => setTimeout(r, step.delayMs ?? step.timeoutMs ?? 500));
      return { slept: true };
    default:
      throw new Error('INVALID_PARAMS: 不支持的步骤动作 ' + (step as any).action);
  }
}

function parseStepAction(value: unknown): BrowserStepAction {
  const allowed: BrowserStepAction[] = ['open', 'activateTab', 'click', 'hover', 'type', 'selectOption', 'fillForm', 'clear', 'scroll', 'waitFor', 'pressKey', 'assertText', 'getText', 'pageModel', 'snapshot', 'screenshot', 'screenObserve', 'screenClick', 'screenType', 'screenDrag', 'screenScroll', 'screenPress', 'pdf', 'sleep'];
  if (typeof value === 'string' && allowed.includes(value as any)) return value as any;
  throw new Error('INVALID_PARAMS: action 不支持或缺失');
}

function targetParams(step: BrowserStep): Record<string, unknown> {
  const target = isRecord(step.target) ? step.target : {};
  const locator = isRecord(step.locator) ? step.locator : {};
  const testId = stringParam(step, 'testId') ?? stringParam(locator, 'testId') ?? stringParam(target, 'testId');
  return {
    query: step.query ?? locator.query ?? locator.label ?? target.query,
    elementId: step.elementId ?? locator.elementId ?? target.elementId,
    selector: step.selector ?? locator.selector ?? target.selector ?? (testId ? 'data-testid=' + testId : undefined),
    testId,
    text: step.text ?? locator.text ?? locator.label ?? target.text,
    role: step.role ?? locator.role ?? target.role,
    ariaLabel: step.ariaLabel ?? locator.ariaLabel ?? target.ariaLabel,
    placeholder: step.placeholder ?? locator.placeholder ?? target.placeholder,
    label: step.label ?? locator.label ?? target.label,
    href: step.href ?? locator.href ?? target.href,
    nearText: step.nearText ?? locator.nearText ?? target.nearText,
    visibleOnly: step.visibleOnly ?? locator.visibleOnly,
    viewportOnly: step.viewportOnly ?? locator.viewportOnly
  };
}

function stepRequest(tool: any, step: BrowserStep, currentTabId: number | undefined, params: Record<string, unknown>): BridgeRequest {
  return { id: crypto.randomUUID(), tool, tabId: step.tabId ?? currentTabId, timeoutMs: step.timeoutMs, params: { ...params, tabId: step.tabId ?? currentTabId, timeoutMs: step.timeoutMs } };
}

function requiredTabId(step: BrowserStep, currentTabId: number | undefined): number {
  const tabId = step.tabId ?? currentTabId;
  if (!tabId) throw new Error('INVALID_PARAMS: activateTab 步骤需要 tabId');
  return tabId;
}

function extractTabId(data: unknown): number | undefined {
  if (isRecord(data) && typeof data.tabId === 'number') return data.tabId;
  if (isRecord(data) && typeof data.id === 'number') return data.id;
  return undefined;
}

function sanitizeStepData(action: BrowserStepAction, data: unknown): unknown {
  if ((action === 'screenshot' || action === 'screenObserve') && isRecord(data)) {
    return { tabId: data.tabId, url: data.url, title: data.title, mimeType: data.mimeType, dataUrlLength: typeof data.dataUrl === 'string' ? data.dataUrl.length : undefined, viewport: data.viewport, coordinateSystem: data.coordinateSystem, withGrid: data.withGrid, gridSize: data.gridSize };
  }
  if (action === 'pdf' && isRecord(data)) {
    return { tabId: data.tabId, url: data.url, title: data.title, mimeType: data.mimeType, dataLength: typeof data.data === 'string' ? data.data.length : undefined };
  }
  return data;
}

function makeStepError(index: number, action: BrowserStepAction, description: string | undefined, code: string, message: string, elapsedMs: number, tabId?: number, data?: unknown): BrowserStepResult {
  return { index, action, description, ok: false, elapsedMs, tabId, data, error: { code, message } };
}

async function takeErrorScreenshot(tabId?: number): Promise<unknown> {
  try {
    const id = tabId ?? (await TabsService.getActiveTab()).id;
    const tab = await chrome.tabs.get(id);
    return sanitizeStepData('screenshot', await ScreenshotService.captureScreenshot(tab, { id: crypto.randomUUID(), tool: 'browser_screenshot', tabId: id, params: { format: 'png' } }));
  } catch { return undefined; }
}

function normalizeError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(': ')) {
    const [code, detail] = message.split(/: (.*)/s, 2);
    return { code, message: detail || message };
  }
  return { code: 'INTERNAL_ERROR', message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

function numberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
