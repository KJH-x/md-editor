# Vditor 独立编辑器网站部署方案

> **目标域名**：`md.nslc.top`  
> **来源项目**：[Vanessa219/vditor](https://github.com/Vanessa219/vditor)（11K Stars）  
> **Demo 仓库**：[Vanessa219/b3log-index](https://github.com/Vanessa219/b3log-index/tree/master/src/vditor/demo)  
> **创建日期**：2026-05-13

---

## 一、项目理解

Vditor 是 B3log 开源的一款浏览器端 Markdown 编辑器，三种模式：

| 模式 | 说明 |
|------|------|
| WYSIWYG | 所见即所得（富文本编辑，不显示源码） |
| IR | 即时渲染（类 Typora：左侧 Markdown 纯文本源码 + 右侧实时渲染预览） |
| SV | 分屏预览（左侧源码编辑器 + 右侧预览面板） |

**加载方式**：

```html
<!-- CDN 加载（官方推荐） -->
<link rel="stylesheet" href="https://unpkg.com/vditor/dist/index.css" />
<script src="https://unpkg.com/vditor/dist/index.min.js"></script>

<!-- 或从 b3log.org 官方站点 -->
<script src="https://b3log.org/vditor/vditor.js"></script>
```

**Demo 资源**：官方在 `Vanessa219/b3log-index` 仓库中维护了完整的 HTML Demo，位于 `src/vditor/demo/` 目录，共 32 个 HTML 文件：

```
src/vditor/demo/
├── index.html                    ← Demo 导航页
├── markdown/                     ← 示例 Markdown 文件
├── option-mode.html              ← 三种编辑模式切换 Demo
├── option-lang.html              ← 多语言 Demo
├── option-toolbar.html           ← 自定义工具栏
├── option-icon.html              ← 自定义图标
├── option-size.html              ← 编辑器尺寸
├── option-callback.html          ← 回调事件
├── option-other.html             ← 其他选项
├── preview.html                  ← 预览模式
├── preview-render.html           ← 自定义渲染
├── preview-custom.html           ← 预览自定义
├── preview-config.html           ← 预览配置
├── advanced-cache.html           ← 缓存
├── advanced-comment.html         ← 评论
├── advanced-counter.html         ← 字数统计
├── advanced-hint.html            ← 提示
├── advanced-hljs.html            ← 代码高亮
├── advanced-markdown.html        ← Markdown 渲染
├── advanced-math.html            ← 数学公式
├── advanced-outline.html         ← 大纲
├── advanced-preview.html         ← 高级预览
├── advanced-preview-actions.html ← 预览操作栏
├── advanced-resize.html          ← 自适应尺寸
├── advanced-toolbar.html         ← 高级工具栏
├── advanced-upload.html          ← 文件上传
├── method-CRUD.html              ← CRUD 方法
├── method-get.html               ← 获取内容
├── method-other.html             ← 其他方法
├── method-theme.html             ← 主题切换
├── sweet-mobile.html             ← 移动端样式
├── sweet-two.html                ← 双编辑器
```

---

## 二、目标效果参考：ld246.com/guide/markdown

通过 DOM 分析确认该页面使用的是 **IR 模式（即时渲染）**。证据：

```
hasIr: true        ← IR 模式 DOM 元素存在
hasEditor: true    ← TEXTAREA 源码编辑器存在
hasOutline: true   ← 大纲面板存在
工具栏: WYSIWYG / IR / SV 三个模式按钮齐全
editorTag: TEXTAREA
```

页面布局细节（由 DOM 分析 + 截图观察确认）：

- **顶部工具栏**（`vditor-toolbar--pin` 固定吸顶）：
  - 表情、标题、加粗、斜体、删除线、链接、列表、有序列表、任务列表、缩进、引用、分割线、代码、行内代码、上传、表格、撤销、重做、**模式切换**（WYSIWYG/IR/SV，含快捷键 Alt+Ctrl+7/8/9）、主题、导出、大纲、全屏、帮助
- **左侧区域**：IR 模式下的 **Markdown 纯文本源码**（TEXTAREA，显示原始 Markdown 语法，非代码高亮）+ **大纲面板**（`.vditor-outline`，按标题层级生成树形目录，点击跳转）
- **右侧区域**：**即时渲染预览**——编辑源码时右侧实时更新渲染结果，标准 Vditor 渲染样式
- **整体布局**：左右分栏（源码+大纲 / 即时预览），工具栏吸顶，编辑器铺满视口高度

此效果本质是 Vditor IR 模式 + 大纲面板 + 完整工具栏的组合。对应 Demo 文件：`option-mode.html`（三种模式切换）配合 `advanced-outline.html`（大纲面板）。

**目标**：基于此效果改造成独立编辑器网站，**默认 IR 模式**，保留大纲和模式切换。

---

## 三、部署方案

### 方案 A：克隆 Demo 仓库（推荐）⭐

直接利用官方已有 Demo，稍作修改作为独立编辑器网站。

**步骤**：
1. 克隆 `Vanessa219/b3log-index` 仓库
2. 提取 `src/vditor/` 目录及 `src/css/`、`src/images/` 等依赖
3. 创建自定义 `index.html` 作为默认首页（IR 模式 + 大纲）
4. 保留 `demo/` 目录作为参考
5. vditor.js 资源指向 CDN 或本地
6. 部署到 Cloudflare Pages（`md.nslc.top`）

**目录结构**：
```
md-editor/
├── index.html                    ← 主编辑器页（IR 模式 + 大纲 + 完整工具栏）
├── demo/
│   ├── index.html                ← Demo 导航
│   ├── markdown/                 ← 示例文件
│   └── *.html                    ← 各 Demo 页
├── vditor.js                     ← 从 CDN 获取或本地存放
├── css/                          ← 样式依赖
│   └── base.css
└── images/                       ← 图片资源
```

**优点**：不重复造轮子，Demo 质量高，功能全面

### 方案 B：CDN 单页

只写一个 HTML，从 unpkg CDN 加载 Vditor，极简部署。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Markdown Editor</title>
  <link rel="stylesheet" href="https://unpkg.com/vditor/dist/index.css" />
  <style>
    body { margin: 0; }
    #vditor { height: 100vh; }
  </style>
</head>
<body>
  <div id="vditor"></div>
  <script src="https://unpkg.com/vditor/dist/index.min.js"></script>
  <script>
    new Vditor('vditor', {
      mode: 'ir',
      value: '# Markdown Editor\n\n开始写作...',
      outline: { enable: true },
      height: window.innerHeight,
      counter: { enable: true },
      toolbar: [
        'headings', 'bold', 'italic', 'strike', 'link', '|',
        'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
        'quote', 'line', 'code', 'inline-code', '|',
        'upload', 'table', 'undo', 'redo', '|',
        'edit-mode', 'outline', 'fullscreen'
      ],
      cache: { enable: false }
    });
  </script>
</body>
</html>
```

**优点**：3 分钟部署，零依赖  
**缺点**：功能单一，无 Demo 页

---

## 四、自制独立编辑器页（方案 A + B 结合）⭐推荐

### 自制首页功能

- **默认 IR 模式**（参考 ld246.com/guide/markdown），左侧 Markdown 纯文本源码 + 右侧即时渲染预览
- **大纲面板**：`outline: { enable: true }`，树形目录，点击跳转
- 工具栏三种模式切换按钮（WYSIWYG / IR / SV），快捷键 Alt+Ctrl+7/8/9
- 深色/浅色主题切换（工具栏 `content-theme` 按钮）
- 完整工具栏：表情、标题、加粗、斜体、删除线、链接、引用、列表、有序列表、任务列表、缩进、代码块、表格、上传、撤销、重做、导出、全屏
- 字数统计（`counter: { enable: true }`）
- 响应式全屏（移动端自适应）
- 支持拖拽/粘贴上传图片
- 去除 B3log/ld246 品牌 header/footer，替换为最小化品牌标识
- 预置欢迎内容作为默认文档

### Vditor 初始化代码（IR 模式 + 大纲，参照 ld246 DOM 证据）

根据 DOM 分析：TEXTAREA 源码编辑器 + IR 元素 + 大纲面板 + 完整工具栏。

```javascript
const vditor = new Vditor('vditor', {
  mode: 'ir',                   // 【确认】IR 即时渲染模式
  value: '# Markdown Editor\n\n开始写作...',
  placeholder: '开始写作...',
  height: window.innerHeight,
  cache: { enable: false },
  counter: { enable: true, max: 0 },
  outline: { enable: true },    // 左侧大纲树
  preview: {
    hljs: { enable: true, style: 'github' },
    markdown: {
      autoSpace: true,
      chinesePunct: true,
      toc: true
    }
  },
  toolbar: [
    'emoji', 'headings', 'bold', 'italic', 'strike', 'link', '|',
    'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
    'quote', 'line', 'code', 'inline-code', '|',
    'upload', 'table', '|',
    'undo', 'redo', '|',
    'edit-mode', 'content-theme', 'code-theme', 'export', '|',
    'outline', 'fullscreen', 'help'
  ],
  toolbarConfig: { hide: false, pin: true },  // 工具栏吸顶
  upload: {
    accept: 'image/*',
    max: 10 * 1024 * 1024,
    handler: null
  }
});
```

### 模式切换说明

工具栏自带的 `edit-mode` 按钮无需额外编码，会自动渲染 WYSIWYG / IR / SV 三个子选项。用户点击其中任意一个，Vditor 内部自动完成模式切换和 DOM 重建。

### vditor.js 加载路径

- 开发/测试：使用 unpkg CDN `https://unpkg.com/vditor/dist/index.min.js`
- 生产部署：将 `vditor.js` 下载到同目录，使用相对路径 `<script src="vditor.js"></script>`
- CSS 同理：`https://unpkg.com/vditor/dist/index.css`

### 嵌入方式

在 HTML 中放置一个 `<div id="vditor"></div>` 容器，Vditor 会自动将编辑器挂载到此元素。不需要 `<textarea>`。

---

## 五、域名绑定

`md.nslc.top` 需要：
1. Cloudflare DNS 添加 A 记录 → 服务器 IP（10.56.47.6）
2. Caddy 配置（参照 `files.nslc.top` 模式，SSL 由 Posh-ACME 获取）
3. 或部署到 Cloudflare Pages（自动提供 SSL）

---

## 六、方案选择

| 方案 | 工作量 | 功能完整度 | 推荐场景 |
|------|--------|-----------|----------|
| A：克隆 Demo | 中 | ⭐⭐⭐ | 要完整 Demo 参考 |
| B：CDN 单页 | 低 | ⭐ | 快速上手 |
| A+B 结合 | 中 | ⭐⭐⭐ | **推荐** — 独立编辑器 + Demo 参考 |

---

## 七、下一步

1. 确定方案（建议 A+B 结合）
2. 本地搭建测试
3. 推送到 GitHub 仓库 `KJH-x/md-editor`
4. 绑定 Cloudflare Pages → `md.nslc.top`
