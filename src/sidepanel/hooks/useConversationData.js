/**
 * 对话数据 Hook
 *
 * 目标：
 * 1) 始终展示「当前活动 Tab」所在的 ChatGPT 对话，而不是 DB 里的任意一条。
 * 2) 支持分支：优先用 nodes 重新构建 rounds（避免旧数据缺少内容/缺少 parentRoundId）。
 * 3) 支持更新：
 *    - 收到 background 的 DATA_READY / UPDATE_NOTIFICATION 后自动刷新
 *    - 用户切换 Tab 或 URL 变化时自动刷新
 *    - 点击刷新按钮会触发 content script 主动重新抓取 API（再回读 DB）
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { MESSAGE_TYPES } from '../../shared/constants';
import { buildRounds as buildRoundsFromParsedNodes } from '../../content/parser/branch-extractor.js';

// 与 shared/utils.js 中 extractConversationId 保持一致
const CONVERSATION_ID_REGEX = /\/c\/([a-f0-9-]+)/;

/**
 * 带重试的消息发送
 */
async function sendMessageWithRetry(message, retries = 3, delay = 500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (!chrome.runtime?.id) {
        throw new Error('Extension context invalidated');
      }

      const response = await chrome.runtime.sendMessage(message);

      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }

      return response;
    } catch (error) {
      const isLastAttempt = attempt === retries;
      const isConnectionError = error.message?.includes('Receiving end does not exist');

      console.warn(`[SidePanel] Message send attempt ${attempt}/${retries} failed:`, error.message);

      if (!isLastAttempt && isConnectionError) {
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
        continue;
      }

      throw error;
    }
  }
}

/**
 * Promise 化 tabs.query（兼容 callback 形式）
 */
function queryActiveTab() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs || []));
    } catch {
      resolve([]);
    }
  });
}

/**
 * Promise 化 tabs.sendMessage（兼容 callback 形式）
 */
function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (resp) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(resp);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * 从当前活动 Tab URL 提取 conversationId
 */
async function getActiveConversationIdFromTab() {
  const tabs = await queryActiveTab();
  const url = tabs?.[0]?.url || '';
  const match = url.match(CONVERSATION_ID_REGEX);
  return match ? match[1] : null;
}

/**
 * 转换对话数据为 sidepanel 图谱格式
 *
 * background.GET_CONVERSATION 返回：{ conversation, nodes, rounds }
 */
function transformToGraphData(payload) {
  if (!payload) return null;

  const conversation = payload.conversation || payload;
  const nodes = payload.nodes || conversation.nodes || [];
  const roundsFromDB = payload.rounds || conversation.rounds || [];

  // ✅ 强制用 nodes 重建 rounds：
  // - 修复旧 rounds 缺少 userMessage/assistantMessage 导致节点空白
  // - 修复 parentRoundId/branch 连接问题
  // - 增量更新时 nodes 一定是最新的
  let rounds = [];
  if (nodes && nodes.length > 0) {
    try {
      rounds = buildRoundsFromParsedNodes(nodes);
    } catch (e) {
      console.warn('[Transform] Failed to build rounds from nodes, fallback to DB rounds:', e?.message);
      rounds = roundsFromDB;
    }
  } else {
    rounds = roundsFromDB;
  }

  return {
    id: conversation.id,
    title: conversation.title || 'Untitled Conversation',
    rounds,
    // 用于调试/未来扩展（Graph 现在不依赖这个字段，但保留有用）
    updatedAt: conversation.lastIncrementalUpdate || conversation.updateTime || Date.now(),
    stats: {
      totalRounds: rounds.length,
      totalNodes: nodes.length || conversation.nodeCount || rounds.length * 2
    }
  };
}

