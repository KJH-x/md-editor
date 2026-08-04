# md-editor

基于 [Vditor](https://github.com/Vanessa219/vditor) 的独立 Markdown 编辑器网站。

- 默认 **IR（即时渲染）模式**：左侧 Markdown 源码 + 右侧实时预览
- 内置大纲面板、三种模式切换、深色/浅色主题
- 打开、下载 Markdown 文件，并可导出 Markdown、PDF 或 HTML
- 图片在浏览器内压缩后嵌入，不会上传到服务器
- 草稿保存在 IndexedDB；存储失败会在页面左下角明确提示
- 完整自托管并锁定 Vditor 3.11.2，运行时不依赖第三方 CDN

## 本地验证

```bash
python test.py
python test.py --serve
```

## 部署

部署到 Cloudflare Pages 或任意静态服务器，入口文件 `index.html`。

`vendor/vditor/` 是固定版本的完整运行时（包括代码高亮、公式和图表资源），不能只复制
`index.min.js`，否则相关功能仍会在运行时请求外部资源。

## License

MIT
