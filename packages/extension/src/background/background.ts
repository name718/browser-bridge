import {
  type BrowserTab,
  type BrowserRunStepsResult,
  type BrowserStep,
  type BrowserStepAction,
  type BrowserStepResult,
  type BridgeErrorCode,
  type BridgeRequest,
  type BridgeResponse
} from "@majuntao-1/browser-bridge-shared";
import { DEFAULT_BRIDGE_URL } from "../shared/config.js";
import {
  assertActionAllowed,
  assertUrlAllowed,
  getActionRisk,
  getSecurityConfig
} from "./security.js";
import { appendAuditLog, getAuditLog } from "./audit.js";

let connected = false;
let currentBridgeUrl = DEFAULT_BRIDGE_URL;
let lastBridgeError = "";
let offscreenCreation: Promise<void> | undefined;
let recordedSteps: any[] = [];
let isRecording = false;

void ensureOffscreenDocument();
setupKeepalive();

chrome.runtime.onStartup.addListener(() => {
  void ensureOffscreenDocument();
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureOffscreenDocument();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "popup_status") {
    void getPopupStatus().then(sendResponse);
    return true;
  }
  if (message?.type === "popup_save_bridge") {
    void setBridgeUrl(String(message.bridgeUrl ?? "")).then(() => {
      sendResponse({ ok: true, bridgeUrl: currentBridgeUrl });
    });
    return true;
  }
  if (message?.type === "offscreen_status") {
    connected = Boolean(message.connected);
    currentBridgeUrl = typeof message.bridgeUrl === "string" ? message.bridgeUrl : currentBridgeUrl;
    lastBridgeError = typeof message.lastError === "string" ? message.lastError : "";
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "offscreen_bridge_request") {
    void handleBridgeRequest(message.request as BridgeRequest).then(sendResponse);
    return true;
  }
  if (message?.type === "browser_bridge_cdp_input") {
    void handleCdpInput(message).then(sendResponse);
    return true;
  }
  if (message?.type === "popup_save_security") {
    void chrome.storage.local.set(message.security ?? {}).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message?.type === "popup_toggle_recording") {
    void toggleRecording({
      id: "popup",
      tool: "browser_toggle_recording",
      params: { enabled: message.enabled }
    }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "popup_clear_recording") {
    recordedSteps = [];
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "browser_bridge_record_step") {
    recordedSteps.push({ timestamp: Date.now(), ...message.step });
    if (recordedSteps.length > 100) recordedSteps.shift();
    return false;
  }
  return false;
});

async function handleBridgeRequest(request: BridgeRequest): Promise<BridgeResponse> {
  try {
    const data = await dispatchRequest(request);
    return { id: request.id, ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const [code, detail] = message.includes(": ")
      ? message.split(/: (.*)/s, 2)
      : ["INTERNAL_ERROR", message];
    return {
      id: request.id,
      ok: false,
      error: {
        code: code as BridgeErrorCode,
        message: detail || message
      }
    };
  }
}

async function dispatchRequest(request: BridgeRequest): Promise<unknown> {
  switch (request.tool) {
    case "browser_get_active_tab":
      return getActiveTab();
    case "browser_list_tabs":
      return listTabs();
    case "browser_open_url":
      return openUrl(String(request.params?.url ?? ""));
    case "browser_open_incognito":
      return openIncognito(String(request.params?.url ?? ""));
    case "browser_activate_tab":
      return activateTab(Number(request.params?.tabId));
    case "browser_get_page_text":
    case "browser_get_page_snapshot":
    case "browser_get_page_model":
    case "browser_get_interactives":
    case "browser_find":
    case "browser_act":
    case "browser_assert_text":
    case "browser_get_selected_text":
    case "browser_get_links":
      return sendToContentScript(request);
    case "browser_get_ax_tree":
      return getAXTree(request);
    case "browser_observe":
      return observePage(request);
    case "browser_mock_network":
      return mockNetwork(request);
    case "browser_wait_for_request":
      return waitForNetworkRequest(request);
    case "browser_console_monitor":
      return monitorConsole(request);
    case "browser_get_audit_log":
      return getAuditLog(typeof request.params?.limit === "number" ? request.params.limit : 20);
    case "browser_run_steps":
      return runSteps(request);
    case "browser_pdf":
      return capturePdf(request);
    case "browser_evaluate":
      return evaluateScript(request);
    case "browser_cdp":
      return executeCdp(request);
    case "browser_cdp_session":
      return executeCdpSession(request);
    case "browser_responsive":
      return captureResponsive(request);
    case "browser_network_analysis":
      return runNetworkAnalysis(request);
    case "browser_route":
      return browserRoute(request);
    case "browser_export_session":
      return exportSession(request);
    case "browser_import_session":
      return importSession(request);
    case "browser_close_tab":
      return closeTab(request);
    case "browser_new_tab":
      return newTab(request);
    case "browser_new_context":
      return newContext(request);
    case "browser_toggle_recording":
      return toggleRecording(request);
    case "browser_get_recorded_steps":
      return getRecordedSteps();
    case "browser_screenshot":
    case "browser_click":
    case "browser_find_and_click":
    case "browser_find_and_type":
    case "browser_fill_form":
    case "browser_hover":
    case "browser_press_key":
    case "browser_type":
    case "browser_clear":
    case "browser_scroll":
    case "browser_wait_for":
      return sendToContentScript(request);
    default:
      throw new Error(`INTERNAL_ERROR: 不支持的工具 ${request.tool}`);
  }
}

async function runSteps(request: BridgeRequest): Promise<BrowserRunStepsResult> {
  const params = isRecord(request.params) ? request.params : {};
  const steps = Array.isArray(params.steps) ? params.steps : undefined;
  if (!steps?.length) {
    throw new Error("INVALID_PARAMS: steps 参数必填");
  }
  if (steps.length > 50) {
    throw new Error("INVALID_PARAMS: steps 最多支持 50 步");
  }

  let currentTabId = request.tabId ?? numberParam(params, "tabId");
  const stopOnError = params.stopOnError !== false;
  const defaultDelayMs = numberParam(params, "delayMs") ?? 0;
  const screenshotOnError = params.screenshotOnError === true;
  const results: BrowserStepResult[] = [];

  for (const [index, rawStep] of steps.entries()) {
    if (!isRecord(rawStep)) {
      const result = makeStepError(index, "sleep", undefined, "INVALID_PARAMS", "步骤必须是对象", 0, currentTabId);
      results.push(result);
      if (stopOnError) {
        return { ok: false, stoppedAt: index, tabId: currentTabId, results };
      }
      continue;
    }

    const startedAt = Date.now();
    let action: BrowserStepAction = "sleep";
    const description = stringParam(rawStep, "description");
    try {
      action = parseStepAction(rawStep.action);
      const step = rawStep as BrowserStep;
      const data = await runStep(step, currentTabId);
      currentTabId = extractTabId(data) ?? numberParam(rawStep, "tabId") ?? currentTabId;
      results.push({
        index,
        action,
        description,
        ok: true,
        elapsedMs: Date.now() - startedAt,
        tabId: currentTabId,
        data: sanitizeStepData(action, data)
      });

      const delayMs = numberParam(rawStep, "delayMs") ?? defaultDelayMs;
      if (delayMs > 0) {
        await delay(delayMs);
      }
    } catch (error) {
      const { code, message } = normalizeError(error);
      const errorScreenshot = screenshotOnError
        ? await takeErrorScreenshot(currentTabId)
        : undefined;
      results.push(makeStepError(
        index,
        action,
        description,
        code,
        message,
        Date.now() - startedAt,
        currentTabId,
        errorScreenshot
      ));
      if (stopOnError) {
        return { ok: false, stoppedAt: index, tabId: currentTabId, results };
      }
    }
  }

  return { ok: results.every((result) => result.ok), tabId: currentTabId, results };
}

async function runStep(step: BrowserStep, currentTabId?: number): Promise<unknown> {
  switch (step.action) {
    case "open":
      if (!step.url) {
        throw new Error("INVALID_PARAMS: open 步骤需要 url");
      }
      return openUrl(step.url);
    case "activateTab":
      return activateTab(requiredTabId(step, currentTabId));
    case "click":
      return sendToContentScript(stepRequest("browser_find_and_click", step, currentTabId, targetParams(step)));
    case "hover":
      return sendToContentScript(stepRequest("browser_hover", step, currentTabId, targetParams(step)));
    case "type":
      return sendToContentScript(stepRequest("browser_find_and_type", step, currentTabId, {
        ...targetParams(step),
        text: step.value ?? step.text,
        replace: step.replace
      }));
    case "fillForm":
      return sendToContentScript(stepRequest("browser_fill_form", step, currentTabId, {
        fields: step.fields,
        timeoutMs: step.timeoutMs
      }));
    case "clear":
      return sendToContentScript(stepRequest("browser_clear", step, currentTabId, targetParams(step)));
    case "scroll":
      return sendToContentScript(stepRequest("browser_scroll", step, currentTabId, {
        direction: step.direction ?? "down",
        amount: step.amount
      }));
    case "waitFor":
      return sendToContentScript(stepRequest("browser_wait_for", step, currentTabId, targetParams(step)));
    case "pressKey":
      return sendToContentScript(stepRequest("browser_press_key", step, currentTabId, { key: step.key }));
    case "assertText":
      return sendToContentScript(stepRequest("browser_assert_text", step, currentTabId, {
        text: step.text,
        contains: step.contains
      }));
    case "getText":
      return sendToContentScript(stepRequest("browser_get_page_text", step, currentTabId, {}));
    case "pageModel":
      return sendToContentScript(stepRequest("browser_get_page_model", step, currentTabId, {
        visibleOnly: step.visibleOnly,
        viewportOnly: step.viewportOnly,
        maxTextLength: step.maxTextLength,
        maxElements: step.maxElements,
        maxHeadings: step.maxHeadings,
        maxRegions: step.maxRegions,
        maxTables: step.maxTables,
        maxTableRows: step.maxTableRows
      }));
    case "snapshot":
      return sendToContentScript(stepRequest("browser_get_page_snapshot", step, currentTabId, {}));
    case "screenshot":
      return sendToContentScript(stepRequest("browser_screenshot", step, currentTabId, {
        format: step.format,
        quality: step.quality
      }));
    case "pdf":
      return capturePdf({
        id: crypto.randomUUID(),
        tool: "browser_pdf",
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
    case "sleep":
      await delay(step.delayMs ?? step.timeoutMs ?? 500);
      return { slept: true };
    default:
      throw new Error(`INVALID_PARAMS: 不支持的步骤动作 ${(step as BrowserStep).action}`);
  }
}

async function getActiveTab(): Promise<BrowserTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("TAB_NOT_ACTIVE: 未找到活动标签页");
  }
  return normalizeTab(tab);
}

async function listTabs(): Promise<BrowserTab[]> {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => tab.id).map(normalizeTab);
}

