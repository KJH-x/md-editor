(function () {
  'use strict';

  var vditorInstance = null;
  var panelEl = null;
  var findInput = null;
  var replaceInput = null;
  var countEl = null;
  var caseBtn = null;
  var replaceRow = null;
  var replaceBtn = null;
  var replaceAllBtn = null;
  var prevBtn = null;
  var nextBtn = null;
  var lastFocused = null;

  var matches = [];
  var currentIndex = -1;
  var suppressClear = false;
  var rerunTimer = null;

  var SKIP_DATA_TYPES = {
    'backslash': 1,
    'blockquote-marker': 1,
    'code-block': 1,
    'code-block-close': 1,
    'code-block-close-marker': 1,
    'code-block-info': 1,
    'code-block-open': 1,
    'code-block-open-marker': 1,
    'footnotes-block': 1,
    'footnotes-link': 1,
    'heading-marker': 1,
    'html-block': 1,
    'html-entity': 1,
    'li-marker': 1,
    'link-ref-defs-block': 1,
    'math-block': 1,
    'math-inline': 1,
    'newline': 1,
    'padding': 1,
    'task-marker': 1,
    'toc-block': 1,
    'yaml-front-matter-close-marker': 1,
    'yaml-front-matter-open-marker': 1
  };

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isSkipElement(node) {
    if (!node || node.nodeType !== 1) return false;
    var tag = node.tagName;
    var cls = typeof node.className === 'string' ? node.className : '';
    if (cls.indexOf('vditor-ir__marker') !== -1 || cls.indexOf('vditor-sv__marker') !== -1) return true;
    if (cls.indexOf('vditor-sv__preview') !== -1 || cls.indexOf('vditor-ir__preview') !== -1) return true;
    if (cls.indexOf('code-block-info') !== -1 || cls.indexOf('vditor-code') !== -1) return true;
    if (tag === 'PRE' && node.getAttribute('contenteditable') !== 'true') return true;
    var dataType = node.getAttribute && node.getAttribute('data-type');
    return !!(dataType && SKIP_DATA_TYPES[dataType]);
  }

  function collectSegments(root) {
    var segments = [];
    function walk(node) {
      if (node.nodeType === 3) {
        if (node.textContent) segments.push({ node: node, text: node.textContent });
        return;
      }
      if (node.nodeType !== 1) return;
      if (isSkipElement(node)) return;
      for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    }
    walk(root);
    return segments;
  }

  function buildIndex(segments) {
    var concat = '';
    var starts = [];
    for (var i = 0; i < segments.length; i++) {
      starts.push(concat.length);
      concat += segments[i].text;
    }
    return { concat: concat, starts: starts };
  }

  function locate(segments, built, index, text) {
    var pos = built.concat.indexOf(text);
    var occurrences = [];
    while (pos !== -1) {
      occurrences.push(pos);
      pos = built.concat.indexOf(text, pos + Math.max(1, text.length));
    }
    if (!occurrences.length) return null;
    var target = occurrences[Math.min(Math.max(0, index), occurrences.length - 1)];
    return { target: target, end: target + text.length };
  }

  function wrapSegment(node, from, to) {
    var mark = document.createElement('mark');
    mark.className = 'md-find-hi';
    var range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    try {
      range.surroundContents(mark);
    } catch (err) {
      var parent = node.parentNode;
      if (!parent) return;
      var before = document.createTextNode(node.textContent.slice(0, from));
      mark.textContent = node.textContent.slice(from, to);
      var after = document.createTextNode(node.textContent.slice(to));
      parent.insertBefore(before, node);
      parent.insertBefore(mark, node);
      parent.insertBefore(after, node);
      parent.removeChild(node);
    }
  }

  function scrollToMark(mark, container) {
    try {
      var markRect = mark.getBoundingClientRect();
      var containerRect = container.getBoundingClientRect();
      container.scrollTop += markRect.top - containerRect.top - container.clientHeight / 2;
    } catch (err) {}
  }

  function highlightInEditable(root, match) {
    var segments = collectSegments(root);
    if (!segments.length) return false;
    var built = buildIndex(segments);
    var loc = locate(segments, built, currentIndex, match.text);
    if (!loc) return false;
    for (var j = 0; j < segments.length; j++) {
      var s = built.starts[j];
      var segLen = segments[j].text.length;
      if (s + segLen <= loc.target) continue;
      if (s >= loc.end) break;
      var from = Math.max(s, loc.target) - s;
      var to = Math.min(s + segLen, loc.end) - s;
      if (to > from) wrapSegment(segments[j].node, from, to);
    }
    var mark = root.querySelector('.md-find-hi');
    if (mark) scrollToMark(mark, root);
    return !!mark;
  }

  function selectInEditable(root, match) {
    var segments = collectSegments(root);
    if (!segments.length) return false;
    var built = buildIndex(segments);
    var loc = locate(segments, built, currentIndex, match.text);
    if (!loc) return false;
    for (var j = 0; j < segments.length; j++) {
      var s = built.starts[j];
      var segLen = segments[j].text.length;
      if (s + segLen <= loc.target) continue;
      if (s >= loc.end) break;
      var from = Math.max(s, loc.target) - s;
      var to = Math.min(s + segLen, loc.end) - s;
      if (to <= from) continue;
      var range = document.createRange();
      range.setStart(segments[j].node, from);
      range.setEnd(segments[j].node, to);
      var selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return true;
    }
    return false;
  }

  function clearHighlights() {
    var marks = document.querySelectorAll('.md-find-hi');
    for (var i = marks.length - 1; i >= 0; i--) {
      var mark = marks[i];
      var parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    }
  }

  function currentMode() {
    return vditorInstance && typeof vditorInstance.getCurrentMode === 'function'
      ? vditorInstance.getCurrentMode() : null;
  }

  function contentEditable(mode) {
    if (!vditorInstance || !vditorInstance.vditor) return null;
    var modeObj = vditorInstance.vditor[mode];
    if (!modeObj || !modeObj.element) return null;
    var element = modeObj.element;
    if (element.getAttribute && element.getAttribute('contenteditable') === 'true') return element;
    return element.querySelector ? element.querySelector('[contenteditable="true"]') : null;
  }

  function findMatches(markdown) {
    var query = findInput.value || '';
    if (!query) return [];
    var flags = caseBtn.classList.contains('is-active') ? 'g' : 'gi';
    var re = new RegExp(escapeRegExp(query), flags);
    var list = [];
    var m;
    while ((m = re.exec(markdown)) !== null) {
      list.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
    return list;
  }

  function renderCount() {
    if (matches.length) {
      countEl.textContent = mdI18n.t('find.count')
        .replace('{current}', String(currentIndex + 1))
        .replace('{total}', String(matches.length));
    } else {
      countEl.textContent = '0';
    }
  }

  function highlightCurrent() {
    clearHighlights();
    if (!matches.length || currentIndex < 0) return;
    var match = matches[currentIndex];
    var root = contentEditable(currentMode());
    if (!root) return;
    if (!highlightInEditable(root, match)) selectInEditable(root, match);
  }

  function runFind() {
    var markdown = vditorInstance ? vditorInstance.getValue() : '';
    matches = findMatches(markdown);
    if (!matches.length) {
      currentIndex = -1;
    } else if (currentIndex < 0 || currentIndex >= matches.length) {
      currentIndex = 0;
    }
    renderCount();
    highlightCurrent();
  }

  function next(step) {
    if (!matches.length) return;
    currentIndex = (currentIndex + step + matches.length) % matches.length;
    renderCount();
    highlightCurrent();
  }

  function replaceCurrent() {
    if (!vditorInstance || !matches.length || currentIndex < 0) return;
    var match = matches[currentIndex];
    var markdown = vditorInstance.getValue();
    var replacement = replaceInput.value;
    var nextValue = markdown.slice(0, match.start) + replacement + markdown.slice(match.end);
    if (nextValue === markdown) return;
    var index = currentIndex;
    suppressClear = true;
    vditorInstance.setValue(nextValue, true);
    suppressClear = false;
    runFind();
    if (matches.length) {
      currentIndex = Math.min(index, matches.length - 1);
      renderCount();
      highlightCurrent();
    }
  }

  function replaceAll() {
    if (!vditorInstance) return;
    var query = findInput.value || '';
    if (!query) return;
    var replacement = replaceInput.value;
    var markdown = vditorInstance.getValue();
    var re = new RegExp(escapeRegExp(query), caseBtn.classList.contains('is-active') ? 'g' : 'gi');
    var nextValue = markdown.replace(re, function () { return replacement; });
    if (nextValue === markdown) return;
    suppressClear = true;
    vditorInstance.setValue(nextValue, true);
    suppressClear = false;
    currentIndex = -1;
    runFind();
  }

  function open(replaceMode) {
    if (!panelEl) buildPanel();
    replaceMode = !!replaceMode;
    replaceRow.hidden = !replaceMode;
    replaceBtn.hidden = !replaceMode;
    replaceAllBtn.hidden = !replaceMode;
    lastFocused = document.activeElement;
    panelEl.hidden = false;
    panelEl.setAttribute('aria-label', mdI18n.t('find.title'));
    caseBtn.title = mdI18n.t('find.case');
    caseBtn.setAttribute('aria-label', mdI18n.t('find.case'));
    findInput.focus();
    if (findInput.value) findInput.select();
    currentIndex = -1;
    runFind();
  }

  function close() {
    clearHighlights();
    if (panelEl) panelEl.hidden = true;
    if (lastFocused && lastFocused.focus && document.contains(lastFocused)) {
      lastFocused.focus();
    } else if (vditorInstance && typeof vditorInstance.focus === 'function') {
      try { vditorInstance.focus(); } catch (err) {}
    }
    lastFocused = null;
  }

  function toggle(replaceMode) {
    if (panelEl && !panelEl.hidden) close();
    else open(!!replaceMode);
  }

  function buildPanel() {
    panelEl = document.createElement('div');
    panelEl.id = 'md-find-replace';
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-modal', 'false');
    panelEl.innerHTML =
      '<div class="md-find-replace__title" data-i18n="find.title"></div>' +
      '<div class="md-find-replace__row">' +
      '<input class="md-find-replace__input" id="md-find-replace-find" type="text" spellcheck="false" data-i18n-placeholder="find.placeholder">' +
      '</div>' +
      '<div class="md-find-replace__row" id="md-find-replace-replace-row" hidden>' +
      '<input class="md-find-replace__input" id="md-find-replace-replace" type="text" spellcheck="false" data-i18n-placeholder="find.replacePlaceholder">' +
      '</div>' +
      '<div class="md-find-replace__row md-find-replace__actions">' +
      '<span class="md-find-replace__count" id="md-find-replace-count">0</span>' +
      '<button type="button" class="md-find-replace__btn" id="md-find-replace-prev" data-i18n="find.prev">Prev</button>' +
      '<button type="button" class="md-find-replace__btn" id="md-find-replace-next" data-i18n="find.next">Next</button>' +
      '<button type="button" class="md-find-replace__btn" id="md-find-replace-case">Aa</button>' +
      '<button type="button" class="md-find-replace__btn md-find-replace__btn--primary" id="md-find-replace-replace-btn" data-i18n="find.replace" hidden>Replace</button>' +
      '<button type="button" class="md-find-replace__btn" id="md-find-replace-all" data-i18n="find.replaceAll" hidden>Replace All</button>' +
      '</div>';
    panelEl.hidden = true;
    document.body.appendChild(panelEl);

    findInput = panelEl.querySelector('#md-find-replace-find');
    replaceInput = panelEl.querySelector('#md-find-replace-replace');
    countEl = panelEl.querySelector('#md-find-replace-count');
    caseBtn = panelEl.querySelector('#md-find-replace-case');
    replaceRow = panelEl.querySelector('#md-find-replace-replace-row');
    replaceBtn = panelEl.querySelector('#md-find-replace-replace-btn');
    replaceAllBtn = panelEl.querySelector('#md-find-replace-all');
    prevBtn = panelEl.querySelector('#md-find-replace-prev');
    nextBtn = panelEl.querySelector('#md-find-replace-next');

    findInput.addEventListener('input', function () {
      currentIndex = -1;
      runFind();
    });
    caseBtn.addEventListener('click', function () {
      caseBtn.classList.toggle('is-active');
      currentIndex = -1;
      runFind();
      findInput.focus();
    });
    prevBtn.addEventListener('click', function () { next(-1); });
    nextBtn.addEventListener('click', function () { next(1); });
    replaceBtn.addEventListener('click', replaceCurrent);
    replaceAllBtn.addEventListener('click', replaceAll);

    if (window.mdI18n && typeof window.mdI18n.applyI18n === 'function') {
      window.mdI18n.applyI18n();
    }
  }

  document.addEventListener('keydown', function (event) {
    if (!panelEl || panelEl.hidden) return;
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Enter') {
      if (event.target === findInput) {
        event.preventDefault();
        next(event.shiftKey ? -1 : 1);
      } else if (event.target === replaceInput) {
        event.preventDefault();
        replaceCurrent();
      }
    }
  }, true);

  document.addEventListener('input', function (event) {
    if (suppressClear || !panelEl || panelEl.hidden) return;
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    if (!target.closest('.vditor-ir, .vditor-wysiwyg, .vditor-sv')) return;
    clearHighlights();
    if (rerunTimer) clearTimeout(rerunTimer);
    rerunTimer = setTimeout(function () {
      rerunTimer = null;
      runFind();
    }, 120);
  }, true);

  window.MDFindReplace = {
    open: open,
    close: close,
    toggle: toggle,
    setVditor: function (vditor) {
      vditorInstance = vditor;
    }
  };
})();
