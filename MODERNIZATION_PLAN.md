# md-editor 现代化改造计划

> **状态**: 计划文档（尚未修改任何代码）
> **日期**: 2026-08-09
> **范围**: 功能 / 交互 / 视觉 / 国际化 / PWA / 多标签 Shell
> **用户已确认决策**:
> 1. 多标签 Shell — 要，写入实施骨架与细节
> 2. 云同步（WebDAV/Gist）— 暂不做
> 3. PWA / 离线 — 要
> 4. 多语言 — 增加 Top5 常用语言（按使用人口）
> 5. Phase 2 三大件（命令面板 / 斜杠菜单 / 浮动格式条）— 全部要做

---

## 0. 现状基线（已完成的第一轮现代化）

- Vditor 3.11.2 自托管（`vendor/vditor/`，529 文件 / 约 21MB），零 CDN
- IR / WYSIWYG / SV 三模式、大纲（左）、主题切换、页宽、图片压缩内嵌、IndexedDB 单草稿
- 顶部功能栏已修复（通栏、现代化样式）、深色模式、图标 sprite CSP 预加载已修复
- 生产部署: Cloudflare Pages `md.nslc.top`，严格 CSP `script-src 'self'`

---

## 1. 已知 Bug 修复（Phase 0，先行）

| # | Bug | 位置 | 修复 |
|---|---|---|---|
| B0-1 | **重复 theme 按钮**：`'theme'` 字符串无定义 → 空按钮、点击抛异常 | `js/editor.js:346` | 删除字符串 `'theme'`，保留自定义按钮对象（`:413`） |
| B0-2 | `chinesePunct: true` 是 3.11.2 无效选项（no-op） | `js/editor.js:335` | 删除（`autoSpace` 已覆盖 CJK 空格） |
| B0-3 | Vditor `info` 对话框内嵌 `unpkg.com` 图片，被 `img-src 'self'` 拦截 | vendor `index.js:13452` | 不启用 `info`；或换本地 logo |
| B0-4 | `databasePromise` 首次失败永久毒化，后续保存全部失败 | `js/editor.js` `openDatabase` | 失败时清空 promise 允许重试 |
| B0-5 | `test.py` Node 缺失时 `FileNotFoundError`；端口不复用；绑定所有网卡 | `test.py:182,219` | try/except + `allow_reuse_address` + 绑定 `127.0.0.1` |

---

## 2. 功能层（Functionality）

### F1 编辑能力

| # | 功能 | 实现要点 | 优先级/工作量 |
|---|---|---|---|
| F1-1 | Tab 缩进 | 配置 `tab: '\t'`（Shift+Tab 原生反缩进） | P1 / S |
| F1-2 | 打字机模式 | `typewriterMode: true`（可做工具栏开关，配合 CSS 变量） | P1 / S |
| F1-3 | 数学增强 | `preview.math = { engine: 'KaTeX', inlineDigit: true, macros: {} }`；**不启用 MathJax**（addScriptSync 内联脚本被 CSP 阻止） | P1 / S |
| F1-4 | 图表插入模板 | 工具栏"插入图表"子菜单：mermaid / echarts / mindmap / markmap / flowchart / graphviz / plantuml / abc / smiles —— 引擎均已内置、懒加载，只需自定义按钮 `insertValue('```mermaid\n...\n```', true)` 插入模板 | P1 / M |
| F1-5 | 提示块 / Callouts | GitHub alerts `> [!note|tip|warning|danger]` 样式化：CSS 处理 blockquote 首行 + 可选 `preview.transform` 增强 | P1 / S |
| F1-6 | 工具栏补齐 | 加 `insert-before`(⇧⌘B) / `insert-after`(⇧⌘E) / `both` / `preview` / `devtools`（Lute AST，echarts 已内置）；用 `br` 分组 | P2 / S |
| F1-7 | 查找替换 | 自定义 find/replace 面板（Ctrl+F/Ctrl+H），基于 `vditor.getSelection()` + 选区替换 | P2 / M |
| F1-8 | 图片插入设置 | 压缩尺寸/质量档位可配置；逐张失败隔离（改造 `Promise.all` 为逐张）；GIF/SVG 明确提示；`accept` 补 `image/gif,image/svg+xml` 或文档化 | P2 / M |

