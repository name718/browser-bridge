import {
  type BridgeRequest
} from '@majuntao-1/browser-bridge-shared';
import * as BridgeClientService from './services/bridge-client.js';
import * as AgentSessionService from './services/agent-session.js';
import * as RecorderService from './services/recorder.js';
import * as DebuggerService from './services/debugger.js';
import * as TabsService from './services/tabs.js';
import { handleBridgeRequest } from './router.js';

void BridgeClientService.ensureOffscreenDocument();
setupKeepalive();

chrome.runtime.onStartup.addListener(() => {
  void BridgeClientService.ensureOffscreenDocument();
});

chrome.runtime.onInstalled.addListener(() => {
  void BridgeClientService.ensureOffscreenDocument();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'popup_status') {
    void BridgeClientService.getPopupStatus(RecorderService.isRecording, RecorderService.recordedSteps.length).then(sendResponse);
    return true;
  }
  if (message?.type === 'popup_save_bridge') {
    void BridgeClientService.setBridgeUrl(String(message.bridgeUrl ?? '')).then(() => {
      sendResponse({ ok: true, bridgeUrl: BridgeClientService.currentBridgeUrl });
    });
    return true;
  }
  if (message?.type === 'offscreen_status') {
    BridgeClientService.updateStatusFromOffscreen(message);
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === 'offscreen_bridge_request') {
    void handleBridgeRequest(message.request as BridgeRequest).then(sendResponse);
    return true;
  }
  if (message?.type === 'browser_bridge_cdp_input') {
    void DebuggerService.handleCdpInput(message, TabsService.getActiveTab).then(sendResponse);
    return true;
  }
  if (message?.type === 'popup_save_security') {
    void chrome.storage.local.set(message.security ?? {}).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message?.type === 'popup_toggle_recording') {
    void RecorderService.toggleRecording({ id: 'popup', tool: 'browser_toggle_recording', params: { enabled: message.enabled } }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === 'popup_clear_recording') {
    RecorderService.clearRecording();
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === 'browser_bridge_record_step') {
    RecorderService.recordStep(message.step);
    return false;
  }
  if (message?.type === 'get_agent_session_status') {
    sendResponse({ active: AgentSessionService.isAgentSessionActive });
    return true;
  }
  return false;
});

function setupKeepalive(): void {
  chrome.alarms.create('browser-bridge-keepalive', { periodInMinutes: 0.4 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'browser-bridge-keepalive') {
      void BridgeClientService.ensureOffscreenDocument();
    }
  });
}
