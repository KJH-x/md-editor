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

var conflictSource = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
var conflictChannel = null;
if ('BroadcastChannel' in window) {
  conflictChannel = new BroadcastChannel('md-editor-docs');
  conflictChannel.onmessage = function (event) {
    var data = event.data;
    if (!data || data.type !== 'docSaved' || !data.docId) return;
    if (data.source === conflictSource) return;
    handleRemoteSave(data);
  };
}

function broadcastDocSaved(docId, updatedAt) {
  if (!conflictChannel) return;
  var entry = tabs.get(docId);
  try {
    conflictChannel.postMessage({
      type: 'docSaved',
      docId: docId,
      updatedAt: updatedAt || Date.now(),
      source: conflictSource,
      markdown: entry && entry.doc ? entry.doc.markdown : ''
    });
  } catch (err) {}
}

function handleRemoteSave(data) {
  var entry = tabs.get(data.docId);
  if (!entry || !entry.dirty || entry.closing) return;
  if (typeof data.markdown !== 'string') return;
  if (entry.doc && entry.doc.updatedAt && data.updatedAt &&
      data.updatedAt <= entry.doc.updatedAt) return;
  if (!window.MDModal) return;
  window.MDModal.choice({
    title: mdI18n.t('conflict.title'),
    message: mdI18n.t('conflict.message'),
    options: [
      { label: mdI18n.t('conflict.keepLocal'), value: 'keep', primary: true },
      { label: mdI18n.t('conflict.useRemote'), value: 'remote' },
      { label: mdI18n.t('conflict.saveCopy'), value: 'copy' },
      { label: mdI18n.t('dialog.cancel'), value: null }
    ]
  }).then(function (choice) {
    if (choice === 'remote') applyRemoteContent(entry, data);
    else if (choice === 'copy') saveRemoteCopy(entry, data);
  });
}

function applyRemoteContent(entry, data) {
  entry.doc = entry.doc || {};
  entry.doc.id = entry.id;
  entry.doc.markdown = data.markdown;
  entry.doc.title = deriveTitle(data.markdown);
  entry.doc.updatedAt = data.updatedAt || Date.now();
  entry.dirty = false;
  window.MDStore.putDoc(entry.doc).then(function () {
    setPanelTitle(entry.id, false);
  }).catch(function () {});
  ensureInit(entry);
  updateStatusbar();
  showStatus(mdI18n.t('conflict.remoteApplied'));
}

function saveRemoteCopy(entry, data) {
  var copy = {
    id: newDocId(),
    title: deriveTitle(data.markdown) + ' (' + mdI18n.t('conflict.copySuffix') + ')',
    markdown: data.markdown,
    updatedAt: Date.now()
  };
  if (entry.doc) {
    if (Array.isArray(entry.doc.tags)) copy.tags = entry.doc.tags.slice();
    if (entry.doc.folder) copy.folder = entry.doc.folder;
  }
  window.MDStore.putDoc(copy).then(function () {
    openDoc(copy);
    showStatus(mdI18n.t('conflict.copySaved'));
  }).catch(function () {
    showStatus(mdI18n.t('save.error'), true);
  });
}

