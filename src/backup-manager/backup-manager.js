/**
 * Backup Manager - Workspace Folders + Infinite Scroll
 */

import { MESSAGE_TYPES } from '../shared/constants.js';
import { exportAsZip } from './export-utils.js';

const BATCH_SIZE = 50;

// State
let allBackups = [];
let filteredBackups = [];
let selectedIds = new Set();
let sortColumn = 'backup_time';
let sortDirection = 'desc';
let workspaceStates = {}; // { name: { expanded, rendered } }

// DOM refs
let foldersContainer, emptyState, actionBar, selectedCountEl;
let searchInput, dateFromInput, dateToInput, loadingOverlay, loadingText, headerStatsEl;

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function formatDate(ts) {
  if (!ts) return '\u2014';
  const t = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(t);
  return isNaN(d.getTime()) ? '\u2014' : d.toLocaleDateString('en-CA');
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function sendMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resp?.success ? resolve(resp.data) : reject(new Error(resp?.error || 'Unknown error'));
    });
  });
}

function showLoading(text = 'Loading backups...') {
  loadingText.textContent = text;
  loadingOverlay.classList.add('visible');
}
function hideLoading() { loadingOverlay.classList.remove('visible'); }

// ==================== Data ====================

async function loadBackups() {
  showLoading();
  try {
    const data = await sendMessage(MESSAGE_TYPES.GET_ALL_BACKUPS);
    allBackups = Array.isArray(data) ? data : [];
    applyFilters();
    updateStats();
  } catch (err) {
    console.error('Failed to load backups:', err);
    allBackups = [];
    applyFilters();
  } finally {
    hideLoading();
  }
}

function updateStats() {
  const wsCount = new Set(allBackups.map(b => b.workspace_name || 'Personal')).size;
  headerStatsEl.textContent = `${allBackups.length} backups in ${wsCount} workspace${wsCount !== 1 ? 's' : ''}`;
}

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const dateFrom = dateFromInput.value ? new Date(dateFromInput.value).getTime() : 0;
  const dateTo = dateToInput.value ? new Date(dateToInput.value + 'T23:59:59').getTime() : Infinity;

  filteredBackups = allBackups.filter(b => {
    if (query) {
      const title = (b.title || '').toLowerCase();
      const preview = (b.content_preview || '').toLowerCase();
      if (!title.includes(query) && !preview.includes(query)) return false;
    }
    const bt = b.backup_time || 0;
    if (bt < dateFrom || bt > dateTo) return false;
    return true;
  });

  applySort();
}

function applySort() {
  filteredBackups.sort((a, b) => {
    let va = a[sortColumn], vb = b[sortColumn];
    if (sortColumn === 'title' || sortColumn === 'workspace_name') {
      va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase();
      const cmp = va.localeCompare(vb);
      return sortDirection === 'asc' ? cmp : -cmp;
    }
    va = va || 0; vb = vb || 0;
    return sortDirection === 'asc' ? va - vb : vb - va;
  });
  renderFolders();
}

// ==================== Workspace Folders ====================

function groupByWorkspace() {
  const groups = {};
  for (const b of filteredBackups) {
    const ws = b.workspace_name || 'Personal';
    if (!groups[ws]) groups[ws] = [];
    groups[ws].push(b);
  }
  return groups;
}

