# 开发指南

## 开发环境设置

### 前置要求
- Node.js >= 16
- Chrome 浏览器 >= 120
- ChatGPT 账号

### 初始化项目
```bash
cd chatgpt_extension
npm init -y
npm install --save-dev prettier eslint
```

---

## 调试方法

### 1. Content Script 调试
在 ChatGPT 页面打开 DevTools：
```
F12 → Console 标签
```
查看以 `[ChatGPT Graph]` 开头的日志

### 2. Service Worker 调试
```
chrome://extensions/ → 本扩展 → Service Worker → 检查视图
```

### 3. Side Panel 调试
点击扩展图标打开 Side Panel，右键 → 检查

---

## 代码规范

### 命名规范
```javascript
// 常量：大写下划线
const API_BASE_URL = '/backend-api';
const MAX_CACHE_SIZE = 100;

// 函数：驼峰命名，动词开头
function fetchConversation() {}
function parseMapping() {}

// 类：帕斯卡命名
class ConversationDB {}
class CacheManager {}

// 私有方法：下划线前缀
function _internalHelper() {}
```

### 注释规范
使用 JSDoc 注释：
```javascript
/**
 * 获取对话数据
 * @param {string} conversationId - 对话 ID
 * @returns {Promise<Object>} 对话数据
 * @throws {Error} API 调用失败
 */
async function fetchConversation(conversationId) {
  // ...
}
```

### 错误处理
```javascript
// 推荐：使用 try-catch
try {
  const data = await fetchData();
  return data;
} catch (error) {
  console.error('[Module] Error:', error);
  throw new Error(`Failed to fetch: ${error.message}`);
}

// 不推荐：不处理错误
const data = await fetchData(); // 可能抛出未捕获的异常
```

---

## 模块开发指南

### Content Script 开发

#### API 调用模块
```javascript
// src/content/api/conversation.js

/**
 * 获取对话完整数据
 */
export async function fetchConversation(conversationId) {
  const response = await fetch(
    `/backend-api/conversation/${conversationId}`,
    { credentials: 'include' }
  );

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return await response.json();
}
```

#### Parser 模块
```javascript
// src/content/parser/mapping-parser.js

/**
 * 解析 mapping 为节点数组
 */
export function parseMapping(mapping) {
  const nodes = [];

  for (const nodeId in mapping) {
    const node = mapping[nodeId];
    if (node.message && node.message.author.role !== 'system') {
      nodes.push({
        id: nodeId,
        role: node.message.author.role,
        content: node.message.content.parts?.join('') || '',
        parent: node.parent,
        children: node.children || [],
        createTime: node.message.create_time
      });
    }
  }

  return nodes;
}
```

### Service Worker 开发

#### 消息处理
```javascript
// src/background/messaging/message-handler.js

export function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch(error => {
        console.error('[Background] Message error:', error);
        sendResponse({ error: error.message });
      });

    return true; // 保持消息通道打开
  });
}

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'CONVERSATION_LOADED':
      return await handleConversationLoaded(message.payload);

    case 'GET_CONVERSATION':
      return await handleGetConversation(message.payload);

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}
```

#### IndexedDB 操作
```javascript
// src/background/database/db.js

export class ConversationDB {
  constructor() {
    this.dbName = 'ChatGPTGraphDB';
    this.version = 1;
  }

  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 创建对象存储
        if (!db.objectStoreNames.contains('conversations')) {
          const store = db.createObjectStore('conversations', { keyPath: 'id' });
          store.createIndex('updateTime', 'updateTime');
        }
      };
    });
  }

  async save(conversation) {
    const db = await this.open();
    const tx = db.transaction('conversations', 'readwrite');
    const store = tx.objectStore('conversations');

    return new Promise((resolve, reject) => {
      const request = store.put(conversation);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
```

---

## 消息通信示例

### 从 Content Script 发送消息
```javascript
// src/content/index.js

async function sendToBackground(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type, payload },
      response => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      }
    );
  });
}

// 使用示例
try {
  const result = await sendToBackground('CONVERSATION_LOADED', {
    conversationId: 'xxx',
    mapping: { ... }
  });
  console.log('Success:', result);
} catch (error) {
  console.error('Failed:', error);
}
```

### 从 Service Worker 发送消息到 Side Panel
```javascript
// src/background/messaging/message-handler.js

async function notifySidePanel(type, payload) {
  const tabs = await chrome.tabs.query({ active: true });

  for (const tab of tabs) {
    try {
      await chrome.runtime.sendMessage({ type, payload });
    } catch (error) {
      console.warn('Side panel not open');
    }
  }
}

// 使用示例
await notifySidePanel('CONVERSATION_UPDATED', {
  conversationId: 'xxx',
  updateType: 'new_message'
});
```

