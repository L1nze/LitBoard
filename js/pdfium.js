/* High-fidelity PDF canvas renderer backed by PDFium WASM. */
(function () {
  'use strict';

  var MODULE_URL = new URL('vendor/pdfium/pdfium.js', document.baseURI).href;
  var WASM_URL = new URL('vendor/pdfium/pdfium.wasm', document.baseURI).href;
  var loading = null;

  function fileUrlToPath(url) {
    var parsed = new URL(url);
    var value = decodeURIComponent(parsed.pathname);
    return /^\/[A-Za-z]:/.test(value) ? value.slice(1).replace(/\//g, '\\') : value;
  }

  function loadUrlBytes(url) {
    if (window.litboardDesktop && String(url).startsWith('file:')) {
      return window.litboardDesktop.readFileBytes(fileUrlToPath(url));
    }
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = function () {
        if (xhr.status === 200 || xhr.status === 0) resolve(xhr.response);
        else reject(new Error('PDFium WASM loading failed (' + xhr.status + ')'));
      };
      xhr.onerror = function () { reject(new Error('PDFium WASM loading failed')); };
      xhr.send();
    });
  }

  function getFileBytes(file) {
    if (window.litboardDesktop) {
      var filePath = typeof file === 'string' ? file : file.path;
      return window.litboardDesktop.readFileBytes(filePath);
    }
    return file.arrayBuffer();
  }

  function load() {
    if (loading) return loading;
    loading = Promise.all([import(MODULE_URL), loadUrlBytes(WASM_URL)]).then(function (values) {
      return values[0].init({ wasmBinary: new Uint8Array(values[1]) });
    }).then(function (api) {
      api.PDFiumExt_Init();
      return api;
    });
    return loading;
  }

  function openBytes(value) {
    return load().then(function (api) {
      var bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      var sourcePtr = api.pdfium.wasmExports.malloc(bytes.length);
      api.pdfium.HEAPU8.set(bytes, sourcePtr);
      var documentHandle = api.FPDF_LoadMemDocument64(sourcePtr, bytes.length, '');
      if (!documentHandle) {
        api.pdfium.wasmExports.free(sourcePtr);
        throw new Error('PDFium cannot open this document (' + api.FPDF_GetLastError() + ')');
      }
      var closed = false;
      return {
        pageCount: api.FPDF_GetPageCount(documentHandle),
        renderPage: function (pageIndex, canvas, rotation) {
          if (closed) return Promise.reject(new Error('PDFium document is closed'));
          var pageHandle = api.FPDF_LoadPage(documentHandle, pageIndex);
          if (!pageHandle) return Promise.reject(new Error('PDFium cannot load page ' + (pageIndex + 1)));
          var bitmap = 0;
          try {
            var width = canvas.width, height = canvas.height;
            bitmap = api.FPDFBitmap_Create(width, height, 1);
            if (!bitmap) throw new Error('PDFium cannot allocate page bitmap');
            api.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
            var rotationSteps = Math.round((((Number(rotation) || 0) % 360) + 360) % 360 / 90) % 4;
            // Annotations + LCD text + RGBA byte order for ImageData.
            api.FPDF_RenderPageBitmap(bitmap, pageHandle, 0, 0, width, height, rotationSteps, 0x01 | 0x02 | 0x10);
            var stride = api.FPDFBitmap_GetStride(bitmap);
            var bufferPtr = api.FPDFBitmap_GetBuffer(bitmap);
            var source = api.pdfium.HEAPU8.subarray(bufferPtr, bufferPtr + stride * height);
            var rgba;
            if (stride === width * 4) {
              rgba = new Uint8ClampedArray(source);
            } else {
              rgba = new Uint8ClampedArray(width * height * 4);
              for (var row = 0; row < height; row++) {
                rgba.set(source.subarray(row * stride, row * stride + width * 4), row * width * 4);
              }
            }
            canvas.getContext('2d', { alpha: false }).putImageData(new ImageData(rgba, width, height), 0, 0);
            canvas.dataset.renderer = 'pdfium';
            return Promise.resolve();
          } catch (error) {
            return Promise.reject(error);
          } finally {
            if (bitmap) api.FPDFBitmap_Destroy(bitmap);
            api.FPDF_ClosePage(pageHandle);
          }
        },
        destroy: function () {
          if (closed) return;
          closed = true;
          api.FPDF_CloseDocument(documentHandle);
          api.pdfium.wasmExports.free(sourcePtr);
        }
      };
    });
  }

  function open(file) {
    return getFileBytes(file).then(openBytes);
  }

  window.LitPdfium = { load: load, open: open, openBytes: openBytes };
})();
