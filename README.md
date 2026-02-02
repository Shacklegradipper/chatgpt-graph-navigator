<div align="center">
<img src="docs/pic/icon256.png" alt="ChatGPT Graph" width="128" />
<br>

  <h1>ChatGPT Graph Navigator</h1>
  <h3>A Browser Extension: Map your conversations. Navigate your thoughts.</h3>

<p>
  <img alt="Chrome" src="https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white" />
  <img alt="Manifest" src="https://img.shields.io/badge/Manifest-V3-10b981" />
  <img alt="React" src="https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white" />
  <img alt="XYFlow" src="https://img.shields.io/badge/XYFlow-React%20Flow-111827" />
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
      <strong>Graph View</strong>
    </td>
    <td align="center">
      <strong>Timeline Tree</strong>
    </td>
    <td align="center">
      <strong>Workflow Utils</strong>
    </td>
  </tr>

  <tr>
    <td align="center">
      <sub>Spatial visualization <br> for logical overview</sub>
    </td>
    <td align="center">
      <sub>Git-style history with<br>branch navigation</sub>
    </td>
    <td align="center">
      <sub>Message folding<br>& more to come</sub>
    </td>
  </tr>
</table>

  <h4>
    ✨ Visualize your chat history as an interactive tree graph.<br>
    The professional mind-map interface for navigating ChatGPT conversations.
  </h4>


<p align="center">
  <a href="#features">Features</a>
  &nbsp;·&nbsp;
  <a href="#installation">Installation</a>
  &nbsp;·&nbsp;
  <a href="#local-development">Local Development</a>
  &nbsp;·&nbsp;
  <a href="#roadmap">Roadmap</a>
</p>

</div>

## Why Linear Chat Isn't Enough?

Complex problem-solving is rarely a straight line. It involves hypotheses, trial and error, and exploring multiple possibilities simultaneously. However, a standard linear chat forces all these distinct thought processes into a single, cluttered timeline.

* **📉 The "Context Pollution" Problem:** When you test different approaches sequentially in one thread, irrelevant contexts and failed attempts accumulate. This "noise" distracts the model, consuming token limits and interfering with its ability to provide the most accurate analysis for your current strategy.
* **🔀 The Need for Parallel Exploration:** To get the best results, you often need to fork the conversation—editing prompts or regenerating answers to test distinct paths. In a linear interface, managing these "parallel universes" is chaotic. You lose track of where ideas diverged and which branch yielded the best result.
* **🧠 Cognitive Overload:** Trying to mentally reconstruction the relationship between a prompt sent 20 minutes ago and a new variation you just wrote is exhausting.

**ChatGPT Graph Navigator solves this.** We visualize your branches, helping you isolate contexts for cleaner model outputs while keeping your entire reasoning structure organized.

<br>

<h2 id="features">✨ Features</h2>

<div align="center">
  <img src="docs/pic/main_feature.png" width="80%" style="max-width: 800px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" alt="main feature" />
</div>

### Key capabilities at a glance:

* **🎨 Flexible UI Modes:** Use the **Sidebar** for a persistent, immersive workflow, or the **Floating Window** for quick, on-demand visualization.
* **👁️ Dual Visualization:**
    * **Graph View:** A 2D mind-map structure to understand the "big picture" and logic flow.
    * **Timeline Tree:** A Git-style vertical tree for tracking granular changes and edits.
* **⚡ Instant Navigation:** Click any node to **jump directly** to that specific message in any branch, instantly restoring the context.
* **🔍 Power Search:** Quickly locate specific prompts or answers across the entire conversation tree.
* **🛠️ Workflow Utilities:** Includes message auto-folding and plans for more efficiency tools (export, formatting, etc.).

### 🌲 The Integrated Sidebar: Your Conversation Command Center
*Navigate complex threads without ever leaving your chat context.*

<div align="center">
  <img src="docs/pic/sidepanel.gif" width="80%" style="max-width: 800px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);" alt="Sidebar Navigation Demo" />
</div>

<br>

The sidebar is designed for efficiency, offering two distinct modes to suit your workflow:

#### 1. The Graph Mode
*Perfect for structure and context jumping.*
* **Spatial Control:** Zoom and pan freely to grasp the full topology of your conversation topics instantly.
* **One-Click Teleport:** See a node you want to revisit? Click any message node in the graph to **instantly jump** to that exact moment in any branch, restoring its context immediately.

#### 2. The Smart Timeline Mode
*Perfect for precision and content retrieval.*
* **Focused Filtering:** Too much noise? Toggle filters to show **Q&A**, **Questions Only**, or **Answers Only**. Great for skimming through your prompt history.
* **Instant Search:** Don't scroll endlessly. Use the built-in search bar to locate specific keywords and jump directly to the target message.

### 🧠 The Floating Window: On-Demand Overlay
*A lightweight, movable window designed for multitasking.*

* 🚀 Draggable & Resizable & Access the full Graph/Timeline views anywhere on your screen.
* **👻 Ghost Mode:** Enable **"Click-Through"** to interact with the page behind the transparency.
* **📌 Pin & Blend:** Keep the window **Always-on-Top** and adjust **Opacity** to fit your workflow.

