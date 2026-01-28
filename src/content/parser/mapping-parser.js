/**
 * Mapping 树解析模块
 */

import { NODE_ROLES } from '../../shared/constants.js';
import { log } from '../../shared/utils.js';

/**
 * 解析 mapping 为节点数组和边数组
 * @param {Object} mapping - 原始 mapping 对象
 * @param {string} conversationId - 对话 ID
 * @returns {{ nodes: ParsedNode[], edges: ParsedEdge[] }} 解析后的节点和边数组
 */
export function parseMapping(mapping, conversationId) {
  log('info', 'Parser', 'Parsing mapping...');

  // ChatGPT conversation API 的 message.content 结构可能随时间演进：
  // - { content_type: 'text', parts: ['hello'] }
  // - { content_type: 'text', text: '...' }
  // - { content_type: 'multimodal_text', parts: ['text', {asset_pointer: ...}] }
  // - { content_type: 'code', text: '...' }
  // parts 里可能混入非 string 对象（图片指针、搜索结果等），需要跳过。
  const normalizeText = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value
        .map(normalizeText)
        .filter(s => s.length > 0)
        .join('');
    }
    if (typeof value === 'object') {
      // 有 parts 数组（标准 content 结构）
      if (Array.isArray(value.parts)) {
        return value.parts
          .map(normalizeText)
          .filter(s => s.length > 0)
          .join('');
      }
      // 有 text 字段（code / execution_output 等）
      if (typeof value.text === 'string') return value.text;
      // 其他对象（图片指针、搜索结果对象等）→ 跳过，不要用 String() 转
      return '';
    }
    return '';
  };

  // 需要排除的 content_type：这些是工具调用的中间产物，不是真正的对话内容
  const TOOL_CONTENT_TYPES = new Set([
    'code',
    'execution_output',
    'tether_browsing_display',
    'tether_quote',
    'system_error',
    'model_editable_context',
  ]);

  // 判断消息是否为有效的对话消息（排除工具调用的中间产物）
  const isConversationMessage = (message) => {
    if (!message) return false;
    const role = message.author?.role;
    if (role !== NODE_ROLES.USER && role !== NODE_ROLES.ASSISTANT) return false;

    // assistant 消息需要进一步检查 content_type
    if (role === NODE_ROLES.ASSISTANT) {
      const contentType = message.content?.content_type;
      if (contentType && TOOL_CONTENT_TYPES.has(contentType)) {
        return false;
      }
    }
    return true;
  };

  // 判断节点是否为有效节点（user 或 assistant）
  const isValidRole = (role) => {
    return role === NODE_ROLES.USER || role === NODE_ROLES.ASSISTANT;
  };

  // 获取节点角色（如果节点存在且有消息）
  const getNodeRole = (nodeId) => {
    const node = mapping[nodeId];
    return node?.message?.author?.role || null;
  };

  // 判断 mapping 中的节点是否为有效的对话节点
  const isValidConversationNode = (nodeId) => {
    const node = mapping[nodeId];
    return node?.message && isConversationMessage(node.message);
  };

  // 向上追溯找到最近的有效祖先（跳过 tool/system/工具调用中间节点）
  const findValidAncestor = (nodeId) => {
    let current = mapping[nodeId]?.parent;
    const visited = new Set();

    while (current && !visited.has(current)) {
      visited.add(current);
      if (isValidConversationNode(current)) {
        return current;
      }
      current = mapping[current]?.parent;
    }
    return null;
  };

  // 向下递归找到所有有效的后代（跳过中间节点，收集直接可达的有效子节点）
  const findValidDescendants = (nodeId) => {
    const result = [];
    const queue = [...(mapping[nodeId]?.children || [])];
    const visited = new Set();

    while (queue.length > 0) {
      const childId = queue.shift();
      if (visited.has(childId)) continue;
      visited.add(childId);

      if (isValidConversationNode(childId)) {
        result.push(childId);
      } else {
        // 中间节点（tool/system/工具调用），继续向下搜索
        const grandChildren = mapping[childId]?.children || [];
        queue.push(...grandChildren);
      }
    }
    return result;
  };

  const nodes = [];

  // 第一遍：创建所有有效的对话节点
  for (const nodeId in mapping) {
    const node = mapping[nodeId];

    // 跳过非对话消息（没有消息、system、tool、工具调用中间产物）
    if (!node.message || !isConversationMessage(node.message)) {
      continue;
    }

    const role = node.message.author.role;

    // 计算有效的父节点和子节点
    const validParent = findValidAncestor(nodeId);
    const validChildren = findValidDescendants(nodeId);

    const parsedNode = {
      id: nodeId,
      conversationId,
      role: role,
      content: normalizeText(node.message.content) || '',
      createTime: node.message.create_time || Date.now() / 1000,
      // 使用有效的父子关系（跳过 tool/system 节点）
      parent: validParent,
      children: validChildren,
      // 保留原始父子关系用于调试
      _rawParent: node.parent || null,
      _rawChildren: node.children || [],
      metadata: {
        status: node.message.status,
        weight: node.message.weight,
        endTurn: node.message.end_turn,
        ...node.message.metadata
      }
    };

    nodes.push(parsedNode);
  }

  // 构建有效节点集合
  const validNodeIds = new Set(nodes.map(n => n.id));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // 第二遍：创建 edges（基于有效的父子关系）
  const edges = [];

  for (const node of nodes) {
    for (const childId of node.children) {
      // 验证子节点确实是有效节点
      if (!validNodeIds.has(childId)) continue;

      const childNode = nodeMap.get(childId);
      if (!childNode) continue;

      edges.push({
        // 可重复计算的主键
        id: `${conversationId}:${node.id}->${childId}`,
        conversationId,
        source: node.id,
        target: childId,
        sourceRole: node.role,
        targetRole: childNode.role,
        // 用于排序，优先用 target.createTime
        orderKey: childNode.createTime || node.createTime || Date.now() / 1000
      });
    }
  }

  log('info', 'Parser', `Parsed ${nodes.length} nodes, ${edges.length} edges`);

  return { nodes, edges };
}

