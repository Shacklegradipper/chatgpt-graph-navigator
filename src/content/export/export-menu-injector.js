import { extractConversationId } from '../../shared/utils.js';
import { canExportContextAsImage, runExport } from './export-utils.js';
import { findMessageContainer, getStableMessageId } from '../utils/message-id-helper.js';

const SIDEBAR_TRIGGER_SELECTOR = 'button[data-conversation-options-trigger]';
const HEADER_TRIGGER_SELECTOR = 'button[data-testid="conversation-options-button"]';
const MESSAGE_TRIGGER_SELECTOR = 'button[aria-label="\u66f4\u591a\u64cd\u4f5c"], button[aria-label="More actions"]';
const MENU_SELECTOR = '[role="menu"]';
const MENU_CONTEXT_TTL = 3000;
const TOAST_DURATION_MS = 2600;

let initialized = false;
let menuObserver = null;
let lastMenuContext = null;
let activeDialog = null;
let activeDialogKeyHandler = null;

function getLabels() {
  const isChinese = (navigator.language || '').toLowerCase().startsWith('zh');

  if (isChinese) {
    return {
      exportConversation: '\u5bfc\u51fa\u5bf9\u8bdd',
      exportAnswer: '\u5bfc\u51fa\u6b64\u56de\u7b54',
      chooserTitleConversation: '\u5bfc\u51fa\u5bf9\u8bdd',
      chooserTitleAnswer: '\u5bfc\u51fa\u56de\u7b54',
      chooserHint: '\u9009\u62e9\u5bfc\u51fa\u683c\u5f0f',
      imageHint:
        '\u56fe\u50cf\u5bfc\u51fa\u4f1a\u91cd\u5efa\u5f53\u524d\u5185\u5bb9\uff0cSVG \u4fdd\u7559\u5411\u91cf\u683c\u5f0f\uff0cPNG \u57fa\u4e8e\u91cd\u5efa\u7ed3\u679c\u6e32\u67d3\uff0c\u4e0d\u4f7f\u7528\u622a\u56fe\u3002',
      imageCurrentOnly: '\u56fe\u50cf\u5bfc\u51fa\u4ec5\u652f\u6301\u5f53\u524d\u9875\u9762\u5df2\u6253\u5f00\u7684\u5bf9\u8bdd\u3002',
      json: 'JSON',
      markdown: 'Markdown',
      pdf: 'PDF',
      word: 'Word',
      both: 'JSON + Markdown',
      svg: 'SVG',
      png: 'PNG',
      jsonDesc: '\u5bfc\u51fa\u539f\u59cb\u7ed3\u6784\u5316\u6570\u636e',
      markdownDesc: '\u5bfc\u51fa\u53ef\u8bfb Markdown',
      pdfDesc: '\u5c06 Markdown \u6e32\u67d3\u4e3a PDF',
      wordDesc: '\u5c06 Markdown \u8f6c\u6362\u4e3a Word \u6587\u6863',
      bothDesc: '\u540c\u65f6\u5bfc\u51fa JSON \u548c Markdown',
      svgDesc: '\u5bfc\u51fa\u81ea\u5305\u542b SVG\uff0c\u5c3d\u91cf\u4fdd\u7559\u9875\u9762\u6837\u5f0f',
      pngDesc: '\u5c06\u91cd\u5efa\u540e\u7684\u5185\u5bb9\u6e32\u67d3\u4e3a PNG\uff0c\u4e0d\u4f7f\u7528\u622a\u56fe',
      cancel: '\u53d6\u6d88',
      exporting: '\u5bfc\u51fa\u4e2d...',
      started: '\u5bfc\u51fa\u5df2\u5f00\u59cb',
      failed: '\u5bfc\u51fa\u5931\u8d25'
    };
  }

  return {
    exportConversation: 'Export Conversation',
    exportAnswer: 'Export Answer',
    chooserTitleConversation: 'Export Conversation',
    chooserTitleAnswer: 'Export Answer',
    chooserHint: 'Choose an export format',
    imageHint:
      'Visual export rebuilds the content first: SVG stays vector, and PNG is rasterized from the reconstructed result instead of a screenshot.',
    imageCurrentOnly: 'Visual export is only available for the conversation currently open on the page.',
    json: 'JSON',
    markdown: 'Markdown',
    pdf: 'PDF',
    word: 'Word',
    both: 'JSON + Markdown',
    svg: 'SVG',
    png: 'PNG',
    jsonDesc: 'Export the raw structured data',
    markdownDesc: 'Export readable Markdown',
    pdfDesc: 'Render Markdown as a PDF document',
    wordDesc: 'Convert Markdown to a Word document',
    bothDesc: 'Export JSON and Markdown together',
    svgDesc: 'Export a self-contained SVG styled like the page',
    pngDesc: 'Render the reconstructed content to PNG without screenshots',
    cancel: 'Cancel',
    exporting: 'Exporting...',
    started: 'Export started',
    failed: 'Export failed'
  };
}

