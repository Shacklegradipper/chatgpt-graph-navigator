/**
 * Backup Manager / Custom Backup page
 */

import { initI18n, i18n, getCurrentLocale } from '../shared/i18n.js';
import { MESSAGE_TYPES } from '../shared/constants.js';
import { exportAsZip } from './export-utils.js';

const BATCH_SIZE = 50;
const INITIAL_PAGE_MODE = new URLSearchParams(window.location.search).get('mode') === 'custom'
  ? 'custom'
  : 'manage';

let allItems = [];
let filteredItems = [];
let selectedIds = new Set();
let pageMode = INITIAL_PAGE_MODE;
let sortColumn = INITIAL_PAGE_MODE === 'custom' ? 'update_time' : 'backup_time';
let sortDirection = 'desc';
let workspaceStates = {};
let backupProgressActive = false;

let pageTitleEl;
let backupsViewBtn;
let customViewBtn;
let foldersContainer;
let emptyState;
let actionBar;
let selectedCountEl;
let searchInput;
let dateModeSelect;
let dateFromInput;
let dateToInput;
let latestCountInput;
let selectVisibleBtn;
let clearSelectionBtn;
let loadingOverlay;
let loadingText;
let headerStatsEl;
let backupSelectedBtn;
let exportJsonBtn;
let exportMdBtn;
let exportPdfBtn;
let exportWordBtn;
let exportBothBtn;
let deleteBtn;
let dateFormatterLocale = '';
let dateFormatter = null;

function t(key, fallback, substitutions) {
  const message = i18n(key, substitutions);
  return message === key ? fallback : message;
}

function getLocaleTag() {
  return (getCurrentLocale() || 'en').replace('_', '-');
}

function getDateFormatter() {
  const locale = getLocaleTag();
  if (!dateFormatter || dateFormatterLocale !== locale) {
    dateFormatterLocale = locale;
    dateFormatter = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  return dateFormatter;
}

function getPersonalWorkspaceLabel() {
  return t('backupManagerWorkspacePersonal', 'Personal');
}

function normalizeWorkspaceName(workspaceName) {
  if (!workspaceName || workspaceName === 'Personal') {
    return getPersonalWorkspaceLabel();
  }

  return workspaceName;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function formatDate(ts) {
  if (!ts) return '\u2014';
  const value = ts > 1e12 ? ts : ts * 1000;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '\u2014' : getDateFormatter().format(date);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sendMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (response?.success) {
        resolve(response.data);
        return;
      }

      reject(new Error(response?.error || t('backupManagerUnknownError', 'Unknown error')));
    });
  });
}

function showLoading(text = t('backupManagerLoadingGeneric', 'Loading...')) {
  loadingText.textContent = text;
  loadingOverlay.classList.add('visible');
}

function hideLoading() {
  loadingOverlay.classList.remove('visible');
}

function isCustomMode() {
  return pageMode === 'custom';
}

function getSearchablePreview(item) {
  return (item.content_preview || item.preview || item.summary || '').toLowerCase();
}

function getItemFilterTime(item) {
  return isCustomMode() ? item.update_time || 0 : item.backup_time || 0;
}

function getDateBounds() {
  if (!isCustomMode()) {
    return {
      min: dateFromInput.value ? new Date(dateFromInput.value).getTime() : 0,
      max: dateToInput.value ? new Date(`${dateToInput.value}T23:59:59`).getTime() : Infinity
    };
  }

  const mode = dateModeSelect.value;
  const fromValue = dateFromInput.value ? new Date(dateFromInput.value).getTime() : 0;
  const toValue = dateToInput.value
    ? new Date(`${dateToInput.value}T23:59:59`).getTime()
    : Infinity;

  switch (mode) {
    case 'after':
      return { min: fromValue || 0, max: Infinity };
    case 'before':
      return { min: 0, max: toValue };
    case 'between':
      return { min: fromValue || 0, max: toValue };
    case 'any':
    default:
      return { min: 0, max: Infinity };
  }
}

