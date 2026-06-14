import { normalizeText, truncate, clamp, isVisible, isInViewport } from '../utils/dom.js';
import { getElementText, getAccessibilityName, inferRole, ensureElementId, getActionableElements, FLOATING_OPTION_SELECTOR } from '../utils/dom-info.js';
import { type BrowserElement, type BrowserPageModel, type PageSnapshot } from '@majuntao-1/browser-bridge-shared';
import { toBrowserElement } from './dom-interactor.js';

let visibleTextCache: { text: string; timestamp: number } | undefined;
const VISIBLE_TEXT_CACHE_TTL = 500;

export function getVisibleText(): string {
  if (visibleTextCache && Date.now() - visibleTextCache.timestamp < VISIBLE_TEXT_CACHE_TTL) {
    return visibleTextCache.text;
  }

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
  const text = lines.join('').replace(/\n{3,}/g, '\n\n').trim().slice(0, 100000);
  visibleTextCache = { text, timestamp: Date.now() };
  return text;
}

export function invalidatePageModelCache(): void {
  visibleTextCache = undefined;
}

export function getPageSnapshot(): PageSnapshot {
  return {
    tabId: -1, url: location.href, title: document.title,
    text: getVisibleText().slice(0, 10000),
    elements: getActionableElements({ visibleOnly: true }).slice(0, 100).map(toBrowserElement)
  };
}

export function getInteractives(params: Record<string, any>): { elements: BrowserElement[] } {
  const limit = clamp(Number(params.limit ?? 50), 1, 200);
  const viewportOnly = params.viewportOnly === true;
  return {
    elements: getActionableElements({ visibleOnly: true, viewportOnly }).slice(0, limit).map(toBrowserElement)
  };
}

export function getPageModel(params: Record<string, any>): BrowserPageModel {
  const fullText = getVisibleText();
  const limits = {
    maxTextLength: clamp(Number(params.maxTextLength ?? 2000), 0, 20000),
    maxElements: clamp(Number(params.maxElements ?? 120), 0, 300),
    maxHeadings: clamp(Number(params.maxHeadings ?? 60), 0, 200),
    maxRegions: clamp(Number(params.maxRegions ?? 40), 0, 120),
    maxTables: clamp(Number(params.maxTables ?? 10), 0, 50),
    maxTableRows: clamp(Number(params.maxTableRows ?? 5), 0, 30)
  };
  const visibleOnly = params.visibleOnly !== false;
  const viewportOnly = params.viewportOnly === true;

  return {
    tabId: -1, url: location.href, title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY },
    summary: {
      textSample: truncate(fullText, limits.maxTextLength) || '',
      textLength: fullText.length,
      truncated: fullText.length > limits.maxTextLength
    },
    outline: getPageOutline({ visibleOnly, viewportOnly, limit: limits.maxHeadings }),
    regions: getPageRegions({ visibleOnly, viewportOnly, limit: limits.maxRegions }),
    interactives: getActionableElements({ visibleOnly, viewportOnly }).slice(0, limits.maxElements).map(toBrowserElement),
    floatingOptions: getFloatingOptions({ visibleOnly, viewportOnly, limit: Math.min(limits.maxElements, 80) }),
    forms: getPageForms({ visibleOnly, viewportOnly, maxFields: limits.maxElements }),
    tables: getPageTables({ visibleOnly, viewportOnly, limit: limits.maxTables, maxRows: limits.maxTableRows }),
    messages: getPageMessages({ visibleOnly, viewportOnly, limit: 40 }),
    limits
  };
}
export function getPageOutline(options: { visibleOnly: boolean; viewportOnly: boolean; limit: number }): any[] {
  return Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .filter(el => shouldInclude(el as HTMLElement, options.visibleOnly, options.viewportOnly))
    .slice(0, options.limit)
    .map((el, i) => ({
      level: parseInt(el.tagName[1]),
      text: normalizeText(el.textContent ?? ''),
      elementId: ensureElementId(el as HTMLElement, i),
      rect: rectOf(el as HTMLElement)
    }));
}

