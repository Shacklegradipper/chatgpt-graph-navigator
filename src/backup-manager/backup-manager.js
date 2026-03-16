/**
 * Backup Manager - List, Search, Filter, Sort, Select, Export, Delete
 */

import { MESSAGE_TYPES } from '../shared/constants.js';
import { exportAsZip } from './export-utils.js';

const PAGE_SIZE = 20;

// State
let allBackups = [];
let filteredBackups = [];
let selectedIds = new Set();
let sortColumn = 'backup_time';
let sortDirection = 'desc';
let currentPage = 1;

// DOM refs
let tableBody;
let emptyState;
let actionBar;
let selectedCountEl;
let selectAllCheckbox;
let paginationEl;
let headerStatsEl;
let searchInput;
let workspaceFilter;
let dateFromInput;
let dateToInput;
let loadingOverlay;
let loadingText;

// Debounce helper
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Format date
function formatDate(timestamp) {
  if (!timestamp) return '\u2014';
  // Handle both seconds and milliseconds timestamps
  const ts = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString('en-CA'); // YYYY-MM-DD
}

// Send message to background
function sendMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.success) {
        resolve(response.data);
      } else {
        reject(new Error(response?.error || 'Unknown error'));
      }
    });
  });
}

// Show/hide loading
function showLoading(text = 'Loading backups...') {
  loadingText.textContent = text;
  loadingOverlay.classList.add('visible');
}

function hideLoading() {
  loadingOverlay.classList.remove('visible');
}

// Load backups from background
async function loadBackups() {
  showLoading();
  try {
    const data = await sendMessage(MESSAGE_TYPES.GET_ALL_BACKUPS);
    allBackups = Array.isArray(data) ? data : [];
    populateWorkspaceFilter();
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

// Populate workspace filter with actual workspace names from data
function populateWorkspaceFilter() {
  const names = new Set();
  for (const b of allBackups) {
    names.add(b.workspace_name || 'Personal');
  }

  // Keep first option (All Workspaces), rebuild the rest
  workspaceFilter.innerHTML = '<option value="">All Workspaces</option>';
  for (const name of [...names].sort()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    workspaceFilter.appendChild(opt);
  }
}

// Update header stats
function updateStats() {
  headerStatsEl.textContent = `${allBackups.length} backup${allBackups.length !== 1 ? 's' : ''} total`;
}

// Apply search + filters
function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const workspace = workspaceFilter.value;
  const dateFrom = dateFromInput.value ? new Date(dateFromInput.value).getTime() : 0;
  const dateTo = dateToInput.value ? new Date(dateToInput.value + 'T23:59:59').getTime() : Infinity;

  filteredBackups = allBackups.filter(b => {
    // Text search
    if (query) {
      const title = (b.title || '').toLowerCase();
      const preview = (b.content_preview || '').toLowerCase();
      if (!title.includes(query) && !preview.includes(query)) return false;
    }

    // Workspace filter
    if (workspace && (b.workspace_name || 'Personal') !== workspace) return false;

    // Date range (based on backup_time which is in milliseconds)
    const bt = b.backup_time || 0;
    if (bt < dateFrom || bt > dateTo) return false;

    return true;
  });

  applySort();
}

// Apply sort
function applySort() {
  filteredBackups.sort((a, b) => {
    let va = a[sortColumn];
    let vb = b[sortColumn];

    // String comparison for title and workspace
    if (sortColumn === 'title' || sortColumn === 'workspace_name') {
      va = (va || '').toLowerCase();
      vb = (vb || '').toLowerCase();
      const cmp = va.localeCompare(vb);
      return sortDirection === 'asc' ? cmp : -cmp;
    }

    // Numeric comparison
    va = va || 0;
    vb = vb || 0;
    return sortDirection === 'asc' ? va - vb : vb - va;
  });

  // Reset to page 1 when filters/sort change
  currentPage = 1;
  renderTable();
  updateSortHeaders();
}

// Update sort header arrows
function updateSortHeaders() {
  document.querySelectorAll('th.sortable').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    const col = th.dataset.sort;
    if (col === sortColumn) {
      th.classList.add('sorted');
      arrow.textContent = sortDirection === 'asc' ? '\u25B2' : '\u25BC';
    } else {
      th.classList.remove('sorted');
      arrow.textContent = '';
    }
  });
}

