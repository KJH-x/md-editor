# 网页多标签页套壳方案调查报告

> **调查日期**: 2026-05-14  
> **目标项目**: md-editor (Vditor Markdown 编辑器多标签页套壳)  
> **核心需求**: DOM/JS 上下文隔离 + 标签页拖拽重排序 + 分屏布局

---

## 目录

1. [发现的方案/仓库列表](#1-发现的方案仓库列表)
2. [推荐方案及理由](#2-推荐方案及理由)
3. [iframe + sandbox 隔离方案技术细节](#3-iframe--sandbox-隔离方案技术细节)
4. [拖拽标签页 + 分屏布局的可实现路径](#4-拖拽标签页--分屏布局的可实现路径)
5. [纯静态站点兼容性评估](#5-纯静态站点兼容性评估)
6. [方案对比表](#6-方案对比表)
7. [关键代码/配置示例片段](#7-关键代码配置示例片段)

---

## 1. 发现的方案/仓库列表

### 1.1 Dockview ⭐ 首推

| 属性 | 值 |
|---|---|
| **GitHub** | [mathuo/dockview](https://github.com/mathuo/dockview) |
| **Stars** | 3.2k |
| **License** | MIT |
| **最新版本** | v6.2.2 (2026-05-12，昨天) |
| **活跃度** | ⭐⭐⭐⭐⭐ 极其活跃，2522 commits，284 branches |
| **包名** | `dockview-core` (无框架), `dockview` (React), `dockview-vue`, `dockview-angular` |
| **核心思路** | 零依赖的 Dock 布局管理器，支持标签页、分组、网格和分屏视图。内置拖拽、浮动面板、弹出窗口、序列化、Shadow DOM 支持。 |

**关键特性**:
- ✅ 原生拖拽标签页重排序
- ✅ 分屏布局 (split-views, grid-views, dockable views)
- ✅ 标签页分组 (Tab Groups) + 边缘分组 (Edge Groups)
- ✅ 序列化/反序列化 (toJSON/fromJSON)
- ✅ 主题化 (CSS Variables)
- ✅ Shadow DOM 支持
- ✅ 浮动面板 + 弹出窗口
- ✅ Vue/React/Angular/vanilla TS 全支持

### 1.2 Golden Layout

| 属性 | 值 |
|---|---|
| **GitHub** | [golden-layout/golden-layout](https://github.com/golden-layout/golden-layout) |
| **Stars** | 6.7k |
| **License** | MIT |
| **最新版本** | v2.6.0 (2022-09-26) |
| **活跃度** | ⭐⭐⭐ 中等，仍接受 PR (最近提交 2026-01)，764 commits |
| **核心思路** | 纯 JS 布局管理器，支持多窗口、拖拽布局、组件注册 |

**关键特性**:
- ✅ 原生拖拽重排序
- ✅ 分屏布局
- ✅ 弹出窗口
- ✅ 触摸支持
- ✅ Angular/Vue 支持
- ✅ 保存/加载布局
- ✅ 主题化

**注意**: NPM 包长期未更新，官方推荐从源码构建

### 1.3 Lumino (原 PhosphorJS)

| 属性 | 值 |
|---|---|
| **GitHub** | [jupyterlab/lumino](https://github.com/jupyterlab/lumino) |
| **Stars** | 753 |
| **License** | BSD-3-Clause |
| **最新版本** | v2026.2.5 (2026-02-05) |
| **活跃度** | ⭐⭐⭐⭐ 活跃 (Jupyter 项目，持续维护)，4002 commits |
| **核心思路** | 桌面级 Web 应用组件库，提供 DockPanel、TabBar、SplitPanel 等组件。JupyterLab 的底层框架。原名 PhosphorJS。 |

**关键特性**:
- ✅ DockPanel + TabBar + SplitPanel
- ✅ 拖拽标签页 (内置)
- ✅ 分屏布局 (SplitPanel)
- ❌ 没有简单的 npm 包，需要自己构建
- ❌ 学习曲线较陡，API 设计偏底层
- ✅ 与框架无关 (vanilla JS/TS)

### 1.4 Split.js

| 属性 | 值 |
|---|---|
| **GitHub** | [nathancahill/split](https://github.com/nathancahill/split) |
| **Stars** | 6.3k |
| **License** | MIT |
| **最新版本** | v1.6.5 (2022) |
| **活跃度** | ⭐⭐ 低维护，最后提交 2023-07 |
| **核心思路** | 零依赖、1-2KB 的纯分屏视图工具。只负责分屏拖动调整大小，不处理标签页管理。 |

**注意**: 这不是完整的标签页管理方案，仅可作为分屏布局的基础组件。

### 1.5 OS.js (Web Desktop Platform)

| 属性 | 值 |
|---|---|
| **GitHub** | [os-js/OS.js](https://github.com/os-js/OS.js) |
| **Stars** | 7.1k |
| **License** | BSD-2-Clause |
| **最新版本** | 3.1.12 (2021-07) |
| **活跃度** | ⭐ 低 (2022 年最后提交) |
| **核心思路** | 完整的 Web 桌面平台，带有窗口管理器、应用 API、GUI 工具包等。 |

**评价**: 太重了。不适合给 md-editor 做套壳。4 年未更新。

---

## 2. 推荐方案及理由

### 🥇 首选推荐: Dockview (强烈推荐)

**适用性评分**: 9.5/10

**理由**:
1. **最活跃**: 昨天刚发布 v6.2.2，几乎每天都有 commit
2. **零依赖**: 核心包 `dockview-core` 无外部依赖
3. **框架灵活**: 可无框架使用 (vanilla TS)，也可 React/Vue/Angular
4. **功能全覆盖**:
   - 标签页拖拽重排序 ✅
   - 分屏布局 (拖拽到区域形成 split/grid) ✅
   - Shadow DOM 支持 → 可与 iframe 方案结合 ✅
   - 序列化/反序列化 ✅
5. **MIT 许可**: 无商业使用限制
6. **Shadow DOM 支持**: 可以直接用 Shadow DOM 做组件隔离，无需 iframe

**适用场景**: md-editor 的多标签页外壳 + Vditor 实例做标签内容

### 🥈 备选推荐: Dockview + iframe Sandbox

**适用性评分**: 9/10

**场景**: 如果要求**严格 DOM/JS 上下文隔离**（不同标签页的 Vditor 实例不能共享 global state、不能互相访问 DOM），则需要在 Dockview 面板中嵌套 iframe。

**理由**: Dockview 支持任意 HTML 内容作为面板组件，在组件内嵌入 iframe
- iframe 的 `sandbox` 属性提供额外安全层
- 父页面可通过 `postMessage` 与子 iframe 通信
- 各 Vditor 实例在独立上下文中运行

### 🥉 轻量自建方案: Custom Tab Bar + iframe + Split.js

**适用性评分**: 7/10

**场景**: 不需要完整的 dock 功能，只需简单的标签页 + 分屏。

**理由**:
- 自建标签栏 (HTML/CSS/JS) → 极致轻量
- iframe 做 DOM 隔离 → 使用 iframe 的 `sandbox` 和 `srcdoc`
- Split.js 做分屏拖动调整大小 → 仅 1-2KB
- 灵活度最高，但需要自己处理所有状态管理

---

## 3. iframe + sandbox 隔离方案技术细节

### 3.1 为什么用 iframe 做隔离

Vditor Markdown 编辑器在全局 DOM 中渲染。当打开多个标签页时：

| 问题 | iframe 解决方案 |
|---|---|
| 不同标签页的 DOM ID 冲突 | iframe 各自独立的 document |
| 全局样式污染 | iframe 内样式不影响外部 |
| JS 全局变量冲突 (window, document) | iframe 独立的 JS 上下文 |
| Vditor 实例冲突 | 每个 iframe 有自己的实例 |
| CSS 命名空间碰撞 | iframe 隔离样式作用域 |

### 3.2 iframe sandbox 属性

```html
<iframe
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
  src="./vditor-shell.html?id=tab_1"
></iframe>
```

**可选 sandbox 标志**:

| 标志 | 作用 |
|---|---|
| `allow-scripts` | 允许执行脚本 (Vditor JS 必需) |
| `allow-same-origin` | 允许访问父页面同源资源 (按需，也可用 postMessage) |
| `allow-forms` | 允许表单提交 |
| `allow-popups` | 允许弹出窗口 |
| (省略 `allow-top-navigation`) | 禁止 iframe 导航父页面 |
| (省略 `allow-popups-to-escape-sandbox`) | 限制弹出窗口 |

**安全推荐**: 最低权限原则
```html
<iframe
  sandbox="allow-scripts"
  src="./vditor-shell.html?id=tab_1"
></iframe>
```
如果 Vditor 需要加载同源资源（主题 CSS 等），加 `allow-same-origin`。

### 3.3 跨域通信 (postMessage)

```javascript
// 父页面 → iframe 通信
document.getElementById('iframe-1').contentWindow.postMessage({
  type: 'initVditor',
  content: '# 这是 Markdown 内容'
}, '*');

// iframe → 父页面 通信
window.parent.postMessage({
  type: 'vditorContentChanged',
  tabId: 'tab-1',
  content: '新的 Markdown 内容'
}, '*');

// 父页面监听
window.addEventListener('message', (event) => {
  if (event.data.type === 'vditorContentChanged') {
    // 保存内容变更
  }
});
```

### 3.4 iframe 内 Vditor 初始化

```html
<!-- vditor-shell.html -->
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/vditor/dist/index.css" />
</head>
<body>
  <div id="editor"></div>
  <script src="https://cdn.jsdelivr.net/npm/vditor/dist/index.min.js"></script>
  <script>
    const params = new URLSearchParams(location.search);
    const tabId = params.get('id');
    
    const vditor = new Vditor('editor', {
      mode: 'ir',
      cache: { enable: false },
      after: () => {
        // 通知父页面已就绪
        window.parent.postMessage({
          type: 'vditorReady',
          tabId
        }, '*');
      },
      input: (value) => {
        window.parent.postMessage({
          type: 'vditorContentChanged',
          tabId,
          content: value
        }, '*');
      }
    });

    // 监听来自父页面的消息
    window.addEventListener('message', (event) => {
      if (event.data.type === 'setContent') {
        vditor.setValue(event.data.content);
      }
    });
  </script>
</body>
</html>
```

### 3.5 Shadow DOM 替代方案 (不需要 iframe)

Dockview 本身支持 Shadow DOM。如果你的目标环境中不需要**严格**的 JS 上下文隔离（只是 CSS/样式隔离），可以用 Shadow DOM 替代 iframe：

```javascript
// 在每个 Dockview 面板中用 Shadow DOM 挂载 Vditor
const host = document.createElement('div');
const shadow = host.attachShadow({ mode: 'open' });

// 在 Shadow DOM 中加载 Vditor 的 CSS
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = 'https://cdn.jsdelivr.net/npm/vditor/dist/index.css';
shadow.appendChild(link);

// 创建编辑器容器
const container = document.createElement('div');
shadow.appendChild(container);

// 在 Shadow DOM 中初始化 Vditor
new Vditor(container, { /* 配置 */ });
```

**Shadow DOM vs iframe 对比**:

| 特性 | Shadow DOM | iframe |
|---|---|---|
| CSS 隔离 | ✅ 完全隔离 | ✅ 完全隔离 |
| JS 上下文隔离 | ❌ 共享同一个 window | ✅ 完全独立 |
| 全局变量冲突 | ❌ 可能冲突 | ✅ 不冲突 |
| DOM 结构隔离 | ✅ 隔离 | ✅ 隔离 |
| 通信开销 | 零 | postMessage 异步 |
| 文件加载 | 继承父页面 | 需要 iframe 自己加载 |
| Vditor 兼容性 | 依赖 Vditor 的 Shadow DOM 支持 | 任何版本都兼容 |

---

## 4. 拖拽标签页 + 分屏布局的可实现路径

### 路径 A: Dockview (推荐，开箱即用)

Dockview 内置完整的拖拽 + 分屏功能：

```javascript
// 用户拖拽标签到编辑器区域的不同位置
// Dockview 自动处理创建 split/grid 布局
// 无需额外代码

// 用户拖拽标签到另一个标签页 → 合并到同一个组
// 用户拖拽标签到面板的边缘 → 创建 split 视图
// 用户拖拽标签到面板中央 → 形成 tab group
// 用户拖拽标签到浮动区域 → 浮动面板

// 所有拖拽操作通过以下 API 事件监听
dockviewInstance.onDidDragStart(() => {});
dockviewInstance.onDidDragEnd(() => {});
dockviewInstance.onDidDrop(() => {});
```

**Dockview 拖拽布局示例**:

```
┌─────────────────────────────────────┐
│ [Tab 1] [Tab 2]  [Tab 3]  [+ add]  │ ← 标签栏 (可拖拽重排序)
├──────────────┬──────────────────────┤
│              │                      │
│  Vditor #1   │    Vditor #2         │ ← 拖拽标签到此形成分屏
│              │                      │
├──────────────┴──────────────────────┤
│              │                      │
│  Vditor #3   │    Vditor #4         │ ← 拖拽标签到面板底部再拖到右侧
│              │                      │
└──────────────┴──────────────────────┘
```

### 路径 B: Golden Layout (次选)

与 Dockview 类似，Golden Layout 也内置了完整拖拽和分屏：

```javascript
const config = {
  content: [{
    type: 'row',
    content: [{
      type: 'component',
      componentName: 'vditor',
      title: '文档 1',
      // isClosable: true
    }, {
      type: 'column',
      content: [{
        type: 'component',
        componentName: 'vditor',
        title: '文档 2'
      }]
    }]
  }]
};
```

**Golden Layout 的分屏路径**:
- 拖拽标签到面板中间 → 当前标签替换
- 拖拽标签到面板边缘 → 创建 row/column 布局
- 拖出标签 → 创建弹出窗口

### 路径 C: 纯自建 (最高灵活性，但开发量大)

```
┌──────────────────────────────────────┐
│ Tab Bar (自定义实现)                  │
│ [📄 文档1] [📄 文档2] [📄 文档3] [+]
│  ← 使用 HTML5 Drag & Drop API 实现    │
├──────────────────────────────────────┤
│                                      │
│  Content Area                        │
│  ┌──────┬───────┬─────────────┐     │
│  │iframe│       │    iframe    │     │
│  │#1    │split  │    #3        │     │
│  │      │bar    │              │     │
│  ├──────┤       ├─────────────┤     │
│  │iframe│       │    iframe    │     │
│  │#2    │       │    #4        │     │
│  └──────┴───────┴─────────────┘     │
│                                      │
└──────────────────────────────────────┘
```

**分屏布局实现方案**:

| 方法 | 说明 | 复杂度 |
|---|---|---|
| HTML5 Drag & Drop | 原生拖拽 API，检测拖放区域 | 中等 |
| CSS Grid + Split.js | 用 CSS grid 分区域，Split.js 做拖动条 | 中等 |
| flexbox + resizable | flex 布局 + 自定义拖动条 | 较低 |
| 自建 React/Vue 组件 | 封装拖拽状态管理 | 高 |

**实现要点**:
1. 标签拖拽排序: HTML5 Drag & Drop API + 状态管理
2. 分屏区域划分: flexbox/grid + 拖拽检测到 drop zone
3. 分屏大小调整: Split.js 或 CSS resize
4. iframe 管理: 维护 iframe ID → 内容映射表

---

## 5. 纯静态站点兼容性评估

### Cloudflare Pages 部署兼容性

| 方案 | 兼容性 | 说明 |
|---|---|---|
| **Dockview** | ✅ 完全兼容 | 纯前端库，无服务端依赖。构建为静态 JS/CSS。 |
| **Golden Layout** | ✅ 完全兼容 | 同上，纯前端库 |
| **Lumino** | ✅ 完全兼容 | 纯前端库 |
| **iframe 嵌套** | ✅ 完全兼容 | iframe 是浏览器原生功能 |
| **Split.js** | ✅ 完全兼容 | 1-2KB 纯前端 |

### 关键兼容性因素

| 因素 | 影响 | 方案 |
|---|---|---|
| **SPA 路由** | Cloudflare Pages 默认不支持 SPA 路由 | 使用 `_redirects` 文件: `/* /index.html 200` |
| **iframe 路径** | iframe 的 src 需要可访问 | 将 `vditor-shell.html` 放在同站点路径下 |
| **CDN 资源** | Vditor CSS/JS 引用 | 使用 CDN (jsdelivr/unpkg) 或 Cloudflare Pages 托管 |
| **postMessage** | 同源/跨域通信 | 同源部署无跨域问题 |
| **localStorage** | 布局状态持久化 | 纯前端操作，无限制 |
| **Web Workers** | 如 Vditor 使用 Worker | 限制与公开站点相同 |

### 构建注意事项

```yaml
# wrangler.toml (Cloudflare Pages)
[build]
command = "npm run build"
output_dir = "dist"

[env.production]
routes = [{ pattern = "/*", script = null }]
```

```yaml
# _redirects (Cloudflare Pages)
/* /index.html 200
```

```yaml
# _headers (Cloudflare Pages)
/*
  X-Frame-Options: SAMEORIGIN
  Content-Security-Policy: frame-src 'self' https://cdn.jsdelivr.net;
```

---

## 6. 方案对比表

### 完整方案对比

| 维度 | Dockview | Golden Layout | Lumino | 自建 (iframe + Split.js) |
|---|---|---|---|---|
| **隔离性** | Shadow DOM (CSS隔离) | Shadow DOM | DOC/CSS隔离 | iframe (完整隔离) |
| **JS上下文隔离** | ❌ 需自行嵌套 iframe | ❌ 需自行嵌套 iframe | ❌ 需自行嵌套 iframe | ✅ 原生隔离 |
| **实现复杂度** | ⭐ 低 | ⭐⭐ 低-中 | ⭐⭐⭐ 中-高 | ⭐⭐⭐⭐ 高 |
| **体积 (gzip)** | ~50KB (dockview-core) | ~100KB | ~200KB+ (全家桶) | ~2KB (Split.js) + 自建 |
| **维护性** | ✅ 极其活跃 | ⚠️ 低维护 | ✅ 活跃 | ⚠️ 自行维护 |
| **拖拽标签重排序** | ✅ 原生支持 | ✅ 原生支持 | ✅ 原生支持 | ⚠️ 自建 |
| **分屏布局** | ✅ split/grid/dock | ✅ row/column | ✅ SplitPanel | ⚠️ 需 Split.js |
| **浮动面板** | ✅ 原生 | ✅ 原生 | ❌ | ❌ |
| **序列化** | ✅ toJSON/fromJSON | ✅ load/save | ✅ 自定义 | ❌ 自建 |
| **文档质量** | ⭐⭐⭐⭐⭐ 优秀 | ⭐⭐⭐ 一般 | ⭐⭐⭐⭐ 好 | N/A |
| **框架绑定** | 可选 (vanilla/React/Vue/Angular) | 可选 (vanilla/React/Vue/Angular) | 无框架绑定 | 无 |
| **Cloudflare Pages** | ✅ 完全兼容 | ✅ 完全兼容 | ✅ 完全兼容 | ✅ 完全兼容 |
| **npm 安装** | ✅ `npm i dockview-core` | ⚠️ 推荐源码构建 | ✅ `@lumino/widgets` | ✅ `npm i split.js` |

### 隔离方案对比 (iframe vs Shadow DOM)

| 维度 | iframe | Shadow DOM |
|---|---|---|
| CSS 隔离 | ✅ 完全 | ✅ 完全 |
| JS 上下文 | ✅ 完全独立 | ❌ 共享 window |
| 通信方式 | postMessage (异步) | 直接函数调用 |
| 加载延迟 | 需加载独立页面 | 即时 |
| Vditor 兼容 | 所有版本 | 依赖 Shadow DOM 支持 |
| 开发者体验 | 需要维护 iframe 页面 | 统一代码库 |

---

## 7. 关键代码/配置示例片段

### 7.1 Dockview + iframe 完整示例

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/dockview/dist/styles/dockview.css" />
</head>
<body>
  <div id="app" style="width:100vw;height:100vh;"></div>
  
  <script type="module">
    import { DockviewComponent } from 'https://cdn.jsdelivr.net/npm/dockview-core/+esm';
    
    const app = document.getElementById('app');
    
    // 方式1: 直接使用 iframe 组件 (推荐用于严格隔离)
    const dockview = new DockviewComponent(app, {
      className: 'dockview-theme-dark',
      components: {
        'vditor-tab': (params) => {
          const iframe = document.createElement('iframe');
          iframe.src = `/vditor-shell.html?id=${params.id}&content=${encodeURIComponent(params.content || '')}`;
          iframe.style.cssText = 'width:100%;height:100%;border:none;';
          iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
          return { element: iframe, onEvent: null };
        }
      }
    });
    
    // 添加标签页
    dockview.addPanel({
      id: 'tab-1',
      component: 'vditor-tab',
      params: { id: 'tab-1', title: '文档 1', content: '# Hello World' },
      title: '文档 1'
    });
    
    dockview.addPanel({
      id: 'tab-2',
      component: 'vditor-tab',
      params: { id: 'tab-2', title: '文档 2', content: '## 第二个文档' },
      title: '文档 2',
      position: { direction: 'right', referencePanel: 'tab-1' } // 分屏！
    });
    
    // 监听内容变更 (来自 iframe 的 postMessage)
    window.addEventListener('message', (event) => {
      if (event.data.type === 'vditorContentChanged') {
        console.log(`Tab ${event.data.tabId} 内容已更新`);
        // 保存到文件/状态管理
      }
      if (event.data.type === 'vditorReady') {
        console.log(`Tab ${event.data.tabId} 已就绪`);
      }
    });
  </script>
</body>
</html>
```

### 7.2 Dockview React 示例 (含分屏操作)

```jsx
import React, { useEffect, useRef } from 'react';
import { DockviewReact } from 'dockview';
import 'dockview/dist/styles/dockview.css';

const VditorTab = React.forwardRef((props, ref) => {
  const iframeRef = useRef(null);
  
  useEffect(() => {
    // iframe 加载后发送初始化消息
    const handler = (e) => {
      if (e.data.type === 'vditorReady' && e.source === iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'init',
          content: props.api.params?.content || ''
        }, '*');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);
  
  return (
    <iframe
      ref={iframeRef}
      src="/vditor-shell.html"
      style={{ width: '100%', height: '100%', border: 'none' }}
      sandbox="allow-scripts"
      title={props.api.title}
    />
  );
});

function App() {
  const components = { default: VditorTab };
  
  const onReady = (event) => {
    event.api.addPanel({
      id: 'doc-1',
      component: 'default',
      params: { content: '# Hello\n这是我的第一个文档' },
      title: '文档 1'
    });
    event.api.addPanel({
      id: 'doc-2',
      component: 'default',
      params: { content: '## 第二个文档' },
      title: '文档 2',
      position: { direction: 'right', referencePanel: 'doc-1' }
    });
  };
  
  return (
    <DockviewReact
      className="dockview-theme-dark"
      onReady={onReady}
      components={components}
    />
  );
}
```

### 7.3 自建方案: 轻量 Tab Bar + iframe + Split.js

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    #tab-bar {
      display: flex;
      background: #2d2d2d;
      height: 36px;
      align-items: center;
      overflow-x: auto;
    }
    
    .tab {
      padding: 6px 20px;
      background: #3c3c3c;
      color: #aaa;
      cursor: pointer;
      white-space: nowrap;
      border-right: 1px solid #2d2d2d;
      user-select: none;
    }
    .tab.active { background: #1e1e1e; color: #fff; }
    .tab.dragging { opacity: 0.5; }
    
    #content-area {
      display: flex;
      width: 100%;
      height: calc(100vh - 36px);
    }
    
    .pane {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    .pane iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
    
    .split-bar {
      width: 4px;
      background: #333;
      cursor: col-resize;
      flex-shrink: 0;
    }
    .split-bar:hover { background: #007acc; }
  </style>
</head>
<body>
  <div id="tab-bar"></div>
  <div id="content-area">
    <div class="pane" id="pane-0">
      <iframe sandbox="allow-scripts" src="/vditor-shell.html?id=tab-0"></iframe>
    </div>
    <div class="split-bar" id="split-0"></div>
    <div class="pane" id="pane-1">
      <iframe sandbox="allow-scripts" src="/vditor-shell.html?id=tab-1"></iframe>
    </div>
  </div>
  
  <script>
    // === 标签页管理 ===
    let tabs = [
      { id: 'tab-0', title: '文档 1', iframe: null },
      { id: 'tab-1', title: '文档 2', iframe: null }
    ];
    let activeTab = 'tab-0';
    
    // 渲染标签栏
    function renderTabs() {
      const bar = document.getElementById('tab-bar');
      bar.innerHTML = tabs.map((tab, i) => 
        `<div class="tab ${tab.id === activeTab ? 'active' : ''}" 
             draggable="true" data-index="${i}" data-id="${tab.id}">
          ${tab.title}
        </div>`
      ).join('');
      
      // 添加标签按钮
      bar.insertAdjacentHTML('beforeend', 
        `<button id="add-tab" style="margin:0 8px;background:none;color:#aaa;border:none;cursor:pointer;">+</button>`
      );
    }
    
    // === 拖拽标签重排序 (HTML5 Drag & Drop) ===
    document.getElementById('tab-bar').addEventListener('dragstart', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      e.dataTransfer.setData('text/plain', tab.dataset.id);
      tab.classList.add('dragging');
    });
    
    document.getElementById('tab-bar').addEventListener('dragend', (e) => {
      e.target.closest('.tab')?.classList.remove('dragging');
    });
    
    document.getElementById('tab-bar').addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    
    document.getElementById('tab-bar').addEventListener('drop', (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain');
      const targetTab = e.target.closest('.tab');
      if (!targetTab || draggedId === targetTab.dataset.id) return;
      
      const draggedIdx = tabs.findIndex(t => t.id === draggedId);
      const targetIdx = tabs.findIndex(t => t.id === targetTab.dataset.id);
      const [moved] = tabs.splice(draggedIdx, 1);
      tabs.splice(targetIdx, 0, moved);
      renderTabs();
    });
    
    // === 分屏布局 (Split.js) ===
    // Split.js (1-2KB) 用于控制分割条拖动
    // npm i split.js
    // import Split from 'split.js'
    // Split(['#pane-0', '#pane-1'], { sizes: [50, 50], minSize: 200, gutterSize: 4 });
    
    renderTabs();
  </script>
  
  <!-- Split.js CDN -->
  <script src="https://cdn.jsdelivr.net/npm/split.js/dist/split.min.js"></script>
  <script>
    Split(['#pane-0', '#pane-1'], {
      sizes: [50, 50],
      minSize: [200, 200],
      gutterSize: 4,
      cursor: 'col-resize',
      gutter: (i, direction) => {
        const gutter = document.createElement('div');
        gutter.className = `split-bar split-bar-${direction}`;
        gutter.style.cssText = 'width:4px;background:#333;cursor:col-resize;flex-shrink:0;';
        gutter.addEventListener('mouseenter', () => gutter.style.background = '#007acc');
        gutter.addEventListener('mouseleave', () => gutter.style.background = '#333');
        return gutter;
      }
    });
  </script>
</body>
</html>
```

### 7.4 Cloudflare Pages 部署配置

```toml
# wrangler.toml
compatibility_date = "2026-05-14"
pages_build_output_dir = "dist"
```

```yaml
# _redirects
/* /index.html 200
/vditor-shell.html /vditor-shell.html 200
```

```yaml
# _headers
/*
  X-Frame-Options: SAMEORIGIN
  Content-Security-Policy: frame-src 'self' https://cdn.jsdelivr.net;
  Referrer-Policy: no-referrer
  Permissions-Policy: clipboard-write=(self)
```

### 7.5 布局序列化示例 (Dockview)

```javascript
// 保存布局到 localStorage
function saveLayout(dockview) {
  const state = dockview.toJSON();
  localStorage.setItem('md-editor-layout', JSON.stringify(state));
}

// 恢复布局
function loadLayout(dockview) {
  const saved = localStorage.getItem('md-editor-layout');
  if (saved) {
    dockview.fromJSON(JSON.parse(saved));
    return true;
  }
  return false;
}

// 监听布局变更自动保存
dockview.onDidLayoutChange(() => {
  saveLayout(dockview);
});
```

---

## 总结

### 推荐实施路线

```
┌──────────────────────────────────────────────────┐
│  实施步骤                                          │
│                                                    │
│  第1步: 安装 dockview-core                          │
│         npm install dockview-core                   │
│                                                    │
│  第2步: 创建 vditor-shell.html (iframe 承载页)      │
│         - 加载 Vditor JS/CSS                        │
│         - postMessage 通信                          │
│                                                    │
│  第3步: 编写主页面                                   │
│         - Dockview + iframe 面板                    │
│         - postMessage 监听                          │
│         - 布局序列化                                │
│                                                    │
│  第4步: 配置 Cloudflare Pages                       │
│         - _redirects / _headers                    │
│                                                    │
│  第5步 (可选): 文件保存、Tabs 持久化                 │
└──────────────────────────────────────────────────┘
```

### 最终推荐

| 场景 | 推荐方案 |
|---|---|
| 需要完整 DOM+JS 隔离 | **Dockview + iframe sandbox** (推荐) |
| 仅需 CSS 隔离 | **Dockview + Shadow DOM** (更轻量) |
| 极简场景 (1-2 个标签) | **自建 Tab + Split.js + iframe** |
| 需要浮动/弹出窗口 | **Dockview** (原生支持) |
| 需要布局持久化 | **Dockview** (toJSON/fromJSON) |
