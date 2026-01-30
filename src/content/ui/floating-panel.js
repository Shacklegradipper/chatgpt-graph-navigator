/**
 * Floating panel UI injected into ChatGPT page.
 *
 * Renders the extension sidepanel UI inside an iframe.
 *
 * Features:
 * - Borderless floating window (rounded + shadow)
 * - Drag to move
 * - Resize (custom handle)
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
      /*
        We intentionally DISABLE native CSS resizing.
        Native resizing on a fixed element can lead to "stuck" pointer states
        (cursor remains in resize mode) and jumpy behavior after releasing the mouse
        on some platforms. We use a custom resize handle instead.
      */
      resize: none;
      /* allow a narrower window while keeping controls usable */
      min-width: 280px;
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
    /* Allow the control popover to render outside the panel bounds (especially when minimized). */
    #${PANEL_ID}.cg-popover-open {
      overflow: visible;
    }
    #${PANEL_ID}.cg-minimized {
      height: 44px !important;
      min-height: 44px !important;
      resize: none;
      overflow: visible;
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
      flex-wrap: nowrap;
      white-space: nowrap;
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
      min-width: 0;
    }

    /* ------------------------------------------------------------
       Responsive header (1 line max)

       Problem:
       - When the floating window is resized narrow, right-aligned buttons can clip.

       Strategy:
       - Keep the header as a single row (no wrap)
       - Shrink flexible controls first (sliders)
       - If still overflowing, progressively hide low-priority controls
         (opacity slider -> view toggle -> refresh) while keeping essentials.
    ------------------------------------------------------------ */
    #${PANEL_ID}[data-cg-compact="1"] .cg-header {
      padding: 0 8px;
      gap: 6px;
    }
    #${PANEL_ID}[data-cg-compact="1"] .cg-bar-left,
    #${PANEL_ID}[data-cg-compact="1"] .cg-bar-right {
      gap: 4px;
    }
    #${PANEL_ID}[data-cg-compact="1"] .cg-btn {
      width: 26px;
      height: 26px;
      border-radius: 7px;
    }
    #${PANEL_ID}[data-cg-compact="1"] .cg-view-btn {
      width: 28px;
      height: 28px;
      border-radius: 7px;
    }
    #${PANEL_ID}[data-cg-compact="1"] .cg-header .cg-opacity input[type="range"] {
      width: 56px;
    }
    #${PANEL_ID}[data-cg-compact="2"] .cg-header .cg-opacity {
      display: none;
    }
    #${PANEL_ID}[data-cg-compact="3"] .cg-header .cg-view-toggle {
      display: none;
    }
    #${PANEL_ID}[data-cg-compact="4"] .cg-header .cg-bar-left [data-action="refresh"] {
      display: none;
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
    /* Header needs to stay compact when the panel is narrow */
    #${PANEL_ID} .cg-header .cg-opacity input[type="range"] {
      width: 74px;
    }
    @media (max-width: 340px) {
      #${PANEL_ID} .cg-header .cg-opacity input[type="range"] {
        width: 56px;
      }
    }

    /*
      Responsive header fitting (no clipping):
      The floating window top bar must stay a SINGLE line.
      We progressively compact/hide low-priority controls when needed.
    */
    #${PANEL_ID}[data-cg-compact="1"] .cg-header {
      padding: 0 8px;
      gap: 6px;
    }
    #${PANEL_ID}[data-cg-compact="1"] .cg-bar-left,
    #${PANEL_ID}[data-cg-compact="1"] .cg-bar-right {
      gap: 4px;
    }
    #${PANEL_ID}[data-cg-compact="1"] .cg-btn {
      width: 26px;
      height: 26px;
      border-radius: 7px;
    }
    #${PANEL_ID}[data-cg-compact="1"] .cg-view-btn {
      width: 28px;
      height: 28px;
      border-radius: 7px;
    }
    #${PANEL_ID}[data-cg-compact="1"] .cg-header .cg-opacity input[type="range"] {
      width: 56px;
    }

    /* Hide opacity slider first (still available inside 🧰 controls popover) */
    #${PANEL_ID}[data-cg-compact="2"] .cg-header .cg-opacity {
      display: none;
    }

    /* Then hide view toggle (still available inside popover) */
    #${PANEL_ID}[data-cg-compact="3"] .cg-header .cg-view-toggle {
      display: none;
    }

    /* Finally hide refresh (still available inside popover) */
    #${PANEL_ID}[data-cg-compact="4"] .cg-header [data-action="refresh"] {
      display: none;
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

    #${PANEL_ID} .cg-resizer {
      position: absolute;
      right: 4px;
      bottom: 4px;
      width: 18px;
      height: 18px;
      border-radius: 8px;
      cursor: nwse-resize;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.12;
      transition: opacity .12s ease, transform .12s ease;
      z-index: 2;
      background: rgba(255,255,255,0.35);
      border: 1px solid rgba(15, 23, 42, .10);
      pointer-events: auto;
    }
    #${PANEL_ID}:hover .cg-resizer {
      opacity: 0.55;
    }
    #${PANEL_ID} .cg-resizer:hover {
      opacity: 0.9;
      transform: translateY(-1px);
    }
    #${PANEL_ID} .cg-resizer::before {
      content: '';
      width: 10px;
      height: 10px;
      border-right: 2px solid rgba(15, 23, 42, .35);
      border-bottom: 2px solid rgba(15, 23, 42, .35);
      border-radius: 1px;
      transform: translate(1px, 1px);
    }
    #${PANEL_ID}.cg-locked .cg-resizer,
    #${PANEL_ID}.cg-minimized .cg-resizer,
    #${PANEL_ID}.cg-through .cg-resizer {
      display: none;
    }

    /*
      Mini bar shown when the main toolbar is hidden.
      - Provides a draggable strip
      - Hosts the "search" (when needed) + "show toolbar" button
      - Avoids overlapping the embedded UI (unlike a floating handle)
    */
    #${PANEL_ID} .cg-mini-bar {
      height: 30px;
      flex: 0 0 auto;
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 10px;
      background: rgba(255,255,255,.90);
      border-bottom: 1px solid rgba(15, 23, 42, .08);
      cursor: grab;
    }
    #${PANEL_ID}.cg-locked .cg-mini-bar {
      cursor: default;
    }
    #${PANEL_ID}.cg-controls-hidden .cg-mini-bar {
      display: flex;
    }
    #${PANEL_ID}.cg-through .cg-mini-bar {
      display: none;
    }
    #${PANEL_ID} .cg-mini-left,
    #${PANEL_ID} .cg-mini-right {
      display: flex;
      align-items: center;
      gap: 6px;
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
    btn.classList.toggle('cg-active', !effectiveHidden);
  });

  // Keep both opacity sliders (header + popover) in sync.
  panel.querySelectorAll('input[data-action="opacity"]').forEach((input) => {
    const v = String(state.opacity);
    if (input.value !== v) input.value = v;
  });

  try {
    panel.__cgAfterApplyState?.(state);
  } catch {
    // ignore
  }

  // Native resize is disabled; custom resizer handle is hidden via CSS when locked/minimized.
  panel.style.resize = 'none';
}