### F2 文档与草稿（多标签 Shell 的基石）

| # | 功能 | 实现要点 | 优先级/工作量 |
|---|---|---|---|
| F2-1 | IndexedDB v2 多文档 | 迁移为 `docs` store（多记录）+ `meta` store；记录 `{id,title,markdown,updatedAt}`；版本化 `onupgradeneeded` 迁移 | **P1 / M** |
| F2-2 | 草稿备份/恢复 | 全部文档导出 JSON（下载）+ 恢复入口；`navigator.storage.persist()` 被拒时提示导出 | P1 / S |
| F2-3 | 版本快照 | 定时（如每 5 分钟）或手动快照到 IndexedDB，历史抽屉恢复前 N 版 | P2 / M |
| F2-4 | 文件名规范化 | Windows 保留名（CON/PRN/NUL/COM1-9/LPT1-9）、尾点空格、>255 字符 | P1 / S |
| F2-5 | GBK 检测 | 打开时编码探测（UTF-8 BOM/合法性 → UTF-16 → GBK/GB2312 尝试），失败回退 UTF-8 | P2 / M |
| F2-6 | File System Access | `showOpenFilePicker/showSaveFilePicker` + `createWritable` 真"保存回原文件"；句柄存 IDB 下次自动重连；`'showOpenFilePicker' in window` 特性检测，Firefox/Safari 回退现有 `<input>`+下载 | **P1 / M** |

### F3 导出与分享

- **复制为 HTML/富文本**: `navigator.clipboard.write` + `ClipboardItem{text/html, text/plain}`（Vditor preview DOM 序列化）；`execCommand` 回退
- **PDF 优化**: 打印样式表 + 解决导出 iframe 固定 800px / 3600ms 延迟
- **Web Share**: `navigator.share`（`canShare` 保护，`.md` 不支持则 `.txt`/文本）

### F4 保存 / 未保存状态

- 保存状态增强: 已保存● / 未保存○ / 保存中⟳ / 错误✖ + 最后保存时间
- `Ctrl+S` 触发保存（下载 / FSA 写回 / 草稿即时落库）

---

## 3. 交互层（Interaction / UX）

### I1 键盘优先

| # | 功能 | 实现要点 | 优先级/工作量 |
|---|---|---|---|
| I1-1 | Ctrl+S / Ctrl+O / Ctrl+Shift+S | 顶层 `keydown` 捕获（content 与 shell 两层），阻止浏览器默认"保存页面" | **P1 / S** |
| I1-2 | Ctrl+Enter 保存 / Ctrl+W 关标签 | 配置 `ctrlEnter` 回调 + shell 快捷键 | P1 / S |
| I1-3 | 快捷键总览（`?`） | 覆盖层列出全部快捷键，含 kbd 徽章 | P1 / S |
| I1-4 | tooltip kbd 徽章 | 自定义按钮 tooltip 显示快捷键 | P2 / S |

### I2 现代化组件（三大件全做）

| # | 组件 | 实现要点 | 优先级/工作量 |
|---|---|---|---|
| I2-1 | **命令面板**（Ctrl+K） | 模糊搜索全部动作（格式/模式/插入/导出/主题/文档/设置）；键盘上下+Enter，Esc 关闭；动作清单从统一注册表生成 | **P1 / L** |
| I2-2 | **斜杠菜单**（`/`） | 光标处弹出：标题/表格/代码块/公式/Mermaid/提示块/引用/分割线/任务列表/图片；类型过滤 + 键盘导航；基于 `hint.extend` 或自定义实现 | **P1 / M** |
| I2-3 | **浮动格式条** | 选中文本上方浮动：加粗/斜体/删除线/行内代码/链接/高亮/引用；空选区隐藏；Esc/失焦关闭 | **P1 / M** |
| I2-4 | **状态栏** | 底部一条：字数/字符/阅读时长、保存态色点、当前模式、语言、主题、面板快捷键提示 | P1 / S |
| I2-5 | **主题化对话框** | 替换原生 `confirm/prompt`（打开覆盖确认、页宽输入含校验）为轻量组件 | P1 / M |

