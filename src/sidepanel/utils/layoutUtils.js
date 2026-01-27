/**
 * 布局工具函数
 * 使用 dagre 进行自动布局
 */
import dagre from 'dagre';

/**
 * 节点尺寸配置
 */
const NODE_WIDTH = 220;
const NODE_HEIGHT = 100;

/**
 * 节点颜色配置（与 RoundNode 保持一致）
 */
const LEVEL_COLORS = [
  '#c3caff',  // Level 0 - 浅紫蓝
  '#bae6fd',  // Level 1 - 浅蓝
  '#a2dcd0',  // Level 2 - 浅青
  '#9decbb'   // Level 3 - 浅绿
];

/**
 * 从 rounds 数据构建图数据
 * @param {Array} rounds - 轮次数组
 * @returns {{ nodes: Array, edges: Array }}
 */
export function buildGraphData(rounds) {
  if (!rounds || rounds.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes = [];
  const edges = [];
  const nodeMap = new Map();

  // 第一遍：创建所有节点
  rounds.forEach((round, index) => {
    const nodeId = `round-${round.roundNumber || index + 1}`;

    // 提取 User 和 Assistant 消息内容
    // 支持多种数据结构：
    // 1. round.userMessage / round.assistantMessage (来自 branch-extractor)
    // 2. round.messages 数组
    // 3. round.userContent / round.assistantContent (直接字段)
    let userContent = '';
    let assistantContent = '';
    let lastMessageId = '';

    if (round.userMessage) {
      // 结构1: userMessage 对象
      userContent = round.userMessage.content || '';
      lastMessageId = round.userMessage.id;
    } else if (round.messages) {
      // 结构2: messages 数组
      const userMsg = round.messages.find(m => m.role === 'user');
      userContent = userMsg?.content || '';
      lastMessageId = userMsg?.id || '';
    } else {
      // 结构3: 直接字段
      userContent = round.userContent || '';
    }

    if (round.assistantMessage) {
      assistantContent = round.assistantMessage.content || '';
      lastMessageId = round.assistantMessage.id || lastMessageId;
    } else if (round.messages) {
      const assistantMsg = round.messages.find(m => m.role === 'assistant');
      assistantContent = assistantMsg?.content || '';
      lastMessageId = assistantMsg?.id || lastMessageId;
    } else {
      assistantContent = round.assistantContent || '';
    }

    // 兜底：使用 round 自身的 ID
    if (!lastMessageId) {
      lastMessageId = round.lastMessageId || round.assistantMessageId || round.userMessageId || round.id;
    }

    // 计算层级（基于深度或索引）
    const level = round.depth !== undefined ? round.depth : Math.min(index, 3);

    const nodeData = {
      id: nodeId,
      type: 'round',
      data: {
        roundNumber: round.roundNumber || index + 1,
        userContent: userContent,
        assistantContent: assistantContent,
        lastMessageId: lastMessageId,
        level: level,
        color: LEVEL_COLORS[level % LEVEL_COLORS.length],
        hasChildren: false,
        branchCount: 1,
        raw: round
      },
      position: { x: 0, y: 0 } // 将由 dagre 计算
    };

    nodes.push(nodeData);
    nodeMap.set(round.roundNumber || index + 1, nodeData);
  });

  // 第二遍：创建边（基于 parentRoundId 或相邻关系）
  for (let i = 0; i < rounds.length; i++) {
    const currRound = rounds[i];
    const currRoundNum = currRound.roundNumber || i + 1;
    const targetId = `round-${currRoundNum}`;

    // 优先使用 parentRoundId 建立连接
    if (currRound.parentRoundId) {
      // 从 parentRoundId 提取 roundNumber (格式: round_xxx 或直接数字)
      const parentIdMatch = String(currRound.parentRoundId).match(/round[-_]?(\d+)/i);
      const parentRoundNum = parentIdMatch ? parseInt(parentIdMatch[1]) : null;

      if (parentRoundNum && nodeMap.has(parentRoundNum)) {
        const sourceId = `round-${parentRoundNum}`;
        const sourceNode = nodeMap.get(parentRoundNum);
        const edgeColor = sourceNode?.data?.color || LEVEL_COLORS[0];

        edges.push({
          id: `edge-${sourceId}-${targetId}`,
          source: sourceId,
          target: targetId,
          type: 'smoothstep',
          animated: false,
          style: {
            stroke: edgeColor,
            strokeWidth: 2
          }
        });

        if (sourceNode) {
          sourceNode.data.hasChildren = true;
        }
        continue;
      }
    }

    // 没有 parentRoundId 时，连接到前一个节点
    if (i > 0) {
      const prevRound = rounds[i - 1];
      const prevRoundNum = prevRound.roundNumber || i;
      const sourceId = `round-${prevRoundNum}`;

      const sourceNode = nodeMap.get(prevRoundNum);
      const edgeColor = sourceNode?.data?.color || LEVEL_COLORS[0];

      edges.push({
        id: `edge-${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        type: 'smoothstep',
        animated: false,
        style: {
          stroke: edgeColor,
          strokeWidth: 2
        }
      });

      if (sourceNode) {
        sourceNode.data.hasChildren = true;
      }
    }
  }

  // 处理分支（如果存在）
  // 查找有多个子节点的节点
  const childCount = new Map();
  edges.forEach(edge => {
    const count = childCount.get(edge.source) || 0;
    childCount.set(edge.source, count + 1);
  });

  childCount.forEach((count, nodeId) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node && count > 1) {
      node.data.branchCount = count;
    }
  });

  return { nodes, edges };
}

/**
 * 使用 dagre 计算布局
 * @param {Array} nodes - 节点数组
 * @param {Array} edges - 边数组
 * @param {string} direction - 布局方向 ('TB' | 'LR')
 * @returns {{ nodes: Array, edges: Array }}
 */
export function getLayoutedElements(nodes, edges, direction = 'TB') {
  const dagreGraph = new dagre.graphlib.Graph();

  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 50,    // 节点水平间距
    ranksep: 80,    // 层级垂直间距
    marginx: 20,
    marginy: 20
  });

  // 添加节点到 dagre
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT
    });
  });

  // 添加边到 dagre
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // 计算布局
  dagre.layout(dagreGraph);

  // 更新节点位置
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2
      }
    };
  });

  return { nodes: layoutedNodes, edges };
}

/**
 * 查找节点的所有子孙节点
 * @param {string} nodeId - 节点 ID
 * @param {Array} edges - 边数组
 * @returns {Set<string>}
 */
export function findDescendants(nodeId, edges) {
  const descendants = new Set();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift();

    edges.forEach(edge => {
      if (edge.source === current && !descendants.has(edge.target)) {
        descendants.add(edge.target);
        queue.push(edge.target);
      }
    });
  }

  return descendants;
}

/**
 * 查找节点的所有祖先节点
 * @param {string} nodeId - 节点 ID
 * @param {Array} edges - 边数组
 * @returns {Set<string>}
 */
export function findAncestors(nodeId, edges) {
  const ancestors = new Set();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift();

    edges.forEach(edge => {
      if (edge.target === current && !ancestors.has(edge.source)) {
        ancestors.add(edge.source);
        queue.push(edge.source);
      }
    });
  }

  return ancestors;
}
