/* LitEpub：EPUB 阅读薄封装（阶段六）。
 * UMD 双出口：纯逻辑（TOC 展平 / CFI 排序键 / 阅读位置 serde / 错误分类 / 选区转换）Node 可测；
 * openEpub() 仅浏览器（依赖 window.ePub = epub.js + window.JSZip）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LitEpub = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  function text(v) { return v == null ? '' : String(v); }

  /* ---------- 纯逻辑（Node 可测） ---------- */

  /** TOC 树展平为 [{label, href, depth}]；maxDepth 防御环状/异常结构 */
  function flattenToc(toc, maxDepth) {
    var out = [];
    var limit = maxDepth || 6;
    (function walk(items, depth) {
      if (!Array.isArray(items) || depth > limit) return;
      items.forEach(function (item) {
        if (!item) return;
        out.push({
          label: text(item.label).trim() || T('（无标题章节）'),
          href: text(item.href),
          depth: depth
        });
        if (item.subitems && item.subitems.length) walk(item.subitems, depth + 1);
      });
    })(toc || [], 0);
    return out;
  }

  /** CFI 排序键：epubcfi(/6/4[id]!/4/2/…) 中 "!" 前第一段的数字序列为 spine 路径。
   *  返回补零拼接串（字符串比较即可排出阅读顺序）；无法解析返回 null。
   *  注意：这是排序近似——同文档内不同位置共享前缀，按字符串比较仍有序。 */
  function cfiSortKey(cfi) {
    var head = text(cfi).split('!')[0];
    if (!head) return null;
    var nums = head.match(/\/(\d+)/g);
    if (!nums || !nums.length) return null;
    return nums.map(function (n) {
      return ('0000' + n.slice(1)).slice(-5);
    }).join('.');
  }

  function compareCfi(a, b) {
    var ka = cfiSortKey(a), kb = cfiSortKey(b);
    if (ka == null && kb == null) return 0;
    if (ka == null) return 1;
    if (kb == null) return -1;
    if (ka !== kb) return ka < kb ? -1 : 1;
    return text(a) < text(b) ? -1 : (text(a) > text(b) ? 1 : 0);
  }

  /** 阅读位置 serde（settings 表存储；宽容解析） */
  var FONT_SIZES = [16, 19, 23];
  var THEMES = ['light', 'sepia', 'dark'];

  function encodeReadPos(pos) {
    var p = pos && typeof pos === 'object' ? pos : {};
    var fontSize = FONT_SIZES.indexOf(Number(p.fontSize)) !== -1 ? Number(p.fontSize) : FONT_SIZES[0];
    var theme = THEMES.indexOf(text(p.theme)) !== -1 ? text(p.theme) : THEMES[0];
    return { cfi: text(p.cfi), fontSize: fontSize, theme: theme };
  }

  function decodeReadPos(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var pos = encodeReadPos(raw);
    return pos.cfi ? pos : null;
  }

  /** 打开失败分类：popup/ toast 展示具体原因 */
  function classifyError(err) {
    var msg = text(err && err.message || err).toLowerCase();
    if (/invalid or unsupported zip|not a zip|invalid zip|unrecognized zip/.test(msg)) {
      return { code: 'not-zip', message: T('文件不是有效的 ZIP/EPUB 容器') };
    }
    if (/container\.xml|opf|package|manifest|spine|ncx/.test(msg)) {
      return { code: 'no-package', message: T('EPUB 缺少容器描述或包文档（可能损坏）') };
    }
    if (/encrypt|drm|adept/.test(msg)) {
      return { code: 'encrypted', message: T('该 EPUB 受 DRM 加密，无法阅读') };
    }
    return { code: 'unknown', message: text(err && err.message || err) || T('未知错误') };
  }

  /** rendition "selected" 事件 → 批注数据（纯转换，Node 可测：range 传 {toString()} 即可） */
  function rangeToAnnotationData(range, cfiRange) {
    return {
      cfi: text(cfiRange),
      text: range ? text(range.toString ? range.toString() : range) : ''
    };
  }

  /* ---------- 浏览器侧（依赖 epub.js） ---------- */

  var THEME_CSS = {
    light: { body: { background: '#ffffff', color: '#262626' } },
    sepia: { body: { background: '#f5ecd9', color: '#4b3a24' } },
    dark: { body: { background: '#1d1f24', color: '#c9cdd4' } }
  };

  /** 字号步进：返回 (current ± 1) 档，越界回绕 */
  function stepFontSize(current, dir) {
    var i = FONT_SIZES.indexOf(Number(current));
    if (i === -1) i = 0;
    return FONT_SIZES[(i + dir + FONT_SIZES.length) % FONT_SIZES.length];
  }

  function stepTheme(current, dir) {
    var i = THEMES.indexOf(text(current));
    if (i === -1) i = 0;
    return THEMES[(i + dir + THEMES.length) % THEMES.length];
  }

  /**
   * 打开 EPUB。
   * opts = { container, width, height, flow, onRelocated(cfi, href), onSelected(cfiRange, range, contents) }
   * 返回 { book, rendition, destroyed,
   *        display(target), goTo(cfi), next(), prev(), resize(w, h),
   *        toc(), setFontSize(px), setTheme(name), fontSize, theme,
   *        currentCfi(), visibleText(), destroy() }
   */
  function openEpub(bytes, opts) {
    if (typeof window === 'undefined' || typeof window.ePub !== 'function') {
      throw new Error(T('epub.js 未加载'));
    }
    var o = opts || {};
    var book = window.ePub(bytes);
    var rendition = book.renderTo(o.container, {
      width: o.width || '100%',
      height: o.height || '100%',
      spread: 'none',
      flow: o.flow || 'paginated'
    });
    var state = { cfi: '', href: '', fontSize: FONT_SIZES[0], theme: THEMES[0], destroyed: false };

    rendition.on('relocated', function (location) {
      if (!location || !location.start) return;
      state.cfi = text(location.start.cfi);
      state.href = text(location.start.href);
      if (o.onRelocated) o.onRelocated(state.cfi, state.href);
    });
    rendition.on('selected', function (cfiRange, contents) {
      if (!o.onSelected) return;
      var range = null;
      try {
        var doc = contents && contents.document;
        var sel = doc ? doc.getSelection() : null;
        range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      } catch (e) { range = null; }
      o.onSelected(cfiRange, range, contents);
    });

    var api = {
      book: book,
      rendition: rendition,
      destroyed: false,
      locationsReady: false,   // epub.js locations 后台生成完成后切换精确百分比
      fontSize: function () { return state.fontSize; },
      theme: function () { return state.theme; },
      currentCfi: function () { return state.cfi; },
      currentHref: function () { return state.href; },
      display: function (target) { return rendition.display(target); },
      goTo: function (cfi) { return rendition.display(cfi); },
      next: function () { return rendition.next(); },
      prev: function () { return rendition.prev(); },
      resize: function (w, h) { rendition.resize(w || '100%', h || '100%'); },
      toc: function () {
        return book.loaded.navigation.then(function (nav) {
          return flattenToc(nav && nav.toc);
        });
      },
      setFontSize: function (px) {
        state.fontSize = FONT_SIZES.indexOf(Number(px)) !== -1 ? Number(px) : state.fontSize;
        try { rendition.themes.fontSize(state.fontSize + 'px'); } catch (e) {}
      },
      setTheme: function (name) {
        if (THEMES.indexOf(name) === -1) return;
        state.theme = name;
        try {
          rendition.themes.register('lb-' + name, THEME_CSS[name]);
          rendition.themes.select('lb-' + name);
        } catch (e) {}
      },
      /* 当前可见文本（朗读用）：拼接各 content document 的正文 innerText */
      visibleText: function () {
        var parts = [];
        try {
          rendition.getContents().forEach(function (contents) {
            var body = contents && contents.document && contents.document.body;
            if (!body) return;
            var t = (body.innerText || body.textContent || '').replace(/\s+/g, ' ').trim();
            if (t) parts.push(t);
          });
        } catch (e) {}
        return parts.join(' ');
      },
      /* 进度百分比：优先 epub.js locations（精确），未就绪时按 spine 章节占比（即时近似） */
      progress: function () {
        if (state.destroyed) return null;
        try {
          if (api.locationsReady && state.cfi) {
            var p = book.locations.percentageFromCfi(state.cfi);
            if (p != null) return { percent: Math.max(0, Math.min(100, p * 100)), source: 'locations' };
          }
          var items = book.spine && book.spine.items ? book.spine.items : [];
          var cur = state.href.split('#')[0];
          var idx = -1;
          for (var i = 0; i < items.length; i++) {
            if (String(items[i] && items[i].href || '').split('#')[0] === cur) { idx = i; break; }
          }
          if (idx === -1 || !items.length) return { percent: 0, source: 'spine' };
          return { percent: Math.max(0, Math.min(100, (idx + 0.5) / items.length * 100)), source: 'spine' };
        } catch (e) {
          return { percent: 0, source: 'spine' };
        }
      },
      /* 后台生成精确位置表（章节数 ≤ cap 才启用；生成期间导航由 epub.js 队列调度不阻塞） */
      enableLocations: function (cap) {
        var limit = cap || 80;
        try {
          var items = book.spine && book.spine.items ? book.spine.items : [];
          if (!items.length || items.length > limit) return Promise.resolve(false);
          return book.locations.generate(1024).then(function () {
            api.locationsReady = !state.destroyed;
            return api.locationsReady;
          }).catch(function () { return false; });
        } catch (e) { return Promise.resolve(false); }
      },
      /* 按百分比跳转：locations 就绪用精确 CFI，否则退 spine 章节 */
      seek: function (percent) {
        var p = Math.max(0, Math.min(100, Number(percent) || 0));
        try {
          if (api.locationsReady) {
            var cfi = book.locations.cfiFromPercentage(p / 100);
            if (cfi) return rendition.display(cfi);
          }
          var items = book.spine && book.spine.items ? book.spine.items : [];
          if (!items.length) return Promise.resolve();
          var idx = Math.min(items.length - 1, Math.floor(p / 100 * items.length));
          return rendition.display(items[idx].href);
        } catch (e) { return Promise.resolve(); }
      },
      destroy: function () {
        if (state.destroyed) return;
        state.destroyed = true;
        api.destroyed = true;
        try { rendition.destroy(); } catch (e) {}
        try { book.destroy(); } catch (e) {}
      }
    };
    api.setFontSize(state.fontSize);
    api.setTheme(state.theme);
    return api;
  }

  return {
    FONT_SIZES: FONT_SIZES,
    THEMES: THEMES,
    flattenToc: flattenToc,
    cfiSortKey: cfiSortKey,
    compareCfi: compareCfi,
    encodeReadPos: encodeReadPos,
    decodeReadPos: decodeReadPos,
    classifyError: classifyError,
    rangeToAnnotationData: rangeToAnnotationData,
    stepFontSize: stepFontSize,
    stepTheme: stepTheme,
    openEpub: openEpub
  };
});
