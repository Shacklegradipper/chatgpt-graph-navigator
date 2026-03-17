/**
 * ChatGPT Graph Extension - Main World Script
 * 此脚本运行在页面的 main world 中，可以拦截页面的 fetch 请求
 *
 * 功能：
 * 1. 捕获 ChatGPT 的 authorization token
 * 2. 恢复模式：当备份对话的真实请求返回 404 时，返回本地备份数据
 */

(function() {
  'use strict';

  console.log('[ChatGPT Graph][MainWorld] Script loaded in MAIN world');

  let capturedToken = null;
  const originalFetch = window.fetch.bind(window);

  // ==================== Restore 状态 ====================
  let restoreEnabled = false;
  let backedUpIds = new Set();

  // ==================== Sidebar 状态 ====================
  let i18nStrings = {};
  let backupMetas = [];
  let sidebarObserver = null;
  let sidebarDebounceTimer = null;
  let isReordering = false; // 防止拖拽重排时触发 MutationObserver

  // 用于 postMessage 请求-响应匹配
  const pendingRequests = new Map();
  let requestIdCounter = 0;

  // UUID 正则
  const CONV_URL_RE = /\/backend-api\/conversation\/([0-9a-f-]{36})$/;

  // ==================== Restore 配置监听 ====================
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const { type, payload } = event.data || {};

    if (type === 'CG_RESTORE_CONFIG') {
      restoreEnabled = payload.enabled;
      backedUpIds = new Set(payload.backedUpIds || []);
      console.log(`[MainWorld] Restore ${restoreEnabled ? 'enabled' : 'disabled'}, ${backedUpIds.size} IDs`);
      if (restoreEnabled) {
        waitForSidebarAndInject();
      } else {
        removeSidebarSection();
      }
    } else if (type === 'CG_RESTORE_RESPONSE') {
      const { requestId, data } = payload;
      const pending = pendingRequests.get(requestId);
      if (pending) {
        pending.resolve(data);
        pendingRequests.delete(requestId);
      }
    } else if (type === 'CG_SIDEBAR_I18N') {
      i18nStrings = payload || {};
      renderBackupSidebar();
    } else if (type === 'CG_SIDEBAR_BACKUP_LIST') {
      backupMetas = payload || [];
      renderBackupSidebar();
    }
  });

  /**
   * 通过 postMessage 向 content script 请求备份数据
   */
  function requestBackupData(conversationId) {
    return new Promise((resolve) => {
      const requestId = ++requestIdCounter;
      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        resolve(null);
      }, 5000);

      pendingRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        }
      });

      window.postMessage({
        type: 'CG_RESTORE_REQUEST',
        payload: { conversationId, requestId }
      }, '*');
    });
  }

  // ==================== Token 捕获 ====================
  function captureToken(url, options) {
    try {
      if (options && options.headers && url && url.includes('/backend-api/')) {
        const headers = options.headers;
        let authHeader = null;

        if (headers instanceof Headers) {
          authHeader = headers.get('authorization');
        } else if (typeof headers === 'object') {
          authHeader = headers['authorization'] || headers['Authorization'];
        }

        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.replace('Bearer ', '');
          if (token !== capturedToken) {
            capturedToken = token;
            console.log('[MainWorld] Token captured', { length: token.length });
            window.postMessage({
              type: 'CHATGPT_GRAPH_TOKEN',
              token: token,
              timestamp: Date.now()
            }, '*');
          }
        }
      }
    } catch (e) {
      console.error('[MainWorld] Error capturing token:', e);
    }
  }

  // ==================== Fetch 拦截 ====================
  const interceptedFetch = async function(...args) {
    const [input, options] = args;
    const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');

    // Token 捕获
    captureToken(url, options);

    // 如果恢复模式未启用，直接透传
    if (!restoreEnabled) {
      return originalFetch(...args);
    }

    // 检查是否是单个对话请求
    const convMatch = url.match(CONV_URL_RE);
    if (convMatch) {
      const convId = convMatch[1];
      if (backedUpIds.has(convId)) {
        return handleConversationRestore(convId, args);
      }
    }

    return originalFetch(...args);
  };

  /**
   * 处理单个对话的恢复逻辑
   * 先尝试真实请求，404 时 fallback 到备份
   */
  async function handleConversationRestore(convId, fetchArgs) {
    try {
      const response = await originalFetch(...fetchArgs);

      // 真实请求成功，直接透传
      if (response.ok) {
        return response;
      }

      // 404 → 使用备份数据
      if (response.status === 404 || response.status === 403) {
        console.log(`[MainWorld] ${response.status} for ${convId}, using backup`);
        const backupData = await requestBackupData(convId);

        if (backupData) {
          return new Response(JSON.stringify(backupData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        console.warn(`[MainWorld] No backup data found for ${convId}`);
      }

      return response;
    } catch (err) {
      // 网络错误也尝试备份
      console.log(`[MainWorld] Fetch error for ${convId}, trying backup`);
      const backupData = await requestBackupData(convId);
      if (backupData) {
        return new Response(JSON.stringify(backupData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw err;
    }
  }

  // ==================== Sidebar DOM 函数 ====================

  function findSidebarNav() {
    return document.querySelector('nav.group\\/scrollport') ||
           document.querySelector('nav[aria-label]') ||
           document.querySelector('nav');
  }

  function findInsertionPoint(nav) {
    // 找到包含 a[href^="/c/"] 的 section（即"最近"区域）
    const sections = nav.querySelectorAll(':scope > div.group\\/sidebar-expando-section, :scope > div[class*="sidebar-expando"]');
    for (const section of sections) {
      if (section.querySelector('a[href^="/c/"]')) {
        return section;
      }
    }
    // fallback: 最后一个 section
    return sections.length > 0 ? sections[sections.length - 1] : null;
  }

  function injectSidebarStyles() {
    if (document.getElementById('cg-sidebar-styles')) return;
    const style = document.createElement('style');
    style.id = 'cg-sidebar-styles';
    style.textContent = `
      .cg-ws-conversations {
        max-height: 400px;
        overflow-y: auto;
      }
      .cg-ws-conversations::-webkit-scrollbar {
        width: 4px;
      }
      .cg-ws-conversations::-webkit-scrollbar-thumb {
        background: rgba(128,128,128,0.3);
        border-radius: 2px;
      }
      .cg-folder-btn .cg-count {
        font-size: 11px;
        opacity: 0.5;
        margin-left: auto;
      }
      .cg-folder-chevron {
        transition: transform 0.15s ease;
      }
      .cg-folder-chevron.expanded {
        transform: rotate(90deg);
      }
      .cg-section-draggable {
        position: relative;
      }
      .cg-section-draggable.dragging {
        opacity: 0.4;
      }
      .cg-drag-handle {
        cursor: grab;
        opacity: 0;
        transition: opacity 0.15s;
        padding: 2px 4px;
        color: var(--text-tertiary, #999);
        user-select: none;
        flex-shrink: 0;
        margin-left: auto;
      }
      .cg-section-draggable:hover .cg-drag-handle {
        opacity: 0.4;
      }
      .cg-drag-handle:hover {
        opacity: 0.8 !important;
      }
      .cg-drag-handle:active {
        cursor: grabbing;
      }
      .cg-drop-indicator {
        height: 2px;
        background: #2563eb;
        border-radius: 1px;
        margin: 0 8px;
        pointer-events: none;
      }
      .cg-drag-ghost {
        position: fixed;
        pointer-events: none;
        z-index: 10000;
        opacity: 0.85;
        background: var(--surface-primary, #fff);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        padding: 4px 12px;
        font-size: 13px;
        white-space: nowrap;
      }
    `;
    document.head.appendChild(style);
  }

  function createBackupSection(title) {
    const nav = findSidebarNav();
    // 找到原生 section 来克隆精确结构
    const nativeSection = nav ? nav.querySelector(':scope > div.group\\/sidebar-expando-section') : null;
    const nativeBtn = nativeSection ? nativeSection.querySelector(':scope > button') : null;

    const section = document.createElement('div');
    section.id = 'cg-backup-section';
    section.className = nativeSection ? nativeSection.className : 'group/sidebar-expando-section mb-[var(--sidebar-collapsed-section-margin-bottom)]';

    const headerBtn = document.createElement('button');
    headerBtn.className = nativeBtn ? nativeBtn.className : 'text-token-text-tertiary flex w-full items-center justify-start gap-0.5 px-4 py-1.5';
    headerBtn.setAttribute('aria-expanded', 'true');

    // 克隆原生按钮内部 HTML，替换标题文本
    if (nativeBtn) {
      headerBtn.innerHTML = nativeBtn.innerHTML;
      const h2 = headerBtn.querySelector('h2');
      if (h2) h2.textContent = title;
    } else {
      const h2 = document.createElement('h2');
      h2.className = '__menu-label';
      h2.setAttribute('data-no-spacing', 'true');
      h2.textContent = title;
      headerBtn.appendChild(h2);
    }

    section.appendChild(headerBtn);

    const content = document.createElement('div');
    content.id = 'cg-backup-content';
    section.appendChild(content);

    headerBtn.addEventListener('click', (e) => {
      if (e.target.closest('.cg-drag-handle')) return;
      const expanded = headerBtn.getAttribute('aria-expanded') === 'true';
      headerBtn.setAttribute('aria-expanded', String(!expanded));
      content.style.display = expanded ? 'none' : '';
    });

    return section;
  }

  function createWorkspaceFolder(wsName, conversations) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cg-workspace-folder';

    const btn = document.createElement('button');
    btn.className = 'group __menu-item hoverable cg-folder-btn flex w-full items-center gap-2.5 px-2 py-2 text-sm';

    // Folder icon
    const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('width', '16');
    iconSvg.setAttribute('height', '16');
    iconSvg.setAttribute('viewBox', '0 0 24 24');
    iconSvg.setAttribute('fill', 'none');
    iconSvg.setAttribute('stroke', 'currentColor');
    iconSvg.setAttribute('stroke-width', '2');
    const folderPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    folderPath.setAttribute('d', 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z');
    iconSvg.appendChild(folderPath);

    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('width', '12');
    chevron.setAttribute('height', '12');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('fill', 'none');
    chevron.setAttribute('stroke', 'currentColor');
    chevron.setAttribute('stroke-width', '2');
    chevron.classList.add('cg-folder-chevron');
    const chevPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    chevPath.setAttribute('d', 'M9 18l6-6-6-6');
    chevron.appendChild(chevPath);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'truncate';
    nameSpan.textContent = wsName;

    const countSpan = document.createElement('span');
    countSpan.className = 'cg-count text-token-text-tertiary';
    countSpan.textContent = String(conversations.length);

    btn.appendChild(chevron);
    btn.appendChild(iconSvg);
    btn.appendChild(nameSpan);
    btn.appendChild(countSpan);
    wrapper.appendChild(btn);

    const convContainer = document.createElement('div');
    convContainer.className = 'cg-ws-conversations';
    convContainer.style.display = 'none';
    wrapper.appendChild(convContainer);

    // 懒加载状态
    const state = { items: conversations, rendered: 0, batchSize: 50, initialized: false };

    btn.addEventListener('click', () => {
      const isOpen = convContainer.style.display !== 'none';
      convContainer.style.display = isOpen ? 'none' : '';
      chevron.classList.toggle('expanded', !isOpen);
      if (!state.initialized) {
        state.initialized = true;
        renderConversationBatch(convContainer, state);
        setupLazyObserver(convContainer, state);
      }
    });

    return wrapper;
  }

  function createConversationItem(meta) {
    const a = document.createElement('a');
    a.className = 'group __menu-item hoverable flex items-center gap-2.5 px-2 py-2 text-sm';
    a.setAttribute('data-sidebar-item', 'true');
    a.href = '/c/' + (meta.conversation_id || meta.id);

    const container = document.createElement('div');
    container.className = 'flex min-w-0 grow items-center gap-2.5';
    const titleDiv = document.createElement('div');
    titleDiv.className = 'truncate';
    const span = document.createElement('span');
    span.setAttribute('dir', 'auto');
    span.textContent = meta.title || 'Untitled';
    titleDiv.appendChild(span);
    container.appendChild(titleDiv);
    a.appendChild(container);

    a.addEventListener('click', (e) => {
      e.preventDefault();
      const url = '/c/' + (meta.conversation_id || meta.id);
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    return a;
  }

  function renderConversationBatch(container, state) {
    const end = Math.min(state.rendered + state.batchSize, state.items.length);
    const fragment = document.createDocumentFragment();
    for (let i = state.rendered; i < end; i++) {
      fragment.appendChild(createConversationItem(state.items[i]));
    }
    // Insert before sentinel if it exists
    const sentinel = container.querySelector('.cg-lazy-sentinel');
    if (sentinel) {
      container.insertBefore(fragment, sentinel);
    } else {
      container.appendChild(fragment);
    }
    state.rendered = end;
  }

  function setupLazyObserver(container, state) {
    const sentinel = document.createElement('div');
    sentinel.className = 'cg-lazy-sentinel';
    sentinel.style.height = '1px';
    container.appendChild(sentinel);

    const nav = findSidebarNav();
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && state.rendered < state.items.length) {
        renderConversationBatch(container, state);
        if (state.rendered >= state.items.length) {
          observer.disconnect();
          sentinel.remove();
        }
      }
    }, { root: container, rootMargin: '200px' });

    observer.observe(sentinel);
  }

  function renderBackupSidebar() {
    if (!restoreEnabled || backupMetas.length === 0) return;

    const nav = findSidebarNav();
    if (!nav) return;

    // Remove existing section
    const existing = document.getElementById('cg-backup-section');
    if (existing) existing.remove();

    injectSidebarStyles();

    const title = (i18nStrings && i18nStrings.backupsSectionTitle) || 'Backups';
    const section = createBackupSection(title);
    const content = section.querySelector('#cg-backup-content');

    // Group by workspace
    const groups = {};
    for (const meta of backupMetas) {
      const ws = meta.workspace_name || 'Personal';
      if (!groups[ws]) groups[ws] = [];
      groups[ws].push(meta);
    }

    // Sort: Personal first, then alphabetical
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      if (a === 'Personal') return -1;
      if (b === 'Personal') return 1;
      return a.localeCompare(b);
    });

    // Sort conversations within each group by update_time desc
    for (const key of sortedKeys) {
      groups[key].sort((a, b) => (b.update_time || 0) - (a.update_time || 0));
      content.appendChild(createWorkspaceFolder(key, groups[key]));
    }

    // Insert before "Recent" section
    const insertBefore = findInsertionPoint(nav);
    if (insertBefore) {
      nav.insertBefore(section, insertBefore);
    } else {
      nav.appendChild(section);
    }

    startSidebarObserver(nav);
    applySavedOrder(nav);
    makeSectionsDraggable(nav);
    console.log(`[MainWorld] Backup sidebar rendered: ${backupMetas.length} items in ${sortedKeys.length} folders`);
  }

  function startSidebarObserver(nav) {
    if (sidebarObserver) sidebarObserver.disconnect();
    sidebarObserver = new MutationObserver(() => {
      if (isReordering) return;
      if (!document.getElementById('cg-backup-section') && restoreEnabled && backupMetas.length > 0) {
        clearTimeout(sidebarDebounceTimer);
        sidebarDebounceTimer = setTimeout(() => renderBackupSidebar(), 100);
      }
    });
    sidebarObserver.observe(nav, { childList: true, subtree: true });
  }

  function waitForSidebarAndInject() {
    const nav = findSidebarNav();
    if (nav) {
      renderBackupSidebar();
      return;
    }
    // Wait for nav to appear
    const docObserver = new MutationObserver(() => {
      const nav = findSidebarNav();
      if (nav) {
        docObserver.disconnect();
        renderBackupSidebar();
      }
    });
    docObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function removeSidebarSection() {
    const existing = document.getElementById('cg-backup-section');
    if (existing) existing.remove();
    if (sidebarObserver) {
      sidebarObserver.disconnect();
      sidebarObserver = null;
    }
  }

  // ==================== 拖拽排序 ====================

  const SECTION_ORDER_KEY = 'cg_sidebar_section_order';

  function getSectionId(section) {
    if (section.id === 'cg-backup-section') return 'backup';
    // 检查是否包含对话链接 → "最近"
    if (section.querySelector('a[href^="/c/"]')) return 'recent';
    // 其他 section → 用 h2 文本做 key
    const h2 = section.querySelector('h2');
    return h2 ? 'section_' + h2.textContent.trim() : 'section_unknown';
  }

  function loadSectionOrder() {
    try {
      const saved = localStorage.getItem(SECTION_ORDER_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  }

  function saveSectionOrder(order) {
    try {
      localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(order));
    } catch {}
  }

  function applySavedOrder(nav) {
    const order = loadSectionOrder();
    if (!order || order.length === 0) return;

    const sections = getDraggableSections(nav);
    if (sections.length === 0) return;

    // Build map of id → element
    const map = {};
    for (const s of sections) {
      map[getSectionId(s)] = s;
    }

    // Reorder according to saved order, append unknowns at end
    const ordered = [];
    for (const id of order) {
      if (map[id]) {
        ordered.push(map[id]);
        delete map[id];
      }
    }
    for (const s of Object.values(map)) {
      ordered.push(s);
    }

    // Find the position of the first section to use as anchor
    const firstSection = sections[0];
    const anchor = firstSection.nextSibling;
    const parent = firstSection.parentNode;

    isReordering = true;
    for (const s of ordered) {
      parent.insertBefore(s, anchor);
    }
    isReordering = false;
  }

  function getDraggableSections(nav) {
    return Array.from(nav.querySelectorAll(':scope > div.group\\/sidebar-expando-section, :scope > #cg-backup-section'));
  }

  function makeSectionsDraggable(nav) {
    const sections = getDraggableSections(nav);

    for (const section of sections) {
      if (section.dataset.cgDraggable) continue;
      section.dataset.cgDraggable = 'true';
      section.classList.add('cg-section-draggable');

      // 添加拖拽手柄到 header button
      const headerBtn = section.querySelector('button');
      if (!headerBtn) continue;

      const handle = document.createElement('span');
      handle.className = 'cg-drag-handle';
      handle.innerHTML = '⠿';
      handle.title = 'Drag to reorder';
      headerBtn.appendChild(handle);

      // Mouse-based drag
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startDrag(nav, section, e.clientY);
      });
    }
  }

  function startDrag(nav, draggedSection, startY) {
    let indicator = null;
    let ghost = null;
    const sections = getDraggableSections(nav);

    draggedSection.classList.add('dragging');

    // 创建 ghost
    const h2 = draggedSection.querySelector('h2');
    ghost = document.createElement('div');
    ghost.className = 'cg-drag-ghost';
    ghost.textContent = h2 ? h2.textContent : 'Section';
    document.body.appendChild(ghost);

    function onMouseMove(e) {
      e.preventDefault();
      // 更新 ghost 位置
      ghost.style.left = (e.clientX + 12) + 'px';
      ghost.style.top = (e.clientY - 10) + 'px';

      // 找到目标 section
      removeIndicator();
      const target = findDropTarget(nav, sections, draggedSection, e.clientY);
      if (target) {
        indicator = document.createElement('div');
        indicator.className = 'cg-drop-indicator';
        if (target.position === 'before') {
          nav.insertBefore(indicator, target.section);
        } else {
          nav.insertBefore(indicator, target.section.nextSibling);
        }
      }
    }

    function onMouseUp(e) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      draggedSection.classList.remove('dragging');
      if (ghost) ghost.remove();
      removeIndicator();

      const target = findDropTarget(nav, sections, draggedSection, e.clientY);
      if (target) {
        isReordering = true;
        if (target.position === 'before') {
          nav.insertBefore(draggedSection, target.section);
        } else {
          nav.insertBefore(draggedSection, target.section.nextSibling);
        }
        isReordering = false;
        const newOrder = getDraggableSections(nav).map(s => getSectionId(s));
        saveSectionOrder(newOrder);
      }
    }

    function removeIndicator() {
      if (indicator && indicator.parentNode) indicator.remove();
      indicator = null;
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function findDropTarget(nav, sections, draggedSection, clientY) {
    for (const section of sections) {
      if (section === draggedSection) continue;
      const rect = section.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        const midY = rect.top + rect.height / 2;
        return { section, position: clientY < midY ? 'before' : 'after' };
      }
    }
    // 如果在所有 section 下方，放到最后
    const lastSection = sections[sections.length - 1];
    if (lastSection && clientY > lastSection.getBoundingClientRect().bottom) {
      return { section: lastSection, position: 'after' };
    }
    return null;
  }

  // ==================== 安装拦截器 ====================
  try {
    Object.defineProperty(window, 'fetch', {
      value: interceptedFetch,
      writable: false,
      configurable: false
    });
    console.log('[MainWorld] Fetch interceptor installed (non-writable)');
  } catch (e) {
    console.warn('[MainWorld] defineProperty failed, using assignment:', e.message);
    window.fetch = interceptedFetch;
    console.log('[MainWorld] Fetch interceptor installed (writable)');
  }
})();
