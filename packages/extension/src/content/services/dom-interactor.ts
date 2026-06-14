import {
  normalizeText, truncate, delay, cssEscape, isVisible, isRecord, stringParam, numberParam, dispatchPointerEvent, isFocusable, isDisabled
} from '../utils/dom.js';
import {
  getElementText, getElementValue, getPlaceholder, getAccessibilityName, inferRole, ensureElementId, getActionableElements,
  ACTIONABLE_SELECTOR, FLOATING_OPTION_SELECTOR, getAssociatedLabel, getNearbyText
} from '../utils/dom-info.js';
import { type BrowserElement, type BrowserActAction, type BrowserActResult } from '@majuntao-1/browser-bridge-shared';
import { showVisualRipple, assertElementClickSafe, showConfirmationOverlay } from './ui-overlay.js';
import { getSynonyms } from '../synonyms.js';

export async function findTargetWithRetry(
  params: Record<string, unknown>,
  options: { allowText?: boolean; timeoutMs?: number } = {}
): Promise<HTMLElement> {
  const elementId = stringParam(params, 'elementId');
  if (elementId) {
    const el = document.querySelector('[data-browser-bridge-id="' + cssEscape(elementId) + '"]')
      ?? (/^\d+$/.test(elementId) ? document.querySelector('[data-bb-temp-id="' + cssEscape(elementId) + '"]') : null);
    if (el instanceof HTMLElement) return el;
  }

  const timeoutMs = options.timeoutMs ?? numberParam(params, 'timeoutMs') ?? 3000;
  const start = Date.now();
  let lastError: unknown;

  while (Date.now() - start <= timeoutMs) {
    try {
      return findTarget(params, options);
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('ELEMENT_NOT_FOUND: 未找到元素');
}

export function findTarget(params: Record<string, unknown>, options: { allowText?: boolean } = {}): HTMLElement {
  const elementId = stringParam(params, 'elementId');
  const selector = stringParam(params, 'selector');
  const query = stringParam(params, 'query');
  const text = stringParam(params, 'text');
  const role = stringParam(params, 'role');
  const ariaLabel = stringParam(params, 'ariaLabel');
  const placeholder = stringParam(params, 'placeholder');
  const href = stringParam(params, 'href');

  let element: Element | null = null;
  if (elementId) {
    element = document.querySelector('[data-browser-bridge-id="' + cssEscape(elementId) + '"]') 
              || (/^\d+$/.test(elementId) ? document.querySelector('[data-bb-temp-id="' + cssEscape(elementId) + '"]') : null);
  }

  if (!element && selector) {
    element = resolveSelector(selector);
  }

  if (!element && (query || text || role || ariaLabel || placeholder || href)) {
    const matches = scoreElements(params);
    if (matches.length > 0 && matches[0].score > 0.1) {
      element = matches[0].element;
    }
  }

  if (!element || !(element instanceof HTMLElement)) {
    throw new Error('ELEMENT_NOT_FOUND');
  }

  return element;
}

function resolveSelector(selector: string): HTMLElement | null {
  try {
    if (/^\d+$/.test(selector)) return document.querySelector('[data-bb-temp-id="' + cssEscape(selector) + '"]');
    if (selector.startsWith('id=')) return document.getElementById(selector.slice(3));
    if (selector.startsWith('data-testid=')) {
      const value = cssEscape(selector.slice(12));
      return document.querySelector('[data-testid="' + value + '"],[data-test="' + value + '"],[data-cy="' + value + '"]');
    }
    const cleanSelector = selector.startsWith('css=') ? selector.slice(4) : selector;
    return document.querySelector(cleanSelector);
  } catch { return null; }
}

export function scoreElements(params: Record<string, unknown>): Array<{
  element: HTMLElement;
  score: number;
  reasons: string[];
}> {
  const query = normalizeText(stringParam(params, 'query') ?? stringParam(params, 'text') ?? '');
  const role = normalizeText(stringParam(params, 'role') ?? '');
  const ariaLabel = normalizeText(stringParam(params, 'ariaLabel') ?? '');
  const placeholder = normalizeText(stringParam(params, 'placeholder') ?? '');
  const href = normalizeText(stringParam(params, 'href') ?? '');
  const nearText = normalizeText(stringParam(params, 'nearText') ?? '');
  const visibleOnly = params.visibleOnly !== false;
  const viewportOnly = params.viewportOnly === true;

  const queryLower = query.toLowerCase();
  const queryClean = queryLower.replace(/\s+/g, '');

  const rectCache = new Map<HTMLElement, DOMRect>();
  const elements = getActionableElements({ visibleOnly, viewportOnly, rectCache });

  const quickResults = elements.map((element) => {
    const accName = normalizeText(getAccessibilityName(element));
    const elementRole = normalizeText(element.getAttribute('role') || inferRole(element));
    const elementAria = normalizeText(element.getAttribute('aria-label') ?? '');
    const elementPlaceholder = normalizeText(getPlaceholder(element) ?? '');
    const elementValue = normalizeText(getElementValue(element) ?? '');
    const elementHref = normalizeText(element instanceof HTMLAnchorElement ? element.href : element.getAttribute('href') ?? '');
    const rect = rectCache.get(element)!;

    let score = 0;
    const reasons: string[] = [];

    if (query) {
      const accNameClean = accName.toLowerCase().replace(/\s+/g, '');
      if (accNameClean === queryClean) {
        score += 0.8;
        reasons.push('名称精确匹配');
      } else if (accNameClean.includes(queryClean)) {
        score += 0.5;
        reasons.push('名称包含匹配');
      } else {
        score += scoreTextField(query, elementAria, 0.4, 'aria-label', reasons);
        score += scoreTextField(query, elementPlaceholder, 0.35, 'placeholder', reasons);
        score += scoreTextField(query, elementValue, 0.3, '值', reasons);
      }
    }

    if (query && score < 0.4) {
      const className = (element.className || '').toString();
      const innerHtml = element.innerHTML;
      if (className.toLowerCase().includes(queryLower) || innerHtml.toLowerCase().includes(queryLower)) {
        score += 0.35;
        reasons.push('图标/图像特征匹配');
      }
    }

    const area = rect.width * rect.height;
    if (area > 2000) {
      score += 0.05;
      if (area > 8000) score += 0.05;
    }

    if (query && score < 0.5) {
      const parent = element.parentElement;
      if (parent && normalizeText(parent.innerText || '').includes(query)) {
        score += 0.25;
        reasons.push('父容器语义继承');
      }
    }

    if (role && elementRole === role) {
      score += 0.3;
      reasons.push('Role 匹配');
    }

    if (ariaLabel) score += scoreTextField(ariaLabel, elementAria, 0.45, 'aria-label', reasons);
    if (placeholder) score += scoreTextField(placeholder, elementPlaceholder, 0.45, 'placeholder', reasons);
    if (href) score += scoreTextField(href, elementHref, 0.4, 'href', reasons);
    if (nearText) {
      const context = normalizeText(getNearbyText(element));
      score += scoreTextField(nearText, context, 0.25, '附近文本', reasons);
    }

    if (viewportOnly || isElementInViewportRect(rect)) {
      score += 0.04;
    }

    if (isDisabled(element)) score -= 0.8;

    return { element, score, reasons, rect };
  });

  return quickResults
    .filter((result) => result.score > 0 || (!query && !role && !ariaLabel && !placeholder && !href && !nearText))
    .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top || a.rect.left - b.rect.left);
}

function scoreTextField(query: string, value: string, weight: number, label: string, reasons: string[]): number {
  if (!query || !value) return 0;
  if (value === query) { reasons.push(label + ' 精确匹配'); return weight; }
  if (value.includes(query)) { reasons.push(label + ' 包含匹配'); return weight * 0.78; }
  if (query.includes(value) && value.length >= 2) { reasons.push(label + ' 被查询包含'); return weight * 0.5; }
  return 0;
}

function isElementInViewportRect(rect: DOMRect): boolean {
  return rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
}

export async function clickElement(params: Record<string, unknown>): Promise<{ clicked: boolean; element: BrowserElement }> {
  const element = await findTargetWithRetry(params, { allowText: true });
  await assertElementClickSafe(element);

  await ensureElementActionable(element);
  element.scrollIntoView({ block: 'center', inline: 'center' });
  await delay(150);

  showVisualRipple(element);

  dispatchPointerEvent(element, 'mouseover');
  dispatchPointerEvent(element, 'mousemove');
  dispatchPointerEvent(element, 'mousedown');

  element.click();

  dispatchPointerEvent(element, 'mouseup');

  if (params.forceCdp === true) {
    const rect = element.getBoundingClientRect();
    await chrome.runtime.sendMessage({
      type: 'browser_bridge_cdp_input',
      action: 'click',
      params: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    });
  }

  return { clicked: true, element: toBrowserElement(element, 0) };
}

export async function typeIntoElement(params: Record<string, unknown>): Promise<{ typed: boolean; element: BrowserElement }> {
  const element = await findTargetWithRetry(params, { allowText: true });
  const text = stringParam(params, 'text') ?? '';
  const replace = params.replace === true;

  if (!isFocusable(element)) throw new Error('ELEMENT_NOT_FOUND: 目标不可输入');
  await ensureElementActionable(element);
  element.scrollIntoView({ block: 'center', inline: 'center' });
  await delay(150);

  showVisualRipple(element, '#3b82f6');
  element.focus();

  if (replace) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.value = '';
    else if (element.isContentEditable) element.textContent = '';
  }

  if (params.forceCdp === true) {
    await chrome.runtime.sendMessage({
      type: 'browser_bridge_cdp_input',
      action: 'type',
      params: { text }
    });
  } else {
    for (const char of text) {
      const init = { key: char, bubbles: true };
      element.dispatchEvent(new KeyboardEvent('keydown', init));
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.value += char;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (element.isContentEditable) {
        element.textContent += char;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
      element.dispatchEvent(new KeyboardEvent('keyup', init));
      await delay(20);
    }
  }

  element.dispatchEvent(new Event('change', { bubbles: true }));
  return { typed: true, element: toBrowserElement(element, 0) };
}

export async function ensureElementActionable(element: HTMLElement, timeoutMs: number = 4000): Promise<void> {
  const start = Date.now();
  let lastRect: DOMRect | undefined;
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    if (!isVisible(element)) { await delay(200); continue; }
    if (isDisabled(element)) { await delay(200); continue; }

    const currentRect = element.getBoundingClientRect();
    const isMoving = lastRect && (Math.abs(currentRect.top - lastRect.top) > 0.5 || Math.abs(currentRect.left - lastRect.left) > 0.5);
    if (!isMoving) stableCount++; else stableCount = 0;
    lastRect = currentRect;

    if (stableCount < 2) { await delay(150); continue; }

    const centerX = currentRect.left + currentRect.width / 2;
    const centerY = currentRect.top + currentRect.height / 2;
    const topEl = document.elementFromPoint(centerX, centerY);
    if (topEl && (element === topEl || element.contains(topEl) || topEl.contains(element))) return;

    await delay(200);
  }
  throw new Error('ACTION_TIMEOUT: 元素不可交互或被遮挡');
}

