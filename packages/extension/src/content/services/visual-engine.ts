import { normalizeText, truncate, numberParam, stringParam, delay, isVisible, isInViewport } from '../utils/dom.js';
import { getElementText, getAccessibilityName, getElementValue, inferRole, ensureElementId, getActionableElements, FLOATING_OPTION_SELECTOR, ELEMENT_ATTR } from '../utils/dom-info.js';

export type VisualTarget = {
  text?: string;
  role: string;
  tagName: string;
  elementId: string;
  rect: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  source: 'interactive' | 'option' | 'text';
};

export function getVisualTargets(): VisualTarget[] {
  const targets: VisualTarget[] = [];
  const seen = new Set<string>();
  const push = (element: HTMLElement, source: VisualTarget['source']) => {
    if (!isVisible(element) || !isInViewport(element)) return;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const text = getElementText(element) || getAccessibilityName(element) || getElementValue(element);
    if (!text && source === 'text') return;
    const key = source + ':' + (text ?? '') + ':' + Math.round(rect.x) + ':' + Math.round(rect.y) + ':' + Math.round(rect.width) + ':' + Math.round(rect.height);
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({
      text: truncate(text, 160),
      role: element.getAttribute('role') || inferRole(element),
      tagName: element.tagName.toLowerCase(),
      elementId: ensureElementId(element, targets.length),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      center: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
      source
    });
  };

  for (const element of getActionableElements({ visibleOnly: true, viewportOnly: true })) {
    push(element, element.matches(FLOATING_OPTION_SELECTOR) ? 'option' : 'interactive');
  }

  for (const element of Array.from(document.querySelectorAll<HTMLElement>(FLOATING_OPTION_SELECTOR))) {
    push(element, 'option');
  }

  for (const element of Array.from(document.querySelectorAll<HTMLElement>('button,a,label,span,div,p,td,th'))) {
    const text = normalizeText(element.innerText || element.textContent || '');
    const rect = element.getBoundingClientRect();
    if (text && text.length <= 80 && rect.width > 4 && rect.height > 4) {
      push(element, 'text');
    }
  }

  return targets.sort((a, b) => {
    const sourceRank = (target: VisualTarget) => target.source === 'option' ? 0 : target.source === 'interactive' ? 1 : 2;
    const rankDelta = sourceRank(a) - sourceRank(b);
    if (rankDelta !== 0) return rankDelta;
    return a.rect.y - b.rect.y || a.rect.x - b.rect.x;
  });
}

export function findVisualTargetByText(text: string, options: { exact?: boolean; prefer?: string; timeoutMs?: number } = {}): VisualTarget {
  const normalized = normalizeText(text);
  const candidates = getVisualTargets().filter((target) => {
    const targetText = normalizeText(target.text ?? '');
    return targetText && (options.exact ? targetText === normalized : targetText.includes(normalized));
  });
  if (candidates.length === 0) throw new Error('ELEMENT_NOT_FOUND: 未找到可见文本 「' + text + '」');
  
  const sorted = [...candidates];
  if (options.prefer === 'bottom') sorted.sort((a, b) => b.rect.y - a.rect.y);
  else sorted.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  
  return sorted[0];
}

export function visualObserve(params: Record<string, unknown>) {
  const maxTargets = Math.min(numberParam(params, 'maxTargets') ?? 120, 200);
  return {
    url: location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY },
    targets: getVisualTargets().slice(0, maxTargets)
  };
}

export function visualClickText(params: Record<string, unknown>, requestTimeoutMs?: number) {
  const text = stringParam(params, 'text');
  if (!text) throw new Error('INVALID_PARAMS: text 必填');
  const target = findVisualTargetByText(text, { exact: params.exact === true, prefer: stringParam(params, 'prefer') });
  return { matched: target, actions: [{ tool: 'browser_screen_click', x: target.center.x, y: target.center.y, delayMs: 60, afterDelayMs: 200 }] };
}

export function visualSelect(params: Record<string, unknown>, requestTimeoutMs?: number) {
  const label = stringParam(params, 'label');
  const option = stringParam(params, 'option');
  if (!label || !option) throw new Error('INVALID_PARAMS: label/option 必填');
  
  const targets = getVisualTargets();
  const control = targets.find(t => normalizeText(t.text ?? '').includes(normalizeText(label)));
  if (!control) throw new Error('ELEMENT_NOT_FOUND: 未找到下拉框');

  return {
    matched: control,
    actions: [
      { tool: 'browser_screen_click', x: control.center.x, y: control.center.y, delayMs: 60, afterDelayMs: 250 },
      { tool: 'browser_screen_click', x: '__resolve_after_open__', y: '__resolve_after_open__', label, option, exact: params.exact !== false, timeoutMs: 5000 }
    ]
  };
}

export function visualTask(params: Record<string, unknown>, requestTimeoutMs?: number) {
  const instruction = stringParam(params, 'instruction') || '';
  const actions: any[] = [];
  
  if (instruction.includes('选择') && instruction.includes('为')) {
    const match = instruction.match(/选择\s*(.+?)\s*为\s*(.+)/);
    if (match) {
      const label = match[1].trim();
      const option = match[2].trim();
      const plan = visualSelect({ label, option }, requestTimeoutMs);
      actions.push(...plan.actions);
    }
  } else if (instruction.includes('在') && instruction.includes('输入')) {
    const match = instruction.match(/在\s*(.+?)\s*输入\s*(.+)/);
    if (match) {
      const label = match[1].trim();
      const text = match[2].trim();
      const target = findVisualTargetByText(label, { exact: false });
      actions.push({ tool: 'browser_screen_click', x: target.center.x, y: target.center.y, delayMs: 60, afterDelayMs: 200 });
      actions.push({ tool: 'browser_screen_type', text });
    }
  } else if (instruction.includes('点击')) {
    const text = instruction.replace('点击', '').trim();
    const plan = visualClickText({ text }, requestTimeoutMs);
    actions.push(...plan.actions);
  } else if (instruction.includes('清空')) {
    const text = instruction.replace('清空', '').trim();
    const target = findVisualTargetByText(text, { exact: false });
    actions.push({ tool: 'browser_screen_click', x: target.center.x, y: target.center.y, delayMs: 60, afterDelayMs: 100 });
    actions.push({ tool: 'browser_screen_press', key: 'Control' }); 
    actions.push({ tool: 'browser_screen_press', key: 'a' });
    actions.push({ tool: 'browser_screen_press', key: 'Backspace' });
  }

  if (actions.length === 0) throw new Error('INVALID_PARAMS: 无法解析视觉指令 「' + instruction + '」');
  return { instruction, actions };
}
