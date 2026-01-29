/**
 * Side Panel React 入口
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// 获取根元素
const container = document.getElementById('root');
const root = createRoot(container);

// If rendered inside the floating panel iframe, tighten spacing a bit
try {
  const params = new URLSearchParams(window.location.search);
  if (params.has('embedded')) {
    document.documentElement.classList.add('embedded');
  }
} catch {
  // ignore
}

// 渲染应用
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
