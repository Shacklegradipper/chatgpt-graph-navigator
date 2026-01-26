/**
 * Content Script 入口
 * 负责：
 * 1. 调用 API 获取对话数据
 * 2. 解析 mapping 树
 * 3. 提取分支结构
 * 4. 发送数据到 Service Worker
 */

import { MESSAGE_TYPES, CONFIG } from '../shared/constants.js';
import { log, extractConversationId, delay } from '../shared/utils.js';
import { fetchConversationWithRetry } from './api/conversation.js';
import { parseMapping, getNodeStatistics } from './parser/mapping-parser.js';
import { extractBranches, buildRounds, analyzeBranchStructure } from './parser/branch-extractor.js';
import { isConversationPage, waitForElement } from './utils/dom-helper.js';

/**
 * 主函数
 */
async function main() {
  log('info', 'Content', 'Content script loaded');

  // 检查是否在对话页面
  if (!isConversationPage()) {
    log('warn', 'Content', 'Not a conversation page, skipping');
    return;
  }

  // 提取对话 ID
  const conversationId = extractConversationId();
  if (!conversationId) {
    log('error', 'Content', 'Failed to extract conversation ID');
    return;
  }

  log('info', 'Content', `Conversation ID: ${conversationId}`);

  // 等待页面加载完成
  await waitForPageReady();

  // 延迟执行，避免阻塞页面
  await delay(CONFIG.API_DELAY);

  // 获取并处理对话数据
  await fetchAndProcessConversation(conversationId);
}

/**
 * 等待页面准备就绪
 */
async function waitForPageReady() {
  log('info', 'Content', 'Waiting for page ready...');

  // 等待 main 元素出现
  const mainElement = await waitForElement('main', 10000);
  if (!mainElement) {
    throw new Error('Page load timeout');
  }

  log('info', 'Content', 'Page ready');
}

/**
 * 获取并处理对话数据
 * @param {string} conversationId - 对话 ID
 */
async function fetchAndProcessConversation(conversationId) {
  try {
    log('info', 'Content', 'Fetching conversation data...');

    // 1. 调用 API
    const data = await fetchConversationWithRetry(conversationId);

    if (!data || !data.mapping) {
      throw new Error('Invalid conversation data');
    }

    log('info', 'Content', 'Conversation data received', {
      title: data.title,
      mappingSize: Object.keys(data.mapping).length
    });

    // 2. 解析 mapping
    const nodes = parseMapping(data.mapping, conversationId);
    const stats = getNodeStatistics(nodes);

    log('info', 'Content', 'Nodes parsed', stats);

    // 3. 提取分支
    const branches = extractBranches(nodes);
    const rounds = buildRounds(nodes);
    const analysis = analyzeBranchStructure(nodes);

    log('info', 'Content', 'Branch analysis complete', {
      branches: branches.length,
      rounds: rounds.length,
      branchPoints: analysis.branchPointsCount
    });

    // 4. 构建完整数据
    const conversationData = {
      id: conversationId,
      title: data.title,
      createTime: data.create_time,
      updateTime: data.update_time,
      mapping: data.mapping,
      nodes,
      rounds,
      branches,
      analysis
    };

    // 5. 发送到 Service Worker
    await sendToBackground(MESSAGE_TYPES.CONVERSATION_LOADED, conversationData);

    log('info', 'Content', '✓ Conversation data sent to background');

    // 6. 输出调试信息到控制台
    logDebugInfo(conversationData);

  } catch (error) {
    log('error', 'Content', 'Failed to process conversation:', error);

    // 发送错误消息
    await sendToBackground(MESSAGE_TYPES.ERROR, {
      message: error.message,
      stack: error.stack
    });
  }
}

/**
 * 发送消息到 Service Worker
 * @param {string} type - 消息类型
 * @param {Object} payload - 消息负载
 * @returns {Promise<Object>}
 */
async function sendToBackground(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type,
        payload,
        timestamp: Date.now()
      },
      response => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else if (response && response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      }
    );
  });
}

/**
 * 输出调试信息
 * @param {Object} conversationData - 对话数据
 */
function logDebugInfo(conversationData) {
  console.group('🌲 ChatGPT Graph - Conversation Data');

  console.log('📊 Statistics:', {
    'Total Nodes': conversationData.nodes.length,
    'User Messages': conversationData.nodes.filter(n => n.role === 'user').length,
    'Assistant Replies': conversationData.nodes.filter(n => n.role === 'assistant').length,
    'Rounds': conversationData.rounds.length,
    'Branches': conversationData.branches.length,
    'Branch Points': conversationData.analysis.branchPointsCount
  });

  if (conversationData.analysis.branchPoints.length > 0) {
    console.log('🌿 Branch Points:');
    conversationData.analysis.branchPoints.forEach((bp, index) => {
      console.log(`  ${index + 1}. [${bp.role}] "${bp.content}" → ${bp.childrenCount} children`);
    });
  }

  if (conversationData.branches.length > 0) {
    console.log(`📝 Branches (${conversationData.branches.length} total):`);
    conversationData.branches.slice(0, 3).forEach((branch, index) => {
      console.log(`  Branch ${index + 1}: ${branch.messageCount} messages, depth ${branch.depth}`);
    });
    if (conversationData.branches.length > 3) {
      console.log(`  ... and ${conversationData.branches.length - 3} more`);
    }
  }

  console.log('💾 Full Data:', conversationData);

  console.groupEnd();
}

// 启动
main().catch(error => {
  log('error', 'Content', 'Fatal error:', error);
});
