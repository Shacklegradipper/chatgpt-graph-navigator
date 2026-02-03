<div align="center">
<img src="docs/pic/icon256.png" alt="ChatGPT Graph" width="128" />
<br>

  <h1>ChatGPT Graph Navigator</h1>
  <h3>浏览器扩展：构建对话图谱，梳理思维脉络。</h3>

<p>
  <img alt="Chrome" src="https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white" />
  <img alt="Manifest" src="https://img.shields.io/badge/Manifest-V3-10b981" />
  <img alt="React" src="https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white" />
  <img alt="XYFlow" src="https://img.shields.io/badge/XYFlow-React%20Flow-111827" />
</p>

<p align="center">
  <a href="./README.md"><img src="https://img.shields.io/badge/Lang-English-blue.svg?style=flat-square" alt="English" /></a>
  &nbsp;
  <img src="https://img.shields.io/badge/Lang-简体中文-lightgrey.svg?style=flat-square" alt="简体中文" />
</p>

<table>
  <tr>
    <td align="center" width="200">
      <img src="/docs/pic/graph.svg" width="45" height="45" alt="Graph View Icon" />
    </td>
    <td align="center" width="200">
      <img src="/docs/pic/timeline.svg" width="45" height="45" alt="Timeline Tree Icon" />
    </td>
    <td align="center" width="200">
      <img src="/docs/pic/tool.svg" width="45" height="45" alt="Workflow Utils Icon" />
    </td>
  </tr>

  <tr>
    <td align="center">
      <strong>图谱视图</strong>
    </td>
    <td align="center">
      <strong>时间线树</strong>
    </td>
    <td align="center">
      <strong>实用工具</strong>
    </td>
  </tr>

  <tr>
    <td align="center">
      <sub>空间可视化<br>逻辑全景概览</sub>
    </td>
    <td align="center">
      <sub>分支快速导航<br>Git 风格历史记录</sub>
    </td>
    <td align="center">
      <sub>消息折叠<br>及未来更多功能</sub>
    </td>
  </tr>
</table>

  <h4>
    ✨ 将聊天记录转化为交互式树状图。<br>
    专为 ChatGPT 对话打造的高效思维导图UI。
  </h4>


<p align="center">
  <a href="#features">功能特性</a>
  &nbsp;·&nbsp;
  <a href="#installation">安装指南</a>
  &nbsp;·&nbsp;
  <a href="#local-development">本地开发</a>
  &nbsp;·&nbsp;
  <a href="#roadmap">路线图</a>
</p>

</div>

---

## 为什么我们需要非线性对话？

解决复杂问题绝非一条直线。它包含假设、试错以及对多种可能性的同步探索。然而，传统的线性对话界面强行将所有这些独立的思维过程压缩进一条单一且混乱的时间线中。

* **📉 “上下文污染”难题：** 当你在同一个对话流中按顺序尝试不同方案时，无关的上下文和失败的尝试会不断堆积。这种“噪音”不仅消耗 Token 配额，还会干扰模型的注意力，使其难以针对你当前的策略提供最精准的分析。
* **🔀 “并行探索”的刚需：** 为了获取最佳结果，你往往需要对对话进行“分叉”——通过修改 Prompt 或重新生成回复来测试不同的路径。在线性界面中，管理这些“平行宇宙”简直是一场灾难。你很容易忘记思路是在哪里分岔的，也记不清哪个分支产出了最佳结果。
* **🧠 认知过载：** 试图在脑海中复盘 20 分钟前的 Prompt 与刚刚写好的新变体之间的逻辑关系，是一件极度消耗精力的事情。

**ChatGPT Graph Navigator 专为解决此问题而生。** 我们将你的分支可视化，帮助你**隔离上下文**以获取更纯净的模型输出，同时让你原本复杂的推理结构变得井井有条。

<br>

<h2 id="features">✨ 功能特性</h2>

<div align="center">
  <img src="docs/pic/main_feature.png" width="80%" style="max-width: 800px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" alt="main feature" />
</div>

### 核心能力一览：