export function toBrowserElement(element: HTMLElement, index: number): BrowserElement {
  const rect = element.getBoundingClientRect();
  return {
    elementId: ensureElementId(element, index),
    role: element.getAttribute('role') || inferRole(element),
    tagName: element.tagName.toLowerCase(),
    text: getElementText(element),
    ariaLabel: element.getAttribute('aria-label') || undefined,
    placeholder: getPlaceholder(element),
    value: getElementValue(element),
    visible: isVisible(element),
    disabled: isDisabled(element),
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
  };
}
export async function hoverElement(params: Record<string, unknown>): Promise<{ hovered: boolean; element: BrowserElement }> {
  const element = await findTargetWithRetry(params, { allowText: true });
  await ensureElementActionable(element);
  element.scrollIntoView({ block: 'center', inline: 'center' });
  await delay(150);
  showVisualRipple(element);
  dispatchPointerEvent(element, 'mouseover');
  return { hovered: true, element: toBrowserElement(element, 0) };
}

export async function clearElement(params: Record<string, unknown>): Promise<{ cleared: boolean; element: BrowserElement }> {
  const element = await findTargetWithRetry(params, { allowText: false });
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { cleared: true, element: toBrowserElement(element, 0) };
}

export function scrollPage(params: Record<string, unknown>): { scrolled: boolean } {
  const direction = stringParam(params, 'direction') || 'down';
  const amount = numberParam(params, 'amount') ?? Math.round(window.innerHeight * 0.8);
  const delta = direction === 'up' || direction === 'left' ? -amount : amount;
  if (direction === 'left' || direction === 'right') window.scrollBy({ left: delta, behavior: 'smooth' });
  else window.scrollBy({ top: delta, behavior: 'smooth' });
  return { scrolled: true };
}

export async function waitForElement(params: Record<string, unknown>, timeoutMs: number = 5000): Promise<{ found: boolean; element?: BrowserElement }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const element = findTarget(params);
      return { found: true, element: toBrowserElement(element, 0) };
    } catch { await delay(100); }
  }
  throw new Error('ACTION_TIMEOUT: 未找到元素');
}
