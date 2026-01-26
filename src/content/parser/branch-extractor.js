/**
 * 分支提取模块
 */

import { log } from '../../shared/utils.js';
import { buildNodeMap, getPathToRoot } from './mapping-parser.js';

/**
 * 找出所有分支点
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {BranchPoint[]} 分支点数组
 */
export function findBranchPoints(nodes) {
  log('info', 'BranchExtractor', 'Finding branch points...');

  const branchPoints = [];

  for (const node of nodes) {
    // 分支点：有多个子节点
    if (node.children && node.children.length > 1) {
      branchPoints.push({
        nodeId: node.id,
        role: node.role,
        content: node.content.substring(0, 60) + '...',
        childrenCount: node.children.length,
        childrenIds: node.children
      });
    }
  }

  log('info', 'BranchExtractor', `Found ${branchPoints.length} branch points`);

  return branchPoints;
}

/**
 * 找出所有叶子节点
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {ParsedNode[]} 叶子节点数组
 */
export function findLeafNodes(nodes) {
  return nodes.filter(node => {
    return !node.children || node.children.length === 0;
  });
}

/**
 * 提取所有分支（每个叶子节点代表一条完整路径）
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {Branch[]} 分支数组
 */
export function extractBranches(nodes) {
  log('info', 'BranchExtractor', 'Extracting branches...');

  const nodeMap = buildNodeMap(nodes);
  const leafNodes = findLeafNodes(nodes);
  const branches = [];

  for (const leafNode of leafNodes) {
    const path = getPathToRoot(leafNode.id, nodeMap);

    branches.push({
      id: leafNode.id,
      path: path,
      messageCount: path.length,
      depth: path.length
    });
  }

  log('info', 'BranchExtractor', `Extracted ${branches.length} branches`);

  return branches;
}

/**
 * 构建轮次（Round）数组
 * 一个 Round = 用户消息 + AI 回复
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {Round[]} 轮次数组
 */
export function buildRounds(nodes) {
  log('info', 'BranchExtractor', 'Building rounds...');

  const rounds = [];
  const nodeMap = buildNodeMap(nodes);

  // 找到所有用户消息
  const userNodes = nodes.filter(node => node.role === 'user');

  for (const userNode of userNodes) {
    // 找到对应的 assistant 回复
    const assistantNode = userNode.children
      .map(childId => nodeMap.get(childId))
      .filter(child => child && child.role === 'assistant')[0];

    // 找到父 Round
    const parentRoundId = findParentRound(userNode, nodeMap, rounds);

    const round = {
      id: `round_${userNode.id}`,
      conversationId: userNode.conversationId,
      userMessageId: userNode.id,
      assistantMessageId: assistantNode ? assistantNode.id : null,
      parentRoundId: parentRoundId,
      createTime: userNode.createTime
    };

    rounds.push(round);
  }

  log('info', 'BranchExtractor', `Built ${rounds.length} rounds`);

  return rounds;
}

/**
 * 查找父 Round
 * @param {ParsedNode} userNode - 用户节点
 * @param {Map<string, ParsedNode>} nodeMap - 节点映射
 * @param {Round[]} rounds - 已有的 rounds
 * @returns {string|null} 父 Round ID
 */
function findParentRound(userNode, nodeMap, rounds) {
  if (!userNode.parent) {
    return null;
  }

  // 父节点可能是 assistant 或 user
  const parentNode = nodeMap.get(userNode.parent);
  if (!parentNode) {
    return null;
  }

  if (parentNode.role === 'assistant') {
    // 如果父节点是 assistant，找包含它的 round
    const parentRound = rounds.find(r => r.assistantMessageId === parentNode.id);
    return parentRound ? parentRound.id : null;
  } else if (parentNode.role === 'user') {
    // 如果父节点是 user，找对应的 round
    const parentRound = rounds.find(r => r.userMessageId === parentNode.id);
    return parentRound ? parentRound.id : null;
  }

  return null;
}

/**
 * 分析分支结构
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {Object} 分支结构分析结果
 */
export function analyzeBranchStructure(nodes) {
  const branchPoints = findBranchPoints(nodes);
  const branches = extractBranches(nodes);
  const leafNodes = findLeafNodes(nodes);

  return {
    totalNodes: nodes.length,
    branchPointsCount: branchPoints.length,
    branchesCount: branches.length,
    leafNodesCount: leafNodes.length,
    branchPoints,
    branches,
    leafNodes
  };
}

/**
 * 获取节点的兄弟节点
 * @param {string} nodeId - 节点 ID
 * @param {ParsedNode[]} nodes - 节点数组
 * @returns {ParsedNode[]} 兄弟节点数组
 */
export function getSiblings(nodeId, nodes) {
  const nodeMap = buildNodeMap(nodes);
  const node = nodeMap.get(nodeId);

  if (!node || !node.parent) {
    return [];
  }

  const parent = nodeMap.get(node.parent);
  if (!parent) {
    return [];
  }

  return parent.children
    .filter(childId => childId !== nodeId)
    .map(childId => nodeMap.get(childId))
    .filter(child => child !== undefined);
}