* **🎨 两种界面：** 选择 **侧边栏 (Sidebar)** 享受常驻的沉浸式工作流，或使用 **悬浮窗 (Floating Window)** 进行随叫随到的轻量化查看。
* **👁️ 双重可视化视图：**
    * **图谱视图 (Graph View)：** 采用思维导图结构，助你一眼掌握对话“全局”与逻辑脉络。
    * **时间线树 (Timeline Tree)：** 采用 Git 风格的垂直树状图，精准追踪每一次细微的修改与分支。
* **⚡ 导航：** 点击任意节点即可 **直接跳转** 至对应分支的具体消息，瞬间还原历史上下文。
* **🔍 搜索：** 在整个对话树中快速定位特定的 Prompt 或 AI 回复，不再迷失在长对话中。
* **🛠️ 实用工具：** 内置长消息自动折叠功能，并计划持续集成更多效率工具（如导出、格式化等）。

---

### 🌲 集成侧边栏：对话控制中枢
*无需离开当前对话语境，即可轻松把握复杂脉络。*

<div align="center">
  <img src="docs/pic/sidepanel.gif" width="80%" style="max-width: 800px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);" alt="Sidebar Navigation Demo" />
</div>

<br>

侧边栏专为提升效率而生，提供两种模式以契合您的工作流：

#### 1. 图谱模式 (Graph Mode)
*掌控结构与上下文跳转的最佳选择。*
* **空间掌控：** 支持自由缩放与平移，瞬间掌握对话主题的完整拓扑结构。
* **一键跳转：** 点击图谱中的任意消息节点，即可 **瞬间跳转** 到任意分支的任意对话，并立即恢复当时的上下文环境。

#### 2. 时间线模式 (Timeline Mode)
*精准定位与内容检索的利器。*
* **专注筛选：** 信息噪音太多？切换过滤器以显示 **全部问答**、**仅问题 (Prompts)** 或 **仅回答 **。非常适合快速回顾您的 Prompt 迭代历史。同时也支持点击跳转。
* **即时搜索：** 使用内置搜索栏快速定位关键词，快速定位消息，回车直接跳转。

### 🧠 悬浮窗：随叫随到的交互图层
*专为多任务处理打造的轻量级可移动窗口。*

* 🚀 **拖拽与缩放：** 在屏幕任意位置访问完整的图谱/时间线视图。
* 👻 **穿透模式：**  点击穿透按钮，直接与悬浮窗背后的页面进行交互，互不干扰。
* 📌 **固定与融合：** 支持窗口 **置顶** 并自由调节 **透明度**。

<div align="center">
  <img src="docs/pic/float_main.png" width="60%" style="max-width: 800px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);" alt="Floating Window Demo" />
</div>

---

### 🛠️ 效率工具（持续增强中）
我们会不断打磨细节，并计划集成各种好用的小组件、小工具，提升您的工作效率。