function getLatestLimit() {
  if (!isCustomMode()) return 0;
  const value = parseInt(latestCountInput.value, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function applyLatestLimit(items) {
  const latestLimit = getLatestLimit();
  if (!latestLimit || items.length <= latestLimit) {
    return items;
  }

  const allowedIds = new Set(
    items
      .slice()
      .sort((a, b) => (b.update_time || 0) - (a.update_time || 0))
      .slice(0, latestLimit)
      .map(item => item.conversation_id)
  );

  return items.filter(item => allowedIds.has(item.conversation_id));
}

function updateDateInputsVisibility() {
  const mode = dateModeSelect.value;
  const showFrom = mode === 'after' || mode === 'between' || !isCustomMode();
  const showTo = mode === 'before' || mode === 'between' || !isCustomMode();

  dateModeSelect.style.display = isCustomMode() ? '' : 'none';
  latestCountInput.style.display = isCustomMode() ? '' : 'none';
  selectVisibleBtn.style.display = isCustomMode() ? '' : 'none';
  clearSelectionBtn.style.display = isCustomMode() ? '' : 'none';

  dateFromInput.style.display = showFrom ? '' : 'none';
  dateToInput.style.display = showTo ? '' : 'none';
  dateFromInput.title = isCustomMode()
    ? t('customBackupUpdatedFromTitle', 'Updated from')
    : t('backupManagerFromDateTitle', 'From backup date');
  dateToInput.title = isCustomMode()
    ? t('customBackupUpdatedToTitle', 'Updated to')
    : t('backupManagerToDateTitle', 'To backup date');
}

function updateEmptyStateText() {
  const textEl = emptyState?.querySelector('p');
  if (!textEl) return;

  textEl.textContent = isCustomMode()
    ? t('customBackupEmpty', 'No conversations found')
    : t('backupManagerEmpty', 'No backups found');
}

function updatePageMeta() {
  if (isCustomMode()) {
    document.title = t('customBackupDocumentTitle', 'ChatGPT Graph - Custom Backup');
    pageTitleEl.textContent = t('customBackupPageTitle', 'Custom Backup');
    searchInput.placeholder = t(
      'customBackupSearchPlaceholder',
      'Search conversations by title or content...'
    );
    loadingText.textContent = t('customBackupLoading', 'Loading conversations...');
  } else {
    document.title = t('backupManagerDocumentTitle', 'ChatGPT Graph - Backup Manager');
    pageTitleEl.textContent = t('backupManagerPageTitle', 'Backup Manager');
    searchInput.placeholder = t('backupManagerSearchPlaceholder', 'Search by title or content...');
    loadingText.textContent = t('backupManagerLoading', 'Loading backups...');
  }

  updateEmptyStateText();
}

function updateModeSwitcher() {
  const custom = isCustomMode();
  if (backupsViewBtn) {
    backupsViewBtn.classList.toggle('active', !custom);
    backupsViewBtn.setAttribute('aria-selected', custom ? 'false' : 'true');
  }
  if (customViewBtn) {
    customViewBtn.classList.toggle('active', custom);
    customViewBtn.setAttribute('aria-selected', custom ? 'true' : 'false');
  }
}

async function switchMode(nextMode) {
  if (nextMode !== 'manage' && nextMode !== 'custom') return;
  if (nextMode === pageMode) return;

  pageMode = nextMode;
  allItems = [];
  filteredItems = [];
  selectedIds.clear();
  workspaceStates = {};
  sortColumn = isCustomMode() ? 'update_time' : 'backup_time';
  sortDirection = 'desc';
  backupProgressActive = false;

  const url = new URL(window.location.href);
  if (isCustomMode()) {
    url.searchParams.set('mode', 'custom');
  } else {
    url.searchParams.delete('mode');
  }
  window.history.replaceState({}, '', url.toString());

  updatePageMeta();
  updateModeSwitcher();
  updateDateInputsVisibility();
  updateModeSpecificActions();
  updateActionBar();
  await loadItems();
}

async function loadItems() {
  showLoading(
    isCustomMode()
      ? t('customBackupLoading', 'Loading conversations...')
      : t('backupManagerLoading', 'Loading backups...')
  );

  try {
    const data = isCustomMode()
      ? await sendMessage(MESSAGE_TYPES.BACKUP_REMOTE_CONVERSATIONS)
      : await sendMessage(MESSAGE_TYPES.GET_ALL_BACKUPS);

    allItems = Array.isArray(data) ? data : [];
    const validIds = new Set(allItems.map(item => item.conversation_id));
    selectedIds = new Set([...selectedIds].filter(id => validIds.has(id)));
    applyFilters();
    updateStats();
  } catch (error) {
    console.error('Failed to load items:', error);
    allItems = [];
    filteredItems = [];
    renderFolders();
    updateStats();
    alert(t('backupManagerLoadFailed', `Failed to load data: ${error.message}`, error.message));
  } finally {
    if (!backupProgressActive) {
      hideLoading();
    }
  }
}

function updateStats() {
  const workspaceCount = new Set(
    allItems.map(item => normalizeWorkspaceName(item.workspace_name))
  ).size;

  if (isCustomMode()) {
    const backedUpCount = allItems.filter(item => item.already_backed_up).length;
    headerStatsEl.textContent = t(
      'customBackupStats',
      `Conversations: ${allItems.length} · Workspaces: ${workspaceCount} · Already backed up: ${backedUpCount}`,
      [String(allItems.length), String(workspaceCount), String(backedUpCount)]
    );
    return;
  }

  headerStatsEl.textContent = t(
    'backupManagerStats',
    `Backups: ${allItems.length} · Workspaces: ${workspaceCount}`,
    [String(allItems.length), String(workspaceCount)]
  );
}

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const { min, max } = getDateBounds();

  let items = allItems.filter(item => {
    if (query) {
      const title = (item.title || '').toLowerCase();
      if (!title.includes(query) && !getSearchablePreview(item).includes(query)) {
        return false;
      }
    }

    const value = getItemFilterTime(item);
    return value >= min && value <= max;
  });

  items = applyLatestLimit(items);
  filteredItems = items;
  applySort();
}

function applySort() {
  filteredItems.sort((a, b) => {
    let valueA = a[sortColumn];
    let valueB = b[sortColumn];

    if (sortColumn === 'title' || sortColumn === 'workspace_name') {
      valueA = (valueA || '').toLowerCase();
      valueB = (valueB || '').toLowerCase();
      const comparison = valueA.localeCompare(valueB);
      return sortDirection === 'asc' ? comparison : -comparison;
    }

    valueA = valueA || 0;
    valueB = valueB || 0;
    return sortDirection === 'asc' ? valueA - valueB : valueB - valueA;
  });

  renderFolders();
}

function groupByWorkspace() {
  const groups = {};
  for (const item of filteredItems) {
    const workspaceName = normalizeWorkspaceName(item.workspace_name);
    if (!groups[workspaceName]) {
      groups[workspaceName] = [];
    }
    groups[workspaceName].push(item);
  }
  return groups;
}

function renderTableHead() {
  if (isCustomMode()) {
    return `
      <tr>
        <th class="col-checkbox"></th>
        <th class="sortable" data-sort="title">${t('backupManagerTableTitle', 'Title')} <span class="sort-arrow"></span></th>
        <th class="col-preview">${t('backupManagerTablePreview', 'Preview')}</th>
        <th class="sortable" data-sort="create_time">${t('backupManagerTableCreated', 'Created')} <span class="sort-arrow"></span></th>
        <th class="sortable" data-sort="update_time">${t('backupManagerTableUpdated', 'Updated')} <span class="sort-arrow"></span></th>
        <th class="col-status">${t('backupManagerTableStatus', 'Status')}</th>
        <th class="sortable" data-sort="backup_time">${t('backupManagerTableLastBackup', 'Last Backup')} <span class="sort-arrow"></span></th>
      </tr>
    `;
  }

  return `
    <tr>
      <th class="col-checkbox"></th>
      <th class="sortable" data-sort="title">${t('backupManagerTableTitle', 'Title')} <span class="sort-arrow"></span></th>
      <th class="col-preview">${t('backupManagerTablePreview', 'Preview')}</th>
      <th class="sortable" data-sort="message_count">${t('backupManagerTableMessages', 'Msgs')} <span class="sort-arrow"></span></th>
      <th class="sortable" data-sort="create_time">${t('backupManagerTableCreated', 'Created')} <span class="sort-arrow"></span></th>
      <th class="sortable" data-sort="update_time">${t('backupManagerTableUpdated', 'Updated')} <span class="sort-arrow"></span></th>
      <th class="sortable" data-sort="backup_time">${t('backupManagerTableBackedUp', 'Backed up')} <span class="sort-arrow"></span></th>
    </tr>
  `;
}

function renderFolders() {
  const groups = groupByWorkspace();
  const workspaceNames = Object.keys(groups).sort((a, b) => {
    const personalLabel = getPersonalWorkspaceLabel();
    if (a === personalLabel) return -1;
    if (b === personalLabel) return 1;
    return a.localeCompare(b);
  });

  if (filteredItems.length === 0) {
    foldersContainer.innerHTML = '';
    emptyState.style.display = 'block';
    updateActionBar();
    return;
  }

  emptyState.style.display = 'none';

  for (const name of workspaceNames) {
    if (!(name in workspaceStates)) {
      workspaceStates[name] = { expanded: false, rendered: 0 };
    }
  }

  foldersContainer.innerHTML = '';
  for (const name of workspaceNames) {
    foldersContainer.appendChild(createFolder(name, groups[name], workspaceStates[name]));
  }

  updateActionBar();
}

function createFolder(workspaceName, items, state) {
  const folder = document.createElement('div');
  folder.className = `ws-folder${state.expanded ? ' expanded' : ''}`;

  const selectedCount = items.filter(item => selectedIds.has(item.conversation_id)).length;
  const allSelected = items.length > 0 && selectedCount === items.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const badgeClass = workspaceName === getPersonalWorkspaceLabel() ? 'personal' : 'team';
  const workspaceCountText = isCustomMode()
    ? t(
      'backupManagerWorkspaceConversationCount',
      `${items.length} conversations`,
      String(items.length)
    )
    : t(
      'backupManagerWorkspaceBackupCount',
      `${items.length} backups`,
      String(items.length)
    );

  folder.innerHTML = `
    <div class="ws-header" data-ws="${escapeHtml(workspaceName)}">
      <input
        type="checkbox"
        class="ws-check"
        data-ws="${escapeHtml(workspaceName)}"
        ${allSelected ? 'checked' : ''}
        ${someSelected ? 'data-indeterminate' : ''}
      >
      <span class="ws-arrow">${state.expanded ? '\u25BC' : '\u25B6'}</span>
      <span class="workspace-badge ${badgeClass}">${escapeHtml(workspaceName)}</span>
      <span class="ws-count">${workspaceCountText}</span>
    </div>
    <div class="ws-body" style="display:${state.expanded ? 'block' : 'none'}">
      <table>
        <thead>${renderTableHead()}</thead>
        <tbody></tbody>
      </table>
      <div class="load-sentinel"></div>
    </div>
  `;

  const workspaceCheck = folder.querySelector('.ws-check');
  if (someSelected) {
    workspaceCheck.indeterminate = true;
  }

  const tbody = folder.querySelector('tbody');
  if (state.expanded) {
    state.rendered = 0;
    renderBatch(tbody, items, state);
    setupScrollObserver(folder, items, state);
  }

  folder.querySelector('.ws-header').addEventListener('click', event => {
    if (event.target.classList.contains('ws-check')) return;
    state.expanded = !state.expanded;
    renderFolders();
  });

  workspaceCheck.addEventListener('change', () => {
    const ids = items.map(item => item.conversation_id);
    if (workspaceCheck.checked) {
      ids.forEach(id => selectedIds.add(id));
    } else {
      ids.forEach(id => selectedIds.delete(id));
    }
    renderFolders();
  });

  tbody.addEventListener('change', event => {
    if (!event.target.classList.contains('row-check')) return;
    const id = event.target.dataset.id;
    if (event.target.checked) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }

    const nextSelectedCount = items.filter(item => selectedIds.has(item.conversation_id)).length;
    workspaceCheck.checked = nextSelectedCount === items.length;
    workspaceCheck.indeterminate = nextSelectedCount > 0 && nextSelectedCount < items.length;
    updateActionBar();
  });

  folder.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const column = th.dataset.sort;
      if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = column;
        sortDirection = 'desc';
      }
      applySort();
    });
  });

  folder.querySelectorAll('th.sortable').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    const column = th.dataset.sort;
    if (column === sortColumn) {
      th.classList.add('sorted');
      arrow.textContent = sortDirection === 'asc' ? '\u25B2' : '\u25BC';
    }
  });

  return folder;
}

