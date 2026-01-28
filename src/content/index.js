/**
 * Content Script 入口
 * 负责：
 * 1. 加载用户配置的 token
 * 2. 调用 API 获取对话数据
 * 3. 解析 mapping 树
 * 4. 提取分支结构
 * 5. 发送数据到 Service Worker
 * 6. 监听 URL 变化（对话切换）
 * 7. 监听 DOM 变化（新消息）
 * 8. 增量更新 graph tree
 */

import { MESSAGE_TYPES, CONFIG } from '../shared/constants.js';
import { log, extractConversationId, delay } from '../shared/utils.js';
import { loadToken, hasToken } from './auth/token-manager.js';
import { fetchConversationWithRetry } from './api/conversation.js';
import { parseMapping, getNodeStatistics } from './parser/mapping-parser.js';
import { extractBranches, buildRounds, analyzeBranchStructure } from './parser/branch-extractor.js';
import { isConversationPage, waitForElement } from './utils/dom-helper.js';
import { createURLObserver } from './observers/url-observer.js';
import { createMessageObserver } from './observers/message-observer.js';
import { conversationState } from './state/conversation-state.js';

// 全局观察器实例
let urlObserver = null;
let messageObserver = null;

/**
 * 设置来自 sidepanel 的消息监听
 */
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log('debug', 'Content', 'Received message:', message.type);

    if (message.type === MESSAGE_TYPES.SCROLL_TO_MESSAGE) {
      const { messageId } = message.payload || {};
      if (messageId) {
        scrollToMessage(messageId);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'No messageId provided' });
      }
      return true;
    }

    // Sidepanel 手动刷新：触发重新抓取 API + 重新解析 mapping
    if (message.type === MESSAGE_TYPES.REFRESH_DATA) {
      (async () => {
        try {
          // 优先使用 payload 里的 conversationId（sidepanel 从 tab.url 提取）
          const conversationId = message.payload?.conversationId || extractConversationId();
          if (!conversationId) {
            sendResponse({ success: false, error: 'No conversationId' });
            return;
          }

          log('info', 'Content', `Manual refresh requested for conversation: ${conversationId}`);

          // token 可能尚未加载（sidepanel 很快点刷新时）
          const tokenLoaded = await loadToken();
          if (!tokenLoaded || !hasToken()) {
            sendResponse({ success: false, error: 'No valid token configured' });
            return;
          }

          await fetchAndProcessConversation(conversationId);
          sendResponse({ success: true });
        } catch (err) {
          log('error', 'Content', 'Manual refresh failed:', err);
          sendResponse({ success: false, error: err.message || 'Refresh failed' });
        }
      })();

      return true;
    }

    return false;
  });

  log('info', 'Content', 'Message listener set up for sidepanel commands');
}

/**
 * 滚动到指定消息
 * @param {string} messageId - 消息 ID (data-message-id)
 */
function scrollToMessage(messageId) {
  log('info', 'Content', `Scrolling to message: ${messageId.substring(0, 16)}...`);

  // 尝试多种方式查找消息元素
  let targetElement = null;

  // 1. 通过 data-message-id 属性查找
  targetElement = document.querySelector(`[data-message-id="${messageId}"]`);

  // 2. 通过 data-turn-id 属性查找（ChatGPT 新版本可能使用这个）
  if (!targetElement) {
    targetElement = document.querySelector(`[data-turn-id="${messageId}"]`);
  }

  // 3. 如果是 round 的 lastMessageId，尝试查找对应的 article
  if (!targetElement) {
    const articles = document.querySelectorAll('article[data-turn-id]');
    for (const article of articles) {
      const turnId = article.getAttribute('data-turn-id');
      if (turnId === messageId) {
        targetElement = article;
        break;
      }
    }
  }

  if (targetElement) {
    // 高亮效果
    highlightElement(targetElement);

    // 滚动到元素
    targetElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });

    log('info', 'Content', '✓ Scrolled to message');
  } else {
    log('warn', 'Content', `Message element not found: ${messageId}`);

    // 尝试模糊匹配（消息 ID 的前缀匹配）
    const allArticles = document.querySelectorAll('article[data-turn-id]');
    for (const article of allArticles) {
      const turnId = article.getAttribute('data-turn-id');
      if (turnId && (turnId.startsWith(messageId) || messageId.startsWith(turnId))) {
        highlightElement(article);
        article.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
        log('info', 'Content', '✓ Scrolled to message (fuzzy match)');
        return;
      }
    }
  }
}

