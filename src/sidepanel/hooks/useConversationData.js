/**
 * 对话数据 Hook
 * 从 Background 获取对话数据并监听更新
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { MESSAGE_TYPES } from '../../shared/constants';

/**
 * 带重试的消息发送
 * @param {Object} message - 消息对象
 * @param {number} retries - 重试次数
 * @param {number} delay - 每次重试的延迟（毫秒）
 * @returns {Promise<any>}
 */
async function sendMessageWithRetry(message, retries = 3, delay = 500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // 检查 extension context 是否有效
      if (!chrome.runtime?.id) {
        throw new Error('Extension context invalidated');
      }

      const response = await chrome.runtime.sendMessage(message);

      // 检查是否有错误
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }

      return response;

    } catch (error) {
      const isLastAttempt = attempt === retries;
      const isConnectionError = error.message?.includes('Receiving end does not exist');

      console.warn(`[SidePanel] Message send attempt ${attempt}/${retries} failed:`, error.message);

      if (!isLastAttempt && isConnectionError) {
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
        continue;
      } else {
        // 最后一次尝试失败或其他类型的错误
        throw error;
      }
    }
  }
}

/**
 * 对话数据 Hook
 */
export function useConversationData() {
  const [conversationData, setConversationData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentNodeId, setCurrentNodeId] = useState(null);
  const listenerSetRef = useRef(false);

  // 从 Background 获取数据
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 带重试的消息发送
      const response = await sendMessageWithRetry({
        type: MESSAGE_TYPES.GET_ALL_CONVERSATIONS
      }, 3, 500);

      if (response?.success && response.data?.length > 0) {
        // 获取最新的对话
        const latestConversation = response.data[0];
        console.log('[Hook] Loaded conversation:', latestConversation.id);

        // 转换为图谱需要的格式
        const graphData = transformToGraphData(latestConversation);
        setConversationData(graphData);
      } else {
        console.log('[Hook] No conversation data available');
        setConversationData(null);
      }
    } catch (err) {
      console.error('[Hook] Failed to fetch data:', err);
      setError(err.message || 'Failed to load conversation data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 刷新数据
  const refreshData = useCallback(() => {
    console.log('[Hook] Refreshing data...');
    fetchData();
  }, [fetchData]);

  // 监听来自 Background 的更新消息
  useEffect(() => {
    if (listenerSetRef.current) return;
    listenerSetRef.current = true;

    const handleMessage = (message, sender, sendResponse) => {
      console.log('[Hook] Received message:', message.type);

      if (message.type === MESSAGE_TYPES.DATA_READY) {
        console.log('[Hook] Data ready notification received');
        fetchData();
      }

      if (message.type === MESSAGE_TYPES.UPDATE_NOTIFICATION) {
        console.log('[Hook] Update notification received:', message.payload);

        // 增量更新
        if (message.payload?.type === 'new_message') {
          setConversationData(prev => {
            if (!prev) return prev;

            // 更新 rounds（如果有新数据）
            if (message.payload.stats) {
              return {
                ...prev,
                stats: message.payload.stats
              };
            }

            return prev;
          });

          // 重新获取完整数据以确保一致性
          fetchData();
        }
      }

      return true;
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      listenerSetRef.current = false;
    };
  }, [fetchData]);

  // 初始加载
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    conversationData,
    isLoading,
    error,
    refreshData,
    currentNodeId,
    setCurrentNodeId
  };
}

/**
 * 转换对话数据为图谱格式
 * @param {Object} conversation - 原始对话数据
 * @returns {Object} 图谱数据
 */
function transformToGraphData(conversation) {
  if (!conversation) return null;

  // 直接使用原始 rounds 数据，不做转换
  // buildGraphData 会处理多种数据格式
  let rounds = [];

  if (conversation.rounds && conversation.rounds.length > 0) {
    // 直接传递原始 rounds，保留所有字段
    rounds = conversation.rounds;
    console.log('[Transform] Using raw rounds, sample:', JSON.stringify(rounds[0], null, 2));
  } else if (conversation.nodes && conversation.nodes.length > 0) {
    // 从 nodes 构建 rounds
    rounds = buildRoundsFromNodes(conversation.nodes);
    console.log('[Transform] Built rounds from nodes, sample:', JSON.stringify(rounds[0], null, 2));
  }

  return {
    id: conversation.id,
    title: conversation.title || 'Untitled Conversation',
    rounds: rounds,
    stats: {
      totalRounds: rounds.length,
      totalNodes: conversation.nodes?.length || rounds.length * 2
    }
  };
}

/**
 * 从 nodes 构建 rounds
 * @param {Array} nodes - 节点数组
 * @returns {Array} rounds 数组
 */
function buildRoundsFromNodes(nodes) {
  const rounds = [];
  let currentRound = null;
  let roundNumber = 0;

  // 按顺序处理节点
  nodes.forEach((node, index) => {
    if (node.role === 'user') {
      // 开始新的 round
      roundNumber++;
      currentRound = {
        roundNumber,
        depth: node.depth || 0,
        userContent: extractContent(node),
        assistantContent: '',
        lastMessageId: node.id,
        messages: [{ ...node, role: 'user' }]
      };
    } else if (node.role === 'assistant' && currentRound) {
      // 添加 assistant 消息到当前 round
      currentRound.assistantContent = extractContent(node);
      currentRound.lastMessageId = node.id;
      currentRound.messages.push({ ...node, role: 'assistant' });

      // 保存 round
      rounds.push(currentRound);
      currentRound = null;
    }
  });

  // 如果最后有未完成的 round（只有 user 没有 assistant）
  if (currentRound) {
    rounds.push(currentRound);
  }

  return rounds;
}

/**
 * 提取消息内容
 * @param {Object} message - 消息对象
 * @returns {string}
 */
function extractContent(message) {
  if (!message) return '';

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (message.content?.parts) {
    return message.content.parts.join('\n');
  }

  if (message.message?.content?.parts) {
    return message.message.content.parts.join('\n');
  }

  return '';
}
