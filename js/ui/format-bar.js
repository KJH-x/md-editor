(function () {
  'use strict';

  var BAR_ID = 'md-formatbar';
  var GAP = 8;
  var EDGE = 8;
  var SUPPRESS_MS = 350;
  var vditorInstance = null;
  var bar = null;
  var buttons = {};
  var suppressUntil = 0;

  var BUTTONS = [
    {
      id: 'bold',
      toolbar: 'bold',
      label: 'formatbar.bold',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6zM6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>'
    },
    {
      id: 'italic',
      toolbar: 'italic',
      label: 'formatbar.italic',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>'
    },
    {
      id: 'strike',
      toolbar: 'strike',
      label: 'formatbar.strike',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg>'
    },
    {
      id: 'inline-code',
      toolbar: 'inline-code',
      label: 'formatbar.inlineCode',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
    },
    {
      id: 'link',
      toolbar: 'link',
      label: 'formatbar.link',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'
    },
    {
      id: 'highlight',
      toolbar: null,
      label: 'formatbar.highlight',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l4 4L4 23H1v-3z"/><path d="M13 7l4 4 5-5-4-4z"/><path d="M17 3l4 4"/></svg>'
    },
    {
      id: 'quote',
      toolbar: 'quote',
      label: 'formatbar.quote',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6a4 4 0 0 1-4 4"/><path d="M19 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6a4 4 0 0 1-4 4"/></svg>'
    }
  ];

  function t(key) {
    return window.mdI18n && typeof window.mdI18n.t === 'function' ? window.mdI18n.t(key) : key;
  }

  function getEditor() {
    return vditorInstance && vditorInstance.vditor ? vditorInstance : null;
  }

  function selectionText() {
    var selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      return selection.toString();
    }
    var sv = document.querySelector('.vditor-sv textarea');
    if (sv && sv.selectionStart !== sv.selectionEnd) {
      return sv.value.slice(sv.selectionStart, sv.selectionEnd);
    }
    return '';
  }

  function selectionInEditor() {
    var selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      var node = selection.anchorNode;
      if (node && node.nodeType === 3) node = node.parentElement;
      if (node && node.closest) {
        var editable = node.closest('[contenteditable="true"], textarea');
        if (editable && editable.closest && editable.closest('.vditor')) return true;
      }
    }
    var sv = document.querySelector('.vditor-sv textarea');
    return !!(sv && sv.selectionStart !== sv.selectionEnd);
  }

  function svSelectionRect() {
    var sv = document.querySelector('.vditor-sv textarea');
    if (!sv || sv.selectionStart === sv.selectionEnd) return null;
    var box = sv.getBoundingClientRect();
    var style = window.getComputedStyle(sv);
    var lineHeight = parseFloat(style.lineHeight);
    if (!lineHeight || isNaN(lineHeight)) lineHeight = 20;
    var padTop = parseFloat(style.paddingTop) || 0;
    var padLeft = parseFloat(style.paddingLeft) || 0;
    var before = sv.value.slice(0, sv.selectionStart);
    var caretLine = before.split('\n').length - 1;
    var mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.style.cssText = [
      'position:fixed', 'left:0', 'top:0', 'visibility:hidden',
      'pointer-events:none', 'white-space:pre',
      'font-family:' + style.fontFamily, 'font-size:' + style.fontSize,
      'font-weight:' + style.fontWeight, 'font-style:' + style.fontStyle,
      'letter-spacing:' + (style.letterSpacing || 'normal'),
      'line-height:' + lineHeight + 'px'
    ].join(';');
    mirror.textContent = before.split('\n')[caretLine];
    document.body.appendChild(mirror);
    var caretWidth = mirror.getBoundingClientRect().width;
    document.body.removeChild(mirror);
    var top = Math.max(box.top, box.top - sv.scrollTop + padTop + caretLine * lineHeight);
    var bottom = Math.min(box.bottom, top + lineHeight);
    var left = box.left - sv.scrollLeft + padLeft + caretWidth;
    return {
      left: left,
      right: left + 8,
      top: top,
      bottom: bottom,
      width: 8,
      height: Math.max(1, bottom - top)
    };
  }

  function selectionRect() {
    var selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      var rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect && (rect.width || rect.height)) return rect;
    }
    return svSelectionRect();
  }

  function applyLabels() {
    if (!bar) return;
    bar.setAttribute('aria-label', t('formatbar.label'));
    for (var i = 0; i < BUTTONS.length; i++) {
      var button = buttons[BUTTONS[i].id];
      if (!button) continue;
      var label = t(BUTTONS[i].label);
      button.title = label;
      button.setAttribute('aria-label', label);
    }
  }

  function refreshButtons() {
    var editor = getEditor();
    var toolbar = editor && editor.vditor && editor.vditor.toolbar &&
      editor.vditor.toolbar.elements;
    for (var i = 0; i < BUTTONS.length; i++) {
      var def = BUTTONS[i];
      var button = buttons[def.id];
      if (!button) continue;
      var disabled = false;
      if (def.toolbar && toolbar && toolbar[def.toolbar]) {
        var el = toolbar[def.toolbar].children[0];
        disabled = !el || el.classList.contains('vditor-menu--disabled');
      }
      button.disabled = !!disabled;
    }
  }

  function positionBar(rect) {
    var barRect = bar.getBoundingClientRect();
    var barWidth = barRect.width || 180;
    var barHeight = barRect.height || 38;
    var viewportW = window.innerWidth;
    var viewportH = window.innerHeight;
    var left = rect.left + rect.width / 2 - barWidth / 2;
    left = Math.max(EDGE, Math.min(left, viewportW - barWidth - EDGE));
    var above = rect.top - barHeight - GAP;
    var flip = above < EDGE;
    var top = flip ? rect.bottom + GAP : above;
    top = Math.max(EDGE, Math.min(top, viewportH - barHeight - EDGE));
    bar.setAttribute('data-pos', flip ? 'below' : 'above');
    bar.style.left = left + 'px';
    bar.style.top = top + 'px';
  }

  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', t('formatbar.label'));
    bar.hidden = true;
    for (var i = 0; i < BUTTONS.length; i++) {
      var def = BUTTONS[i];
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'md-formatbar__btn';
      button.setAttribute('data-md-format', def.id);
      button.title = t(def.label);
      button.setAttribute('aria-label', t(def.label));
      button.innerHTML = def.icon;
      button.addEventListener('mousedown', function (event) { event.preventDefault(); });
      button.addEventListener('click', makeClickHandler(def));
      bar.appendChild(button);
      buttons[def.id] = button;
    }
    document.body.appendChild(bar);
    return bar;
  }

  function applyHighlight(editor) {
    var text = selectionText();
    if (!text || !text.trim()) return;
    try { editor.focus(); } catch (err) { /* noop */ }
    if (typeof editor.deleteValue === 'function') {
      try { editor.deleteValue(); } catch (err) { /* noop */ }
    }
    editor.insertValue('==' + text.trim() + '==', true);
  }

  function makeClickHandler(def) {
    return function () {
      var editor = getEditor();
      if (!editor || !editor.vditor) return;
      if (def.id === 'highlight') {
        applyHighlight(editor);
        hide();
        suppressUntil = Date.now() + SUPPRESS_MS;
        return;
      }
      if (def.toolbar) {
        var toolbar = editor.vditor.toolbar && editor.vditor.toolbar.elements;
        var item = toolbar && toolbar[def.toolbar];
        var el = item && item.children[0];
        if (!el || el.classList.contains('vditor-menu--disabled')) return;
        try { editor.focus(); } catch (err) { /* noop */ }
        el.click();
      }
      hide();
      suppressUntil = Date.now() + SUPPRESS_MS;
    };
  }

  function show() {
    var text = selectionText();
    if (!text || !text.trim() || !selectionInEditor()) {
      hide();
      return;
    }
    if (Date.now() < suppressUntil) {
      hide();
      return;
    }
    var rect = selectionRect();
    if (!rect || !rect.width || !rect.height) {
      hide();
      return;
    }
    ensureBar();
    refreshButtons();
    applyLabels();
    bar.hidden = false;
    positionBar(rect);
  }

  function hide() {
    if (bar) bar.hidden = true;
  }

  function refresh() {
    if (!bar) return;
    refreshButtons();
    applyLabels();
    if (bar.hidden) return;
    var rect = selectionRect();
    if (!rect || !rect.width || !rect.height) {
      hide();
      return;
    }
    positionBar(rect);
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') hide();
  }, true);

  document.addEventListener('mousedown', function (event) {
    if (!bar || bar.hidden) return;
    if (bar.contains(event.target)) return;
    hide();
  }, true);

  document.addEventListener('scroll', function () {
    if (!bar || bar.hidden) return;
    hide();
    suppressUntil = Date.now() + SUPPRESS_MS;
  }, true);

  window.addEventListener('blur', function () {
    hide();
  });

  window.addEventListener('resize', function () {
    if (bar && !bar.hidden) {
      var rect = selectionRect();
      if (rect && rect.width && rect.height) positionBar(rect);
      else hide();
    }
  });

  window.MDFormatBar = {
    show: show,
    hide: hide,
    refresh: refresh,
    attach: function (instance) {
      vditorInstance = instance || null;
    }
  };
})();