function renderBatch(tbody, items, state) {
  const end = Math.min(state.rendered + BATCH_SIZE, items.length);
  for (let index = state.rendered; index < end; index++) {
    tbody.insertAdjacentHTML('beforeend', renderRow(items[index]));
  }
  state.rendered = end;
}

function setupScrollObserver(folder, items, state) {
  const sentinel = folder.querySelector('.load-sentinel');
  const scrollRoot = folder.querySelector('.ws-body');
  if (!sentinel || !scrollRoot || state.rendered >= items.length) return;

  const observer = new IntersectionObserver(
    entries => {
      if (entries[0].isIntersecting && state.rendered < items.length) {
        const tbody = folder.querySelector('tbody');
        renderBatch(tbody, items, state);
        if (state.rendered >= items.length) {
          observer.disconnect();
        }
      }
    },
    { root: scrollRoot, rootMargin: '100px' }
  );

  observer.observe(sentinel);
}

function renderRow(item) {
  const id = item.conversation_id;
  const checked = selectedIds.has(id) ? 'checked' : '';
  const title = escapeHtml(item.title || t('untitled', 'Untitled'));
  const preview = escapeHtml(item.content_preview || '\u2014');
  const created = formatDate(item.create_time);
  const updated = formatDate(item.update_time);
  const backupTime = formatDate(item.backup_time);

  if (isCustomMode()) {
    const statusClass = item.already_backed_up ? 'backed-up' : 'not-backed-up';
    const statusLabel = item.already_backed_up
      ? t('backupManagerStatusBackedUp', 'Backed up')
      : t('backupManagerStatusNotBackedUp', 'Not backed up');

    return `
      <tr data-id="${id}">
        <td class="col-checkbox"><input type="checkbox" class="row-check" data-id="${id}" ${checked}></td>
        <td class="col-title" title="${title}">${title}</td>
        <td class="col-preview" title="${preview}">${preview}</td>
        <td class="col-date">${created}</td>
        <td class="col-date">${updated}</td>
        <td class="col-status"><span class="status-pill ${statusClass}">${statusLabel}</span></td>
        <td class="col-date">${backupTime}</td>
      </tr>
    `;
  }

  const messageCount = item.message_count != null ? item.message_count : '\u2014';
  return `
    <tr data-id="${id}">
      <td class="col-checkbox"><input type="checkbox" class="row-check" data-id="${id}" ${checked}></td>
      <td class="col-title" title="${title}">${title}</td>
      <td class="col-preview" title="${preview}">${preview}</td>
      <td class="col-msgs">${messageCount}</td>
      <td class="col-date">${created}</td>
      <td class="col-date">${updated}</td>
      <td class="col-date">${backupTime}</td>
    </tr>
  `;
}

