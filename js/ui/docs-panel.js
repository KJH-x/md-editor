(function () {
  'use strict';

  var SEARCH_DEBOUNCE = 300;
  var MAX_PREFETCH_CHARS = 20 * 1024 * 1024;
  var prefetchCache = {};
  var prefetchedChars = 0;

  var overlay = null;
  var listEl = null;
  var searchInput = null;
  var built = false;
  var docs = [];
  var searchTimer = null;
  var lastFocused = null;
  var onOpen = null;
  var onDelete = null;
  var onNewTab = null;

  function t(key, fallback) {
    if (window.mdI18n && typeof window.mdI18n.t === 'function') {
      var value = window.mdI18n.t(key);
      if (value !== key) return value;
    }
    return fallback;
  }

  function relativeTime(ts) {
    var diff = Date.now() - (ts || 0);
    var minute = 60 * 1000, hour = 60 * minute, day = 24 * hour;
    if (diff < minute) return t('docs.timeNow', 'just now');
    if (diff < hour) return t('docs.timeMinAgo', '{n} min ago').replace('{n}', String(Math.floor(diff / minute)));
    if (diff < day) return t('docs.timeHrAgo', '{n} hr ago').replace('{n}', String(Math.floor(diff / hour)));
    return t('docs.timeDayAgo', '{n} d ago').replace('{n}', String(Math.floor(diff / day)));
  }

  function charsOf(doc) {
    return String((doc && doc.markdown) || '').length;
  }

  function ensure() {
    if (built) return;
    built = true;
    overlay = document.createElement('aside');
    overlay.id = 'docs-panel';
    overlay.className = 'md-docs-panel';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', t('docs.title', 'Document library'));
    overlay.hidden = true;

    var header = document.createElement('div');
    header.className = 'md-docs-panel__header';
    var title = document.createElement('div');
    title.className = 'md-docs-panel__title';
    title.textContent = t('docs.title', 'Document library');
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'md-docs-panel__close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', t('history.close', 'Close'));
    closeBtn.addEventListener('click', close);
    header.appendChild(title);
    header.appendChild(closeBtn);
    overlay.appendChild(header);

    searchInput = document.createElement('input');
    searchInput.className = 'md-docs-panel__search';
    searchInput.type = 'text';
    searchInput.spellcheck = false;
    searchInput.autocomplete = 'off';
    searchInput.placeholder = t('docs.searchPlaceholder', 'Search documents…');
    searchInput.setAttribute('aria-label', searchInput.placeholder);
    searchInput.addEventListener('input', onSearchInput);
    overlay.appendChild(searchInput);

    listEl = document.createElement('div');
    listEl.className = 'md-docs-panel__list';
    overlay.appendChild(listEl);

    overlay.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });

    document.body.appendChild(overlay);
  }

  function close() {
    if (!built || overlay.hidden) return;
    overlay.hidden = true;
    if (lastFocused && lastFocused.focus && document.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  }

  function open() {
    ensure();
    lastFocused = document.activeElement;
    overlay.hidden = false;
    if (searchInput) searchInput.focus();
    refresh();
  }

  function toggle() {
    if (built && !overlay.hidden) close();
    else open();
  }

  function focusSearch() {
    ensure();
    if (overlay.hidden) open();
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    renderList(docs);
  }

  function refresh() {
    if (!built || overlay.hidden) return;
    window.MDStore.listDocs().then(function (list) {
      docs = list || [];
      prefetchDocs(docs);
      renderList(docs);
    }).catch(function () {
      renderList([]);
    });
  }

  function prefetchDocs(list) {
    if (prefetchedChars >= MAX_PREFETCH_CHARS) return;
    for (var i = 0; i < list.length; i++) {
      (function (doc) {
        if (!doc || prefetchCache[doc.id]) return;
        window.MDStore.getDoc(doc.id).then(function (full) {
          if (!full) return;
          var md = typeof full.markdown === 'string' ? full.markdown : '';
          if (!prefetchCache[doc.id]) {
            prefetchCache[doc.id] = { markdown: md, loadedAt: Date.now() };
            prefetchedChars += md.length;
          }
        }).catch(function () {});
      })(list[i]);
    }
  }

  function matchesDoc(doc, query) {
    if (!query) return true;
    var q = query.trim();
    if (!q) return true;
    var title = (doc.title || '').toLowerCase();
    var meta = ((doc.folder || '') + ' ' + (doc.tags || []).join(' ')).toLowerCase();
    var ql = q.toLowerCase();
    if (title === ql || title.indexOf(ql) === 0 || title.indexOf(ql) !== -1) return true;
    if (meta.indexOf(ql) !== -1) return true;
    var fuzzy = window.MDCommandPalette && window.MDCommandPalette.fuzzy;
    if (fuzzy && fuzzy.subsequenceMatch && fuzzy.subsequenceMatch(ql, title)) return true;
    var cached = prefetchCache[doc.id];
    if (cached && cached.markdown && cached.markdown.toLowerCase().indexOf(ql) !== -1) return true;
    return false;
  }

  function rankDoc(doc, query) {
    var ql = query.trim().toLowerCase();
    var title = (doc.title || '').toLowerCase();
    var fuzzy = window.MDCommandPalette && window.MDCommandPalette.fuzzy;
    if (title === ql) return 0;
    if (title.indexOf(ql) === 0) return 1;
    if (title.indexOf(ql) !== -1) return 2;
    if (fuzzy && typeof fuzzy.fuzzyScore === 'function') {
      var score = fuzzy.fuzzyScore(query,
        (doc.title || '') + ' ' + (doc.folder || '') + ' ' + (doc.tags || []).join(' '));
      if (score !== Number.MAX_VALUE) return 3 + score / 10000;
    }
    return 4;
  }

  function renderList(list) {
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    if (!list.length) {
      renderEmpty();
      return;
    }
    var query = searchInput ? searchInput.value : '';
    var filtered = list.filter(function (d) { return matchesDoc(d, query); });
    if (query) {
      filtered.sort(function (a, b) { return rankDoc(a, query) - rankDoc(b, query); });
    }
    if (!filtered.length) {
      var none = document.createElement('div');
      none.className = 'md-docs-panel__empty';
      none.textContent = t('docs.noResults', 'No matching documents');
      listEl.appendChild(none);
      return;
    }
    for (var i = 0; i < filtered.length; i++) {
      listEl.appendChild(buildItem(filtered[i]));
    }
  }

  function renderEmpty() {
    var box = document.createElement('div');
    box.className = 'md-docs-panel__empty';
    var p = document.createElement('p');
    p.textContent = t('docs.empty', 'No documents yet');
    box.appendChild(p);
    var actions = document.createElement('div');
    actions.className = 'md-docs-panel__empty-actions';
    var newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'md-docs-panel__btn md-docs-panel__btn--primary';
    newBtn.textContent = t('docs.newDoc', 'New document');
    newBtn.addEventListener('click', function () {
      close();
      if (onNewTab) onNewTab();
    });
    actions.appendChild(newBtn);
    var importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'md-docs-panel__btn';
    importBtn.textContent = t('docs.importBackup', 'Import backup');
    importBtn.addEventListener('click', function () {
      close();
      document.dispatchEvent(new CustomEvent('md-import-backup'));
    });
    actions.appendChild(importBtn);
    box.appendChild(actions);
    listEl.appendChild(box);
  }

  function buildItem(doc) {
    var item = document.createElement('div');
    item.className = 'md-docs-panel__item';
    item.setAttribute('role', 'option');
    item.setAttribute('data-doc-id', doc.id);

    var main = document.createElement('div');
    main.className = 'md-docs-panel__item-main';
    var title = document.createElement('div');
    title.className = 'md-docs-panel__item-title';
    title.textContent = doc.title || t('untitled', 'untitled');
    title.title = title.textContent;
    var meta = document.createElement('div');
    meta.className = 'md-docs-panel__item-meta';
    var metaText = t('docs.counts', '{chars} chars · {time}')
      .replace('{chars}', String(charsOf(doc)))
      .replace('{time}', relativeTime(doc.updatedAt));
    if (doc.folder) metaText += ' · ' + doc.folder;
    if (Array.isArray(doc.tags) && doc.tags.length) metaText += ' · ' + doc.tags.join(', ');
    meta.textContent = metaText;
    main.appendChild(title);
    main.appendChild(meta);
    item.appendChild(main);

    var actions = document.createElement('div');
    actions.className = 'md-docs-panel__item-actions';
    var openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'md-docs-panel__btn';
    openBtn.textContent = t('docs.openAction', 'Open');
    openBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      if (onOpen) onOpen(doc);
      close();
    });
    var renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'md-docs-panel__btn';
    renameBtn.textContent = t('docs.rename', 'Rename');
    renameBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      renameDoc(doc);
    });
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'md-docs-panel__btn md-docs-panel__btn--danger';
    delBtn.textContent = t('docs.delete', 'Delete');
    delBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      deleteDoc(doc);
    });
    actions.appendChild(openBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);
    item.appendChild(actions);

    item.addEventListener('click', function () {
      if (onOpen) onOpen(doc);
      close();
    });
    return item;
  }

  function renameDoc(doc) {
    if (!window.MDModal) return;
    window.MDModal.prompt({
      title: t('docs.renameTitle', 'Rename document'),
      label: t('docs.renameLabel', 'New title'),
      value: doc.title || '',
      confirmLabel: t('dialog.promptOk', 'OK'),
      cancelLabel: t('dialog.cancel', 'Cancel'),
      validate: function (v) {
        return (v && v.trim()) ? null : t('docs.renameInvalid', 'Title cannot be empty');
      }
    }).then(function (result) {
      if (result === null) return;
      var title = result.trim();
      var markdown = doc.markdown || '';
      var lines = markdown.split('\n');
      if (/^#\s+/.test(lines[0])) {
        lines[0] = '# ' + title;
      } else {
        lines.unshift('# ' + title, '');
      }
      var next = {
        id: doc.id,
        title: title,
        markdown: lines.join('\n'),
        updatedAt: Date.now()
      };
      if (Array.isArray(doc.tags)) next.tags = doc.tags.slice();
      if (doc.folder) next.folder = doc.folder;
      window.MDStore.putDoc(next).then(function () {
        document.dispatchEvent(new CustomEvent('md-doc-updated', { detail: { docId: doc.id } }));
        refresh();
      }).catch(function () {});
    });
  }

  function deleteDoc(doc) {
    if (!window.MDModal) return;
    window.MDModal.confirm({
      title: t('docs.deleteTitle', 'Delete document'),
      message: t('docs.deleteConfirm', 'This deletes the document permanently. Continue?'),
      confirmLabel: t('dialog.confirm', 'Continue'),
      cancelLabel: t('dialog.cancel', 'Cancel'),
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      var closePromise = Promise.resolve();
      if (onDelete) {
        closePromise = new Promise(function (resolve) {
          onDelete(doc.id, resolve);
        });
      }
      closePromise.then(function () {
        return window.MDStore.deleteDoc(doc.id);
      }).then(function () {
        refresh();
      }).catch(function () {});
    });
  }

  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      searchTimer = null;
      renderList(docs);
    }, SEARCH_DEBOUNCE);
  }

  window.MDDocsPanel = {
    init: function (opts) {
      opts = opts || {};
      if (typeof opts.onOpen === 'function') onOpen = opts.onOpen;
      if (typeof opts.onDelete === 'function') onDelete = opts.onDelete;
      if (typeof opts.onNewTab === 'function') onNewTab = opts.onNewTab;
    },
    open: open,
    close: close,
    toggle: toggle,
    refresh: refresh,
    focusSearch: focusSearch
  };
})();