async function openUrl(url: string): Promise<BrowserTab> {
  if (!url) {
    throw new Error("INVALID_PARAMS: url 参数必填");
  }
  await assertUrlAllowed(url);
  const tab = await chrome.tabs.create({ url, active: true });
  return normalizeTab(tab);
}

async function openIncognito(url: string): Promise<BrowserTab> {
  if (!url) {
    throw new Error("INVALID_PARAMS: url 参数必填");
  }

  const isAllowed = await chrome.extension.isAllowedIncognitoAccess();
  if (!isAllowed) {
    throw new Error("PERMISSION_DENIED: 插件未被允许访问隐身模式。请在 chrome://extensions 中开启“在隐身模式下启用”。");
  }

  await assertUrlAllowed(url);
  const window = await chrome.windows.create({ url, incognito: true });
  const tab = window.tabs?.[0];
  if (!tab || tab.id === undefined) {
    throw new Error("INTERNAL_ERROR: 无法创建隐身标签页");
  }
  return normalizeTab(tab);
}

async function activateTab(tabId: number): Promise<BrowserTab> {
  if (!Number.isFinite(tabId)) {
    throw new Error("INVALID_PARAMS: tabId 参数必填");
  }
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (!tab) {
    throw new Error("TAB_NOT_FOUND: 未找到标签页");
  }
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return normalizeTab(tab);
}

async function sendToContentScript(request: BridgeRequest): Promise<unknown> {
  const requestedTabId = request.tabId ?? Number(request.params?.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) {
    throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");
  }

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  const confirmedHighRisk = await confirmHighRiskAction(tabId, request);

  if (request.tool === "browser_screenshot") {
    return captureScreenshot(tab, request);
  }

  try {
    await ensureContentScript(tabId);
    
    // 如果是搜索/操作类工具，主 frame 找不到时尝试其他 frame
    const isSearchOrAct = [
      "browser_click", "browser_type", "browser_hover", "browser_find", 
      "browser_act", "browser_find_and_click", "browser_find_and_type", "browser_clear"
    ].includes(request.tool);

    if (isSearchOrAct) {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      if (frames && frames.length > 1) {
        for (const frame of frames) {
          try {
            const response = await chrome.tabs.sendMessage(tabId, {
              type: "browser_bridge_request",
              request: {
                ...request,
                tabId,
                params: {
                  ...(isRecord(request.params) ? request.params : {}),
                  __confirmedHighRisk: confirmedHighRisk
                }
              }
            }, { frameId: frame.frameId });

            if (response?.ok) {
              await appendAuditLog({ tool: request.tool, url: tab.url, ok: true });
              return response.data;
            }
          } catch {
            continue; 
          }
        }
        throw new Error("ELEMENT_NOT_FOUND: 在所有 Frame 中均未找到目标元素");
      }
    }

    const response = await chrome.tabs.sendMessage(tabId, {
      type: "browser_bridge_request",
      request: {
        ...request,
        tabId,
        params: {
          ...(isRecord(request.params) ? request.params : {}),
          __confirmedHighRisk: confirmedHighRisk
        }
      }
    }, { frameId: 0 });

    if (!response?.ok) {
      const code = response?.error?.code ?? "INTERNAL_ERROR";
      const message = response?.error?.message ?? "页面脚本请求失败";
      throw new Error(`${code}: ${message}`);
    }

    await appendAuditLog({ tool: request.tool, url: tab.url, ok: true });

    if (response.data && typeof response.data === "object" && "tabId" in response.data) {
      return { ...response.data, tabId };
    }

    return response.data;
  } catch (error) {
    if (error instanceof Error && !error.message.includes(": 页面脚本请求失败")) {
      await appendAuditLog({
        tool: request.tool,
        url: tab.url,
        ok: false,
        errorCode: error.message.split(":", 1)[0]
      });
    }
    throw error;
  }
}

