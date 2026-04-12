/**
 * Background Backup Engine
 * Runs inside the service worker and supports both batch backup and
 * explicit selection backup from extension pages / ChatGPT menus.
 */

import { db } from '../database/db.js';

const API_BASE = 'https://chatgpt.com/backend-api';
const PAGE_LIMIT = 100;

const INITIAL_CONCURRENCY = 8;
const MIN_CONCURRENCY = 2;
const INITIAL_DELAY = 200;
const MAX_RETRIES = 3;

const BackupStatus = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused'
};

const state = {
  status: BackupStatus.IDLE,
  total: 0,
  completed: 0,
  success: 0,
  skipped: 0,
  failed: 0,
  currentTitle: '',
  concurrency: INITIAL_CONCURRENCY,
  queue: [],
  workspaceMap: {},
  token: null,
  accountId: null,
  _pauseResolve: null
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getToken() {
  const result = await chrome.storage.local.get(['accessToken']);
  return result.accessToken || null;
}

async function getAccountId() {
  try {
    const cookie = await chrome.cookies.get({ url: 'https://chatgpt.com', name: '_account' });
    return cookie?.value || null;
  } catch {
    return null;
  }
}

async function apiFetch(url, token, accountId) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  if (accountId) {
    headers['chatgpt-account-id'] = accountId;
  }

  const response = await fetch(url, { headers });
  if (response.status === 429) {
    const error = new Error('Rate limited');
    error.status = 429;
    error.retryAfter = parseInt(response.headers.get('retry-after') || '5', 10);
    throw error;
  }

  if (!response.ok) {
    throw new Error(`API ${response.status}: ${url}`);
  }

  return response.json();
}

async function apiFetchWithRetry(url, token, accountId, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await apiFetch(url, token, accountId);
    } catch (error) {
      if (error.status === 429 && attempt < retries) {
        const wait = (error.retryAfter || 5) * 1000;
        state.concurrency = Math.max(MIN_CONCURRENCY, Math.floor(state.concurrency / 2));
        console.warn(`[BackupEngine] 429 on attempt ${attempt}, waiting ${wait}ms`);
        console.log(`[BackupEngine] Concurrency reduced to ${state.concurrency}`);
        await delay(wait);
        continue;
      }

      throw error;
    }
  }

  throw new Error('API request failed after retries');
}

function broadcastProgress() {
  const payload = {
    status: state.status,
    total: state.total,
    completed: state.completed,
    success: state.success,
    skipped: state.skipped,
    failed: state.failed,
    currentTitle: state.currentTitle,
    concurrency: state.concurrency
  };

  try {
    chrome.runtime.sendMessage({ type: 'BACKUP_PROGRESS', payload }).catch(() => {});
  } catch {
    // no listeners
  }
}

function getWorkspaceName(workspaceId, workspaceMap) {
  if (!workspaceId) {
    return 'Personal';
  }

  return workspaceMap[workspaceId] || 'Team';
}

