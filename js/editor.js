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
  var saveState = 'idle';
  var saveStateMessage = '';
  var statusbarEl = document.getElementById('statusbar');
  var statusbarSave = document.getElementById('statusbar-save');
  var statusbarSaveDot = statusbarSave ? statusbarSave.querySelector('.statusbar__dot') : null;
  var statusbarSaveText = statusbarSave ? statusbarSave.querySelector('.statusbar__save-text') : null;
  var statusbarCounts = document.getElementById('statusbar-counts');
  var statusbarReading = document.getElementById('statusbar-reading');
  var statusbarMode = document.getElementById('statusbar-mode');
  var statusbarLang = document.getElementById('statusbar-lang');
  var statusRenderTimer = null;
  var MODE_LABELS = { wysiwyg: 'WYSIWYG', ir: 'IR', sv: 'SV' };
  var LANG_LABELS = {
    zh_CN: '中文', zh_TW: '繁體中文', en_US: 'English', ja_JP: '日本語',
    de_DE: 'Deutsch', es_ES: 'Español', fr_FR: 'Français', ko_KR: '한국어',
    pt_BR: 'Português', ru_RU: 'Русский', vi_VN: 'Tiếng Việt'
  };
  var databasePromise = null;
  var saveTimer = null;
  var pageWidth = safeStorageGet('md-pagewidth') || '';
  var editorReady = false;
  var userEdited = false;
  var restoringDraft = false;
  var vditor = null;
  var retrying = false;
  var lastFlushAt = 0;
  var draftChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('md-editor-docs') : null;
  if (draftChannel) {
    draftChannel.onmessage = function (event) {
      if (event.data && event.data.type === 'saved') {
        setSaveStatus('草稿已在其他标签页更新', true);
        log('storage', 'Draft updated in another tab');
      }
    };
  }
  var THEME_KEY = 'md-theme';
  var theme = safeStorageGet(THEME_KEY) || 'auto';
  var darkMedia = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');

  function resolveTheme(value) {
    return value === 'auto'
      ? (darkMedia && darkMedia.matches ? 'dark' : 'light')
      : (value === 'dark' ? 'dark' : 'light');
  }

  var effectiveInit = resolveTheme(theme);
  document.documentElement.setAttribute('data-theme', effectiveInit);

  function log(tag, msg, data) {
    if (!DEBUG) return;
    var args = ['%c[md-editor] %c' + tag + ' %c' + msg,
      'color: #4CAF50; font-weight: bold',
      'color: #2196F3',
      'color: inherit'];
    if (data !== undefined) args.push(data);
    console.log.apply(console, args);
  }

  function setSaveStatus(message, isError, state) {
    if (!saveStatus) return;
    clearTimeout(saveStatusTimer);
    saveStatus.textContent = message;
    saveStatus.classList.toggle('is-error', !!isError);
    saveStatus.classList.toggle('is-saving', !isError && /^正在/.test(message || ''));
    saveStateMessage = message || '';
    if (state === 'saving' || state === 'saved' || state === 'error' || state === 'idle') {
      saveState = state;
    } else if (isError) {
      saveState = 'error';
    } else if (!message) {
      saveState = 'idle';
    } else if (/^正在/.test(message)) {
      saveState = 'saving';
    } else {
      saveState = 'saved';
    }
    renderStatusBar();
    if (!isError && message) {
      saveStatusTimer = setTimeout(clearSaveStatus, 2400);
    }
  }

  function clearSaveStatus() {
    if (!saveStatus) return;
    saveStatus.textContent = '';
    saveStatus.classList.remove('is-error', 'is-saving');
    saveState = 'idle';
    saveStateMessage = '';
    renderStatusBar();
  }

  function setTextContent(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

  function computeStats(value) {
    var words = (value.match(/[A-Za-z0-9]+|[\u4e00-\u9fff]/g) || []).length;
    return { chars: value.length, words: words, reading: Math.ceil(words / 200) };
  }

  function renderSave() {
    if (!statusbarSave) return;
    var label = saveStateMessage;
    if (!label) {
      if (saveState === 'saving') label = '正在保存';
      else if (saveState === 'saved') label = '已保存';
      else if (saveState === 'error') label = '保存出错';
    }
    statusbarSave.setAttribute('data-state', saveState);
    if (statusbarSaveDot) statusbarSaveDot.className = 'statusbar__dot statusbar__dot--' + saveState;
    setTextContent(statusbarSaveText, label);
    statusbarSave.classList.toggle('statusbar__save--empty', saveState === 'idle' && !label);
  }

  function renderCounts() {
    if (!editorReady || !vditor || !statusbarCounts) return;
    var stats = computeStats(vditor.getValue());
    setTextContent(statusbarCounts, '字数 ' + stats.chars + ' · 词数 ' + stats.words);
    setTextContent(statusbarReading, '约 ' + stats.reading + ' 分钟');
  }

  function renderModeLang() {
    if (!vditor) return;
    var mode = vditor.getCurrentMode();
    var lang = vditor.vditor && vditor.vditor.options && vditor.vditor.options.lang;
    setTextContent(statusbarMode, MODE_LABELS[mode] || mode || '');
    setTextContent(statusbarLang, LANG_LABELS[lang] || lang || '');
  }

  function isFullscreen() {
    var root = document.querySelector('.vditor');
    return !!(document.fullscreenElement || document.webkitFullscreenElement) ||
      !!(root && root.classList.contains('vditor--fullscreen'));
  }

  function updateStatusVisibility() {
    if (!statusbarEl) return;
    statusbarEl.classList.toggle('is-fullscreen', isFullscreen());
  }

  function renderStatusBar() {
    renderSave();
    renderModeLang();
    renderCounts();
    updateStatusVisibility();
  }

  function scheduleStatusRender() {
    if (statusRenderTimer) return;
    statusRenderTimer = setTimeout(function () {
      statusRenderTimer = null;
      renderStatusBar();
    }, 500);
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
      setSaveStatus('设置无法保存到浏览器', true, 'error');
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

  function updateEmptyState() {
    var empty = document.getElementById('empty-state');
    if (empty) empty.hidden = vditor.getValue().trim() !== '';
  }

  var THEME_ICONS = {
    light: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    dark: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
  };

  var THEME_LABELS = {
    light: '浅色主题',
    dark: '深色主题',
    auto: '跟随系统主题'
  };

  var CONTENT_THEME_PATH = new URL('vendor/vditor/dist/css/content-theme', document.baseURI).href.replace(/\/$/, '');

  function updateThemeIcon() {
    var btn = document.querySelector('.vditor-toolbar button[data-type="theme"]');
    if (!btn) return;
    btn.innerHTML = THEME_ICONS[theme] || THEME_ICONS.light;
    btn.title = THEME_LABELS[theme] || THEME_LABELS.light;
  }

  function applyTheme(next) {
    theme = next;
    var effective = resolveTheme(next);
    document.documentElement.setAttribute('data-theme', effective);
    if (vditor) {
      try {
        vditor.setTheme(effective, effective === 'dark' ? 'dark' : 'light',
          effective === 'dark' ? 'github-dark' : 'github', CONTENT_THEME_PATH);
      } catch (err) {
        log('theme', 'setTheme failed', err);
      }
    }
    updateThemeIcon();
    safeStorageSet(THEME_KEY, next);
    log('theme', 'Theme set to ' + next + ' (effective ' + effective + ')');
  }

  function onSystemThemeChange() {
    if (theme === 'auto') applyTheme('auto');
  }

  if (darkMedia) {
    if (darkMedia.addEventListener) {
      darkMedia.addEventListener('change', onSystemThemeChange);
    } else if (darkMedia.addListener) {
      darkMedia.addListener(onSystemThemeChange);
    }
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
      request.onsuccess = function () {
        var database = request.result;
        database.onclose = function () { databasePromise = null; };
        database.onversionchange = function () { databasePromise = null; };
        resolve(database);
      };
      request.onerror = function () {
        databasePromise = null;
        reject(request.error || new Error('无法打开本地草稿数据库'));
      };
      request.onblocked = function () {
        databasePromise = null;
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

  function writeDraftImpl(markdown) {
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

  function writeDraft(markdown) {
    if (navigator.locks && navigator.locks.request) {
      return navigator.locks.request('md-editor-draft', { mode: 'exclusive' }, function () {
        try {
          return writeDraftImpl(markdown);
        } catch (err) {
          log('storage', 'Locked draft write failed', err);
          throw err;
        }
      });
    }
    return writeDraftImpl(markdown);
  }

  function notifyDraftSaved() {
    if (!draftChannel) return;
    try {
      draftChannel.postMessage({ type: 'saved', updatedAt: Date.now() });
    } catch (err) {
      log('storage', 'Broadcast saved notification failed', err);
    }
  }

  function failSave(markdown, err) {
    safeStorageSet('md-editor-fallback', markdown);
    setSaveStatus('草稿保存失败，请立即下载备份', true, 'error');
    log('storage', 'Draft save failed', err);
    return false;
  }

  function saveDraftNow(markdown) {
    clearTimeout(saveTimer);
    saveTimer = null;
    return writeDraft(markdown).then(function () {
      retrying = false;
      safeStorageRemove('md-editor-fallback');
      setSaveStatus('草稿已保存', false, 'saved');
      log('storage', 'Draft saved', { length: markdown.length });
      notifyDraftSaved();
      return true;
    }).catch(function (err) {
      if (retrying) {
        retrying = false;
        return failSave(markdown, err);
      }
      retrying = true;
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(saveDraftNow(markdown)); }, 500);
      });
    });
  }

  function flushDraft() {
    if (!editorReady || !userEdited) return;
    var now = Date.now();
    if (now - lastFlushAt < 100) return;
    lastFlushAt = now;
    clearTimeout(saveTimer);
    saveTimer = null;
    saveDraftNow(vditor.getValue());
  }

  function scheduleDraftSave(markdown) {
    clearTimeout(saveTimer);
    setSaveStatus('正在保存...', false, 'saving');
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

  function openFile() {
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
          setSaveStatus('已按 ' + decoded.encoding.toUpperCase() + ' 打开', false, 'idle');
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

  function saveFile(force) {
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
    if (force) saveDraftNow(content);
    log('save', 'Downloaded: ' + filename);
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

  function readImageSettings() {
    var defaults = { maxDim: 1600, quality: 0.82 };
    try {
      var raw = safeStorageGet('md-img');
      if (!raw) return defaults;
      var parsed = JSON.parse(raw);
      return {
        maxDim: typeof parsed.maxDim === 'number' && parsed.maxDim > 0 ? parsed.maxDim : defaults.maxDim,
        quality: typeof parsed.quality === 'number' && parsed.quality > 0 && parsed.quality <= 1 ? parsed.quality : defaults.quality
      };
    } catch (err) {
      log('image', 'Invalid md-img settings', err);
      return defaults;
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (event) { resolve(event.target.result); };
      reader.onerror = function () { reject(new Error('无法读取图片：' + file.name)); };
      reader.readAsDataURL(file);
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
    if (file.type === 'image/gif') {
      return readFileAsDataUrl(file).then(function (dataUrl) {
        if (dataUrl.length > MAX_DATA_URL_LENGTH) {
          throw new Error('GIF 动画无法压缩，且数据超过 3 MB 限制：' + file.name);
        }
        return dataUrl;
      });
    }
    if (file.type === 'image/svg+xml') {
      return readFileAsDataUrl(file);
    }

    return readImage(file).then(function (image) {
      var settings = readImageSettings();
      var attempts = [[settings.maxDim, settings.quality], [1280, 0.72], [960, 0.62]];
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
    return Promise.allSettled(fileList.map(function (file) {
      return prepareImage(file).then(function (dataUrl) {
        return '![' + markdownImageAlt(file.name) + '](' + dataUrl + ')';
      });
    })).then(function (results) {
      var successful = [];
      var failed = [];
      results.forEach(function (result) {
        if (result.status === 'fulfilled') {
          successful.push(result.value);
        } else {
          failed.push(result.reason && result.reason.message ? result.reason.message : String(result.reason || '未知错误'));
        }
      });
      if (successful.length) {
        vditor.insertValue(successful.join('\n\n') + '\n', true);
        scheduleDraftSave(vditor.getValue());
      }
      if (failed.length) {
        var message = failed.join('；');
        setSaveStatus(message, true, 'error');
        log('upload', 'Image insertion partial failure', failed);
        return message;
      }
      return null;
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
    setSaveStatus('本地草稿不可用，请使用下载保存', true, 'error');
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
      theme: { current: effectiveInit, list: {} },
      hljs: { enable: true, style: 'github' },
      markdown: {
        autoSpace: true,
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
      'edit-mode', 'code-theme', 'export', '|',
      'outline', 'fullscreen',
      {
        name: 'open',
        tip: '打开 Markdown 文件',
        hotkey: '⌘O',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        click: openFile
      },
      {
        name: 'save',
        tip: '保存为 Markdown 文件',
        hotkey: '⌘S',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
        click: function () { saveFile(); }
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
        tip: '切换浅色 / 深色 / 跟随系统主题',
        icon: THEME_ICONS.light,
        click: function () {
          applyTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'auto' : 'light');
        }
      },
      'help'
    ],
    toolbarConfig: { hide: false, pin: true },
    upload: {
      accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml',
      max: MAX_IMAGE_BYTES,
      multiple: true,
      handler: handleImageFiles
    },
    input: function (value) {
      if (!editorReady || restoringDraft) return;
      userEdited = true;
      scheduleDraftSave(value);
      updateEmptyState();
      scheduleStatusRender();
    },
    ctrlEnter: function () {
      saveDraftNow(vditor.getValue());
    },
    after: function () {
      editorReady = true;
      updateEmptyState();
      renderStatusBar();
      var chromeObserver = new MutationObserver(function () {
        renderModeLang();
        updateStatusVisibility();
      });
      chromeObserver.observe(document.getElementById('vditor'), {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true
      });
      document.addEventListener('fullscreenchange', updateStatusVisibility);
      document.addEventListener('webkitfullscreenchange', updateStatusVisibility);
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
        var fallbackDraft = safeStorageGet('md-editor-fallback');
        var markdown = draft && typeof draft.markdown === 'string' ? draft.markdown
          : (fallbackDraft || legacyDraft);
        if (!markdown) return;
        restoringDraft = true;
        vditor.setValue(markdown, true);
        restoringDraft = false;
        if (!draft) {
          saveDraftNow(markdown).then(function (saved) {
            if (saved) {
              safeStorageRemove('md-editor-fallback');
              safeStorageRemove('md-editor');
            }
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

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushDraft();
  });

  window.addEventListener('pagehide', function () {
    flushDraft();
  });

  var shortcutOverlay = document.getElementById('shortcut-overlay');
  var lastFocusedElement = null;

  function targetInEditorArea(target) {
    var node = target && target.nodeType === Node.ELEMENT_NODE ? target : target && target.parentElement;
    if (!node || !node.closest) return false;
    return !!node.closest('[contenteditable="true"], textarea, .vditor-toolbar');
  }

  function openShortcutOverlay() {
    if (!shortcutOverlay) return;
    lastFocusedElement = document.activeElement;
    shortcutOverlay.hidden = false;
    var panel = shortcutOverlay.querySelector('.shortcut-overlay__panel');
    if (panel) panel.focus();
  }

  function closeShortcutOverlay() {
    if (!shortcutOverlay || shortcutOverlay.hidden) return;
    shortcutOverlay.hidden = true;
    if (lastFocusedElement && lastFocusedElement.focus) lastFocusedElement.focus();
    lastFocusedElement = null;
  }

  function toggleShortcutOverlay() {
    if (shortcutOverlay && !shortcutOverlay.hidden) {
      closeShortcutOverlay();
    } else {
      openShortcutOverlay();
    }
  }

  window.addEventListener('keydown', function (event) {
    if (event.isComposing || event.repeat) return;
    var mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      event.stopPropagation();
      saveFile(!event.shiftKey);
      return;
    }
    if (mod && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      event.stopPropagation();
      openFile();
      return;
    }
    if (event.key === '?' && !mod && !event.altKey && !targetInEditorArea(event.target)) {
      toggleShortcutOverlay();
      return;
    }
    if (event.key === 'Escape' && shortcutOverlay && !shortcutOverlay.hidden) {
      closeShortcutOverlay();
    }
  }, true);

  if (shortcutOverlay) {
    shortcutOverlay.addEventListener('click', function (event) {
      if (event.target === shortcutOverlay ||
          (event.target.classList && event.target.classList.contains('shortcut-overlay__close')) ||
          (event.target.classList && event.target.classList.contains('shortcut-overlay__backdrop'))) {
        closeShortcutOverlay();
      }
    });
  }
})();