async function confirmHighRiskAction(tabId: number, request: BridgeRequest): Promise<boolean> {
  try {
    await assertActionAllowed(request);
    return false;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("USER_CONFIRMATION_REQUIRED:")) {
      throw error;
    }
  }

  const risk = await getActionRisk(request);
  const confirmed = await confirmInPage(tabId, risk.reason ?? "高风险浏览器操作需要确认");
  if (!confirmed) {
    throw new Error("USER_REJECTED: 用户已取消高风险浏览器操作");
  }
  return true;
}

async function confirmInPage(tabId: number, reason: string): Promise<boolean> {
  await ensureContentScript(tabId);
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "browser_bridge_confirm",
    reason
  });
  return Boolean(response?.confirmed);
}

async function captureScreenshot(
  tab: chrome.tabs.Tab,
  request: BridgeRequest
): Promise<Record<string, unknown>> {
  if (!tab.id) {
    throw new Error("TAB_NOT_FOUND: 标签页没有 ID");
  }

  const params = isRecord(request.params) ? request.params : {};
  const requestedFormat = params.format === "jpeg" ? "jpeg" : "png";
  const quality = typeof params.quality === "number" ? params.quality : undefined;
  const overlay = params.overlay === true;

  if (overlay) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "browser_bridge_draw_overlay" });
      await delay(100); // Wait for overlay to render
    } catch { /* ignore */ }
  }

  try {
    if (params.mode === "cdp" || typeof params.scale === "number") {
      return await captureCdpScreenshot(tab, request);
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
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      mimeType: requestedFormat === "jpeg" ? "image/jpeg" : "image/png",
      dataUrl
    };
  } finally {
    if (overlay) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "browser_bridge_remove_overlay" });
      } catch { /* ignore */ }
    }
  }
}

async function captureCdpScreenshot(
  tab: chrome.tabs.Tab,
  request: BridgeRequest
): Promise<Record<string, unknown>> {
  if (!tab.id) {
    throw new Error("TAB_NOT_FOUND: 标签页没有 ID");
  }

  if (!tab.url || /^(chrome|chrome-extension|about|edge|brave):/.test(tab.url)) {
    throw new Error("UNSUPPORTED_PAGE: 当前页面不支持高保真截图");
  }

  const params = isRecord(request.params) ? request.params : {};
  const requestedFormat = params.format === "jpeg" ? "jpeg" : "png";
  const quality = typeof params.quality === "number" ? params.quality : undefined;
  const scale = typeof params.scale === "number" ? Math.min(Math.max(params.scale, 0.1), 4) : undefined;
  const debuggee = { tabId: tab.id };

  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  try {
    chrome.debugger.attach(debuggee, "1.3");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Another debugger") || message.includes("already attached")) {
      throw new Error("DEBUGGER_BUSY: 目标标签页已有 DevTools 打开，请关闭后重试");
    }
    throw new Error(`INTERNAL_ERROR: 附加调试器失败: ${message}`);
  }

  try {
    const captureParams: Record<string, unknown> = {
      format: requestedFormat,
      fromSurface: true,
      captureBeyondViewport: false
    };
    if (requestedFormat === "jpeg" && typeof quality === "number") {
      captureParams.quality = quality;
    }

    if (scale) {
      const metrics = await sendDebuggerCommand(tab.id, "Page.getLayoutMetrics");
      const cssVisualViewport = isRecord(metrics) && isRecord(metrics.cssVisualViewport)
        ? metrics.cssVisualViewport
        : undefined;
      const width = getPositiveNumber(cssVisualViewport?.clientWidth);
      const height = getPositiveNumber(cssVisualViewport?.clientHeight);

      if (width && height) {
        captureParams.clip = {
          x: 0,
          y: 0,
          width,
          height,
          scale: scale ?? 1
        };
      }
    }

    const result = await sendDebuggerCommand(tab.id, "Page.captureScreenshot", captureParams);
    const data = isRecord(result) ? result.data : undefined;
    if (typeof data !== "string") {
      throw new Error("INTERNAL_ERROR: 截图返回数据无效");
    }

    await appendAuditLog({ tool: request.tool, url: tab.url, ok: true });

    return {
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      mimeType: requestedFormat === "jpeg" ? "image/jpeg" : "image/png",
      dataUrl: `data:${requestedFormat === "jpeg" ? "image/jpeg" : "image/png"};base64,${data}`,
      mode: "cdp",
      scale: scale ?? 1
    };
  } catch (error) {
    await appendAuditLog({
      tool: request.tool,
      url: tab.url,
      ok: false,
      errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "INTERNAL_ERROR"
    });
    throw error;
  } finally {
    try {
      chrome.debugger.detach(debuggee);
    } catch {
      // ignore detach errors
    }
  }
}

async function capturePdf(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) {
    throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");
  }

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  if (!tab.url || /^(chrome|chrome-extension|about|edge|brave):/.test(tab.url)) {
    throw new Error("UNSUPPORTED_PAGE: 当前页面不支持导出 PDF");
  }

  const debuggee = { tabId };

  try {
    chrome.debugger.attach(debuggee, "1.3");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Another debugger") || message.includes("already attached")) {
      throw new Error("DEBUGGER_BUSY: 目标标签页已有 DevTools 打开，请关闭后重试");
    }
    throw new Error(`INTERNAL_ERROR: 附加调试器失败: ${message}`);
  }

  try {
    const printOptions: Record<string, unknown> = {
      printBackground: params.printBackground !== false,
      preferCSSPageSize: params.preferCSSPageSize === true
    };
    if (params.landscape === true) printOptions.landscape = true;
    if (typeof params.scale === "number") printOptions.scale = params.scale;
    if (typeof params.paperWidth === "number") printOptions.paperWidth = params.paperWidth;
    if (typeof params.paperHeight === "number") printOptions.paperHeight = params.paperHeight;
    if (typeof params.marginTop === "number") printOptions.marginTop = params.marginTop;
    if (typeof params.marginBottom === "number") printOptions.marginBottom = params.marginBottom;
    if (typeof params.marginLeft === "number") printOptions.marginLeft = params.marginLeft;
    if (typeof params.marginRight === "number") printOptions.marginRight = params.marginRight;
    if (typeof params.pageRanges === "string" && params.pageRanges) printOptions.pageRanges = params.pageRanges;

    const result = await sendDebuggerCommand(tabId, "Page.printToPDF", printOptions);
    const data = (result as Record<string, unknown>)?.data;

    if (typeof data !== "string") {
      throw new Error("INTERNAL_ERROR: PDF 生成返回数据无效");
    }

    await appendAuditLog({ tool: "browser_pdf", url: tab.url, ok: true });

    return {
      tabId,
      url: tab.url,
      title: tab.title,
      mimeType: "application/pdf",
      data
    };
  } catch (error) {
    await appendAuditLog({
      tool: "browser_pdf",
      url: tab.url,
      ok: false,
      errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "INTERNAL_ERROR"
    });
    throw error;
  } finally {
    try {
      chrome.debugger.detach(debuggee);
    } catch {
      // ignore detach errors
    }
  }
}

