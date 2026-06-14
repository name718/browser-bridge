import { getElementText, getAssociatedLabel, getPlaceholder, inferRole, ACTIONABLE_SELECTOR } from '../utils/dom-info.js';
import { normalizeText, isRecord, getElementValue } from '../utils/dom.js';

let isRecording = false;
let lastRecordedUrl = location.href;
let inputRecordTimer: number | undefined;
let scrollRecordTimer: number | undefined;
let lastScrollX = window.scrollX;
let lastScrollY = window.scrollY;
let recordingListenersAttached = false;
let urlPollTimer: number | undefined;

function handleRecordClick(event: Event) {
  const target = event.target as HTMLElement;
  if (!target) return;
  recordStep({ action: 'click', ...getRecordedTarget(target) });
}

function recordStep(step: Record<string, unknown>): void {
  chrome.runtime.sendMessage({
    type: 'browser_bridge_record_step',
    step: { id: crypto.randomUUID(), timestamp: Date.now(), url: location.href, title: document.title, ...step }
  });
}

function getRecordedTarget(target: HTMLElement | null): Record<string, unknown> {
  if (!target) return {};
  const element = target.closest(ACTIONABLE_SELECTOR) as HTMLElement | null ?? target;
  const rect = element.getBoundingClientRect();
  return {
    text: getElementText(element) || getAssociatedLabel(element) || undefined,
    role: element.getAttribute('role') || inferRole(element),
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
  };
}

export function setRecordingListeners(recording: boolean): void {
  if (recording && !recordingListenersAttached) {
    document.addEventListener('click', handleRecordClick, { capture: true });
    recordingListenersAttached = true;
  } else if (!recording && recordingListenersAttached) {
    document.removeEventListener('click', handleRecordClick, { capture: true });
    recordingListenersAttached = false;
  }
}