/**
 * 高亮元素（短暂闪烁效果）
 * @param {HTMLElement} element - 要高亮的元素
 */
function highlightElement(element) {
  // 保存原始样式
  const originalOutline = element.style.outline;
  const originalTransition = element.style.transition;

  // 添加高亮样式
  element.style.transition = 'outline 0.3s ease';
  element.style.outline = '3px solid #3b82f6';

  // 短暂延迟后移除高亮
  setTimeout(() => {
    element.style.outline = '3px solid transparent';

    setTimeout(() => {
      element.style.outline = originalOutline;
      element.style.transition = originalTransition;
    }, 300);
  }, 1000);
}

/**
 * 主函数
 */
async function main() {
  log('info', 'Content', 'Content script loaded');

  // 检查扩展上下文是否有效
  if (!chrome.runtime?.id) {
    showExtensionReloadWarning();
    return;
  }

  // 设置消息监听器（在最早期就设置，以便接收来自 sidepanel 的消息）
  setupMessageListener();

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

  // 加载用户配置的 token
  const tokenLoaded = await loadToken();

  if (!tokenLoaded || !hasToken()) {
    log('error', 'Content', 'No valid token found');
    showTokenSetupPrompt();
    return;
  }

  log('info', 'Content', 'Token loaded successfully');

  // 延迟执行，避免阻塞页面
  await delay(CONFIG.API_DELAY);

  // 获取并处理当前对话数据
  await fetchAndProcessConversation(conversationId);

  // 启动 URL 观察器，监听对话切换
  startURLObserver();

  // 启动消息观察器，监听新消息
  startMessageObserver();
}

/**
 * 启动 URL 观察器
 * 监听用户切换对话，自动重新加载数据
 */
function startURLObserver() {
  log('info', 'Content', 'Starting URL observer for conversation switching');

  // 停止旧的观察器（如果存在）
  if (urlObserver) {
    urlObserver.stop();
  }

  urlObserver = createURLObserver(async (newConversationId, oldConversationId) => {
    log('info', 'Content', `Conversation switched: ${oldConversationId} → ${newConversationId}`);

    // 清空旧的状态
    conversationState.clear();

    // 重置消息观察器
    if (messageObserver) {
      messageObserver.reset();
    }

    // 等待页面更新完成
    await delay(CONFIG.API_DELAY);

    // 重新获取并处理新对话数据
    await fetchAndProcessConversation(newConversationId);
  });

  log('info', 'Content', 'URL observer started');
}

/**
 * 启动消息观察器
 * 监听新消息，进行增量更新
 */
function startMessageObserver() {
  log('info', 'Content', 'Starting message observer for incremental updates');

  // 停止旧的观察器（如果存在）
  if (messageObserver) {
    messageObserver.stop();
  }

  messageObserver = createMessageObserver(async (messageData) => {
    log('info', 'Content', `New message detected`, {
      id: messageData.id.substring(0, 8) + '...',
      role: messageData.role
    });

    // 处理增量消息
    await handleIncrementalMessage(messageData);
  });

  log('info', 'Content', 'Message observer started');
}

/**
 * 处理增量消息
 * @param {Object} messageData - 从 DOM 提取的消息数据
 */
async function handleIncrementalMessage(messageData) {
  try {
    // 检查状态是否已初始化
    if (!conversationState.isReady()) {
      log('warn', 'Content', 'State not initialized, skipping incremental update');
      return;
    }

    // 添加增量节点到状态
    const added = conversationState.addIncrementalNode(messageData);

    if (!added) {
      log('debug', 'Content', 'Node already exists or failed to add');
      return;
    }

    // 获取增量更新数据
    const incrementalUpdate = conversationState.getIncrementalUpdate(messageData.id);

    log('info', 'Content', 'Incremental update prepared', {
      nodeId: messageData.id.substring(0, 8) + '...',
      totalNodes: conversationState.getStats().totalNodes
    });

    // 发送增量更新到 background（失败不影响后续流程）
    try {
      await sendToBackground(MESSAGE_TYPES.CONVERSATION_INCREMENTAL_UPDATE, incrementalUpdate);
      log('info', 'Content', '✓ Incremental update sent to background');
    } catch (bgError) {
      log('error', 'Content', 'Failed to send incremental update:', bgError.message);
    }

    // 输出调试信息
    logIncrementalUpdate(messageData, conversationState.getStats());

  } catch (error) {
    log('error', 'Content', 'Failed to handle incremental message:', error);
  }
}

