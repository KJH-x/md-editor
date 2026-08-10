import { DockviewComponent } from '../vendor/dockview/index.mjs';

var THEME_KEY = 'md-theme';
var PAGE_WIDTH_KEY = 'md-pagewidth';
var LAYOUT_KEY = 'md-editor-layout';
var THEME_CYCLE = ['light', 'dark', 'auto'];
var LANG_CYCLE = ['zh-CN', 'en-US', 'es-ES', 'hi-IN', 'ar-AR'];
var MD_COMPONENT = 'vditor-tab';
var MD_THEMES = {
  light: { name: 'md-shell-light', className: 'md-dockview md-dockview-light', colorScheme: 'light' },
  dark: { name: 'md-shell-dark', className: 'md-dockview md-dockview-dark', colorScheme: 'dark' }
};

var tabs = new Map();
var dockview = null;
var layoutTimer = null;
var statusTimer = null;

var theme = safeStorageGet(THEME_KEY) || 'auto';
var pageWidth = safeStorageGet(PAGE_WIDTH_KEY) || '';

document.documentElement.setAttribute('data-theme', resolveTheme(theme));

function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (err) {
    return false;
  }
}

function resolveTheme(value) {
  if (value === 'auto') {
    var darkMedia = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    return darkMedia && darkMedia.matches ? 'dark' : 'light';
  }
  return value === 'dark' ? 'dark' : 'light';
}

