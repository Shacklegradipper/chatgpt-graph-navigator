/**
 * Round 节点组件
 * 显示一对问答（User + Assistant）
 */
import React, { memo, useState, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';

/**
 * 节点颜色配置
 */
const LEVEL_COLORS = {
  0: { bg: '#c3caff', border: '#a5b4fc' },  // Level 0 - 浅紫蓝
  1: { bg: '#bae6fd', border: '#7dd3fc' },  // Level 1 - 浅蓝
  2: { bg: '#a2dcd0', border: '#5eead4' },  // Level 2 - 浅青
  3: { bg: '#9decbb', border: '#6ee7a7' },  // Level 3 - 浅绿
  default: { bg: '#e5e7eb', border: '#d1d5db' }
};

function RoundNode({ id, data, selected }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  // 获取节点颜色
  const colors = LEVEL_COLORS[data.level] || LEVEL_COLORS[data.level % 4] || LEVEL_COLORS.default;

  // 展开/收缩切换
  const toggleExpand = useCallback((e) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

  // 截断文本
  const truncate = (text, maxLength = 50) => {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  return (
    <div
      className={`round-node ${selected ? 'selected' : ''} ${isHovered ? 'hovered' : ''}`}
      style={{
        backgroundColor: colors.bg,
        borderColor: selected ? '#3b82f6' : colors.border
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 顶部连接点 */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: colors.border }}
      />

      {/* 节点头部 */}
      <div className="node-header">
        <span className="node-round-number">Round {data.roundNumber}</span>
        {data.hasChildren && (
          <button
            className="expand-btn"
            onClick={toggleExpand}
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? '−' : '+'}
          </button>
        )}
      </div>

      {/* 节点内容 */}
      {isExpanded && (
        <div className="node-content">
          {/* User 消息 */}
          <div className="message user-message">
            <span className="message-role">👤</span>
            <span className="message-text" title={data.userContent}>
              {truncate(data.userContent)}
            </span>
          </div>

          {/* Assistant 消息 */}
          {data.assistantContent && (
            <div className="message assistant-message">
              <span className="message-role">🤖</span>
              <span className="message-text" title={data.assistantContent}>
                {truncate(data.assistantContent)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 收起时显示简略信息 */}
      {!isExpanded && (
        <div className="node-collapsed">
          <span>👤 + 🤖</span>
        </div>
      )}

      {/* 分支指示器 */}
      {data.branchCount > 1 && (
        <div className="branch-indicator" title={`${data.branchCount} branches`}>
          🌿 {data.branchCount}
        </div>
      )}

      {/* 底部连接点 */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: colors.border }}
      />
    </div>
  );
}

export default memo(RoundNode);
