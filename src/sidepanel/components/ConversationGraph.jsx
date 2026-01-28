/**
 * 对话图谱组件
 * 使用 React Flow + QA 树实现可视化
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

import QANode from './QANode';
import { buildAndLayoutQATree } from '../utils/qaTreeLayout';

// 自定义节点类型
const nodeTypes = {
  qaNode: QANode
};

// 边的默认样式
const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false,
  style: {
    strokeWidth: 1.5
  }
};

/**
 * 图谱内部组件（需要 ReactFlow context）
 */
function GraphContent({
  qaTree,
  selectedPath,
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

  // 当 QA 树或选中路径变化时，更新图谱
  useEffect(() => {
    if (!qaTree || !qaTree.root || qaTree.root.questions.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    console.log('[Graph] Building from QA tree...',
      'Q:', qaTree.qNodeMap?.size || 0,
      'A:', qaTree.aNodeMap?.size || 0
    );

    // 从 QA 树构建并布局
    const { nodes: layoutedNodes, edges: layoutedEdges } = buildAndLayoutQATree(
      qaTree,
      selectedPath,
      'TB'
    );

    console.log('[Graph] Layout complete:',
      layoutedNodes.length, 'nodes,',
      layoutedEdges.length, 'edges'
    );

    setNodes(layoutedNodes);
    setEdges(layoutedEdges);

    // 适应视图
    setTimeout(() => {
      fitView({ padding: 0.2, duration: 300 });
    }, 100);

  }, [qaTree, selectedPath, setNodes, setEdges, fitView]);

  // 当前节点变化时，定位到该节点
  useEffect(() => {
    if (!currentNodeId || nodes.length === 0) return;

    // 尝试找到对应的节点（可能是 q-xxx 或 a-xxx 格式）
    let targetNode = nodes.find(n =>
      n.id === currentNodeId ||
      n.id === `q-${currentNodeId}` ||
      n.id === `a-${currentNodeId}` ||
      n.data?.nodeId === currentNodeId
    );

    if (targetNode) {
      setCenter(targetNode.position.x + 120, targetNode.position.y + 50, {
        zoom: 1,
        duration: 500
      });
    }
  }, [currentNodeId, nodes, setCenter]);

  // 处理节点点击
  const handleNodeClick = useCallback((event, node) => {
    onNodeClick?.(node.data.nodeId, node.data);
  }, [onNodeClick]);

  // 处理节点双击
  const handleNodeDoubleClick = useCallback((event, node) => {
    onNodeDoubleClick?.(node.data.nodeId, node.data);
  }, [onNodeDoubleClick]);

  // 处理节点右键
  const handleNodeContextMenu = useCallback((event, node) => {
    onNodeContextMenu?.(event, node.data.nodeId, node.data);
  }, [onNodeContextMenu]);

  // MiniMap 节点颜色
  const nodeColor = useCallback((node) => {
    if (node.data?.isSelected) {
      return node.data?.nodeType === 'question' ? '#3b82f6' : '#22c55e';
    }
    return node.data?.nodeType === 'question' ? '#93c5fd' : '#86efac';
  }, []);

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
function ConversationGraph({
  qaTree,
  selectedPath,
  currentNodeId,
  onNodeClick,
  onNodeDoubleClick,
  onNodeContextMenu
}) {
  const containerRef = useRef(null);
  const [containerHeight, setContainerHeight] = useState(400);

  // 动态计算容器高度
  useEffect(() => {
    const updateHeight = () => {
      const height = window.innerHeight - 56;
      setContainerHeight(Math.max(height, 200));
    };

    updateHeight();
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
        <GraphContent
          qaTree={qaTree}
          selectedPath={selectedPath}
          currentNodeId={currentNodeId}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeContextMenu={onNodeContextMenu}
          containerHeight={containerHeight}
        />
      </ReactFlowProvider>
    </div>
  );
}

export default ConversationGraph;
