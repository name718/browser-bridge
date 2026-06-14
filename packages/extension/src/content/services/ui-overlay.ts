import { isVisible, isInViewport, delay, normalizeText, truncate } from '../utils/dom.js';
import { getActionableElements, getElementText, getNearbyText } from '../utils/dom-info.js';

let activeOperations = 0;
let lastActiveTime = 0;
const MIN_OVERLAY_TIME = 800;
let isStickyMask = false;
let autoCloseTimer: any = null;
const AUTO_CLOSE_TIMEOUT = 5 * 60 * 1000;

const TOOL_NAME_MAP: Record<string, string> = {
  'BROWSER_OPEN_URL': '打开链接',
  'BROWSER_CLICK': '点击元素',
  'BROWSER_TYPE': '输入文本',
  'BROWSER_FIND': '查找元素',
  'BROWSER_GET_PAGE_TEXT': '读取文本',
  'BROWSER_GET_PAGE_MODEL': '解析页面数据',
  'BROWSER_SCREENSHOT': '屏幕截图',
  'BROWSER_EVALUATE': '执行脚本',
  'BROWSER_WAIT_FOR': '等待元素',
  'BROWSER_ACT': '执行操作',
  'BROWSER_USE': '协议激活',
  'SESSION_ACTIVE': '会话激活'
};

const HIGH_RISK_TEXT_PATTERNS = [
  /delete/i, /remove/i, /destroy/i, /drop/i, /pay/i, /purchase/i, /submit/i, /send/i, /publish/i,
  /approve/i, /reject/i, /删除/, /移除/, /支付/, /购买/, /提交/, /发送/, /发布/, /审批/, /通过/, /拒绝/
];

export function updateActiveOperations(delta: number) {
  activeOperations += delta;
}

export function setStickyMask(active: boolean) {
  isStickyMask = active;
}

export function updateOverlay(tool?: string, params?: Record<string, any>) {
  if (activeOperations > 0 || isStickyMask) {
    lastActiveTime = Date.now();
    showSciFiOverlay(tool, params);
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(() => {
      if (isStickyMask) {
        isStickyMask = false;
        hideSciFiOverlay();
      }
    }, AUTO_CLOSE_TIMEOUT);
  } else {
    const elapsed = Date.now() - lastActiveTime;
    const remaining = Math.max(0, MIN_OVERLAY_TIME - elapsed);
    setTimeout(() => {
      if (activeOperations === 0 && !isStickyMask) {
        hideSciFiOverlay();
      }
    }, remaining);
  }
}

export function showSciFiOverlay(tool?: string, params?: Record<string, any>) {
  let overlay = document.getElementById('browser-bridge-agent-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'browser-bridge-agent-overlay';
    overlay.style.cssText = 'position: fixed; top: 8px; right: 8px; width: 240px; pointer-events: none; z-index: 2147483647; font-family: sans-serif; transition: opacity 0.2s ease, transform 0.2s ease;';
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; flex-direction: column; gap: 4px; color: #0f172a; background: rgba(255, 255, 255, 0.92); border: 1px solid rgba(15, 23, 42, 0.1); border-radius: 6px; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.12); padding: 6px 10px; overflow: hidden;';
    const statusBadge = document.createElement('div');
    statusBadge.id = 'bb-status-badge';
    statusBadge.style.cssText = 'display: flex; align-items: center; gap: 8px; min-width: 0;';
    const dot = document.createElement('div');
    dot.style.cssText = 'width: 8px; height: 8px; flex: 0 0 auto; background: #16a34a; border-radius: 999px; box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.14); animation: bb-agent-pulse 1.4s ease-in-out infinite;';
    const statusText = document.createElement('div');
    statusText.id = 'bb-status-text';
    statusText.style.cssText = 'color: #0f172a; font-size: 12px; font-weight: 700; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    statusText.innerText = 'Browser Bridge 正在操作';
    statusBadge.appendChild(dot);
    statusBadge.appendChild(statusText);
    const logContainer = document.createElement('div');
    logContainer.id = 'bb-log-container';
    logContainer.style.cssText = 'font-family: monospace; font-size: 10px; color: #475569; line-height: 1.4; max-height: 56px; overflow: hidden;';
    if (!document.getElementById('bb-overlay-style')) {
      const style = document.createElement('style');
      style.id = 'bb-overlay-style';
      style.textContent = '@keyframes bb-agent-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(0.72); opacity: 0.55; } }';
      document.head.appendChild(style);
    }
    container.appendChild(statusBadge);
    container.appendChild(logContainer);
    overlay.appendChild(container);
    document.documentElement.appendChild(overlay);
  } else {
    overlay.style.display = 'block';
    overlay.style.opacity = '1';
    overlay.style.transform = 'translateY(0)';
  }
  if (tool) {
    const logContainer = document.getElementById('bb-log-container');
    if (logContainer) {
      const entry = document.createElement('div');
      entry.style.cssText = 'opacity: 0; transform: translateY(-4px); transition: all 0.18s ease; padding-top: 5px; border-top: 1px solid rgba(15, 23, 42, 0.08);';
      let paramText = '';
      if (params) {
        const entries = Object.entries(params)
          .filter(([key, val]) => val !== undefined && key !== '__confirmedHighRisk' && key !== 'use')
          .map(([key, val]) => {
            const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
            const truncated = str.length > 30 ? str.substring(0, 27) + '...' : str;
            return '<span style="color:#64748b;font-size:10px;margin-right:6px;">' + key + ': ' + truncated + '</span>';
          });
        if (entries.length > 0) paramText = '<div style="display:flex;flex-wrap:wrap;margin-top:2px;">' + entries.join('') + '</div>';
      }
      entry.innerHTML = '<div style="display:flex;align-items:center;gap:6px;"><span style="color:#2563eb;font-weight:700;font-size:11px;">' + (TOOL_NAME_MAP[tool.toUpperCase()] || tool.toUpperCase().replace('BROWSER_', '')) + '</span></div>' + paramText;
      logContainer.appendChild(entry);
      requestAnimationFrame(() => { entry.style.opacity = '1'; entry.style.transform = 'translateY(0)'; });
      if (logContainer.childNodes.length > 2) logContainer.removeChild(logContainer.firstChild!);
    }
    const statusText = document.getElementById('bb-status-text');
    if (statusText) statusText.innerText = 'Browser Bridge：' + (TOOL_NAME_MAP[tool.toUpperCase()] || tool.toUpperCase().replace('BROWSER_', ''));
  }
}