function ensureInit(entry) {
  if (!entry || !entry.iframe) return;
  postToEntry(entry, {
    type: 'init',
    docId: entry.doc && entry.doc.id ? entry.doc.id : entry.id,
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
      var src = new URL('vditor-shell', document.baseURI);
      src.searchParams.set('tabId', id);
      src.searchParams.set('lang', mdI18n.lang);
      src.searchParams.set('theme', theme);
      if (pageWidth) src.searchParams.set('pageWidth', pageWidth);
      iframe.src = src.href;
      iframe.title = (doc && doc.title) || id;
      iframe.setAttribute('aria-label', iframe.title);
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-modals allow-downloads');
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
  entry.stats = data.stats || entry.stats;
  entry.dirty = true;
  setPanelTitle(entry.id, true);
  window.MDStore.putDoc(entry.doc).catch(function () {});
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
    if (entry.closing) return;
    handleChange(entry, data);
  } else if (data.type === 'saveResult') {
    if (data.ok && typeof data.content === 'string') {
      entry.doc = entry.doc || {};
      entry.doc.id = entry.id;
      entry.doc.markdown = data.content;
      entry.doc.title = data.title || entry.doc.title;
      entry.doc.updatedAt = data.updatedAt || Date.now();
      entry.stats = data.stats || entry.stats;
      entry.dirty = false;
      setPanelTitle(entry.id, false);
      broadcastDocSaved(entry.id, entry.doc.updatedAt);
    }
    entry.saveState = data.ok ? 'saved' : 'error';
    updateStatusbar();
    showStatus(data.ok ? mdI18n.t('save.saved') : mdI18n.t('save.error'), !data.ok);
    if (!data.ok && window.MDModal) {
      window.MDModal.choice({
        title: mdI18n.t('save.errorTitle'),
        message: mdI18n.t('save.errorMessage'),
        options: [
          { label: mdI18n.t('save.retry'), value: 'retry', primary: true },
          { label: mdI18n.t('save.exportBackup'), value: 'export' },
          { label: mdI18n.t('dialog.cancel'), value: null }
        ]
      }).then(function (choice) {
        if (choice === 'retry') postToEntry(entry, { type: 'requestSave', tabId: entry.id });
        else if (choice === 'export') exportAllDocs();
      });
    }
    if (entry.onSaveResult) {
      var cb = entry.onSaveResult;
      entry.onSaveResult = null;
      cb(data);
    }
    if (entry.onDrainResult) {
      var cb2 = entry.onDrainResult;
      entry.onDrainResult = null;
      cb2(data);
    }
  } else if (data.type === 'requestOpen') {
    openFileIntoActive();
  } else if (data.type === 'requestDocsPanel') {
    if (window.MDDocsPanel) window.MDDocsPanel.toggle();
  } else if (data.type === 'requestHistory') {
    var historyPanel = dockview.api.getPanel(tabId);
    if (historyPanel && dockview.api.activePanel !== historyPanel) historyPanel.api.setActive();
    var historyEntry = tabs.get(tabId);
    if (historyEntry) openHistoryDrawerFor(historyEntry);
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

function panelFromTab(tabElement) {
  if (!dockview || !tabElement) return null;
  var id = tabElement.getAttribute('data-panel-id');
  return id ? dockview.api.getPanel(id) : null;
}

function doClosePanel(panel) {
  if (!panel) return;
  var entry = tabs.get(panel.id);
  if (entry) {
    entry.closing = true;
    drainAndClose(entry, panel);
  } else {
    panel.api.close();
  }
}

var SNAP_KEEP = 20;
var SNAP_TIMER_MS = 5 * 60 * 1000;
var SNAP_MIN_INTERVAL = 60 * 1000;
var lastSnapshotAt = {};

function drainSave(entry) {
  if (!entry || !entry.ready || !entry.iframe || !entry.iframe.contentWindow) {
    return Promise.resolve(entry && entry.doc ? entry.doc.markdown : '');
  }
  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      resolve(entry.doc ? entry.doc.markdown : '');
    }, 1500);
    entry.onDrainResult = function (result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      entry.onDrainResult = null;
      var markdown = result && result.ok && typeof result.content === 'string'
        ? result.content : (entry.doc ? entry.doc.markdown : '');
      resolve(markdown);
    };
    postToEntry(entry, { type: 'requestSave', tabId: entry.id });
  });
}

function snapshotAndPrune(docId) {
  var latest = null;
  return window.MDStore.getLatestSnapshot(docId).then(function (record) {
    latest = record;
    return window.MDStore.getDoc(docId);
  }).then(function (doc) {
    if (!doc || typeof doc.markdown !== 'string') return null;
    if (latest && latest.markdown === doc.markdown) return null;
    return window.MDStore.snapshot(docId).then(function (record) {
      return window.MDStore.pruneSnapshots(docId, SNAP_KEEP).then(function (prune) {
        return { snapshot: record, pruned: prune && prune.pruned };
      });
    });
  }).catch(function (err) {
    if (window.console && console.error) console.error('[md-snapshot] failed for ' + docId, err);
    return null;
  });
}

function finishClose(entry, panel) {
  snapshotAndPrune(entry.id).then(function () {
    panel.api.close();
  });
}