function sendDebuggerCommand(
  tabId: number,
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`INTERNAL_ERROR: ${chrome.runtime.lastError.message}`));
      } else {
        resolve(result);
      }
    });
  });
}

async function evaluateScript(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const expression = typeof params.expression === "string" ? params.expression : "";
  if (!expression.trim()) {
    throw new Error("INVALID_PARAMS: expression 参数必填");
  }

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  const frameId = typeof params.frameId === "number" ? params.frameId : undefined;
  if (!tabId) {
    throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");
  }

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  if (!tab.url || /^(chrome|chrome-extension|about|edge|brave):/.test(tab.url)) {
    throw new Error("UNSUPPORTED_PAGE: 当前页面不支持执行脚本");
  }

  try {
    const target: chrome.scripting.InjectionTarget = { tabId };
    if (frameId !== undefined) {
      target.frameIds = [frameId];
    }

    const results = await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      func: (expr: string) => {
        try {
          // eslint-disable-next-line no-eval
          const result = eval(expr);
          if (result === undefined) return { value: null, type: "undefined" };
          if (result === null) return { value: null, type: "null" };
          if (typeof result === "function") return { value: result.toString(), type: "function" };
          if (typeof result === "object" || typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
            try {
              return { value: JSON.parse(JSON.stringify(result)), type: typeof result };
            } catch {
              return { value: String(result), type: typeof result };
            }
          }
          return { value: String(result), type: typeof result };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error), type: "error" };
        }
      },
      args: [expression]
    });

    const result = results?.[0]?.result;
    await appendAuditLog({ tool: "browser_evaluate", url: tab.url, ok: !result?.error });

    return {
      tabId,
      url: tab.url,
      title: tab.title,
      expression,
      result
    };
  } catch (error) {
    await appendAuditLog({
      tool: "browser_evaluate",
      url: tab.url,
      ok: false,
      errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "INTERNAL_ERROR"
    });
    throw error;
  }
}

async function getAXTree(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  const debuggee = { tabId };
  try {
    await chrome.debugger.attach(debuggee, "1.3");
    const result = await chrome.debugger.sendCommand(debuggee, "Accessibility.getFullAXTree", {});
    await appendAuditLog({ tool: "browser_get_ax_tree", url: tab.url, ok: true });
    return { tabId, url: tab.url, title: tab.title, axTree: result };
  } catch (error) {
    await appendAuditLog({
      tool: "browser_get_ax_tree",
      url: tab.url,
      ok: false,
      errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "INTERNAL_ERROR"
    });
    throw error;
  } finally {
    try {
      chrome.debugger.detach(debuggee);
    } catch {
      /* ignore */
    }
  }
}

async function observePage(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  const debuggee = { tabId };
  try {
    await chrome.debugger.attach(debuggee, "1.3");
    const result = (await chrome.debugger.sendCommand(debuggee, "Accessibility.getFullAXTree", {})) as { nodes: any[] };
    const simplified = simplifyAXTree(result.nodes);
    await appendAuditLog({ tool: "browser_observe", url: tab.url, ok: true });
    return {
      tabId,
      url: tab.url,
      title: tab.title,
      axTree: simplified
    };
  } catch (error) {
    await appendAuditLog({
      tool: "browser_observe",
      url: tab.url,
      ok: false,
      errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "INTERNAL_ERROR"
    });
    throw error;
  } finally {
    try {
      chrome.debugger.detach(debuggee);
    } catch {
      /* ignore */
    }
  }
}

function simplifyAXTree(nodes: any[]): string {
  if (!nodes || nodes.length === 0) return "";
  const nodeMap = new Map();
  nodes.forEach((n) => nodeMap.set(n.nodeId, n));

  function processNode(nodeId: string, depth: number = 0): string {
    const node = nodeMap.get(nodeId);
    if (!node || node.ignored) return "";

    const role = node.role?.value || "unknown";
    const name = node.name?.value || "";
    const value = node.value?.value || "";
    const description = node.description?.value || "";
    
    // 更激进的过滤：忽略无意义的容器且无实质内容
    const isGeneric = [
      "GenericContainer", "Box", "Section", "WebArea", "RootWebArea", 
      "none", "presentation", "group", "StaticText"
    ].includes(role);
    
    if (isGeneric && !name && !value && !description) {
      let childrenOutput = "";
      if (node.childIds) {
        for (const childId of node.childIds) {
          childrenOutput += processNode(childId, depth); // 不增加深度，拉平层级
        }
      }
      return childrenOutput;
    }

    const indent = "  ".repeat(depth);
    let line = `${indent}${role}`;
    if (name) line += ` "${name}"`;
    if (value) line += ` val="${value}"`;
    if (description) line += ` desc="${description}"`;
    line += ` [${nodeId}]\n`;

    let children = "";
    if (node.childIds) {
      for (const childId of node.childIds) {
        children += processNode(childId, depth + 1);
      }
    }

    return line + children;
  }

  return processNode(nodes[0].nodeId);
}

async function waitForNetworkRequest(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const urlPattern = typeof params.urlPattern === "string" ? params.urlPattern : "";
  if (!urlPattern) throw new Error("INVALID_PARAMS: urlPattern 参数必填");

  const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : 10000;
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.webRequest.onCompleted.removeListener(listener);
      reject(new Error(`ACTION_TIMEOUT: 在 ${timeoutMs}ms 内未检测到符合模式 ${urlPattern} 的请求`));
    }, timeoutMs);

    const listener = (details: chrome.webRequest.WebResponseCacheDetails) => {
      if (details.tabId === tabId && details.url.includes(urlPattern)) {
        clearTimeout(timeout);
        chrome.webRequest.onCompleted.removeListener(listener);
        resolve({
          ok: true,
          url: details.url,
          method: details.method,
          statusCode: details.statusCode,
          timeStamp: details.timeStamp
        });
      }
    };

    chrome.webRequest.onCompleted.addListener(listener, { urls: ["<all_urls>"], tabId });
  });
}

