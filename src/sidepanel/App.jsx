/**
 * Side Panel 主应用
 */
import React, { useState, useEffect, useCallback } from 'react';
import ConversationGraph from './components/ConversationGraph';
import Header from './components/Header';
import { useConversationData } from './hooks/useConversationData';
import { MESSAGE_TYPES } from '../shared/constants';

function App() {
  const {
    conversationData,
    isLoading,
    error,
    refreshData,
    currentNodeId,
    setCurrentNodeId
  } = useConversationData();

  // 节点点击处理
  const handleNodeClick = useCallback((nodeId, nodeData) => {
    console.log('[SidePanel] Node clicked:', nodeId, nodeData);
    setCurrentNodeId(nodeId);

    // 发送消息到 content script 进行定位
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SCROLL_TO_MESSAGE',
          payload: { messageId: nodeData.lastMessageId }
        });
      }
    });
  }, [setCurrentNodeId]);

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

  return (
    <div className="app">
      <Header
        title="ChatGPT Graph"
        conversationTitle={conversationData?.title}
        onRefresh={refreshData}
        isLoading={isLoading}
      />

      <main className="main-content">
        {error ? (
          <div className="error-message">
            <p>{error}</p>
            <button onClick={refreshData}>Retry</button>
          </div>
        ) : !conversationData ? (
          <div className="empty-state">
            <div className="empty-icon">🌲</div>
            <h2>No Conversation Loaded</h2>
            <p>Open a ChatGPT conversation to see its graph structure</p>
          </div>
        ) : (
          <ConversationGraph
            data={conversationData}
            currentNodeId={currentNodeId}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            onNodeContextMenu={handleNodeContextMenu}
          />
        )}
      </main>
    </div>
  );
}

export default App;