function el(id) {
  return document.getElementById(id);
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function newDocId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'doc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function deriveTitle(markdown) {
  var match = String(markdown || '').match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : mdI18n.t('untitled');
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

function postToEntry(entry, message) {
  if (!entry || !entry.iframe || !entry.iframe.contentWindow) return;
  try {
    entry.iframe.contentWindow.postMessage(message, window.location.origin);
  } catch (err) {}
}

function broadcastToAll(message) {
  tabs.forEach(function (entry) {
    postToEntry(entry, message);
  });
}

function ensureInit(entry) {
  if (!entry || !entry.iframe) return;
  postToEntry(entry, {
    type: 'init',
    content: entry.doc ? entry.doc.markdown : '',
    title: entry.doc ? (entry.doc.title || '') : '',
    lang: mdI18n.lang,
    theme: theme,
    pageWidth: pageWidth
  });
}

function createVditorTabRenderer(options) {
  var id = options.id;
  var element = document.createElement('div');
  element.className = 'md-tab-view';

  var renderer = {
    element: element,
    init: function (parameters) {
      var doc = parameters.params && parameters.params.doc ? parameters.params.doc : null;
      var iframe = document.createElement('iframe');
      iframe.className = 'md-tab-view__iframe';
      var src = new URL('vditor-shell.html', document.baseURI);
      src.searchParams.set('tabId', id);
      src.searchParams.set('lang', mdI18n.lang);
      src.searchParams.set('theme', theme);
      if (pageWidth) src.searchParams.set('pageWidth', pageWidth);
      iframe.src = src.href;
      iframe.title = (doc && doc.title) || id;
      iframe.setAttribute('aria-label', iframe.title);
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      element.appendChild(iframe);
      tabs.set(id, {
        id: id,
        iframe: iframe,
        doc: doc,
        ready: false,
        dirty: false,
        saveState: 'idle'
      });
      iframe.addEventListener('load', function () {
        setTimeout(function () {
          var entry = tabs.get(id);
          if (entry && !entry.ready) ensureInit(entry);
        }, 600);
      });
    },
    onShow: function () {},
    onHide: function () {},
    focus: function () {
      var entry = tabs.get(id);
      if (entry && entry.iframe && entry.iframe.focus) entry.iframe.focus();
    },
    dispose: function () {
      tabs.delete(id);
    }
  };
  return renderer;
}

function setPanelTitle(id, dirty) {
  var panel = dockview.api.getPanel(id);
  if (!panel) return;
  var entry = tabs.get(id);
  var base = (entry && entry.doc && entry.doc.title) || id;
  panel.api.setTitle((dirty ? '● ' : '') + base);
}

function initDockview() {
  var container = el('dockview-container');
  dockview = new DockviewComponent(container, {
    createComponent: function (options) {
      if (options.name === MD_COMPONENT) return createVditorTabRenderer(options);
      var fallback = document.createElement('div');
      fallback.className = 'md-tab-view';
      fallback.textContent = options.name;
      return {
        element: fallback,
        init: function () {}
      };
    },
    className: 'md-dockview',
    theme: MD_THEMES[resolveTheme(theme)],
    singleTabMode: 'fullwidth',
    defaultRenderer: 'always',
    disableFloatingGroups: true,
    tabGroupAccent: 'off',
    noPanelsOverlay: 'emptyGroup'
  });

  var api = dockview.api;

  api.onDidLayoutChange(function () {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(persistLayout, 300);
  });
  api.onDidRemovePanel(function () {
    updateChrome();
    if (api.totalPanels === 0) createAndOpenEmptyDoc();
  });
  api.onDidAddPanel(function () {
    updateChrome();
  });
  api.onDidActivePanelChange(function () {
    updateStatusbar();
  });
}

function handleChange(entry, data) {
  if (!entry.doc) entry.doc = {};
  entry.doc.id = entry.id;
  entry.doc.title = data.title || entry.doc.title || mdI18n.t('untitled');
  entry.doc.markdown = typeof data.content === 'string' ? data.content : entry.doc.markdown;
  entry.doc.updatedAt = typeof data.updatedAt === 'number' ? data.updatedAt : Date.now();
  entry.dirty = true;
  setPanelTitle(entry.id, true);
  window.MDStore.putDoc(entry.doc).then(function () {
    entry.dirty = false;
    setPanelTitle(entry.id, false);
    updateStatusbar();
  }).catch(function () {
    entry.dirty = true;
    setPanelTitle(entry.id, true);
  });
  updateStatusbar();
}

window.addEventListener('message', function (event) {
  if (event.origin !== window.location.origin) return;
  var data = event.data;
  if (!data || typeof data.type !== 'string') return;
  var tabId = data.tabId;
  if (tabId === undefined || tabId === null) return;
  var entry = tabs.get(tabId);
  if (!entry) return;
  if (event.source !== entry.iframe.contentWindow) return;
  if (data.type === 'ready') {
    entry.ready = true;
    ensureInit(entry);
  } else if (data.type === 'change') {
    handleChange(entry, data);
  } else if (data.type === 'saveResult') {
    entry.saveState = data.ok ? 'saved' : 'error';
    updateStatusbar();
    showStatus(data.ok ? mdI18n.t('save.saved') : mdI18n.t('save.error'), !data.ok);
  } else if (data.type === 'requestOpen') {
    openFileIntoActive();
  } else if (data.type === 'focus') {
    var panel = dockview.api.getPanel(tabId);
    if (panel && dockview.api.activePanel !== panel) panel.api.setActive();
  }
}, false);

function openDoc(doc) {
  if (!doc || !doc.id) return null;
  var api = dockview.api;
  var existing = api.getPanel(doc.id);
  if (existing) {
    if (api.activePanel !== existing) existing.api.setActive();
    return existing;
  }
  return api.addPanel({
    id: doc.id,
    component: MD_COMPONENT,
    params: { doc: doc },
    title: doc.title || 'untitled'
  });
}

function createAndOpenEmptyDoc() {
  var doc = {
    id: newDocId(),
    title: mdI18n.t('untitled'),
    markdown: '',
    updatedAt: Date.now()
  };
  window.MDStore.putDoc(doc).then(function () {
    openDoc(doc);
  }).catch(function () {
    openDoc(doc);
  });
}

function createWelcomeDoc() {
  var markdown = buildWelcomeDoc();
  var doc = {
    id: newDocId(),
    title: deriveTitle(markdown),
    markdown: markdown,
    updatedAt: Date.now()
  };
  window.MDStore.putDoc(doc).then(function () {
    openDoc(doc);
  }).catch(function () {
    openDoc(doc);
  });
}

function newTab() {
  createAndOpenEmptyDoc();
}

function closeActiveTab() {
  var panel = dockview.api.activePanel;
  if (!panel) return;
  var entry = tabs.get(panel.id);
  if (entry && entry.doc) {
    entry.doc.updatedAt = Date.now();
    window.MDStore.putDoc(entry.doc).catch(function () {});
  }
  panel.api.close();
}

function nextTab() {
  var api = dockview.api;
  var panels = api.panels;
  if (panels.length < 2) return;
  var active = api.activePanel;
  var idx = active ? panels.indexOf(active) : -1;
  var next = panels[(idx + 1) % panels.length];
  if (next) next.api.setActive();
}

function saveActiveTab() {
  var panel = dockview.api.activePanel;
  if (!panel) return;
  var entry = tabs.get(panel.id);
  if (!entry) return;
  entry.saveState = 'saving';
  updateStatusbar();
  if (!entry.doc) entry.doc = { id: entry.id, title: '', markdown: '', updatedAt: Date.now() };
  entry.doc.updatedAt = Date.now();
  window.MDStore.putDoc(entry.doc).then(function () {
    entry.dirty = false;
    entry.saveState = 'saved';
    setPanelTitle(entry.id, false);
    updateStatusbar();
    showStatus(mdI18n.t('save.saved'));
  }).catch(function () {
    entry.saveState = 'error';
    updateStatusbar();
    showStatus(mdI18n.t('save.error'), true);
  });
}

function cycleTheme() {
  var idx = THEME_CYCLE.indexOf(theme);
  applyShellTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
}

function applyShellTheme(next) {
  theme = next;
  var effective = resolveTheme(next);
  document.documentElement.setAttribute('data-theme', effective);
  safeStorageSet(THEME_KEY, next);
  if (dockview) dockview.updateOptions({ theme: MD_THEMES[effective] });
  broadcastToAll({ type: 'setTheme', theme: next });
  updateStatusbar();
}

function cycleLang() {
  var idx = LANG_CYCLE.indexOf(mdI18n.lang);
  applyShellLang(LANG_CYCLE[(idx + 1) % LANG_CYCLE.length]);
}

function applyShellLang(next) {
  if (next === mdI18n.lang) return;
  mdI18n.setLang(next);
  updateStatusbar();
  broadcastToAll({ type: 'setLang', lang: next });
}

function applyShellPageWidth(value) {
  pageWidth = String(value || '');
  safeStorageSet(PAGE_WIDTH_KEY, pageWidth);
  broadcastToAll({ type: 'setPageWidth', pageWidth: pageWidth });
  updateStatusbar();
}

function promptPageWidth() {
  if (!window.MDModal) return;
  window.MDModal.prompt({
    title: mdI18n.t('pagewidth.title'),
    label: mdI18n.t('pagewidth.prompt'),
    value: pageWidth,
    confirmLabel: mdI18n.t('dialog.promptOk'),
    cancelLabel: mdI18n.t('dialog.cancel'),
    validate: function (v) {
      return (v === '' || (/^\d+$/.test(v) && parseInt(v, 10) >= 0))
        ? null : mdI18n.t('pagewidth.invalid');
    }
  }).then(function (result) {
    if (result !== null) applyShellPageWidth(result);
  });
}

function exportAllDocs() {
  window.MDStore.exportJSON().then(function (json) {
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'md-editor-export.json';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showStatus(mdI18n.t('shell.exportDone'));
  }).catch(function () {
    showStatus(mdI18n.t('save.error'), true);
  });
}

function readFile() {
  return new Promise(function (resolve, reject) {
    if (window.MDFsa && window.MDFsa.supported()) {
      window.MDFsa.openFile().then(function (result) {
        resolve(result);
      }, function (err) {
        if (err && err.name === 'AbortError') resolve(null);
        else reject(err);
      });
      return;
    }
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      file.arrayBuffer().then(function (buffer) {
        var decoded = window.mdFileIO.decodeFile(buffer);
        resolve({ text: decoded.text, encoding: decoded.encoding, name: file.name });
      }, reject);
    });
    input.click();
  });
}

