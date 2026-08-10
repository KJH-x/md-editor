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
        setSaveStatus(mdI18n.t('save.conflict'), true);
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
  var MD_TYPEWRITER_KEY = 'md-typewriter';
  var typewriterMode = safeStorageGet(MD_TYPEWRITER_KEY) !== '0';

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
    var stateMissing = state === undefined || state === null;
    var savingByRegex = !isError && stateMissing && /^正在/.test(message || '');
    saveStatus.classList.toggle('is-saving', !isError && (state === 'saving' || savingByRegex));
    saveStateMessage = message || '';
    if (state === 'saving' || state === 'saved' || state === 'error' || state === 'idle') {
      saveState = state;
    } else if (isError) {
      saveState = 'error';
    } else if (!message) {
      saveState = 'idle';
    } else if (stateMissing && /^正在/.test(message)) {
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
      if (saveState === 'saving') label = mdI18n.t('save.saving');
      else if (saveState === 'saved') label = mdI18n.t('save.saved');
      else if (saveState === 'error') label = mdI18n.t('save.error');
    }
    statusbarSave.setAttribute('data-state', saveState);
    if (statusbarSaveDot) statusbarSaveDot.className = 'statusbar__dot statusbar__dot--' + saveState;
    setTextContent(statusbarSaveText, label);
    statusbarSave.classList.toggle('statusbar__save--empty', saveState === 'idle' && !label);
  }

  function renderCounts() {
    if (!editorReady || !vditor || !vditor.vditor || !statusbarCounts) return;
    var stats = computeStats(vditor.getValue());
    setTextContent(statusbarCounts, mdI18n.t('statusbar.counts')
      .replace('{chars}', stats.chars).replace('{words}', stats.words));
    setTextContent(statusbarReading, mdI18n.t('statusbar.reading').replace('{minutes}', stats.reading));
  }

  function renderModeLang() {
    if (!vditor || !vditor.vditor) return;
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
      setSaveStatus(mdI18n.t('settings.notSaved'), true, 'error');
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

  var THEME_LABEL_KEYS = {
    light: 'theme.light',
    dark: 'theme.dark',
    auto: 'theme.auto'
  };

  var CONTENT_THEME_PATH = new URL('vendor/vditor/dist/css/content-theme', document.baseURI).href.replace(/\/$/, '');

  function updateThemeIcon() {
    var btn = document.querySelector('.vditor-toolbar button[data-type="theme"]');
    if (!btn) return;
    btn.innerHTML = THEME_ICONS[theme] || THEME_ICONS.light;
    btn.title = mdI18n.t(THEME_LABEL_KEYS[theme] || 'theme.light');
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

  document.addEventListener('fullscreenchange', updateStatusVisibility);
  document.addEventListener('webkitfullscreenchange', updateStatusVisibility);

  function openDatabase() {
    if (!('indexedDB' in window)) {
      return Promise.reject(new Error(mdI18n.t('storage.unsupported')));
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
        reject(request.error || new Error(mdI18n.t('storage.openFailed')));
      };
      request.onblocked = function () {
        databasePromise = null;
        reject(new Error(mdI18n.t('storage.blocked')));
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
          reject(request.error || new Error(mdI18n.t('storage.readFailed')));
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
          reject(transaction.error || new Error(mdI18n.t('storage.writeFailed')));
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error(mdI18n.t('storage.writeAborted')));
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
    setSaveStatus(mdI18n.t('save.fail'), true, 'error');
    log('storage', 'Draft save failed', err);
    return false;
  }

  function saveDraftNow(markdown) {
    clearTimeout(saveTimer);
    saveTimer = null;
    return writeDraft(markdown).then(function () {
      retrying = false;
      safeStorageRemove('md-editor-fallback');
      setSaveStatus(mdI18n.t('save.saved'), false, 'saved');
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
    setSaveStatus(mdI18n.t('save.saving'), false, 'saving');
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

  var outlineSpyTimer = null;
  var OUTLINE_SPY_DELAY = 100;

  function outlineSpyContainers() {
    var containers = [];
    var content = document.querySelector('.vditor-content');
    var preview = document.querySelector('.vditor-preview');
    if (content) containers.push(content);
    if (preview) containers.push(preview);
    var wrappers = document.querySelectorAll('.vditor-ir .vditor-reset, .vditor-wysiwyg .vditor-reset, .vditor-sv');
    for (var i = 0; i < wrappers.length; i++) containers.push(wrappers[i]);
    return containers;
  }

  function scheduleOutlineSpy() {
    clearTimeout(outlineSpyTimer);
    outlineSpyTimer = setTimeout(updateOutlineSpy, OUTLINE_SPY_DELAY);
  }

  function updateOutlineSpy() {
    outlineSpyTimer = null;
    var outlineEl = document.querySelector('.vditor-outline');
    if (!outlineEl || outlineEl.offsetParent === null) return;
    var items = outlineEl.querySelectorAll('li > span[data-target-id]');
    if (!items.length) return;
    var editor = vditor && vditor.vditor;
    var toolbarEl = editor && editor.toolbar && editor.toolbar.element;
    var toolbarHeight = toolbarEl ? toolbarEl.offsetHeight : 0;
    var line = toolbarHeight + 24;
    var active = null;
    for (var i = 0; i < items.length; i++) {
      var id = items[i].getAttribute('data-target-id');
      if (!id) continue;
      var heading = document.getElementById(id);
      if (!heading) continue;
      if (heading.getBoundingClientRect().top > line) continue;
      active = items[i];
    }
    for (var j = 0; j < items.length; j++) {
      items[j].classList.toggle('md-outline-active', items[j] === active);
    }
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

  function continueOpen() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt';
    input.addEventListener('change', function () {
      if (!input.files[0]) return;
      var file = input.files[0];
      file.arrayBuffer().then(function (buffer) {
        var decoded = mdFileIO.decodeFile(buffer);
        if (decoded.encoding !== 'utf-8') {
          setSaveStatus(mdI18n.t('file.openedWith')
            .replace('{encoding}', decoded.encoding.toUpperCase()), false, 'idle');
        }
        vditor.setValue(decoded.text, true);
        scheduleDraftSave(decoded.text);
        log('open', 'Loaded: ' + file.name + ' (' + decoded.encoding + ')');
      }).catch(function (err) {
        setSaveStatus(mdI18n.t('file.readError').replace('{name}', file.name), true);
        log('open', 'File read failed', err);
      });
    });
    input.click();
  }

  function openFile() {
    if (vditor.getValue().trim() === '') {
      continueOpen();
      return;
    }
    MDModal.confirm({
      title: mdI18n.t('dialog.openConfirmTitle'),
      message: mdI18n.t('dialog.openConfirm'),
      confirmLabel: mdI18n.t('dialog.confirm'),
      cancelLabel: mdI18n.t('dialog.cancel'),
      danger: true
    }).then(function (ok) {
      if (ok) continueOpen();
    });
  }

  function saveFile(force) {
    var content = vditor.getValue();
    var match = content.match(/^#\s+(.+)$/m);
    var baseName = match ? match[1].trim() : mdI18n.t('untitled');
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

  function transformCallouts(html) {
    return html.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, function (blockquote, inner) {
      if (blockquote.indexOf('callout') !== -1) return blockquote;
      var match = inner.match(/<p(?:[^>]*)>\[!(NOTE|TIP|WARNING|DANGER)\]\s*([\s\S]*?)<\/p>/);
      if (!match) return blockquote;
      var type = match[1];
      var label = type.charAt(0) + type.slice(1).toLowerCase();
      var rest = inner.slice(match.index + match[0].length);
      return '<blockquote class="callout callout--' + type.toLowerCase() + '">' +
        '<p class="callout-label">' + label + '</p>' +
        '<p>' + match[2] + '</p>' + rest + '</blockquote>';
    });
  }

  function editorCursorTop(element) {
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return 0;
    var rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect || !rect.top) return 0;
    var elementRect = element.getBoundingClientRect();
    return rect.top - elementRect.top + element.scrollTop;
  }

  function applyTypewriterPosition() {
    if (!vditor || !vditor.vditor || !vditor.vditor.toolbar) return;
    var editor = vditor.vditor;
    var element = editor[editor.currentMode].element;
    if (!editor.options.typewriterMode) {
      element.style.removeProperty('--editor-bottom');
      return;
    }
    var height = editor.element.classList.contains('vditor--fullscreen') ?
      window.innerHeight : editor.element.clientHeight;
    var bottom = Math.max(0, Math.round((height - editor.toolbar.element.offsetHeight) / 2));
    element.style.setProperty('--editor-bottom', bottom + 'px');
    var cursorTop = editorCursorTop(element);
    element.scrollTop = cursorTop + element.scrollTop - element.clientHeight / 2 + 10;
  }

  function updateTypewriterButton() {
    if (!vditor || !vditor.vditor || !vditor.vditor.toolbar || !vditor.vditor.toolbar.elements ||
        !vditor.vditor.toolbar.elements.typewriter) return;
    var button = vditor.vditor.toolbar.elements.typewriter.children[0];
    if (button) button.classList.toggle('vditor-menu--current', !!vditor.vditor.options.typewriterMode);
  }

  function toggleTypewriter() {
    typewriterMode = !vditor.vditor.options.typewriterMode;
    vditor.vditor.options.typewriterMode = typewriterMode;
    safeStorageSet(MD_TYPEWRITER_KEY, typewriterMode ? '1' : '0');
    applyTypewriterPosition();
    updateTypewriterButton();
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
        reject(new Error(mdI18n.t('image.readError').replace('{name}', file.name)));
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
      reader.onerror = function () { reject(new Error(mdI18n.t('image.readError').replace('{name}', file.name))); };
      reader.readAsDataURL(file);
    });
  }

  function renderCompressedImage(image, maxWidth, quality) {
    var scale = Math.min(1, maxWidth / image.naturalWidth, 12000 / image.naturalHeight);
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    var context = canvas.getContext('2d');
    if (!context) throw new Error(mdI18n.t('image.compressError'));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', quality);
  }

  function prepareImage(file) {
    if (!file.type || file.type.indexOf('image/') !== 0) {
      return Promise.reject(new Error(mdI18n.t('image.unsupportedType')));
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return Promise.reject(new Error(mdI18n.t('image.tooLarge').replace('{name}', file.name)));
    }
    if (file.type === 'image/gif') {
      return readFileAsDataUrl(file).then(function (dataUrl) {
        if (dataUrl.length > MAX_DATA_URL_LENGTH) {
          throw new Error(mdI18n.t('image.gifTooLarge').replace('{name}', file.name));
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
      throw new Error(mdI18n.t('image.compressedTooLarge').replace('{name}', file.name));
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
          failed.push(result.reason && result.reason.message ? result.reason.message : String(result.reason || mdI18n.t('error.unknown')));
        }
      });
      if (successful.length) {
        vditor.insertValue(successful.join('\n\n') + '\n', true);
        scheduleDraftSave(vditor.getValue());
      }
      if (failed.length) {
        var message = failed.join(mdI18n.t('image.errorsJoin'));
        setSaveStatus(message, true, 'error');
        log('upload', 'Image insertion partial failure', failed);
        return message;
      }
      return null;
    });
  }

  function buildWelcomeDoc() {
    return [
      mdI18n.t('welcome.title'),
      '',
      mdI18n.t('welcome.intro'),
      '',
      mdI18n.t('welcome.quickstart'),
      '',
      mdI18n.t('welcome.irDesc'),
      mdI18n.t('welcome.modeSwitch'),
      mdI18n.t('welcome.images'),
      mdI18n.t('welcome.features'),
      '',
      mdI18n.t('welcome.shortcutsTitle'),
      '',
      mdI18n.t('welcome.shortcutHeader'),
      mdI18n.t('welcome.shortcutDivider'),
      mdI18n.t('welcome.shortcutWysiwyg'),
      mdI18n.t('welcome.shortcutIr'),
      mdI18n.t('welcome.shortcutSv'),
      '',
      mdI18n.t('welcome.start')
    ].join('\n');
  }

  var pendingRestoreValue = null;

  function isCodeBlockContext(node) {
    if (!node || !node.closest) return false;
    return !!node.closest('code, [data-type="code-block"], [data-type="code-block-info"], ' +
      '[data-type="code-block-open-marker"], [data-type="code-block-close-marker"]');
  }

  function shouldBlockHint(range) {
    if (!range || !range.startContainer || range.startContainer.textContent == null) return false;
    var node = range.startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    if (isCodeBlockContext(node)) return true;
    var beforeCursor = range.startContainer.textContent.substring(0, range.startOffset) || '';
    var lastSlash = beforeCursor.lastIndexOf('/');
    var lastColon = beforeCursor.lastIndexOf(':');
    if (lastSlash <= lastColon) return false;
    var prefix = beforeCursor.slice(0, lastSlash);
    if (prefix !== '' && !/\s$/.test(prefix)) {
      if (/[a-z][a-z0-9+.-]*:$/i.test(prefix) ||
          /(^|\s)[a-z][a-z0-9+.-]*:\/\//i.test(prefix)) {
        return true;
      }
    }
    return beforeCursor.slice(lastSlash + 1).length > 32;
  }

  function patchHintRender() {
    if (!vditor || !vditor.vditor || !vditor.vditor.hint) return;
    var hint = vditor.vditor.hint;
    var original = hint.render;
    hint.render = function () {
      var selection = window.getSelection();
      var range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (shouldBlockHint(range)) {
        this.element.style.display = 'none';
        clearTimeout(this.timeId);
        return;
      }
      return original.apply(this, arguments);
    };
  }

  var draftPromise = readDraft().catch(function (err) {
    setSaveStatus(mdI18n.t('storage.unavailable'), true, 'error');
    log('storage', 'Draft read failed', err);
    return null;
  });

  function createVditor(initialValue) {
    return new Vditor('vditor', {
      cdn: new URL('vendor/vditor', document.baseURI).href.replace(/\/$/, ''),
      mode: 'ir',
      lang: mdI18n.lang === 'zh-CN' ? 'zh_CN' : 'en_US',
      value: initialValue,
      placeholder: mdI18n.t('placeholder'),
      height: '100vh',
      cache: { enable: false },
      counter: { enable: true },
      outline: { enable: true, position: 'left' },
      tab: '\t',
      hint: {
        extend: [
          {
            key: '/',
            hint: function (query) {
              return MDSlashMenu.buildItems(query);
            }
          }
        ]
      },
      typewriterMode: typewriterMode,
      preview: {
        maxWidth: 4096,
        theme: { current: effectiveInit, list: {} },
        hljs: { enable: true, style: 'github' },
        markdown: {
          autoSpace: true,
          toc: true,
          sanitize: true,
          mark: true
        },
        math: {
          engine: 'KaTeX',
          inlineDigit: true,
          macros: {}
        },
        transform: function (html) {
          return transformCallouts(html);
        }
      },
      toolbar: [
        'emoji', 'headings', 'bold', 'italic', 'strike', { name: 'link', hotkey: '' }, '|',
        'list', 'ordered-list', 'check',
        { name: 'outdent', hotkey: '⇧Tab', tipPosition: 'n' },
        'indent', '|',
        'quote', 'line', 'code', 'inline-code', '|',
        'upload', 'table',
        {
          name: 'diagram',
          tip: mdI18n.t('toolbar.diagram'),
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
          toolbar: [
            {
              name: 'mermaid',
              tip: 'Mermaid',
              icon: 'Mermaid',
              click: function () {
                vditor.insertValue('```mermaid\ngraph TD\n  A-->B\n```\n', true);
              }
            },
            {
              name: 'echarts',
              tip: 'ECharts',
              icon: 'ECharts',
              click: function () {
                vditor.insertValue('```echarts\n{\n  "title": { "text": "' + mdI18n.t('diagram.sampleTitle') + '" },\n  "tooltip": {},\n  "xAxis": { "type": "category", "data": ["A", "B", "C"] },\n  "yAxis": { "type": "value" },\n  "series": [{ "type": "bar", "data": [5, 8, 3] }]\n}\n```\n', true);
              }
            },
            {
              name: 'mindmap',
              tip: 'Mindmap',
              icon: 'Mindmap',
              click: function () {
                vditor.insertValue('```mindmap\n' + mdI18n.t('diagram.mindmapTopic') + '\n' + mdI18n.t('diagram.mindmapL1') + '\n' + mdI18n.t('diagram.mindmapL2') + '\n```\n', true);
              }
            },
            {
              name: 'markmap',
              tip: 'Markmap',
              icon: 'Markmap',
              click: function () {
                vditor.insertValue('```markmap\n' + mdI18n.t('diagram.markmapTopic') + '\n' + mdI18n.t('diagram.markmapBranch') + '\n```\n', true);
              }
            },
            {
              name: 'flowchart',
              tip: 'Flowchart',
              icon: 'Flowchart',
              click: function () {
                vditor.insertValue('```flow\nst=>start: ' + mdI18n.t('diagram.flowStart') + '\ne=>end: ' + mdI18n.t('diagram.flowEnd') + '\nop=>operation: ' + mdI18n.t('diagram.flowOp') + '\ncond=>condition: ' + mdI18n.t('diagram.flowCond') + '\nst->op->cond\ncond(no)->op\ncond(yes)->e\n```\n', true);
              }
            },
            {
              name: 'graphviz',
              tip: 'Graphviz',
              icon: 'Graphviz',
              click: function () {
                vditor.insertValue('```graphviz\ndigraph G {\n  A -> B;\n  B -> C;\n}\n```\n', true);
              }
            },
            {
              name: 'plantuml',
              tip: 'PlantUML',
              icon: 'PlantUML',
              click: function () {
                vditor.insertValue('```plantuml\n@startuml\nAlice -> Bob: Hello\n@enduml\n```\n', true);
              }
            },
            {
              name: 'abc',
              tip: 'ABC',
              icon: 'ABC',
              click: function () {
                vditor.insertValue('```abc\nX:1\nT:' + mdI18n.t('diagram.abcTitle') + '\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c |\n```\n', true);
              }
            },
            {
              name: 'smiles',
              tip: 'SMILES',
              icon: 'SMILES',
              click: function () {
                vditor.insertValue('```smiles\nC(C(=O)O)N\n```\n', true);
              }
            }
          ]
        },
        '|',
        'undo', 'redo', '|',
        'edit-mode', 'code-theme', 'export', '|',
        'outline', 'fullscreen',
        {
          name: 'typewriter',
          tip: mdI18n.t('toolbar.typewriter'),
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="20" y2="12"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
          click: toggleTypewriter
        },
        'br',
        'insert-before', 'insert-after', 'both', 'preview', '|', 'devtools',
        {
          name: 'open',
          tip: mdI18n.t('toolbar.open'),
          hotkey: '⌘O',
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
          click: openFile
        },
        {
          name: 'save',
          tip: mdI18n.t('toolbar.save'),
          hotkey: '⌘S',
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
          click: function () { saveFile(); }
        },
        {
          name: 'pagewidth',
          tip: mdI18n.t('toolbar.pagewidth'),
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h2v14H4V5zm5 0h2v14H9V5zm5 0h2v14h-2V5zm4 0h2v14h-2V5z"/></svg>',
          click: function () {
            var current = safeStorageGet('md-pagewidth') || '';
            MDModal.prompt({
              title: mdI18n.t('pagewidth.title'),
              label: mdI18n.t('pagewidth.prompt'),
              value: current,
              confirmLabel: mdI18n.t('dialog.promptOk'),
              cancelLabel: mdI18n.t('dialog.cancel'),
              validate: function (v) {
                return (v === '' || (/^\d+$/.test(v) && parseInt(v, 10) >= 0))
                  ? null : mdI18n.t('pagewidth.invalid');
              }
            }).then(function (result) {
              if (result !== null) {
                pageWidth = result;
                safeStorageSet('md-pagewidth', result);
                applyPageWidth(result);
              }
            });
          }
        },
        {
          name: 'theme',
          tip: mdI18n.t('toolbar.theme'),
          icon: THEME_ICONS.light,
          click: function () {
            applyTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'auto' : 'light');
          }
        },
        {
          name: 'lang',
          tip: mdI18n.t('toolbar.lang'),
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
          click: function () {
            switchLanguage(mdI18n.lang === 'zh-CN' ? 'en-US' : 'zh-CN');
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
        scheduleOutlineSpy();
      },
      ctrlEnter: function () {
        saveDraftNow(vditor.getValue());
      },
      select: function (value) {
        if (value && value.trim()) {
          window.MDFormatBar.show();
        } else if (window.MDFormatBar) {
          window.MDFormatBar.hide();
        }
      },
      unSelect: function () {
        if (window.MDFormatBar) window.MDFormatBar.hide();
      },
      after: function () {
        editorReady = true;
        patchHintRender();
        if (pendingRestoreValue !== null) {
          vditor.setValue(pendingRestoreValue, true);
          pendingRestoreValue = null;
        }
        updateEmptyState();
        renderStatusBar();
        mdI18n.applyI18n();
        var chromeObserver = new MutationObserver(function () {
          renderModeLang();
          updateStatusVisibility();
          scheduleOutlineSpy();
        });
        chromeObserver.observe(document.getElementById('vditor'), {
          attributes: true,
          attributeFilter: ['class'],
          childList: true,
          subtree: true
        });
        var spyContainers = outlineSpyContainers();
        for (var s = 0; s < spyContainers.length; s++) {
          spyContainers[s].addEventListener('scroll', scheduleOutlineSpy, { passive: true });
        }
        updateOutlineSpy();
        applyTheme(theme);
        applyTypewriterPosition();
        updateTypewriterButton();
        if (window.MDFormatBar && window.MDFormatBar.attach) {
          window.MDFormatBar.attach(vditor);
        }
        buildActionRegistry();
        if (window.MDCommandPalette && typeof window.MDCommandPalette.ensure === 'function') {
          window.MDCommandPalette.ensure();
        }
        if (window.MDFindReplace) window.MDFindReplace.setVditor(vditor);
        if (vditor.vditor.options.preview.transform) {
          log('preview', 'callout transform attached');
        }
        if (DEBUG) {
          window.__mdEditorTest = {
            editor: vditor,
            saveDraft: saveDraftNow,
            insertImages: handleImageFiles,
            actions: window.MD_ACTIONS
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
  }

  function switchLanguage(next) {
    if (!vditor) return;
    var currentValue = vditor.getValue();
    var currentMode = vditor.getCurrentMode();
    vditor.destroy();
    vditor = null;
    pendingRestoreValue = currentValue;
    mdI18n.setLang(next);
    vditor = createVditor(currentValue);
    applyTheme(theme);
    applyPageWidth(pageWidth);
    saveStateMessage = '';
    log('i18n', 'Language switched to ' + next, { mode: currentMode });
  }

  var actionsBuilt = false;

  function buildActionRegistry() {
    if (actionsBuilt || !window.MD_ACTIONS) return;
    actionsBuilt = true;
    var editor = vditor.vditor;
    var toolbar = editor.options.toolbar;
    if (!toolbar) return;
    var customNames = { open: 1, save: 1, pagewidth: 1, theme: 1, typewriter: 1, diagram: 1, lang: 1 };
    var toolbarCategories = {
      emoji: 'insert', headings: 'format', bold: 'format', italic: 'format',
      strike: 'format', link: 'insert', list: 'format', 'ordered-list': 'format',
      check: 'format', outdent: 'format', indent: 'format', quote: 'format',
      line: 'format', code: 'format', 'inline-code': 'format', table: 'insert',
      undo: 'view', redo: 'view', fullscreen: 'view', both: 'view',
      'insert-before': 'view', 'insert-after': 'view', 'code-theme': 'view',
      export: 'view', outline: 'view', preview: 'view', devtools: 'view'
    };
    toolbar.forEach(function (item) {
      if (!item || typeof item !== 'object' || !item.name) return;
      if (!item.hotkey || customNames[item.name]) return;
      var label = (window.VditorI18n && window.VditorI18n[item.name]) || item.tip || item.name;
      window.MD_ACTIONS.register({
        id: item.name,
        label: label,
        category: toolbarCategories[item.name] || 'format',
        shortcut: item.hotkey,
        keywords: [item.name, label],
        run: function () {
          var el = vditor && vditor.vditor && vditor.vditor.toolbar &&
            vditor.vditor.toolbar.elements[item.name];
          if (el && el.children[0]) el.children[0].click();
        },
        enabled: function () {
          var el = vditor && vditor.vditor && vditor.vditor.toolbar &&
            vditor.vditor.toolbar.elements[item.name];
          return !!(el && el.children[0] &&
            !el.children[0].classList.contains('vditor-menu--disabled'));
        }
      });
    });
    toolbar.forEach(function (item) {
      if (!item || typeof item !== 'object' || !item.name) return;
      if (!customNames[item.name]) return;
      if (item.name === 'diagram') {
        window.MD_ACTIONS.register({
          id: 'diagram',
          label: item.tip || item.name,
          category: 'insert',
          shortcut: '',
          keywords: ['diagram', item.tip || item.name],
          run: function () {
            var el = vditor && vditor.vditor && vditor.vditor.toolbar &&
              vditor.vditor.toolbar.elements.diagram;
            if (el && el.children[0]) el.children[0].click();
          }
        });
        (item.toolbar || []).forEach(function (sub) {
          if (!sub || !sub.name || typeof sub.click !== 'function') return;
          window.MD_ACTIONS.register({
            id: 'diagram.' + sub.name,
            label: sub.tip || sub.name,
            category: 'insert',
            shortcut: '',
            keywords: [sub.name, sub.tip || sub.name],
            run: function () { sub.click(); }
          });
        });
        return;
      }
      var label = item.tip || item.name;
      var category = (item.name === 'open' || item.name === 'save' || item.name === 'pagewidth')
        ? 'file' : 'settings';
      window.MD_ACTIONS.register({
        id: item.name,
        label: label,
        category: category,
        shortcut: item.hotkey || '',
        keywords: [item.name, label],
        run: function () {
          if (typeof item.click === 'function') item.click();
        }
      });
    });
    ['wysiwyg', 'ir', 'sv'].forEach(function (mode) {
      var modeShortcut = mode === 'wysiwyg' ? 'Alt+Ctrl+7' : mode === 'ir' ? 'Alt+Ctrl+8' : 'Alt+Ctrl+9';
      window.MD_ACTIONS.register({
        id: 'app.' + mode,
        label: mdI18n.t('action.mode.' + mode),
        category: 'app',
        shortcut: modeShortcut,
        keywords: [mode, mdI18n.t('action.mode.' + mode)],
        run: function () {
          var editMode = vditor && vditor.vditor && vditor.vditor.toolbar &&
            vditor.vditor.toolbar.elements['edit-mode'];
          var button = editMode && editMode.querySelector('button[data-mode="' + mode + '"]');
          if (button) button.click();
        },
        enabled: function () {
          return !!(vditor && vditor.vditor) && vditor.getCurrentMode() !== mode;
        }
      });
    });
    window.MD_ACTIONS.register({
      id: 'app.theme',
      label: mdI18n.t('action.theme.cycle'),
      category: 'app',
      shortcut: '',
      keywords: ['theme', mdI18n.t('action.theme.cycle')],
      run: function () {
        applyTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'auto' : 'light');
      }
    });
    window.MD_ACTIONS.register({
      id: 'app.lang',
      label: mdI18n.t('action.lang.switch'),
      category: 'app',
      shortcut: '',
      keywords: ['lang', 'language', mdI18n.t('action.lang.switch')],
      run: function () {
        switchLanguage(mdI18n.lang === 'zh-CN' ? 'en-US' : 'zh-CN');
      }
    });
    window.MD_ACTIONS.register({
      id: 'find-replace',
      label: mdI18n.t('action.findReplace'),
      category: 'app',
      shortcut: 'Ctrl+F',
      keywords: ['find', 'replace', mdI18n.t('action.findReplace')],
      run: function () {
        if (window.MDFindReplace) window.MDFindReplace.open(false);
      }
    });
    window.MD_ACTIONS.register({
      id: 'find-replace-toggle',
      label: mdI18n.t('action.findReplaceToggle'),
      category: 'app',
      shortcut: '',
      keywords: ['find', 'replace', 'toggle', mdI18n.t('action.findReplaceToggle')],
      run: function () {
        if (window.MDFindReplace) window.MDFindReplace.toggle(false);
      }
    });
    window.MD_ACTIONS.register({
      id: 'palette',
      label: mdI18n.t('action.palette'),
      category: 'app',
      shortcut: 'Ctrl+K',
      keywords: ['palette', 'command palette', mdI18n.t('action.palette')],
      run: function () {
        if (window.MDCommandPalette) window.MDCommandPalette.open();
      }
    });
  }

  log('init', 'Creating Vditor instance...');

  vditor = createVditor(buildWelcomeDoc());

  window.addEventListener('keydown', function (event) {
    if (!event.shiftKey || event.key !== 'Tab') return;
    if (!vditor || !vditor.vditor || !vditor.vditor.toolbar || !vditor.vditor.toolbar.elements) return;
    var container = document.getElementById('vditor');
    if (!container || !container.contains(event.target)) return;
    var selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      var node = selection.getRangeAt(0).commonAncestorContainer;
      if (node.nodeType === 3) node = node.parentElement;
      if (node && node.closest && node.closest('td, th')) return;
    }
    var outdent = vditor.vditor.toolbar.elements.outdent;
    if (!outdent || !outdent.children[0]) return;
    if (outdent.children[0].classList.contains('vditor-menu--disabled')) return;
    event.preventDefault();
    outdent.children[0].click();
  });

  window.addEventListener('resize', function () {
    applyPageWidth(pageWidth);
  });

  var formatbarTimer = null;
  var FORMATBAR_DEBOUNCE = 60;

  function scheduleFormatBar() {
    clearTimeout(formatbarTimer);
    formatbarTimer = setTimeout(updateFormatBar, FORMATBAR_DEBOUNCE);
  }

  function updateFormatBar() {
    formatbarTimer = null;
    if (!window.MDFormatBar) return;
    var selection = window.getSelection();
    var hasSelection = !!(selection && selection.rangeCount > 0 && !selection.isCollapsed);
    var sv = document.querySelector('.vditor-sv textarea');
    if (sv && sv.selectionStart !== sv.selectionEnd) hasSelection = true;
    if (hasSelection) window.MDFormatBar.show();
    else window.MDFormatBar.hide();
  }

  document.addEventListener('selectionchange', scheduleFormatBar);
  document.addEventListener('mouseup', scheduleFormatBar);

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
    if (mod && event.key.toLowerCase() === 'k' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      if (window.MDCommandPalette) window.MDCommandPalette.toggle();
      return;
    }
    if (mod && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      event.stopPropagation();
      if (window.MDFindReplace) window.MDFindReplace.open(false);
      return;
    }
    if (mod && event.key.toLowerCase() === 'h') {
      event.preventDefault();
      event.stopPropagation();
      if (window.MDFindReplace) window.MDFindReplace.open(true);
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