function snapshotActiveDoc() {
  var panel = dockview.api.activePanel;
  if (!panel) return;
  var entry = tabs.get(panel.id);
  if (!entry) return;
  var before = entry.dirty ? drainSave(entry) : Promise.resolve('');
  before.then(function () {
    return snapshotAndPrune(entry.id);
  }).then(function (result) {
    if (!result) showStatus(mdI18n.t('history.snapshotFailed'), true);
    else if (!result.snapshot) showStatus(mdI18n.t('history.snapshotSkipped'), true);
    else showStatus(mdI18n.t('history.snapshotted'));
  });
}

function scheduledSnapshotTick() {
  var now = Date.now();
  tabs.forEach(function (entry) {
    if (!entry || !entry.dirty) return;
    var last = lastSnapshotAt[entry.id] || 0;
    if (now - last < SNAP_MIN_INTERVAL) return;
    snapshotAndPrune(entry.id).then(function () {
      lastSnapshotAt[entry.id] = Date.now();
    });
  });
}

function drainAndClose(entry, panel) {
  var done = false;
  var timer = setTimeout(function () {
    if (done) return;
    done = true;
    window.MDStore.getDoc(entry.id).then(function (fresh) {
      if (fresh) entry.doc = fresh;
      else if (entry.doc && entry.doc.markdown) return window.MDStore.putDoc(entry.doc);
    }).then(function () {
      finishClose(entry, panel);
    }, function () {
      finishClose(entry, panel);
    });
  }, 1500);

  entry.onSaveResult = function (result) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    finishClose(entry, panel);
  };

  if (!entry.ready || !entry.iframe || !entry.iframe.contentWindow) {
    if (entry.doc && entry.doc.markdown) {
      window.MDStore.putDoc(entry.doc).catch(function () {});
    }
    done = true;
    clearTimeout(timer);
    finishClose(entry, panel);
    return;
  }
  postToEntry(entry, { type: 'requestSave', tabId: entry.id });
}

function openHistoryForActive() {
  var panel = dockview.api.activePanel;
  if (!panel) return;
  var entry = tabs.get(panel.id);
  if (!entry) return;
  openHistoryDrawerFor(entry);
}

function openHistoryDrawerFor(entry) {
  if (!window.MDHistoryDrawer) return;
  window.MDHistoryDrawer.open({
    docId: entry.id,
    getCurrent: function () {
      return Promise.resolve(entry.doc ? entry.doc.markdown : '');
    },
    onRestore: function (snapshot) { return restoreFromSnapshot(entry, snapshot); }
  });
}

function restoreFromSnapshot(entry, snapshot) {
  if (!entry) {
    return window.MDStore.putDoc({
      id: snapshot.docId,
      title: deriveTitle(snapshot.markdown),
      markdown: snapshot.markdown,
      updatedAt: Date.now()
    }).then(function () { return true; }).catch(function () { return false; });
  }
  return drainSave(entry).then(function () {
    return snapshotAndPrune(entry.id);
  }).then(function () {
    var doc = {
      id: entry.id,
      title: deriveTitle(snapshot.markdown),
      markdown: snapshot.markdown,
      updatedAt: Date.now()
    };
    entry.doc = doc;
    entry.dirty = false;
    entry.saveState = 'saved';
    return window.MDStore.putDoc(doc);
  }).then(function () {
    ensureInit(entry);
    setPanelTitle(entry.id, false);
    updateStatusbar();
    showStatus(mdI18n.t('history.restored'));
    return true;
  }).catch(function () {
    showStatus(mdI18n.t('history.restoreFailed'), true);
    return false;
  });
}

function closePanel(panel) {
  if (!panel) return Promise.resolve();
  var entry = tabs.get(panel.id);
  if (entry && entry.dirty && window.MDModal) {
    return window.MDModal.confirm({
      title: mdI18n.t('shell.closeConfirmTitle'),
      message: mdI18n.t('shell.closeConfirm'),
      confirmLabel: mdI18n.t('dialog.confirm'),
      cancelLabel: mdI18n.t('dialog.cancel'),
      danger: true
    }).then(function (ok) {
      if (ok) doClosePanel(panel);
    });
  }
  doClosePanel(panel);
  return Promise.resolve();
}