function openFileIntoActive() {
  var panel = dockview.api.activePanel;
  if (!panel) return;
  var entry = tabs.get(panel.id);
  if (!entry) return;
  var apply = function (result) {
    if (!result) return;
    if (result.encoding && result.encoding !== 'utf-8') {
      showStatus(mdI18n.t('file.openedWith').replace('{encoding}', result.encoding.toUpperCase()));
    }
    entry.doc = entry.doc || {};
    entry.doc.id = entry.id;
    entry.doc.markdown = result.text;
    entry.doc.title = deriveTitle(result.text);
    entry.doc.updatedAt = Date.now();
    entry.dirty = false;
    window.MDStore.putDoc(entry.doc).then(function () {
      setPanelTitle(entry.id, false);
    }).catch(function () {});
    postToEntry(entry, {
      type: 'init',
      content: result.text,
      title: entry.doc.title,
      lang: mdI18n.lang,
      theme: theme,
      pageWidth: pageWidth
    });
    updateStatusbar();
  };
  var open = function () {
    readFile().then(apply, function () {
      showStatus(mdI18n.t('file.readError').replace('{name}', 'file'), true);
    });
  };
  if (entry.doc && entry.doc.markdown && String(entry.doc.markdown).trim() !== '') {
    window.MDModal.confirm({
      title: mdI18n.t('dialog.openConfirmTitle'),
      message: mdI18n.t('dialog.openConfirm'),
      confirmLabel: mdI18n.t('dialog.confirm'),
      cancelLabel: mdI18n.t('dialog.cancel'),
      danger: true
    }).then(function (ok) {
      if (ok) open();
    });
  } else {
    open();
  }
}

