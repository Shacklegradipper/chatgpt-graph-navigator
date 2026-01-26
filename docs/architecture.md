# 架构设计文档

## 总体架构

本项目采用**模块化分层架构**，遵循 Chrome Extension Manifest V3 规范。

```
┌─────────────────────────────────────────────────┐
│           ChatGPT Web Page (DOM)                │
└─────────────────┬───────────────────────────────┘
                  │
        ┌─────────▼─────────┐
        │  Content Script   │ ← 页面数据采集
        │  - API Caller     │
        │  - DOM Observer   │
        │  - Data Parser    │
        └─────────┬─────────┘
                  │ Runtime Messages
        ┌─────────▼──────────┐
        │  Service Worker    │ ← 数据管理中枢
        │  - Message Router  │
        │  - IndexedDB       │
        │  - Cache Manager   │
        └─────────┬──────────┘
                  │ Runtime Messages
        ┌─────────▼─────────┐
        │   Side Panel      │ ← 用户界面
        │  - Graph Render   │
        │  - Search UI      │
        │  - Node Details   │
        └───────────────────┘
```

## 核心设计原则

### 1. 单一职责原则（SRP）
每个模块只负责一个明确的功能：
- **Content Script**: 只负责数据采集
- **Service Worker**: 只负责数据管理
- **Side Panel**: 只负责数据展示

### 2. 依赖倒置原则（DIP）
- 高层模块不依赖低层模块，都依赖抽象
- 通过消息传递解耦各模块

### 3. 开闭原则（OCP）
- 对扩展开放，对修改关闭
- 通过接口和抽象类设计可扩展架构

## 模块详细设计

### Content Script 模块

#### 职责
1. 调用 ChatGPT API 获取 conversation mapping
2. 解析 mapping 树结构
3. 监听页面 DOM 变化
4. 将数据发送到 Service Worker

#### 子模块

**API 模块** (`src/content/api/`)
```javascript
// conversation.js
export async function fetchConversation(conversationId) {
  // 调用 /backend-api/conversation/{id}
}
```

**Parser 模块** (`src/content/parser/`)
```javascript
// mapping-parser.js
export function parseMapping(mapping) {
  // 解析 mapping 为标准化结构
}

// branch-extractor.js
export function extractBranches(mapping) {
  // 提取所有分支
}
```

**Observer 模块** (`src/content/observer/`)
```javascript
// mutation-observer.js
export function observeNewMessages(callback) {
  // 监听新消息出现
}
```

#### 数据流
```
ChatGPT API → fetch → parse → send to background
     ↓
   mapping
     ↓
  branches
     ↓
Service Worker
```

---

### Service Worker 模块

#### 职责
1. 接收并存储来自 Content Script 的数据
2. 管理 IndexedDB 数据库
3. 实现缓存策略
4. 中转 Content Script ↔ Side Panel 消息

#### 子模块

**Database 模块** (`src/background/database/`)
```javascript
// db.js
export class ConversationDB {
  async saveConversation(data) {}
  async getConversation(id) {}
  async updateConversation(id, updates) {}
}

// schema.js
export const DB_SCHEMA = {
  conversations: { keyPath: 'id', indexes: [...] },
  nodes: { keyPath: 'id', indexes: [...] },
  rounds: { keyPath: 'id', indexes: [...] }
};
```

**Cache 模块** (`src/background/cache/`)
```javascript
// cache-manager.js
export class CacheManager {
  async get(key) {}
  async set(key, value, ttl) {}
  async invalidate(key) {}
}
```

**Messaging 模块** (`src/background/messaging/`)
```javascript
// message-handler.js
export function handleMessage(message, sender, sendResponse) {
  // 路由不同类型的消息
}
```

#### 数据库 Schema

**Conversations 表**
```javascript
{
  id: string (主键),
  title: string,
  createTime: number,
  updateTime: number,
  currentNode: string,
  metadata: object
}
```

**Nodes 表**
```javascript
{
  id: string (主键),
  conversationId: string (索引),
  role: 'user' | 'assistant' | 'system',
  content: string,
  createTime: number,
  parent: string,
  children: string[],
  metadata: object
}
```

**Rounds 表**
```javascript
{
  id: string (主键),
  conversationId: string (索引),
  userMessageId: string,
  assistantMessageId: string,
  parentRoundId: string,
  createTime: number
}
```

---

### Side Panel 模块

#### 职责（V0.1 简易版）
1. 显示当前对话的 mapping 树
2. 显示日志和调试信息
3. 手动触发数据刷新

#### 职责（完整版 - 后续实现）
1. 渲染图谱（Cytoscape.js / Sigma.js）
2. 节点搜索和过滤
3. 节点详情展示
4. 分支切换操作