- **📂 消息自动折叠**：长回复/代码块可自动或手动折叠，界面更清爽。
- **🚀 即将上线**：更强的**对话导出**（Markdown / 图片 / PDF）。
- **💡 你想要什么功能？** 欢迎提需求：到仓库 **[Issues](https://github.com/Robbings/chatgpt-graph-navigator/issues)** 里告诉我们你的想法。

<br>
<br>

<h2 id="installation">📥 安装指南</h2>

### 方式 1：加载已解压的扩展程序 (开发者/尝鲜版)
1.  **下载：** 下载最新的 [Release](https://github.com/Robbings/chatgpt-graph-navigator/releases) 版本。
2.  **打开扩展页：** 在浏览器地址栏输入 `chrome://extensions/` 并回车。
3.  **开启开发者模式：** 打开页面右上角的“开发者模式”开关。
4.  **加载：** 点击左上角的 **“加载未打包的扩展程序”** 按钮，选择下载的文件。

### 方式 2：Chrome 应用商店 (推荐)
> 🚧 **敬请期待：** 我们正在进行 Chrome 应用商店的审核流程，审核通过后将第一时间在此更新安装链接！

<br>
<br>

<h2 id="local-development">💻 本地开发</h2>

无论你是想修复 Bug 还是添加新功能，我们都欢迎你的PR！以下是如何在本地运行项目的指南。

### 前置要求

请确保你的机器上已安装以下环境：

* **[Node.js](https://nodejs.org/)** (v18 或更高版本)
* **包管理器：** [pnpm](https://pnpm.io/) (推荐)、npm 或 yarn
* **浏览器：** Chrome 或任何基于 Chromium 的浏览器 (Edge, Brave, Arc 等)

### 设置与安装

1.  **克隆仓库**
    ```bash
    git clone https://github.com/Robbings/chatgpt-graph-navigator.git
    cd chatgpt-graph-navigator
    ```

2.  **安装依赖**
    ```bash
    npm install
    # 或者如果使用 pnpm (推荐)
    pnpm install
    ```

3.  **启动开发模式**
    此命令将以 **监听模式 (watch mode)** 启动构建进程。你对源文件所做的任何更改都会触发自动重新构建。
    
    ```bash
    npm run dev
    ```
    
    > **注意：** 开发过程中请保持此终端窗口开启，以确保你的更改能被实时编译。
    
4.  **构建生产版本**
    ```bash
    npm run build
    ```

### 项目结构

以下是代码库的快速概览，帮助你快速上手：

```text
├── src/
│   ├── background/         # Service Worker (处理事件与右键菜单)
│   ├── content/            # 注入 ChatGPT 页面的脚本
│   │   ├── ui/             # 浮窗与侧边栏的 React 组件
│   │   ├── observers/      # DOM 观察器 (检测新消息)
│   │   └── parser/         # 将聊天 HTML 解析为图谱数据的逻辑
│   └── sidepanel/          # 独立的侧边栏应用
│       ├── components/     # 可复用的 UI 组件
│       ├── hooks/          # 自定义 React Hooks
│       └── styles/         # 全局样式与 Tailwind 配置
├── dist/                   # 编译输出 (自动生成)
├── assets/                 # 图标与静态资源
├── _locales/               # i18n 国际化翻译文件
├── manifest.json           # 扩展配置文件
└── build.js                # esbuild 构建脚本
```

<br>
<br>

<h2 id="roadmap">🗺️ 路线图</h2>

我们制定了激动人心的计划，旨在将此工具打造为针对 AI 对话的全方位**知识管理系统**。

#### ✅ 已完成 (Completed)
- [x] **核心 (Core):** 交互式图谱视图 & Git 风格时间线。
- [x] **界面 (UI):** 集成侧边栏 & 悬浮窗双模式。
- [x] **工具 (Utils):** 消息自动折叠，保持工作区整洁。

#### 🚧 开发中 & 计划 (In Progress & Planned)

**1. 高级标注 (Advanced Annotation)**
- [ ] **节点高亮:** 支持使用自定义颜色标记特定节点（如“重要”、“待办”、“错误”），从视觉上对信息进行分类。
- [ ] **分支书签:** 对特定的对话分支进行“加星”或“固定”，方便日后快速检索。

**2. 图谱编辑与重构 (Graph Editing & Restructuring)**
- [ ] **剪枝 (Pruning):** 删除不需要的节点或移除整个分支，保持上下文的纯净。
- [ ] **自定义连接:** 手动在任意两个节点之间创建连线——即使它们位于不同的分支——从而建立独立于原始对话流的逻辑关联。

**3. 全局知识图谱 (Global Knowledge Graph)**
> **终极目标:** 超越单一对话的限制。
- [ ] **跨对话视图:** 在一个工作区中同时可视化查看多个对话会话。
- [ ] **项目级管理:** 将相关对话归类为“项目 (Projects)”，并在统一的图谱中管理它们之间的关系。

**4. 更多实用工具 (More Utilities)**
- [ ] **导出:** 将图表保存为 Markdown、JSON 或高清图片。
- [ ] **全局搜索:** 支持跨所有节点和分支的关键词搜索。
- [ ] **公式支持:** LaTeX 公式一键复制。

**0. Bug 待修复清单**
- [ ] 无法点击跳转到部分特殊回答节点（比如部分生成图像的节点）。

---

<h2 id="contributing">🤝 贡献指南</h2>

我们非常欢迎任何形式的贡献！
无论是发现 Bug 还是有新功能建议，请随时 **[提交 Issue](https://github.com/Robbings/chatgpt-graph-navigator/issues)**，或者直接 **提交 PR**。

## 📄 开源协议

<img src="https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square" alt="GPLv3 License">

本项目基于 **GPL-3.0 协议** 开源。