export function useConversationData() {
  const [conversationData, setConversationData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentNodeId, setCurrentNodeId] = useState(null);
  const [activeConversationId, setActiveConversationId] = useState(null);

  const runtimeListenerSetRef = useRef(false);

  /**
   * 从 background 拉取指定 conversationId 的数据
   */
  const fetchConversation = useCallback(async (conversationId) => {
    if (!conversationId) {
      setConversationData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await sendMessageWithRetry({
        type: MESSAGE_TYPES.GET_CONVERSATION,
        payload: { conversationId }
      }, 3, 500);

      if (response?.success) {
        const graphData = transformToGraphData(response.data);
        setConversationData(graphData);
        setActiveConversationId(conversationId);
      } else {
        setConversationData(null);
      }
    } catch (err) {
      console.error('[Hook] Failed to fetch conversation:', err);
      setError(err.message || 'Failed to load conversation data');
      setConversationData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * 根据当前活动 Tab 选择要展示的 conversation
   */
  const syncWithActiveTab = useCallback(async () => {
    const convId = await getActiveConversationIdFromTab();

    if (!convId) {
      // 不是对话页：清空
      setActiveConversationId(null);
      setConversationData(null);
      setIsLoading(false);
      return;
    }

    if (convId !== activeConversationId) {
      console.log('[Hook] Active tab conversation changed:', activeConversationId, '→', convId);
      await fetchConversation(convId);
    }
  }, [activeConversationId, fetchConversation]);

  /**
   * 刷新数据：
   * 1) 先请求 content script 重新抓取/解析（更新 DB）
   * 2) 再从 background 回读 DB
   */
  const refreshData = useCallback(async () => {
    console.log('[Hook] Manual refresh requested');

    const tabs = await queryActiveTab();
    const tab = tabs?.[0];

    const convId = await getActiveConversationIdFromTab();
    if (convId) {
      setActiveConversationId(convId);
    }

    // 触发 content script 重新抓取（失败也不要阻塞回读 DB）
    if (tab?.id) {
      try {
        await sendMessageToTab(tab.id, {
          type: MESSAGE_TYPES.REFRESH_DATA,
          payload: { conversationId: convId }
        });
        console.log('[Hook] ✓ Content refresh triggered');
      } catch (e) {
        console.warn('[Hook] Content refresh failed (maybe content script not ready):', e?.message);
      }
    }

    // 回读 DB（如果 content 刷新成功，会在 DB 里变成最新）
    await fetchConversation(convId);
  }, [fetchConversation]);

  /**
   * runtime 消息监听：background -> sidepanel
   */
  useEffect(() => {
    if (runtimeListenerSetRef.current) return;
    runtimeListenerSetRef.current = true;

    const handleMessage = (message) => {
      if (!message?.type) return;

      if (message.type === MESSAGE_TYPES.DATA_READY) {
        const convId = message.payload?.conversationId;
        console.log('[Hook] DATA_READY received for:', convId);

        if (convId) {
          // 优先更新为通知里的对话（通常是当前 tab 切换后的对话）
          fetchConversation(convId);
        } else {
          syncWithActiveTab();
        }
      }

      if (message.type === MESSAGE_TYPES.UPDATE_NOTIFICATION) {
        const convId = message.payload?.conversationId;
        console.log('[Hook] UPDATE_NOTIFICATION received for:', convId);

        // 仅当更新的是当前对话时才刷新；否则交给 tab 同步逻辑
        if (convId && convId === activeConversationId) {
          fetchConversation(convId);
        }
      }

      return true;
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      runtimeListenerSetRef.current = false;
    };
  }, [activeConversationId, fetchConversation, syncWithActiveTab]);

  /**
   * 监听 tab 切换/URL 更新（sidepanel 需要跟随用户当前看的对话）
   */
  useEffect(() => {
    // 初始同步
    syncWithActiveTab();

    const onActivated = () => {
      syncWithActiveTab();
    };

    const onUpdated = (tabId, changeInfo, tab) => {
      if (tab?.active && changeInfo?.url) {
        syncWithActiveTab();
      }
    };

    try {
      chrome.tabs.onActivated.addListener(onActivated);
      chrome.tabs.onUpdated.addListener(onUpdated);
    } catch (e) {
      console.warn('[Hook] tabs listeners not available in this context:', e?.message);
    }

    return () => {
      try {
        chrome.tabs.onActivated.removeListener(onActivated);
        chrome.tabs.onUpdated.removeListener(onUpdated);
      } catch {
        // ignore
      }
    };
  }, [syncWithActiveTab]);

  // 兜底：ChatGPT 是 SPA，有时 tabs.onUpdated 不会触发 changeInfo.url
  // 用轻量轮询保证 sidepanel 总能跟上当前对话。
  useEffect(() => {
    const timer = setInterval(() => {
      syncWithActiveTab();
    }, 1500);

    return () => clearInterval(timer);
  }, [syncWithActiveTab]);

  return {
    conversationData,
    isLoading,
    error,
    refreshData,
    currentNodeId,
    setCurrentNodeId,
    activeConversationId
  };
}
