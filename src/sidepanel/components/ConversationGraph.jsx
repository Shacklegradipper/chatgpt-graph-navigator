/**
 * 对话图谱组件
 * 使用 React Flow 实现可视化
 */
import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider
} from '@xyflow/react';
// 注意：不要在这里 import CSS！
// React Flow 的 CSS 在 src/sidepanel/styles/index.css 中通过 @import 引入
// 否则 esbuild 会生成同名的 dist/sidepanel.css 覆盖我们的布局样式

import RoundNode from './RoundNode';
import { buildGraphData, getLayoutedElements } from '../utils/layoutUtils';

// 自定义节点类型
const nodeTypes = {
  round: RoundNode
};

// 边的默认样式
const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false,
  style: {
    strokeWidth: 2
  }
};

/**
 * 图谱内部组件（需要 ReactFlow context）
 */
function GraphContent({
  data,
  currentNodeId,
  onNodeClick,
  onNodeDoubleClick,
  onNodeContextMenu,
  containerHeight
}) {
  const { fitView, setCenter } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // 当容器高度变化时，重新适应视图
  useEffect(() => {
    if (containerHeight > 0 && nodes.length > 0) {
      setTimeout(() => {
        fitView({ padding: 0.2, duration: 300 });
      }, 100);
    }
  }, [containerHeight, fitView, nodes.length]);

  // 当数据变化时，更新图谱
  useEffect(() => {
    if (!data || !data.rounds) return;

    // 注意：不要用 rounds.length 做“是否变化”的判断。
    // 1) 分支结构变化时 rounds 数量可能不变，但 parentRoundId 会变
    // 2) 消息内容更新时 rounds 数量可能不变
    // 3) refresh 时需要强制重新 layout

    console.log('[Graph] Building graph data...', data.rounds.length, 'rounds');
    console.log('[Graph] Sample round data:', data.rounds[0]);

    // 构建图数据
    const graphData = buildGraphData(data.rounds);
    console.log('[Graph] Built nodes:', graphData.nodes.length, 'Sample node:', graphData.nodes[0]);

    // 应用布局
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      graphData.nodes,
      graphData.edges,
      'TB' // Top to Bottom (垂直布局)
    );

    setNodes(layoutedNodes);
    setEdges(layoutedEdges);

    // 适应视图
    setTimeout(() => {
      fitView({ padding: 0.2, duration: 300 });
    }, 100);

  }, [data, setNodes, setEdges, fitView]);

  // 当前节点变化时，定位到该节点
  useEffect(() => {
    if (!currentNodeId || nodes.length === 0) return;

    const targetNode = nodes.find(n => n.id === currentNodeId);
    if (targetNode) {
      setCenter(targetNode.position.x + 100, targetNode.position.y + 30, {
        zoom: 1,
        duration: 500
      });
    }
  }, [currentNodeId, nodes, setCenter]);

  // 处理节点点击
  const handleNodeClick = useCallback((event, node) => {
    onNodeClick?.(node.id, node.data);
  }, [onNodeClick]);

  // 处理节点双击
  const handleNodeDoubleClick = useCallback((event, node) => {
    onNodeDoubleClick?.(node.id, node.data);
  }, [onNodeDoubleClick]);

  // 处理节点右键
  const handleNodeContextMenu = useCallback((event, node) => {
    onNodeContextMenu?.(event, node.id, node.data);
  }, [onNodeContextMenu]);

  // MiniMap 节点颜色
  const nodeColor = useCallback((node) => {
    if (node.id === currentNodeId) return '#10b981'; // 当前节点
    return node.data?.color || '#c3caff';
  }, [currentNodeId]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      onNodeDoubleClick={handleNodeDoubleClick}
      onNodeContextMenu={handleNodeContextMenu}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={2}
      attributionPosition="bottom-left"
      proOptions={{ hideAttribution: true }}
      style={{ width: '100%', height: '100%' }}
    >
      <Controls
        showZoom={true}
        showFitView={true}
        showInteractive={false}
        position="bottom-right"
      />
      <MiniMap
        nodeColor={nodeColor}
        nodeStrokeWidth={3}
        zoomable
        pannable
        position="top-right"
      />
      <Background variant="dots" gap={20} size={1} color="#e5e7eb" />
    </ReactFlow>
  );
}

/**
 * 对话图谱组件（带 Provider）
 */
function ConversationGraph(props) {
  const containerRef = useRef(null);
  const [containerHeight, setContainerHeight] = useState(400); // 默认高度

  // 动态计算容器高度
  useEffect(() => {
    const updateHeight = () => {
      // 获取窗口高度，减去 header (56px)
      const height = window.innerHeight - 56;
      console.log('[Graph] Window innerHeight:', window.innerHeight, 'Calculated height:', height);
      setContainerHeight(Math.max(height, 200)); // 最小 200px
    };

    // 初始计算
    updateHeight();

    // 监听窗口大小变化
    window.addEventListener('resize', updateHeight);

    return () => {
      window.removeEventListener('resize', updateHeight);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="graph-container"
      style={{
        width: '100%',
        height: `${containerHeight}px`,
        minHeight: '200px'
      }}
    >
      <ReactFlowProvider>
        <GraphContent {...props} containerHeight={containerHeight} />
      </ReactFlowProvider>
    </div>
  );
}

export default ConversationGraph;