---

## 常见问题

### 1. fetch 返回 404
**问题**：Content Script 调用 API 返回 404

**原因**：认证问题或 URL 错误

**解决**：
```javascript
// 确保使用相对路径
const response = await fetch(
  `/backend-api/conversation/${id}`,  // ✅ 正确
  { credentials: 'include' }           // ✅ 携带 Cookie
);

// 不要使用绝对路径
const response = await fetch(
  `https://chatgpt.com/backend-api/...`, // ❌ 错误
  ...
);
```

### 2. IndexedDB 操作失败
**问题**：数据保存失败

**原因**：事务关闭或权限问题

**解决**：
```javascript
// ✅ 正确：在事务完成前返回 Promise
async function save(data) {
  const db = await this.open();
  const tx = db.transaction('conversations', 'readwrite');
  const store = tx.objectStore('conversations');

  return new Promise((resolve, reject) => {
    const request = store.put(data);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ❌ 错误：事务已关闭
async function save(data) {
  const db = await this.open();
  const tx = db.transaction('conversations', 'readwrite');
  const store = tx.objectStore('conversations');
  store.put(data); // 没有等待完成
  // 事务此时已关闭
}
```

### 3. 消息发送失败
**问题**：`chrome.runtime.sendMessage` 没有响应

**原因**：接收方未正确返回 `true`

**解决**：
```javascript
// ✅ 正确：返回 true 保持通道打开
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse);
  return true; // 重要！
});

// ❌ 错误：通道立即关闭
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse);
  // 缺少 return true
});
```

---

## 测试方法

### 单元测试示例
```javascript
// test/parser.test.js

import { parseMapping } from '../src/content/parser/mapping-parser.js';

describe('parseMapping', () => {
  it('should parse mapping correctly', () => {
    const mapping = {
      'node1': {
        message: {
          author: { role: 'user' },
          content: { parts: ['Hello'] },
          create_time: 123456
        },
        parent: null,
        children: ['node2']
      }
    };

    const nodes = parseMapping(mapping);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].role).toBe('user');
    expect(nodes[0].content).toBe('Hello');
  });
});
```

### 集成测试
```javascript
// test/integration.test.js

describe('Content Script → Service Worker', () => {
  it('should save conversation to database', async () => {
    // 1. 模拟 API 返回
    const mockData = { ... };

    // 2. 触发 Content Script
    await injectContentScript();

    // 3. 等待数据保存
    await waitFor(() => db.has(conversationId));

    // 4. 验证数据
    const saved = await db.get(conversationId);
    expect(saved.title).toBe('Test Conversation');
  });
});
```

---

## 发布流程

### 1. 版本号管理
遵循语义化版本：`MAJOR.MINOR.PATCH`

```bash
# 修复 Bug
npm version patch  # 0.1.0 → 0.1.1

# 新功能
npm version minor  # 0.1.1 → 0.2.0

# 破坏性更新
npm version major  # 0.2.0 → 1.0.0
```

### 2. 打包发布
```bash
# 清理和构建
npm run clean
npm run build

# 打包 zip
cd dist
zip -r chatgpt-graph-v0.1.0.zip *
```

### 3. Chrome Web Store 上传
1. 访问 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. 上传 zip 文件
3. 填写商店信息
4. 提交审核

---

## 性能监控

### 添加性能标记
```javascript
// src/content/index.js

performance.mark('content-script-start');

await fetchConversation(id);

performance.mark('content-script-end');
performance.measure(
  'content-script-duration',
  'content-script-start',
  'content-script-end'
);

const measure = performance.getEntriesByName('content-script-duration')[0];
console.log(`[Perf] Content script took ${measure.duration}ms`);
```

### 监控 API 响应时间
```javascript
const start = Date.now();
const response = await fetch(...);
const duration = Date.now() - start;

if (duration > 2000) {
  console.warn(`[Perf] Slow API call: ${duration}ms`);
}
```

---

## 有用的资源

### Chrome Extension API
- [Manifest V3 文档](https://developer.chrome.com/docs/extensions/mv3/)
- [Runtime API](https://developer.chrome.com/docs/extensions/reference/runtime/)
- [Storage API](https://developer.chrome.com/docs/extensions/reference/storage/)

### IndexedDB
- [MDN IndexedDB 指南](https://developer.mozilla.org/zh-CN/docs/Web/API/IndexedDB_API)
- [Dexie.js](https://dexie.org/) - 推荐的 IndexedDB 包装库

### 图谱库
- [Cytoscape.js](https://js.cytoscape.org/)
- [Sigma.js](https://www.sigmajs.org/)