### I3 多标签 / 多窗口

- **BroadcastChannel**（`md-editor-docs`）：多标签检测、冲突提示、last-write-wins 或覆盖确认
- **Web Locks**（`navigator.locks.request('md-editor-draft')`）：IndexedDB 写串行化
- `visibilitychange` / `pagehide` / `beforeunload`：后台标签立即落库；仅"有未保存编辑"时拦截关闭

### I4 移动端

- `100dvh` + `safe-area-inset`（iOS 地址栏）
- 工具栏折叠为 `+` 溢出菜单；大纲抽屉
- 触控目标 ≥44px

---

## 4. 视觉层（Visual）

| # | 项 | 内容 | 优先级/工作量 |
|---|---|---|---|
| V1 | 设计令牌 | `--bg/--bg-side/--fg/--fg-muted/--border/--accent/--selection/--danger/--success` 明暗双套，统一到 `:root[data-theme]` | P1 / S |
| V2 | 排版 | CJK 字体栈（PingFang SC/YaHei/Noto Sans CJK SC）、正文 16-18px、行高 1.7+、阅读列 720-800px | P1 / S |
| V3 | 工具栏 | 图标分组 + 圆角悬浮 + 分隔线；修复 641-1150px 溢出（中宽滚动） | P1 / S |
| V4 | 大纲面板 | scroll-spy、缩进层级、激活项 accent 左条、可折叠 | P2 / M |
| V5 | 空状态/加载骨架 | 空文档引导卡（模板 + 快捷键提示）、保存态色点、toast | P1 / S |
| V6 | 主题统一 | `data-theme` 单一数据源 ↔ 内容主题/代码主题双向同步（修复三套不同步） | **P1 / M** |
| V7 | 动效 | 150ms 过渡 + `prefers-reduced-motion` 降级；Firefox `scrollbar-width/color` | P2 / S |
| V8 | 图标体系 | 统一 16px、stroke 风格一致（Vditor 自带 + 自定义按钮 SVG 已统一） | P2 / S |

---

## 5. 国际化（i18n）— Top5 常用语言

> "按文字"按使用人口排序。Top5: **English、简体中文（现有）、Español、हिन्दी (Hindi)、العربية (Arabic)**。
> 说明：Vditor 已内置 12 语言包（en_US/es_ES/fr_FR/ja_JP/ko_KR/de_DE/pt_BR/ru_RU/sv_SE/vi_VN/zh_CN/zh_TW），en/es 可直接用 `lang`；**hi / ar 需自定义 i18n 对象**（`preview.i18n` 支持对象）。法语/葡语/俄语等可随后一行启用。

### 5.1 架构

```
js/i18n/
  zh-CN.js   # 默认（现有文案迁移）
  en-US.js
  es-ES.js
  hi-IN.js
  ar-AR.js
js/i18n/index.js   # 语言字典注册表 + t() 函数
```

- 应用外壳文案（品牌/状态/对话框/菜单/欢迎文档/快捷键提示）全部走 `t('key')` 字典
- Vditor 内部文案: 用 `lang`（en_US/es_ES）或自定义 `i18n` 对象（hi/ar）
- 切换入口: 状态栏语言选择 + 命令面板；持久化 `localStorage['md-lang']`
- **RTL**: 阿拉伯语需 `dir="rtl"`（`html[lang=ar]`），Vditor 支持 `setDirection`/`direction` 配置，外壳 CSS 需镜像处理

### 5.2 实施清单

| # | 项 | 说明 | 优先级/工作量 |
|---|---|---|---|
| I18N-1 | 文案抽离 | 现有硬编码中文（品牌、状态、对话框、欢迎文档）抽到字典 | **P1 / M** |
| I18N-2 | 语言切换 | 状态栏选择 + 持久化 + 刷新编辑器语言（`lang` 需重建或 `updateToolbarConfig` 支持项内） | P1 / M |
| I18N-3 | hi/ar 自定义 i18n | 编写 `i18n` 对象映射 Vditor 内置字符串 | P2 / M |
| I18N-4 | RTL 适配 | `dir=rtl` + CSS 镜像 | P2 / M |
| I18N-5 | 默认语言 | 首访检测 `navigator.language`（zh → zh-CN，其余 → en-US） | P1 / S |

