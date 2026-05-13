(function () {
  'use strict';

  var DEBUG = true;

  function log(tag, msg, data) {
    if (!DEBUG) return;
    var args = ['%c[md-editor] %c' + tag + ' %c' + msg,
      'color: #4CAF50; font-weight: bold',
      'color: #2196F3',
      'color: inherit'];
    if (data !== undefined) args.push(data);
    console.log.apply(console, args);
  }

  log('init', 'Script loaded, DEBUG=' + DEBUG);

  function applyPageWidth(value) {
    var el = document.getElementById('vditor');
    if (!el) return;
    var num = parseInt(value, 10);
    if (!num || num <= 0) {
      el.style.paddingLeft = '';
      el.style.paddingRight = '';
      log('width', 'Reset to full width');
    } else {
      var padding = Math.max(0, (window.innerWidth - num) / 2);
      el.style.paddingLeft = padding + 'px';
      el.style.paddingRight = padding + 'px';
      log('width', 'Applied',
        { maxWidth: num, window: window.innerWidth, padding: Math.round(padding) });
    }
  }

  var pageWidth = localStorage.getItem('md-pagewidth') || '';

  log('init', 'Creating Vditor instance...');

  var vditor = new Vditor('vditor', {
    mode: 'ir',
    value: [
      '# md-editor',
      '',
      '基于 Vditor 的 Markdown 编辑器，支持三种编辑模式。',
      '',
      '## 快速上手',
      '',
      '- 当前为 **IR（即时渲染）模式**：左侧编辑 Markdown 源码，右侧实时预览',
      '- 通过工具栏可切换 WYSIWYG / IR / SV 模式',
      '- 支持拖拽或粘贴上传图片',
      '- 支持大纲导航、字数统计、代码高亮',
      '',
      '## 快捷键',
      '',
      '| 快捷键 | 功能 |',
      '|--------|------|',
      '| `Alt+Ctrl+7` | WYSIWYG 模式 |',
      '| `Alt+Ctrl+8` | IR 即时渲染模式 |',
      '| `Alt+Ctrl+9` | SV 分屏预览模式 |',
      '',
      '> 开始写作吧！'
    ].join('\n'),
    placeholder: '开始写作...',
    height: window.innerHeight,
    cache: { enable: true, id: 'md-editor' },
    counter: { enable: true },
    outline: { enable: true },
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
    toolbarConfig: { hide: false, pin: true },
    upload: {
      accept: 'image/*',
      max: 10 * 1024 * 1024,
      handler: function (files) {
        log('upload', 'Handler called', { count: files.length });
        var fileList = Array.prototype.slice.call(files);
        return Promise.all(fileList.map(function (file) {
          log('upload', 'Reading', { name: file.name, size: file.size, type: file.type });
          if (file.size > 10 * 1024 * 1024) {
            log('error', 'File too large: ' + file.name);
            return Promise.reject(new Error('文件过大: ' + file.name));
          }
          return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function (e) {
              log('upload', 'Done: ' + file.name, { resultLength: e.target.result.length });
              resolve(e.target.result);
            };
            reader.onerror = function () {
              log('error', 'Read failed: ' + file.name);
              reject(new Error('读取失败: ' + file.name));
            };
            reader.readAsDataURL(file);
          });
        })).then(function (urls) {
          log('upload', 'Completed', { count: urls.length });
          return urls.length === 1 ? urls[0] : urls;
        }).catch(function (err) {
          log('error', 'Upload failed', { message: err.message });
          return '';
        });
      }
    }
  });

  log('init', 'Vditor initialized',
    { mode: vditor.getCurrentMode(), windowHeight: window.innerHeight });

  var cached = localStorage.getItem('md-editor');
  log('cache', 'localStorage status',
    { hasCached: !!cached, size: cached ? cached.length : 0 });

  window.addEventListener('resize', function () {
    vditor.resize({ height: window.innerHeight });
    applyPageWidth(pageWidth);
  });

  log('init', 'Event listeners registered');

  window.__vditor = vditor;
  window.__applyPageWidth = function (value) {
    pageWidth = value;
    localStorage.setItem('md-pagewidth', value);
    applyPageWidth(value);
  };

  if (pageWidth) applyPageWidth(pageWidth);
})();
