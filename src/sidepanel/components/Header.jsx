/**
 * 头部组件
 */
import React from 'react';

function Header({ title, conversationTitle, onRefresh, isLoading, stats }) {
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
        {stats && (
          <div className="header-stats" title={`Q: ${stats.totalQuestions}, A: ${stats.totalAnswers}, Branches: ${stats.totalBranchPoints}`}>
            <span className="stat-item">Q:{stats.totalQuestions}</span>
            <span className="stat-item">A:{stats.totalAnswers}</span>
            {stats.totalBranchPoints > 0 && (
              <span className="stat-item branch">🌿{stats.totalBranchPoints}</span>
            )}
          </div>
        )}
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