---

## 6. 平台层（Platform / PWA / 离线）

### 6.1 PWA

| # | 项 | 说明 | 优先级/工作量 |
|---|---|---|---|
| PWA-1 | `manifest.webmanifest` | name/short_name/start_url/display=standalone/theme_color/background_color/icons(192+512+maskable，从 `vendor/vditor/dist/images/logo.png` 生成) + `<link rel="manifest">` | **P1 / S** |
| PWA-2 | 图标生成 | 512 / 192 / maskable（≥20% 安全区）三份 | P1 / S |
| PWA-3 | Service Worker | 分层缓存（见 6.2）；`skipWaiting + clients.claim`；`controllerchange` → "刷新以更新" toast（**草稿脏时不自动刷新**）；离线导航回退 `/index.html` | **P1 / M** |
| PWA-4 | `beforeinstallprompt` | 应用内"安装应用"按钮（iOS 提示"添加到主屏幕"） | P2 / S |
| PWA-5 | `navigator.storage.persist()` | 请求持久存储 + 配额提示 + 导出兜底 | P1 / S |

### 6.2 Service Worker 分层缓存策略

- **预缓存（install，约 25 文件 / ~5.4MB raw / ~1.6MB brotli）**: `index.html`、`css/style.css`、`js/editor.js`、`js/shell.js`、`js/tab-store.js`、`vditor-shell.html`、`manifest.webmanifest`、`vendor/vditor/dist/index.css`、`index.min.js`、`js/icons/ant.js`、`js/lute/lute.min.js`（IR 必用，3.9MB）、`highlight.min.js`、`third-languages.js`、`styles/github.min.css`、`i18n/zh_CN.js`
- **运行时缓存（stale-while-revalidate / cache-first，不预缓存）**: 其余 `/vendor/**`（mermaid/echarts/graphviz/mathjax/katex/markmap/... 约 13MB，按需触发后永久缓存）
- **版本化缓存名** `md-shell-v<VER>` / `md-runtime-v<VER>`，`activate` 清旧
- **`sw.js` 必须 `Cache-Control: no-cache`**（`_headers`）
- 版本来源：无构建步骤 → `sw.js` 内版本常量手工 bump，或最小构建脚本用 `CF_PAGES_COMMIT_SHA` 生成

### 6.3 `_headers` / CSP 加固

```
/*  (合并后)
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; frame-src 'self'; form-action 'self'; upgrade-insecure-requests
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN      # ← 从 DENY 改为 SAMEORIGIN（多标签 iframe 需要）
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), clipboard-write=(self), web-share=(self)

/js/*    Cache-Control: public, max-age=300, stale-while-revalidate=86400
/css/*   Cache-Control: public, max-age=300, stale-while-revalidate=86400
/vendor/*  Cache-Control: public, max-age=31536000, immutable
/sw.js     Cache-Control: no-cache
/manifest.webmanifest  Cache-Control: public, max-age=3600
```

- **Early Hints Link 预加载**（可选用 `_headers`）: `</vendor/vditor/dist/index.min.js>; rel=preload; as=script` 等
- **注意**: `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` 是启用 iframe Shell 的**前置条件**（当前为 `'none'`/`DENY`，会阻断）

### 6.4 云同步

- **本期不做**（用户确认）。留 `connect-src 'self'`；未来如需 WebDAV/Gist，走 Pages Function 代理 + `connect-src 'self' https:` 或 Function 内转发

---

## 7. 多标签 Shell（Phase 4 — 用户确认要，含实施骨架与细节）

### 7.1 技术选型

- **Dockview `dockview-core`**（vanilla，零依赖，MIT，活跃，内置拖拽/分屏/序列化/主题）+ **iframe + sandbox** 严格隔离
- **自托管**：`vendor/dockview/`（遵循无 CDN 政策；`dockview.css` + `index.mjs`，约 50KB gzip）
- 备选：自建 Tab Bar + Split.js（若 Dockview 体积/复杂度不可接受）—— 不推荐，重复造轮子

### 7.2 架构

