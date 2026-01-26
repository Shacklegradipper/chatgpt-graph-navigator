/**
 * Mapping 树解析模块
 */

import { NODE_ROLES } from '../../shared/constants.js';
import { log } from '../../shared/utils.js';

/**
 * 解析 mapping 为节点数组
 * @param {Object} mapping - 原始 mapping 对象
 * @param {string} conversationId - 对话 ID
 * @returns {ParsedNode[]} 解析后的节点数组
 */
export function parseMapping(mapping, conversationId) {
  log('info', 'Parser', 'Parsing mapping...');

  const nodes = [];

  for (const nodeId in mapping) {
    const node = mapping[nodeId];

    // 跳过没有消息或系统消息的节点
    if (!node.message || node.message.author.role === NODE_ROLES.SYSTEM) {
      continue;
    }

    const parsedNode = {
      id: nodeId,
      conversationId,
      role: node.message.author.role,
      content: node.message.content.parts?.join('') || '',
      createTime: node.message.create_time || Date.now() / 1000,
      parent: node.parent || null,
      children: node.children || [],
      metadata: {
        status: node.message.status,
        weight: node.message.weight,
        endTurn: node.message.end_turn,
        ...node.message.metadata
      }
    };

    nodes.push(parsedNode);
  }

  log('info', 'Parser', `Parsed ${nodes.length} nodes`);

  return nodes;
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
