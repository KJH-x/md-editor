# md-editor

基于 [Vditor](https://github.com/Vanessa219/vditor) 的独立 Markdown 编辑器网站（PWA），
多标签壳层基于 [Dockview](https://github.com/mathuo/dockview)。

## 功能

- **多标签编辑**：Dockview 标签壳层，`Ctrl+T` 新建 / `Ctrl+W` 关闭 / `Ctrl+Tab` 切换，标签布局与文档草稿持久化到 IndexedDB
- **离线可用（PWA）**：可安装到桌面；Service Worker 预缓存全部运行时资源，离线时仍可打开并继续编辑
- **命令面板 / 斜杠菜单 / 悬浮格式栏**：`Ctrl+K` 命令面板，`/` 斜杠菜单，选中文本时显示悬浮格式栏
- **查找替换**：`Ctrl+F` 查找，`Ctrl+H` 查找并替换
- **本地优先存储**：草稿保存到 IndexedDB；支持 File System Access（`showSaveFilePicker`）直接另存为本地文件
- **导出**：复制为 HTML、打印为 PDF、Web Share API 分享当前文档
- **i18n**：zh-CN / en-US / es-ES / hi-IN / ar-AR 五种语言，阿拉伯语自动启用 RTL 布局
- **可访问性**：全键盘操作，按 `?` 查看快捷键面板，配套 aria-label 与状态提示
- 默认 IR（即时渲染）模式，内置大纲、三种模式切换、深色/浅色主题
- 图片在浏览器内压缩后嵌入；`vendor/` 全部自托管并锁定版本，不依赖外部 CDN

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+S` | 保存 |
| `Ctrl+O` | 打开 Markdown 文件 |
| `Ctrl+K` | 命令面板 |
| `Ctrl+F` / `Ctrl+H` | 查找 / 查找替换 |
| `Ctrl+T` / `Ctrl+W` / `Ctrl+Tab` | 新标签 / 关闭标签 / 切换标签 |
| `?` | 快捷键帮助面板 |

## 本地验证

```bash
python test.py            # 全量校验：文件、HTML 引用、JS/CSS、i18n、PWA、ESM 语法
python test.py --serve    # 启动本地开发服务器（默认 :8777）
```

## CI

GitHub Actions（`.github/workflows/ci.yml`）在每次 push / pull request 时运行 `python test.py`，
并对全部运行时 JS 文件（含 ESM 入口 `js/shell.js`）执行 `node --check` 语法检查。

## 部署

部署到 Cloudflare Pages 或任意静态服务器，入口文件 `index.html`。
`vendor/` 的升级流程见 [VENDOR_UPDATE.md](VENDOR_UPDATE.md)。

`vendor/vditor/` 是固定版本的完整运行时（包括代码高亮、公式和图表资源），不能只复制
`index.min.js`，否则相关功能仍会在运行时请求外部资源。

## License

MIT