```
index.html          → 外壳 Shell：Dockview 容器 + 顶栏（新建/关闭/标签栏）+ 状态栏 + 命令面板
js/shell.js         → Shell 逻辑：Dockview 初始化、标签管理、布局序列化、消息路由、快捷键
js/tab-store.js     → 文档模型（IndexedDB v2，见 F2-1）：多文档 CRUD + 快照 + 迁移
js/shell-i18n.js    → Shell 层语言字典（复用 5.1）
vditor-shell.html   → 每个标签页的 iframe 承载页：加载 vendor + js/editor.js
js/editor.js        → 重构为"标签内容逻辑"：URL 参数/postMessage 接收 tabId、初值、lang、theme；上报变更/标题/焦点
vendor/dockview/    → 自托管 Dockview
```

- **Vditor 实例**：每个 iframe 独立实例，天然 DOM/JS 上下文隔离
- **iframe sandbox**: `sandbox="allow-scripts allow-same-origin"`（Vditor 需同源加载 vendor 资源与主题；不加 `allow-top-navigation`）
- iframe `title`、`aria-label` 与标签标题同步

### 7.3 postMessage 通信协议（全部校验同源）

```js
// parent → iframe
{ type: 'init', tabId, content, title, lang, theme, pageWidth }
{ type: 'setTheme', theme }
{ type: 'setLang', lang }
{ type: 'setPageWidth', px }
{ type: 'requestSave', reason: 'unload' | 'manual' }
{ type: 'requestFocus' }

// iframe → parent
{ type: 'ready', tabId }
{ type: 'change', tabId, content, title, updatedAt }   // 输入防抖后
{ type: 'saveResult', tabId, ok, error }
{ type: 'requestOpen' }                                 // iframe 内触发文件打开
{ type: 'focus' }                                       // 点击 iframe 内部 → 激活标签
```

- 安全：`event.origin === location.origin` 且 `event.source` 属于已注册 iframe 集合；初始化消息只在 iframe `ready` 后发送
- 保存路径：iframe 内编辑防抖 → `change` → Shell 写入 IndexedDB（Web Locks 串行化）；`requestSave` 时 iframe 立即上报当前值

### 7.4 标签与布局

- Dockview `addPanel({ id, component: 'vditor-tab', params, title })`
- 拖拽重排序、拖到边缘分屏（split/grid）、浮动画板：Dockview 原生
- 布局序列化：`onDidLayoutChange` → `dockview.toJSON()` → `localStorage['md-editor-layout']`（或 IndexedDB `meta`）
- 标签 dirty 指示（`●`）：Shell 维护 `docs[id].dirty`
- 快捷键：`Ctrl+T` 新标签、`Ctrl+W` 关闭、`Ctrl+Tab` 切换、`Ctrl+S` 保存当前
- 关闭最后一个标签 → 默认新建空文档（不退出编辑态）

### 7.5 文档模型（IndexedDB v2）

```js
// 迁移: v1 drafts(单记录 current) → v2
const SCHEMA = 2;
onupgradeneeded:
  v1: createObjectStore('drafts', { keyPath: 'id' })   // 已有
  v2: createObjectStore('docs', { keyPath: 'id' })     // 新：多文档
      createObjectStore('meta')                          // 新：schemaVersion/activeTabId
      迁移 drafts['current'] → docs[{id,title,markdown,updatedAt}]
```

记录结构：`{ id: uuid, title, markdown, updatedAt, language?, pageWidth? }`

### 7.6 Shell 状态栏与命令面板（复用 I2）

- 状态栏显示：当前标签字数/阅读时长、保存态、模式、语言、文档数
- 命令面板：新建/打开/保存/切换文档/模式/主题/语言/插入图表/导出/布局重置

### 7.7 `_headers` 前置条件（与 6.3 冲突必须处理）

| 当前 | 改为 | 原因 |
|---|---|---|
| `X-Frame-Options: DENY` | `SAMEORIGIN` | iframe 内嵌 Shell 必需 |
| CSP `frame-ancestors 'none'` | `frame-ancestors 'self'` | 同上 |
| CSP 无 `frame-src` | 加 `frame-src 'self'` | 显式允许同源 iframe |
| `_redirects` catch-all | **不要加** `/* /index.html 200` | 会遮蔽 529 个 vendor 文件；现有 SPA fallback 已工作 |

