/**
 * 头部组件
 */
import React from 'react';

function Header({
  title,
  conversationTitle,
  onRefresh,
  isLoading,
  stats,
  viewMode = 'graph',
  onViewModeChange
}) {
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
        <div className="view-toggle" role="tablist" aria-label="View mode">
          <button
            className={'view-toggle-btn' + (viewMode === 'graph' ? ' active' : '')}
            onClick={() => onViewModeChange?.('graph')}
            title="Mind map view"
            aria-label="Mind map view"
            type="button"
          >
            🗺️
          </button>
          <button
            className={'view-toggle-btn' + (viewMode === 'tree' ? ' active' : '')}
            onClick={() => onViewModeChange?.('tree')}
            title="Git tree view"
            aria-label="Git tree view"
            type="button"
          >
            🌿
          </button>
        </div>
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
