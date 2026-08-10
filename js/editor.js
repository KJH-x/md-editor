(function () {
  'use strict';

  var DEBUG = new URLSearchParams(window.location.search).has('debug');
  var DB_NAME = 'md-editor';
  var DB_VERSION = 1;
  var DRAFT_STORE = 'drafts';
  var DRAFT_ID = 'current';
  var SAVE_DELAY = 350;
  var MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  var MAX_DATA_URL_LENGTH = 3 * 1024 * 1024;

  var saveStatus = document.getElementById('saveStatus');
  var saveStatusTimer = null;
  var databasePromise = null;
  var saveTimer = null;
  var pageWidth = safeStorageGet('md-pagewidth') || '';
  var editorReady = false;
  var userEdited = false;
  var restoringDraft = false;
  var vditor = null;
  var THEME_KEY = 'md-theme';
  var theme = safeStorageGet(THEME_KEY) ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') || 'light';
  document.documentElement.setAttribute('data-theme', theme);

  function log(tag, msg, data) {
    if (!DEBUG) return;
    var args = ['%c[md-editor] %c' + tag + ' %c' + msg,
      'color: #4CAF50; font-weight: bold',
      'color: #2196F3',
      'color: inherit'];
    if (data !== undefined) args.push(data);
    console.log.apply(console, args);
  }

  function setSaveStatus(message, isError) {
    if (!saveStatus) return;
    clearTimeout(saveStatusTimer);
    saveStatus.textContent = message;
    saveStatus.classList.toggle('is-error', !!isError);
    saveStatus.classList.toggle('is-saving', !isError && /^正在/.test(message || ''));
    if (!isError && message) {
      saveStatusTimer = setTimeout(function () {
        saveStatus.textContent = '';
        saveStatus.classList.remove('is-error', 'is-saving');
      }, 2400);
    }
  }

  function safeStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      log('storage', 'localStorage read failed', err);
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (err) {
      setSaveStatus('设置无法保存到浏览器', true);
      log('storage', 'localStorage write failed', err);
      return false;
    }
  }

  function safeStorageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (err) {
      log('storage', 'localStorage remove failed', err);
    }
  }

  var THEME_ICONS = {
    light: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    dark: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
  };

  var CONTENT_THEME_PATH = new URL('vendor/vditor/dist/css/content-theme', document.baseURI).href.replace(/\/$/, '');

  function updateThemeIcon() {
    var btn = document.querySelector('.vditor-toolbar button[data-type="theme"]');
    if (!btn) return;
    btn.innerHTML = THEME_ICONS[theme] || THEME_ICONS.light;
  }

  function applyTheme(next) {
    theme = next;
    document.documentElement.setAttribute('data-theme', theme);
    if (vditor) {
      try {
        vditor.setTheme(theme, theme === 'dark' ? 'dark' : 'light',
          theme === 'dark' ? 'github-dark' : 'github', CONTENT_THEME_PATH);
      } catch (err) {
        log('theme', 'setTheme failed', err);
      }
    }
    updateThemeIcon();
    safeStorageSet(THEME_KEY, theme);
    log('theme', 'Theme set to ' + theme);
  }

  function openDatabase() {
    if (!('indexedDB' in window)) {
      return Promise.reject(new Error('当前浏览器不支持本地草稿存储'));
    }
    if (databasePromise) return databasePromise;

    databasePromise = new Promise(function (resolve, reject) {
      var request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains(DRAFT_STORE)) {
          database.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () {
        reject(request.error || new Error('无法打开本地草稿数据库'));
      };
      request.onblocked = function () {
        reject(new Error('本地草稿数据库被其他页面占用'));
      };
    });
    return databasePromise;
  }

  function readDraft() {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var request = database.transaction(DRAFT_STORE, 'readonly')
          .objectStore(DRAFT_STORE).get(DRAFT_ID);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () {
          reject(request.error || new Error('无法读取本地草稿'));
        };
      });
    });
  }

  function writeDraft(markdown) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(DRAFT_STORE, 'readwrite');
        transaction.objectStore(DRAFT_STORE).put({
          id: DRAFT_ID,
          markdown: markdown,
          updatedAt: Date.now()
        });
        transaction.oncomplete = function () { resolve(); };
        transaction.onerror = function () {
          reject(transaction.error || new Error('无法保存本地草稿'));
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error('本地草稿保存已中止'));
        };
      });
    });
  }

  function saveDraftNow(markdown) {
    clearTimeout(saveTimer);
    saveTimer = null;
    return writeDraft(markdown).then(function () {
      setSaveStatus('草稿已保存', false);
      log('storage', 'Draft saved', { length: markdown.length });
      return true;
    }).catch(function (err) {
      setSaveStatus('草稿保存失败，请立即下载备份', true);
      log('storage', 'Draft save failed', err);
      return false;
    });
  }

  function scheduleDraftSave(markdown) {
    clearTimeout(saveTimer);
    setSaveStatus('正在保存...', false);
    saveTimer = setTimeout(function () { saveDraftNow(markdown); }, SAVE_DELAY);
  }

  function contentAreas() {
    var areas = [];
    var wrappers = document.querySelectorAll(
      '.vditor-content > .vditor-wysiwyg, .vditor-content > .vditor-sv.vditor-reset, ' +
      '.vditor-content > .vditor-ir, .vditor-content > .vditor-preview');
    for (var i = 0; i < wrappers.length; i++) areas.push(wrappers[i]);
    return areas;
  }

  function applyPageWidth(value) {
    if (value === '' || value === null || value === undefined) return;
    var num = parseInt(value, 10);
    var maxWidth = (!num || num <= 0) ? 'none' : num + 'px';
    var areas = contentAreas();
    for (var i = 0; i < areas.length; i++) {
      areas[i].style.maxWidth = maxWidth;
      areas[i].style.marginLeft = 'auto';
      areas[i].style.marginRight = 'auto';
    }
    log('width', maxWidth === 'none' ? 'Reset to full width' : 'Applied ' + num + 'px', {
      maxWidth: maxWidth,
      targets: areas.length
    });
  }

  function mutationsAddContentArea(mutations) {
    var selector = '[contenteditable="true"], .vditor-sv textarea, .vditor-ir__preview, .vditor-sv__preview';
    for (var i = 0; i < mutations.length; i++) {
      for (var j = 0; j < mutations[i].addedNodes.length; j++) {
        var node = mutations[i].addedNodes[j];
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches(selector) || node.querySelector(selector)) return true;
      }
    }
    return false;
  }

  function readImage(file) {
    return new Promise(function (resolve, reject) {
      var objectUrl = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('无法读取图片：' + file.name));
      };
      image.src = objectUrl;
    });
  }

  function renderCompressedImage(image, maxWidth, quality) {
    var scale = Math.min(1, maxWidth / image.naturalWidth, 12000 / image.naturalHeight);
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    var context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法压缩图片');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', quality);
  }

  function prepareImage(file) {
    if (!file.type || file.type.indexOf('image/') !== 0) {
      return Promise.reject(new Error('仅支持图片文件'));
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return Promise.reject(new Error('图片不能超过 10 MB：' + file.name));
    }

    return readImage(file).then(function (image) {
      var attempts = [[1600, 0.82], [1280, 0.72], [960, 0.62]];
      var dataUrl = '';
      for (var i = 0; i < attempts.length; i++) {
        dataUrl = renderCompressedImage(image, attempts[i][0], attempts[i][1]);
        if (dataUrl.length <= MAX_DATA_URL_LENGTH) return dataUrl;
      }
      throw new Error('图片压缩后仍然过大：' + file.name);
    });
  }

  function markdownImageAlt(filename) {
    return filename.replace(/[\\\[\]]/g, '\\$&');
  }

  function handleImageFiles(files) {
    var fileList = Array.prototype.slice.call(files);
    return Promise.all(fileList.map(function (file) {
      return prepareImage(file).then(function (dataUrl) {
        return '![' + markdownImageAlt(file.name) + '](' + dataUrl + ')';
      });
    })).then(function (images) {
      vditor.insertValue(images.join('\n\n') + '\n', true);
      scheduleDraftSave(vditor.getValue());
      return null;
    }).catch(function (err) {
      setSaveStatus(err.message || '图片处理失败', true);
      log('upload', 'Image insertion failed', err);
      return err.message || '图片处理失败';
    });
  }

  var defaultValue = [
    '# md-editor',
    '',
    '基于 Vditor 的 Markdown 编辑器，支持三种编辑模式。',
    '',
    '## 快速上手',
    '',
    '- 当前为 **IR（即时渲染）模式**：左侧编辑 Markdown 源码，右侧实时预览',
    '- 通过工具栏可切换 WYSIWYG / IR / SV 模式',
    '- 支持拖拽或粘贴图片并压缩后嵌入文档',
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
  ].join('\n');

  var draftPromise = readDraft().catch(function (err) {
    setSaveStatus('本地草稿不可用，请使用下载保存', true);
    log('storage', 'Draft read failed', err);
    return null;
  });

  log('init', 'Creating Vditor instance...');

  vditor = new Vditor('vditor', {
    cdn: new URL('vendor/vditor', document.baseURI).href.replace(/\/$/, ''),
    mode: 'ir',
    value: defaultValue,
    placeholder: '开始写作...',
    height: '100vh',
    cache: { enable: false },
    counter: { enable: true },
    outline: { enable: true, position: 'left' },
    preview: {
      maxWidth: 4096,
      hljs: { enable: true, style: 'github' },
      markdown: {
        autoSpace: true,
        chinesePunct: true,
        toc: true,
        sanitize: true
      }
    },
    toolbar: [
      'emoji', 'headings', 'bold', 'italic', 'strike', 'link', '|',
      'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
      'quote', 'line', 'code', 'inline-code', '|',
      'upload', 'table', '|',
      'undo', 'redo', '|',
      'edit-mode', 'content-theme', 'code-theme', 'theme', 'export', '|',
      'outline', 'fullscreen',
      {
        name: 'open',
        tip: '打开 Markdown 文件',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        click: function () {
          if (vditor.getValue().trim() &&
              !confirm('当前编辑区有内容，打开新文件将替换全部内容，是否继续？')) {
            return;
          }
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = '.md,.markdown,.txt';
          input.addEventListener('change', function () {
            if (!input.files[0]) return;
            var file = input.files[0];
            file.arrayBuffer().then(function (buffer) {
              var decoded = mdFileIO.decodeFile(buffer);
              if (decoded.encoding !== 'utf-8') {
                setSaveStatus('已按 ' + decoded.encoding.toUpperCase() + ' 打开');
              }
              vditor.setValue(decoded.text, true);
              scheduleDraftSave(decoded.text);
              log('open', 'Loaded: ' + file.name + ' (' + decoded.encoding + ')');
            }).catch(function (err) {
              setSaveStatus('文件读取失败：' + file.name, true);
              log('open', 'File read failed', err);
            });
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
          var baseName = match ? match[1].trim() : 'untitled';
          var filename = mdFileIO.sanitizeFilename(baseName) + '.md';
          var blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
          var url = URL.createObjectURL(blob);
          var anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = filename;
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          log('save', 'Downloaded: ' + filename);
        }
      },
      {
        name: 'pagewidth',
        tip: '设置编辑区最大宽度',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h2v14H4V5zm5 0h2v14H9V5zm5 0h2v14h-2V5zm4 0h2v14h-2V5z"/></svg>',
        click: function () {
          var current = safeStorageGet('md-pagewidth') || '';
          var value = prompt('编辑区最大宽度 (px)，0 或留空 = 铺满:', current);
          if (value !== null) {
            pageWidth = value;
            safeStorageSet('md-pagewidth', value);
            applyPageWidth(value);
          }
        }
      },
      {
        name: 'theme',
        tip: '切换浅色 / 深色主题',
        icon: THEME_ICONS.light,
        click: function () {
          applyTheme(theme === 'dark' ? 'light' : 'dark');
        }
      },
      'help'
    ],
    toolbarConfig: { hide: false, pin: true },
    upload: {
      accept: 'image/png,image/jpeg,image/webp',
      max: MAX_IMAGE_BYTES,
      multiple: true,
      handler: handleImageFiles
    },
    input: function (value) {
      if (!editorReady || restoringDraft) return;
      userEdited = true;
      scheduleDraftSave(value);
    },
    after: function () {
      editorReady = true;
      applyTheme(theme);
      if (DEBUG) {
        window.__mdEditorTest = {
          editor: vditor,
          saveDraft: saveDraftNow,
          insertImages: handleImageFiles
        };
      }
      log('init', 'Vditor ready', {
        mode: vditor.getCurrentMode(),
        windowHeight: window.innerHeight
      });

      draftPromise.then(function (draft) {
        if (userEdited) return;
        var legacyDraft = safeStorageGet('md-editor');
        var markdown = draft && typeof draft.markdown === 'string' ? draft.markdown : legacyDraft;
        if (!markdown) return;
        restoringDraft = true;
        vditor.setValue(markdown, true);
        restoringDraft = false;
        if (!draft && legacyDraft) {
          saveDraftNow(legacyDraft).then(function (saved) {
            if (saved) safeStorageRemove('md-editor');
          });
        }
      });

      if (pageWidth) applyPageWidth(pageWidth);
      var observerTimer = null;
      var observer = new MutationObserver(function (mutations) {
        if (!pageWidth || !mutationsAddContentArea(mutations)) return;
        clearTimeout(observerTimer);
        observerTimer = setTimeout(function () { applyPageWidth(pageWidth); }, 50);
      });
      observer.observe(document.getElementById('vditor'), { childList: true, subtree: true });
    }
  });

  window.addEventListener('resize', function () {
    applyPageWidth(pageWidth);
  });

  window.addEventListener('pagehide', function () {
    if (!editorReady) return;
    clearTimeout(saveTimer);
    saveDraftNow(vditor.getValue());
  });
})();