### 7.8 PWA 配合

- SW 预缓存增加：`js/shell.js`、`js/tab-store.js`、`vditor-shell.html`、`vendor/dockview/*`
- 离线编辑：Shell + 每个标签的 vendor 核心已缓存即可

### 7.9 性能与风险

| 风险 | 缓解 |
|---|---|
| 每个 iframe 重复加载 Vditor 核心（index.min.js ~345KB + lute 3.9MB） | HTTP/SW 共享缓存；`<link rel=preload>`；lute 首次渲染一次性，后续标签可复用预加载 |
| 多标签共享 IndexedDB 写竞争 | `navigator.locks` + `updatedAt` 冲突策略 |
| iframe 内快捷键焦点问题 | 快捷键监听放 Shell 层，`requestFocus` 转发给活动 iframe |
| 键盘焦点陷阱 / 屏幕阅读器 | iframe 标题、标签栏 ARIA、焦点管理 |
| Dockview 主题与自定义令牌整合 | Dockview CSS 变量映射到 `--md-*` |

### 7.10 实施顺序

1. F2-1 文档模型 v2（无 Shell 也能单标签工作）
2. 生成 `vditor-shell.html` + 重构 `js/editor.js` 为可参数化标签逻辑（单标签模式默认不变）
3. 引入 `vendor/dockview` + `index.html` 外壳 + `js/shell.js`（先单标签跑通）
4. postMessage 协议 + 多文档 + 布局序列化
5. 拖拽分屏 / 标签管理 / 命令面板接入
6. `_headers` 变更 + PWA 配合 + 回归

---

## 8. 无障碍（Accessibility）

| # | 项 | 说明 | 优先级/工作量 |
|---|---|---|---|
| A11y-1 | 上传键盘可达 | Vditor 的 upload 触发器是 `<div>` → 改 `<button>` + `aria-label` + 程序化 input | **P0 / S** |
| A11y-2 | ARIA 全面化 | 面板/对话框 `role=dialog`、下拉 `aria-expanded/haspopup`、焦点陷阱 | P1 / M |
| A11y-3 | focus-visible | 恢复下拉/提示/表情面板的可见焦点环 | P1 / S |
| A11y-4 | 对比度 | `is-saving` #9a6a00(3.4:1) 等调至 AA；`aria-disabled` | P1 / S |
| A11y-5 | reduced-motion | 过渡/工具提示/模糊在 `prefers-reduced-motion` 下关闭 | P2 / S |
| A11y-6 | 编辑区 label | `aria-label` 于编辑器内容区 | P2 / S |

---

## 9. 健壮性 / 工程（Reliability / Engineering）

| # | 项 | 说明 | 优先级/工作量 |
|---|---|---|---|
| R1 | 保存竞态 | pagehide + IDB 异步写入不保证完成 → `visibilitychange` 兜底 + 失败时 localStorage 同步镜像 + `navigator.locks` | **P1 / M** |
| R2 | 多标签冲突 | BroadcastChannel 检测 + 覆盖确认（见 I3） | P1 / M |
| R3 | 大文档 | 打开尺寸上限提示、WYSIWYG 序列化优化 | P2 / M |
| R4 | vendor 缓存失效 | 无哈希路径 + `immutable` 一年 → 文档化升级流程（改 vendor 需 CF Purge）或路径加版本 | P1 / S |
| R5 | CI | GitHub Actions：`python test.py` + `node --check` | P1 / S |
| R6 | 主题单一数据源 | `data-theme` + `md-theme` 与 Vditor content/code theme 双向同步 | P1 / M |
| R7 | 欢迎文档 i18n | 默认文档随语言变化 | P2 / S |

---

## 10. 分阶段路线图