function persistLayout() {
  if (!dockview) return;
  var layout;
  try {
    layout = dockview.toJSON();
  } catch (err) {
    return;
  }
  var data = {
    v: 1,
    savedAt: Date.now(),
    activeId: dockview.api.activePanel ? dockview.api.activePanel.id : null,
    layout: layout
  };
  safeStorageSet(LAYOUT_KEY, JSON.stringify(data));
}

function hasLayoutPanels(layout) {
  return !!(layout && layout.panels && Object.keys(layout.panels).length > 0);
}

function pruneLayout(layout, ids) {
  if (layout.panels) {
    Object.keys(layout.panels).forEach(function (key) {
      if (!ids.has(key)) delete layout.panels[key];
    });
  }
  if (layout.grid && layout.grid.root) {
    layout.grid.root = pruneGridNode(layout.grid.root, ids);
    if (layout.grid.root && layout.grid.root.type === 'leaf') {
      layout.grid.root = { type: 'branch', data: [layout.grid.root], size: layout.grid.root.size };
    }
  }
  if (Array.isArray(layout.floatingGroups)) {
    layout.floatingGroups = layout.floatingGroups.filter(function (group) {
      if (!group || !group.data || !Array.isArray(group.data.views)) return false;
      group.data.views = group.data.views.filter(function (view) { return ids.has(view); });
      return group.data.views.length > 0;
    });
  }
  if (Array.isArray(layout.popoutGroups)) {
    layout.popoutGroups = layout.popoutGroups.filter(function (group) {
      if (!group || !group.data || !Array.isArray(group.data.views)) return false;
      group.data.views = group.data.views.filter(function (view) { return ids.has(view); });
      return group.data.views.length > 0;
    });
  }
}

function pruneGridNode(node, ids) {
  if (!node) return null;
  if (node.type === 'leaf') {
    var data = node.data;
    if (!data || !Array.isArray(data.views)) return null;
    data.views = data.views.filter(function (view) { return ids.has(view); });
    if (data.views.length === 0) return null;
    if (data.activeView && !ids.has(data.activeView)) data.activeView = data.views[0];
    return node;
  }
  if (node.type === 'branch') {
    var children = (node.data || []).map(function (child) {
      return pruneGridNode(child, ids);
    }).filter(Boolean);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    node.data = children;
    return node;
  }
  return node;
}

