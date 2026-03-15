/**
 * 对话备份管理器
 * 批量备份 ChatGPT 对话的原始 API JSON 数据
 */

import { MESSAGE_TYPES } from '../../shared/constants.js';
import { getToken as getStoredToken, loadToken, hasToken } from '../auth/token-manager.js';

const API_BASE = 'https://chatgpt.com/backend-api';
const PAGE_LIMIT = 100;
const REQUEST_DELAY = 1000; // 1秒间隔避免 429

/**
 * 获取当前 token
 * 直接从 content script 的 token-manager 获取（它从 chrome.storage.local 读取）
 */
async function getToken() {
  // 先尝试内存中的 token
  let token = getStoredToken();
  if (token) return token;

  // 内存中没有，尝试从 storage 加载
  await loadToken();
  return getStoredToken();
}

/**
 * 带 token 的 fetch 封装
 */
async function apiFetch(url, token) {
  const resp = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  if (!resp.ok) {
    throw new Error(`API ${resp.status}: ${url}`);
  }
  return resp.json();
}

/**
 * 延迟
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 获取已备份的对话 ID 集合
 */
async function getExistingBackupIds() {
  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.RESTORE_GET_IDS
  });
  return new Set(response?.data || response?.payload || []);
}

/**
 * 获取所有对话列表（分页）
 */
async function fetchAllConversations(token) {
  const conversations = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await apiFetch(
      `${API_BASE}/conversations?offset=${offset}&limit=${PAGE_LIMIT}&order=updated`,
      token
    );

    if (data.items && data.items.length > 0) {
      conversations.push(...data.items);
      offset += data.items.length;
      hasMore = data.has_missing_conversations !== false && data.items.length === PAGE_LIMIT;
    } else {
      hasMore = false;
    }

    if (hasMore) {
      await delay(REQUEST_DELAY);
    }
  }

  return conversations;
}

/**
 * 批量备份所有对话
 * @param {Function} onProgress - 进度回调 (current, total, title)
 * @returns {Promise<{success: number, skipped: number, failed: number}>}
 */
export async function startBatchBackup(onProgress) {
  const token = await getToken();
  if (!token) {
    throw new Error('No token available. Please open ChatGPT first.');
  }

  // 获取已备份 ID
  const existingIds = await getExistingBackupIds();
  console.log(`[Backup] Already backed up: ${existingIds.size} conversations`);

  // 获取对话列表
  onProgress?.(0, 0, 'Fetching conversation list...');
  const conversations = await fetchAllConversations(token);
  console.log(`[Backup] Total conversations: ${conversations.length}`);

  // 过滤掉已备份的
  const toBackup = conversations.filter(c => !existingIds.has(c.id));
  console.log(`[Backup] To backup: ${toBackup.length}, skipping: ${conversations.length - toBackup.length}`);

  const total = toBackup.length;
  let success = 0;
  let failed = 0;

  for (let i = 0; i < toBackup.length; i++) {
    const conv = toBackup[i];
    onProgress?.(i + 1, total, conv.title || 'Untitled');

    try {
      // 获取完整对话 JSON
      const fullData = await apiFetch(`${API_BASE}/conversation/${conv.id}`, token);

      // 发送到 background 存储
      await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.BACKUP_SINGLE,
        payload: fullData
      });

      success++;
    } catch (err) {
      console.error(`[Backup] Failed to backup ${conv.id}:`, err);
      failed++;
    }

    // 请求间隔
    if (i < toBackup.length - 1) {
      await delay(REQUEST_DELAY);
    }
  }

  const skipped = conversations.length - total;
  console.log(`[Backup] Done. Success: ${success}, Skipped: ${skipped}, Failed: ${failed}`);
  return { success, skipped, failed };
}