<div align="center">
  <img src="docs/pic/float_main.png" width="60%" style="max-width: 800px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);" alt="Floating Window Demo" />
</div>

### 🛠️ Workflow Utilities
We are continuously optimizing the details to improve your efficiency.

* **📂 Message Auto-Folding:** Automatically or manually collapse long responses or code blocks to keep your workspace clean.
* **🚀 Coming Soon:** We are working on **Powerful Chat Export** (Markdown/Image/Pdf).
* **💡 Have an Idea?** We welcome feature requests! Feel free to [open an issue](https://github.com/Robbings/chatgpt-graph-navigator/issues) to let us know what you need.

<br>
<br>

<h2 id="installation">📥 Installation</h2>

### Option 1: Load Unpacked (For Developers & Early Adopters)
1.  **Download:** Clone this repository or download the latest [Release](https://github.com/Robbings/chatgpt-graph-navigator/releases).
2.  **Unzip:** Extract the downloaded file.
3.  **Open Chrome Extensions:** Go to `chrome://extensions/` in your browser.
4.  **Enable Developer Mode:** Toggle the switch in the top-right corner.
5.  **Load:** Click **"Load unpacked"** and select the `dist` (or `build`) folder from your downloaded files.

### Option 2: Chrome Web Store (Recommended)
> 🚧 **Coming Soon:** We are currently reviewing our submission to the Chrome Web Store. Stay tuned!

<br>
<br>

<h2 id="local-development">💻 Local Development</h2>

Whether you want to fix a bug or add a new feature, we welcome contributions! Here is how to get the project running locally.

### Prerequisites

Ensure you have the following installed on your machine:

* **[Node.js](https://nodejs.org/)** (v18 or higher)
* **Package Manager:** [pnpm](https://pnpm.io/) (recommended), npm, or yarn
* **Browser:** Chrome or any Chromium-based browser (Edge, Brave, Arc, etc.)

### Setup & Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/Robbings/chatgpt-graph-navigator.git
    cd chatgpt-graph-navigator
    ```

2.  **Install dependencies**
    ```bash
    npm install
    # or if using pnpm
    pnpm install
    ```

3.  **Start Development Mode**
    This command starts the build process in **watch mode**. Any changes you make to the source files will trigger an automatic rebuild.
    
    ```bash
    npm run dev
    ```
    
    > **Note:** Keep this terminal window open while developing to ensure your changes are compiled in real-time.
    
4.  **Build for Production**
    ```bash
    npm run build
    ```


### Project Structure

Here is a quick overview of the codebase to help you navigate:

```text
├── src/
│   ├── background/         # Service worker (handles events & context menus)
│   ├── content/            # Scripts injected into the ChatGPT page
│   │   ├── ui/             # React components for Floating Panel & Sidebar
│   │   ├── observers/      # DOM observers (detects new messages)
│   │   └── parser/         # Logic to parse chat HTML into Graph data
│   └── sidepanel/          # The standalone Side Panel application
│       ├── components/     # Reusable UI components
│       ├── hooks/          # Custom React hooks
│       └── styles/         # Global styles and Tailwind config
├── dist/                   # Compiled output (auto-generated)
├── assets/                 # Icons and static images
├── _locales/               # i18n translation files
├── manifest.json           # Extension configuration
└── build.js                # esbuild configuration script
```

<br>
<br>

<h2 id="roadmap">🗺️ Roadmap</h2>

We have exciting plans to turn this tool into a comprehensive Knowledge Management System for AI conversations.

#### ✅ Completed
- [x] **Core:** Interactive Graph View & Git-Style Timeline.
- [x] **UI:** Integrated Sidebar & Floating Window modes.
- [x] **Utils:** Message auto-folding for clean workspace.

#### 🚧 In Progress & Planned

**1. Advanced Annotation**
- [ ] **Node Highlighting:** Mark specific nodes with custom colors (e.g., "Important", "To-Do", "Wrong") to visually categorize information.
- [ ] **Branch Bookmarking:** "Star" or "Pin" specific conversation branches for quick retrieval later.

**2. Graph Editing & Restructuring**
- [ ] **Pruning:** Delete unwanted nodes or remove entire branches to keep the context clean.
- [ ] **Custom Linking:** Manually create edges between any two nodes—even across different branches—to build your own logical connections independent of the original chat flow.

**3. Global Knowledge Graph**
> **The Ultimate Goal:** Moving beyond single chats.
- [ ] **Cross-Conversation View:** Visualize multiple chat sessions in a single workspace.
- [ ] **Project-Level Management:** Group related conversations into "Projects" and manage their relationships in a unified graph.

**4. More Utilities**
- [ ] **Export:** Save charts as Markdown, JSON, or HD Images.
- [ ] **Global Search:** Search keywords across all nodes and branches.
- [ ] **Formula Support:** One-click copy for LaTeX formulas.

<h2 id="contributing">🤝 Contributing</h2>

We welcome all contributions!
Please feel free to **[Open an Issue](https://github.com/Robbings/chatgpt-graph-navigator/issues)** for bugs & feature requests, or **Submit a PR**.

## 📄 License

<img src="https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square" alt="GPLv3 License">

This project is licensed under the **GPL-3.0 License**. 