function updateActionBar() {
  if (selectedIds.size === 0) {
    actionBar.classList.remove('visible');
    return;
  }

  actionBar.classList.add('visible');
  selectedCountEl.textContent = t(
    'backupManagerSelectedCount',
    `${selectedIds.size} selected`,
    String(selectedIds.size)
  );
}

function updateModeSpecificActions() {
  const custom = isCustomMode();
  backupSelectedBtn.style.display = custom ? '' : 'none';
  exportJsonBtn.style.display = custom ? 'none' : '';
  exportMdBtn.style.display = custom ? 'none' : '';
  exportPdfBtn.style.display = custom ? 'none' : '';
  exportWordBtn.style.display = custom ? 'none' : '';
  exportBothBtn.style.display = custom ? 'none' : '';
  deleteBtn.style.display = custom ? 'none' : '';
  deleteBtn.classList.toggle('danger', !custom);
}

function selectVisibleItems() {
  filteredItems.forEach(item => selectedIds.add(item.conversation_id));
  renderFolders();
}

function clearSelection() {
  selectedIds.clear();
  renderFolders();
}

async function deleteSelected() {
  const count = selectedIds.size;
  if (!count) return;

  if (!window.confirm(
    t(
      'backupManagerDeleteConfirm',
      `Delete ${count} selected backups? This cannot be undone.`,
      String(count)
    )
  )) {
    return;
  }

  showLoading(t('backupManagerDeleting', 'Deleting backups...'));
  try {
    await sendMessage(MESSAGE_TYPES.BATCH_DELETE_BACKUPS, { ids: [...selectedIds] });
    selectedIds.clear();
    await loadItems();
  } catch (error) {
    alert(t('backupManagerDeleteFailed', `Failed to delete: ${error.message}`, error.message));
    hideLoading();
  }
}

