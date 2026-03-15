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

  // 用于 postMessage 请求-响应匹配
  const pendingRequests = new Map();
  let requestIdCounter = 0;

  // UUID 正则
  const CONV_URL_RE = /\/backend-api\/conversation\/([0-9a-f-]{36})$/;
  const CONV_LIST_RE = /\/backend-api\/conversations(\?|$)/;

  // ==================== Restore 配置监听 ====================
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const { type, payload } = event.data || {};

    if (type === 'CG_RESTORE_CONFIG') {
      restoreEnabled = payload.enabled;
      backedUpIds = new Set(payload.backedUpIds || []);
      console.log(`[MainWorld] Restore ${restoreEnabled ? 'enabled' : 'disabled'}, ${backedUpIds.size} IDs`);
    } else if (type === 'CG_RESTORE_RESPONSE') {
      const { requestId, data } = payload;
      const pending = pendingRequests.get(requestId);
      if (pending) {
        pending.resolve(data);
        pendingRequests.delete(requestId);
      }
    } else if (type === 'CG_RESTORE_LIST_RESPONSE') {
      const pending = pendingRequests.get('list');
      if (pending) {
        pending.resolve(payload);
        pendingRequests.delete('list');
      }
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

  /**
   * 请求备份列表元数据
   */
  function requestBackupList() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete('list');
        resolve([]);
      }, 5000);

      pendingRequests.set('list', {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        }
      });

      window.postMessage({ type: 'CG_RESTORE_LIST_REQUEST' }, '*');
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

    // 检查是否是对话列表请求
    if (CONV_LIST_RE.test(url)) {
      return handleConversationListRestore(args);
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

  /**
   * 处理对话列表的恢复逻辑
   * 在真实响应中追加备份对话条目
   */
  async function handleConversationListRestore(fetchArgs) {
    const response = await originalFetch(...fetchArgs);

    try {
      const cloned = response.clone();
      const data = await cloned.json();

      // 获取备份列表
      const backupMetas = await requestBackupList();
      if (!backupMetas || backupMetas.length === 0) {
        return response;
      }

      // 获取真实列表中已有的 ID
      const existingIds = new Set((data.items || []).map(item => item.id));

      // 追加不在真实列表中的备份条目
      const toAppend = backupMetas
        .filter(meta => !existingIds.has(meta.conversation_id))
        .map(meta => ({
          id: meta.conversation_id,
          title: meta.title || 'Backed up conversation',
          create_time: meta.create_time ? new Date(meta.create_time * 1000).toISOString() : new Date().toISOString(),
          update_time: meta.update_time ? new Date(meta.update_time * 1000).toISOString() : new Date().toISOString(),
          mapping: null,
          current_node: null,
          conversation_template_id: null,
          gizmo_id: null,
          is_archived: false,
          workspace_id: null
        }));

      if (toAppend.length > 0) {
        data.items = [...(data.items || []), ...toAppend];
        data.total = (data.total || 0) + toAppend.length;
        console.log(`[MainWorld] Appended ${toAppend.length} backup entries to conversation list`);
      }

      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch (err) {
      console.warn('[MainWorld] Failed to inject backup list:', err);
      return response;
    }
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