/**
 * 构建节点映射（ID -> Node）
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {Map<string, ParsedNode>}
 */
export function buildNodeMap(nodes) {
  const nodeMap = new Map();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  return nodeMap;
}

/**
 * 查找根节点
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {ParsedNode|null}
 */
export function findRootNode(nodes) {
  // 根节点通常是第一个用户消息
  return nodes.find(node => node.role === NODE_ROLES.USER && !node.parent) || null;
}

/**
 * 获取节点的所有祖先
 * @param {string} nodeId - 节点 ID
 * @param {Map<string, ParsedNode>} nodeMap - 节点映射
 * @returns {ParsedNode[]} 祖先节点数组（从根到父）
 */
export function getAncestors(nodeId, nodeMap) {
  const ancestors = [];
  let currentId = nodeId;

  while (currentId && nodeMap.has(currentId)) {
    const node = nodeMap.get(currentId);
    if (node.parent) {
      const parentNode = nodeMap.get(node.parent);
      if (parentNode) {
        ancestors.unshift(parentNode);
      }
    }
    currentId = node.parent;
  }

  return ancestors;
}

/**
 * 获取节点的所有后代
 * @param {string} nodeId - 节点 ID
 * @param {Map<string, ParsedNode>} nodeMap - 节点映射
 * @returns {ParsedNode[]} 后代节点数组
 */
export function getDescendants(nodeId, nodeMap) {
  const descendants = [];
  const queue = [nodeId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const node = nodeMap.get(currentId);

    if (!node) continue;

    for (const childId of node.children) {
      const childNode = nodeMap.get(childId);
      if (childNode) {
        descendants.push(childNode);
        queue.push(childId);
      }
    }
  }

  return descendants;
}

/**
 * 获取从根到指定节点的路径
 * @param {string} nodeId - 节点 ID
 * @param {Map<string, ParsedNode>} nodeMap - 节点映射
 * @returns {ParsedNode[]} 路径节点数组（从根到目标）
 */
export function getPathToRoot(nodeId, nodeMap) {
  const path = [];
  let currentId = nodeId;

  while (currentId && nodeMap.has(currentId)) {
    const node = nodeMap.get(currentId);
    path.unshift(node);
    currentId = node.parent;
  }

  return path;
}

/**
 * 统计节点信息
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {Object} 统计信息
 */
export function getNodeStatistics(nodes) {
  const stats = {
    total: nodes.length,
    user: 0,
    assistant: 0,
    maxDepth: 0,
    branchPoints: 0
  };

  for (const node of nodes) {
    if (node.role === NODE_ROLES.USER) {
      stats.user++;
    } else if (node.role === NODE_ROLES.ASSISTANT) {
      stats.assistant++;
    }

    if (node.children.length > 1) {
      stats.branchPoints++;
    }
  }

  return stats;
}
