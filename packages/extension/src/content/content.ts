import { type BridgeRequest } from '@majuntao-1/browser-bridge-shared';
import * as DomInteractor from './services/dom-interactor.js';
import * as PageModel from './services/page-model.js';
import * as VisualEngine from './services/visual-engine.js';
import * as UIOverlay from './services/ui-overlay.js';
import * as Recorder from './services/recorder.js';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'browser_bridge_ping') { sendResponse({ ok: true }); return true; }
  if (message?.type === 'browser_bridge_hide_status') { const el = document.getElementById('browser-bridge-agent-overlay'); if (el) el.style.visibility = 'hidden'; sendResponse({ ok: true }); return true; }
  if (message?.type === 'browser_bridge_show_status') { const el = document.getElementById('browser-bridge-agent-overlay'); if (el) el.style.visibility = 'visible'; sendResponse({ ok: true }); return true; }
  if (message?.type === 'browser_bridge_draw_overlay') { UIOverlay.drawVisualOverlay(); sendResponse({ ok: true }); return true; }
  if (message?.type === 'browser_bridge_remove_overlay') { UIOverlay.removeVisualOverlay(); sendResponse({ ok: true }); return true; }
  if (message?.type === 'browser_bridge_toggle_recording') { Recorder.setRecordingListeners(Boolean(message.enabled)); sendResponse({ ok: true }); return true; }
  if (message?.type === 'agent_session_status') { UIOverlay.setStickyMask(Boolean(message.active)); UIOverlay.updateOverlay(message.active ? 'SESSION_ACTIVE' : undefined); sendResponse({ ok: true }); return true; }
  
  if (message?.type === 'browser_bridge_request') {
    const request = message.request as BridgeRequest;
    UIOverlay.updateActiveOperations(1);
    UIOverlay.updateOverlay(request.tool, request.params);
    handleRequest(request).then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }))
      .finally(() => { UIOverlay.updateActiveOperations(-1); UIOverlay.updateOverlay(); });
    return true;
  }
  return false;
});

async function handleRequest(request: BridgeRequest): Promise<unknown> {
  const p = request.params ?? {};
  switch (request.tool) {
    case 'browser_get_page_text': return PageModel.getVisibleText();
    case 'browser_get_page_snapshot': return PageModel.getPageSnapshot();
    case 'browser_get_page_model': return PageModel.getPageModel(p);
    case 'browser_get_interactives': return { elements: PageModel.getPageSnapshot().elements.slice(0, 50) };
    case 'browser_find': return { matched: true, matches: DomInteractor.scoreElements(p).slice(0, 8).map(m => DomInteractor.toBrowserElement(m.element, 0)) };
    case 'browser_act': return DomInteractor.clickElement(p); // Placeholder for complex act
    case 'browser_click':
    case 'browser_find_and_click': return DomInteractor.clickElement(p);
    case 'browser_type':
    case 'browser_find_and_type': return DomInteractor.typeIntoElement(p);
    case 'browser_select_option': return DomInteractor.clickElement(p); // Placeholder
    case 'browser_hover': return DomInteractor.hoverElement(p);
    case 'browser_clear': return DomInteractor.clearElement(p);
    case 'browser_scroll': return DomInteractor.scrollPage(p);
    case 'browser_wait_for': return DomInteractor.waitForElement(p, request.timeoutMs);
    case 'browser_assert_text': return { asserted: PageModel.getVisibleText().includes(String(p.text || '')) };
    case 'browser_get_selected_text': return PageModel.getSelectedText();
    case 'browser_get_links': return PageModel.getLinks();
    case 'browser_visual_observe': return VisualEngine.visualObserve(p);
    case 'browser_visual_click_text': return VisualEngine.visualClickText(p, request.timeoutMs);
    case 'browser_visual_select': return VisualEngine.visualSelect(p, request.timeoutMs);
    case 'browser_visual_task': return VisualEngine.visualTask(p, request.timeoutMs);
    case 'browser_visual_resolve_text': return VisualEngine.visualClickText(p, request.timeoutMs);
    case 'browser_get_form_structure': return getFormStructure();
    case 'browser_fill_form_smart': return fillFormSmart(Array.isArray(p.fields) ? p.fields : [], { dryRun: p.dryRun === true });
    default: throw new Error('Unsupported tool: ' + request.tool);
  }
}
}