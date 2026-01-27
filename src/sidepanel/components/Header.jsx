/**
 * 头部组件
 */
import React from 'react';

function Header({ title, conversationTitle, onRefresh, isLoading }) {
  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-title">
          <span className="header-icon">🌲</span>
          {title}
        </h1>
        {conversationTitle && (
          <p className="header-subtitle" title={conversationTitle}>
            {conversationTitle.length > 30
              ? conversationTitle.substring(0, 30) + '...'
              : conversationTitle}
          </p>
        )}
      </div>
      <div className="header-right">
        <button
          className="refresh-btn"
          onClick={onRefresh}
          disabled={isLoading}
          title="Refresh"
        >
          <span className={isLoading ? 'spinning' : ''}>🔄</span>
        </button>
      </div>
    </header>
  );
}

export default Header;