async function monitorConsole(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const durationMs = typeof params.durationMs === "number" ? Math.max(params.durationMs, 100) : 5000;
  
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  const debuggee = { tabId };
  const logs: any[] = [];

  const onEvent = (source: chrome.debugger.Debuggee, method: string, params: any) => {
    if (source.tabId !== tabId) return;
    
    if (method === "Runtime.consoleAPICalled") {
      logs.push({
        type: params.type,
        timestamp: Date.now(),
        args: params.args.map((a: any) => a.value || a.description || "[complex object]"),
        stackTrace: params.stackTrace
      });
    } else if (method === "Runtime.exceptionThrown") {
      logs.push({
        type: "error",
        timestamp: params.timestamp,
        text: params.exceptionDetails.text,
        exception: params.exceptionDetails.exception?.description || params.exceptionDetails.text,
        stackTrace: params.exceptionDetails.stackTrace
      });
    }
  };

  try {
    await chrome.debugger.attach(debuggee, "1.3");
    chrome.debugger.onEvent.addListener(onEvent);
    await chrome.debugger.sendCommand(debuggee, "Runtime.enable", {});

    await delay(durationMs);

    await appendAuditLog({ tool: "browser_console_monitor", url: tab.url, ok: true });
    return {
      tabId,
      url: tab.url,
      title: tab.title,
      durationMs,
      logs
    };
  } catch (error) {
    await appendAuditLog({
      tool: "browser_console_monitor",
      url: tab.url,
      ok: false,
      errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "INTERNAL_ERROR"
    });
    throw error;
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    try {
      await chrome.debugger.detach(debuggee);
    } catch {
      /* ignore */
    }
  }
}

async function mockNetwork(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const urlPattern = typeof params.urlPattern === "string" ? params.urlPattern : "";
  if (!urlPattern) throw new Error("INVALID_PARAMS: urlPattern 参数必填");

  const responseCode = typeof params.responseCode === "number" ? params.responseCode : 200;
  const responseBody = typeof params.responseBody === "string" ? params.responseBody : "";
  const contentType = typeof params.contentType === "string" ? params.contentType : "application/json";
  const durationMs = typeof params.durationMs === "number" ? Math.max(params.durationMs, 100) : 10000;

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  const debuggee = { tabId };

  const onEvent = async (source: chrome.debugger.Debuggee, method: string, params: any) => {
    if (source.tabId !== tabId) return;
    if (method === "Fetch.requestPaused") {
      const { requestId, request: interceptedRequest } = params;
      if (interceptedRequest.url.includes(urlPattern)) {
        await chrome.debugger.sendCommand(debuggee, "Fetch.fulfillRequest", {
          requestId,
          responseCode,
          responseHeaders: [
            { name: "Content-Type", value: contentType },
            { name: "Access-Control-Allow-Origin", value: "*" }
          ],
          body: stringToBase64(responseBody)
        });
      } else {
        await chrome.debugger.sendCommand(debuggee, "Fetch.continueRequest", { requestId });
      }
    }
  };

  try {
    await chrome.debugger.attach(debuggee, "1.3");
    chrome.debugger.onEvent.addListener(onEvent);
    await chrome.debugger.sendCommand(debuggee, "Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }]
    });

    await delay(durationMs);

    await appendAuditLog({ tool: "browser_mock_network", url: tab.url, ok: true });
    return { ok: true, urlPattern, durationMs };
  } catch (error) {
    await appendAuditLog({
      tool: "browser_mock_network",
      url: tab.url,
      ok: false,
      errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "INTERNAL_ERROR"
    });
    throw error;
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    try {
      await chrome.debugger.sendCommand(debuggee, "Fetch.disable", {});
      await chrome.debugger.detach(debuggee);
    } catch {
      /* ignore */
    }
  }
}

function stringToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function executeCdp(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const method = typeof params.method === "string" ? params.method : "";
  if (!method.includes(".")) {
    throw new Error("INVALID_PARAMS: method 必须是 'Domain.method' 格式");
  }

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) {
    throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");
  }

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  if (!tab.url || /^(chrome|chrome-extension|about|edge|brave):/.test(tab.url)) {
    throw new Error("UNSUPPORTED_PAGE: 当前页面不支持 CDP 操作");
  }

  const debuggee = { tabId };

  try {
    chrome.debugger.attach(debuggee, "1.3");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Another debugger") || message.includes("already attached")) {
      throw new Error("DEBUGGER_BUSY: 目标标签页已有 DevTools 打开，请关闭后重试");
    }
    throw new Error(`INTERNAL_ERROR: 附加调试器失败: ${message}`);
  }

  try {
    const cdpParams = isRecord(params.params) ? params.params : undefined;
    const result = await sendDebuggerCommand(tabId, method, cdpParams);
    await appendAuditLog({ tool: "browser_cdp", url: tab.url, ok: true });
    return { tabId, url: tab.url, title: tab.title, method, result };
  } catch (error) {
    await appendAuditLog({
      tool: "browser_cdp",
      url: tab.url,
      ok: false,
      errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "INTERNAL_ERROR"
    });
    throw error;
  } finally {
    try { chrome.debugger.detach(debuggee); } catch { /* ignore */ }
  }
}

async function executeCdpSession(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const enableDomains = Array.isArray(params.enable) ? params.enable.filter((d): d is string => typeof d === "string") : [];
  if (enableDomains.length === 0) {
    throw new Error("INVALID_PARAMS: enable 参数必填，至少一个 CDP 域名");
  }

  const durationMs = typeof params.durationMs === "number" ? Math.max(params.durationMs, 100) : 3000;

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) {
    throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");
  }

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  if (!tab.url || /^(chrome|chrome-extension|about|edge|brave):/.test(tab.url)) {
    throw new Error("UNSUPPORTED_PAGE: 当前页面不支持 CDP 操作");
  }

  const debuggee = { tabId };

  try {
    chrome.debugger.attach(debuggee, "1.3");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Another debugger") || message.includes("already attached")) {
      throw new Error("DEBUGGER_BUSY: 目标标签页已有 DevTools 打开，请关闭后重试");
    }
    throw new Error(`INTERNAL_ERROR: 附加调试器失败: ${message}`);
  }

  const events: Array<{ method: string; params: Record<string, unknown> }> = [];
  const listener = (source: chrome.debugger.Debuggee, method: string, eventParams?: unknown) => {
    if (source.tabId === tabId) {
      events.push({ method, params: (eventParams && typeof eventParams === "object" ? eventParams as Record<string, unknown> : {}) });
    }
  };

  chrome.debugger.onEvent.addListener(listener);

  try {
    for (const domain of enableDomains) {
      try {
        await sendDebuggerCommand(tabId, `${domain}.enable`);
      } catch {
        // some domains may not support .enable, ignore
      }
    }

    await delay(durationMs);

    await appendAuditLog({ tool: "browser_cdp_session", url: tab.url, ok: true });

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
      tool: "browser_cdp_session",
      url: tab.url,
      ok: false,
      errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "INTERNAL_ERROR"
    });
    throw error;
  } finally {
    chrome.debugger.onEvent.removeListener(listener);
    try { chrome.debugger.detach(debuggee); } catch { /* ignore */ }
  }
}