function closeActiveTab() {
  var panel = dockview.api.activePanel;
  if (!panel) return;
  closePanel(panel);
}

function tagTabElements() {
  if (!dockview || !dockview.api) return;
  try {
    var seen = {};
    dockview.api.panels.forEach(function (p) {
      var g = p.api && p.api.group;
      if (!g || !g.element) return;
      if (seen[g.element]) return;
      seen[g.element] = true;
      var tabsEl = g.element.querySelector('.dv-tabs-container') || g.element.querySelector('.dv-tabs');
      if (!tabsEl) return;
      var tabEls = Array.prototype.filter.call(tabsEl.querySelectorAll('.dv-tab'), function (el) {
        return el.parentElement === tabsEl;
      });
      var groupPanels = g.panels || [];
      tabEls.forEach(function (tabEl, i) {
        var pid = groupPanels[i] && groupPanels[i].id;
        if (pid) tabEl.setAttribute('data-panel-id', pid);
      });
    });
  } catch (err) {}
}

function ensureAddButtons() {
  var label = mdI18n ? mdI18n.t('shell.newTab') : '+';
  Array.prototype.forEach.call(document.querySelectorAll('.dv-tabs-container, .dv-tabs'), function (tabsEl) {
    if (tabsEl.querySelector('.md-tab-add')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-tab-add';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.textContent = '+';
    btn.addEventListener('click', function (event) {
      event.stopPropagation();
      event.preventDefault();
      newTab();
    });
    tabsEl.appendChild(btn);
  });
}

function tagAndChrome() {
  tagTabElements();
  ensureAddButtons();
}

window.__mdShellTest = {
  tagAndChrome: tagAndChrome,
  tagTabElements: tagTabElements,
  panelFromTab: panelFromTab,
  getDockview: function () { return dockview; }
};

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
  if (!entry.ready) {
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
    return;
  }
  entry.saveState = 'saving';
  updateStatusbar();
  postToEntry(entry, { type: 'requestSave', tabId: entry.id });
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

function downloadJSON(blob, filename) {
  var url = URL.createObjectURL(blob);
  var anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function readJSONFile() {
  return new Promise(function (resolve, reject) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) { resolve(null); return; }
      if (file.size > 200 * 1024 * 1024) {
        reject(new Error('file too large'));
        return;
      }
      file.text().then(function (text) {
        var parsed;
        try { parsed = JSON.parse(text); }
        catch (err) { reject(new Error('invalid JSON')); return; }
        resolve({ name: file.name, json: parsed });
      }, reject);
    });
    input.click();
  });
}