#### 组件结构
```
Side Panel
├── Graph View        # 图谱视图
├── Search Bar        # 搜索栏
├── Node Details      # 节点详情面板
└── Debug Console     # 调试控制台（V0.1）
```

---

## 消息通信协议

### Message 类型定义

```javascript
// Content Script → Service Worker
{
  type: 'CONVERSATION_LOADED',
  payload: {
    conversationId: string,
    mapping: object,
    branches: array
  }
}

// Service Worker → Side Panel
{
  type: 'CONVERSATION_UPDATED',
  payload: {
    conversationId: string,
    updateType: 'new_message' | 'branch_created',
    data: object
  }
}

// Side Panel → Service Worker
{
  type: 'GET_CONVERSATION',
  payload: {
    conversationId: string
  }
}
```

### 消息流向

```
┌──────────────┐     CONVERSATION_LOADED      ┌──────────────┐
│   Content    │ ──────────────────────────→  │   Service    │
│   Script     │                               │   Worker     │
│              │ ←──────────────────────────   │              │
└──────────────┘     ACK / ERROR              └──────────────┘
                                                      ↕
                                               CONVERSATION_UPDATED
                                                      ↕
                                              ┌──────────────┐
                                              │  Side Panel  │
                                              └──────────────┘
```

---

## 数据流转

### 完整数据流

```
1. 用户打开 ChatGPT 对话页面
   ↓
2. Content Script 注入并执行
   ↓
3. 提取 conversationId
   ↓
4. 调用 API: GET /backend-api/conversation/{id}
   ↓
5. 解析 mapping 树
   ↓
6. 提取分支结构
   ↓
7. 发送到 Service Worker: CONVERSATION_LOADED
   ↓
8. Service Worker 存储到 IndexedDB
   ↓
9. 通知 Side Panel: CONVERSATION_UPDATED
   ↓
10. Side Panel 渲染图谱
```

### 增量更新流

```
1. MutationObserver 监听到新消息
   ↓
2. 提取新消息数据
   ↓
3. 发送到 Service Worker: NEW_MESSAGE
   ↓
4. Service Worker 更新 IndexedDB
   ↓
5. 通知 Side Panel: CONVERSATION_UPDATED
   ↓
6. Side Panel 增量更新图谱
```

---

## 性能优化策略

### 1. 延迟加载
- Content Script 延迟 1 秒执行，避免阻塞页面加载
- Side Panel 按需加载图谱库

### 2. 增量更新
- 只在新消息出现时更新，不全量重新解析
- 使用 MutationObserver 而非定时器

### 3. 缓存策略
- 内存缓存：最近访问的 3 个对话
- IndexedDB：持久化所有对话
- LRU 淘汰策略

### 4. 数据压缩
- 只存储必要字段
- 对长文本内容进行截断存储

---

## 错误处理

### 分层错误处理

**Content Script**
```javascript
try {
  const data = await fetchConversation(id);
} catch (error) {
  console.error('[Content] API Error:', error);
  // 发送错误到 Service Worker
  sendMessage({ type: 'ERROR', error });
}
```

**Service Worker**
```javascript
try {
  await db.save(data);
} catch (error) {
  console.error('[Background] DB Error:', error);
  // 通知 Side Panel
  notifyError(error);
}
```

**Side Panel**
```javascript
// 显示错误提示给用户
showNotification('数据加载失败，请刷新页面重试');
```

---

## 安全性考虑

### 1. 数据隔离
- 每个用户的数据独立存储
- 使用 conversationId 作为隔离标识

### 2. 权限最小化
- 只请求必要的 host_permissions
- 不请求 activeTab 等高权限

### 3. XSS 防护
- 所有用户内容都经过转义
- 使用 textContent 而非 innerHTML

---

## 可扩展性设计

### 1. 插件式架构
未来可以添加新的数据源：
```javascript
// src/content/api/plugin-api.js
export interface DataSource {
  fetchConversation(id): Promise<Mapping>
}
```

### 2. 图谱库可替换
通过适配器模式支持多种图谱库：
```javascript
// src/sidepanel/graph/adapter.js
export interface GraphAdapter {
  render(data): void
  updateNode(nodeId, data): void
}
```

### 3. 存储层可替换
支持不同的存储方案：
```javascript
// src/background/storage/interface.js
export interface Storage {
  save(key, value): Promise<void>
  get(key): Promise<any>
}
```

---

## 版本演进计划

### V0.1（当前）
- ✅ 基础架构
- ✅ API 调用
- ✅ 数据存储
- ✅ 简易调试界面

### V0.2
- 🚧 图谱可视化
- 🚧 节点搜索
- 🚧 基础交互

### V0.3
- 📋 分支切换
- 📋 节点详情
- 📋 导出功能

### V1.0
- 📋 完整的图谱管理
- 📋 跨对话视图
- 📋 性能优化