async function captureResponsive(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const rawViewports = Array.isArray(params.viewports) ? params.viewports : [];
  const viewports: Array<{ name: string; width: number; height: number }> = rawViewports
    .filter((v): v is Record<string, unknown> => isRecord(v))
    .map((v) => ({
      name: typeof v.name === "string" ? v.name : `${v.width}x${v.height}`,
      width: typeof v.width === "number" ? v.width : 1920,
      height: typeof v.height === "number" ? v.height : 1080
    }));

  if (viewports.length === 0) {
    viewports.push(
      { name: "Desktop", width: 1920, height: 1080 },
      { name: "Tablet", width: 768, height: 1024 },
      { name: "Mobile", width: 375, height: 812 }
    );
  }

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) {
    throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");
  }

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  if (params.url && typeof params.url === "string" && params.url !== tab.url) {
    await chrome.tabs.update(tabId, { url: params.url });
    await delay(2000);
  }

  const debuggee = { tabId };
  try {
    chrome.debugger.attach(debuggee, "1.3");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Another debugger") || message.includes("already attached")) {
      throw new Error("DEBUGGER_BUSY: 目标标签页已有 DevTools 打开，请关闭后重试");
    }
    throw new Error(`INTERNAL_ERROR: 附加调试器失败: ${message}`);
  }

  const screenshots: Array<Record<string, unknown>> = [];

  try {
    for (const vp of viewports) {
      await sendDebuggerCommand(tabId, "Emulation.setDeviceMetricsOverride", {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.width < 768
      });
      await delay(500);

      const screenshot = await captureScreenshot(tab, {
        id: crypto.randomUUID(),
        tool: "browser_screenshot",
        tabId,
        params: { format: "png" }
      });

      screenshots.push({
        name: vp.name,
        width: vp.width,
        height: vp.height,
        mimeType: screenshot.mimeType,
        dataUrl: screenshot.dataUrl
      });
    }

    // Reset
    await sendDebuggerCommand(tabId, "Emulation.clearDeviceMetricsOverride");

    await appendAuditLog({ tool: "browser_responsive", url: tab.url, ok: true });

    return { tabId, url: tab.url, title: tab.title, viewports: viewports.length, screenshots };
  } catch (error) {
    await appendAuditLog({
      tool: "browser_responsive",
      url: tab.url,
      ok: false,
      errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "INTERNAL_ERROR"
    });
    throw error;
  } finally {
    try { chrome.debugger.detach(debuggee); } catch { /* ignore */ }
  }
}

async function runNetworkAnalysis(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const durationMs = typeof params.durationMs === "number" ? Math.max(params.durationMs, 100) : 5000;
  const slowThresholdMs = typeof params.slowThresholdMs === "number" ? params.slowThresholdMs : 1000;

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) {
    throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");
  }

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  if (params.url && typeof params.url === "string" && params.url !== tab.url) {
    await chrome.tabs.update(tabId, { url: params.url });
    await delay(1000);
  }

  const debuggee = { tabId };
  try {
    chrome.debugger.attach(debuggee, "1.3");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Another debugger") || message.includes("already attached")) {
      throw new Error("DEBUGGER_BUSY: 目标标签页已有 DevTools 打开，请关闭后重试");
    }
    throw new Error(`INTERNAL_ERROR: 附加调试器失败: ${message}`);
  }

  const requests: Map<string, Record<string, unknown>> = new Map();
  const responses: Map<string, Record<string, unknown>> = new Map();

  const listener = (source: chrome.debugger.Debuggee, method: string, eventParams?: unknown) => {
    if (source.tabId !== tabId) return;
    const p = eventParams && typeof eventParams === "object" ? eventParams as Record<string, unknown> : {};
    const requestId = typeof p.requestId === "string" ? p.requestId : undefined;
    if (!requestId) return;

    if (method === "Network.requestWillBeSent") {
      const req = isRecord(p.request) ? p.request : {};
      requests.set(requestId, {
        url: typeof req.url === "string" ? req.url : "",
        method: typeof req.method === "string" ? req.method : "GET",
        type: typeof p.type === "string" ? p.type : "Other",
        timestamp: typeof p.timestamp === "number" ? p.timestamp : 0
      });
    } else if (method === "Network.responseReceived") {
      const resp = isRecord(p.response) ? p.response : {};
      responses.set(requestId, {
        status: typeof resp.status === "number" ? resp.status : 0,
        mimeType: typeof resp.mimeType === "string" ? resp.mimeType : "",
        encodedDataLength: typeof resp.encodedDataLength === "number" ? resp.encodedDataLength : 0,
        timing: isRecord(resp.timing) ? resp.timing : {}
      });
    }
  };

  chrome.debugger.onEvent.addListener(listener);

  try {
    await sendDebuggerCommand(tabId, "Network.enable");
    await delay(durationMs);

    // Build analysis
    const allRequests: Array<Record<string, unknown>> = [];
    let totalTransferSize = 0;
    let slowCount = 0;
    const byType: Record<string, number> = {};

    for (const [id, req] of requests) {
      const resp = responses.get(id);
      const duration = resp && isRecord(resp.timing)
        ? (typeof resp.timing.responseTime === "number" && typeof req.timestamp === "number"
          ? (resp.timing.responseTime as number) * 1000 - (req.timestamp as number) * 1000
          : 0)
        : 0;

      const transferSize = resp ? (resp.encodedDataLength as number) || 0 : 0;
      totalTransferSize += transferSize;

      const type = (req.type as string) || "Other";
      byType[type] = (byType[type] || 0) + 1;

      const isSlow = duration > slowThresholdMs;
      if (isSlow) slowCount++;

      allRequests.push({
        url: (req.url as string).substring(0, 120),
        method: req.method,
        type,
        status: resp?.status ?? "pending",
        durationMs: Math.round(duration),
        sizeKB: Math.round(transferSize / 1024),
        slow: isSlow
      });
    }

    const slowRequests = allRequests
      .filter((r) => r.slow)
      .sort((a, b) => (b.durationMs as number) - (a.durationMs as number));

    await appendAuditLog({ tool: "browser_network_analysis", url: tab.url, ok: true });

    return {
      tabId,
      url: tab.url,
      title: tab.title,
      durationMs,
      summary: {
        totalRequests: allRequests.length,
        slowRequests: slowCount,
        totalTransferKB: Math.round(totalTransferSize / 1024),
        byType
      },
      slowRequests,
      allRequests: allRequests.sort((a, b) => (b.durationMs as number) - (a.durationMs as number)).slice(0, 50)
    };
  } catch (error) {
    await appendAuditLog({
      tool: "browser_network_analysis",
      url: tab.url,
      ok: false,
      errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "INTERNAL_ERROR"
    });
    throw error;
  } finally {
    chrome.debugger.onEvent.removeListener(listener);
    try { chrome.debugger.detach(debuggee); } catch { /* ignore */ }
  }
}

