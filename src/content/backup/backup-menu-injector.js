import { MESSAGE_TYPES } from '../../shared/constants.js';
import { extractConversationId } from '../../shared/utils.js';

const SIDEBAR_TRIGGER_SELECTOR = 'button[data-conversation-options-trigger]';
const HEADER_TRIGGER_SELECTOR = 'button[data-testid="conversation-options-button"]';
const MENU_SELECTOR = '[role="menu"]';
const CUSTOM_ITEM_SELECTOR = '[data-cg-backup-menu-item="true"]';
const MENU_CONTEXT_TTL = 3000;
const TOAST_DURATION_MS = 2400;

let initialized = false;
let menuObserver = null;
let lastMenuContext = null;
let pendingSingleBackup = null;

function getLabels() {
  const isChinese = (navigator.language || '').toLowerCase().startsWith('zh');
  return {
    backup: isChinese ? '备份对话' : 'Backup Conversation',
    running: isChinese ? '备份中...' : 'Backing up...',
    started: isChinese ? '已开始备份对话' : 'Conversation backup started',
    completed: isChinese ? '对话备份完成' : 'Conversation backup completed',
    failed: isChinese ? '备份失败' : 'Backup failed',
    busy: isChinese ? '当前已有备份任务在运行' : 'Another backup task is already running'
  };
}

function ensureStyles() {
  if (document.getElementById('cg-backup-menu-styles')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'cg-backup-menu-styles';
  style.textContent = `
    .cg-backup-toast {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483647;
      max-width: 320px;
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

    .cg-backup-toast.visible {
      opacity: 1;
      transform: translateY(0);
    }

    .cg-backup-toast.error {
      background: rgba(185, 28, 28, 0.95);
    }

    .cg-backup-menu-item-icon {
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: currentColor;
      flex-shrink: 0;
    }

    [data-cg-backup-menu-item="true"][data-loading="true"] {
      opacity: 0.65;
      pointer-events: none;
    }
  `;

  document.head.appendChild(style);
}

function showToast(message, tone = 'info') {
  ensureStyles();

  const toast = document.createElement('div');
  toast.className = `cg-backup-toast${tone === 'error' ? ' error' : ''}`;
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

function rememberMenuContext(context) {
  if (!context?.conversationId) {
    return;
  }

  lastMenuContext = {
    ...context,
    timestamp: Date.now()
  };
}

function resolveContextFromTrigger(target) {
  const sidebarTrigger = target.closest(SIDEBAR_TRIGGER_SELECTOR);
  if (sidebarTrigger) {
    return {
      source: 'sidebar',
      conversationId: sidebarTrigger.dataset.conversationOptionsTrigger,
      triggerId: sidebarTrigger.id || ''
    };
  }

  const headerTrigger = target.closest(HEADER_TRIGGER_SELECTOR);
  if (headerTrigger) {
    return {
      source: 'header',
      conversationId: extractConversationId(),
      triggerId: headerTrigger.id || ''
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

function closeActiveMenu() {
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true
    })
  );
}

function createBackupIcon() {
  return `
    <span class="cg-backup-menu-item-icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <path d="M7 10l5 5 5-5"></path>
        <path d="M12 15V3"></path>
      </svg>
    </span>
  `;
}

async function handleBackupMenuClick(menuItem, conversationId) {
  if (!conversationId) {
    return;
  }

  const labels = getLabels();
  const labelEl = menuItem.querySelector('[data-cg-backup-label]');
  menuItem.dataset.loading = 'true';
  if (labelEl) {
    labelEl.textContent = labels.running;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.BACKUP_START,
      payload: {
        conversationIds: [conversationId]
      }
    });

    const result = response?.data || response;
    if (result?.error) {
      throw new Error(result.error);
    }

    pendingSingleBackup = {
      conversationId,
      startedAt: Date.now()
    };

    closeActiveMenu();
    showToast(labels.started);
  } catch (error) {
    const isBusy = error.message?.includes('already in progress');
    menuItem.dataset.loading = 'false';
    if (labelEl) {
      labelEl.textContent = labels.backup;
    }
    showToast(isBusy ? labels.busy : `${labels.failed}: ${error.message}`, 'error');
  }
}

function createMenuItem(conversationId) {
  const labels = getLabels();
  const menuItem = document.createElement('div');
  menuItem.setAttribute('role', 'menuitem');
  menuItem.setAttribute('tabindex', '0');
  menuItem.setAttribute('data-orientation', 'vertical');
  menuItem.setAttribute('data-radix-collection-item', '');
  menuItem.setAttribute('data-cg-backup-menu-item', 'true');
  menuItem.dataset.conversationId = conversationId;
  menuItem.className = 'group __menu-item gap-1.5';
  menuItem.innerHTML = `
    ${createBackupIcon()}
    <span data-cg-backup-label>${labels.backup}</span>
  `;

  menuItem.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    handleBackupMenuClick(menuItem, conversationId);
  });

  menuItem.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    handleBackupMenuClick(menuItem, conversationId);
  });

  return menuItem;
}

function injectIntoMenu(menu) {
  if (!menu || !isConversationOptionsMenu(menu)) {
    return;
  }

  const context = getMenuContext(menu);
  if (!context?.conversationId) {
    return;
  }

  const existingItem = menu.querySelector(CUSTOM_ITEM_SELECTOR);
  if (existingItem) {
    existingItem.dataset.conversationId = context.conversationId;
    return;
  }

  const customItem = createMenuItem(context.conversationId);
  const deleteItem = menu.querySelector('[data-testid="delete-chat-menu-item"]');
  if (deleteItem) {
    menu.insertBefore(customItem, deleteItem);
  } else {
    menu.appendChild(customItem);
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

function handleBackupProgress(message) {
  if (message.type !== 'BACKUP_PROGRESS' || !pendingSingleBackup) {
    return;
  }

  const labels = getLabels();
  const payload = message.payload || {};
  if (payload.status !== 'idle') {
    return;
  }

  const failed = payload.failed > 0 && payload.success === 0;
  showToast(failed ? labels.failed : labels.completed, failed ? 'error' : 'info');
  pendingSingleBackup = null;
}

export function initBackupMenuInjector() {
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

  chrome.runtime.onMessage.addListener(handleBackupProgress);
}