// Render table rows for current page
function renderTable() {
  const totalPages = Math.max(1, Math.ceil(filteredBackups.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredBackups.slice(start, start + PAGE_SIZE);

  if (filteredBackups.length === 0) {
    tableBody.innerHTML = '';
    emptyState.style.display = 'block';
  } else {
    emptyState.style.display = 'none';
    tableBody.innerHTML = pageItems.map(b => renderRow(b)).join('');
  }

  // Update select-all checkbox state
  const visibleIds = pageItems.map(b => b.conversation_id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
  selectAllCheckbox.checked = allVisibleSelected;
  selectAllCheckbox.indeterminate = !allVisibleSelected && visibleIds.some(id => selectedIds.has(id));

  renderPagination(totalPages);
  updateActionBar();
}

// Render a single row
function renderRow(backup) {
  const id = backup.conversation_id;
  const checked = selectedIds.has(id) ? 'checked' : '';
  const title = escapeHtml(backup.title || 'Untitled');
  const preview = escapeHtml(backup.content_preview || '\u2014');
  const backupTime = formatDate(backup.backup_time);
  const workspace = backup.workspace_name || 'Personal';
  const wsBadgeClass = workspace === 'Team' ? 'team' : 'personal';
  const msgs = backup.message_count != null ? backup.message_count : '\u2014';
  const created = formatDate(backup.create_time);
  const updated = formatDate(backup.update_time);

  return `<tr data-id="${id}">
    <td class="col-checkbox"><input type="checkbox" class="row-check" data-id="${id}" ${checked}></td>
    <td class="col-title" title="${title}">${title}</td>
    <td class="col-preview" title="${preview}">${preview}</td>
    <td class="col-date">${backupTime}</td>
    <td class="col-workspace"><span class="workspace-badge ${wsBadgeClass}">${workspace}</span></td>
    <td class="col-msgs">${msgs}</td>
    <td class="col-date col-created">${created}</td>
    <td class="col-date col-updated">${updated}</td>
  </tr>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Render pagination
function renderPagination(totalPages) {
  if (totalPages <= 1) {
    paginationEl.innerHTML = '';
    return;
  }

  paginationEl.innerHTML = `
    <button class="page-btn" id="prev-page" ${currentPage <= 1 ? 'disabled' : ''}>&#8592; Prev</button>
    <span class="page-info">Page ${currentPage} / ${totalPages}</span>
    <button class="page-btn" id="next-page" ${currentPage >= totalPages ? 'disabled' : ''}>Next &#8594;</button>
  `;

  document.getElementById('prev-page')?.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  });

  document.getElementById('next-page')?.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      renderTable();
    }
  });
}

// Update action bar visibility
function updateActionBar() {
  if (selectedIds.size > 0) {
    actionBar.classList.add('visible');
    selectedCountEl.textContent = `${selectedIds.size} selected`;
  } else {
    actionBar.classList.remove('visible');
  }
}

// Toggle select all (visible page only)
function toggleSelectAll() {
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredBackups.slice(start, start + PAGE_SIZE);
  const visibleIds = pageItems.map(b => b.conversation_id);

  const allSelected = visibleIds.every(id => selectedIds.has(id));

  if (allSelected) {
    visibleIds.forEach(id => selectedIds.delete(id));
  } else {
    visibleIds.forEach(id => selectedIds.add(id));
  }

  renderTable();
}

// Toggle single selection
function toggleSelectOne(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }
  renderTable();
}

// Delete selected backups
async function deleteSelected() {
  const count = selectedIds.size;
  if (count === 0) return;

  const confirmed = confirm(`Delete ${count} backup${count > 1 ? 's' : ''}? This cannot be undone.`);
  if (!confirmed) return;

  showLoading('Deleting backups...');
  try {
    await sendMessage(MESSAGE_TYPES.BATCH_DELETE_BACKUPS, { ids: [...selectedIds] });
    selectedIds.clear();
    await loadBackups();
  } catch (err) {
    alert('Failed to delete backups: ' + err.message);
    hideLoading();
  }
}

// Export selected backups
async function exportSelected(format) {
  if (selectedIds.size === 0) return;

  showLoading('Preparing export...');
  try {
    const backups = await sendMessage(MESSAGE_TYPES.BATCH_GET_BACKUPS, { ids: [...selectedIds] });
    await exportAsZip(backups, { format });
  } catch (err) {
    alert('Failed to export backups: ' + err.message);
  } finally {
    hideLoading();
  }
}

// Bind all events
function bindEvents() {
  // Search (debounced)
  searchInput.addEventListener('input', debounce(() => applyFilters(), 300));

  // Filters
  workspaceFilter.addEventListener('change', () => applyFilters());
  dateFromInput.addEventListener('change', () => applyFilters());
  dateToInput.addEventListener('change', () => applyFilters());

  // Sort
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortColumn === col) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = col;
        sortDirection = 'desc';
      }
      applySort();
    });
  });

  // Select all
  selectAllCheckbox.addEventListener('change', () => toggleSelectAll());

  // Row checkboxes (delegate)
  tableBody.addEventListener('change', (e) => {
    if (e.target.classList.contains('row-check')) {
      toggleSelectOne(e.target.dataset.id);
    }
  });

  // Action buttons
  document.getElementById('export-json-btn').addEventListener('click', () => exportSelected('json'));
  document.getElementById('export-md-btn').addEventListener('click', () => exportSelected('md'));
  document.getElementById('export-both-btn').addEventListener('click', () => exportSelected('both'));
  document.getElementById('delete-btn').addEventListener('click', () => deleteSelected());
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Cache DOM refs
  tableBody = document.getElementById('table-body');
  emptyState = document.getElementById('empty-state');
  actionBar = document.getElementById('action-bar');
  selectedCountEl = document.getElementById('selected-count');
  selectAllCheckbox = document.getElementById('select-all');
  paginationEl = document.getElementById('pagination');
  headerStatsEl = document.getElementById('header-stats');
  searchInput = document.getElementById('search-input');
  workspaceFilter = document.getElementById('workspace-filter');
  dateFromInput = document.getElementById('date-from');
  dateToInput = document.getElementById('date-to');
  loadingOverlay = document.getElementById('loading-overlay');
  loadingText = document.getElementById('loading-text');

  bindEvents();
  loadBackups();
});