async function browserRoute(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const urlPattern = typeof params.urlPattern === "string" ? params.urlPattern : "";
  if (!urlPattern) throw new Error("INVALID_PARAMS: urlPattern 参数必填");

  const responseCode = typeof params.responseCode === "number" ? params.responseCode : 200;
  const responseBody = typeof params.responseBody === "string" ? params.responseBody : "";
  const contentType = typeof params.contentType === "string" ? params.contentType : "application/json";
  const headers = isRecord(params.headers) ? params.headers : {};
  const durationMs = typeof params.durationMs === "number" ? Math.max(params.durationMs, 100) : 10000;

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");

  const tab = await chrome.tabs.get(tabId);
  await assertUrlAllowed(tab.url);

  const debuggee = { tabId };

  const onEvent = async (source: chrome.debugger.Debuggee, method: string, eventParams: any) => {
    if (source.tabId !== tabId) return;
    if (method === "Fetch.requestPaused") {
      const { requestId, request: interceptedRequest } = eventParams;
      if (interceptedRequest.url.includes(urlPattern)) {
        const responseHeaders = Object.entries(headers).map(([name, value]) => ({
          name,
          value: String(value)
        }));
        
        // Add Content-Type if not present
        if (!responseHeaders.find(h => h.name.toLowerCase() === "content-type")) {
          responseHeaders.push({ name: "Content-Type", value: contentType });
        }

        await chrome.debugger.sendCommand(debuggee, "Fetch.fulfillRequest", {
          requestId,
          responseCode,
          responseHeaders,
          body: stringToBase64(responseBody)
        });
      } else {
        await chrome.debugger.sendCommand(debuggee, "Fetch.continueRequest", { requestId });
      }
    }
  };

  try {
    await chrome.debugger.attach(debuggee, "1.3");
    chrome.debugger.onEvent.addListener(onEvent);
    await chrome.debugger.sendCommand(debuggee, "Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }]
    });

    await delay(durationMs);

    await appendAuditLog({ tool: "browser_route", url: tab.url, ok: true });
    return { ok: true, urlPattern, durationMs };
  } catch (error) {
    await appendAuditLog({
      tool: "browser_route",
      url: tab.url,
      ok: false,
      errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "INTERNAL_ERROR"
    });
    throw error;
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    try {
      await chrome.debugger.sendCommand(debuggee, "Fetch.disable", {});
      await chrome.debugger.detach(debuggee);
    } catch { /* ignore */ }
  }
}

async function exportSession(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");

  const tab = await chrome.tabs.get(tabId);
  const url = new URL(tab.url || "");
  const domain = params.domain && typeof params.domain === "string" ? params.domain : url.hostname;

  // Get Cookies
  const cookies = await chrome.cookies.getAll({ domain });

  // Get LocalStorage
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

  await appendAuditLog({ tool: "browser_export_session", url: tab.url, ok: true });

  return {
    domain,
    sessionData: btoa(unescape(encodeURIComponent(sessionData)))
  };
}

async function importSession(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const sessionDataRaw = typeof params.sessionData === "string" ? params.sessionData : "";
  if (!sessionDataRaw) throw new Error("INVALID_PARAMS: sessionData 参数必填");

  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");

  const tab = await chrome.tabs.get(tabId);
  const sessionData = JSON.parse(decodeURIComponent(escape(atob(sessionDataRaw))));

  // Restore Cookies
  if (Array.isArray(sessionData.cookies)) {
    for (const cookie of sessionData.cookies) {
      const { hostOnly, session, ...cookieDetails } = cookie;
      const protocol = cookie.secure ? "https:" : "http:";
      const cookieUrl = `${protocol}//${cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain}${cookie.path}`;
      await chrome.cookies.set({
        ...cookieDetails,
        url: cookieUrl
      });
    }
  }

  // Restore LocalStorage
  if (sessionData.localStorage && typeof sessionData.localStorage === "object") {
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

  await appendAuditLog({ tool: "browser_import_session", url: tab.url, ok: true });

  return { ok: true, domain: sessionData.domain };
}

async function closeTab(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  const requestedTabId = request.tabId ?? Number(params.tabId);
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) throw new Error("TAB_NOT_FOUND: 缺少标签页 ID");

  await chrome.tabs.remove(tabId);
  await appendAuditLog({ tool: "browser_close_tab", ok: true });
  return { ok: true, tabId };
}

async function newTab(request: BridgeRequest): Promise<BrowserTab> {
  const params = isRecord(request.params) ? request.params : {};
  const url = typeof params.url === "string" ? params.url : undefined;
  if (url) await assertUrlAllowed(url);
  
  const tab = await chrome.tabs.create({ url, active: true });
  await appendAuditLog({ tool: "browser_new_tab", url: tab.url, ok: true });
  return normalizeTab(tab);
}

async function newContext(request: BridgeRequest): Promise<BrowserTab> {
  const params = isRecord(request.params) ? request.params : {};
  const url = typeof params.url === "string" ? params.url : undefined;
  if (url) {
    await assertUrlAllowed(url);
  }

  const isAllowed = await chrome.extension.isAllowedIncognitoAccess();
  if (!isAllowed) {
    throw new Error("PERMISSION_DENIED: 插件未被允许访问隐身模式。请在扩展程序页面开启“在隐身模式下启用”。");
  }

  const window = await chrome.windows.create({ url: url ?? "about:blank", incognito: true });
  const tab = window.tabs?.[0];
  if (!tab) throw new Error("INTERNAL_ERROR: 无法创建隐身窗口");
  
  await appendAuditLog({ tool: "browser_new_context", url: tab.url, ok: true });
  return normalizeTab(tab);
}

async function toggleRecording(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = isRecord(request.params) ? request.params : {};
  isRecording = Boolean(params.enabled);
  if (!isRecording) {
    // Clear recorded steps when stopping? Or keep them? Let's keep for now.
  } else {
    recordedSteps = []; // Clear on start
  }

  // Notify all tabs
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: "browser_bridge_toggle_recording",
          enabled: isRecording
        }, { frameId: 0 }); // Usually enough to trigger in content script
      } catch { /* ignore inactive tabs */ }
    }
  }

  await appendAuditLog({ tool: "browser_toggle_recording", ok: true });
  return { ok: true, isRecording };
}

async function getRecordedSteps(): Promise<Record<string, unknown>> {
  const steps = [...recordedSteps];
  // Optional: auto-stop after reading? No.
  await appendAuditLog({ tool: "browser_get_recorded_steps", ok: true });
  return { steps, count: steps.length };
}

async function handleCdpInput(message: any): Promise<any> {
  const { action, params, tabId: requestedTabId } = message;
  const tabId = requestedTabId || (await getActiveTab()).id;
  if (!tabId) return { ok: false, error: "TAB_NOT_FOUND" };
  
  const debuggee = { tabId };

  try {
    await chrome.debugger.attach(debuggee, "1.3");
    
    if (action === "click") {
      const { x, y } = params;
      // Simulate a full click sequence
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: Math.round(x),
        y: Math.round(y),
        button: "left",
        clickCount: 1
      });
      await delay(50);
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: Math.round(x),
        y: Math.round(y),
        button: "left",
        clickCount: 1
      });
    } else if (action === "type") {
      const { text } = params;
      for (const char of text) {
        await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", {
          type: "keyDown",
          text: char,
          unmodifiedText: char
        });
        await delay(20);
        await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", {
          type: "keyUp",
          text: char,
          unmodifiedText: char
        });
      }
    }
    
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Another debugger") || message.includes("already attached")) {
      return { ok: false, error: "DEBUGGER_BUSY: 目标标签页已有 DevTools 打开" };
    }
    return { ok: false, error: message };
  } finally {
    try {
      await chrome.debugger.detach(debuggee);
    } catch { /* ignore */ }
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "browser_bridge_ping" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"]
    });
  }
}

function normalizeTab(tab: chrome.tabs.Tab): BrowserTab {
  if (!tab.id) {
    throw new Error("TAB_NOT_FOUND: 标签页没有 ID");
  }
  return {
    id: tab.id,
    windowId: tab.windowId,
    active: Boolean(tab.active),
    title: tab.title,
    url: tab.url
  };
}

