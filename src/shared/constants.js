/**
 * 全局常量定义
 */

// 扩展名称
export const EXTENSION_NAME = 'ChatGPT Graph';

// 日志前缀
export const LOG_PREFIX = `[${EXTENSION_NAME}]`;

// API 端点
export const API_ENDPOINTS = {
  CONVERSATION: '/backend-api/conversation',
  CONVERSATIONS: '/backend-api/conversations',
  ME: '/backend-api/me'
};

// 消息类型
export const MESSAGE_TYPES = {
  // Content Script → Service Worker
  CONVERSATION_LOADED: 'CONVERSATION_LOADED',
  CONVERSATION_UPDATED: 'CONVERSATION_UPDATED',
  NEW_MESSAGE: 'NEW_MESSAGE',
  ERROR: 'ERROR',

  // Side Panel → Service Worker
  GET_CONVERSATION: 'GET_CONVERSATION',
  GET_ALL_CONVERSATIONS: 'GET_ALL_CONVERSATIONS',
  REFRESH_DATA: 'REFRESH_DATA',

  // Service Worker → Side Panel
  DATA_READY: 'DATA_READY',
  UPDATE_NOTIFICATION: 'UPDATE_NOTIFICATION'
};

// 节点角色
export const NODE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system'
};

// 存储键
export const STORAGE_KEYS = {
  CURRENT_CONVERSATION: 'current_conversation',
  CACHE_PREFIX: 'cache_',
  SETTINGS: 'settings'
};

// 配置
export const CONFIG = {
  // API 调用延迟（毫秒）
  API_DELAY: 1000,

  // 重试次数
  MAX_RETRIES: 3,

  // 缓存过期时间（毫秒）
  CACHE_TTL: 5 * 60 * 1000, // 5 分钟

  // 最大缓存条目数
  MAX_CACHE_SIZE: 10,

  // DOM 观察延迟（毫秒）
  OBSERVER_DELAY: 500
};

// URL 模式
export const URL_PATTERNS = {
  CONVERSATION: /\/c\/([a-f0-9-]+)/,
  CHATGPT_DOMAIN: /^https:\/\/(chatgpt\.com|chat\.openai\.com)/
};

// DOM 选择器（注意：ChatGPT UI 可能变化，需要维护多个版本）
export const DOM_SELECTORS = {
  ARTICLE: 'article',
  MAIN: 'main',
  USER_HEADING: 'h5',
  ASSISTANT_HEADING: 'h6',
  BRANCH_SWITCHER: '[aria-label*="回复"]'
};