async function exportSelected(format) {
  if (!selectedIds.size) return;

  showLoading(t('backupManagerPreparingExport', 'Preparing export...'));
  try {
    const backups = await sendMessage(MESSAGE_TYPES.BATCH_GET_BACKUPS, { ids: [...selectedIds] });
    await exportAsZip(backups, { format });
  } catch (error) {
    alert(t('backupManagerExportFailed', `Export failed: ${error.message}`, error.message));
  } finally {
    hideLoading();
  }
}

function formatProgressText(data) {
  if (data.status === 'paused') {
    return t(
      'backupManagerProgressPaused',
      `Paused: ${data.completed}/${data.total}`,
      [String(data.completed), String(data.total)]
    );
  }

  if (data.status === 'idle') {
    return t(
      'backupManagerProgressDone',
      `Done! ${data.success} saved, ${data.failed} failed`,
      [String(data.success), String(data.failed)]
    );
  }

  const title = data.currentTitle || t('backupManagerProgressFallbackTitle', 'Backing up...');
  return t(
    'backupManagerProgressRunning',
    `${data.completed}/${data.total}: ${title}`,
    [String(data.completed), String(data.total), title]
  );
}

async function startSelectedBackup() {
  if (!selectedIds.size) return;

  showLoading(t('customBackupPreparing', 'Preparing selected backup...'));

  try {
    const result = await sendMessage(MESSAGE_TYPES.BACKUP_START, {
      conversationIds: [...selectedIds]
    });

    if (result?.error) {
      throw new Error(result.error);
    }

    backupProgressActive = true;
    loadingText.textContent = t('customBackupStarted', 'Backup started...');
  } catch (error) {
    backupProgressActive = false;
    hideLoading();
    alert(t('customBackupStartFailed', `Failed to start backup: ${error.message}`, error.message));
  }
}

