/* LitBoard MuPDF RPC client. The worker owns all MuPDF/WASM objects.
 *
 * 多实例（createClient 工厂）：阅读器渲染走「reader」实例，导入解析/FTS 提取/
 * agent 截图走「background」实例——翻页渲染不再排在导入批处理后面。每实例一个
 * worker（WASM ~10MB 编译成本），worker 都懒创建；window.LitMuPdf 全局单例保持
 * 旧契约（无 createClient 的测试桩/旧注入直接被 pdfimport 当单例兜底使用）。
 *
 * 优先级通道：高优先级（阅读器渲染/文本层/页信息）随到随发、行为与旧版一致；
 * 低优先级（OCR 大位图、缩略图、批注全档扫描分块）单飞且让路——任一高优先级
 * 请求在途时低优先级在客户端排队，worker 队列里阅读器渲染永不排在 OCR 后面。
 *
 * 空闲回收：所有文档关闭且无在途/排队请求持续 idleTimeoutMs（默认 5 分钟）即
 * terminate worker；下次调用自动重建（startup-error/crash 兜底路径复用）。 */
(function () {
  'use strict';

  var DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

  function createClient(options) {
    options = options || {};
    var name = String(options.name || 'mupdf');
    var idleTimeoutMs = Number(options.idleTimeoutMs);
    if (!(idleTimeoutMs >= 0)) idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;

    var worker = null;
    var nextId = 1;
    var pending = {};      // 已发到 worker 的在途请求（id → { entry, timer, low }）
    var waiting = [];      // 低优先级待发队列（高优先级从不排队）
    var inFlightHigh = 0;
    var inFlightLow = 0;
    var openDocuments = 0; // 客户端侧 open/close 计数：>0 时空闲回收禁用
    var idleTimer = 0;

    function workerUrl() { return new URL('js/mupdf-worker.js', document.baseURI).href; }

    function hasActivity() {
      return openDocuments > 0 || inFlightHigh > 0 || inFlightLow > 0 || waiting.length > 0;
    }

    function armIdleRecycle() {
      if (!idleTimeoutMs) return;
      if (idleTimer) clearTimeout(idleTimer);
      if (hasActivity()) { idleTimer = 0; return; }
      idleTimer = setTimeout(function () {
        idleTimer = 0;
        if (hasActivity()) return;
        api.reset();
      }, idleTimeoutMs);
    }

    function rejectAll(error) {
      Object.keys(pending).forEach(function (id) {
        clearTimeout(pending[id].timer);
        pending[id].entry.reject(error);
        if (pending[id].low) inFlightLow--; else inFlightHigh--;
        delete pending[id];
      });
      waiting.splice(0).forEach(function (entry) { entry.reject(error); });
      armIdleRecycle();
    }

    function ensureWorker() {
      if (worker) return worker;
      worker = new Worker(workerUrl(), { type: 'module' });
      worker.onmessage = function (event) {
        var payload = event.data || {};
        if (payload.type === 'startup-error') {
          var startup = new Error(payload.error && payload.error.message || 'MuPDF worker failed to initialize');
          worker.terminate();
          worker = null;
          openDocuments = 0;
          rejectAll(startup);
          return;
        }
        if (payload.type === 'ready') return;
        var request = pending[payload.id];
        if (!request) return;
        clearTimeout(request.timer);
        delete pending[payload.id];
        if (request.low) { inFlightLow--; } else { inFlightHigh--; }
        if (payload.ok) request.entry.resolve(payload.result);
        else {
          var error = new Error(payload.error && payload.error.message || 'MuPDF worker error');
          error.name = payload.error && payload.error.name || 'Error';
          request.entry.reject(error);
        }
        dispatch();
        armIdleRecycle();
      };
      worker.onerror = function (event) {
        var error = new Error(event && event.message || 'MuPDF worker crashed');
        worker.terminate();
        worker = null;
        openDocuments = 0;
        rejectAll(error);
      };
      return worker;
    }

    function send(entry) {
      var id = nextId++;
      var timer = setTimeout(function () {
        if (!pending[id]) return;
        delete pending[id];
        if (entry.low) inFlightLow--; else inFlightHigh--;
        dispatch();
        armIdleRecycle();
        entry.reject(new Error('MuPDF worker timed out: ' + entry.method));
      }, Number(entry.timeoutMs) || 120000);
      if (entry.low) inFlightLow++; else inFlightHigh++;
      pending[id] = { entry: entry, timer: timer, low: entry.low };
      try { ensureWorker().postMessage({ id: id, method: entry.method, args: entry.args || [] }, entry.transfer || []); }
      catch (error) {
        clearTimeout(timer);
        delete pending[id];
        if (entry.low) inFlightLow--; else inFlightHigh--;
        dispatch();
        entry.reject(error);
      }
    }

    function dispatch() {
      // 低优先级单飞 + 让路：仅在「无任何在途请求」时发出一个排队项，
      // 保证阅读器渲染（高优先级）永远插到 OCR/缩略图大活前面
      while (waiting.length && inFlightHigh === 0 && inFlightLow === 0) send(waiting.shift());
    }

    function call(method, args, transfer, timeoutMs, priority) {
      return new Promise(function (resolve, reject) {
        var entry = { method: method, args: args || [], transfer: transfer || [],
          timeoutMs: timeoutMs, low: priority === 'low', resolve: resolve, reject: reject };
        if (entry.low) { waiting.push(entry); dispatch(); return; }
        send(entry);
      });
    }

    function bytesTransfer(bytes) {
      var value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      return { value: value.buffer, transfer: [value.buffer] };
    }

    function trackOpen(promise) {
      return promise.then(function (value) {
        openDocuments++;
        return value;
      }, function (error) {
        throw error;
      });
    }

    var api = {
      name: name,
      open: function (bytes, magic) {
        var input = bytesTransfer(bytes);
        return trackOpen(call('openDocument', [input.value, magic || 'application/pdf'], input.transfer));
      },
      close: function (id) {
        // worker 已被回收/重置且无在途文档：直接成功，别为了关不存在的文档拉起新 worker
        if (!worker && openDocuments === 0) return Promise.resolve(true);
        return call('closeDocument', [id]).then(function (value) {
          if (openDocuments > 0) openDocuments--;
          armIdleRecycle();
          return value;
        }, function (error) {
          // worker 已死（reset/crash）时文档计数随 rejectAll 一并归零，这里勿再减
          if (worker) { if (openDocuments > 0) openDocuments--; }
          armIdleRecycle();
          throw error;
        });
      },
      pageInfo: function (id, pageIndex) { return call('getPageInfo', [id, pageIndex]); },
      pageInfos: function (id) { return call('getPageInfos', [id]); },
      outline: function (id) { return call('getOutline', [id]); },
      pageLinks: function (id, pageIndex) { return call('getPageLinks', [id, pageIndex]); },
      pageText: function (id, pageIndex, opts) { return call('getPageText', [id, pageIndex, opts || null]); },
      pageTextLength: function (id, pageIndex) { return call('pageTextLength', [id, pageIndex]); },
      renderPage: function (id, pageIndex, scale, rotation, opts) {
        var priority = opts && opts.priority === 'low' ? 'low' : undefined;
        return call('renderPage', [id, pageIndex, scale, rotation], [], 120000, priority);
      },
      annotations: function (id) { return call('getAnnotations', [id]); },
      /** 分块批注扫描（低优先级：块间让阅读器渲染插队） */
      annotationsChunk: function (id, start, count) {
        return call('getAnnotations', [id, start, count], [], 120000, 'low');
      },
      /** 文档级搜索分块（低优先级：worker 侧逐页折叠匹配，块间让阅读器渲染插队）。
       *  返回 { hits, next }：hits 与 handle.search 页结果同形；next = 下一块起始页（-1 = 扫完）。 */
      searchDocumentChunk: function (id, start, count, query, opts) {
        return call('searchDocument', [id, query, opts || null, start, count], [], 120000, 'low');
      },
      documentHash: function (id) { return call('documentHash', [id]); },
      inspect: function (bytes, magic) {
        var input = bytesTransfer(bytes);
        return call('inspectDocument', [input.value, magic || 'application/pdf'], input.transfer);
      },
      extractText: function (bytes, magic) {
        var input = bytesTransfer(bytes);
        return call('extractText', [input.value, magic || 'application/pdf'], input.transfer);
      },
      writeAnnotations: function (bytes, annotations) {
        var input = bytesTransfer(bytes);
        return call('writeAnnotations', [input.value, annotations || []], input.transfer);
      },
      resourceState: function () { return call('resourceState', [], [], 15000); },
      reset: function () {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; }
        if (!worker) return;
        worker.terminate();
        worker = null;
        openDocuments = 0;
        rejectAll(new Error('MuPDF worker reset'));
      }
    };
    return api;
  }

  var defaultClient = createClient({ name: 'default' });
  defaultClient.createClient = createClient;
  window.LitMuPdf = defaultClient;
})();
