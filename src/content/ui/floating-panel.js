/**
 * Floating panel UI injected into ChatGPT page.
 *
 * Renders the extension sidepanel UI inside an iframe.
 *
 * Features:
 * - Borderless floating window (rounded + shadow)
 * - Drag to move
 * - Resize (native CSS resize)
 * - Opacity slider
 * - Minimize / restore
 * - Lock (pin) to prevent drag/resize
 * - Click-through mode (let mouse events pass to page)
 *   - includes a small peel handle to exit click-through
 * - Persist state in chrome.storage.local
 */

import { log, throttle } from '../../shared/utils.js';

const PANEL_ID = '__chatgpt_graph_floating_panel__';
const STYLE_ID = '__chatgpt_graph_floating_panel_style__';
const STORAGE_KEY = 'chatgpt_graph_floating_panel_state_v1';

const DEFAULT_STATE = {
  x: 24,
  y: 88,
  width: 420,
  height: 640,
  opacity: 0.96,
  minimized: false,
  locked: false,
  clickThrough: false,
  /**
   * User preference: hide the toolbar for a clean, distraction-free view.
   * Note: the toolbar is ALSO forced hidden while locked or in click-through.
   */
  controlsHidden: false
};

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

async function loadState() {
  try {
    const res = await chrome.storage.local.get([STORAGE_KEY]);
    const s = res?.[STORAGE_KEY];
    if (!s || typeof s !== 'object') return { ...DEFAULT_STATE };
    return {
      ...DEFAULT_STATE,
      ...s,
      opacity: clamp(Number(s.opacity ?? DEFAULT_STATE.opacity), 0.25, 1)
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

const saveState = throttle(async (partial) => {
  try {
    const res = await chrome.storage.local.get([STORAGE_KEY]);
    const prev = res?.[STORAGE_KEY] && typeof res[STORAGE_KEY] === 'object' ? res[STORAGE_KEY] : {};
    const next = { ...DEFAULT_STATE, ...prev, ...partial };
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  } catch (e) {
    // ignore
  }
}, 120);

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      z-index: 2147483646;
      border-radius: 14px;
      box-shadow: 0 10px 28px rgba(0,0,0,.18);
      background: rgba(255,255,255,.86);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      /*
        IMPORTANT: opacity should affect the WHOLE floating window (including background),
        so users can see the page beneath it.

        Previously we only applied opacity to .cg-body, which made the iframe contents fade
        but kept the panel background nearly solid white.
      */
      opacity: var(--cgAlpha, 0.96);
      transition: opacity .12s ease;
      overflow: hidden;
      resize: both;
      min-width: 320px;
      min-height: 240px;
      max-width: min(92vw, 840px);
      max-height: 92vh;
      display: flex;
      flex-direction: column;
      transform: translateZ(0);
      user-select: none;
    }
    #${PANEL_ID}.cg-controls-hidden .cg-header {
      display: none;
    }
    #${PANEL_ID}.cg-minimized {
      height: 44px !important;
      min-height: 44px !important;
      resize: none;
    }
    #${PANEL_ID}.cg-locked {
      resize: none;
    }
    #${PANEL_ID} .cg-header {
      height: 40px;
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 10px;
      background: rgba(255,255,255,.90);
      border-bottom: 1px solid rgba(15, 23, 42, .08);
      cursor: grab;
    }
    #${PANEL_ID}.cg-locked .cg-header {
      cursor: default;
    }
    #${PANEL_ID} .cg-bar-left,
    #${PANEL_ID} .cg-bar-right {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: default;
    }

    #${PANEL_ID} .cg-view-toggle {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      background: rgba(241, 245, 249, .92);
      border: 1px solid rgba(15, 23, 42, .10);
      border-radius: 10px;
    }
    #${PANEL_ID} .cg-view-btn {
      width: 30px;
      height: 30px;
      border: none;
      background: transparent;
      border-radius: 8px;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
    }
    #${PANEL_ID} .cg-view-btn:hover {
      background: rgba(255,255,255,0.7);
      transform: translateY(-1px);
    }
    #${PANEL_ID} .cg-view-btn.cg-active {
      background: rgba(255,255,255,0.96);
      box-shadow: 0 2px 10px rgba(0,0,0,0.10);
    }
    #${PANEL_ID} .cg-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: default;
    }
    #${PANEL_ID} .cg-btn {
      width: 28px;
      height: 28px;
      border: 1px solid rgba(15, 23, 42, .10);
      background: rgba(255, 255, 255, .86);
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform .12s ease, background .12s ease, border-color .12s ease;
    }
    #${PANEL_ID} .cg-btn:hover {
      transform: translateY(-1px);
      background: rgba(248, 250, 252, .96);
      border-color: rgba(15, 23, 42, .18);
    }
    #${PANEL_ID} .cg-btn:active {
      transform: translateY(0);
    }
    #${PANEL_ID} .cg-btn.cg-active {
      border-color: rgba(37, 99, 235, .45);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, .14);
    }
    #${PANEL_ID} .cg-opacity {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px;
      border: 1px solid rgba(15, 23, 42, .10);
      border-radius: 999px;
      background: rgba(255,255,255,.86);
      height: 28px;
    }
    #${PANEL_ID} .cg-opacity input[type="range"] {
      width: 96px;
      accent-color: #2563eb;
    }
    #${PANEL_ID} .cg-body {
      flex: 1 1 auto;
      min-height: 0;
    }
    #${PANEL_ID}.cg-minimized .cg-body {
      display: none;
    }
    #${PANEL_ID} iframe {
      width: 100%;
      height: 100%;
      border: none;
      background: transparent;
    }

    #${PANEL_ID} .cg-handle {
      position: absolute;
      top: 10px;
      right: 10px;
      width: 34px;
      height: 34px;
      border-radius: 12px;
      border: 1px solid rgba(15, 23, 42, .12);
      background: rgba(255, 255, 255, .92);
      box-shadow: 0 8px 22px rgba(0,0,0,.18);
      display: none;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 3;
      opacity: 0.35;
      transition: opacity 0.15s ease, transform 0.12s ease;
    }
    #${PANEL_ID} .cg-handle:hover {
      opacity: 1;
      transform: translateY(-1px);
    }
    #${PANEL_ID}.cg-controls-hidden .cg-handle {
      display: flex;
    }
    #${PANEL_ID}.cg-through .cg-handle {
      display: none;
    }

    #${PANEL_ID} .cg-popover {
      position: absolute;
      top: 10px;
      left: 10px;
      right: 10px;
      padding: 10px;
      border-radius: 14px;
      border: 1px solid rgba(15, 23, 42, .12);
      background: rgba(255,255,255,.94);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 14px 34px rgba(0,0,0,.20);
      display: none;
      z-index: 4;
    }
    #${PANEL_ID}.cg-popover-open .cg-popover {
      display: block;
    }

    #${PANEL_ID} .cg-popover-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    #${PANEL_ID} .cg-popover-row + .cg-popover-row {
      margin-top: 10px;
    }
    #${PANEL_ID} .cg-popover-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1 1 auto;
      min-width: 0;
    }
    #${PANEL_ID} .cg-popover-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
    }
    #${PANEL_ID} .cg-popover-label {
      font: 600 12px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      color: rgba(15, 23, 42, .86);
      white-space: nowrap;
    }
    #${PANEL_ID}.cg-through {
      pointer-events: none;
    }
    #${PANEL_ID}.cg-through .cg-peel {
      pointer-events: auto;
    }
    #${PANEL_ID}.cg-through .cg-popover {
      display: none !important;
    }
    #${PANEL_ID} .cg-peel {
      position: absolute;
      top: 10px;
      left: 10px;
      width: 28px;
      height: 28px;
      border-radius: 10px;
      border: 1px solid rgba(15, 23, 42, .12);
      background: rgba(255, 255, 255, .92);
      box-shadow: 0 8px 22px rgba(0,0,0,.18);
      display: none;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 2;
    }
    #${PANEL_ID}.cg-through .cg-peel {
      display: flex;
    }
  `.trim();
  document.documentElement.appendChild(style);
}

function getPanelEl() {
  return document.getElementById(PANEL_ID);
}

function applyState(panel, state) {
  panel.style.left = `${state.x}px`;
  panel.style.top = `${state.y}px`;
  panel.style.width = `${state.width}px`;
  panel.style.height = `${state.height}px`;
  panel.style.setProperty('--cgAlpha', String(state.opacity));
  panel.classList.toggle('cg-minimized', !!state.minimized);
  panel.classList.toggle('cg-locked', !!state.locked);
  panel.classList.toggle('cg-through', !!state.clickThrough);

  // Effective toolbar visibility: user-hidden OR forced hidden while locked / click-through.
  const effectiveHidden = !!state.controlsHidden || !!state.locked || !!state.clickThrough;
  panel.classList.toggle('cg-controls-hidden', effectiveHidden);

  panel.querySelectorAll('[data-action="lock"]').forEach((btn) => {
    btn.classList.toggle('cg-active', !!state.locked);
  });
  panel.querySelectorAll('[data-action="through"]').forEach((btn) => {
    btn.classList.toggle('cg-active', !!state.clickThrough);
  });
  panel.querySelectorAll('[data-action="toggleToolbar"]').forEach((btn) => {
    btn.classList.toggle('cg-active', !state.controlsHidden);
  });

  // Disable resize when locked
  panel.style.resize = state.locked || state.minimized ? 'none' : 'both';
}

function keepOnScreen(state) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = clamp(state.width, 320, Math.min(840, Math.floor(vw * 0.92)));
  const h = clamp(state.height, 240, Math.floor(vh * 0.92));
  const x = clamp(state.x, 8, Math.max(8, vw - w - 8));
  const y = clamp(state.y, 8, Math.max(8, vh - h - 8));
  return { ...state, x, y, width: w, height: h };
}

function setupDragging(panel, getState, setState) {
  const header = panel.querySelector('.cg-header');
  if (!header) return;

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  const isInteractive = (el) => {
    if (!el) return false;
    return (
      el.closest('button') ||
      el.closest('input') ||
      el.closest('select') ||
      el.closest('a')
    );
  };

  header.addEventListener('pointerdown', (e) => {
    const state = getState();
    if (state.locked) return;
    if (isInteractive(e.target)) return;
    dragging = true;
    header.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    originX = state.x;
    originY = state.y;
    header.style.cursor = 'grabbing';
    e.preventDefault();
  });

  header.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const next = keepOnScreen({ ...getState(), x: originX + dx, y: originY + dy });
    setState(next);
    applyState(panel, next);
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    header.style.cursor = '';
    const s = getState();
    saveState({ x: s.x, y: s.y });
  };

  header.addEventListener('pointerup', endDrag);
  header.addEventListener('pointercancel', endDrag);
}

function setupResizePersistence(panel, getState, setState) {
  const ro = new ResizeObserver(() => {
    const s = getState();
    if (s.minimized || s.locked) return;
    const rect = panel.getBoundingClientRect();
    const next = keepOnScreen({ ...s, width: Math.round(rect.width), height: Math.round(rect.height) });
    setState(next);
    // IMPORTANT: when resizing hits the viewport bounds, we may need to
    // adjust x/y to keep the toolbar (and the whole panel) on screen.
    applyState(panel, next);
    saveState({ width: next.width, height: next.height, x: next.x, y: next.y });
  });
  ro.observe(panel);
}

function buildPanel(state, setState, getState) {
  ensureStyles();

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'ChatGPT Graph Floating Panel');

  const header = document.createElement('div');
  header.className = 'cg-header';
  header.innerHTML = `
    <div class="cg-bar-left">
      <div class="cg-view-toggle" role="tablist" aria-label="View mode">
        <button class="cg-view-btn" data-action="view" data-mode="graph" title="Graph">🗺️</button>
        <button class="cg-view-btn" data-action="view" data-mode="tree" title="Tree">🌿</button>
      </div>
    </div>
    <div class="cg-bar-right">
      <button class="cg-btn" data-action="refresh" title="Refresh">🔄</button>
      <button class="cg-btn" data-action="menu" title="More">⋯</button>
      <button class="cg-btn" data-action="hideToolbar" title="Hide toolbar">▾</button>
    </div>
  `.trim();

  const body = document.createElement('div');
  body.className = 'cg-body';

  const iframe = document.createElement('iframe');
  // Pass a hint to the UI so it can tighten spacing if needed.
  iframe.src = chrome.runtime.getURL('src/sidepanel/index.html?embedded=1');
  iframe.loading = 'lazy';
  iframe.allow = 'clipboard-read; clipboard-write';
  body.appendChild(iframe);

  const peel = document.createElement('button');
  peel.className = 'cg-peel';
  peel.title = 'Exit click-through (Alt+Shift+T)';
  peel.textContent = '↩';

  const handle = document.createElement('button');
  handle.className = 'cg-handle';
  handle.title = 'Controls';
  handle.textContent = '⋯';

  const popover = document.createElement('div');
  popover.className = 'cg-popover';
  popover.innerHTML = `
    <div class="cg-popover-row">
      <div class="cg-popover-left">
        <span class="cg-popover-label">View</span>
        <div class="cg-view-toggle" role="tablist" aria-label="View mode">
          <button class="cg-view-btn" data-action="view" data-mode="graph" title="Graph">🗺️</button>
          <button class="cg-view-btn" data-action="view" data-mode="tree" title="Tree">🌿</button>
        </div>
      </div>
      <div class="cg-popover-right">
        <button class="cg-btn" data-action="refresh" title="Refresh">🔄</button>
        <button class="cg-btn" data-action="closePopover" title="Close">✕</button>
      </div>
    </div>
    <div class="cg-popover-row">
      <div class="cg-popover-left">
        <span class="cg-popover-label">Opacity</span>
        <div class="cg-opacity" title="Opacity">
          <span style="font-size:12px; opacity:.85;">α</span>
          <input data-action="opacity" type="range" min="0.25" max="1" step="0.05" value="${state.opacity}">
        </div>
      </div>
      <div class="cg-popover-right">
        <button class="cg-btn" data-action="toggleToolbar" title="Toggle toolbar">🧰</button>
      </div>
    </div>
    <div class="cg-popover-row">
      <div class="cg-popover-left">
        <span class="cg-popover-label">Window</span>
      </div>
      <div class="cg-popover-right">
        <button class="cg-btn" data-action="lock" title="Lock / Unlock (Alt+Shift+L)">📌</button>
        <button class="cg-btn" data-action="through" title="Click-through (Alt+Shift+T)">🫥</button>
        <button class="cg-btn" data-action="minimize" title="Minimize / Restore">—</button>
        <button class="cg-btn" data-action="close" title="Close (Esc)">✕</button>
      </div>
    </div>
  `.trim();

  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(peel);
  panel.appendChild(handle);
  panel.appendChild(popover);

  const closePopover = () => {
    panel.classList.remove('cg-popover-open');
  };
  const openPopover = () => {
    if (getState().clickThrough) return;
    panel.classList.add('cg-popover-open');
  };
  const togglePopover = () => {
    if (panel.classList.contains('cg-popover-open')) closePopover();
    else openPopover();
  };

  const postToIframe = (type, payload = {}) => {
    try {
      if (!iframe.contentWindow) return;
      iframe.contentWindow.postMessage({ type, payload }, '*');
    } catch {
      // ignore
    }
  };

  const setActiveViewMode = (mode) => {
    panel.querySelectorAll('[data-action="view"]').forEach((btn) => {
      btn.classList.toggle('cg-active', btn.dataset.mode === mode);
    });
  };

  // Try to sync initial view mode from the embedded UI
  iframe.addEventListener('load', () => {
    postToIframe('CG_REQUEST_VIEW_MODE', {});
  });

  // Listen for view mode updates from iframe
  const msgHandler = (e) => {
    if (e?.source !== iframe.contentWindow) return;
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'CG_VIEW_MODE' && data.payload?.mode) {
      setActiveViewMode(String(data.payload.mode));
    }
  };
  panel.__cgMsgHandler = msgHandler;
  window.addEventListener('message', msgHandler);

  // Wire actions
  panel.querySelectorAll('[data-action="close"]').forEach((btn) => {
    btn.addEventListener('click', () => closeFloatingPanel());
  });

  panel.querySelectorAll('[data-action="minimize"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closePopover();
      const next = { ...getState(), minimized: !getState().minimized };
      setState(next);
      applyState(panel, next);
      saveState({ minimized: next.minimized });
    });
  });

  panel.querySelectorAll('[data-action="lock"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      // When locking, auto-hide controls (as requested) and close the control bar.
      const next = { ...getState(), locked: !getState().locked };
      setState(next);
      closePopover();
      applyState(panel, next);
      saveState({ locked: next.locked });
    });
  });

  panel.querySelectorAll('[data-action="through"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = { ...getState(), clickThrough: !getState().clickThrough };
      setState(next);
      closePopover();
      applyState(panel, next);
      saveState({ clickThrough: next.clickThrough });
    });
  });

  peel.addEventListener('click', () => {
    const next = { ...getState(), clickThrough: false };
    setState(next);
    applyState(panel, next);
    saveState({ clickThrough: false });
  });

  panel.querySelectorAll('[data-action="opacity"]').forEach((input) => {
    input.addEventListener('input', (e) => {
      const v = clamp(Number(e.target.value), 0.25, 1);
      const next = { ...getState(), opacity: v };
      setState(next);
      applyState(panel, next);
      saveState({ opacity: v });
    });
  });

  panel.querySelectorAll('[data-action="refresh"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closePopover();
      postToIframe('CG_REFRESH', {});
    });
  });

  panel.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const mode = btn.dataset.mode;
      if (!mode) return;
      setActiveViewMode(mode);
      postToIframe('CG_SET_VIEW_MODE', { mode });
      e.stopPropagation();
    });
  });

  header.querySelector('[data-action="menu"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover();
  });
  panel.querySelectorAll('[data-action="closePopover"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePopover();
    });
  });

  header.querySelector('[data-action="hideToolbar"]')?.addEventListener('click', () => {
    closePopover();
    const next = { ...getState(), controlsHidden: true };
    setState(next);
    applyState(panel, next);
    saveState({ controlsHidden: true });
  });

  panel.querySelectorAll('[data-action="toggleToolbar"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = { ...getState(), controlsHidden: !getState().controlsHidden };
      setState(next);
      applyState(panel, next);
      saveState({ controlsHidden: next.controlsHidden });
    });
  });

  // Handle button: click to open popover; drag to move (when unlocked)
  let hDragging = false;
  let hMoved = false;
  let hStartX = 0;
  let hStartY = 0;
  let hOriginX = 0;
  let hOriginY = 0;

  handle.addEventListener('pointerdown', (e) => {
    const s = getState();
    hDragging = false;
    hMoved = false;
    hStartX = e.clientX;
    hStartY = e.clientY;
    hOriginX = s.x;
    hOriginY = s.y;

    if (!s.locked && !s.clickThrough) {
      handle.setPointerCapture(e.pointerId);
    }
  });
  handle.addEventListener('pointermove', (e) => {
    const s = getState();
    if (s.locked || s.clickThrough) return;
    const dx = e.clientX - hStartX;
    const dy = e.clientY - hStartY;
    if (!hDragging) {
      if (Math.abs(dx) + Math.abs(dy) < 4) return;
      hDragging = true;
      hMoved = true;
      closePopover();
    }
    const next = keepOnScreen({ ...s, x: hOriginX + dx, y: hOriginY + dy });
    setState(next);
    applyState(panel, next);
    e.preventDefault();
  });
  handle.addEventListener('pointerup', () => {
    const s = getState();
    if (hMoved) {
      saveState({ x: s.x, y: s.y });
      return;
    }
    togglePopover();
  });

  // Clicking outside closes the popover (but not the floating panel)
  const docPointerHandler = (e) => {
    if (!panel.classList.contains('cg-popover-open')) return;
    if (popover.contains(e.target)) return;
    if (handle.contains(e.target)) return;
    const menu = header.querySelector('[data-action="menu"]');
    if (menu && menu.contains(e.target)) return;
    closePopover();
  };
  panel.__cgDocPointerHandler = docPointerHandler;
  document.addEventListener('pointerdown', docPointerHandler, true);

  // Dragging + resize persistence
  setupDragging(panel, getState, setState);
  setupResizePersistence(panel, getState, setState);

  // Escape closes (only when panel exists)
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeFloatingPanel();
    }
  };
  panel.__cgEscHandler = escHandler;
  window.addEventListener('keydown', escHandler, { capture: true });

  // Apply initial
  applyState(panel, state);

  // Expose state accessors for hotkey actions
  panel.__cgGetState = getState;
  panel.__cgSetState = setState;

  return panel;
}

export async function ensureFloatingPanel() {
  const existing = getPanelEl();
  if (existing) return existing;

  let state = keepOnScreen(await loadState());
  const getState = () => state;
  const setState = (next) => {
    state = next;
  };

  const panel = buildPanel(state, setState, getState);
  document.documentElement.appendChild(panel);
  await saveState({ ...state });
  log('info', 'FloatingPanel', 'Panel created');
  return panel;
}

export function closeFloatingPanel() {
  const panel = getPanelEl();
  if (!panel) return;
  try {
    if (panel.__cgEscHandler) {
      window.removeEventListener('keydown', panel.__cgEscHandler, { capture: true });
    }
    if (panel.__cgMsgHandler) {
      window.removeEventListener('message', panel.__cgMsgHandler);
    }
    if (panel.__cgDocPointerHandler) {
      document.removeEventListener('pointerdown', panel.__cgDocPointerHandler, true);
    }
  } catch {
    // ignore
  }
  panel.remove();
  log('info', 'FloatingPanel', 'Panel closed');
}

export async function toggleFloatingPanel() {
  const panel = getPanelEl();
  if (panel) {
    closeFloatingPanel();
    return false;
  }
  await ensureFloatingPanel();
  return true;
}

export async function toggleClickThrough() {
  const panel = getPanelEl();
  if (!panel) return;
  const state = panel.__cgGetState ? panel.__cgGetState() : keepOnScreen(await loadState());
  const next = keepOnScreen({ ...state, clickThrough: !state.clickThrough });
  panel.__cgSetState?.(next);
  if (next.clickThrough) panel.classList.remove('cg-popover-open');
  applyState(panel, next);
  await saveState({ clickThrough: next.clickThrough });
}

export async function toggleLock() {
  const panel = getPanelEl();
  if (!panel) return;
  const state = panel.__cgGetState ? panel.__cgGetState() : keepOnScreen(await loadState());
  const next = keepOnScreen({ ...state, locked: !state.locked });
  panel.__cgSetState?.(next);
  if (next.locked) panel.classList.remove('cg-popover-open');
  applyState(panel, next);
  await saveState({ locked: next.locked });
}
