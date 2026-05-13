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

  var pageWidths = [0, 1200, 900, 700];
  var pageWidthIndex = 0;
  var pageWidthLabels = ['铺满', '1200', '900', '700'];

  log('config', 'Page width presets', { pageWidths: pageWidths, index: pageWidthIndex });

  function applyPageWidth(targetWidth) {
    var el = document.getElementById('vditor');
    if (!el) {
      log('error', 'applyPageWidth: #vditor not found');
      return;
    }
    if (!targetWidth) {
      el.style.paddingLeft = '';
      el.style.paddingRight = '';
      log('width', 'Reset to full width', { windowWidth: window.innerWidth });
    } else {
      var padding = Math.max(0, (window.innerWidth - targetWidth) / 2);
      el.style.paddingLeft = padding + 'px';
      el.style.paddingRight = padding + 'px';
      log('width', 'Applied width',
        { target: targetWidth, window: window.innerWidth, padding: Math.round(padding) });
    }
  }

  function cyclePageWidth() {
    pageWidthIndex = (pageWidthIndex + 1) % pageWidths.length;
    var w = pageWidths[pageWidthIndex];
    var label = pageWidthLabels[pageWidthIndex];
    log('width', 'Cycled to ' + label,
      { index: pageWidthIndex, targetWidth: w, windowWidth: window.innerWidth });
    applyPageWidth(w);

    var btn = document.querySelector('[data-type="pagewidth"]');
    if (btn) {
      btn.title = '页面宽度: ' + label;
    } else {
      log('warn', 'cyclePageWidth: toolbar button not found');
    }
  }

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
      'outline', 'fullscreen',
      {
        name: 'pagewidth',
        tip: '页面宽度',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h2v14H4V5zm5 0h2v14H9V5zm5 0h2v14h-2V5zm4 0h2v14h-2V5z"/></svg>',
        click: function () { cyclePageWidth(); }
      },
      'help'
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
    applyPageWidth(pageWidths[pageWidthIndex]);
  });

  log('init', 'Event listeners registered');
})();
