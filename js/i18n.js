/* LitBoard i18n：以 zh-CN 源串为键的轻量翻译层（浏览器 / Node 共用）
 *
 * 约定：代码里的用户可见文案一律写中文原文，经 t() 包裹；英文等译文放在
 * js/i18n-en.js 的词典里（键 = 中文原文）。zh-CN 是源语言，t() 恒等返回；
 * 其他语言查不到键时也回退中文原文，保证界面永不出现空洞。
 *
 * 静态 HTML（index.html）不写键：启动时 applyStatic() 按词典整串替换文本节点
 * 与 title/placeholder/aria-label 属性（此时文档里只有界面骨架、没有用户数据，
 * 整串精确匹配不会误伤用户内容）；语言切换时只刷新已标记节点，再由应用层
 * 全量重渲染动态区域。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitI18n = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var LANG_KEY = 'litboard.lang';
  var SOURCE_LANG = 'zh-CN';

  var locales = {};            // lang -> { 源串: 译文 }
  var current = SOURCE_LANG;
  var listeners = [];

  function normalizeLang(value) {
    var s = String(value == null ? '' : value).toLowerCase().replace(/_/g, '-');
    if (s.indexOf('zh') === 0) return SOURCE_LANG;
    if (s.indexOf('en') === 0) return 'en';
    return '';
  }

  function systemLang() {
    try {
      if (typeof navigator !== 'undefined' && navigator.language)
        return normalizeLang(navigator.language);
    } catch (e) { /* Node 无 navigator */ }
    return '';
  }

  function storedLang() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage.getItem(LANG_KEY) || '';
    } catch (e) { /* Node 无 localStorage */ }
    return '';
  }

  function detect() {
    // smoke 测试断言界面中文文本，语言必须是确定的 zh-CN（CI 通常是英文系统）。
    // 沙箱渲染进程拿不到 process.env， smoke 标志由 preload 暴露；
    // Node（window 不存在）恒为源语言，测试输出稳定。
    if (typeof window === 'undefined') return SOURCE_LANG;
    if (typeof process !== 'undefined' && process.env && process.env.LITBOARD_SMOKE_TEST) return SOURCE_LANG;
    var desktop = typeof window !== 'undefined' && window.litboardDesktop;
    if (desktop && desktop.isSmokeTest) return SOURCE_LANG;
    return normalizeLang(storedLang()) || systemLang() || SOURCE_LANG;
  }

  function getLang() { return current; }

  function setLang(lang, options) {
    var opts = options || {};
    var next;
    if (lang === 'auto') {
      // 跟随系统：清除持久化选择，用系统语言
      try { if (typeof localStorage !== 'undefined') localStorage.removeItem(LANG_KEY); } catch (e) { /* 忽略 */ }
      next = systemLang() || SOURCE_LANG;
    } else {
      next = normalizeLang(lang) || SOURCE_LANG;
      if (opts.persist !== false && typeof localStorage !== 'undefined') {
        try { localStorage.setItem(LANG_KEY, next); } catch (e) { /* 隐私模式等 */ }
      }
    }
    var changed = next !== current;
    current = next;
    if (changed) {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](current); } catch (e) { /* 监听器异常不阻断其他 */ }
      }
    }
    return current;
  }

  function init() {
    current = detect();
    return current;
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return function () {
      var idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  function register(lang, dict) {
    if (!normalizeLang(lang) || !dict) return;
    locales[normalizeLang(lang)] = dict;
  }

  function dictFor(lang) {
    return locales[lang] || null;
  }

  /* 核心：查词典 + {name} 插值。zh-CN 或未命中键时恒等回退。 */
  function t(str, params) {
    if (str == null) return '';
    var out = String(str);
    if (current !== SOURCE_LANG) {
      var dict = dictFor(current);
      if (dict && Object.prototype.hasOwnProperty.call(dict, out)) {
        var v = dict[out];
        if (v != null && v !== '') out = v;
      }
    }
    if (params) {
      out = out.replace(/\{([A-Za-z0-9_]+)\}/g, function (m, name) {
        return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m;
      });
    }
    return out;
  }

  /* 纯函数版单串翻译（applyStatic 内部用，Node 可测）：
   * 返回译文；lang 为源语言或无译文时返回 null（调用方保留原文）。 */
  function pick(text, lang) {
    if (current === SOURCE_LANG || lang === SOURCE_LANG) return null;
    var dict = dictFor(lang || current);
    if (!dict) return null;
    var key = String(text).trim();
    if (!key || !Object.prototype.hasOwnProperty.call(dict, key)) return null;
    var v = dict[key];
    return (v == null || v === '') ? null : v;
  }

  var MARK_KEY = 'data-i18n';        // 已翻译标记：值为 encodeURIComponent(源串)
  var MARK_ORIG = 'data-i18n-orig';  // 原始整串文本（含空白），切回 zh 时还原
  var MARK_ATTRS = 'data-i18n-attrs';// 已翻译属性名列表，空格分隔
  var TRANSLATED_ATTRS = ['title', 'placeholder', 'aria-label'];

  function restoreElement(el) {
    // 切回 zh：把被翻译过的文本节点还原为原串（标记时存的是整段原文）
    var orig = el.getAttribute(MARK_ORIG);
    if (orig != null) {
      for (var c = 0; c < el.childNodes.length; c++) {
        var child = el.childNodes[c];
        if (child.nodeType === 3 && child.nodeValue && child.nodeValue.trim()) {
          child.nodeValue = orig;
          break;
        }
      }
    }
    el.removeAttribute(MARK_KEY);
    el.removeAttribute(MARK_ORIG);
    el.removeAttribute(MARK_ATTRS);
  }

  function applyStatic(root) {
    if (typeof document === 'undefined') return 0;
    root = root || document;
    var doc = root.ownerDocument || document;
    var count = 0;
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var text = node.nodeValue;
      if (!text || !text.trim()) return;
      var parent = node.parentElement;
      if (!parent || parent.closest('script,style,textarea,[contenteditable="true"],[data-no-i18n]')) return;
      if (current === SOURCE_LANG) {
        // 切回源语言：还原已标记节点
        if (parent.hasAttribute && parent.hasAttribute(MARK_KEY)) {
          restoreElement(parent);
          count++;
        }
        return;
      }
      var marked = parent.hasAttribute && parent.hasAttribute(MARK_KEY);
      if (marked) {
        // 已标记：取原串重新查词典，按原串的空白结构刷新译文
        var key = decodeURIComponent(parent.getAttribute(MARK_KEY));
        var orig = parent.getAttribute(MARK_ORIG);
        var v = pick(key, current);
        node.nodeValue = (v == null ? (orig != null ? orig : key)
          : (orig != null ? orig : key).replace(key, v));
        count++;
        return;
      }
      var hit = pick(text, current);
      if (hit == null) return;
      parent.setAttribute(MARK_KEY, encodeURIComponent(text.trim()));
      parent.setAttribute(MARK_ORIG, text);
      node.nodeValue = text.replace(text.trim(), hit);
      count++;
    });
    // 属性翻译：title / placeholder / aria-label 精确整串匹配
    if (current !== SOURCE_LANG) {
      TRANSLATED_ATTRS.forEach(function (name) {
        var els = root.querySelectorAll
          ? root.querySelectorAll('[' + name + ']:not([' + MARK_ATTRS + '*="' + name + '"])')
          : [];
        Array.prototype.forEach.call(els, function (el) {
          if (el.closest && el.closest('script,style,[contenteditable="true"],[data-no-i18n]')) return;
          var value = el.getAttribute(name);
          if (!value || !value.trim()) return;
          var hit = pick(value, current);
          if (hit == null) return;
          el.setAttribute(name, hit);
          var marked = (el.getAttribute(MARK_ATTRS) || '').split(' ').filter(Boolean);
          if (marked.indexOf(name) === -1) marked.push(name);
          el.setAttribute(MARK_ATTRS, marked.join(' '));
          if (!el.hasAttribute(MARK_KEY)) {
            el.setAttribute(MARK_KEY, encodeURIComponent(value));
          }
          count++;
        });
      });
    } else {
      // 切回 zh：还原已标记属性
      var markedEls = root.querySelectorAll ? root.querySelectorAll('[' + MARK_ATTRS + ']') : [];
      Array.prototype.forEach.call(markedEls, function (el) {
        var key = el.getAttribute(MARK_KEY);
        if (key == null) return;
        var orig = decodeURIComponent(key);
        (el.getAttribute(MARK_ATTRS) || '').split(' ').forEach(function (name) {
          if (name) el.setAttribute(name, orig);
        });
        el.removeAttribute(MARK_ATTRS);
        el.removeAttribute(MARK_KEY);
        el.removeAttribute(MARK_ORIG);
        count++;
      });
    }
    return count;
  }

  init();

  return {
    t: t,
    pick: pick,
    init: init,
    detect: detect,
    getLang: getLang,
    setLang: setLang,
    register: register,
    onChange: onChange,
    applyStatic: applyStatic,
    normalizeLang: normalizeLang,
    SOURCE_LANG: SOURCE_LANG,
    LANG_KEY: LANG_KEY
  };
});
