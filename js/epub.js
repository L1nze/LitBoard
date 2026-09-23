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

  /* ---------- 正文抽取（全文索引用；纯字符串处理，Node 可测） ----------   * 全文索引把 EPUB 按 spine 章节抽成「页」（spine 序 = 页序），与 PDF 共用
   * pdf_text/pdf_fts 存储与检索。解压由调用方负责（渲染层 JSZip），本层只做
   * XML/HTML 字符串解析。 */

  /** container.xml → OPF 路径（rootfile full-path）；解析不到返回 '' */
  function opfPathFromContainer(containerXml) {
    var m = text(containerXml).match(/full-path\s*=\s*"([^"]+)"/i) ||
      text(containerXml).match(/full-path\s*=\s*'([^']+)'/i);
    return m ? m[1] : '';
  }

  /** 标签内取属性值（单双引号都认；找不到返回 null） */
  function attr(tag, name) {
    var m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i')) ||
      tag.match(new RegExp('\\b' + name + "\\s*=\\s*'([^']*)'", 'i'));
    return m ? m[1] : null;
  }

  /** href 相对 OPF 目录解析成 zip 内路径：去 fragment、URL 解码、posix join */
  function resolveHref(opfPath, href) {
    var clean = text(href).split('#')[0].replace(/^\.\//, '').trim();
    if (!clean) return '';
    try { clean = decodeURIComponent(clean); } catch (e) { /* 保留原样 */ }
    var dir = text(opfPath).split('/');
    dir.pop();
    var parts = clean.split('/');
    var stack = dir.filter(Boolean);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '' || parts[i] === '.') continue;
      if (parts[i] === '..') stack.pop();
      else stack.push(parts[i]);
    }
    return stack.join('/');
  }

  /** OPF → spine 顺序的正文文件路径数组（清单缺项/非文档项跳过） */
  function spineHrefsFromOpf(opfXml) {
    var xml = text(opfXml);
    var manifest = xml.match(/<manifest\b[\s\S]*?<\/manifest>/i);
    var spine = xml.match(/<spine\b[\s\S]*?<\/spine>/i);
    if (!manifest || !spine) return [];
    var hrefById = {};
    var itemRe = /<item\b[^>]*>/gi;
    var tag;
    while ((tag = itemRe.exec(manifest[0])) !== null) {
      var id = attr(tag[0], 'id');
      var href = attr(tag[0], 'href');
      if (id && href) hrefById[id] = href;
    }
    var out = [];
    var refRe = /<itemref\b[^>]*>/gi;
    while ((tag = refRe.exec(spine[0])) !== null) {
      var spineHref = hrefById[attr(tag[0], 'idref') || ''];
      if (spineHref) out.push(spineHref);
    }
    return out;
  }

  var NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

  function decodeEntities(s) {
    return text(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (all, body) {
      if (body.charAt(0) === '#') {
        var code = body.charAt(1) === 'x' || body.charAt(1) === 'X'
          ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
      }
      return NAMED_ENTITIES[body.toLowerCase()] != null ? NAMED_ENTITIES[body.toLowerCase()] : all;
    });
  }

  /** XHTML → 纯文本：head/script/style 剔除，块级边界换行，标签剥离，实体解码，空白收敛 */
  function xhtmlToText(xhtml) {
    var s = text(xhtml);
    s = s.replace(/<head\b[\s\S]*?<\/head>/gi, ' ');
    s = s.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ');
    s = s.replace(/<!--[\s\S]*?-->/g, ' ');
    // 块级结束标签与 <br> 是换行边界；其余标签一律剥掉
    s = s.replace(/<\/(?:p|div|h[1-6]|li|tr|section|article|blockquote|figcaption|title|dd|dt|table|ul|ol)\s*>|<br\s*\/?\s*>/gi, '\n');
    s = s.replace(/<[^>]+>/g, '');
    s = decodeEntities(s);
    // 行内空白折叠、空行收敛为单空行（段落间隔保留，利于按页阅读的排版观感）
    s = s.replace(/[ \t\r\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n\n');
    return s.trim();
  }

  /** spine 路径 + zip 内文件文本 → 各章节纯文本数组（缺文件记空串，保持页序对齐 spine） */
  function chapterTexts(spinePaths, fileTexts) {
    return (spinePaths || []).map(function (p) { return xhtmlToText((fileTexts || {})[p]); });
  }

  /* ---------- 浏览器侧（依赖 vendor/foliate 的 LitFoliate，钉 commit 见 scripts/foliate-bundle） ---------- */

  var THEME_CSS = {
    light: { background: '#ffffff', color: '#262626' },
    sepia: { background: '#f5ecd9', color: '#4b3a24' },
    dark: { background: '#1d1f24', color: '#c9cdd4' }
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

  /** textAnchor 章内查找（CFI 解析失败时的回退；纯函数，Node 可测）。
   *  textNodes: [{ data }] 文本节点序列；anchor: { exact, prefix, suffix }。
   *  返回 { startNode, startOffset, endNode, endOffset }（节点下标 + 节点内偏移）或 null。
   *  精确串多命中时用 prefix/suffix 校验；仍有多命中取第一处（书内同文重复时定位到其一，可接受）。 */
  function findAnchorRange(textNodes, anchor) {
    var a = anchor && typeof anchor === 'object' ? anchor : {};
    var exact = text(a.exact);
    if (!exact) return null;
    var full = '';
    var offsets = [];
    var nodes = textNodes || [];
    for (var i = 0; i < nodes.length; i++) {
      offsets.push(full.length);
      full += text(nodes[i] && nodes[i].data);
    }
    var at = full.indexOf(exact);
    while (at !== -1) {
      var prefixOk = !a.prefix || full.slice(Math.max(0, at - text(a.prefix).length), at) === text(a.prefix);
      var suffixOk = !a.suffix ||
        full.slice(at + exact.length, at + exact.length + text(a.suffix).length) === text(a.suffix);
      if (prefixOk && suffixOk) {
        var end = at + exact.length;
        var s = 0;
        while (s + 1 < offsets.length && offsets[s + 1] <= at) s++;
        var e = s;
        while (e + 1 < offsets.length && offsets[e + 1] < end) e++;
        return { startNode: s, startOffset: at - offsets[s], endNode: e, endOffset: end - offsets[e] };
      }
      at = full.indexOf(exact, at + 1);
    }
    return null;
  }

  /**
   * 打开 EPUB（foliate-js 适配层；对外契约与 epub.js 时代一致）。
   * opts = { container, onRelocated(cfi, href), onSelected(cfiRange, range, contents) }
   * 同步返回 api（内核 makeBook 是异步的——display/goTo/next/toc 等方法内部先等打开完成）：
   *   { book, rendition, destroyed, display(target), goTo(cfi, textAnchor), next(), prev(), resize(),
   *     toc(), setFontSize(px), setTheme(name), fontSize, theme, currentCfi(), currentHref(),
   *     visibleText(), progress(), seek(percent), enableLocations(cap), destroy() }
   * 内核差异：progress 为字节加权精确值（旧 locations 机制废弃，
   * enableLocations 退为恒就绪 no-op）；visibleText 粒度从整章升到当前可见页（TTS 受益）；
   * 旧 epub.js CFI 由上游 resolveCFI 兼容（含错误 ID 断言重试），解析失败再走
   * goTo 第二参 textAnchor（exact/prefix/suffix 章内查找，findAnchorRange）→ 书首保底。
   */
  function openEpub(bytes, opts) {
    if (typeof window === 'undefined' || !window.LitFoliate || typeof window.LitFoliate.makeBook !== 'function') {
      throw new Error(T('EPUB 组件未加载'));
    }
    var o = opts || {};
    var container = o.container;
    if (!container) throw new Error('openEpub: container required');
    // 移除加载占位（保留 #epub-progress 等常驻元素——keepEpubProgress 已先挂回）
    Array.prototype.forEach.call(container.querySelectorAll('.pdf-loading'), function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    var view = document.createElement('foliate-view');
    container.appendChild(view);

    var state = {
      cfi: '', href: '', index: -1, fraction: 0, range: null,
      fontSize: FONT_SIZES[0], theme: THEMES[0], destroyed: false
    };
    // 批注外观登记：cfi → { type, color }（draw-annotation 回调与 create-overlay 重挂共用）
    var annStyles = new Map();
    var selTimer = null;
    var openedPromise = null;

    function ensureOpen() {
      if (openedPromise) return openedPromise;
      var file = (typeof File === 'function')
        ? new File([bytes], 'book.epub', { type: 'application/epub+zip' })
        : new Blob([bytes], { type: 'application/epub+zip' });
      openedPromise = window.LitFoliate.makeBook(file).then(function (book) {
        if (state.destroyed) { try { book.destroy(); } catch (e) {} throw new Error('EPUB 已关闭'); }
        api.book = book;
        return view.open(book);
      }).then(function () {
        applyStyles();
        return api;
      });
      return openedPromise;
    }

    view.addEventListener('relocate', function (e) {
      var detail = e.detail || {};
      // relocate.cfi 是范围形态（parent,,end，start 为空段）——折叠到 end 端点再存：
      // 与旧库 location.start.cfi 同语义，readpos / goTo / cfiSortKey 全走点 CFI（探针 G8 验证可解析）
      try {
        state.cfi = window.LitFoliate.CFI.collapse(text(detail.cfi), true);
      } catch (err) { state.cfi = text(detail.cfi); }
      state.fraction = typeof detail.fraction === 'number' ? detail.fraction : state.fraction;
      state.range = detail.range || null;
      try {
        var contents = view.renderer && view.renderer.getContents ? view.renderer.getContents() : [];
        if (contents && contents[0] && typeof contents[0].index === 'number') state.index = contents[0].index;
      } catch (err) { /* 渲染器尚未就绪 */ }
      state.href = '';
      try {
        var sections = view.book && view.book.sections || [];
        if (state.index >= 0 && sections[state.index]) state.href = text(sections[state.index].id);
      } catch (err) {}
      if (o.onRelocated && !state.destroyed) o.onRelocated(state.cfi, state.href);
    });

    // 选区 → CFI（旧库 selected 事件的等价物：content doc 的 selectionchange，去抖 200ms）
    view.addEventListener('load', function (e) {
      var doc = e.detail && e.detail.doc;
      var index = e.detail && e.detail.index;
      if (!doc || typeof index !== 'number') return;
      doc.addEventListener('selectionchange', function () {
        if (selTimer) clearTimeout(selTimer);
        selTimer = setTimeout(function () {
          if (state.destroyed || !o.onSelected) return;
          var sel = null;
          try { sel = doc.getSelection(); } catch (err) { sel = null; }
          if (!sel || sel.isCollapsed || !sel.rangeCount) return;
          var range = sel.getRangeAt(0);
          var cfi = '';
          try { cfi = view.getCFI(index, range); } catch (err) { cfi = ''; }
          if (!cfi) return;
          o.onSelected(cfi, range, { window: doc.defaultView, document: doc });
        }, 200);
      });
    });

    // 批注：draw-annotation 决定外观；create-overlay 时重挂已登记批注（官方 reader.js 模式）
    view.addEventListener('draw-annotation', function (e) {
      var d = e.detail || {};
      var st = annStyles.get(d.annotation && d.annotation.value) || {};
      var draw = st.type === 'underline'
        ? window.LitFoliate.Overlayer.underline : window.LitFoliate.Overlayer.highlight;
      d.draw(draw, st.color ? { color: st.color } : undefined);
    });
    view.addEventListener('create-overlay', function () {
      if (state.destroyed) return;
      annStyles.forEach(function (_, cfi) {
        view.addAnnotation({ value: cfi }).catch(function () {});
      });
    });

    function applyStyles() {
      if (state.destroyed || !view.renderer || !view.renderer.setStyles) return;
      var t = THEME_CSS[state.theme] || THEME_CSS.light;
      try {
        view.renderer.setStyles('body { font-size: ' + state.fontSize + 'px; background: ' +
          t.background + '; color: ' + t.color + '; }');
      } catch (e) {}
    }

    /** CFI 跳转 + 回退链：view.goTo（内部 resolveCFI，含旧库 ID 断言兼容）→ textAnchor
     *  逐章 createDocument 查找（上限 300 章）→ 书首保底。成功时原样透传 view.goTo 的返回。 */
    function goToWithFallback(cfi, textAnchor) {
      var target = text(cfi);
      return ensureOpen().then(function () {
        return view.goTo(target);
      }).then(function (resolved) {
        if (resolved) return { resolved: resolved };
        // 回退：textAnchor 章内查找（旧 epub.js CFI 解析失败的主要兜底）
        var anchor = textAnchor && typeof textAnchor === 'object' && textAnchor.exact ? textAnchor : null;
        if (!anchor) return null;
        var sections = view.book && view.book.sections || [];
        var limit = Math.min(sections.length, 300);
        var chain = Promise.resolve(null);
        for (var i = 0; i < limit; i++) {
          (function (idx) {
            chain = chain.then(function (found) {
              if (found || state.destroyed) return found;
              return Promise.resolve().then(function () {
                return sections[idx].createDocument();
              }).then(function (doc) {
                if (!doc || !doc.body) return null;
                var nodes = [];
                var walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
                var n;
                while ((n = walker.nextNode())) nodes.push(n);
                var hit = findAnchorRange(nodes, anchor);
                if (!hit) return null;
                var range = doc.createRange();
                range.setStart(nodes[hit.startNode], hit.startOffset);
                range.setEnd(nodes[hit.endNode], hit.endOffset);
                return { index: idx, anchor: function () { return range; } };
              }).catch(function () { return null; });
            });
          })(i);
        }
        return chain.then(function (found) { return found ? { fallback: found } : null; });
      }).then(function (outcome) {
        if (state.destroyed) return null;
        if (outcome && outcome.resolved) return outcome.resolved; // 直接成功：已跳转，原样透传
        if (outcome && outcome.fallback) return view.renderer.goTo(outcome.fallback); // 回退命中：执行跳转
        return view.goTo(0); // 保底：书首（不崩、不静默挂起）
      });
    }

    var api = {
      book: null,          // ensureOpen 后为 foliate book（消费方只用 sections 元数据形态）
      rendition: null,     // annotations 外观（见下）
      destroyed: false,
      fontSize: function () { return state.fontSize; },
      theme: function () { return state.theme; },
      currentCfi: function () { return state.cfi; },
      currentHref: function () { return state.href; },
      display: function (target) {
        return ensureOpen().then(function () {
          if (target == null || target === '') return view.init({});
          return goToWithFallback(target, null);
        });
      },
      /** goTo(cfi) 常规；goTo(cfi, textAnchor) 供批注跳转传回退锚（app.js 一处调用已带） */
      goTo: function (cfi, textAnchor) {
        return goToWithFallback(cfi, textAnchor);
      },
      next: function () { return ensureOpen().then(function () { return view.next(); }); },
      prev: function () { return ensureOpen().then(function () { return view.prev(); }); },
      resize: function () { /* foliate 走 ResizeObserver 自适应，无需手动重排 */ },
      toc: function () {
        return ensureOpen().then(function () {
          return view.book && view.book.toc ? flattenToc(view.book.toc) : [];
        });
      },
      setFontSize: function (px) {
        if (FONT_SIZES.indexOf(Number(px)) === -1) return;
        state.fontSize = Number(px);
        ensureOpen().then(applyStyles).catch(function () {});
      },
      setTheme: function (name) {
        if (THEMES.indexOf(name) === -1) return;
        state.theme = name;
        ensureOpen().then(applyStyles).catch(function () {});
      },
      /* 当前可见文本（朗读用）：relocate 的可见页 range（粒度=当前页，旧库为整章） */
      visibleText: function () {
        try {
          return state.range ? String(state.range).replace(/\s+/g, ' ').trim() : '';
        } catch (e) { return ''; }
      },
      /* 进度：foliate SectionProgress 字节加权，恒精确（source 兼容旧字段名） */
      progress: function () {
        if (state.destroyed) return null;
        return { percent: Math.max(0, Math.min(100, state.fraction * 100)), source: 'sections' };
      },
      /* 旧 locations 机制废弃：恒「就绪」（progress 本就是精确值） */
      enableLocations: function () { return Promise.resolve(true); },
      /* 按百分比跳转：字节加权分数反查 */
      seek: function (percent) {
        var p = Math.max(0, Math.min(100, Number(percent) || 0));
        return ensureOpen().then(function () { return view.goToFraction(p / 100); });
      },
      destroy: function () {
        if (state.destroyed) return;
        state.destroyed = true;
        api.destroyed = true;
        if (selTimer) { clearTimeout(selTimer); selTimer = null; }
        Promise.resolve(openedPromise).then(function () {
          try { view.close(); } catch (e) {}
        }).catch(function () {});
        if (view.parentNode) view.parentNode.removeChild(view);
      }
    };

    /* rendition.annotations 外观：旧 epub.js 调用形态收编为 foliate addAnnotation/deleteAnnotation */
    api.rendition = {
      annotations: {
        add: function (type, cfi, data, callback, cls, styles) {
          if (state.destroyed || !cfi) return;
          annStyles.set(text(cfi), {
            type: type === 'underline' ? 'underline' : 'highlight',
            color: styles && styles.fill || ''
          });
          ensureOpen().then(function () {
            return view.addAnnotation({ value: text(cfi) });
          }).catch(function () {});
        },
        remove: function (type, cfi) {
          if (state.destroyed || !cfi) return;
          annStyles.delete(text(cfi));
          ensureOpen().then(function () {
            return view.deleteAnnotation({ value: text(cfi) });
          }).catch(function () {});
        }
      }
    };

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
    opfPathFromContainer: opfPathFromContainer,
    spineHrefsFromOpf: spineHrefsFromOpf,
    resolveHref: resolveHref,
    xhtmlToText: xhtmlToText,
    chapterTexts: chapterTexts,
    stepFontSize: stepFontSize,
    stepTheme: stepTheme,
    findAnchorRange: findAnchorRange,
    openEpub: openEpub
  };
});
