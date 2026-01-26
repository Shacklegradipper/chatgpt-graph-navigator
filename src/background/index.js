/**
 * Service Worker 入口
 * 负责：
 * 1. 接收来自 Content Script 的消息
 * 2. 管理 IndexedDB 数据库
 * 3. 缓存管理
 * 4. 消息中转
 */

import { setupMessageListener } from './messaging/message-handler.js';
import { db } from './database/db.js';
import { cache } from './cache/cache-manager.js';

/**
 * 初始化 Service Worker
 */
async function initialize() {
  console.log('[Background] Service Worker initializing...');

  try {
    // 打开数据库
    await db.open();
    console.log('[Background] ✓ Database opened');

    // 设置消息监听器
    setupMessageListener();
    console.log('[Background] ✓ Message listener registered');

    // 输出初始化信息
    console.log('[Background] ✓ Service Worker initialized successfully');
    console.log('[Background] Cache stats:', cache.getStats());

  } catch (error) {
    console.error('[Background] Initialization failed:', error);
  }
}

/**
 * 扩展安装事件
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] Extension installed:', details.reason);

  if (details.reason === 'install') {
    console.log('[Background] First time installation');
    // TODO: 可以在这里设置默认配置
  } else if (details.reason === 'update') {
    console.log('[Background] Extension updated');
    // TODO: 可以在这里处理数据迁移
  }
});

/**
 * Service Worker 启动事件
 */
self.addEventListener('activate', (event) => {
  console.log('[Background] Service Worker activated');
  event.waitUntil(initialize());
});

/**
 * 扩展启动时初始化
 */
initialize();

// 保持 Service Worker 活跃（可选，用于调试）
// chrome.alarms.create('keepAlive', { periodInMinutes: 1 });
// chrome.alarms.onAlarm.addListener((alarm) => {
//   if (alarm.name === 'keepAlive') {
//     console.log('[Background] Keep alive ping');
//   }
// });
