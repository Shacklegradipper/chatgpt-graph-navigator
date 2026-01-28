/**
 * QA 节点组件
 * 显示问题（Q）或回答（A）节点
 */
import React, { memo, useState, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';

/**
 * 截断文本
 */
function truncate(text, maxLength) {
  if (!text) return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength) + '…';
}

/**
 * QA 节点组件
 */
function QANode({ id, data, selected }) {
  const [isHovered, setIsHovered] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const {
    nodeType,      // 'question' | 'answer'
    nodeId,
    content,
    preview,
    createTime,
    isSelected,    // 是否在选中路径上
    childCount,
    colors,
    messageId
  } = data;

  const isQuestion = nodeType === 'question';
  const icon = isQuestion ? '👤' : '🤖';
  const label = isQuestion ? 'Q' : 'A';

  // 根据状态决定样式
  const bgColor = isSelected ? colors.bg : colors.bg;
  const borderColor = selected ? '#1d4ed8' : (isSelected ? colors.border : colors.border);
  const borderWidth = selected ? 3 : (isSelected ? 2 : 1);

  // 显示的文本
  const displayText = isExpanded ? truncate(content, 300) : truncate(preview, 60);
  const hasMore = content && content.length > 60;

  const toggleExpand = useCallback((e) => {
    e.stopPropagation();
    setIsExpanded(prev => !prev);
  }, []);

  return (
    <div
      className={`qa-node ${nodeType} ${isSelected ? 'on-path' : ''} ${selected ? 'selected' : ''} ${isHovered ? 'hovered' : ''}`}
      style={{
        backgroundColor: bgColor,
        borderColor: borderColor,
        borderWidth: `${borderWidth}px`,
        borderStyle: 'solid'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 顶部连接点 */}
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: colors.border,
          width: 8,
          height: 8
        }}
      />

      {/* 节点头部 */}
      <div className="qa-node-header">
        <span className="qa-node-icon">{icon}</span>
        <span className="qa-node-label">{label}</span>
        {childCount > 1 && (
          <span className="qa-node-branch-count" title={`${childCount} branches`}>
            🌿 {childCount}
          </span>
        )}
        {hasMore && (
          <button
            className="qa-node-expand-btn"
            onClick={toggleExpand}
            title={isExpanded ? 'Show less' : 'Show more'}
          >
            {isExpanded ? '−' : '+'}
          </button>
        )}
      </div>

      {/* 节点内容 */}
      <div className="qa-node-content">
        <p className="qa-node-text" title={content}>
          {displayText || <em className="qa-node-empty">(empty)</em>}
        </p>
      </div>

      {/* 选中路径指示器 */}
      {isSelected && (
        <div className="qa-node-path-indicator" />
      )}

      {/* 底部连接点 */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: colors.border,
          width: 8,
          height: 8
        }}
      />
    </div>
  );
}

export default memo(QANode);