function renderFolders() {
  const groups = groupByWorkspace();
  const wsNames = Object.keys(groups).sort((a, b) => {
    if (a === 'Personal') return -1;
    if (b === 'Personal') return 1;
    return a.localeCompare(b);
  });

  if (filteredBackups.length === 0) {
    foldersContainer.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  // Preserve expansion state; default: expand if only 1 workspace or was previously expanded
  for (const ws of wsNames) {
    if (!(ws in workspaceStates)) {
      workspaceStates[ws] = { expanded: false, rendered: 0 };
    }
  }

  foldersContainer.innerHTML = '';
  for (const ws of wsNames) {
    const items = groups[ws];
    const st = workspaceStates[ws];
    const folder = createFolder(ws, items, st);
    foldersContainer.appendChild(folder);
  }
  updateActionBar();
}

function createFolder(wsName, items, st) {
  const folder = document.createElement('div');
  folder.className = 'ws-folder' + (st.expanded ? ' expanded' : '');

  const selectedInWs = items.filter(b => selectedIds.has(b.conversation_id)).length;
  const allSelected = items.length > 0 && selectedInWs === items.length;
  const someSelected = selectedInWs > 0 && !allSelected;

  const badgeClass = wsName === 'Personal' ? 'personal' : 'team';

  folder.innerHTML = `
    <div class="ws-header" data-ws="${escapeHtml(wsName)}">
      <input type="checkbox" class="ws-check" data-ws="${escapeHtml(wsName)}"
        ${allSelected ? 'checked' : ''} ${someSelected ? 'data-indeterminate' : ''}>
      <span class="ws-arrow">${st.expanded ? '\u25BC' : '\u25B6'}</span>
      <span class="workspace-badge ${badgeClass}">${escapeHtml(wsName)}</span>
      <span class="ws-count">${items.length} conversation${items.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="ws-body" style="display:${st.expanded ? 'block' : 'none'}">
      <table><thead><tr>
        <th class="col-checkbox"></th>
        <th class="sortable" data-sort="title">Title <span class="sort-arrow"></span></th>
        <th class="col-preview">Preview</th>
        <th class="sortable" data-sort="message_count">Msgs <span class="sort-arrow"></span></th>
        <th class="sortable" data-sort="create_time">Created <span class="sort-arrow"></span></th>
        <th class="sortable" data-sort="update_time">Updated <span class="sort-arrow"></span></th>
        <th class="sortable" data-sort="backup_time">Backed up <span class="sort-arrow"></span></th>
      </tr></thead><tbody></tbody></table>
      <div class="load-sentinel"></div>
    </div>`;

  // Set indeterminate state
  const wsCheck = folder.querySelector('.ws-check');
  if (someSelected) wsCheck.indeterminate = true;

  // Render initial batch
  const tbody = folder.querySelector('tbody');
  if (st.expanded) {
    st.rendered = 0;
    renderBatch(tbody, items, st);
    setupScrollObserver(folder, items, st);
  }

  // Toggle expand/collapse
  folder.querySelector('.ws-header').addEventListener('click', (e) => {
    if (e.target.classList.contains('ws-check')) return;
    st.expanded = !st.expanded;
    renderFolders();
  });

  // Workspace checkbox
  wsCheck.addEventListener('change', () => {
    const ids = items.map(b => b.conversation_id);
    if (wsCheck.checked) {
      ids.forEach(id => selectedIds.add(id));
    } else {
      ids.forEach(id => selectedIds.delete(id));
    }
    renderFolders();
  });

  // Row checkboxes (delegate)
  tbody.addEventListener('change', (e) => {
    if (e.target.classList.contains('row-check')) {
      const id = e.target.dataset.id;
      e.target.checked ? selectedIds.add(id) : selectedIds.delete(id);
      updateActionBar();
      // Update ws checkbox state
      const selCount = items.filter(b => selectedIds.has(b.conversation_id)).length;
      wsCheck.checked = selCount === items.length;
      wsCheck.indeterminate = selCount > 0 && selCount < items.length;
    }
  });

  // Sort headers
  folder.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortColumn === col) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      else { sortColumn = col; sortDirection = 'desc'; }
      applySort();
    });
  });

  // Update sort arrows
  folder.querySelectorAll('th.sortable').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    const col = th.dataset.sort;
    if (col === sortColumn) {
      th.classList.add('sorted');
      arrow.textContent = sortDirection === 'asc' ? '\u25B2' : '\u25BC';
    }
  });

  return folder;
}

function renderBatch(tbody, items, st) {
  const end = Math.min(st.rendered + BATCH_SIZE, items.length);
  for (let i = st.rendered; i < end; i++) {
    tbody.insertAdjacentHTML('beforeend', renderRow(items[i]));
  }
  st.rendered = end;
}

