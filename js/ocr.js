/* LitBoard OCR：tesseract.js 本地识别（worker/wasm 随包 vendor，语言包按需下载到配置目录/ocr） */
(function () {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  var worker = null;
  var workerLangDir = '';
  var cancelled = false;

  function vendorUrl(rel) {
    return new URL('vendor/tesseract/' + rel, document.baseURI).href;
  }
  function dirToUrl(dir) {
    return 'file:///' + String(dir).replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  }

  /** 语言包状态：{ ready, dir, missing } */
  function dataStatus() {
    if (!window.litboardDesktop || !window.litboardDesktop.ocrStatus) {
      return Promise.resolve({ ready: false, dir: '', missing: ['desktop'] });
    }
    return window.litboardDesktop.ocrStatus();
  }

  /** 下载语言包（幂等，返回 { ready, dir }） */
  function ensureData() {
    if (!window.litboardDesktop || !window.litboardDesktop.ocrEnsureData) {
      return Promise.reject(new Error(T('OCR 需要桌面版')));
    }
    return window.litboardDesktop.ocrEnsureData();
  }

  function ensureWorker(langDir) {
    if (worker && workerLangDir === langDir) return Promise.resolve(worker);
    return terminate().then(function () {
      if (typeof Tesseract === 'undefined') throw new Error(T('OCR 组件未加载'));
      cancelled = false;
      return Tesseract.createWorker(['eng', 'chi_sim'], 1, {
        workerPath: vendorUrl('worker.min.js'),
        corePath: vendorUrl('tesseract-core.wasm.js'),
        langPath: dirToUrl(langDir),
        gzip: false,
        cacheMethod: 'none',
        logger: function () {}
      });
    }).then(function (instance) {
      worker = instance;
      workerLangDir = langDir;
      return worker;
    });
  }

  function terminate() {
    var current = worker;
    worker = null;
    workerLangDir = '';
    if (current) return current.terminate().catch(function () {});
    return Promise.resolve();
  }

  function cancel() {
    cancelled = true;
    return terminate();
  }

  /**
   * 识别若干页（0 基页索引数组）。
   * renderPage(pageIndex) → Promise<canvas> 由调用方提供（阅读器用已打开的 PDF.js 文档渲染，比例正确）。
   * onProgress({ done, total, page })；返回 { pages: { 页索引: 文本 } }。cancel() 可中止。
   */
  function ocrPages(pageIndexes, langDir, renderPage, onProgress) {
    return ensureWorker(langDir).then(function (ocrWorker) {
      var result = {};
      var total = pageIndexes.length;
      var index = 0;
      function next() {
        if (index >= total || cancelled) return Promise.resolve(result);
        var pageIndex = pageIndexes[index++];
        return renderPage(pageIndex).then(function (canvas) {
          return ocrWorker.recognize(canvas);
        }).then(function (out) {
          result[pageIndex] = (out && out.data && out.data.text || '').trim();
          if (onProgress) onProgress({ done: index, total: total, page: pageIndex + 1 });
          return next();
        }).catch(function () {
          result[pageIndex] = '';
          if (onProgress) onProgress({ done: index, total: total, page: pageIndex + 1 });
          return next();
        });
      }
      return next().then(function () { return { pages: result }; });
    });
  }

  window.LitOcr = {
    dataStatus: dataStatus,
    ensureData: ensureData,
    ocrPages: ocrPages,
    cancel: cancel
  };
})();