function ensureStyles() {
  if (document.getElementById('cg-export-menu-styles')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'cg-export-menu-styles';
  style.textContent = `
    .cg-export-toast {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483647;
      max-width: 360px;
      padding: 10px 14px;
      border-radius: 12px;
      color: #fff;
      background: rgba(17, 24, 39, 0.92);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
      font-size: 13px;
      line-height: 1.4;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.18s ease, transform 0.18s ease;
      pointer-events: none;
    }

    .cg-export-toast.visible {
      opacity: 1;
      transform: translateY(0);
    }

    .cg-export-toast.error {
      background: rgba(185, 28, 28, 0.95);
    }

    .cg-export-menu-item-icon {
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: currentColor;
      flex-shrink: 0;
    }

    .cg-export-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(15, 23, 42, 0.32);
      opacity: 0;
      transition: opacity 0.18s ease;
    }

    .cg-export-backdrop.visible {
      opacity: 1;
    }

    .cg-export-dialog {
      width: min(560px, calc(100vw - 32px));
      border-radius: 20px;
      background: var(--main-surface-primary, #ffffff);
      color: var(--text-primary, #111827);
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.28);
      border: 1px solid rgba(148, 163, 184, 0.18);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .cg-export-dialog-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .cg-export-dialog-title {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      line-height: 1.3;
    }

    .cg-export-dialog-subtitle {
      margin: 4px 0 0;
      font-size: 13px;
      line-height: 1.45;
      color: var(--text-secondary, rgba(15, 23, 42, 0.72));
    }

    .cg-export-close-btn {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: inherit;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
    }

    .cg-export-close-btn:hover {
      background: rgba(148, 163, 184, 0.12);
    }

    .cg-export-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .cg-export-option {
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 16px;
      background: rgba(248, 250, 252, 0.7);
      color: inherit;
      padding: 14px 15px;
      text-align: left;
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    }

    .cg-export-option:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: rgba(59, 130, 246, 0.4);
      background: rgba(239, 246, 255, 0.9);
    }

    .cg-export-option:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }

    .cg-export-option-title {
      display: block;
      font-size: 15px;
      font-weight: 600;
      line-height: 1.3;
    }

    .cg-export-option-desc {
      display: block;
      margin-top: 6px;
      font-size: 12px;
      line-height: 1.45;
      color: var(--text-secondary, rgba(15, 23, 42, 0.72));
    }

    .cg-export-dialog-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .cg-export-status {
      min-height: 20px;
      font-size: 12px;
      line-height: 1.45;
      color: var(--text-secondary, rgba(15, 23, 42, 0.72));
    }

    .cg-export-status.error {
      color: #b91c1c;
    }

    .cg-export-note {
      margin: 0;
      font-size: 12px;
      line-height: 1.45;
      color: var(--text-secondary, rgba(15, 23, 42, 0.72));
    }

    .cg-export-cancel {
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 999px;
      background: transparent;
      color: inherit;
      padding: 8px 14px;
      cursor: pointer;
    }

    @media (max-width: 640px) {
      .cg-export-grid {
        grid-template-columns: 1fr;
      }
    }
  `;

  document.head.appendChild(style);
}

function showToast(message, tone = 'info') {
  ensureStyles();

  const toast = document.createElement('div');
  toast.className = `cg-export-toast${tone === 'error' ? ' error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  window.setTimeout(() => {
    toast.classList.remove('visible');
    window.setTimeout(() => toast.remove(), 220);
  }, TOAST_DURATION_MS);
}

function closeActiveMenu() {
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true
    })
  );
}

function rememberMenuContext(context) {
  if (!context?.conversationId) {
    return;
  }

  lastMenuContext = {
    ...context,
    timestamp: Date.now()
  };
}

function isAssistantContainer(container) {
  if (!container) {
    return false;
  }

  if (container.getAttribute('data-turn') === 'assistant') {
    return true;
  }

  return Boolean(container.querySelector('[data-message-author-role="assistant"]'));
}

function resolveContextFromTrigger(target) {
  const sidebarTrigger = target.closest(SIDEBAR_TRIGGER_SELECTOR);
  if (sidebarTrigger) {
    return {
      kind: 'conversation',
      source: 'sidebar',
      conversationId: sidebarTrigger.dataset.conversationOptionsTrigger,
      triggerId: sidebarTrigger.id || ''
    };
  }

  const headerTrigger = target.closest(HEADER_TRIGGER_SELECTOR);
  if (headerTrigger) {
    return {
      kind: 'conversation',
      source: 'header',
      conversationId: extractConversationId(),
      triggerId: headerTrigger.id || ''
    };
  }

  const messageTrigger = target.closest(MESSAGE_TRIGGER_SELECTOR);
  if (messageTrigger) {
    const container = findMessageContainer(messageTrigger);
    const conversationId = extractConversationId();
    const messageId = getStableMessageId(container);

    if (!conversationId || !messageId || !isAssistantContainer(container)) {
      return null;
    }

    return {
      kind: 'assistantMessage',
      source: 'message',
      conversationId,
      messageId,
      triggerId: messageTrigger.id || ''
    };
  }

  return null;
}

function getMenuContext(menu) {
  if (!lastMenuContext) {
    return null;
  }

  if (Date.now() - lastMenuContext.timestamp > MENU_CONTEXT_TTL) {
    return null;
  }

  const labelledBy = menu.getAttribute('aria-labelledby');
  if (lastMenuContext.triggerId && labelledBy && labelledBy !== lastMenuContext.triggerId) {
    return null;
  }

  return lastMenuContext;
}

function isConversationOptionsMenu(menu) {
  return Boolean(
    menu.querySelector('[data-testid="share-chat-menu-item"]') &&
      menu.querySelector('[data-testid="delete-chat-menu-item"]')
  );
}

function isAssistantMessageMenu(menu) {
  if (menu.querySelector('[data-testid="delete-chat-menu-item"]')) {
    return false;
  }

  return Boolean(
    menu.querySelector('[data-testid="voice-play-turn-action-button"]') ||
      menu.querySelector('[role="menuitem"]')
  );
}

function createExportIcon() {
  return `
    <span class="cg-export-menu-item-icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <path d="M7 10l5 5 5-5"></path>
        <path d="M12 15V3"></path>
      </svg>
    </span>
  `;
}

function getContextKey(context) {
  return `${context.kind}:${context.conversationId}:${context.messageId || ''}`;
}

function closeExportDialog() {
  if (!activeDialog) {
    return;
  }

  if (activeDialogKeyHandler) {
    document.removeEventListener('keydown', activeDialogKeyHandler, true);
    activeDialogKeyHandler = null;
  }

  const dialog = activeDialog;
  activeDialog = null;
  dialog.classList.remove('visible');
  window.setTimeout(() => {
    dialog.remove();
  }, 180);
}

function openExportDialog(context) {
  closeExportDialog();
  ensureStyles();

  const labels = getLabels();
  const imageEnabled = canExportContextAsImage(context);
  const title =
    context.kind === 'assistantMessage'
      ? labels.chooserTitleAnswer
      : labels.chooserTitleConversation;

  const backdrop = document.createElement('div');
  backdrop.className = 'cg-export-backdrop';
  backdrop.innerHTML = `
    <div class="cg-export-dialog" role="dialog" aria-modal="true">
      <div class="cg-export-dialog-header">
        <div>
          <h2 class="cg-export-dialog-title">${title}</h2>
          <p class="cg-export-dialog-subtitle">${labels.chooserHint}</p>
        </div>
        <button class="cg-export-close-btn" type="button" aria-label="${labels.cancel}">&times;</button>
      </div>
      <div class="cg-export-grid">
        <button class="cg-export-option" type="button" data-format="json">
          <span class="cg-export-option-title">${labels.json}</span>
          <span class="cg-export-option-desc">${labels.jsonDesc}</span>
        </button>
        <button class="cg-export-option" type="button" data-format="md">
          <span class="cg-export-option-title">${labels.markdown}</span>
          <span class="cg-export-option-desc">${labels.markdownDesc}</span>
        </button>
        <button class="cg-export-option" type="button" data-format="pdf">
          <span class="cg-export-option-title">${labels.pdf}</span>
          <span class="cg-export-option-desc">${labels.pdfDesc}</span>
        </button>
        <button class="cg-export-option" type="button" data-format="word">
          <span class="cg-export-option-title">${labels.word}</span>
          <span class="cg-export-option-desc">${labels.wordDesc}</span>
        </button>
        <button class="cg-export-option" type="button" data-format="both">
          <span class="cg-export-option-title">${labels.both}</span>
          <span class="cg-export-option-desc">${labels.bothDesc}</span>
        </button>
        <button class="cg-export-option" type="button" data-format="svg" ${imageEnabled ? '' : 'disabled'}>
          <span class="cg-export-option-title">${labels.svg}</span>
          <span class="cg-export-option-desc">${labels.svgDesc}</span>
        </button>
        <button class="cg-export-option" type="button" data-format="png" ${imageEnabled ? '' : 'disabled'}>
          <span class="cg-export-option-title">${labels.png}</span>
          <span class="cg-export-option-desc">${labels.pngDesc}</span>
        </button>
      </div>
      <div class="cg-export-dialog-footer">
        <div>
          <p class="cg-export-note">${imageEnabled ? labels.imageHint : labels.imageCurrentOnly}</p>
          <div class="cg-export-status" data-cg-export-status></div>
        </div>
        <button class="cg-export-cancel" type="button">${labels.cancel}</button>
      </div>
    </div>
  `;

  const statusEl = backdrop.querySelector('[data-cg-export-status]');
  const optionButtons = Array.from(backdrop.querySelectorAll('[data-format]'));
  const closeButton = backdrop.querySelector('.cg-export-close-btn');
  const cancelButton = backdrop.querySelector('.cg-export-cancel');

  const setBusy = (busy, message = '', tone = 'info') => {
    optionButtons.forEach(button => {
      const requiresVisualExport = button.dataset.format === 'svg' || button.dataset.format === 'png';
      button.disabled = busy || (requiresVisualExport && !imageEnabled);
    });
    cancelButton.disabled = busy;
    closeButton.disabled = busy;
    statusEl.textContent = message;
    statusEl.classList.toggle('error', tone === 'error');
  };

  const handleOptionClick = async event => {
    const format = event.currentTarget.dataset.format;
    setBusy(true, labels.exporting);

    try {
      await runExport(context, format);
      closeExportDialog();
      showToast(labels.started);
    } catch (error) {
      const message = error?.message || String(error);
      setBusy(false, `${labels.failed}: ${message}`, 'error');
      showToast(`${labels.failed}: ${message}`, 'error');
    }
  };

  optionButtons.forEach(button => {
    button.addEventListener('click', handleOptionClick);
  });

  closeButton.addEventListener('click', closeExportDialog);
  cancelButton.addEventListener('click', closeExportDialog);

  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) {
      closeExportDialog();
    }
  });

  activeDialogKeyHandler = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeExportDialog();
    }
  };

  activeDialog = backdrop;
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', activeDialogKeyHandler, true);
  requestAnimationFrame(() => backdrop.classList.add('visible'));
}

function createMenuItem(context) {
  const labels = getLabels();
  const menuItem = document.createElement('div');
  const contextKey = getContextKey(context);
  const label =
    context.kind === 'assistantMessage' ? labels.exportAnswer : labels.exportConversation;

  menuItem.setAttribute('role', 'menuitem');
  menuItem.setAttribute('tabindex', '0');
  menuItem.setAttribute('data-orientation', 'vertical');
  menuItem.setAttribute('data-radix-collection-item', '');
  menuItem.setAttribute('data-cg-export-menu-item', context.kind);
  menuItem.setAttribute('data-cg-export-context', contextKey);
  menuItem.className = 'group __menu-item gap-1.5';
  menuItem.innerHTML = `
    ${createExportIcon()}
    <span>${label}</span>
  `;

  const openChooser = event => {
    event.preventDefault();
    event.stopPropagation();
    closeActiveMenu();
    window.setTimeout(() => {
      openExportDialog(context);
    }, 30);
  };

  menuItem.addEventListener('click', openChooser);
  menuItem.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      openChooser(event);
    }
  });

  return menuItem;
}

function upsertMenuItem(menu, context) {
  const selector = `[data-cg-export-menu-item="${context.kind}"]`;
  const contextKey = getContextKey(context);
  const existing = menu.querySelector(selector);

  if (existing?.getAttribute('data-cg-export-context') === contextKey) {
    return;
  }

  if (existing) {
    existing.remove();
  }

  const menuItem = createMenuItem(context);

  if (context.kind === 'conversation') {
    const deleteItem = menu.querySelector('[data-testid="delete-chat-menu-item"]');
    if (deleteItem) {
      menu.insertBefore(menuItem, deleteItem);
      return;
    }
  }

  if (context.kind === 'assistantMessage') {
    const readAloudItem = menu.querySelector('[data-testid="voice-play-turn-action-button"]');
    if (readAloudItem) {
      menu.insertBefore(menuItem, readAloudItem);
      return;
    }
  }

  menu.appendChild(menuItem);
}

function injectIntoMenu(menu) {
  if (!menu) {
    return;
  }

  const context = getMenuContext(menu);
  if (!context) {
    return;
  }

  if (context.kind === 'conversation') {
    if (!isConversationOptionsMenu(menu)) {
      return;
    }

    upsertMenuItem(menu, context);
    return;
  }

  if (context.kind === 'assistantMessage' && isAssistantMessageMenu(menu)) {
    upsertMenuItem(menu, context);
  }
}

function inspectNodeForMenus(node) {
  if (!(node instanceof HTMLElement)) {
    return;
  }

  if (node.matches(MENU_SELECTOR)) {
    injectIntoMenu(node);
  }

  node.querySelectorAll(MENU_SELECTOR).forEach(injectIntoMenu);
}

function handleDocumentPointerDown(event) {
  const context = resolveContextFromTrigger(event.target);
  if (context) {
    rememberMenuContext(context);
  }
}

export function initExportMenuInjector() {
  if (initialized) {
    return;
  }

  initialized = true;
  ensureStyles();

  document.addEventListener('pointerdown', handleDocumentPointerDown, true);

  menuObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(inspectNodeForMenus);
    }
  });

  menuObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}
