import {
  type BridgeRequest
} from '@majuntao-1/browser-bridge-shared';
import { appendAuditLog } from '../audit.js';

export let recordedSteps: any[] = [];
export let isRecording = false;

export async function toggleRecording(request: BridgeRequest): Promise<Record<string, unknown>> {
  const params = (typeof request.params === 'object' && request.params !== null) ? request.params : {};
  isRecording = Boolean(params.enabled);
  if (isRecording) {
    recordedSteps = [];
  }

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'browser_bridge_toggle_recording',
          enabled: isRecording
        }, { frameId: 0 });
      } catch { /* ignore */ }
    }
  }

  await appendAuditLog({ tool: 'browser_toggle_recording', ok: true });
  return { ok: true, isRecording };
}

export async function getRecordedSteps(): Promise<Record<string, unknown>> {
  const steps = [...recordedSteps];
  await appendAuditLog({ tool: 'browser_get_recorded_steps', ok: true });
  return { steps, count: steps.length };
}

export function recordStep(step: any) {
  recordedSteps.push({ timestamp: Date.now(), ...step });
  if (recordedSteps.length > 100) recordedSteps.shift();
}

export function clearRecording() {
  recordedSteps = [];
}
