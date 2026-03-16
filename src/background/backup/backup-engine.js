/**
 * Background Backup Engine
 * 在 service worker 中运行，独立于 popup/content script 生命周期
 * 支持并发备份、暂停/继续/停止
 */

import { db } from '../database/db.js';

const API_BASE = 'https://chatgpt.com/backend-api';
const PAGE_LIMIT = 100;

// Concurrency settings
const INITIAL_CONCURRENCY = 8;
const MIN_CONCURRENCY = 2;
const INITIAL_DELAY = 200;       // ms between launching each concurrent request
const BACKOFF_DELAY = 5000;      // ms to wait after 429
const MAX_RETRIES = 3;

// ==================== Backup State ====================

const BackupStatus = { IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused' };

const state = {
  status: BackupStatus.IDLE,
  total: 0, completed: 0, success: 0, skipped: 0, failed: 0,
  currentTitle: '',
  concurrency: INITIAL_CONCURRENCY,
  queue: [], workspaceMap: {}, token: null, accountId: null,
  _pauseResolve: null,
};

// ==================== Helpers ====================

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getToken() {
  const result = await chrome.storage.local.get(['accessToken']);
  return result.accessToken || null;
}

async function getAccountId() {
  try {
    const cookie = await chrome.cookies.get({ url: 'https://chatgpt.com', name: '_account' });
    return cookie?.value || null;
  } catch { return null; }
}

async function apiFetch(url, token, accountId) {
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (accountId) headers['chatgpt-account-id'] = accountId;
  const resp = await fetch(url, { headers });
  if (resp.status === 429) {
    const err = new Error('Rate limited');
    err.status = 429;
    err.retryAfter = parseInt(resp.headers.get('retry-after') || '5', 10);
    throw err;
  }
  if (!resp.ok) throw new Error(`API ${resp.status}: ${url}`);
  return resp.json();
}

async function apiFetchWithRetry(url, token, accountId, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await apiFetch(url, token, accountId);
    } catch (err) {
      if (err.status === 429 && attempt < retries) {
        const wait = (err.retryAfter || 5) * 1000;
        console.warn(`[BackupEngine] 429 on attempt ${attempt}, waiting ${wait}ms`);
        // Reduce concurrency on 429
        state.concurrency = Math.max(MIN_CONCURRENCY, Math.floor(state.concurrency / 2));
        console.log(`[BackupEngine] Concurrency reduced to ${state.concurrency}`);
        await delay(wait);
        continue;
      }
      throw err;
    }
  }
}

function broadcastProgress() {
  const payload = {
    status: state.status, total: state.total, completed: state.completed,
    success: state.success, skipped: state.skipped, failed: state.failed,
    currentTitle: state.currentTitle, concurrency: state.concurrency
  };
  try { chrome.runtime.sendMessage({ type: 'BACKUP_PROGRESS', payload }).catch(() => {}); }
  catch { /* no listeners */ }
}

// ==================== API Calls ====================

async function fetchAccountsInfo(token, accountId) {
  const workspaceMap = {};
  try {
    const data = await apiFetch(`${API_BASE}/accounts/check/v4-2023-04-27`, token, accountId);
    if (data?.accounts) {
      for (const [id, info] of Object.entries(data.accounts)) {
        if (id === 'default') continue;
        const acct = info?.account;
        workspaceMap[id] = acct?.name || (acct?.structure === 'personal' ? 'Personal' : id);
      }
    }
  } catch (err) {
    console.warn('[BackupEngine] Failed to fetch accounts info:', err);
  }
  return workspaceMap;
}

async function fetchAllConversations(token, accountId) {
  const allMap = new Map();

  // Phase 1: initial request — ChatGPT API returns far more than `limit` items
  state.currentTitle = 'Fetching conversation list...';
  broadcastProgress();

  const data = await apiFetchWithRetry(
    `${API_BASE}/conversations?offset=0&limit=${PAGE_LIMIT}&order=updated`,
    token, accountId
  );

  if (data.items) {
    for (const item of data.items) allMap.set(item.id, item);
  }

  state.currentTitle = `Fetching list... (${allMap.size})`;
  broadcastProgress();

  if (state.status === BackupStatus.IDLE) return [...allMap.values()];

  // Phase 2: parallel补漏 — fire a few requests at spread-out offsets to catch stragglers
  const baseCount = allMap.size;
  if (baseCount > 0) {
    const step = Math.max(1000, Math.floor(baseCount * 0.8));
    const offsets = [step, step * 2];

    const results = await Promise.all(offsets.map(async (offset) => {
      try {
        const d = await apiFetchWithRetry(
          `${API_BASE}/conversations?offset=${offset}&limit=${PAGE_LIMIT}&order=updated`,
          token, accountId
        );
        return d.items || [];
      } catch (err) {
        console.warn(`[BackupEngine] Supplementary fetch at offset=${offset} failed:`, err.message);
        return [];
      }
    }));

    for (const items of results) {
      for (const item of items) allMap.set(item.id, item);
    }
  }

  console.log(`[BackupEngine] Fetched ${allMap.size} unique conversations (base=${baseCount})`);
  state.currentTitle = `Fetched ${allMap.size} conversations`;
  broadcastProgress();

  return [...allMap.values()];
}