/**
 * 显示扩展重新加载警告
 */
function showExtensionReloadWarning() {
  console.group('🌲 ChatGPT Graph - Extension Reloaded');
  console.warn('⚠️ Extension context invalidated');
  console.log('');
  console.log('The extension was reloaded while this page was open.');
  console.log('Please refresh this page to restore functionality.');
  console.log('');
  console.groupEnd();
}

/**
 * 显示 Token 设置提示
 */
function showTokenSetupPrompt() {
  console.group('🌲 ChatGPT Graph - Setup Required');
  console.error('❌ Authentication token not configured');
  console.log('');
  console.log('To use this extension:');
  console.log('1. Click the extension icon in your toolbar');
  console.log('2. Click "Setup Token" button');
  console.log('3. Follow the instructions to get your token');
  console.log('4. Refresh this page');
  console.log('');
  console.log('Your token is stored securely on your device.');
  console.groupEnd();
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

    // 5. 初始化状态管理器（用于增量更新）
    conversationState.initialize(conversationData);
    log('info', 'Content', '✓ Conversation state initialized');

    // 6. 发送到 Service Worker（失败不影响调试输出）
    try {
      await sendToBackground(MESSAGE_TYPES.CONVERSATION_LOADED, conversationData);
      log('info', 'Content', '✓ Conversation data sent to background');
    } catch (bgError) {
      log('error', 'Content', 'Failed to send to background (extension may be reloading):', bgError.message);
      // 继续执行，至少输出调试信息
    }

    // 7. 输出调试信息到控制台（即使 background 失败也要显示）
    logDebugInfo(conversationData);

  } catch (error) {
    log('error', 'Content', 'Failed to process conversation:', error);

    // 尝试发送错误消息（但不阻塞）
    try {
      await sendToBackground(MESSAGE_TYPES.ERROR, {
        message: error.message,
        stack: error.stack
      });
    } catch (bgError) {
      log('warn', 'Content', 'Could not send error to background:', bgError.message);
    }
  }
}

/**
 * 发送消息到 Service Worker
 * @param {string} type - 消息类型
 * @param {Object} payload - 消息负载
 * @param {number} retries - 重试次数
 * @returns {Promise<Object>}
 */
async function sendToBackground(type, payload, retries = 3) {
  // 检查 extension context 是否有效
  if (!chrome.runtime?.id) {
    log('error', 'Content', 'Extension context invalidated (extension may have been reloaded)');
    throw new Error('Extension context invalidated. Please refresh the page.');
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await new Promise((resolve, reject) => {
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

      log('debug', 'Content', `Message sent successfully on attempt ${attempt}`);
      return response;

    } catch (error) {
      const isLastAttempt = attempt === retries;
      const isConnectionError = error.message?.includes('Receiving end does not exist');

      if (isConnectionError) {
        log('warn', 'Content', `Background connection failed (attempt ${attempt}/${retries})`);

        if (!isLastAttempt) {
          // 等待后重试（给 background script 初始化的时间）
          await delay(500 * attempt);
          continue;
        } else {
          log('error', 'Content', 'Background script not responding. Extension may need to be reloaded.');
          throw new Error('Background script not responding. Please reload the extension or refresh the page.');
        }
      } else {
        // 其他错误，直接抛出
        throw error;
      }
    }
  }
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

/**
 * 输出增量更新调试信息
 * @param {Object} messageData - 新消息数据
 * @param {Object} stats - 对话统计信息
 */
function logIncrementalUpdate(messageData, stats) {
  console.group('🆕 ChatGPT Graph - Incremental Update');

  console.log('📨 New Message:', {
    'ID': messageData.id.substring(0, 16) + '...',
    'Role': messageData.role,
    'Content Length': messageData.content.length,
    'Parent': messageData.parent?.substring(0, 16) + '...' || '(none)'
  });

  console.log('📊 Updated Statistics:', {
    'Total Nodes': stats.totalNodes,
    'Total Rounds': stats.totalRounds,
    'Total Branches': stats.totalBranches,
    'Branch Points': stats.branchPoints,
    'Incremental Nodes': stats.incrementalNodes
  });

  console.log('⚡ Update Method: DOM extraction (no API call)');

  console.groupEnd();
}

// 启动
main().catch(error => {
  log('error', 'Content', 'Fatal error:', error);
});
