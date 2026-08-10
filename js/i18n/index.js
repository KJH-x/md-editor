(function () {
  'use strict';

  var STORAGE_KEY = 'md-lang';
  var SUPPORTED = { 'zh-CN': true, 'en-US': true, 'es-ES': true, 'hi-IN': true, 'ar-AR': true };
  var dicts = {};

  function mergeDicts() {
    var loaded = window.mdI18nDict;
    if (loaded && typeof loaded === 'object') {
      for (var key in loaded) {
        if (Object.prototype.hasOwnProperty.call(loaded, key)) {
          dicts[key] = loaded[key];
        }
      }
    }
  }

  function defaultLang() {
    var stored = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      stored = null;
    }
    if (SUPPORTED[stored]) return stored;
    var nav = (window.navigator && navigator.language) || '';
    return nav.toLowerCase().indexOf('zh') === 0 ? 'zh-CN' : 'en-US';
  }

  function t(key) {
    var primary = dicts[lang] || {};
    if (Object.prototype.hasOwnProperty.call(primary, key)) return primary[key];
    var fallback = dicts['zh-CN'] || {};
    if (Object.prototype.hasOwnProperty.call(fallback, key)) return fallback[key];
    return key;
  }

  function applyI18n() {
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-i18n');
      if (key) nodes[i].textContent = t(key);
    }
    var placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < placeholders.length; j++) {
      var placeholderKey = placeholders[j].getAttribute('data-i18n-placeholder');
      if (placeholderKey) placeholders[j].setAttribute('placeholder', t(placeholderKey));
    }
  }

  function isRTL(next) {
    return (next || lang) === 'ar-AR';
  }

  function setLang(next) {
    if (!SUPPORTED[next]) next = defaultLang();
    lang = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch (err) {
      // localStorage unavailable; keep in-memory lang
    }
    document.documentElement.lang = lang;
    document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';
    applyI18n();
  }

  mergeDicts();
  var lang = defaultLang();
  document.documentElement.lang = lang;
  document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';
  applyI18n();

  var mdI18n = {
    dicts: dicts,
    setLang: setLang,
    t: t,
    applyI18n: applyI18n,
    isRTL: isRTL
  };
  Object.defineProperty(mdI18n, 'lang', {
    get: function () { return lang; }
  });
  window.mdI18n = mdI18n;
})();
