import { normalizeText, truncate, clamp, isVisible, isInViewport } from '../utils/dom.js';
import { getElementText, getAccessibilityName, inferRole, ensureElementId, getActionableElements, FLOATING_OPTION_SELECTOR } from '../utils/dom-info.js';
import { type BrowserElement, type BrowserPageModel, type PageSnapshot } from '@majuntao-1/browser-bridge-shared';
import { toBrowserElement } from './dom-interactor.js';

export function getVisibleText(): string {
  const lines: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (!isVisible(el)) return;
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
        lines.push('\n' + '#'.repeat(parseInt(tag[1])) + ' ' + el.innerText.trim() + '\n');
      } else if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
        for (const child of Array.from(node.childNodes)) walk(child);
        lines.push('\n');
      } else {
        for (const child of Array.from(node.childNodes)) walk(child);
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) lines.push(text + ' ');
    }
  };
  if (document.body) walk(document.body);
  return lines.join('').replace(/\n{3,}/g, '\n\n').trim().slice(0, 100000);
}

export function getPageSnapshot(): PageSnapshot {
  return {
    tabId: -1, url: location.href, title: document.title,
    text: getVisibleText().slice(0, 10000),
    elements: getActionableElements({ visibleOnly: true }).slice(0, 100).map(toBrowserElement)
  };
}

export function getPageModel(params: Record<string, any>): BrowserPageModel {
  const fullText = getVisibleText();
  return {
    tabId: -1, url: location.href, title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY },
    summary: { textSample: truncate(fullText, 2000) || '', textLength: fullText.length, truncated: fullText.length > 2000 },
    outline: [], regions: [], interactives: getActionableElements({ visibleOnly: true }).slice(0, 50).map(toBrowserElement),
    floatingOptions: [], forms: [], tables: [], messages: [],
    limits: { maxTextLength: 2000, maxElements: 120, maxHeadings: 60, maxRegions: 40, maxTables: 10, maxTableRows: 5 }
  };
}
export function getPageOutline(options: { visibleOnly: boolean; viewportOnly: boolean; limit: number }): any[] {
  return Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .filter(el => (options.visibleOnly ? isVisible(el as HTMLElement) : true))
    .slice(0, options.limit)
    .map((el, i) => ({ level: parseInt(el.tagName[1]), text: el.textContent?.trim(), elementId: ensureElementId(el as HTMLElement, i) }));
}

export function getPageRegions(options: { visibleOnly: boolean; viewportOnly: boolean; limit: number }): any[] {
  return Array.from(document.querySelectorAll('main,nav,header,footer,aside,section,article,form'))
    .filter(el => (options.visibleOnly ? isVisible(el as HTMLElement) : true))
    .slice(0, options.limit)
    .map((el, i) => ({ tagName: el.tagName.toLowerCase(), elementId: ensureElementId(el as HTMLElement, i) }));
}

export function getSelectedText(): string {
  return window.getSelection()?.toString() || '';
}

export function getLinks(): any {
  return {
    links: Array.from(document.querySelectorAll('a[href]')).map(el => ({
      text: el.textContent?.trim(),
      href: (el as HTMLAnchorElement).href,
      visible: isVisible(el as HTMLElement)
    }))
  };
}