function restoreLayout(ids) {
  var raw = safeStorageGet(LAYOUT_KEY);
  if (!raw) return null;
  var data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (!data || !data.layout) return null;
  pruneLayout(data.layout, ids);
  if (!hasLayoutPanels(data.layout)) return null;
  try {
    dockview.fromJSON(data.layout);
  } catch (err) {
    return null;
  }
  var activeId = data.activeId;
  if (activeId) {
    var panel = dockview.api.getPanel(activeId);
    if (panel && dockview.api.activePanel !== panel) panel.api.setActive();
  }
  return data.layout;
}

function refreshPanelDocs() {
  var api = dockview.api;
  api.panels.forEach(function (panel) {
    var entry = tabs.get(panel.id);
    if (!entry) return;
    window.MDStore.getDoc(panel.id).then(function (doc) {
      if (!doc) {
        ensureInit(entry);
        return;
      }
      entry.doc = doc;
      var p = api.getPanel(panel.id);
      if (p) {
        var title = doc.title || mdI18n.t('untitled');
        if (p.api.title !== title) p.api.setTitle(title);
      }
      ensureInit(entry);
    }).catch(function () {
      ensureInit(entry);
    });
  });
}

function updateChrome() {
  updateTabCount();
  updateStatusbar();
}

function updateTabCount() {
  var n = dockview ? dockview.api.totalPanels : 0;
  setText(el('tab-count'), n > 0 ? String(n) : '');
}

function stateLabel(state) {
  if (state === 'saving') return mdI18n.t('save.saving');
  if (state === 'saved') return mdI18n.t('save.saved');
  if (state === 'error') return mdI18n.t('save.error');
  return '';
}

function updateStatusbar() {
  var n = dockview ? dockview.api.totalPanels : 0;
  setText(el('statusbar-docs'), mdI18n.t('statusbar.docs').replace('{n}', n));
  var active = dockview ? dockview.api.activePanel : null;
  var entry = active ? tabs.get(active.id) : null;
  var saveEl = el('statusbar-save');
  if (saveEl) {
    var dot = saveEl.querySelector('.statusbar__dot');
    var text = saveEl.querySelector('.statusbar__save-text');
    if (entry) {
      saveEl.setAttribute('data-state', entry.saveState);
      if (dot) dot.className = 'statusbar__dot statusbar__dot--' + entry.saveState;
      setText(text, stateLabel(entry.saveState));
    } else {
      saveEl.removeAttribute('data-state');
      if (dot) dot.className = 'statusbar__dot statusbar__dot--idle';
      setText(text, '');
    }
  }
  setText(el('statusbar-lang'), mdI18n.lang);
}

function showStatus(message, isError) {
  var saveEl = el('statusbar-save');
  if (!saveEl) return;
  var text = saveEl.querySelector('.statusbar__save-text');
  var dotEl = saveEl.querySelector('.statusbar__dot');
  saveEl.setAttribute('data-state', isError ? 'error' : 'saved');
  if (dotEl) dotEl.className = 'statusbar__dot statusbar__dot--' + (isError ? 'error' : 'saved');
  setText(text, message);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(function () {
    updateStatusbar();
  }, 2500);
}

function registerAction(id, label, category, shortcut, keywords, run) {
  window.MD_ACTIONS.register({
    id: id,
    label: label,
    category: category,
    shortcut: shortcut,
    keywords: keywords,
    run: run
  });
}

function registerActions() {
  if (!window.MD_ACTIONS) return;
  registerAction('shell.newtab', mdI18n.t('shell.newTab'), 'app', 'Ctrl+T',
    ['new tab', 'tab', mdI18n.t('shell.newTab')], function () { newTab(); });
  registerAction('shell.closetab', mdI18n.t('shell.closeTab'), 'app', 'Ctrl+W',
    ['close tab', 'close', mdI18n.t('shell.closeTab')], function () { closeActiveTab(); });
  registerAction('shell.nexttab', mdI18n.t('shell.nextTab'), 'app', 'Ctrl+Tab',
    ['next tab', mdI18n.t('shell.nextTab')], function () { nextTab(); });
  registerAction('shell.open', mdI18n.t('shell.openFile'), 'file', 'Ctrl+O',
    ['open', mdI18n.t('shell.openFile')], function () { openFileIntoActive(); });
  registerAction('shell.save', mdI18n.t('toolbar.save'), 'file', 'Ctrl+S',
    ['save', mdI18n.t('toolbar.save')], function () { saveActiveTab(); });
  registerAction('shell.export', mdI18n.t('shell.export'), 'file', '',
    ['export', 'json', mdI18n.t('shell.export')], function () { exportAllDocs(); });
  registerAction('shell.pagewidth', mdI18n.t('shell.pagewidth'), 'settings', '',
    ['page width', mdI18n.t('shell.pagewidth')], function () { promptPageWidth(); });
  registerAction('shell.theme', mdI18n.t('action.theme.cycle'), 'settings', '',
    ['theme', mdI18n.t('action.theme.cycle')], function () { cycleTheme(); });
  registerAction('shell.lang', mdI18n.t('action.lang.switch'), 'settings', '',
    ['lang', 'language', mdI18n.t('action.lang.switch')], function () { cycleLang(); });
}