function parseStepAction(value: unknown): BrowserStepAction {
  const allowed: BrowserStepAction[] = [
    "open",
    "activateTab",
    "click",
    "hover",
    "type",
    "fillForm",
    "clear",
    "scroll",
    "waitFor",
    "pressKey",
    "assertText",
    "getText",
    "pageModel",
    "snapshot",
    "screenshot",
    "pdf",
    "sleep"
  ];
  if (typeof value === "string" && allowed.includes(value as BrowserStepAction)) {
    return value as BrowserStepAction;
  }
  throw new Error("INVALID_PARAMS: action 不支持或缺失");
}

function targetParams(step: BrowserStep): Record<string, unknown> {
  const target = isRecord(step.target) ? step.target : {};
  return {
    query: step.query ?? target.query,
    elementId: step.elementId ?? target.elementId,
    selector: step.selector ?? target.selector,
    text: step.text ?? target.text,
    role: step.role ?? target.role,
    ariaLabel: step.ariaLabel ?? target.ariaLabel,
    placeholder: step.placeholder ?? target.placeholder,
    href: step.href ?? target.href,
    nearText: step.nearText ?? target.nearText,
    visibleOnly: step.visibleOnly,
    viewportOnly: step.viewportOnly
  };
}

function stepRequest(
  tool: BridgeRequest["tool"],
  step: BrowserStep,
  currentTabId: number | undefined,
  params: Record<string, unknown>
): BridgeRequest {
  return {
    id: crypto.randomUUID(),
    tool,
    tabId: step.tabId ?? currentTabId,
    timeoutMs: step.timeoutMs,
    params: {
      ...params,
      tabId: step.tabId ?? currentTabId,
      timeoutMs: step.timeoutMs
    }
  };
}

function requiredTabId(step: BrowserStep, currentTabId: number | undefined): number {
  const tabId = step.tabId ?? currentTabId;
  if (!tabId) {
    throw new Error("INVALID_PARAMS: activateTab 步骤需要 tabId");
  }
  return tabId;
}

function extractTabId(data: unknown): number | undefined {
  if (isRecord(data) && typeof data.tabId === "number") {
    return data.tabId;
  }
  if (isRecord(data) && typeof data.id === "number") {
    return data.id;
  }
  return undefined;
}

function sanitizeStepData(action: BrowserStepAction, data: unknown): unknown {
  if (action === "screenshot" && isRecord(data)) {
    return {
      tabId: data.tabId,
      url: data.url,
      title: data.title,
      mimeType: data.mimeType,
      dataUrlLength: typeof data.dataUrl === "string" ? data.dataUrl.length : undefined
    };
  }
  if (action === "pdf" && isRecord(data)) {
    return {
      tabId: data.tabId,
      url: data.url,
      title: data.title,
      mimeType: data.mimeType,
      dataLength: typeof data.data === "string" ? data.data.length : undefined
    };
  }
  return data;
}

function makeStepError(
  index: number,
  action: BrowserStepAction,
  description: string | undefined,
  code: string,
  message: string,
  elapsedMs: number,
  tabId?: number,
  data?: unknown
): BrowserStepResult {
  return {
    index,
    action,
    description,
    ok: false,
    elapsedMs,
    tabId,
    data,
    error: { code, message }
  };
}

async function takeErrorScreenshot(tabId?: number): Promise<unknown> {
  try {
    const id = tabId ?? (await getActiveTab()).id;
    const tab = await chrome.tabs.get(id);
    return sanitizeStepData("screenshot", await captureScreenshot(tab, {
      id: crypto.randomUUID(),
      tool: "browser_screenshot",
      tabId: id,
      params: { format: "png" }
    }));
  } catch {
    return undefined;
  }
}

function normalizeError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(": ")) {
    const [code, detail] = message.split(/: (.*)/s, 2);
    return { code, message: detail || message };
  }
  return { code: "INTERNAL_ERROR", message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function numberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPopupStatus(): Promise<Record<string, unknown>> {
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
    recordedCount: recordedSteps.length,
    lastError: lastBridgeError,
    readyState: offscreenStatus.readyState,
    security,
    audit
  };
}

async function getOffscreenStatus(): Promise<{
  connected: boolean;
  bridgeUrl?: string;
  lastError?: string;
  readyState?: string;
}> {
  try {
    const status = await chrome.runtime.sendMessage({ type: "offscreen_get_status" });
    return {
      connected: Boolean(status?.connected),
      bridgeUrl: typeof status?.bridgeUrl === "string" ? status.bridgeUrl : undefined,
      lastError: typeof status?.lastError === "string" ? status.lastError : undefined,
      readyState: typeof status?.readyState === "string" ? status.readyState : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordBridgeError(`读取 offscreen 状态失败：${message}`);
    return { connected, bridgeUrl: currentBridgeUrl, lastError: lastBridgeError };
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenCreation) {
    return offscreenCreation;
  }

  offscreenCreation = createOffscreenDocument();
  try {
    await offscreenCreation;
  } finally {
    offscreenCreation = undefined;
  }
}

async function createOffscreenDocument(): Promise<void> {
  const offscreen = chrome.offscreen;
  if (!offscreen) {
    recordBridgeError("当前 Chrome 不支持 offscreen API，请升级 Chrome 后重试");
    return;
  }

  try {
    const hasDocument = await offscreen.hasDocument();
    if (hasDocument) {
      return;
    }

    await offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
      justification: "保持浏览器桥接 WebSocket 连接"
    });
    recordBridgeError("");
    await syncBridgeUrlToOffscreen();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordBridgeError(`创建 offscreen 连接页失败：${message}`);
  }
}

async function getBridgeUrl(): Promise<string> {
  const stored = await chrome.storage.local.get("bridgeUrl");
  return typeof stored.bridgeUrl === "string" && stored.bridgeUrl.trim()
    ? stored.bridgeUrl.trim()
    : DEFAULT_BRIDGE_URL;
}

async function setBridgeUrl(value: string): Promise<void> {
  const normalized = normalizeBridgeUrl(value);
  await chrome.storage.local.set({ bridgeUrl: normalized });
  currentBridgeUrl = normalized;
  await ensureOffscreenDocument();
  await syncBridgeUrlToOffscreen();
}

async function syncBridgeUrlToOffscreen(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: "offscreen_set_bridge_url",
      bridgeUrl: currentBridgeUrl
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordBridgeError(`通知 offscreen 重连失败：${message}`);
  }
}

function normalizeBridgeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_BRIDGE_URL;
  }
  if (!/^wss?:\/\//.test(trimmed)) {
    return `ws://${trimmed}`;
  }
  return trimmed;
}

function setupKeepalive(): void {
  chrome.alarms.create("browser-bridge-keepalive", { periodInMinutes: 0.4 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "browser-bridge-keepalive") {
      void ensureOffscreenDocument();
    }
  });
}

function recordBridgeError(message: string): void {
  lastBridgeError = message;
  void chrome.storage.local.set({ bridgeLastError: message });
  if (message) {
    console.warn(`[浏览器桥接] ${message}`);
  }
}
