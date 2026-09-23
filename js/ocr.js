/* LitBoard OCR：PaddleOCR（PP-OCRv5 mobile）本地识别。
 * 主线程 bundle（vendor/paddleocr/paddleocr.js，挂 window.LitPaddleOcr）懒加载——只承载 worker RPC
 * 客户端，真计算在 module worker（vendor/paddleocr/worker-entry.js，含 OpenCV）里；onnxruntime 的
 * wasm 走本地 vendor/paddleocr/ort/。模型 tar 由主进程下载到配置目录/ocr/paddle，worker 内直接
 * fetch(file://)（Electron 允许，探针 T1：scripts/one-off/probe-paddleocr/）。
 * 对外契约与 tesseract 时代一致：dataStatus/ensureData/ocrPages/cancel，
 * ocrPages(pageIndexes, langDir, renderPage, onProgress) 返回 { pages: { 0 基索引: 文本 } }。 */
(function () {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  var engine = null;        // { instance, createPromise } —— PaddleOCR worker 实例（懒创建，单例）
  var engineLangDir = '';
  var cancelled = false;

  function vendorUrl(rel) {
    return new URL('vendor/paddleocr/' + rel, document.baseURI).href;
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

  /** 下载识别模型（幂等，返回 { ready, dir }） */
  function ensureData() {
    if (!window.litboardDesktop || !window.litboardDesktop.ocrEnsureData) {
      return Promise.reject(new Error(T('OCR 需要桌面版')));
    }
    return window.litboardDesktop.ocrEnsureData();
  }

  /** 懒加载主线程驱动 bundle（避免 586KB 进启动路径；CSP script-src 'self' 允许同源动态注入） */
  function loadEngineScript() {
    if (window.LitPaddleOcr && window.LitPaddleOcr.PaddleOCR) return Promise.resolve();
    if (engine && engine.loadPromise) return engine.loadPromise;
    var loadPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = vendorUrl('paddleocr.js');
      script.onload = function () {
        if (window.LitPaddleOcr && window.LitPaddleOcr.PaddleOCR) resolve();
        else reject(new Error(T('OCR 组件未加载')));
      };
      script.onerror = function () { reject(new Error(T('OCR 组件未加载'))); };
      document.head.appendChild(script);
    });
    engine = engine || { instance: null };
    engine.loadPromise = loadPromise;
    return loadPromise;
  }

  /** 创建/复用 worker 实例。numThreads 恒 1：无 COI 头时无 SharedArrayBuffer，多线程不可用。 */
  function ensureEngine(langDir) {
    if (engine && engine.instance && engineLangDir === langDir) return Promise.resolve(engine.instance);
    return terminate().then(function () {
      return loadEngineScript();
    }).then(function () {
      cancelled = false;
      var base = dirToUrl(langDir);
      return window.LitPaddleOcr.PaddleOCR.create({
        worker: {
          createWorker: function () {
            return new Worker(vendorUrl('worker-entry.js'), { type: 'module' });
          }
        },
        ortOptions: { backend: 'wasm', wasmPaths: vendorUrl('ort/'), numThreads: 1 },
        lang: 'ch',
        textDetectionModelName: 'PP-OCRv5_mobile_det',
        textDetectionModelAsset: { url: base + 'det.tar' },
        textRecognitionModelName: 'PP-OCRv5_mobile_rec',
        textRecognitionModelAsset: { url: base + 'rec.tar' },
        initialize: false
      }).then(function (instance) {
        return instance.initialize().then(function () { return instance; });
      });
    }).then(function (instance) {
      if (cancelled) {
        try { instance.dispose(); } catch (e) {}
        throw new Error(T('OCR 已取消'));
      }
      engine = engine || {};
      engine.instance = instance;
      engineLangDir = langDir;
      return instance;
    });
  }

  function terminate() {
    var current = engine && engine.instance;
    if (engine) { engine.instance = null; engine.loadPromise = null; }
    engineLangDir = '';
    if (current) return current.dispose().catch(function () {});
    return Promise.resolve();
  }

  function cancel() {
    cancelled = true;
    return terminate();
  }

  /**
   * 识别若干页（0 基页索引数组）。
   * renderPage(pageIndex) → Promise<canvas> 由调用方提供（阅读器用已打开的 MuPDF 文档渲染，比例正确）。
   * onProgress({ done, total, page })；返回 { pages: { 页索引: 文本 } }。cancel() 可中止。
   * 失败页置空串（与 tesseract 时代一致——单页失败不拖垮整批）。
   */
  function ocrPages(pageIndexes, langDir, renderPage, onProgress) {
    return ensureEngine(langDir).then(function (instance) {
      var result = {};
      var total = pageIndexes.length;
      var index = 0;
      function next() {
        if (index >= total || cancelled) return Promise.resolve(result);
        var pageIndex = pageIndexes[index++];
        return renderPage(pageIndex).then(function (canvas) {
          return instance.predict(canvas);
        }).then(function (out) {
          var items = out && out[0] && out[0].items || [];
          result[pageIndex] = items.map(function (it) { return it && it.text || ''; }).join('\n');
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
