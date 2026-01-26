# ChatGPT Graph Extension

> 一个将ChatGPT对话转换为可导航知识图谱的Chrome扩展程序：支持非线性思维探索，可视化分支，跳转到任何节点，折叠长消息，用文件夹/标签组织聊天，并导出线程到Markdown/HTML/PDF/JSON—使非线性思维保持可搜索、可分享和可重用。

> A Chrome extension that turns ChatGPT conversations into a navigable knowledge graph: visualize branches, jump to any node, fold long messages, organize chats with folders/tags, and export threads to Markdown/HTML/PDF/JSON—so nonlinear thinking stays searchable, shareable, and reusable.

## 项目概述

这是一个 Chrome 扩展，用于可视化 ChatGPT 对话中的分支结构，帮助用户：
- 从任意节点开启新的分支讨论
- 并行探索多个问题方向
- 快速定位和回溯对话节点
- 以图谱形式组织和管理对话

## 当前版本：V0.1

### 已实现功能
- ✅ Content Script：API 调用和 mapping 树获取
- ✅ Service Worker：IndexedDB 数据持久化
- ✅ 简易调试界面

### 开发中功能
- 🚧 图谱可视化渲染
- 🚧 节点搜索和过滤
- 🚧 分支切换和管理

## 项目结构

```
chatgpt_extension/
├── docs/                      # 文档目录
│   ├── architecture.md       # 架构设计文档
│   └── development.md        # 开发指南
├── src/                      # 源代码
│   ├── content/             # Content Script（页面注入）
│   │   ├── index.js         # 入口文件
│   │   ├── api/             # API 调用模块
│   │   │   └── conversation.js
│   │   ├── parser/          # 数据解析模块
│   │   │   ├── mapping-parser.js
│   │   │   └── branch-extractor.js
│   │   ├── observer/        # DOM 监听模块
│   │   │   └── mutation-observer.js
│   │   └── utils/           # 工具函数
│   │       └── dom-helper.js
│   ├── background/          # Service Worker（后台服务）
│   │   ├── index.js         # 入口文件
│   │   ├── database/        # 数据库操作
│   │   │   ├── db.js        # IndexedDB 封装
│   │   │   └── schema.js    # 数据库 Schema
│   │   ├── cache/           # 缓存策略
│   │   │   └── cache-manager.js
│   │   └── messaging/       # 消息中转
│   │       └── message-handler.js
│   ├── sidepanel/           # Side Panel（侧边栏 UI）
│   │   ├── index.html       # 界面
│   │   ├── index.js         # 逻辑
│   │   └── styles.css       # 样式
│   └── shared/              # 共享代码
│       ├── constants.js     # 常量定义
│       ├── types.js         # 类型定义（JSDoc）
│       └── utils.js         # 通用工具函数
├── assets/                   # 资源文件
├── manifest.json            # 扩展配置
├── package.json             # 依赖管理
└── README.md               # 项目说明
```

## 核心模块

### 1. Content Script
**职责**：页面数据采集和监听
- 调用 ChatGPT API 获取对话 mapping 树
- 解析分支结构
- 监听页面变化（MutationObserver）
- 发送数据到 Service Worker

### 2. Service Worker
**职责**：数据管理和消息中转
- IndexedDB 数据持久化
- 缓存策略管理
- Content Script ↔ Side Panel 消息中转

### 3. Side Panel
**职责**：用户界面（V0.1 为简易调试界面）
- 显示 mapping 树结构
- 显示日志和调试信息
- 后续实现图谱可视化

## 快速开始

### 安装依赖
```bash
npm install
```

### 开发模式
1. 在 Chrome 中打开 `chrome://extensions/`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择项目根目录

### 调试
1. 打开 ChatGPT 页面
2. 打开 Chrome DevTools
3. 查看 Console 输出（Content Script 日志）
4. 点击扩展图标打开 Side Panel（UI 日志）

## 数据结构

### Mapping Node
```javascript
{
  id: string,
  message: {
    role: 'user' | 'assistant' | 'system',
    content: { parts: string[] },
    create_time: number
  },
  parent: string | null,
  children: string[]
}
```

### Round（轮次）
```javascript
{
  id: string,
  conversationId: string,
  userMessageId: string,
  assistantMessageId: string | null,
  parentRoundId: string | null,
  createTime: number
}
```

## 技术栈

- **Manifest Version**: V3
- **数据库**: IndexedDB
- **UI 框架**: 原生 JavaScript (V0.1)，后续考虑 React
- **图谱库**: 规划使用 Cytoscape.js 或 Sigma.js

## 开发规范

### 代码风格
- 使用 ES6+ 语法
- 异步操作使用 async/await
- 函数命名：驼峰命名法
- 常量命名：大写下划线

### 提交规范
- `feat:` 新功能
- `fix:` 修复 Bug
- `docs:` 文档更新
- `refactor:` 代码重构
- `test:` 测试相关

## 文档

详细文档请参考 `docs/` 目录：
- [架构设计](docs/architecture.md)
- [开发指南](docs/development.md)
- [需求文档](docs/auto-generated/单会话图谱需求总结.md)
- [API 分析](docs/auto-generated/API测试结果.md)

## License

LGPL
