(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var DEBUG = params.has('debug');
  var tabId = params.get('tabId');
  var tabHost = tabId ? new TabHost(tabId) : null;
  if (tabHost) document.body.classList.add('md-tab-mode');
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
    pt_BR: 'Português', ru_RU: 'Русский', vi_VN: 'Tiếng Việt',
    hi_IN: 'हिन्दी', ar_AR: 'العربية'
  };
  var LANG_CYCLE = ['zh-CN', 'en-US', 'es-ES', 'hi-IN', 'ar-AR'];
  var VDTOR_LANG = { 'zh-CN': 'zh_CN', 'en-US': 'en_US', 'es-ES': 'es_ES', 'hi-IN': 'hi_IN', 'ar-AR': 'ar_AR' };
  var activeDocId = null;
  var saveTimer = null;
  var pageWidth = tabHost ? (params.get('pageWidth') || '') : (safeStorageGet('md-pagewidth') || '');
  var editorReady = false;
  var userEdited = false;
  var restoringDraft = false;
  var vditor = null;
  var retrying = false;
  var lastFlushAt = 0;
  var draftChannel = (!tabHost && 'BroadcastChannel' in window) ? new BroadcastChannel('md-editor-docs') : null;
  if (draftChannel) {
    draftChannel.onmessage = function (event) {
      if (event.data && event.data.type === 'saved') {
        setSaveStatus(mdI18n.t('save.conflict'), true);
        log('storage', 'Draft updated in another tab');
      }
    };
  }
  var THEME_KEY = 'md-theme';
  var theme = tabHost ? (params.get('theme') || 'auto') : (safeStorageGet(THEME_KEY) || 'auto');
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

  var EMPTY_TEMPLATES = [
    {
      key: 'readme',
      build: function () {
        return [
          '# ' + mdI18n.t('empty.template.readme'),
          '',
          mdI18n.t('empty.template.readmeIntro'),
          '',
          '## ' + mdI18n.t('empty.template.agenda'),
          '',
          '- ' + mdI18n.t('empty.template.item'),
          '- ' + mdI18n.t('empty.template.item'),
          '',
          '## ' + mdI18n.t('empty.template.actions'),
          '',
          '- [ ] ' + mdI18n.t('empty.template.item')
        ].join('\n');
      }
    },
    {
      key: 'meeting',
      build: function () {
        return [
          '# ' + mdI18n.t('empty.template.meeting'),
          '',
          '## ' + mdI18n.t('empty.template.agenda'),
          '',
          '- ' + mdI18n.t('empty.template.item'),
          '',
          '## ' + mdI18n.t('empty.template.actions'),
          '',
          '- [ ] ' + mdI18n.t('empty.template.item')
        ].join('\n');
      }
    },
    {
      key: 'todo',
      build: function () {
        return [
          '# ' + mdI18n.t('empty.template.todo'),
          '',
          '- [ ] ' + mdI18n.t('empty.template.item'),
          '- [ ] ' + mdI18n.t('empty.template.item'),
          '- [ ] ' + mdI18n.t('empty.template.item')
        ].join('\n');
      }
    }
  ];

  function initEmptyState() {
    var links = document.querySelectorAll('.empty-state__templates a');
    Array.prototype.forEach.call(links, function (link, index) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        var tpl = EMPTY_TEMPLATES[index];
        if (!tpl || !vditor) return;
        var markdown = tpl.build();
        vditor.setValue(markdown, true);
        scheduleDraftSave(markdown);
        updateEmptyState();
      });
    });
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
    if (!tabHost) safeStorageSet(THEME_KEY, next);
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

  function deriveTitle(markdown) {
    var match = String(markdown || '').match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : mdI18n.t('untitled');
  }

  function newDocId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'doc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function ensureActiveDoc() {
    if (ensureActiveDoc.promise) return ensureActiveDoc.promise;
    ensureActiveDoc.promise = window.MDStore.migrateLegacy().then(function (legacy) {
      if (legacy && legacy.id) {
        if (!activeDocId) activeDocId = legacy.id;
        return legacy;
      }
      return window.MDStore.listDocs().then(function (docs) {
        var doc = docs && docs.length ? docs[0] : null;
        if (doc && !activeDocId) activeDocId = doc.id;
        return doc;
      });
    });
    ensureActiveDoc.promise.catch(function () {
      ensureActiveDoc.promise = null;
    });
    return ensureActiveDoc.promise;
  }

  function readDraft() {
    return ensureActiveDoc().then(function (doc) {
      return doc ? { markdown: doc.markdown, updatedAt: doc.updatedAt } : null;
    });
  }

  function writeDraftImpl(markdown) {
    return ensureActiveDoc().then(function () {
      if (!activeDocId) activeDocId = newDocId();
      return window.MDStore.putDoc({
        id: activeDocId,
        title: deriveTitle(markdown),
        markdown: markdown,
        updatedAt: Date.now()
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
  var lastOutlineActive = null;

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
    if (active === lastOutlineActive) return;
    if (lastOutlineActive) lastOutlineActive.classList.remove('md-outline-active');
    lastOutlineActive = active;
    if (active) active.classList.add('md-outline-active');
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
    if (window.MDFsa && window.MDFsa.supported()) {
      window.MDFsa.openFile().then(function (result) {
        if (!result) return;
        if (result.encoding !== 'utf-8') {
          setSaveStatus(mdI18n.t('file.openedWith')
            .replace('{encoding}', result.encoding.toUpperCase()), false, 'idle');
        }
        vditor.setValue(result.text, true);
        scheduleDraftSave(result.text);
        log('open', 'Loaded: ' + (result.handle ? result.handle.name : 'file') + ' (' + result.encoding + ')');
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        setSaveStatus(mdI18n.t('file.readError').replace('{name}', 'file'), true);
        log('open', 'File read failed', err);
      });
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
    if (tabHost) {
      tabHost.post({ type: 'requestOpen', tabId: tabHost.tabId });
      return;
    }
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

  function downloadMarkdown(content, force) {
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

  function copyHtmlFallback(plainText) {
    var textarea = document.createElement('textarea');
    textarea.value = plainText;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      log('export', 'execCommand copy failed', err);
    }
    document.body.removeChild(textarea);
    if (ok) setSaveStatus(mdI18n.t('export.copyHtmlDone'), false, 'saved');
  }

  function copyAsHtml() {
    if (!vditor || !vditor.vditor) return;
    var html = '<div class="vditor-reset">' + (vditor.getHTML() || '') + '</div>';
    var plain = vditor.getValue() || '';
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' })
        })]).then(function () {
          setSaveStatus(mdI18n.t('export.copyHtmlDone'), false, 'saved');
        }, function () {
          copyHtmlFallback(plain);
        });
        return;
      } catch (err) {
        log('export', 'ClipboardItem write failed', err);
      }
    }
    copyHtmlFallback(plain);
  }

  function printToPdf() {
    if (!vditor || !vditor.vditor) return;
    var html = '<div class="vditor-reset">' + (vditor.getHTML() || '') + '</div>';
    var frame = document.getElementById('md-print-frame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'md-print-frame';
      frame.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;border:0;visibility:hidden;';
      document.body.appendChild(frame);
    }
    frame.src = 'about:blank';
    var frameDoc = frame.contentDocument;
    frameDoc.open();
    frameDoc.write('<!DOCTYPE html><html lang="' + (mdI18n.lang || 'zh-CN') + '"><head><meta charset="UTF-8">' +
      '<link rel="stylesheet" href="vendor/vditor/dist/index.css">' +
      '<link rel="stylesheet" href="css/style.css">' +
      '<style>@media print{html,body{margin:0;padding:0}body{overflow:visible}}</style>' +
      '</head><body>' + html + '</body></html>');
    frameDoc.close();
    setTimeout(function () {
      var win = frame.contentWindow;
      if (win && typeof win.print === 'function') {
        try { win.print(); } catch (err) { log('export', 'print failed', err); }
      }
    }, 250);
  }

  function shareCurrent() {
    if (!vditor || !vditor.vditor) return;
    var markdown = vditor.getValue() || '';
    if (!navigator.canShare || typeof navigator.share !== 'function') {
      saveFile();
      return;
    }
    var match = markdown.match(/^#\s+(.+)$/m);
    var baseName = mdFileIO.sanitizeFilename(match ? match[1].trim() : mdI18n.t('untitled'));
    function tryShare(file) {
      var data = { files: [file], title: baseName };
      if (!navigator.canShare(data)) return false;
      navigator.share(data).catch(function (err) {
        log('export', 'Web Share failed', err);
      });
      return true;
    }
    if (tryShare(new File([markdown], baseName + '.md', { type: 'text/markdown' }))) return;
    if (tryShare(new File([markdown], baseName + '.txt', { type: 'text/plain' }))) return;
    setSaveStatus(mdI18n.t('export.shareFallback'), false, 'saved');
    saveFile();
}

  function saveFile(force) {
    var content = vditor.getValue();
    if (window.MDFsa && window.MDFsa.supported()) {
      window.MDFsa.getHandle().then(function (handle) {
        if (handle || force) {
          return window.MDFsa.saveFile(content, force).then(function (status) {
            if (status === 'saved') {
              setSaveStatus(mdI18n.t('fsa.savedFile'), false, 'saved');
              if (force) saveDraftNow(content);
              return;
            }
            if (status === 'needsGesture') {
              setSaveStatus(mdI18n.t('fsa.needsGesture'), true, 'error');
              if (force) saveDraftNow(content);
              return;
            }
            if (status === 'unsupported') {
              setSaveStatus(mdI18n.t('fsa.unsupported'), true, 'error');
            }
            downloadMarkdown(content, force);
          }).catch(function (err) {
            if (err && err.name === 'AbortError') {
              if (force) saveDraftNow(content);
              return;
            }
            downloadMarkdown(content, force);
          });
        }
        downloadMarkdown(content, force);
      }).catch(function () {
        downloadMarkdown(content, force);
      });
      return;
    }
    downloadMarkdown(content, force);
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

  // 图片缩放/对齐约定语法：![alt](url#宽度|对齐) —— 预览阶段转成内联样式
  function transformImages(html) {
    return html.replace(/<img\b([^>]*?)\bsrc="([^"]+?)(?:#(\d+))?(?:\|(left|center|right))?"([^>]*?)\/?>/g, function (whole, before, src, width, align, after) {
      var out = '<img' + before + ' src="' + src + '"' + after + '>';
      if (width) {
        out = out.replace('<img', '<img style="max-width:' + width + 'px;height:auto"');
      }
      if (align && align !== 'left') {
        out = '<div style="text-align:' + align + '">' + out + '</div>';
      }
      return out;
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

  // ---- Focus mode (M9)：沉浸写作，当前段落高亮、其余压暗 ----
  var MD_FOCUS_KEY = 'md-focus';
  var focusMode = safeStorageGet(MD_FOCUS_KEY) === '1';
  var focusTimer = null;
  var FOCUS_BLOCK_CLASS = 'md-focus-block';

  function focusBlockFromSelection() {
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    var node = selection.getRangeAt(0).commonAncestorContainer;
    if (node && node.nodeType === 3) node = node.parentElement;
    if (!node || !node.closest) return null;
    if (!node.closest('.vditor')) return null;
    return node.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table');
  }

  function applyFocusHighlight() {
    var root = document.querySelector('.vditor');
    if (!root) return;
    root.classList.toggle('md-focus-mode', focusMode);
    var current = root.querySelector('.' + FOCUS_BLOCK_CLASS);
    if (!focusMode) {
      if (current) current.classList.remove(FOCUS_BLOCK_CLASS);
      return;
    }
    var block = focusBlockFromSelection();
    if (current && block && current === block) return;
    if (current) current.classList.remove(FOCUS_BLOCK_CLASS);
    if (block && block.closest('.vditor')) block.classList.add(FOCUS_BLOCK_CLASS);
  }

  function scheduleFocusHighlight() {
    if (!focusMode) return;
    if (focusTimer) return;
    focusTimer = setTimeout(function () {
      focusTimer = null;
      applyFocusHighlight();
    }, 120);
  }

  function updateFocusButton() {
    if (!vditor || !vditor.vditor || !vditor.vditor.toolbar || !vditor.vditor.toolbar.elements ||
        !vditor.vditor.toolbar.elements.focus) return;
    var button = vditor.vditor.toolbar.elements.focus.children[0];
    if (button) button.classList.toggle('vditor-menu--current', focusMode);
  }

  function toggleFocusMode() {
    focusMode = !focusMode;
    safeStorageSet(MD_FOCUS_KEY, focusMode ? '1' : '0');
    applyFocusHighlight();
    updateFocusButton();
  }

  // ---- Spellcheck (M10)：Vditor 硬编码 spellcheck=false，运行时开闸 + 文档级语言 ----
  var MD_SPELLCHECK_KEY = 'md-spellcheck';
  var spellcheckEnabled = safeStorageGet(MD_SPELLCHECK_KEY) !== '0';
  var spellcheckTimer = null;

  function editorLangForSpellcheck() {
    var map = { 'zh-CN': 'zh-CN', 'en-US': 'en-US', 'es-ES': 'es-ES', 'hi-IN': 'hi-IN', 'ar-AR': 'ar-AR' };
    return map[mdI18n.lang] || mdI18n.lang;
  }

  function applySpellcheck() {
    var lang = editorLangForSpellcheck();
    var roots = document.querySelectorAll('.vditor-ir, .vditor-wysiwyg, .vditor-sv');
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      var editable = root.getAttribute('contenteditable') === 'true'
        ? root : root.querySelector('[contenteditable="true"]');
      if (editable) {
        editable.spellcheck = spellcheckEnabled;
        if (editable.lang !== lang) editable.lang = lang;
      }
      var textarea = root.querySelector('textarea');
      if (textarea) {
        textarea.spellcheck = spellcheckEnabled;
        textarea.lang = lang;
      }
      var preview = root.querySelector('.vditor-sv__preview, .vditor-ir__preview');
      if (preview && preview.getAttribute('contenteditable') === 'true') {
        preview.spellcheck = spellcheckEnabled;
        preview.lang = lang;
      }
    }
  }

  function scheduleSpellcheck() {
    if (spellcheckTimer) return;
    spellcheckTimer = setTimeout(function () {
      spellcheckTimer = null;
      applySpellcheck();
    }, 120);
  }

  function toggleSpellcheck() {
    spellcheckEnabled = !spellcheckEnabled;
    safeStorageSet(MD_SPELLCHECK_KEY, spellcheckEnabled ? '1' : '0');
    applySpellcheck();
    setSaveStatus(mdI18n.t(spellcheckEnabled ? 'spellcheck.on' : 'spellcheck.off'), false, 'saved');
  }

  // ---- Lightbox (M8)：预览内点击大图全屏查看 ----
  var lightbox = null;
  var lightboxImages = [];
  var lightboxIndex = -1;

  function ensureLightbox() {
    if (lightbox) return lightbox;
    lightbox = document.createElement('div');
    lightbox.className = 'md-lightbox';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', mdI18n.t('image.lightboxLabel'));
    lightbox.hidden = true;
    var backdrop = document.createElement('div');
    backdrop.className = 'md-lightbox__backdrop';
    backdrop.addEventListener('click', closeLightbox);
    lightbox.appendChild(backdrop);
    var img = document.createElement('img');
    img.className = 'md-lightbox__img';
    img.alt = '';
    lightbox.appendChild(img);
    var prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'md-lightbox__nav md-lightbox__nav--prev';
    prev.textContent = '‹';
    prev.setAttribute('aria-label', mdI18n.t('image.lightboxPrev'));
    prev.addEventListener('click', function () { stepLightbox(-1); });
    lightbox.appendChild(prev);
    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'md-lightbox__nav md-lightbox__nav--next';
    next.textContent = '›';
    next.setAttribute('aria-label', mdI18n.t('image.lightboxNext'));
    next.addEventListener('click', function () { stepLightbox(1); });
    lightbox.appendChild(next);
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'md-lightbox__close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', mdI18n.t('image.lightboxClose'));
    closeBtn.addEventListener('click', closeLightbox);
    lightbox.appendChild(closeBtn);
    document.body.appendChild(lightbox);
    return lightbox;
  }

  function renderLightbox() {
    if (!lightbox) return;
    if (!lightboxImages.length) { closeLightbox(); return; }
    var img = lightbox.querySelector('.md-lightbox__img');
    img.src = lightboxImages[lightboxIndex];
    var prev = lightbox.querySelector('.md-lightbox__nav--prev');
    var next = lightbox.querySelector('.md-lightbox__nav--next');
    if (prev) prev.hidden = lightboxImages.length < 2;
    if (next) next.hidden = lightboxImages.length < 2;
  }

  function openLightbox(src, images, index) {
    ensureLightbox();
    lightboxImages = (images && images.length) ? images : [src];
    lightboxIndex = (index >= 0 && index < lightboxImages.length) ? index : 0;
    renderLightbox();
    lightbox.hidden = false;
    lightbox.focus && lightbox.focus();
  }

  function stepLightbox(dir) {
    if (!lightboxImages.length) return;
    lightboxIndex = (lightboxIndex + dir + lightboxImages.length) % lightboxImages.length;
    renderLightbox();
  }

  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    var img = lightbox.querySelector('.md-lightbox__img');
    if (img) img.src = '';
    lightboxImages = [];
  }

  // ---- Image index + resize/align (M8)：编辑器内图片缩放/对齐 + 图片清单 ----
  var imageBar = null;
  var imageBarImage = null;

  function imageSrcOf(img) {
    return (img && (img.currentSrc || img.src)) || '';
  }

  function collectImages() {
    var root = document.querySelector('.vditor');
    var imgs = root ? root.querySelectorAll('img') : [];
    var out = [];
    for (var i = 0; i < imgs.length; i++) out.push(imgs[i]);
    return out;
  }

  function imageMarkdownMatches() {
    var value = vditor ? vditor.getValue() : '';
    var matches = [];
    var re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    var m;
    while ((m = re.exec(value)) !== null) {
      matches.push({ alt: m[1], url: m[2], index: m.index, end: re.lastIndex });
    }
    return matches;
  }

  function findImageOccurrence(url) {
    var matches = imageMarkdownMatches();
    for (var i = 0; i < matches.length; i++) {
      if (matches[i].url === url) return { match: matches[i], occurrence: i };
    }
    return null;
  }

  function rewriteImageSuffix(url, widthPx, align) {
    var found = findImageOccurrence(url);
    if (!found) return false;
    var value = vditor.getValue();
    var match = found.match;
    var suffix = '';
    if (widthPx && widthPx > 0) suffix += '#' + Math.round(widthPx);
    if (align && align !== 'left') suffix += (suffix ? '|' : '#') + align;
    var raw = '![' + match.alt + '](' + match.url + ')';
    var replacement = '![' + match.alt + '](' + match.url + suffix + ')';
    vditor.setValue(value.slice(0, match.index) + replacement + value.slice(match.end), true);
    return true;
  }

  function imageBarWidth() {
    if (!imageBarImage) return;
    if (!window.MDModal) return;
    var current = 0;
    var url = imageSrcOf(imageBarImage);
    var found = findImageOccurrence(url);
    if (found) {
      var mm = found.match.url.match(/#(\d+)(?:\|(?:left|center|right))?$/);
      if (mm) current = parseInt(mm[1], 10) || 0;
    }
    window.MDModal.prompt({
      title: mdI18n.t('image.widthTitle'),
      label: mdI18n.t('image.widthPrompt'),
      value: current ? String(current) : '',
      confirmLabel: mdI18n.t('dialog.promptOk'),
      cancelLabel: mdI18n.t('dialog.cancel'),
      validate: function (v) {
        return (v === '' || (/^\d+$/.test(v) && parseInt(v, 10) >= 0))
          ? null : mdI18n.t('pagewidth.invalid');
      }
    }).then(function (result) {
      if (result === null) return;
      var widthPx = result === '' ? 0 : parseInt(result, 10);
      if (rewriteImageSuffix(url, widthPx, imageBarAlign)) {
        hideImageBar();
        scheduleDraftSave(vditor.getValue());
      }
    });
  }

  var imageBarAlign = 'left';

  function imageBarAlignTo(value) {
    if (!imageBarImage) return;
    var url = imageSrcOf(imageBarImage);
    var found = findImageOccurrence(url);
    var widthPx = 0;
    if (found) {
      var mm = found.match.url.match(/#(\d+)(?:\|(?:left|center|right))?$/);
      if (mm) widthPx = parseInt(mm[1], 10) || 0;
    }
    imageBarAlign = value;
    if (rewriteImageSuffix(url, widthPx, value)) {
      hideImageBar();
      scheduleDraftSave(vditor.getValue());
    }
  }

  function ensureImageBar() {
    if (imageBar) return imageBar;
    imageBar = document.createElement('div');
    imageBar.className = 'md-imagebar';
    imageBar.setAttribute('role', 'toolbar');
    imageBar.setAttribute('aria-label', mdI18n.t('image.barLabel'));
    imageBar.hidden = true;
    var defs = [
      { id: 'width', label: 'image.width', run: imageBarWidth },
      { id: 'align-left', label: 'image.alignLeft', run: function () { imageBarAlignTo('left'); } },
      { id: 'align-center', label: 'image.alignCenter', run: function () { imageBarAlignTo('center'); } },
      { id: 'align-right', label: 'image.alignRight', run: function () { imageBarAlignTo('right'); } }
    ];
    for (var i = 0; i < defs.length; i++) {
      var def = defs[i];
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'md-imagebar__btn';
      button.textContent = mdI18n.t(def.label);
      button.title = mdI18n.t(def.label);
      button.setAttribute('aria-label', mdI18n.t(def.label));
      button.addEventListener('click', def.run);
      imageBar.appendChild(button);
    }
    document.body.appendChild(imageBar);
    return imageBar;
  }

  function showImageBar(img) {
    var rect = img.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return;
    ensureImageBar();
    imageBarImage = img;
    imageBarAlign = 'left';
    var url = imageSrcOf(img);
    var found = findImageOccurrence(url);
    if (found) {
      var mm = found.match.url.match(/#(\d+)(?:\|(left|center|right))?$/);
      if (mm && mm[1]) imageBarAlign = mm[2] || 'left';
    }
    imageBar.hidden = false;
    var barRect = imageBar.getBoundingClientRect();
    var left = Math.max(8, Math.min(rect.left + rect.width / 2 - barRect.width / 2,
      window.innerWidth - barRect.width - 8));
    var top = rect.top - barRect.height - 8;
    if (top < 8) top = rect.bottom + 8;
    imageBar.style.left = left + 'px';
    imageBar.style.top = top + 'px';
  }

  function hideImageBar() {
    if (imageBar) imageBar.hidden = true;
    imageBarImage = null;
  }

  function locateImageInEditor(url) {
    var imgs = collectImages();
    for (var i = 0; i < imgs.length; i++) {
      if (imageSrcOf(imgs[i]) === url) {
        try { imgs[i].scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) {}
        break;
      }
    }
    try {
      var editor = vditor && vditor.vditor;
      var element = editor ? editor[editor.currentMode].element : null;
      if (element && element.focus) element.focus();
    } catch (err) {}
  }

  function imageIndexEntries() {
    var matches = imageMarkdownMatches();
    var seen = {};
    var entries = [];
    for (var i = 0; i < matches.length; i++) {
      var url = matches[i].url;
      if (seen[url]) continue;
      seen[url] = true;
      entries.push({ url: url, match: matches[i] });
    }
    return entries;
  }

  // ---- Image index panel (M8)：文档图片清单/图片目录 ----
  var imagePanel = null;

  function ensureImagePanel() {
    if (imagePanel) return imagePanel;
    imagePanel = document.createElement('div');
    imagePanel.className = 'md-images';
    imagePanel.setAttribute('role', 'dialog');
    imagePanel.setAttribute('aria-modal', 'true');
    imagePanel.setAttribute('aria-label', mdI18n.t('image.panelTitle'));
    imagePanel.hidden = true;
    var backdrop = document.createElement('div');
    backdrop.className = 'md-images__backdrop';
    backdrop.addEventListener('click', closeImagePanel);
    imagePanel.appendChild(backdrop);
    var panel = document.createElement('div');
    panel.className = 'md-images__panel';
    var header = document.createElement('div');
    header.className = 'md-images__header';
    var title = document.createElement('div');
    title.className = 'md-images__title';
    title.textContent = mdI18n.t('image.panelTitle');
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'md-images__close';
    closeBtn.textContent = mdI18n.t('history.close');
    closeBtn.addEventListener('click', closeImagePanel);
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);
    var list = document.createElement('div');
    list.className = 'md-images__list';
    panel.appendChild(list);
    imagePanel._list = list;
    imagePanel.appendChild(panel);
    document.body.appendChild(imagePanel);
    return imagePanel;
  }

  function closeImagePanel() {
    if (!imagePanel || imagePanel.hidden) return;
    imagePanel.hidden = true;
    while (imagePanel._list.firstChild) imagePanel._list.removeChild(imagePanel._list.firstChild);
  }

  function openImagePanel() {
    ensureImagePanel();
    var list = imagePanel._list;
    while (list.firstChild) list.removeChild(list.firstChild);
    var entries = imageIndexEntries();
    if (!entries.length) {
      var empty = document.createElement('div');
      empty.className = 'md-images__empty';
      empty.textContent = mdI18n.t('image.panelEmpty');
      list.appendChild(empty);
    }
    for (var i = 0; i < entries.length; i++) {
      (function (entry) {
        var item = document.createElement('div');
        item.className = 'md-images__item';
        var thumb = document.createElement('img');
        thumb.className = 'md-images__thumb';
        thumb.src = entry.url;
        thumb.alt = '';
        var info = document.createElement('div');
        info.className = 'md-images__info';
        var meta = document.createElement('div');
        meta.className = 'md-images__meta';
        meta.textContent = mdI18n.t('image.unknown');
        info.appendChild(meta);
        var actions = document.createElement('div');
        actions.className = 'md-images__actions';
        var locateBtn = document.createElement('button');
        locateBtn.type = 'button';
        locateBtn.className = 'md-images__btn';
        locateBtn.textContent = mdI18n.t('image.locate');
        locateBtn.addEventListener('click', function () {
          closeImagePanel();
          locateImageInEditor(entry.url);
        });
        actions.appendChild(locateBtn);
        info.appendChild(actions);
        item.appendChild(thumb);
        item.appendChild(info);
        list.appendChild(item);
        var probe = new Image();
        probe.onload = function () {
          var size = Math.round(entry.url.length * 0.75);
          meta.textContent = mdI18n.t('image.dim')
            .replace('{w}', String(probe.naturalWidth))
            .replace('{h}', String(probe.naturalHeight))
            .replace('{kb}', String(Math.max(1, Math.round(size / 1024))));
        };
        probe.src = entry.url;
      })(entries[i]);
    }
    imagePanel.hidden = false;
  }

  // ---- TOC：忽略空标题（用户补充2）+ 滞后更新防闪烁（用户补充1） ----
  function cleanOutlineEmpty() {
    var outlineEl = document.querySelector('.vditor-outline');
    if (!outlineEl) return;
    var spans = outlineEl.querySelectorAll('li > span[data-target-id]');
    for (var i = 0; i < spans.length; i++) {
      var span = spans[i];
      if (!span.textContent || !String(span.textContent).trim()) {
        var li = span.closest('li');
        if (li && li.parentNode) li.parentNode.removeChild(li);
      }
    }
  }

  function bindOutlineCleaner() {
    var outlineEl = document.querySelector('.vditor-outline');
    if (!outlineEl) {
      setTimeout(bindOutlineCleaner, 500);
      return;
    }
    if (outlineEl.__mdCleanBound) return;
    outlineEl.__mdCleanBound = true;
    cleanOutlineEmpty();
    var observer = new MutationObserver(function () {
      cleanOutlineEmpty();
      scheduleOutlineSpy();
    });
    observer.observe(outlineEl, { childList: true, subtree: true });
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

  function a11yUploadTrigger() {
    var trigger = document.querySelector('.vditor-toolbar__item [data-type="upload"]');
    if (!trigger || trigger.tagName === 'BUTTON') return;
    var item = trigger.parentElement;
    if (!item) return;
    var input = trigger.querySelector('input[type="file"]');
    var svg = trigger.querySelector('svg');
    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-type', 'upload');
    button.className = trigger.className;
    button.setAttribute('aria-label', mdI18n.t('a11y.upload'));
    if (svg) button.appendChild(svg);
    if (input) {
      trigger.removeChild(input);
      input.tabIndex = -1;
      input.setAttribute('aria-hidden', 'true');
      input.style.pointerEvents = 'none';
    }
    item.replaceChild(button, trigger);
    if (input) item.appendChild(input);
    button.addEventListener('click', function () {
      if (button.classList.contains('vditor-menu--disabled')) return;
      if (input) input.click();
    });
  }

  function a11yEditorLabels() {
    var label = mdI18n.t('a11y.editorLabel');
    var roots = document.querySelectorAll('.vditor-ir, .vditor-wysiwyg, .vditor-sv, .vditor-preview');
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      if (root.getAttribute('contenteditable') === 'true') {
        root.setAttribute('aria-label', label);
      } else {
        var editable = root.querySelector('[contenteditable="true"]');
        if (editable) editable.setAttribute('aria-label', label);
      }
      if (root.classList.contains('vditor-preview')) {
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', label);
      }
    }
  }

  function a11ySyncExpanded(button, panel) {
    button.setAttribute('aria-expanded', panel.style.display === 'block' ? 'true' : 'false');
  }

  function a11yPanelButtons() {
    var editor = vditor && vditor.vditor;
    if (!editor || !editor.toolbar || !editor.toolbar.elements) return;
    var names = ['emoji', 'headings', 'edit-mode', 'content-theme', 'code-theme', 'export'];
    for (var n = 0; n < names.length; n++) {
      var item = editor.toolbar.elements[names[n]];
      if (!item) continue;
      var button = item.children[0];
      if (!button) continue;
      var panel = null;
      for (var c = 0; c < item.children.length; c++) {
        var child = item.children[c];
        if (child.classList && (child.classList.contains('vditor-panel') ||
            child.classList.contains('vditor-hint'))) {
          panel = child;
          break;
        }
      }
      if (!panel) continue;
      button.setAttribute('aria-haspopup', 'menu');
      a11ySyncExpanded(button, panel);
      button.addEventListener('click', (function (b, p) {
        return function () { a11ySyncExpanded(b, p); };
      }(button, panel)));
      var observer = new MutationObserver((function (b, p) {
        return function () { a11ySyncExpanded(b, p); };
      }(button, panel)));
      observer.observe(panel, { attributes: true, attributeFilter: ['style'] });
    }
  }

  function a11yHintMenu() {
    var editor = vditor && vditor.vditor;
    if (!editor || !editor.hint || !editor.hint.element) return;
    var hint = editor.hint.element;
    var label = mdI18n.t('a11y.hintMenu');
    function patch() {
      if (hint.style.display === 'none') return;
      hint.setAttribute('role', 'menu');
      hint.setAttribute('aria-label', label);
      var buttons = hint.querySelectorAll('button');
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].setAttribute('role', 'menuitem');
      }
    }
    patch();
    var observer = new MutationObserver(patch);
    observer.observe(hint, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true });
  }

  function a11yToolbarDisabled() {
    var toolbar = document.querySelector('.vditor-toolbar');
    if (!toolbar) return;
    function sync() {
      var buttons = toolbar.querySelectorAll('.vditor-toolbar__item > button');
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        if (btn.classList.contains('vditor-menu--disabled')) {
          btn.setAttribute('aria-disabled', 'true');
        } else {
          btn.removeAttribute('aria-disabled');
        }
      }
    }
    sync();
    var observer = new MutationObserver(sync);
    observer.observe(toolbar, { attributes: true, attributeFilter: ['class'], subtree: true });
  }

  var draftPromise = readDraft().catch(function (err) {
    setSaveStatus(mdI18n.t('storage.unavailable'), true, 'error');
    log('storage', 'Draft read failed', err);
    return null;
  });

  function createVditor(initialValue) {
    var containerEl = document.getElementById('vditor');
    if (containerEl) containerEl.removeAttribute('dir');
    var vditorLang = VDTOR_LANG[mdI18n.lang] || 'zh_CN';
    var vditorI18n = (window.mdVditorI18n && window.mdVditorI18n[mdI18n.lang]) || null;
    var vditorOptions = {
      cdn: new URL('vendor/vditor', document.baseURI).href.replace(/\/$/, ''),
      mode: 'ir',
      lang: vditorLang,
      rtl: mdI18n.isRTL(),
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
          return transformImages(transformCallouts(html));
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
        'edit-mode', 'code-theme', 'export',
        {
          name: 'export2',
          tip: mdI18n.t('export.title'),
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
          toolbar: [
            {
              name: 'copyHtml',
              tip: mdI18n.t('export.copyHtml'),
              icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
              click: copyAsHtml
            },
            {
              name: 'printPdf',
              tip: mdI18n.t('export.printPdf'),
              icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
              click: printToPdf
            },
            {
              name: 'share',
              tip: mdI18n.t('export.share'),
              icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
              click: shareCurrent
            },
            {
              name: 'download',
              tip: mdI18n.t('export.download'),
              icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
              click: function () { saveFile(); }
            }
          ]
        },
        '|',
        'outline', 'fullscreen',
        {
          name: 'typewriter',
          tip: mdI18n.t('toolbar.typewriter'),
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="20" y2="12"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
          click: toggleTypewriter
        },
        {
          name: 'focus',
          tip: mdI18n.t('toolbar.focus'),
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>',
          click: toggleFocusMode
        },
        {
          name: 'spellcheck',
          tip: mdI18n.t('toolbar.spellcheck'),
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h6M6 20V8M6 8c-1-2-2-2-4 0M2 12h4M18 2l4 4-8 10-4 0 2-4z"/></svg>',
          click: toggleSpellcheck
        },
        {
          name: 'images',
          tip: mdI18n.t('toolbar.images'),
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
          click: openImagePanel
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
            var current = tabHost ? (pageWidth || '') : (safeStorageGet('md-pagewidth') || '');
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
                if (tabHost) {
                  applyPageWidth(result);
                } else {
                  safeStorageSet('md-pagewidth', result);
                  applyPageWidth(result);
                }
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
            switchLanguage(nextLang(), !!tabHost);
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
        if (tabHost) {
          document.title = deriveTitle(value);
          tabHost.scheduleChange();
        } else {
          scheduleDraftSave(value);
        }
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
        if (window.MDFsa && typeof window.MDFsa.getHandle === 'function') {
          window.MDFsa.getHandle().then(function (handle) {
            if (handle) log('fsa', 'Reconnected file handle');
          }).catch(function () {
            log('fsa', 'Handle reconnect failed');
          });
        }
        if (pendingRestoreValue !== null) {
          vditor.setValue(pendingRestoreValue, true);
          pendingRestoreValue = null;
        }
        initEmptyState();
        updateEmptyState();
        renderStatusBar();
        mdI18n.applyI18n();
        var langButton = vditor && vditor.vditor && vditor.vditor.toolbar &&
          vditor.vditor.toolbar.elements && vditor.vditor.toolbar.elements.lang;
        if (langButton && langButton.children[0]) {
          langButton.children[0].title = LANG_LABELS[vditorLang] || mdI18n.lang;
          langButton.children[0].setAttribute('aria-label', LANG_LABELS[vditorLang] || mdI18n.lang);
        }
        a11yEditorLabels();
        a11yUploadTrigger();
        a11yPanelButtons();
        a11yHintMenu();
        a11yToolbarDisabled();
        applySpellcheck();
        bindOutlineCleaner();
        applyFocusHighlight();
        updateFocusButton();
        var chromeObserver = new MutationObserver(function () {
          renderModeLang();
          updateStatusVisibility();
          scheduleOutlineSpy();
          scheduleSpellcheck();
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

        if (!tabHost) {
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
        }

        if (pageWidth) applyPageWidth(pageWidth);
        var observerTimer = null;
        var observer = new MutationObserver(function (mutations) {
          if (!pageWidth || !mutationsAddContentArea(mutations)) return;
          clearTimeout(observerTimer);
          observerTimer = setTimeout(function () { applyPageWidth(pageWidth); }, 50);
        });
        observer.observe(document.getElementById('vditor'), { childList: true, subtree: true });
        if (tabHost) {
          if (!tabHost.readySent) {
            tabHost.readySent = true;
            tabHost.ready();
          }
          var pendingInit = tabHost.takePendingInit();
          if (pendingInit) tabHost.applyInit(pendingInit);
        }
      }
    };
    if (vditorI18n) {
      vditorOptions.i18n = vditorI18n;
    }
    return new Vditor('vditor', vditorOptions);
  }

  function nextLang() {
    var index = LANG_CYCLE.indexOf(mdI18n.lang);
    return LANG_CYCLE[(index + 1) % LANG_CYCLE.length];
  }

  function switchLanguage(next, noPersist) {
    if (!vditor) return;
    var currentValue = vditor.getValue();
    var currentMode = vditor.getCurrentMode();
    vditor.destroy();
    vditor = null;
    pendingRestoreValue = currentValue;
    mdI18n.setLang(next, !!noPersist);
    vditor = createVditor(currentValue);
    applyTheme(theme);
    applyPageWidth(pageWidth);
    saveStateMessage = '';
    log('i18n', 'Language switched to ' + next, { mode: currentMode });
  }

  function applyLang(next) {
    if (!vditor || next === mdI18n.lang) return;
    switchLanguage(next, !!tabHost);
  }

  function TabHost(tabId) {
    this.tabId = tabId;
    this.pendingInit = null;
    this.changeTimer = null;
    this.readySent = false;
    var self = this;
    window.addEventListener('message', function (event) {
      if (event.source !== window.parent) return;
      if (event.origin !== window.location.origin) return;
      var data = event.data;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'init') {
        if (!editorReady) {
          self.pendingInit = data;
          return;
        }
        self.applyInit(data);
      } else if (data.type === 'setTheme') {
        if (data.theme) applyTheme(data.theme);
      } else if (data.type === 'setLang') {
        if (data.lang) applyLang(data.lang);
      } else if (data.type === 'setPageWidth') {
        if (data.pageWidth !== undefined && data.pageWidth !== null) {
          pageWidth = String(data.pageWidth);
          applyPageWidth(pageWidth);
        }
      } else if (data.type === 'requestSave') {
        if (!vditor) {
          self.post({ type: 'saveResult', tabId: self.tabId, ok: false });
          return;
        }
        var saveContent = vditor.getValue();
        saveDraftNow(saveContent).then(function (ok) {
          self.post({
            type: 'saveResult',
            tabId: self.tabId,
            ok: ok,
            content: saveContent,
            title: deriveTitle(saveContent),
            updatedAt: Date.now(),
            stats: computeStats(saveContent)
          });
        });
      }
    });
  }

  TabHost.prototype.post = function (data) {
    if (!window.parent || window.parent === window) return;
    try {
      window.parent.postMessage(data, window.location.origin);
    } catch (err) {
      log('tab', 'postMessage failed', err);
    }
  };

  TabHost.prototype.ready = function () {
    this.post({ type: 'ready', tabId: this.tabId });
  };

  TabHost.prototype.applyInit = function (data) {
    if (data.docId && typeof data.docId === 'string') {
      activeDocId = data.docId;
    }
    if (data.content !== undefined && data.content !== null) {
      restoringDraft = true;
      vditor.setValue(String(data.content), true);
      restoringDraft = false;
    }
    document.title = data.title || (data.content ? deriveTitle(data.content) : document.title);
    if (data.lang) applyLang(data.lang);
    if (data.theme) applyTheme(data.theme);
    if (data.pageWidth !== undefined && data.pageWidth !== null) {
      pageWidth = String(data.pageWidth);
      applyPageWidth(pageWidth);
    }
    updateEmptyState();
    renderStatusBar();
  };

  TabHost.prototype.scheduleChange = function () {
    var self = this;
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(function () {
      self.changeTimer = null;
      self.flushChange();
    }, 350);
  };

  TabHost.prototype.flushChange = function () {
    var content = vditor.getValue();
    this.post({
      type: 'change',
      tabId: this.tabId,
      content: content,
      title: deriveTitle(content),
      updatedAt: Date.now(),
      stats: computeStats(content)
    });
  };

  TabHost.prototype.notifyFocus = function () {
    this.post({ type: 'focus', tabId: this.tabId });
  };

  TabHost.prototype.takePendingInit = function () {
    var data = this.pendingInit;
    this.pendingInit = null;
    return data;
  };

  var actionsBuilt = false;

  function buildActionRegistry() {
    if (actionsBuilt || !window.MD_ACTIONS) return;
    actionsBuilt = true;
    var editor = vditor.vditor;
    var toolbar = editor.options.toolbar;
    if (!toolbar) return;
    var customNames = { open: 1, save: 1, pagewidth: 1, theme: 1, typewriter: 1, diagram: 1, lang: 1, export2: 1 };
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
      if (item.name === 'diagram' || item.name === 'export2') {
        var isDiagram = item.name === 'diagram';
        var parentId = item.name;
        window.MD_ACTIONS.register({
          id: parentId,
          label: item.tip || item.name,
          category: isDiagram ? 'insert' : 'file',
          shortcut: '',
          keywords: [parentId, item.tip || item.name],
          run: function () {
            var el = vditor && vditor.vditor && vditor.vditor.toolbar &&
              vditor.vditor.toolbar.elements[parentId];
            if (el && el.children[0]) el.children[0].click();
          }
        });
        (item.toolbar || []).forEach(function (sub) {
          if (!sub || !sub.name || typeof sub.click !== 'function') return;
          window.MD_ACTIONS.register({
            id: parentId + '.' + sub.name,
            label: sub.tip || sub.name,
            category: isDiagram ? 'insert' : 'file',
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
        switchLanguage(mdI18n.lang === 'zh-CN' ? 'en-US' : 'zh-CN', !!tabHost);
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
    window.MD_ACTIONS.register({
      id: 'app.focus',
      label: mdI18n.t('toolbar.focus'),
      category: 'app',
      shortcut: 'F6',
      keywords: ['focus', 'immerse', mdI18n.t('toolbar.focus')],
      run: function () { toggleFocusMode(); }
    });
    window.MD_ACTIONS.register({
      id: 'app.spellcheck',
      label: mdI18n.t('toolbar.spellcheck'),
      category: 'settings',
      shortcut: '',
      keywords: ['spellcheck', 'spelling', mdI18n.t('toolbar.spellcheck')],
      run: function () { toggleSpellcheck(); }
    });
    window.MD_ACTIONS.register({
      id: 'doc.images',
      label: mdI18n.t('toolbar.images'),
      category: 'view',
      shortcut: '',
      keywords: ['images', 'image index', mdI18n.t('toolbar.images')],
      run: function () { openImagePanel(); }
    });
  }

  log('init', 'Creating Vditor instance...');

  if (tabHost) {
    var langParam = params.get('lang');
    if (langParam && LANG_CYCLE.indexOf(langParam) !== -1 && langParam !== mdI18n.lang) {
      mdI18n.setLang(langParam, true);
    }
    vditor = createVditor('');
  } else {
    vditor = createVditor(buildWelcomeDoc());
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || target.tagName !== 'IMG') return;
    if (!target.closest || !target.closest('.vditor')) return;
    var preview = target.closest('.vditor-preview, .vditor-sv__preview');
    if (preview) {
      var imgs = collectImages();
      openLightbox(imageSrcOf(target), imgs.map(imageSrcOf), imgs.indexOf(target));
      event.preventDefault();
      return;
    }
    showImageBar(target);
  }, true);

  document.addEventListener('keydown', function (event) {
    if (!lightbox || lightbox.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closeLightbox(); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); stepLightbox(-1); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); stepLightbox(1); return; }
  }, true);

  document.addEventListener('selectionchange', scheduleFocusHighlight);
  document.addEventListener('keyup', scheduleFocusHighlight);
  document.addEventListener('mousedown', function (event) {
    if (imageBar && !imageBar.hidden && !imageBar.contains(event.target)) hideImageBar();
  }, true);
  document.addEventListener('scroll', function () { hideImageBar(); }, true);

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
    if (tabHost) tabHost.flushChange();
    if (vditor && vditor.getValue) {
      safeStorageSet('md-editor-fallback', vditor.getValue());
    }
  });

  if (tabHost) {
    window.addEventListener('focus', function () {
      tabHost.notifyFocus();
    });
  }

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
    if (mod && event.key.toLowerCase() === 's' && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      if (tabHost) {
        tabHost.post({ type: 'requestSave', tabId: tabHost.tabId });
      } else {
        saveFile(!event.shiftKey);
      }
      return;
    }
    if (mod && event.key.toLowerCase() === 'o' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      openFile();
      return;
    }
    if (mod && event.key.toLowerCase() === 'o' && event.shiftKey && tabHost) {
      event.preventDefault();
      event.stopPropagation();
      tabHost.post({ type: 'requestDocsPanel', tabId: tabHost.tabId });
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
    if (event.altKey && !mod && event.key.toLowerCase() === 'h' && tabHost) {
      event.preventDefault();
      event.stopPropagation();
      tabHost.post({ type: 'requestHistory', tabId: tabHost.tabId });
      return;
    }
    if (event.key === 'F6' && !mod && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      toggleFocusMode();
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