| 阶段 | 内容 | 预估工作量 |
|---|---|---|
| **Phase 0 — 快速修复** | B0-1..B0-5（重复 theme 按钮、chinesePunct、info、IDB 毒化、test.py） | 0.5 天 |
| **Phase 1 — 编辑与保存** | F1-1..3、F1-5、F1-6、F2-4、F4、I1-1/2/3、R1/R2、V1/V2/V3/V5/V6 | ~1 周 |
| **Phase 2 — 现代化核心** | I2 三大件（命令面板/斜杠菜单/浮动条）、I2-4/5、F1-4 图表菜单、F1-7 查找替换、F2-2 备份、V4 大纲、A11y-1..4、i18n 框架 + zh/en/es | 2-3 周 |
| **Phase 3 — i18n 补齐** | hi/ar 自定义 i18n、RTL、默认语言检测、全量文案 | ~1 周 |
| **Phase 4 — 多标签 Shell** | F2-1 文档模型 v2 → vditor-shell.html → Dockview 外壳 → postMessage → 布局持久化 → 分屏 | 2-3 周 |
| **Phase 5 — PWA/平台** | manifest + SW 分层缓存 + `_headers`/CSP + storage.persist + 复制为 HTML + Web Share + FSA + beforeinstallprompt | ~1 周 |
| **Phase 6 — 打磨** | 版本快照、图片管理、GBK、动效、Firefox 滚动条、CI、vendor 流程 | 持续 |

> 依赖关系：Phase 4（Shell）依赖 F2-1 文档模型；Phase 5 的 CSP 变更（`frame-ancestors 'self'`）应在 Phase 4 前或同步完成；i18n 框架应在 Phase 2 提前铺好，避免后期重构文案。

---

## 11. 冲突与风险

1. **CSP vs iframe Shell**：当前 `frame-ancestors 'none'` / `X-Frame-Options: DENY` 会完全阻断 iframe 方案 → Phase 4 必须同步改 `_headers`（6.3 / 7.7）。改后需重新验证安全（仅同源 iframe）。
2. **CSP vs MathJax**：`addScriptSync` 内联脚本被阻止 → 数学只用 KaTeX。
3. **`immutable` 一年缓存 vs 升级**：vendor 路径无哈希 → 升级需 CF Purge（文档化）。
4. **多语言 vs 单例文案**：所有硬编码中文必须抽离，否则 i18n 半途而废。
5. **多标签 vs IndexedDB 单记录**：必须先行 F2-1 文档模型 v2。
6. **PWA SW 与开发调试**：本地 dev 无 SW；生产 SW 更新流程（toast）需充分测试，避免"永远旧版"。

---

## 12. 附录：文件级改动清单（预估）

| 文件 | 动作 | 归属阶段 |
|---|---|---|
| `js/editor.js` | 改（拆 i18n、修 bug、参数化 tab 逻辑） | Phase 0-2 / 4 |
| `js/i18n/*.js` | 新增（字典 + 注册表） | Phase 2/3 |
| `js/tab-store.js` | 新增（文档模型 v2） | Phase 4 |
| `js/shell.js` | 新增（Dockview 外壳） | Phase 4 |
| `js/shell-i18n.js` | 新增（外壳语言） | Phase 4 |
| `index.html` | 改（Shell 外壳 / manifest 链接 / 预加载） | Phase 4 / 5 |
| `vditor-shell.html` | 新增（iframe 承载页） | Phase 4 |
| `css/style.css` | 改（令牌系统、i18n、RTL、Shell 样式） | 持续 |
| `vendor/dockview/` | 新增（自托管） | Phase 4 |
| `manifest.webmanifest` | 新增 | Phase 5 |
| `sw.js` | 新增 | Phase 5 |
| `icons/`（512/192/maskable） | 新增 | Phase 5 |
| `_headers` | 改（CSP/Cache/permissions） | Phase 4/5 |
| `test.py` | 改（健壮性） | Phase 0 |
| `README.md` | 改（新功能/快捷键/i18n/PWA 说明） | 持续 |
| `MODERNIZATION_PLAN.md` | 本文件 | — |

---

## 13. 下一步

1. 从 **Phase 0 + Phase 1** 开始实施（无外部依赖，纯代码修复 + 编辑体验）。
2. Phase 2 前先铺 i18n 框架与命令面板动作注册表（为三大件共用）。
3. Phase 4（Shell）单独排期，先做 F2-1 文档模型 v2 并全量回归。
4. 每阶段完成 → `python test.py` + `node --check` + Playwright（桌面/移动/明暗/CSP 模拟）+ 提交推送。
