import { normalizeText, isVisible, isInViewport, cssEscape, isDisabled, isFocusable } from './dom.js';
import { elementCache } from '../element-cache.js';

export const ELEMENT_ATTR = 'data-browser-bridge-id';
export const ACTIONABLE_SELECTOR = [
  'a[href]', 'button', 'input', 'textarea', 'select', '[role="button"]', '[role="link"]',
  '[role="menuitem"]', '[role="tab"]', '[role="option"]', '[role="checkbox"]', '[role="radio"]',
  '[role="textbox"]', '[class*="select-selector"]', '[class*="Select-selector"]',
  '[class*="select-selection"]', '[class*="Select-selection"]', '[class*="select-trigger"]',
  '[class*="Select-trigger"]', '[onclick]', '[contenteditable="true"]'
].join(',');

export const FLOATING_OPTION_SELECTOR = [
  '[role="option"]', '[role="menuitem"]', '[role="treeitem"]', '.ant-select-item-option',
  '.arco-select-option', '.el-select-dropdown__item', '[class*="dropdown"] [class*="item"]',
  '[class*="Dropdown"] [class*="item"]', '[class*="popup"] [class*="item"]',
  '[class*="Popup"] [class*="item"]', '[class*="option"]', '[class*="Option"]'
].join(',');

export function getElementText(element: HTMLElement): string | undefined {
  const text = normalizeText(element.innerText || element.textContent || '');
  if (text) return text;
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return normalizeText(ariaLabel);
  const title = element.getAttribute('title');
  if (title) return normalizeText(title);
  return undefined;
}

export function getElementValue(element: HTMLElement): string | undefined {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return element.value || undefined;
  }
  return undefined;
}

export function getPlaceholder(element: HTMLElement): string | undefined {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.placeholder || undefined;
  }
  return undefined;
}

export function getAssociatedLabel(element: HTMLElement): string {
  const id = element.id;
  if (id) {
    const label = document.querySelector('label[for="' + cssEscape(id) + '"]');
    if (label?.textContent) return normalizeText(label.textContent);
  }
  const parentLabel = element.closest('label');
  return parentLabel?.textContent ? normalizeText(parentLabel.textContent) : '';
}

export function getNearbyText(element: HTMLElement): string {
  const parts: string[] = [];
  const label = getAssociatedLabel(element);
  if (label) parts.push(label);

  const parent = element.closest('label,[class*="form-item"],[class*="FormItem"],[class*="field"],[class*="Field"],.form-group');
  if (parent?.textContent) parts.push(parent.textContent);

  let sibling = element.previousElementSibling;
  for (let i = 0; sibling && i < 2; i++, sibling = sibling.previousElementSibling) {
    if (sibling.textContent) parts.push(sibling.textContent);
  }

  return normalizeText(parts.join(' '));
}

export function getAccessibilityName(element: HTMLElement): string {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/)
      .map(id => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text) return text;
  }
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel?.trim()) return ariaLabel.trim();
  const label = getAssociatedLabel(element);
  if (label) return label;
  const placeholder = getPlaceholder(element);
  if (placeholder) return placeholder;
  if (element instanceof HTMLImageElement) {
    const alt = element.getAttribute('alt');
    if (alt) return alt;
  }
  const title = element.getAttribute('title');
  if (title) return title;
  return getElementText(element) ?? '';
}

export function inferRole(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'a') return 'link';
  if (tagName === 'button') return 'button';
  if (tagName === 'textarea') return 'textbox';
  if (tagName === 'select') return 'combobox';
  if (tagName === 'input') {
    const type = (element as HTMLInputElement).type;
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'submit' || type === 'button') return 'button';
    return 'textbox';
  }
  return 'generic';
}

export function ensureElementId(element: HTMLElement, index: number): string {
  const existing = element.getAttribute(ELEMENT_ATTR);
  if (existing) return existing;
  const id = 'bb-' + Date.now().toString(36) + '-' + index.toString(36);
  element.setAttribute(ELEMENT_ATTR, id);
  return id;
}

export function getActionableElements(options: {
  visibleOnly?: boolean;
  viewportOnly?: boolean;
  rectCache?: Map<HTMLElement, DOMRect>;
} = {}): HTMLElement[] {
  const elements = elementCache.get({
    visibleOnly: options.visibleOnly,
    viewportOnly: options.viewportOnly
  }).slice();
  if (options.rectCache) {
    for (const element of elements) {
      options.rectCache.set(element, element.getBoundingClientRect());
    }
  }
  return elements;
}

export function collectActionableElements(options: {
  visibleOnly?: boolean;
  viewportOnly?: boolean;
  rectCache?: Map<HTMLElement, DOMRect>;
} = {}): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const cache = options.rectCache;

  const addElement = (el: HTMLElement) => {
    if (seen.has(el)) return;
    const rect = el.getBoundingClientRect();
    if (cache) cache.set(el, rect);
    if (rect.width <= 0 || rect.height <= 0) return;
    if (options.visibleOnly !== false && !isVisible(el)) return;
    if (options.viewportOnly && (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth)) return;
    elements.push(el);
    seen.add(el);
  };

  const walkShadowRoots = (root: Document | ShadowRoot) => {
    const matched = root.querySelectorAll<HTMLElement>(ACTIONABLE_SELECTOR);
    for (const el of Array.from(matched)) addElement(el);
    const container = root instanceof Document ? document.documentElement : root;
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i] as HTMLElement;
      if (child.shadowRoot) walkShadowRoots(child.shadowRoot);
      if (child.children.length > 0) walkChildrenForShadows(child);
    }
  };

  const walkChildrenForShadows = (parent: Element) => {
    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i] as HTMLElement;
      if (child.shadowRoot) walkShadowRoots(child.shadowRoot);
      if (child.children.length > 0) walkChildrenForShadows(child);
    }
  };

  if (document.body) {
    walkShadowRoots(document);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FLOATING_OPTION_SELECTOR))) {
      if (normalizeText(el.innerText || el.textContent || '')) addElement(el);
    }
  }

  return elements.sort((a, b) => {
    const aRect = cache?.get(a) ?? a.getBoundingClientRect();
    const bRect = cache?.get(b) ?? b.getBoundingClientRect();
    return aRect.top - bRect.top || aRect.left - bRect.left;
  });
}

elementCache.init((options) => collectActionableElements(options));