function keepOnScreen(state) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = clamp(state.width, 280, Math.min(840, Math.floor(vw * 0.92)));
  const h = clamp(state.height, 240, Math.floor(vh * 0.92));
  const x = clamp(state.x, 8, Math.max(8, vw - w - 8));
  const y = clamp(state.y, 8, Math.max(8, vh - h - 8));
  return { ...state, x, y, width: w, height: h };
}

function setupDragging(panel, dragEl, getState, setState) {
  if (!dragEl) return;

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

  dragEl.addEventListener('pointerdown', (e) => {
    const state = getState();
    if (state.locked) return;
    if (isInteractive(e.target)) return;
    dragging = true;
    dragEl.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    originX = state.x;
    originY = state.y;
    dragEl.style.cursor = 'grabbing';
    e.preventDefault();
  });

  dragEl.addEventListener('pointermove', (e) => {
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
    dragEl.style.cursor = '';
    const s = getState();
    saveState({ x: s.x, y: s.y });
  };

  dragEl.addEventListener('pointerup', endDrag);
  dragEl.addEventListener('pointercancel', endDrag);
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
  panel.dataset.cgCompact = '0';

  const header = document.createElement('div');
  header.className = 'cg-header';
  header.innerHTML = `
    <div class="cg-bar-left">
      <div class="cg-view-toggle" role="tablist" aria-label="View mode">
        <button class="cg-view-btn" data-action="view" data-mode="graph" title="Graph">🗺️</button>
        <button class="cg-view-btn" data-action="view" data-mode="tree" title="Tree">🌿</button>
      </div>
      <button class="cg-btn" data-action="refresh" title="Refresh">🔄</button>
    </div>
    <div class="cg-bar-right">
      <button class="cg-btn cg-search" data-action="search" title="Search" aria-label="Search" style="display:none;">⌕</button>
      <div class="cg-opacity" title="Opacity">
        <span style="font-size:12px; opacity:.85;">α</span>
        <input data-action="opacity" type="range" min="0.25" max="1" step="0.05" value="${state.opacity}">
      </div>
      <button class="cg-btn" data-action="controls" title="Controls">🧰</button>
      <button class="cg-btn" data-action="hideToolbar" title="Hide toolbar">▾</button>
      <button class="cg-btn" data-action="close" title="Close (Esc)">✕</button>
    </div>
  `.trim();

  // Mini bar: shown when the main toolbar is hidden.
  // Keeps the window draggable and exposes:
  // - Search button (only when tree search row is collapsed)
  // - Show toolbar button
  const miniBar = document.createElement('div');
  miniBar.className = 'cg-mini-bar';
  miniBar.innerHTML = `
    <div class="cg-mini-left">
      <button class="cg-btn cg-mini-search" data-action="search" title="Search" aria-label="Search" style="display:none;">⌕</button>
    </div>
    <div class="cg-mini-right">
      <button class="cg-btn" data-action="showToolbar" title="Show toolbar" aria-label="Show toolbar">▴</button>
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
  panel.appendChild(miniBar);
  panel.appendChild(body);
  panel.appendChild(peel);
  const resizer = document.createElement('div');
  resizer.className = 'cg-resizer';
  resizer.title = 'Resize';
  panel.appendChild(resizer);
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

  // ------------------------------------------------------------
  // Quick UI state (tree search collapsed)
  // ------------------------------------------------------------
  const headerSearchBtn = header.querySelector('[data-action="search"]');
  const miniSearchBtn = miniBar.querySelector('[data-action="search"]');
  let currentViewMode = 'graph';
  let treeToolbarCollapsed = false;

  // ------------------------------------------------------------
  // Header responsiveness (1-line max)
  // ------------------------------------------------------------
  const updateHeaderCompact = () => {
    // If the header is hidden, no need to compute.
    if (panel.classList.contains('cg-controls-hidden')) {
      panel.dataset.cgCompact = '0';
      return;
    }

    const headerEl = panel.querySelector('.cg-header');
    if (!headerEl) return;

    // Progressive compaction: apply the smallest level that makes the header fit.
    const levels = ['0', '1', '2', '3', '4'];
    let chosen = '4';
    for (const lv of levels) {
      panel.dataset.cgCompact = lv;
      // Force layout flush
      headerEl.getBoundingClientRect();
      if (headerEl.scrollWidth <= headerEl.clientWidth + 1) {
        chosen = lv;
        break;
      }
    }
    panel.dataset.cgCompact = chosen;
  };

  const updateSearchButtons = (s = getState()) => {
    const effectiveHidden = !!s.controlsHidden || !!s.locked || !!s.clickThrough;
    const shouldShow = currentViewMode === 'tree' && !!treeToolbarCollapsed;

    if (headerSearchBtn) {
      headerSearchBtn.style.display = !effectiveHidden && shouldShow ? 'inline-flex' : 'none';
    }
    if (miniSearchBtn) {
      miniSearchBtn.style.display = effectiveHidden && shouldShow ? 'inline-flex' : 'none';
    }
  };

  // Let applyState call back into this so visibility updates whenever controls are hidden/shown.
  panel.__cgAfterApplyState = (s) => {
    updateSearchButtons(s);
    updateHeaderCompact();
  };

  const setActiveViewMode = (mode) => {
    currentViewMode = String(mode || 'graph');
    panel.querySelectorAll('[data-action="view"]').forEach((btn) => {
      btn.classList.toggle('cg-active', btn.dataset.mode === currentViewMode);
    });
    updateSearchButtons();
    updateHeaderCompact();
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
      return;
    }

    if (data.type === 'CG_TREE_TOOLBAR_STATE') {
      treeToolbarCollapsed = !!data.payload?.collapsed;
      updateSearchButtons();
      updateHeaderCompact();
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

  header.querySelector('[data-action="controls"]')?.addEventListener('click', (e) => {
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

  // Search button (shown when the embedded tree search row is collapsed).
  // Both the header and the mini bar use the same action.
  const runSearch = () => {
    closePopover();
    postToIframe('CG_TREE_FOCUS_SEARCH', {});
  };
  panel.querySelectorAll('[data-action="search"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      runSearch();
    });
  });

  // Mini bar: restore the main toolbar.
  // If the toolbar is hidden because the panel is locked, open the popover so the user can unlock.
  miniBar.querySelector('[data-action="showToolbar"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const s = getState();
    if (s.locked) {
      openPopover();
      return;
    }
    const next = { ...s, controlsHidden: false };
    setState(next);
    applyState(panel, next);
    saveState({ controlsHidden: false });
  });

  // Custom resize handle (bottom-right)
  let resizing = false;
  let rStartX = 0;
  let rStartY = 0;
  let rStartW = 0;
  let rStartH = 0;

  const startResize = (e) => {
    const s = getState();
    if (s.locked || s.minimized || s.clickThrough) return;
    closePopover();
    resizing = true;
    const rect = panel.getBoundingClientRect();
    rStartX = e.clientX;
    rStartY = e.clientY;
    rStartW = rect.width;
    rStartH = rect.height;
    try {
      resizer.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    // Avoid selecting text / triggering drag.
    e.preventDefault();
    e.stopPropagation();
  };

  const onResizeMove = (e) => {
    if (!resizing) return;
    if (e.buttons !== 1) return;
    const dx = e.clientX - rStartX;
    const dy = e.clientY - rStartY;
    const s = getState();
    const next = keepOnScreen({
      ...s,
      width: Math.round(rStartW + dx),
      height: Math.round(rStartH + dy)
    });
    setState(next);
    applyState(panel, next);
    e.preventDefault();
  };

  const endResize = () => {
    if (!resizing) return;
    resizing = false;
    const s = getState();
    saveState({ width: s.width, height: s.height, x: s.x, y: s.y });
  };

  resizer.addEventListener('pointerdown', startResize);
  resizer.addEventListener('pointermove', onResizeMove);
  resizer.addEventListener('pointerup', endResize);
  resizer.addEventListener('pointercancel', endResize);
  resizer.addEventListener('lostpointercapture', endResize);

  // Clicking outside closes the popover (but not the floating panel)
  const docPointerHandler = (e) => {
    if (!panel.classList.contains('cg-popover-open')) return;
    if (popover.contains(e.target)) return;
    const menu = header.querySelector('[data-action="controls"]');
    if (menu && menu.contains(e.target)) return;
    closePopover();
  };
  panel.__cgDocPointerHandler = docPointerHandler;
  document.addEventListener('pointerdown', docPointerHandler, true);

  // Dragging + resize persistence
  // Drag handles: full header when visible, and the mini bar when controls are hidden.
  setupDragging(panel, header, getState, setState);
  setupDragging(panel, miniBar, getState, setState);
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