// ==================== Concurrent Backup Engine ====================

async function waitIfPaused() {
  while (state.status === BackupStatus.PAUSED) {
    await new Promise(resolve => { state._pauseResolve = resolve; });
    state._pauseResolve = null;
  }
}

async function backupOne(conv) {
  const { token, accountId, workspaceMap } = state;
  const fullData = await apiFetchWithRetry(`${API_BASE}/conversation/${conv.id}`, token, accountId);

  if (conv.workspace_id) {
    fullData.workspace_id = conv.workspace_id;
    if (workspaceMap[conv.workspace_id]) {
      fullData._workspace_name = workspaceMap[conv.workspace_id];
    }
  }

  await db.saveBackup(fullData);
}

async function runBackupLoop() {
  const { queue } = state;
  let idx = 0;

  while (idx < queue.length) {
    if (state.status === BackupStatus.IDLE) break;
    await waitIfPaused();
    if (state.status === BackupStatus.IDLE) break;

    // Take a batch of size = current concurrency
    const batchSize = Math.min(state.concurrency, queue.length - idx);
    const batch = queue.slice(idx, idx + batchSize);

    state.currentTitle = `${batch[0]?.title || 'Untitled'} (+${batchSize - 1})`;
    broadcastProgress();

    // Launch batch with staggered start
    const promises = batch.map((conv, i) => {
      return (async () => {
        if (i > 0) await delay(INITIAL_DELAY * i);
        if (state.status === BackupStatus.IDLE) return;

        try {
          await backupOne(conv);
          state.success++;
        } catch (err) {
          console.error(`[BackupEngine] Failed: ${conv.id}`, err.message);
          state.failed++;
        }

        state.completed++;
        state.currentTitle = `${conv.title || 'Untitled'} (${state.completed}/${state.total})`;
        broadcastProgress();
      })();
    });

    await Promise.all(promises);
    idx += batchSize;
  }

  state.status = BackupStatus.IDLE;
  state.currentTitle = 'Done';
  broadcastProgress();
  console.log(`[BackupEngine] Finished. success=${state.success} skipped=${state.skipped} failed=${state.failed}`);
}

// ==================== Public API ====================

export async function startBackup() {
  if (state.status !== BackupStatus.IDLE) {
    return { error: 'Backup already in progress' };
  }

  Object.assign(state, {
    status: BackupStatus.RUNNING,
    total: 0, completed: 0, success: 0, skipped: 0, failed: 0,
    currentTitle: 'Initializing...', queue: [],
    concurrency: INITIAL_CONCURRENCY
  });
  broadcastProgress();

  try {
    state.token = await getToken();
    if (!state.token) { state.status = BackupStatus.IDLE; return { error: 'No token available.' }; }

    state.accountId = await getAccountId();

    state.currentTitle = 'Fetching account info...';
    broadcastProgress();
    state.workspaceMap = await fetchAccountsInfo(state.token, state.accountId);

    state.currentTitle = 'Fetching conversation list...';
    broadcastProgress();
    const conversations = await fetchAllConversations(state.token, state.accountId);

    const existingIds = await db.getAllBackupIds();
    const toBackup = conversations.filter(c => !existingIds.has(c.id));
    state.skipped = conversations.length - toBackup.length;
    state.queue = toBackup;
    state.total = toBackup.length;
    broadcastProgress();

    console.log(`[BackupEngine] Starting: ${toBackup.length} to backup, ${state.skipped} skipped, concurrency=${state.concurrency}`);

    runBackupLoop().catch(err => {
      console.error('[BackupEngine] Loop error:', err);
      state.status = BackupStatus.IDLE;
      state.currentTitle = `Error: ${err.message}`;
      broadcastProgress();
    });

    return { started: true, total: state.total, skipped: state.skipped };
  } catch (err) {
    state.status = BackupStatus.IDLE;
    broadcastProgress();
    return { error: err.message };
  }
}

export function pauseBackup() {
  if (state.status === BackupStatus.RUNNING) {
    state.status = BackupStatus.PAUSED;
    broadcastProgress();
    return { paused: true };
  }
  return { error: 'Not running' };
}

export function resumeBackup() {
  if (state.status === BackupStatus.PAUSED) {
    state.status = BackupStatus.RUNNING;
    if (state._pauseResolve) state._pauseResolve();
    broadcastProgress();
    return { resumed: true };
  }
  return { error: 'Not paused' };
}

export function stopBackup() {
  if (state.status !== BackupStatus.IDLE) {
    const wasPaused = state.status === BackupStatus.PAUSED;
    state.status = BackupStatus.IDLE;
    if (wasPaused && state._pauseResolve) state._pauseResolve();
    broadcastProgress();
    return { stopped: true, success: state.success, skipped: state.skipped, failed: state.failed };
  }
  return { error: 'Not running' };
}

export function getBackupStatus() {
  return {
    status: state.status, total: state.total, completed: state.completed,
    success: state.success, skipped: state.skipped, failed: state.failed,
    currentTitle: state.currentTitle, concurrency: state.concurrency
  };
}
