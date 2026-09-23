/* LitBoard MuPDF RPC client. The worker owns all MuPDF/WASM objects. */
(function () {
  'use strict';
  var worker = null;
  var nextId = 1;
  var pending = {};

  function workerUrl() { return new URL('js/mupdf-worker.js', document.baseURI).href; }

  function rejectAll(error) {
    Object.keys(pending).forEach(function (id) {
      pending[id].reject(error);
      clearTimeout(pending[id].timer);
      delete pending[id];
    });
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
        rejectAll(startup);
        return;
      }
      if (payload.type === 'ready') return;
      var request = pending[payload.id];
      if (!request) return;
      clearTimeout(request.timer);
      delete pending[payload.id];
      if (payload.ok) request.resolve(payload.result);
      else {
        var error = new Error(payload.error && payload.error.message || 'MuPDF worker error');
        error.name = payload.error && payload.error.name || 'Error';
        request.reject(error);
      }
    };
    worker.onerror = function (event) {
      var error = new Error(event && event.message || 'MuPDF worker crashed');
      worker.terminate();
      worker = null;
      rejectAll(error);
    };
    return worker;
  }

  function call(method, args, transfer, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      var timer = setTimeout(function () {
        if (!pending[id]) return;
        delete pending[id];
        reject(new Error('MuPDF worker timed out: ' + method));
      }, Number(timeoutMs) || 120000);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      try { ensureWorker().postMessage({ id: id, method: method, args: args || [] }, transfer || []); }
      catch (error) { clearTimeout(timer); delete pending[id]; reject(error); }
    });
  }

  function bytesTransfer(bytes) {
    var value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return { value: value.buffer, transfer: [value.buffer] };
  }

  window.LitMuPdf = {
    open: function (bytes, magic) {
      var input = bytesTransfer(bytes);
      return call('openDocument', [input.value, magic || 'application/pdf'], input.transfer);
    },
    close: function (id) { return call('closeDocument', [id]); },
    pageInfo: function (id, pageIndex) { return call('getPageInfo', [id, pageIndex]); },
    outline: function (id) { return call('getOutline', [id]); },
    pageLinks: function (id, pageIndex) { return call('getPageLinks', [id, pageIndex]); },
    pageText: function (id, pageIndex) { return call('getPageText', [id, pageIndex]); },
    renderPage: function (id, pageIndex, scale, rotation) { return call('renderPage', [id, pageIndex, scale, rotation]); },
    annotations: function (id) { return call('getAnnotations', [id]); },
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
      if (!worker) return;
      worker.terminate();
      worker = null;
      rejectAll(new Error('MuPDF worker reset'));
    }
  };
})();
