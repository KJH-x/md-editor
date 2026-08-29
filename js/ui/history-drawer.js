(function () {
  'use strict';

  var MAX_RENDER_LINES = 800;
  var MAX_DIFF_CELLS = 200000;

  var overlay = null;
  var built = false;
  var current = null;
  var snapshots = [];
  var currentMarkdown = '';
  var currentWords = 0;
  var selectedIndex = -1;
  var listEl = null;
  var previewEl = null;
  var footerEl = null;
  var restoreBtn = null;
  var deleteBtn = null;

  function t(key, fallback) {
    if (window.mdI18n && typeof window.mdI18n.t === 'function') {
      var value = window.mdI18n.t(key);
      if (value !== key) return value;
    }
    return fallback;
  }

  function countWords(markdown) {
    return (String(markdown || '').match(/[A-Za-z0-9]+|[\u4e00-\u9fff]/g) || []).length;
  }

  function snapshotTitle(record) {
    if (record && typeof record.title === 'string' && record.title) return record.title;
    var match = String((record && record.markdown) || '').match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : t('untitled', 'untitled');
  }

  function formatTime(ts) {
    var diff = Date.now() - ts;
    var minute = 60 * 1000, hour = 60 * minute, day = 24 * hour;
    if (diff < minute) return t('history.timeNow', 'just now');
    if (diff < hour) return t('history.timeMinAgo', '{n} min ago').replace('{n}', String(Math.floor(diff / minute)));
    if (diff < day) return t('history.timeHrAgo', '{n} hr ago').replace('{n}', String(Math.floor(diff / hour)));
    return t('history.timeDayAgo', '{n} d ago').replace('{n}', String(Math.floor(diff / day)));
  }

  function splitLines(text) { return String(text || '').split('\n'); }

  function lcsDiff(a, b) {
    var n = a.length, m = b.length;
    if (n * m > MAX_DIFF_CELLS) {
      var fallback = [];
      for (var i = 0; i < n; i++) fallback.push({ type: 'del', text: a[i] });
      for (var j = 0; j < m; j++) fallback.push({ type: 'add', text: b[j] });
      return fallback;
    }
    var dp = [];
    for (var r = 0; r <= n; r++) dp.push(new Array(m + 1).fill(0));
    for (var x = n - 1; x >= 0; x--) {
      for (var y = m - 1; y >= 0; y--) {
        dp[x][y] = a[x] === b[y] ? dp[x + 1][y + 1] + 1 : Math.max(dp[x + 1][y], dp[x][y + 1]);
      }
    }
    var ops = [];
    var i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push({ type: 'same', text: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', text: a[i] }); i++; }
      else { ops.push({ type: 'add', text: b[j] }); j++; }
    }
    while (i < n) { ops.push({ type: 'del', text: a[i] }); i++; }
    while (j < m) { ops.push({ type: 'add', text: b[j] }); j++; }
    return ops;
  }

  function diffLines(beforeText, afterText) {
    var a = splitLines(beforeText);
    var b = splitLines(afterText);
    var start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    var endA = a.length, endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    var ops = [];
    var i;
    for (i = 0; i < start; i++) ops.push({ type: 'same', text: a[i] });
    var mid = lcsDiff(a.slice(start, endA), b.slice(start, endB));
    for (i = 0; i < mid.length; i++) ops.push(mid[i]);
    for (i = endA; i < a.length; i++) ops.push({ type: 'same', text: a[i] });
    return ops;
  }

  function ensure() {
    if (built) return;
    built = true;

    overlay = document.createElement('div');
    overlay.className = 'md-history';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', t('history.title', 'Version history'));
    overlay.hidden = true;

    var backdrop = document.createElement('div');
    backdrop.className = 'md-history__backdrop';
    overlay.appendChild(backdrop);

    var panel = document.createElement('div');
    panel.className = 'md-history__panel';

    var header = document.createElement('div');
    header.className = 'md-history__header';

    var title = document.createElement('div');
    title.className = 'md-history__title';
    title.textContent = t('history.title', 'Version history');
    header.appendChild(title);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'md-history__close';
    closeBtn.textContent = t('history.close', 'Close');
    closeBtn.addEventListener('click', close);
    header.appendChild(closeBtn);

    panel.appendChild(header);

    var body = document.createElement('div');
    body.className = 'md-history__body';

    listEl = document.createElement('div');
    listEl.className = 'md-history__list';
    listEl.setAttribute('role', 'listbox');
    body.appendChild(listEl);

    previewEl = document.createElement('div');
    previewEl.className = 'md-history__preview';
    body.appendChild(previewEl);

    panel.appendChild(body);

    footerEl = document.createElement('div');
    footerEl.className = 'md-history__footer';
    panel.appendChild(footerEl);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    backdrop.addEventListener('click', close);
    overlay.addEventListener('keydown', onKeydown);
  }

  function open(opts) {
    ensure();
    current = {
      docId: opts.docId,
      getCurrent: opts.getCurrent || function () { return Promise.resolve(''); },
      onRestore: opts.onRestore || function () { return Promise.resolve(true); }
    };
    snapshots = [];
    currentMarkdown = '';
    selectedIndex = -1;
    overlay.hidden = false;
    var panelEl = overlay.querySelector('.md-history__panel');
    if (panelEl && panelEl.focus) {
      panelEl.setAttribute('tabindex', '-1');
      panelEl.focus();
    }
    renderEmpty(t('history.loading', 'Loading…'));
    load().catch(function (err) {
      if (window.console && console.error) console.error('[md-history] load failed', err);
      renderEmpty(t('history.loadError', 'Failed to load history'));
    });
  }

  function load() {
    var docId = current.docId;
    return Promise.all([
      window.MDStore.listSnapshots(docId),
      Promise.resolve().then(current.getCurrent)
    ]).then(function (results) {
      snapshots = results[0] || [];
      currentMarkdown = results[1] || '';
      currentWords = countWords(currentMarkdown);
      if (!snapshots.length) { renderEmpty(t('history.empty', 'No snapshots yet.')); return; }
      renderList();
      renderFooter();
      selectSnapshot(0);
    });
  }

  function close() {
    if (!built || overlay.hidden) return;
    overlay.hidden = true;
    current = null;
    snapshots = [];
    currentMarkdown = '';
  }

  function renderEmpty(message) {
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
    while (footerEl.firstChild) footerEl.removeChild(footerEl.firstChild);
    var empty = document.createElement('div');
    empty.className = 'md-history__empty';
    empty.textContent = message;
    listEl.appendChild(empty);
    restoreBtn = null; deleteBtn = null;
  }

  function renderList() {
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    var n = snapshots.length;
    for (var i = 0; i < n; i++) {
      (function (index) {
        var record = snapshots[index];
        var item = document.createElement('div');
        item.className = 'md-history__item';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.setAttribute('data-ts', String(record.ts));

        var head = document.createElement('div');
        head.className = 'md-history__item-head';
        var version = document.createElement('span');
        version.className = 'md-history__item-version';
        version.textContent = t('history.versionLabel', 'Version {n}').replace('{n}', String(n - index));
        var time = document.createElement('span');
        time.className = 'md-history__item-time';
        time.textContent = formatTime(record.ts);
        time.title = new Date(record.ts).toLocaleString();
        head.appendChild(version);
        head.appendChild(time);

        var title = document.createElement('div');
        title.className = 'md-history__item-title';
        title.textContent = snapshotTitle(record);
        title.title = title.textContent;

        var meta = document.createElement('div');
        meta.className = 'md-history__item-meta';
        var words = countWords(record.markdown);
        var add = Math.max(0, words - currentWords);
        var del = Math.max(0, currentWords - words);
        meta.textContent = t('history.wordsDiff', '+{add} / -{del} words')
          .replace('{add}', String(add)).replace('{del}', String(del));

        item.appendChild(head);
        item.appendChild(title);
        item.appendChild(meta);
        item.addEventListener('click', function () { selectSnapshot(index); });
        item.addEventListener('mouseenter', function () { selectSnapshot(index); });
        listEl.appendChild(item);
      })(i);
    }
  }

  function renderPreview() {
    while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
    if (selectedIndex < 0 || selectedIndex >= snapshots.length) return;
    var record = snapshots[selectedIndex];
    var header = document.createElement('div');
    header.className = 'md-history__preview-head';
    header.textContent = t('history.current', 'Current version') + ' vs ' +
      t('history.versionLabel', 'Version {n}').replace('{n}', String(snapshots.length - selectedIndex));
    previewEl.appendChild(header);

    var ops = diffLines(currentMarkdown, record.markdown);
    var allSame = true;
    var shown = 0;
    var collapsed = 0;
    var i = 0;
    while (i < ops.length) {
      var op = ops[i];
      if (op.type !== 'same') allSame = false;
      if (op.type === 'same' && shown >= MAX_RENDER_LINES) {
        var run = 0;
        while (i < ops.length && ops[i].type === 'same') { run++; i++; }
        collapsed += run;
        continue;
      }
      var row = document.createElement('div');
      row.className = 'md-history__line md-history__line--' + op.type;
      row.textContent = op.text;
      previewEl.appendChild(row);
      shown++;
      i++;
    }
    if (collapsed > 0) {
      var more = document.createElement('div');
      more.className = 'md-history__line md-history__line--more';
      more.textContent = t('history.more', '… {n} more identical lines hidden')
        .replace('{n}', String(collapsed));
      previewEl.appendChild(more);
    }
    if (allSame) {
      var identical = document.createElement('div');
      identical.className = 'md-history__identical';
      identical.textContent = t('history.identical', 'Identical to current version');
      previewEl.appendChild(identical);
    }
  }

  function renderFooter() {
    while (footerEl.firstChild) footerEl.removeChild(footerEl.firstChild);
    var count = document.createElement('span');
    count.className = 'md-history__count';
    count.textContent = t('history.count', '{n} snapshots').replace('{n}', String(snapshots.length));
    footerEl.appendChild(count);

    var actions = document.createElement('div');
    actions.className = 'md-history__actions';

    deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'md-history__btn';
    deleteBtn.textContent = t('history.delete', 'Delete this snapshot');
    deleteBtn.addEventListener('click', requestDelete);

    restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'md-history__btn md-history__btn--danger';
    restoreBtn.textContent = t('history.restore', 'Restore this version');
    restoreBtn.addEventListener('click', requestRestore);

    actions.appendChild(deleteBtn);
    actions.appendChild(restoreBtn);
    footerEl.appendChild(actions);
    updateFooter();
  }

  function updateFooter() {
    var has = selectedIndex >= 0 && selectedIndex < snapshots.length;
    if (restoreBtn) restoreBtn.disabled = !has;
    if (deleteBtn) deleteBtn.disabled = !has;
  }

  function selectSnapshot(index) {
    if (index < 0 || index >= snapshots.length) return;
    selectedIndex = index;
    var items = listEl.querySelectorAll('.md-history__item');
    for (var i = 0; i < items.length; i++) {
      var active = i === index;
      items[i].classList.toggle('md-history__item--current', active);
      items[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }
    renderPreview();
    updateFooter();
  }

  function requestRestore() {
    var record = snapshots[selectedIndex];
    if (!record || !window.MDModal) return;
    window.MDModal.confirm({
      title: t('history.restoreConfirmTitle', 'Restore version'),
      message: t('history.restoreConfirm', 'This replaces the current content with the selected version. A snapshot of the current content is saved first. Restore?'),
      confirmLabel: t('dialog.confirm', 'Continue'),
      cancelLabel: t('dialog.cancel', 'Cancel'),
      danger: true
    }).then(function (ok) {
      if (!ok || !current) return;
      var rest = current.onRestore(record);
      if (rest && typeof rest.then === 'function') {
        rest.then(function (okRestored) { if (okRestored) close(); });
      } else {
        close();
      }
    });
  }

  function requestDelete() {
    var record = snapshots[selectedIndex];
    if (!record || !window.MDStore.deleteSnapshot) return;
    window.MDStore.deleteSnapshot(record.docId, record.ts).then(function () {
      return window.MDStore.listSnapshots(current.docId);
    }).then(function (list) {
      snapshots = list || [];
      if (!snapshots.length) { renderEmpty(t('history.empty', 'No snapshots yet.')); return; }
      renderList();
      renderFooter();
      selectSnapshot(0);
    });
  }

  function onKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (!snapshots.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); selectSnapshot(selectedIndex + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); selectSnapshot(selectedIndex - 1); }
    else if (event.key === 'Enter') { event.preventDefault(); requestRestore(); }
  }

  window.MDHistoryDrawer = {
    open: open,
    close: close
  };
})();
