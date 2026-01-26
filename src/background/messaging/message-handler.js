/**
 * 消息处理模块
 */

import { MESSAGE_TYPES } from '../../shared/constants.js';
import { db } from '../database/db.js';

/**
 * 设置消息监听器
 */
export function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Received message:', message.type);

    handleMessage(message, sender)
      .then(result => {
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        console.error('[Background] Message handler error:', error);
        sendResponse({ success: false, error: error.message });
      });

    // 返回 true 保持消息通道打开（用于异步响应）
    return true;
  });

  console.log('[Background] Message listener setup complete');
}

/**
 * 处理消息
 * @param {Object} message - 消息对象
 * @param {Object} sender - 发送者信息
 * @returns {Promise<any>}
 */
async function handleMessage(message, sender) {
  const { type, payload } = message;

  switch (type) {
    case MESSAGE_TYPES.CONVERSATION_LOADED:
      return await handleConversationLoaded(payload);

    case MESSAGE_TYPES.GET_CONVERSATION:
      return await handleGetConversation(payload);

    case MESSAGE_TYPES.GET_ALL_CONVERSATIONS:
      return await handleGetAllConversations();

    case MESSAGE_TYPES.ERROR:
      return await handleError(payload, sender);

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

/**
 * 处理对话加载完成
 * @param {Object} conversationData - 对话数据
 * @returns {Promise<Object>}
 */
async function handleConversationLoaded(conversationData) {
  console.log('[Background] Handling CONVERSATION_LOADED:', conversationData.id);

  try {
    // 保存到数据库
    await db.saveFullConversation(conversationData);

    // 通知 Side Panel（如果打开）
    await notifySidePanel(MESSAGE_TYPES.DATA_READY, {
      conversationId: conversationData.id,
      stats: {
        nodes: conversationData.nodes.length,
        rounds: conversationData.rounds.length,
        branches: conversationData.branches.length
      }
    });

    return {
      message: 'Conversation saved successfully',
      conversationId: conversationData.id
    };
  } catch (error) {
    console.error('[Background] Failed to save conversation:', error);
    throw error;
  }
}

/**
 * 处理获取对话请求
 * @param {Object} payload - 请求数据
 * @returns {Promise<Object>}
 */
async function handleGetConversation(payload) {
  const { conversationId } = payload;

  console.log('[Background] Getting conversation:', conversationId);

  const conversation = await db.getConversation(conversationId);

  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  // 获取相关数据
  const nodes = await db.getNodes(conversationId);

  return {
    conversation,
    nodes
  };
}

/**
 * 处理获取所有对话请求
 * @returns {Promise<Array>}
 */
async function handleGetAllConversations() {
  console.log('[Background] Getting all conversations');

  const conversations = await db.getAllConversations();

  return conversations;
}

/**
 * 处理错误消息
 * @param {Object} errorData - 错误数据
 * @param {Object} sender - 发送者信息
 * @returns {Promise<Object>}
 */
async function handleError(errorData, sender) {
  console.error('[Background] Error from content script:', errorData);

  // TODO: 可以在这里添加错误上报逻辑

  return { acknowledged: true };
}

/**
 * 通知 Side Panel
 * @param {string} type - 消息类型
 * @param {Object} payload - 消息负载
 * @returns {Promise<void>}
 */
async function notifySidePanel(type, payload) {
  try {
    await chrome.runtime.sendMessage({
      type,
      payload,
      timestamp: Date.now()
    });
  } catch (error) {
    // Side Panel 可能未打开，忽略错误
    console.warn('[Background] Failed to notify side panel:', error.message);
  }
}