function bindShortcuts() {
  var overlay = el('shortcut-overlay');
  var lastFocused = null;

  function openOverlay() {
    if (!overlay) return;
    lastFocused = document.activeElement;
    overlay.hidden = false;
    var panel = overlay.querySelector('.shortcut-overlay__panel');
    if (panel) panel.focus();
  }

  function closeOverlay() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
    lastFocused = null;
  }

  function toggleOverlay() {
    if (overlay && !overlay.hidden) closeOverlay();
    else openOverlay();
  }

  if (overlay) {
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay ||
          (event.target.classList && event.target.classList.contains('shortcut-overlay__close')) ||
          (event.target.classList && event.target.classList.contains('shortcut-overlay__backdrop'))) {
        closeOverlay();
      }
    });
  }

  window.addEventListener('keydown', function (event) {
    if (event.isComposing || event.repeat) return;
    var mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Tab' && event.ctrlKey) {
      event.preventDefault();
      nextTab();
      return;
    }
    var key = event.key.toLowerCase();
    if (mod && key === 't') {
      event.preventDefault();
      event.stopPropagation();
      newTab();
      return;
    }
    if (mod && key === 'w') {
      event.preventDefault();
      event.stopPropagation();
      closeActiveTab();
      return;
    }
    if (mod && key === 's') {
      event.preventDefault();
      event.stopPropagation();
      saveActiveTab();
      return;
    }
    if (mod && key === 'o') {
      event.preventDefault();
      event.stopPropagation();
      openFileIntoActive();
      return;
    }
    if (mod && key === 'k' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      if (window.MDCommandPalette) window.MDCommandPalette.toggle();
      return;
    }
    if (event.key === '?' && !mod && !event.altKey) {
      toggleOverlay();
      return;
    }
    if (event.key === 'Escape' && overlay && !overlay.hidden) {
      closeOverlay();
    }
  }, true);
}

function bindSystemTheme() {
  var darkMedia = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  if (!darkMedia) return;
  var onChange = function () {
    if (theme === 'auto') applyShellTheme('auto');
  };
  if (darkMedia.addEventListener) darkMedia.addEventListener('change', onChange);
  else if (darkMedia.addListener) darkMedia.addListener(onChange);
}

function bindSwUpdate() {
  window.addEventListener('md-sw-update', function () {
    showStatus(mdI18n.t('sw.updateReady'));
  });
}

function boot() {
  initDockview();

  var newTabBtn = el('new-tab');
  if (newTabBtn) newTabBtn.addEventListener('click', function () { newTab(); });

  var docsPromise = window.MDStore.migrateLegacy()
    .catch(function () { return null; })
    .then(function () { return window.MDStore.listDocs(); })
    .catch(function () { return []; });

  docsPromise.then(function (docs) {
    var list = docs || [];
    var ids = new Set(list.map(function (d) { return d.id; }));
    var restored = restoreLayout(ids);
    if (!restored) {
      var doc = list.length ? list[0] : null;
      if (doc) openDoc(doc);
      else createWelcomeDoc();
    }
    refreshPanelDocs();
    updateChrome();
  });

  registerActions();
  bindShortcuts();
  bindSystemTheme();
  bindSwUpdate();
  applyShellTheme(theme);
  mdI18n.applyI18n();
}

boot();