function handleBackupProgress(message) {
  if (message.type !== 'BACKUP_PROGRESS' || !isCustomMode()) {
    return;
  }

  const data = message.payload || {};
  if (data.status === 'idle' && !backupProgressActive) {
    return;
  }

  backupProgressActive = data.status !== 'idle';
  showLoading(formatProgressText(data));

  if (data.status === 'idle') {
    selectedIds.clear();
    setTimeout(async () => {
      hideLoading();
      await loadItems();
    }, 250);
  }
}

function bindEvents() {
  backupsViewBtn.addEventListener('click', () => switchMode('manage'));
  customViewBtn.addEventListener('click', () => switchMode('custom'));
  searchInput.addEventListener('input', debounce(() => applyFilters(), 250));
  dateModeSelect.addEventListener('change', () => {
    updateDateInputsVisibility();
    applyFilters();
  });
  dateFromInput.addEventListener('change', () => applyFilters());
  dateToInput.addEventListener('change', () => applyFilters());
  latestCountInput.addEventListener('input', debounce(() => applyFilters(), 250));
  selectVisibleBtn.addEventListener('click', () => selectVisibleItems());
  clearSelectionBtn.addEventListener('click', () => clearSelection());
  backupSelectedBtn.addEventListener('click', () => startSelectedBackup());
  exportJsonBtn.addEventListener('click', () => exportSelected('json'));
  exportMdBtn.addEventListener('click', () => exportSelected('md'));
  exportPdfBtn.addEventListener('click', () => exportSelected('pdf'));
  exportWordBtn.addEventListener('click', () => exportSelected('word'));
  exportBothBtn.addEventListener('click', () => exportSelected('both'));
  deleteBtn.addEventListener('click', () => deleteSelected());

  chrome.runtime.onMessage.addListener(handleBackupProgress);
}

document.addEventListener('DOMContentLoaded', async () => {
  await initI18n();
  pageTitleEl = document.getElementById('page-title');
  backupsViewBtn = document.getElementById('backups-view-btn');
  customViewBtn = document.getElementById('custom-view-btn');
  foldersContainer = document.getElementById('folders-container');
  emptyState = document.getElementById('empty-state');
  actionBar = document.getElementById('action-bar');
  selectedCountEl = document.getElementById('selected-count');
  searchInput = document.getElementById('search-input');
  dateModeSelect = document.getElementById('date-filter-mode');
  dateFromInput = document.getElementById('date-from');
  dateToInput = document.getElementById('date-to');
  latestCountInput = document.getElementById('latest-count');
  selectVisibleBtn = document.getElementById('select-visible-btn');
  clearSelectionBtn = document.getElementById('clear-selection-btn');
  loadingOverlay = document.getElementById('loading-overlay');
  loadingText = document.getElementById('loading-text');
  headerStatsEl = document.getElementById('header-stats');
  backupSelectedBtn = document.getElementById('backup-selected-btn');
  exportJsonBtn = document.getElementById('export-json-btn');
  exportMdBtn = document.getElementById('export-md-btn');
  exportPdfBtn = document.getElementById('export-pdf-btn');
  exportWordBtn = document.getElementById('export-word-btn');
  exportBothBtn = document.getElementById('export-both-btn');
  deleteBtn = document.getElementById('delete-btn');

  updatePageMeta();
  updateModeSwitcher();
  updateDateInputsVisibility();
  updateModeSpecificActions();
  bindEvents();
  await loadItems();
});
