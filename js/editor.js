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

  function contentAreas() {
    var areas = [];
    var editors = document.querySelectorAll('#vditor [contenteditable="true"]');
    for (var i = 0; i < editors.length; i++) areas.push(editors[i]);
    var textareas = document.querySelectorAll('#vditor .vditor-sv textarea');
    for (var j = 0; j < textareas.length; j++) areas.push(textareas[j]);
    var previews = document.querySelectorAll('#vditor .vditor-ir__preview, #vditor .vditor-sv__preview');
    for (var k = 0; k < previews.length; k++) areas.push(previews[k]);
    return areas;
  }

  function applyPageWidth(value) {
    var num = parseInt(value, 10);
    var pad = (!num || num <= 0) ? '' : Math.max(0, (window.innerWidth - num) / 2) + 'px';
    var areas = contentAreas();
    for (var i = 0; i < areas.length; i++) {
      areas[i].style.paddingLeft = pad;
      areas[i].style.paddingRight = pad;
    }
    log('width', pad ? 'Applied ' + num + 'px' : 'Reset to full width',
      { maxWidth: num, pad: pad, targets: areas.length });
  }

  function reapplyWidth() { if (pageWidth) applyPageWidth(pageWidth); }

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
      'outline', 'fullscreen',
      {
        name: 'open',
        tip: '打开 Markdown 文件',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        click: function () {
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = '.md,.markdown,.txt';
          input.addEventListener('change', function () {
            if (!input.files[0]) return;
            var file = input.files[0];
            var reader = new FileReader();
            reader.onload = function (e) {
              var hasContent = vditor.getValue().trim().length > 0;
              if (hasContent && !confirm('当前编辑区有内容，打开新文件将替换全部内容，是否继续？')) {
                return;
              }
              vditor.setValue(e.target.result);
              log('open', 'Loaded: ' + file.name);
            };
            reader.onerror = function () {
              log('error', 'Read failed: ' + file.name);
            };
            reader.readAsText(file, 'UTF-8');
          });
          input.click();
        }
      },
      {
        name: 'save',
        tip: '保存为 Markdown 文件',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
        click: function () {
          var content = vditor.getValue();
          var match = content.match(/^#\s+(.+)$/m);
          var filename = (match ? match[1].trim() : 'untitled') + '.md';
          var blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          log('save', 'Downloaded: ' + filename);
        }
      },
      {
        name: 'pagewidth',
        tip: '设置编辑区最大宽度',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h2v14H4V5zm5 0h2v14H9V5zm5 0h2v14h-2V5zm4 0h2v14h-2V5z"/></svg>',
        click: function () {
          var current = localStorage.getItem('md-pagewidth') || '';
          var val = prompt('编辑区最大宽度 (px)，0 或留空 = 铺满:', current);
          if (val !== null) {
            pageWidth = val;
            localStorage.setItem('md-pagewidth', val);
            applyPageWidth(val);
          }
        }
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
    applyPageWidth(pageWidth);
  });

  if (pageWidth) applyPageWidth(pageWidth);

  var observerTimer;
  var observer = new MutationObserver(function () {
    clearTimeout(observerTimer);
    observerTimer = setTimeout(reapplyWidth, 200);
  });
  observer.observe(document.getElementById('vditor'), { childList: true, subtree: true });

  log('init', 'Ready');
})();