function normalizeTimestamp(value) {
  if (!value) {
    return 0;
  }

  if (typeof value === 'number') {
    return value;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchAccountsInfo(token, accountId) {
  const workspaceMap = {};

  try {
    const data = await apiFetch(`${API_BASE}/accounts/check/v4-2023-04-27`, token, accountId);
    if (data?.accounts) {
      for (const [id, info] of Object.entries(data.accounts)) {
        if (id === 'default') continue;
        const account = info?.account;
        workspaceMap[id] = account?.name || (account?.structure === 'personal' ? 'Personal' : id);
      }
    }
  } catch (error) {
    console.warn('[BackupEngine] Failed to fetch accounts info:', error);
  }

  return workspaceMap;
}

async function fetchAllConversations(token, accountId, { emitProgress = true } = {}) {
  const allMap = new Map();

  if (emitProgress) {
    state.currentTitle = 'Fetching conversation list...';
    broadcastProgress();
  }

  const data = await apiFetchWithRetry(
    `${API_BASE}/conversations?offset=0&limit=${PAGE_LIMIT}&order=updated`,
    token,
    accountId
  );

  if (data.items) {
    for (const item of data.items) {
      allMap.set(item.id, item);
    }
  }

  if (emitProgress) {
    state.currentTitle = `Fetching list... (${allMap.size})`;
    broadcastProgress();
  }

  if (emitProgress && state.status === BackupStatus.IDLE) {
    return [...allMap.values()];
  }

  const baseCount = allMap.size;
  if (baseCount > 0) {
    const step = Math.max(1000, Math.floor(baseCount * 0.8));
    const offsets = [step, step * 2];

    const results = await Promise.all(
      offsets.map(async offset => {
        try {
          const extra = await apiFetchWithRetry(
            `${API_BASE}/conversations?offset=${offset}&limit=${PAGE_LIMIT}&order=updated`,
            token,
            accountId
          );
          return extra.items || [];
        } catch (error) {
          console.warn(
            `[BackupEngine] Supplementary fetch at offset=${offset} failed:`,
            error.message
          );
          return [];
        }
      })
    );

    for (const items of results) {
      for (const item of items) {
        allMap.set(item.id, item);
      }
    }
  }

  if (emitProgress) {
    state.currentTitle = `Fetched ${allMap.size} conversations`;
    broadcastProgress();
  }

  console.log(`[BackupEngine] Fetched ${allMap.size} unique conversations (base=${baseCount})`);
  return [...allMap.values()];
}

function buildRemoteConversationMeta(conversation, workspaceMap, existingMetaMap) {
  const existingMeta = existingMetaMap.get(conversation.id);
  const workspaceName = getWorkspaceName(conversation.workspace_id, workspaceMap);

  return {
    conversation_id: conversation.id,
    id: conversation.id,
    title: conversation.title || '',
    create_time: normalizeTimestamp(conversation.create_time),
    update_time: normalizeTimestamp(conversation.update_time),
    workspace_id: conversation.workspace_id || null,
    workspace_name: workspaceName,
    content_preview:
      existingMeta?.content_preview ||
      conversation.snippet ||
      conversation.summary ||
      conversation.preview ||
      '',
    message_count: existingMeta?.message_count ?? null,
    backup_time: existingMeta?.backup_time || 0,
    already_backed_up: Boolean(existingMeta)
  };
}

function uniqConversationIds(ids = []) {
  const seen = new Set();
  const result = [];

  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  return result;
}

function selectConversationsByIds(conversations, ids) {
  const byId = new Map(conversations.map(conversation => [conversation.id, conversation]));
  const selected = [];
  const missing = [];

  for (const id of uniqConversationIds(ids)) {
    const conversation = byId.get(id);
    if (conversation) {
      selected.push(conversation);
    } else {
      missing.push(id);
    }
  }

  return { selected, missing };
}

async function backupOne(conversation) {
  const { token, accountId, workspaceMap } = state;
  const fullData = await apiFetchWithRetry(
    `${API_BASE}/conversation/${conversation.id}`,
    token,
    accountId
  );

  if (conversation.workspace_id) {
    fullData.workspace_id = conversation.workspace_id;
    fullData._workspace_name = getWorkspaceName(conversation.workspace_id, workspaceMap);
  }

  await db.saveBackup(fullData);
}

async function waitIfPaused() {
  while (state.status === BackupStatus.PAUSED) {
    await new Promise(resolve => {
      state._pauseResolve = resolve;
    });
    state._pauseResolve = null;
  }
}

async function runBackupLoop() {
  const { queue } = state;
  let index = 0;

  while (index < queue.length) {
    if (state.status === BackupStatus.IDLE) break;

    await waitIfPaused();
    if (state.status === BackupStatus.IDLE) break;

    const batchSize = Math.min(state.concurrency, queue.length - index);
    const batch = queue.slice(index, index + batchSize);

    state.currentTitle = `${batch[0]?.title || 'Untitled'} (+${batchSize - 1})`;
    broadcastProgress();

    const promises = batch.map((conversation, offset) => {
      return (async () => {
        if (offset > 0) {
          await delay(INITIAL_DELAY * offset);
        }

        if (state.status === BackupStatus.IDLE) return;

        try {
          await backupOne(conversation);
          state.success++;
        } catch (error) {
          console.error(`[BackupEngine] Failed: ${conversation.id}`, error.message);
          state.failed++;
        }

        state.completed++;
        state.currentTitle = `${conversation.title || 'Untitled'} (${state.completed}/${state.total})`;
        broadcastProgress();
      })();
    });

    await Promise.all(promises);
    index += batchSize;
  }

  state.status = BackupStatus.IDLE;
  state.currentTitle = 'Done';
  broadcastProgress();
  console.log(
    `[BackupEngine] Finished. success=${state.success} skipped=${state.skipped} failed=${state.failed}`
  );
}

function resetState() {
  Object.assign(state, {
    status: BackupStatus.RUNNING,
    total: 0,
    completed: 0,
    success: 0,
    skipped: 0,
    failed: 0,
    currentTitle: 'Initializing...',
    concurrency: INITIAL_CONCURRENCY,
    queue: [],
    workspaceMap: {},
    token: null,
    accountId: null
  });
}

export async function getRemoteConversationList() {
  const token = await getToken();
  if (!token) {
    throw new Error('No token available.');
  }

  const accountId = await getAccountId();
  const workspaceMap = await fetchAccountsInfo(token, accountId);
  const [conversations, existingMetas] = await Promise.all([
    fetchAllConversations(token, accountId, { emitProgress: false }),
    db.getAllBackupsMeta()
  ]);

  const existingMetaMap = new Map(
    (existingMetas || []).map(meta => [meta.conversation_id, meta])
  );

  return conversations
    .map(conversation => buildRemoteConversationMeta(conversation, workspaceMap, existingMetaMap))
    .sort((a, b) => (b.update_time || 0) - (a.update_time || 0));
}

export async function startBackup(options = {}) {
  if (state.status !== BackupStatus.IDLE) {
    return { error: 'Backup already in progress' };
  }

  resetState();
  broadcastProgress();

  try {
    state.token = await getToken();
    if (!state.token) {
      state.status = BackupStatus.IDLE;
      broadcastProgress();
      return { error: 'No token available.' };
    }

    state.accountId = await getAccountId();

    state.currentTitle = 'Fetching account info...';
    broadcastProgress();
    state.workspaceMap = await fetchAccountsInfo(state.token, state.accountId);

    state.currentTitle = 'Fetching conversation list...';
    broadcastProgress();
    const conversations = await fetchAllConversations(state.token, state.accountId);

    const requestedIds = uniqConversationIds(options?.conversationIds || []);

    if (requestedIds.length > 0) {
      const { selected, missing } = selectConversationsByIds(conversations, requestedIds);
      if (selected.length === 0) {
        state.status = BackupStatus.IDLE;
        state.currentTitle = '';
        broadcastProgress();
        return { error: 'Selected conversations were not found.' };
      }

      state.queue = selected;
      state.total = selected.length;
      state.skipped = 0;
      state.currentTitle = `Selected ${selected.length} conversation(s)`;
      broadcastProgress();

      runBackupLoop().catch(error => {
        console.error('[BackupEngine] Loop error:', error);
        state.status = BackupStatus.IDLE;
        state.currentTitle = `Error: ${error.message}`;
        broadcastProgress();
      });

      return {
        started: true,
        total: state.total,
        skipped: 0,
        missing
      };
    }

    const existingIds = await db.getAllBackupIds();
    const toBackup = conversations.filter(conversation => !existingIds.has(conversation.id));

    state.skipped = conversations.length - toBackup.length;
    state.queue = toBackup;
    state.total = toBackup.length;
    broadcastProgress();

    console.log(
      `[BackupEngine] Starting: ${toBackup.length} to backup, ${state.skipped} skipped, concurrency=${state.concurrency}`
    );

    runBackupLoop().catch(error => {
      console.error('[BackupEngine] Loop error:', error);
      state.status = BackupStatus.IDLE;
      state.currentTitle = `Error: ${error.message}`;
      broadcastProgress();
    });

    return {
      started: true,
      total: state.total,
      skipped: state.skipped
    };
  } catch (error) {
    state.status = BackupStatus.IDLE;
    state.currentTitle = '';
    broadcastProgress();
    return { error: error.message };
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
    if (state._pauseResolve) {
      state._pauseResolve();
    }
    broadcastProgress();
    return { resumed: true };
  }

  return { error: 'Not paused' };
}

export function stopBackup() {
  if (state.status !== BackupStatus.IDLE) {
    const wasPaused = state.status === BackupStatus.PAUSED;
    state.status = BackupStatus.IDLE;
    if (wasPaused && state._pauseResolve) {
      state._pauseResolve();
    }
    broadcastProgress();
    return {
      stopped: true,
      success: state.success,
      skipped: state.skipped,
      failed: state.failed
    };
  }

  return { error: 'Not running' };
}

export function getBackupStatus() {
  return {
    status: state.status,
    total: state.total,
    completed: state.completed,
    success: state.success,
    skipped: state.skipped,
    failed: state.failed,
    currentTitle: state.currentTitle,
    concurrency: state.concurrency
  };
}
