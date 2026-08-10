(function () {
  'use strict';

  var MAX_RESULTS = 50;
  var CATEGORY_KEYS = {
    insert: 'palette.cat.insert',
    format: 'palette.cat.format',
    view: 'palette.cat.view',
    file: 'palette.cat.file',
    settings: 'palette.cat.settings',
    app: 'palette.cat.app'
  };

  var overlay = null;
  var input = null;
  var listEl = null;
  var results = [];
  var currentIndex = -1;
  var lastFocused = null;
  var built = false;

  function t(key, fallback) {
    if (window.mdI18n && typeof window.mdI18n.t === 'function') {
      var value = window.mdI18n.t(key);
      if (value !== key) return value;
    }
    return fallback;
  }

  function ensure() {
    if (built) return;
    built = true;

    overlay = document.createElement('div');
    overlay.className = 'md-palette';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', t('palette.title', 'Command palette'));
    overlay.hidden = true;

    var backdrop = document.createElement('div');
    backdrop.className = 'md-palette__backdrop';
    overlay.appendChild(backdrop);

    var panel = document.createElement('div');
    panel.className = 'md-palette__panel';

    var title = document.createElement('div');
    title.className = 'md-palette__title';
    title.textContent = t('palette.title', 'Command palette');
    panel.appendChild(title);

    input = document.createElement('input');
    input.className = 'md-palette__input';
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', t('palette.placeholder', 'Search actions'));
    panel.appendChild(input);

    listEl = document.createElement('div');
    listEl.className = 'md-palette__list';
    listEl.setAttribute('role', 'listbox');
    panel.appendChild(listEl);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    backdrop.addEventListener('click', close);
    overlay.addEventListener('keydown', onKeydown);
    input.addEventListener('input', onInput);
  }

  function enabledActions() {
    var registry = window.MD_ACTIONS;
    if (!registry || !registry.list) return [];
    var out = [];
    for (var i = 0; i < registry.list.length; i++) {
      var action = registry.list[i];
      if (!action || typeof action.run !== 'function') continue;
      if (typeof action.enabled === 'function') {
        try {
          if (!action.enabled()) continue;
        } catch (err) {
          continue;
        }
      }
      out.push(action);
    }
    return out;
  }

  function subsequenceMatch(query, text) {
    var q = query.toLowerCase();
    var h = text.toLowerCase();
    var qi = 0;
    for (var i = 0; i < h.length && qi < q.length; i++) {
      if (h.charAt(i) === q.charAt(qi)) qi++;
    }
    return qi === q.length;
  }

  function fuzzyScore(query, text) {
    var q = query.toLowerCase();
    var h = text.toLowerCase();
    var qi = 0;
    var sum = 0;
    var prev = -2;
    var consecutive = 0;
    for (var i = 0; i < h.length && qi < q.length; i++) {
      if (h.charAt(i) !== q.charAt(qi)) continue;
      sum += i;
      if (i === prev + 1) consecutive++;
      prev = i;
      qi++;
    }
    if (qi < q.length) return Number.MAX_VALUE;
    return sum + (h.length - qi) - consecutive;
  }

  function categoryLabel(category) {
    var key = CATEGORY_KEYS[category];
    if (key) return t(key, category);
    return category || '';
  }

  function search(query) {
    var actions = enabledActions();
    var entries = [];
    for (var i = 0; i < actions.length; i++) {
      var action = actions[i];
      if (!query) {
        entries.push({ action: action, score: 0 });
        continue;
      }
      var text = (action.label || '') + ' ' +
        (action.keywords ? action.keywords.join(' ') : '') + ' ' +
        (action.category || '') + ' ' + (action.id || '');
      if (!subsequenceMatch(query, text)) continue;
      entries.push({ action: action, score: fuzzyScore(query, text) });
    }
    var order = {};
    var next = 0;
    for (var j = 0; j < entries.length; j++) {
      var cat = entries[j].action.category || '';
      if (!Object.prototype.hasOwnProperty.call(order, cat)) {
        order[cat] = next++;
      }
    }
    entries.sort(function (a, b) {
      var oa = order[a.action.category || ''];
      var ob = order[b.action.category || ''];
      if (oa !== ob) return oa - ob;
      return a.score - b.score;
    });
    if (entries.length > MAX_RESULTS) entries.length = MAX_RESULTS;
    return entries;
  }

  function buildRow(action, index) {
    var row = document.createElement('div');
    row.className = 'md-palette__item';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.setAttribute('data-action-id', action.id || '');

    var label = document.createElement('span');
    label.className = 'md-palette__item-label';
    label.textContent = action.label || action.id || '';

    var meta = document.createElement('span');
    meta.className = 'md-palette__item-meta';
    var metaText = categoryLabel(action.category || '');
    if (action.shortcut) metaText = metaText + ' · ' + action.shortcut;
    meta.textContent = metaText;

    row.appendChild(label);
    row.appendChild(meta);

    row.addEventListener('click', function () {
      runAction(action);
    });
    row.addEventListener('mouseenter', function () {
      setCurrent(index);
    });
    return row;
  }

  function render(entries) {
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    results = [];
    currentIndex = -1;
    var lastCategory = null;
    for (var i = 0; i < entries.length; i++) {
      var action = entries[i].action;
      var category = action.category || '';
      if (category !== lastCategory) {
        var header = document.createElement('div');
        header.className = 'md-palette__group';
        header.textContent = categoryLabel(category);
        listEl.appendChild(header);
        lastCategory = category;
      }
      listEl.appendChild(buildRow(action, results.length));
      results.push({ action: action, el: listEl.lastChild });
    }
    if (!results.length) {
      var empty = document.createElement('div');
      empty.className = 'md-palette__empty';
      empty.textContent = t('palette.noResults', 'No matching actions');
      listEl.appendChild(empty);
    }
    setCurrent(0, false);
  }

  function setCurrent(index, scroll) {
    if (!results.length) {
      currentIndex = -1;
      return;
    }
    if (index < 0) index = results.length - 1;
    if (index >= results.length) index = 0;
    currentIndex = index;
    for (var i = 0; i < results.length; i++) {
      var selected = i === index;
      results[i].el.classList.toggle('md-palette__item--current', selected);
      results[i].el.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    if (scroll !== false && results[index].el.scrollIntoView) {
      results[index].el.scrollIntoView({ block: 'nearest' });
    }
  }

  function refreshTexts() {
    var label = t('palette.title', 'Command palette');
    overlay.setAttribute('aria-label', label);
    var title = overlay.querySelector('.md-palette__title');
    if (title) title.textContent = label;
    var placeholder = t('palette.placeholder', 'Search actions');
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
  }

  function open() {
    ensure();
    refreshTexts();
    lastFocused = document.activeElement;
    overlay.hidden = false;
    input.value = '';
    render(search(''));
    input.focus();
  }

  function close() {
    if (!built || overlay.hidden) return;
    overlay.hidden = true;
    if (lastFocused && lastFocused.focus && document.contains(lastFocused)) {
      lastFocused.focus();
    } else {
      var editable = document.querySelector('[contenteditable="true"]');
      if (editable && editable.focus) editable.focus();
    }
    lastFocused = null;
  }

  function toggle() {
    if (built && !overlay.hidden) close();
    else open();
  }

  function currentAction() {
    if (currentIndex >= 0 && currentIndex < results.length) {
      return results[currentIndex].action;
    }
    return null;
  }

  function runAction(action) {
    if (!action) return;
    close();
    try {
      action.run();
    } catch (err) {
      if (window.console && console.error) console.error('[md-palette] action failed:', err);
    }
  }

  function onInput() {
    render(search(input.value));
  }

  function onKeydown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCurrent(currentIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCurrent(currentIndex - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runAction(currentAction());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  window.MDCommandPalette = {
    open: open,
    close: close,
    toggle: toggle,
    ensure: ensure
  };
})();
