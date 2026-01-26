/**
 * ChatGPT API 调用模块
 */

import { API_ENDPOINTS } from '../../shared/constants.js';
import { log, retry } from '../../shared/utils.js';

/**
 * 获取对话完整数据
 * @param {string} conversationId - 对话 ID
 * @returns {Promise<Object>} 对话数据（包含 mapping）
 * @throws {Error} API 调用失败
 */
export async function fetchConversation(conversationId) {
  log('info', 'API', `Fetching conversation: ${conversationId}`);

  try {
    const response = await fetch(
      `${API_ENDPOINTS.CONVERSATION}/${conversationId}`,
      {
        method: 'GET',
        credentials: 'include', // 重要：携带认证 Cookie
        headers: {
          'accept': '*/*',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'oai-language': 'zh-CN',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin'
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      log('error', 'API', `HTTP ${response.status}:`, errorText);
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    log('info', 'API', 'Conversation loaded successfully', {
      id: data.id || conversationId,
      title: data.title,
      mappingSize: Object.keys(data.mapping || {}).length
    });

    return data;
  } catch (error) {
    log('error', 'API', 'Failed to fetch conversation:', error);
    throw error;
  }
}

/**
 * 带重试的获取对话数据
 * @param {string} conversationId - 对话 ID
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise<Object>}
 */
export async function fetchConversationWithRetry(conversationId, maxRetries = 3) {
  return retry(
    () => fetchConversation(conversationId),
    maxRetries,
    1000
  );
}

/**
 * 检查 API 是否可用
 * @returns {Promise<boolean>}
 */
export async function checkAPIAvailability() {
  try {
    const response = await fetch(API_ENDPOINTS.ME, {
      credentials: 'include'
    });
    return response.ok;
  } catch (error) {
    log('warn', 'API', 'API availability check failed:', error);
    return false;
  }
}
