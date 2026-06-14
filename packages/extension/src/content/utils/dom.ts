export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function truncate(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  return value.length > maxLength ? value.slice(0, maxLength - 1) + '…' : value;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function cssEscape(value: string): string {
  if ('CSS' in window && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\"');
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const visibilityCache = new WeakMap<HTMLElement, { visible: boolean; time: number }>();
const VISIBILITY_CACHE_TTL = 300;

export function isVisible(element: HTMLElement): boolean {
  const cached = visibilityCache.get(element);
  if (cached && Date.now() - cached.time < VISIBILITY_CACHE_TTL) {
    return cached.visible;
  }
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const visible =
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    Number(style.opacity) !== 0 &&
    rect.width > 0 &&
    rect.height > 0;
  visibilityCache.set(element, { visible, time: Date.now() });
  return visible;
}

export function isInViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= window.innerHeight &&
    rect.left <= window.innerWidth
  );
}

export function isDisabled(element: HTMLElement): boolean {
  return (
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true'
  );
}

export function isFocusable(element: HTMLElement): boolean {
  return (
    element.tabIndex >= 0 ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLButtonElement ||
    element instanceof HTMLAnchorElement ||
    element.isContentEditable
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getElementValue(element: HTMLElement): string | undefined {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return element.value || undefined;
  }
  if (element.isContentEditable) {
    return element.textContent || undefined;
  }
  return element.getAttribute('value') || undefined;
}

export function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

export function numberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function dispatchPointerEvent(element: HTMLElement, type: string): void {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  }));
}
