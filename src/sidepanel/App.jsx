/**
 * Side Panel 主应用
 */
import React, { useEffect, useCallback, useState } from 'react';
import ConversationGraph from './components/ConversationGraph';
import GitTreeView from './components/GitTreeView';
import Header from './components/Header';
import { useConversationData } from './hooks/useConversationData';
import { useQATree, useBranchChangeListener } from './hooks/useQATree';
import { MESSAGE_TYPES } from '../shared/constants.js';

const IS_EMBEDDED = (() => {
  try {
    return new URLSearchParams(window.location.search).get('embedded') === '1';
  } catch {
    return false;
  }
})();

function App() {
  const [viewMode, setViewMode] = useState('graph');
  const {
    conversationData,
    isLoading,
    error,
    refreshData,
    currentNodeId,
    setCurrentNodeId
  } = useConversationData();

  // Embedded mode: allow the parent (floating panel) to control view mode / refresh.
  useEffect(() => {
    if (!IS_EMBEDDED) return;

    const handler = (event) => {
      const data = event?.data;
      if (!data || typeof data !== 'object') return;
      const { type, payload } = data;
      if (type === 'CG_SET_VIEW_MODE' && payload?.mode) {
        setViewMode(String(payload.mode));
      } else if (type === 'CG_REFRESH') {
        refreshData();
      } else if (type === 'CG_REQUEST_VIEW_MODE') {
        try {
          event.source?.postMessage({ type: 'CG_VIEW_MODE', payload: { mode: viewMode } }, '*');
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('message', handler);
    // Tell parent we are ready.
    try {
      window.parent?.postMessage({ type: 'CG_READY' }, '*');
      window.parent?.postMessage({ type: 'CG_VIEW_MODE', payload: { mode: viewMode } }, '*');
    } catch {
      // ignore
    }

    return () => window.removeEventListener('message', handler);
  }, [viewMode, refreshData]);

  // Notify parent when view mode changes
  useEffect(() => {
    if (!IS_EMBEDDED) return;
    try {
      window.parent?.postMessage({ type: 'CG_VIEW_MODE', payload: { mode: viewMode } }, '*');
    } catch {
      // ignore
    }
  }, [viewMode]);

  // Persist view mode
  useEffect(() => {
    (async () => {
      try {
        const res = await chrome.storage.local.get(['sidepanelViewMode']);
        if (res.sidepanelViewMode) setViewMode(res.sidepanelViewMode);
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    try {
      chrome.storage.local.set({ sidepanelViewMode: viewMode });
    } catch {
      // ignore
    }
  }, [viewMode]);

  // 构建 QA 树
  const {
    tree,
    selectedPath,
    activeLeafId,
    selectNode,
    isNodeSelected,
    stats: treeStats,
    printTree,
    isReady: isTreeReady
  } = useQATree(
    conversationData?.nodes || null,
    conversationData?.edges || null,
    { debug: true }
  );

  // 监听外部分支切换（从 ChatGPT 页面同步）
  useBranchChangeListener(useCallback((nodeId) => {
    console.log('[App] External branch change:', nodeId);
    selectNode(nodeId);
  }, [selectNode]));

  // 暴露到 window 方便调试
  useEffect(() => {
    window.__qaTree = tree;
    window.__printTree = printTree;
    window.__treeStats = treeStats;
    window.__conversationData = conversationData;
  }, [tree, printTree, treeStats, conversationData]);

  // 节点点击处理
  const handleNodeClick = useCallback((nodeId, nodeData) => {
    console.log('[SidePanel] Node clicked:', nodeId, nodeData);
    setCurrentNodeId(nodeId);

    // 更新 QA 树选中路径
    selectNode(nodeId);

    // 通过 background script 转发消息到 content script 进行定位
    const messageId = nodeData?.messageId || nodeId;
    console.log('[SidePanel] Sending SCROLL_TO_MESSAGE for:', messageId);

    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SCROLL_TO_MESSAGE,
      payload: { messageId }
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[SidePanel] sendMessage error:', chrome.runtime.lastError);
      } else {
        console.log('[SidePanel] sendMessage response:', response);
      }
    });
  }, [setCurrentNodeId, selectNode]);

  // 节点双击处理
  const handleNodeDoubleClick = useCallback((nodeId, nodeData) => {
    console.log('[SidePanel] Node double-clicked:', nodeId, nodeData);
    // 可以打开详细信息面板
  }, []);

  // 节点右键处理
  const handleNodeContextMenu = useCallback((event, nodeId, nodeData) => {
    event.preventDefault();
    console.log('[SidePanel] Node context menu:', nodeId, nodeData);
    // 可以显示上下文菜单
  }, []);

  // 渲染空状态
  const renderEmptyState = () => (
    <div className="empty-state">
      <div className="empty-icon">🌲</div>
      <h2>No Conversation Loaded</h2>
      <p>Open a ChatGPT conversation to see its graph structure</p>
    </div>
  );

  // 渲染错误状态
  const renderError = () => (
    <div className="error-message">
      <p>{error}</p>
      <button onClick={refreshData}>Retry</button>
    </div>
  );

  // 渲染内容（两种模式切换）
  const renderContent = () => {
    if (!isTreeReady) {
      return (
        <div className="empty-state">
          <div className="empty-icon">⏳</div>
          <h2>Building Tree...</h2>
          <p>Please wait while the conversation tree is being constructed</p>
        </div>
      );
    }

    if (viewMode === 'tree') {
      return (
        <GitTreeView
          qaTree={tree}
          selectedPath={selectedPath}
          currentNodeId={currentNodeId}
          onNodeClick={handleNodeClick}
        />
      );
    }

    return (
      <ConversationGraph
        qaTree={tree}
        selectedPath={selectedPath}
        currentNodeId={currentNodeId}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
      />
    );
  };

  return (
    <div className={'app' + (IS_EMBEDDED ? ' embedded' : '')}>
      {!IS_EMBEDDED && (
        <Header
          title="ChatGPT Graph"
          conversationTitle={conversationData?.title}
          onRefresh={refreshData}
          isLoading={isLoading}
          stats={treeStats}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      )}

      <main className="main-content">
        {error ? renderError() :
          !conversationData ? renderEmptyState() :
          renderContent()}
      </main>
    </div>
  );
}

export default App;