export function hideSciFiOverlay() {
  const overlay = document.getElementById('browser-bridge-agent-overlay');
  if (overlay) {
    overlay.style.opacity = '0';
    overlay.style.transform = 'translateY(-6px)';
    setTimeout(() => {
      if (activeOperations === 0 && !isStickyMask) {
        overlay.style.display = 'none';
        const logContainer = document.getElementById('bb-log-container');
        if (logContainer) logContainer.innerHTML = '';
      }
    }, 300);
  }
}

export function drawVisualOverlay() {
  removeVisualOverlay();
  const overlay = document.createElement('div');
  overlay.id = 'browser-bridge-visual-mapping';
  overlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2147483646;';
  document.body.appendChild(overlay);
  const elements = getActionableElements({ visibleOnly: true, viewportOnly: true });
  elements.forEach((el, index) => {
    const rect = el.getBoundingClientRect();
    const box = document.createElement('div');
    const id = index + 1;
    el.setAttribute('data-bb-temp-id', String(id));
    box.style.cssText = 'position: fixed; top: ' + rect.top + 'px; left: ' + rect.left + 'px; width: ' + rect.width + 'px; height: ' + rect.height + 'px; border: 2px solid #ef4444; background: rgba(239, 68, 68, 0.1); box-sizing: border-box; pointer-events: none;';
    const label = document.createElement('div');
    label.innerText = String(id);
    label.style.cssText = 'position: absolute; top: -20px; left: 0; background: #ef4444; color: white; font-size: 12px; padding: 0 4px; border-radius: 2px; line-height: 18px; white-space: nowrap;';
    box.appendChild(label);
    overlay.appendChild(box);
  });
}

export function removeVisualOverlay() {
  const overlay = document.getElementById('browser-bridge-visual-mapping');
  if (overlay) overlay.remove();
  document.querySelectorAll('[data-bb-temp-id]').forEach(el => el.removeAttribute('data-bb-temp-id'));
}

export function showVisualRipple(element: HTMLElement, color: string = '#ef4444') {
  const rect = element.getBoundingClientRect();
  const ripple = document.createElement('div');
  ripple.style.cssText = 'position: fixed; top: ' + (rect.top + rect.height / 2) + 'px; left: ' + (rect.left + rect.width / 2) + 'px; width: 2px; height: 2px; background: transparent; border: 4px solid ' + color + '; border-radius: 50%; pointer-events: none; z-index: 2147483647; transform: translate(-50%, -50%); animation: bb-ripple-animation 0.6s ease-out forwards;';
  if (!document.getElementById('bb-ripple-style')) {
    const style = document.createElement('style');
    style.id = 'bb-ripple-style';
    style.textContent = '@keyframes bb-ripple-animation { 0% { width: 0; height: 0; opacity: 1; border-width: 4px; } 100% { width: 100px; height: 100px; opacity: 0; border-width: 1px; } }';
    document.head.appendChild(style);
  }
  document.body.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
}

export async function assertElementClickSafe(element: HTMLElement) {
  const directText = [getElementText(element), element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('value')].filter(Boolean).join(' ');
  const contextText = getNearbyText(element);
  const combinedText = directText + ' ' + contextText;
  if (HIGH_RISK_TEXT_PATTERNS.some((pattern) => pattern.test(combinedText))) {
    const confirmed = await showConfirmationOverlay('Agent 试图执行高风险浏览器操作。\n\n【元素文本】: ' + (directText || '(空)') + '\n【附近文本】: ' + (truncate(contextText, 100) || '(无)'));
    if (!confirmed) throw new Error('USER_REJECTED: 用户已取消高风险浏览器操作');
  }
}

export function showConfirmationOverlay(reason: string): Promise<boolean> {
  return new Promise((resolve) => {
    document.querySelector('#browser-bridge-confirm-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'browser-bridge-confirm-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; background:rgba(11,18,32,.48); font-family:sans-serif;';
    const panel = document.createElement('div');
    panel.style.cssText = 'box-sizing:border-box; width:min(420px,calc(100vw - 32px)); border-radius:8px; background:#fff; box-shadow:0 18px 50px rgba(0,0,0,.28); padding:18px; color:#172026;';
    const title = document.createElement('h2');
    title.textContent = '确认浏览器操作';
    const body = document.createElement('p');
    body.textContent = reason;
    body.style.cssText = 'margin:0 0 14px;font-size:13px;line-height:1.5;color:#3c4852;white-space:pre-line';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:10px;justify-content:flex-end';
    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.textContent = '确认执行';
    cancel.addEventListener('click', () => { overlay.remove(); resolve(false); });
    confirm.addEventListener('click', () => { overlay.remove(); resolve(true); });
    actions.append(cancel, confirm);
    panel.append(title, body, actions);
    overlay.append(panel);
    document.documentElement.append(overlay);
  });
}