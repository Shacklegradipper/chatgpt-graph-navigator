/**
 * Restore Bridge
 * 运行在 content script (isolated world)，桥接 main-world.js 和 background
 * 通过 postMessage 与 main-world 通信，通过 chrome.runtime.sendMessage 与 background 通信
 */

import { MESSAGE_TYPES, STORAGE_KEYS } from '../../shared/constants.js';

/**
 * 初始化 restore bridge，监听来自 main-world 的消息
 */
export function initRestoreBridge() {
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    const { type, payload } = event.data || {};

    if (type === 'CG_RESTORE_REQUEST') {
      await handleRestoreRequest(payload);
    } else if (type === 'CG_RESTORE_LIST_REQUEST') {
      await handleRestoreListRequest();
    }
  });

  console.log('[RestoreBridge] Initialized');
}

/**
 * 处理单个备份数据请求
 */
async function handleRestoreRequest(payload) {
  const { conversationId, requestId } = payload;
  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.RESTORE_GET,
      payload: { conversationId }
    });

    window.postMessage({
      type: 'CG_RESTORE_RESPONSE',
      payload: {
        requestId,
        data: response?.data ?? response?.payload ?? null
      }
    }, '*');
  } catch (err) {
    console.error('[RestoreBridge] Failed to get backup:', err);
    window.postMessage({
      type: 'CG_RESTORE_RESPONSE',
      payload: { requestId, data: null }
    }, '*');
  }
}

/**
 * 处理备份列表请求（返回所有备份元数据，用于侧边栏注入）
 */
async function handleRestoreListRequest() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_ALL_BACKUPS
    });

    window.postMessage({
      type: 'CG_RESTORE_LIST_RESPONSE',
      payload: response?.data || response?.payload || []
    }, '*');
  } catch (err) {
    console.error('[RestoreBridge] Failed to get backup list:', err);
    window.postMessage({
      type: 'CG_RESTORE_LIST_RESPONSE',
      payload: []
    }, '*');
  }
}

/**
 * 启用恢复模式：获取所有备份 ID 并通知 main-world
 */
export async function enableRestore() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.RESTORE_GET_IDS
    });

    const ids = response?.data || response?.payload || [];
    console.log(`[RestoreBridge] Enabling restore with ${ids.length} backed up conversations`);

    window.postMessage({
      type: 'CG_RESTORE_CONFIG',
      payload: {
        enabled: true,
        backedUpIds: ids
      }
    }, '*');

    // 持久化状态
    await chrome.storage.local.set({ [STORAGE_KEYS.RESTORE_MODE_ENABLED]: true });
  } catch (err) {
    console.error('[RestoreBridge] Failed to enable restore:', err);
  }
}

/**
 * 禁用恢复模式
 */
export async function disableRestore() {
  window.postMessage({
    type: 'CG_RESTORE_CONFIG',
    payload: {
      enabled: false,
      backedUpIds: []
    }
  }, '*');

  await chrome.storage.local.set({ [STORAGE_KEYS.RESTORE_MODE_ENABLED]: false });
  console.log('[RestoreBridge] Restore disabled');
}

/**
 * 根据存储状态自动启用/禁用恢复模式
 */
export async function autoConfigRestore() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.RESTORE_MODE_ENABLED);
    const enabled = result[STORAGE_KEYS.RESTORE_MODE_ENABLED] === true;

    if (enabled) {
      await enableRestore();
    }
  } catch (err) {
    console.error('[RestoreBridge] Failed to auto-config restore:', err);
  }
}