export function getPageRegions(options: { visibleOnly: boolean; viewportOnly: boolean; limit: number }): any[] {
  return Array.from(document.querySelectorAll<HTMLElement>('main,nav,header,footer,aside,section,article,form,[role="main"],[role="navigation"],[role="banner"],[role="contentinfo"],[role="dialog"]'))
    .filter(el => shouldInclude(el, options.visibleOnly, options.viewportOnly))
    .slice(0, options.limit)
    .map((el, i) => ({
      elementId: ensureElementId(el, i),
      role: el.getAttribute('role') || inferRole(el),
      tagName: el.tagName.toLowerCase(),
      name: getAccessibilityName(el) || undefined,
      textSample: truncate(normalizeText(el.innerText || el.textContent || ''), 220),
      rect: rectOf(el)
    }));
}

function getFloatingOptions(options: { visibleOnly: boolean; viewportOnly: boolean; limit: number }): BrowserElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(FLOATING_OPTION_SELECTOR))
    .filter(el => shouldInclude(el, options.visibleOnly, options.viewportOnly))
    .slice(0, options.limit)
    .map(toBrowserElement);
}

function getPageForms(options: { visibleOnly: boolean; viewportOnly: boolean; maxFields: number }): BrowserPageModel['forms'] {
  const forms = Array.from(document.querySelectorAll<HTMLElement>('form,[role="form"],.ant-form,.el-form,.arco-form'))
    .filter(el => shouldInclude(el, options.visibleOnly, options.viewportOnly));

  return forms.map((form, index) => {
    const fields = Array.from(form.querySelectorAll<HTMLElement>('input,textarea,select,[role="textbox"],[role="combobox"],[contenteditable="true"]'))
      .filter(el => shouldInclude(el, options.visibleOnly, options.viewportOnly))
      .slice(0, options.maxFields)
      .map(toBrowserElement);
    return {
      elementId: ensureElementId(form, index),
      name: getAccessibilityName(form) || form.getAttribute('name') || undefined,
      fields
    };
  }).filter(form => form.fields.length > 0);
}

function getPageTables(options: { visibleOnly: boolean; viewportOnly: boolean; limit: number; maxRows: number }): BrowserPageModel['tables'] {
  return Array.from(document.querySelectorAll<HTMLElement>('table,[role="table"],[role="grid"]'))
    .filter(el => shouldInclude(el, options.visibleOnly, options.viewportOnly))
    .slice(0, options.limit)
    .map((table, index) => {
      const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr,[role="row"]'));
      const headers = Array.from(table.querySelectorAll<HTMLElement>('th,[role="columnheader"]'))
        .map(cell => normalizeText(cell.innerText || cell.textContent || ''))
        .filter(Boolean);
      const sampleRows = rows.slice(0, options.maxRows).map(row =>
        Array.from(row.querySelectorAll<HTMLElement>('th,td,[role="cell"],[role="gridcell"]'))
          .map(cell => normalizeText(cell.innerText || cell.textContent || ''))
          .filter(Boolean)
      ).filter(row => row.length > 0);
      const caption = table.querySelector('caption')?.textContent;
      return {
        elementId: ensureElementId(table, index),
        caption: caption ? normalizeText(caption) : undefined,
        headers,
        rowCount: rows.length,
        sampleRows,
        rect: rectOf(table)
      };
    });
}

function getPageMessages(options: { visibleOnly: boolean; viewportOnly: boolean; limit: number }): BrowserPageModel['messages'] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="alert"],[role="status"],[aria-live],.toast,.notification,.message,.error,.warning,.success'))
    .filter(el => shouldInclude(el, options.visibleOnly, options.viewportOnly))
    .map((el, index) => ({
      elementId: ensureElementId(el, index),
      role: el.getAttribute('role') || inferRole(el),
      text: normalizeText(el.innerText || el.textContent || ''),
      rect: rectOf(el)
    }))
    .filter(message => message.text)
    .slice(0, options.limit);
}

function shouldInclude(element: HTMLElement, visibleOnly: boolean, viewportOnly: boolean): boolean {
  if (visibleOnly && !isVisible(element)) return false;
  if (viewportOnly && !isInViewport(element)) return false;
  return true;
}

function rectOf(element: HTMLElement): BrowserElement['rect'] {
  const rect = element.getBoundingClientRect();
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
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