function setupScrollObserver(folder, items, st) {
  const sentinel = folder.querySelector('.load-sentinel');
  const scrollRoot = folder.querySelector('.ws-body');
  if (!sentinel || !scrollRoot || st.rendered >= items.length) return;

  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && st.rendered < items.length) {
      const tbody = folder.querySelector('tbody');
      renderBatch(tbody, items, st);
      if (st.rendered >= items.length) observer.disconnect();
    }
  }, { root: scrollRoot, rootMargin: '100px' });
  observer.observe(sentinel);
}

function renderRow(backup) {
  const id = backup.conversation_id;
  const checked = selectedIds.has(id) ? 'checked' : '';
  const title = escapeHtml(backup.title || 'Untitled');
  const preview = escapeHtml(backup.content_preview || '\u2014');
  const msgs = backup.message_count != null ? backup.message_count : '\u2014';
  const created = formatDate(backup.create_time);
  const updated = formatDate(backup.update_time);
  const backedUp = formatDate(backup.backup_time);

  return `<tr data-id="${id}">
    <td class="col-checkbox"><input type="checkbox" class="row-check" data-id="${id}" ${checked}></td>
    <td class="col-title" title="${title}">${title}</td>
    <td class="col-preview" title="${preview}">${preview}</td>
    <td class="col-msgs">${msgs}</td>
    <td class="col-date">${created}</td>
    <td class="col-date">${updated}</td>
    <td class="col-date">${backedUp}</td>
  </tr>`;
}

// ==================== Actions ====================

function updateActionBar() {
  if (selectedIds.size > 0) {
    actionBar.classList.add('visible');
    selectedCountEl.textContent = `${selectedIds.size} selected`;
  } else {
    actionBar.classList.remove('visible');
  }
}

async function deleteSelected() {
  const count = selectedIds.size;
  if (!count) return;
  if (!confirm(`Delete ${count} backup${count > 1 ? 's' : ''}? This cannot be undone.`)) return;
  showLoading('Deleting backups...');
  try {
    await sendMessage(MESSAGE_TYPES.BATCH_DELETE_BACKUPS, { ids: [...selectedIds] });
    selectedIds.clear();
    await loadBackups();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
    hideLoading();
  }
}

async function exportSelected(format) {
  if (!selectedIds.size) return;
  showLoading('Preparing export...');
  try {
    const backups = await sendMessage(MESSAGE_TYPES.BATCH_GET_BACKUPS, { ids: [...selectedIds] });
    await exportAsZip(backups, { format });
  } catch (err) {
    alert('Export failed: ' + err.message);
  } finally {
    hideLoading();
  }
}

// ==================== Init ====================

function bindEvents() {
  searchInput.addEventListener('input', debounce(() => applyFilters(), 300));
  dateFromInput.addEventListener('change', () => applyFilters());
  dateToInput.addEventListener('change', () => applyFilters());
  document.getElementById('export-json-btn').addEventListener('click', () => exportSelected('json'));
  document.getElementById('export-md-btn').addEventListener('click', () => exportSelected('md'));
  document.getElementById('export-both-btn').addEventListener('click', () => exportSelected('both'));
  document.getElementById('delete-btn').addEventListener('click', () => deleteSelected());
}

document.addEventListener('DOMContentLoaded', () => {
  foldersContainer = document.getElementById('folders-container');
  emptyState = document.getElementById('empty-state');
  actionBar = document.getElementById('action-bar');
  selectedCountEl = document.getElementById('selected-count');
  searchInput = document.getElementById('search-input');
  dateFromInput = document.getElementById('date-from');
  dateToInput = document.getElementById('date-to');
  loadingOverlay = document.getElementById('loading-overlay');
  loadingText = document.getElementById('loading-text');
  headerStatsEl = document.getElementById('header-stats');

  bindEvents();
  loadBackups();
});
