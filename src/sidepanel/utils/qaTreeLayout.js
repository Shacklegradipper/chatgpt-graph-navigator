/**
 * QA 树布局工具
 * 将 QA 树转换为 React Flow 的 nodes 和 edges
 */
import dagre from 'dagre';

/**
 * 节点尺寸配置
 */
const NODE_WIDTH = 240;
const NODE_HEIGHT = 100;

/**
 * 颜色配置
 */
const COLORS = {
  question: {
    bg: '#dbeafe',        // 蓝色背景
    border: '#3b82f6',    // 蓝色边框
    selectedBg: '#bfdbfe',
    selectedBorder: '#2563eb'
  },
  answer: {
    bg: '#dcfce7',        // 绿色背景
    border: '#22c55e',    // 绿色边框
    selectedBg: '#bbf7d0',
    selectedBorder: '#16a34a'
  },
  edge: {
    normal: '#94a3b8',
    selected: '#3b82f6'
  }
};

/**
 * 从 QA 树构建 React Flow 的 nodes 和 edges
 *
 * @param {Object} qaTree - QA 树对象
 * @param {Set<string>} selectedPath - 选中路径上的节点 ID
 * @returns {{ nodes: Array, edges: Array }}
 */
export function buildFlowFromQATree(qaTree, selectedPath = new Set()) {
  if (!qaTree || !qaTree.root || qaTree.root.questions.length === 0) {
    return { nodes: [], edges: [] };
  }

  const flowNodes = [];
  const flowEdges = [];
  let nodeIndex = 0;

  /**
   * 处理 QNode
   */
  function processQNode(qNode, parentFlowNodeId = null) {
    const isSelected = selectedPath.has(qNode.userId);
    const colors = isSelected ?
      { bg: COLORS.question.selectedBg, border: COLORS.question.selectedBorder } :
      { bg: COLORS.question.bg, border: COLORS.question.border };

    const flowNodeId = `q-${qNode.userId}`;

    flowNodes.push({
      id: flowNodeId,
      type: 'qaNode',
      data: {
        nodeType: 'question',
        nodeId: qNode.userId,
        content: qNode.content,
        preview: qNode.preview,
        createTime: qNode.createTime,
        isSelected,
        childCount: qNode.answers.length,
        colors,
        // 用于点击滚动
        messageId: qNode.userId
      },
      position: { x: 0, y: 0 }
    });

    // 创建从父节点到当前节点的边
    if (parentFlowNodeId) {
      const edgeSelected = isSelected && selectedPath.has(parentFlowNodeId.replace('a-', ''));
      flowEdges.push({
        id: `edge-${parentFlowNodeId}-${flowNodeId}`,
        source: parentFlowNodeId,
        target: flowNodeId,
        type: 'smoothstep',
        animated: false,
        style: {
          stroke: edgeSelected ? COLORS.edge.selected : COLORS.edge.normal,
          strokeWidth: edgeSelected ? 2.5 : 1.5
        }
      });
    }

    // 递归处理回答
    for (const aNode of qNode.answers) {
      processANode(aNode, flowNodeId);
    }
  }

  /**
   * 处理 ANode
   */
  function processANode(aNode, parentFlowNodeId) {
    const isSelected = selectedPath.has(aNode.assistantId);
    const colors = isSelected ?
      { bg: COLORS.answer.selectedBg, border: COLORS.answer.selectedBorder } :
      { bg: COLORS.answer.bg, border: COLORS.answer.border };

    const flowNodeId = `a-${aNode.assistantId}`;

    flowNodes.push({
      id: flowNodeId,
      type: 'qaNode',
      data: {
        nodeType: 'answer',
        nodeId: aNode.assistantId,
        content: aNode.content,
        preview: aNode.preview,
        createTime: aNode.createTime,
        isSelected,
        childCount: aNode.nextQuestions.length,
        colors,
        // 用于点击滚动
        messageId: aNode.assistantId
      },
      position: { x: 0, y: 0 }
    });

    // 创建从父节点到当前节点的边
    const parentSelected = selectedPath.has(parentFlowNodeId.replace('q-', ''));
    const edgeSelected = isSelected && parentSelected;
    flowEdges.push({
      id: `edge-${parentFlowNodeId}-${flowNodeId}`,
      source: parentFlowNodeId,
      target: flowNodeId,
      type: 'smoothstep',
      animated: false,
      style: {
        stroke: edgeSelected ? COLORS.edge.selected : COLORS.edge.normal,
        strokeWidth: edgeSelected ? 2.5 : 1.5
      }
    });

    // 递归处理后续问题
    for (const qNode of aNode.nextQuestions) {
      processQNode(qNode, flowNodeId);
    }
  }

  // 从根问题开始处理
  for (const qNode of qaTree.root.questions) {
    processQNode(qNode, null);
  }

  return { nodes: flowNodes, edges: flowEdges };
}

/**
 * 使用 dagre 计算布局
 *
 * @param {Array} nodes - React Flow 节点数组
 * @param {Array} edges - React Flow 边数组
 * @param {string} direction - 布局方向 ('TB' | 'LR')
 * @returns {{ nodes: Array, edges: Array }}
 */
export function applyDagreLayout(nodes, edges, direction = 'TB') {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const dagreGraph = new dagre.graphlib.Graph();

  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 40,    // 节点水平间距
    ranksep: 60,    // 层级垂直间距
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
 * 一步完成：从 QA 树构建并布局
 *
 * @param {Object} qaTree
 * @param {Set<string>} selectedPath
 * @param {string} direction
 * @returns {{ nodes: Array, edges: Array }}
 */
export function buildAndLayoutQATree(qaTree, selectedPath, direction = 'TB') {
  const { nodes, edges } = buildFlowFromQATree(qaTree, selectedPath);
  return applyDagreLayout(nodes, edges, direction);
}
