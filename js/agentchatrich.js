/* LitBoard AI 聊天富内容后处理（公式 / mermaid，均懒加载）。从 agentui.js 拆出
 * （2026-10 架构整理）：自包含（除 window/document 外无外部状态），供 agentui
 * 挂载聊天容器时使用；typesetMath 同时经 LitAgentUi.typesetMath 转出（冒烟断言用）。
 *
 * 正文经 LitMarkdown 渲染：$...$ / $$...$$ 已被摘成 .lb-math / .lb-math-block
 * 节点（内容 = 转义后的原始 LaTeX，textContent 即 TeX 源）；```mermaid 围栏落成
 * div.lb-mermaid 占位（data-mmd-src 带源码）。聊天是 React 侧渲染——流式增量每个
 * chunk 都会整条消息重设 innerHTML，把已排版的 SVG 一并销毁。因此这里做三件事：
 * 1) 渲染结果缓存（TeX → SVG / mermaid 源码 → SVG）：DOM 重建后在 MutationObserver
 *    回调（微任务，先于绘制）里同步回填缓存命中，用户看不到公式闪回源码；
 * 2) 节流扫描（先导沿 + 尾随）替代旧防抖——高频 chunk 会把纯防抖无限重置，
 *    公式要等流式结束才出现（饿死）；节流保证流式期间每 ~0.7s 就排版一轮新增公式；
 * 3) mermaid 流式语义：解析失败不标记成功，保留源码展示；源码随 chunk 变长后
 *    DOM 重建、自然重试，直到能 parse 才成图。
 * MathJax（tex-svg 单文件）与 mermaid（vendor/mermaid UMD）都只在首次出现
 * 对应内容时才注入，没有公式/图的会话零开销。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitAgentChatRich = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 先导沿 + 尾随节流：冷却窗口内只排队一次，窗口到期补跑；首触发立即执行 */
  function makeThrottle(ms) {
    var cooldown = null, queued = null;
    return function (fn) {
      if (cooldown) { queued = fn; return; }
      cooldown = setTimeout(function () {
        cooldown = null;
        if (queued) { var run = queued; queued = null; run(); }
      }, ms);
      fn();
    };
  }

  function cachePut(map, key, value, max) {
    if (map.has(key)) map.delete(key); // 重置插入序，做简单 LRU
    map.set(key, value);
    if (map.size > max) {
      var oldest = map.keys().next().value;
      map.delete(oldest);
    }
  }

  var MATH_SWEEP_MS = 700, MERMAID_SWEEP_MS = 1200;
  var MATH_CACHE_MAX = 400, MERMAID_CACHE_MAX = 100;
  var mathSvgCache = new Map();     // (display?'B':'I')+\0+TeX → mjx-container outerHTML
  var mermaidSvgCache = new Map();  // mermaid 源码 → svg 串
  var mmdSeq = 0;
  var mathjaxPromise = null;
  function ensureMathJax() {
    if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
      return window.MathJax.startup.promise;
    }
    if (mathjaxPromise) return mathjaxPromise;
    // 配置必须在脚本加载前就位；菜单在桌面应用里是干扰，关掉
    window.MathJax = {
      startup: { typeset: false },
      options: { enableMenu: false },
      // tex2svgPromise 逐节点使用时，全局字形缓存不会挂进页面；每张 SVG 自带字形定义。
      svg: { fontCache: 'local' }
    };
    mathjaxPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'vendor/mathjax/tex-svg.js';
      script.onload = function () {
        (window.MathJax && window.MathJax.startup ? window.MathJax.startup.promise : Promise.resolve())
          .then(resolve, reject);
      };
      script.onerror = function () { reject(new Error('MathJax 加载失败')); };
      document.head.appendChild(script);
    });
    // 加载失败后允许重试（下次出现公式再试一次）
    mathjaxPromise.catch(function () { mathjaxPromise = null; });
    return mathjaxPromise;
  }

  /** 同步回填缓存命中的公式（微任务时机调用可先于绘制，消除源码闪烁）；返回命中数 */
  function restoreCachedMath(root) {
    var pending = root.querySelectorAll('.lb-math:not([data-math-typeset]), .lb-math-block:not([data-math-typeset])');
    var hits = 0;
    Array.prototype.forEach.call(pending, function (span) {
      var tex = span.textContent;
      var cached = mathSvgCache.get((span.classList.contains('lb-math-block') ? 'B\u0000' : 'I\u0000') + tex);
      if (cached == null) return;
      span.setAttribute('data-math-typeset', '1');
      span.innerHTML = cached;
      hits++;
    });
    return hits;
  }

  /** 对 root 内尚未处理的公式做类型化；缓存命中同步回填，未命中走 MathJax。
   * 无（新）公式返回 false，处理了返回 true。失败（LaTeX 语法错等）保留原文，
   * 绝不打断消息显示。 */
  function typesetMath(root) {
    if (!root || !root.querySelectorAll) return Promise.resolve(false);
    restoreCachedMath(root);
    var pending = Array.prototype.slice.call(
      root.querySelectorAll('.lb-math:not([data-math-typeset]), .lb-math-block:not([data-math-typeset])'));
    if (!pending.length) return Promise.resolve(false);
    pending.forEach(function (span) { span.setAttribute('data-math-typeset', '1'); });
    return ensureMathJax().then(function () {
      var MathJax = window.MathJax;
      var chain = Promise.resolve();
      pending.forEach(function (span) {
        var tex = span.textContent;
        var display = span.classList.contains('lb-math-block');
        var key = (display ? 'B\u0000' : 'I\u0000') + tex;
        var cached = mathSvgCache.get(key);
        if (cached != null) {
          span.innerHTML = cached;
          return;
        }
        chain = chain.then(function () {
          return MathJax.tex2svgPromise(tex, { display: display }).then(function (node) {
            span.textContent = '';
            span.appendChild(node);
            cachePut(mathSvgCache, key, node.outerHTML, MATH_CACHE_MAX);
          }).catch(function () {
            // 单条公式失败（LaTeX 语法错误等）：还原为原文继续展示
            span.removeAttribute('data-math-typeset');
          });
        });
      });
      return chain.then(function () { return true; });
    }).catch(function () {
      // MathJax 本身加载失败：全部还原（下次 Observer 触发会重试）
      pending.forEach(function (span) { span.removeAttribute('data-math-typeset'); });
      return false;
    });
  }

  /* ---------------- mermaid 渲染（vendor/mermaid UMD，懒加载） ----------------
   * div.lb-mermaid 占位（markdown.js 的 fence 拦截产出）→ mermaid.parse 校验 →
   * mermaid.render 成图。流式期间源码不完整、parse 会失败：保留源码块展示、
   * 不标记成功；源码随 chunk 变长后 React 重建 DOM、节点状态归零，自然重试。
   * securityLevel 固定 strict（模型输出不可信，标签一律转义）；主题跟随应用
   * 明暗（data-theme 前缀，auto 时看 colorScheme），切换时清缓存并重排已成的图。
   *
   * 配色不直接用 mermaid 内置 'default'/'dark' 主题——其节点底色（淡紫 #ECECFF /
   * 近黑）与 LitBoard 色板脱节，图框文字与背景对照失衡。这里按应用 CSS tokens
   * 重组两套 themeVariables：亮色走 neutral 底 + 蓝灰面板色（css --surface-2 /
   * --text-primary / --text-muted），暗色走 dark 底 + Catppuccin Mocha
   * （surface0 #313244 / 文字 #e2e8f7 / 描边 surface2 #585b70），背景透明融入
   * 气泡，字体族与字号跟随应用界面。 */
  var mermaidLibPromise = null;
  var mermaidTheme = null;
  var MERMAID_FONT = '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
  var MERMAID_THEMES = {
    light: {
      theme: 'neutral',
      variables: {
        fontFamily: MERMAID_FONT,
        fontSize: '13px',
        background: 'transparent',
        primaryColor: '#f1f3f7',            // --surface-2：节点底 = 面板色，融入界面
        mainBkg: '#f1f3f7',
        primaryTextColor: '#0f172a',        // --text-primary
        textColor: '#0f172a',
        nodeBorder: 'rgba(15, 23, 42, 0.22)',
        primaryBorderColor: 'rgba(15, 23, 42, 0.22)',
        lineColor: '#5f7086',               // --text-muted：连线与箭头
        edgeLabelBackground: '#ffffff',     // 边标签衬底 = 气泡底色
        clusterBkg: 'rgba(15, 23, 42, 0.04)',
        clusterBorder: 'rgba(15, 23, 42, 0.16)',
        // 时序图：人偶条/标签盒与流程节点同色系，信号线用 muted
        actorBkg: '#f1f3f7', actorBorder: 'rgba(15, 23, 42, 0.22)', actorTextColor: '#0f172a',
        actorLineColor: 'rgba(15, 23, 42, 0.22)',
        signalColor: '#5f7086', signalTextColor: '#0f172a',
        labelBoxBkgColor: '#e6e9f0', labelBoxBorderColor: 'rgba(15, 23, 42, 0.22)', labelTextColor: '#0f172a',
        loopTextColor: '#0f172a', noteBkgColor: '#fff8e8', noteBorderColor: 'rgba(15, 23, 42, 0.16)', noteTextColor: '#0f172a'
      }
    },
    dark: {
      theme: 'dark',
      variables: {
        fontFamily: MERMAID_FONT,
        fontSize: '13px',
        background: 'transparent',
        primaryColor: '#313244',            // Catppuccin Mocha surface0
        mainBkg: '#313244',
        primaryTextColor: '#e2e8f7',        // --text-primary（暗）
        textColor: '#e2e8f7',
        nodeBorder: '#585b70',              // Mocha surface2
        primaryBorderColor: '#585b70',
        lineColor: '#7f849c',               // --text-muted（暗）：低饱和连线不抢正文
        edgeLabelBackground: '#1e1e2e',     // Mocha base = 暗色气泡底
        clusterBkg: 'rgba(49, 50, 68, 0.45)',
        clusterBorder: '#45475a',
        actorBkg: '#313244', actorBorder: '#585b70', actorTextColor: '#e2e8f7',
        actorLineColor: '#585b70',
        signalColor: '#7f849c', signalTextColor: '#e2e8f7',
        labelBoxBkgColor: '#313244', labelBoxBorderColor: '#585b70', labelTextColor: '#e2e8f7',
        loopTextColor: '#e2e8f7', noteBkgColor: '#45475a', noteBorderColor: '#585b70', noteTextColor: '#e2e8f7'
      }
    }
  };

  function mermaidThemeNow() {
    var doc = document.documentElement;
    var v = doc.getAttribute('data-theme') || '';
    if (/^dark/i.test(v)) return 'dark';
    if (/^light/i.test(v)) return 'default';
    try { return /dark/i.test(getComputedStyle(doc).colorScheme || '') ? 'dark' : 'default'; }
    catch (e) { return 'default'; }
  }

  function ensureMermaid() {
    if (window.mermaid && window.mermaid.initialize) return Promise.resolve(window.mermaid);
    if (mermaidLibPromise) return mermaidLibPromise;
    mermaidLibPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'vendor/mermaid/mermaid.min.js';
      script.onload = function () {
        window.mermaid && window.mermaid.initialize
          ? resolve(window.mermaid) : reject(new Error('mermaid 不可用'));
      };
      script.onerror = function () { reject(new Error('mermaid 加载失败')); };
      document.head.appendChild(script);
    });
    // 加载失败后允许重试（下次出现 mermaid 块再试一次）
    mermaidLibPromise.catch(function () { mermaidLibPromise = null; });
    return mermaidLibPromise;
  }

  /** 拿到按当前主题初始化好的 mermaid；主题变了就重新 initialize 并清空 SVG 缓存 */
  function mermaidReady() {
    return ensureMermaid().then(function (mm) {
      var preset = mermaidThemeNow() === 'dark' ? MERMAID_THEMES.dark : MERMAID_THEMES.light;
      if (preset.theme !== mermaidTheme) {
        mermaidTheme = preset.theme;
        mm.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: preset.theme,
          fontFamily: MERMAID_FONT,
          themeVariables: preset.variables
        });
        mermaidSvgCache.clear();
      }
      return mm;
    });
  }

  /** 同步回填缓存命中的图（与公式同一时机，先于绘制）；返回命中数 */
  function restoreCachedMermaid(root) {
    var pending = root.querySelectorAll('.lb-mermaid:not([data-mmd-ok])');
    var hits = 0;
    Array.prototype.forEach.call(pending, function (node) {
      var src = node.getAttribute('data-mmd-src') || '';
      var cached = src && mermaidSvgCache.get(src);
      if (cached == null) return;
      node.setAttribute('data-mmd-ok', '1');
      node.innerHTML = cached;
      hits++;
    });
    return hits;
  }

  /** 主题切换：清缓存、把已成的图还原成源码占位，交由下一轮扫描按新主题重排 */
  function resetMermaidForTheme(root) {
    var now = mermaidThemeNow();
    if (mermaidTheme == null || now === mermaidTheme) return;
    var nodes = root.querySelectorAll('.lb-mermaid[data-mmd-ok]');
    Array.prototype.forEach.call(nodes, function (node) {
      var src = node.getAttribute('data-mmd-src') || '';
      node.removeAttribute('data-mmd-ok');
      node.removeAttribute('data-mmd-tried');
      node.innerHTML = src
        ? '<pre class="lb-mermaid-src"><code>' + escapeHtml(src) + '</code></pre>' : '';
    });
  }

  /** 对 root 内未处理的 mermaid 占位做 parse + render；失败保留源码展示 */
  function renderMermaidNodes(root) {
    var nodes = root.querySelectorAll('.lb-mermaid:not([data-mmd-ok]):not([data-mmd-tried])');
    if (!nodes.length) return Promise.resolve(false);
    return mermaidReady().then(function (mm) {
      var chain = Promise.resolve(false);
      Array.prototype.forEach.call(nodes, function (node) {
        var src = node.getAttribute('data-mmd-src') || '';
        if (!src.trim()) { node.setAttribute('data-mmd-tried', '1'); return; }
        var cached = mermaidSvgCache.get(src);
        if (cached != null) {
          node.setAttribute('data-mmd-ok', '1');
          node.innerHTML = cached;
          chain = chain.then(function () { return true; });
          return;
        }
        chain = chain.then(function (did) {
          // 离屏测量容器（对照 CherryStudio MermaidPreview）：按占位实际宽度出图，
          // 避免 mermaid 按默认宽渲染后再被 CSS 压扁、字小难读
          var probe = document.createElement('div');
          var width = node.clientWidth || (node.parentElement && node.parentElement.clientWidth) || 0;
          probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;width:' +
            Math.max(240, Math.min(1600, width)) + 'px';
          document.body.appendChild(probe);
          return Promise.resolve().then(function () { return mm.parse(src); })
            .then(function () { return mm.render('lb-mmd-' + (++mmdSeq), src, probe); })
            .then(function (out) {
              var svg = out && out.svg || '';
              node.setAttribute('data-mmd-ok', '1');
              node.innerHTML = svg;
              cachePut(mermaidSvgCache, src, svg, MERMAID_CACHE_MAX);
              return true;
            })
            .catch(function () {
              // 解析/渲染失败（流式中途或源码本就非法）：保留源码块；节点不再重试，
              // 流式续写后 React 重建的节点（源码更长）会自然再试
              node.setAttribute('data-mmd-tried', '1');
              return did;
            })
            .then(function (value) { probe.remove(); return value; });
        });
      });
      return chain;
    }).catch(function () {
      // mermaid 库加载失败：不标记任何节点，下一轮扫描自动重试
      return false;
    });
  }

  /** 聊天是 React 侧渲染（流式增量 + 会话切换都会重建 DOM），用 MutationObserver
   *  驱动富内容后处理；只在挂载时建立一次。Observer 回调（微任务）里同步回填
   *  缓存命中的公式/图——先于绘制，重建后不闪源码；未命中的走节流扫描。 */
  function watchChatRich(root) {
    var mathSweep = makeThrottle(MATH_SWEEP_MS);
    var mmdSweep = makeThrottle(MERMAID_SWEEP_MS);
    function onMutations() {
      restoreCachedMath(root);
      restoreCachedMermaid(root);
      mathSweep(function () { typesetMath(root); });
      // 主题探测（auto 主题要 getComputedStyle）只在节流回调里做，不进每次 mutation
      mmdSweep(function () { resetMermaidForTheme(root); renderMermaidNodes(root); });
    }
    var observer = new MutationObserver(onMutations);
    observer.observe(root, { childList: true, subtree: true });
    onMutations();
  }

  return {
    ensureMathJax: ensureMathJax,
    typesetMath: typesetMath,
    watchChatRich: watchChatRich,
    resetMermaidForTheme: resetMermaidForTheme,
    renderMermaidNodes: renderMermaidNodes,
    mermaidThemePresets: MERMAID_THEMES
  };
});