function importBackup() {
  readJSONFile().then(function (result) {
    if (!result) return;
    var parsed = result.json;
    if (!parsed || !Array.isArray(parsed.docs)) {
      showStatus(mdI18n.t('import.invalid'), true);
      return;
    }
    if (!parsed.docs.length) {
      showStatus(mdI18n.t('import.empty'), true);
      return;
    }
    window.MDModal.choice({
      title: mdI18n.t('import.title'),
      message: mdI18n.t('import.chooseMode').replace('{n}', String(parsed.docs.length)),
      options: [
        { label: mdI18n.t('import.merge'), value: 'merge', primary: true },
        { label: mdI18n.t('import.replace'), value: 'replace', danger: true },
        { label: mdI18n.t('dialog.cancel'), value: null }
      ]
    }).then(function (mode) {
      if (mode === null) return null;
      if (mode === 'replace') {
        return window.MDStore.exportJSON().then(function (backupJson) {
          downloadJSON(new Blob([backupJson], { type: 'application/json' }),
            'md-editor-backup-before-replace.json');
          return window.MDModal.confirm({
            title: mdI18n.t('import.replaceTitle'),
            message: mdI18n.t('import.replaceConfirm').replace('{n}', String(parsed.docs.length)),
            confirmLabel: mdI18n.t('dialog.confirm'),
            cancelLabel: mdI18n.t('dialog.cancel'),
            danger: true
          }).then(function (ok) {
            return ok ? window.MDStore.importJSON(parsed, 'replace') : null;
          });
        });
      }
      return window.MDStore.importJSON(parsed, 'merge');
    }).then(function (result) {
      if (!result) return;
      showStatus(mdI18n.t('import.done')
        .replace('{added}', String(result.added))
        .replace('{skipped}', String(result.skipped)));
      if (window.MDDocsPanel && window.MDDocsPanel.refresh) window.MDDocsPanel.refresh();
      return window.MDStore.listDocs().then(function (docs) {
        if (docs && docs.length) openDoc(docs[0]);
      });
    }).catch(function (err) {
      showStatus(err && err.message === 'invalid JSON' ? mdI18n.t('import.invalid')
        : mdI18n.t('import.failed'), true);
    });
  }).catch(function (err) {
    showStatus(err && err.message === 'invalid JSON' ? mdI18n.t('import.invalid')
      : mdI18n.t('import.failed'), true);
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
  var countsEl = el('statusbar-counts');
  if (countsEl) {
    var stats = entry && entry.stats;
    setText(countsEl, stats ? mdI18n.t('statusbar.counts')
      .replace('{chars}', stats.chars).replace('{words}', stats.words) : '');
  }
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
  registerAction('file.importBackup', mdI18n.t('shell.importBackup'), 'file', '',
    ['import', 'restore', 'backup', 'json', mdI18n.t('shell.importBackup')],
    function () { importBackup(); });
  registerAction('docs.open', mdI18n.t('docs.open'), 'file', '',
    ['open doc', 'document', 'docs', mdI18n.t('docs.open')],
    function () { openDocsPicker(); });
  registerAction('docs.search', mdI18n.t('docs.search'), 'file', '',
    ['search doc', 'docs', mdI18n.t('docs.search')],
    function () {
      if (window.MDDocsPanel) { window.MDDocsPanel.open(); window.MDDocsPanel.focusSearch(); }
    });
  registerAction('docs.toggle', mdI18n.t('docs.toggle'), 'file', 'Ctrl+Shift+O',
    ['docs', 'library', 'panel', mdI18n.t('docs.toggle')],
    function () { if (window.MDDocsPanel) window.MDDocsPanel.toggle(); });
  registerAction('docs.history', mdI18n.t('history.open'), 'file', '',
    ['history', 'snapshot', 'version', 'restore', mdI18n.t('history.open')],
    function () { openHistoryForActive(); });
  registerAction('docs.snapshot', mdI18n.t('history.snapshot'), 'file', '',
    ['snapshot', 'version', 'checkpoint', mdI18n.t('history.snapshot')],
    function () { snapshotActiveDoc(); });
  registerAction('shell.pagewidth', mdI18n.t('shell.pagewidth'), 'settings', '',
    ['page width', mdI18n.t('shell.pagewidth')], function () { promptPageWidth(); });
  registerAction('shell.theme', mdI18n.t('action.theme.cycle'), 'settings', '',
    ['theme', mdI18n.t('action.theme.cycle')], function () { cycleTheme(); });
  registerAction('shell.lang', mdI18n.t('action.lang.switch'), 'settings', '',
    ['lang', 'language', mdI18n.t('action.lang.switch')], function () { cycleLang(); });
  registerAction('app.install', mdI18n.t('pwa.install'), 'app', '',
    ['install', 'app', mdI18n.t('pwa.install')], function () { installApp(); });
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
    if (mod && key === 'o' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      openFileIntoActive();
      return;
    }
    if (mod && key === 'o' && event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      if (window.MDDocsPanel) window.MDDocsPanel.toggle();
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

var deferredInstallPrompt = null;

function bindInstallPrompt() {
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    showStatus(mdI18n.t('pwa.installReady'));
  });
  window.addEventListener('appinstalled', function () {
    deferredInstallPrompt = null;
    showStatus(mdI18n.t('pwa.installed'));
  });
}

function installApp() {
  if (!deferredInstallPrompt) {
    showStatus(mdI18n.t('pwa.installUnavailable'), true);
    return;
  }
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(function (choice) {
    if (choice && choice.outcome === 'accepted') showStatus(mdI18n.t('pwa.installed'));
    deferredInstallPrompt = null;
  }).catch(function () {
    deferredInstallPrompt = null;
  });
}

function requestPersistentStorage() {
  if (!navigator.storage || typeof navigator.storage.persist !== 'function') return;
  navigator.storage.persist().then(function (persisted) {
    if (!persisted) showStatus(mdI18n.t('pwa.persistDenied'), true);
  }).catch(function () {});
}

function flushAllBeforeReload() {
  tabs.forEach(function (entry) {
    if (entry && entry.ready) postToEntry(entry, { type: 'requestSave', tabId: entry.id });
  });
  setTimeout(function () { location.reload(); }, 700);
}

function bindSwUpdate() {
  window.addEventListener('md-sw-update', function () {
    showStatus(mdI18n.t('sw.updateReady'));
    if (!window.MDModal) return;
    window.MDModal.confirm({
      title: mdI18n.t('sw.updateTitle'),
      message: mdI18n.t('sw.updateMessage'),
      confirmLabel: mdI18n.t('dialog.confirm'),
      cancelLabel: mdI18n.t('dialog.cancel'),
      danger: false
    }).then(function (ok) {
      if (!ok) return;
      flushAllBeforeReload();
    });
  });
}

function openDocsPicker() {
  if (!window.MDDocsPanel) return;
  window.MDDocsPanel.open();
  window.MDDocsPanel.focusSearch();
}

var shellObserverTimer = null;

function bindTabInteractions() {
  document.addEventListener('auxclick', function (event) {
    if (event.button !== 1) return;
    var tab = event.target && event.target.closest ? event.target.closest('.dv-tab') : null;
    if (!tab) return;
    event.preventDefault();
    var panel = panelFromTab(tab);
    if (panel) closePanel(panel);
  }, true);

  document.addEventListener('click', function (event) {
    var action = event.target && event.target.closest ? event.target.closest('.dv-default-tab-action') : null;
    if (!action) return;
    var tab = action.closest('.dv-tab');
    var panel = panelFromTab(tab);
    if (!panel) return;
    event.preventDefault();
    event.stopPropagation();
    closePanel(panel);
  }, true);

  var shellObserver = new MutationObserver(function () {
    clearTimeout(shellObserverTimer);
    shellObserverTimer = setTimeout(tagAndChrome, 100);
  });
  shellObserver.observe(el('dockview-container'), { childList: true, subtree: true });
  tagAndChrome();
}

function boot() {
  initDockview();

  var newTabBtn = el('new-tab');
  if (newTabBtn) newTabBtn.addEventListener('click', function () { newTab(); });

  var docsToggleBtn = el('docs-toggle');
  if (docsToggleBtn) docsToggleBtn.addEventListener('click', function () {
    if (window.MDDocsPanel) window.MDDocsPanel.toggle();
  });

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
    if (window.MDDocsPanel && typeof window.MDDocsPanel.refresh === 'function') {
      window.MDDocsPanel.refresh();
    }
  });

  if (window.MDDocsPanel && typeof window.MDDocsPanel.init === 'function') {
    window.MDDocsPanel.init({ onOpen: openDoc, onDelete: handleDocDeleted, onNewTab: newTab });
  }
  document.addEventListener('md-import-backup', function () {
    importBackup();
  });
  document.addEventListener('md-doc-updated', function (event) {
    var docId = event.detail && event.detail.docId;
    if (!docId) return;
    var entry = tabs.get(docId);
    if (!entry) return;
    window.MDStore.getDoc(docId).then(function (doc) {
      if (!doc) return;
      entry.doc = doc;
      var panel = dockview.api.getPanel(docId);
      if (panel) panel.api.setTitle(doc.title || mdI18n.t('untitled'));
      if (entry.ready) ensureInit(entry);
      updateStatusbar();
    }).catch(function () {});
  });

  registerActions();
  bindShortcuts();
  bindSystemTheme();
  bindSwUpdate();
  bindInstallPrompt();
  bindTabInteractions();
  setInterval(scheduledSnapshotTick, SNAP_TIMER_MS);
  requestPersistentStorage();
  applyShellTheme(theme);
  mdI18n.applyI18n();
}

function handleDocDeleted(docId, done) {
  var entry = tabs.get(docId);
  if (entry) entry.closing = true;
  var panel = dockview.api.getPanel(docId);
  if (panel) panel.api.close();
  if (done) done();
}

boot();
