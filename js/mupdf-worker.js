/* LitBoard MuPDF.js module worker: all WASM objects stay off the renderer thread. */
globalThis.$libmupdf_wasm_Module = {
  locateFile: function (name) { return new URL('../vendor/mupdf/' + name, self.location.href).href; }
};
let mupdf = null;
let startupError = null;
const ready = import('../vendor/mupdf/mupdf.js').then(function (module) {
  mupdf = module;
  self.postMessage({ type: 'ready' });
}).catch(function (error) {
  startupError = error;
  self.postMessage({ type: 'startup-error', error: errorPayload(error) });
});

const documents = new Map();
let nextDocumentId = 1;
let transferOut = [];

function errorPayload(error) {
  return { name: error && error.name || 'Error', message: String(error && error.message || error), stack: error && error.stack || '' };
}

function point(matrix, value) {
  return [matrix[0] * value[0] + matrix[2] * value[1] + matrix[4], matrix[1] * value[0] + matrix[3] * value[1] + matrix[5]];
}

function normalizedRect(points) {
  const xs = points.map(function (value) { return value[0]; });
  const ys = points.map(function (value) { return value[1]; });
  return [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
}

function hexColor(hex) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  return match ? [parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255] : [1, 0.84, 0];
}

function colorHex(color) {
  if (!Array.isArray(color) || color.length < 3) return '#ffd400';
  return '#' + color.slice(0, 3).map(function (value) {
    return Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, '0');
  }).join('');
}

function getDocument(id) {
  const doc = documents.get(Number(id));
  if (!doc) throw new Error('MuPDF document is closed');
  return doc;
}

function withPage(doc, index, fn) {
  const page = doc.loadPage(Number(index));
  try { return fn(page); } finally { page.destroy(); }
}

function pageMatrix(scale, rotation) {
  const zoom = Number(scale) || 1;
  const turn = ((Number(rotation) || 0) % 360 + 360) % 360;
  return mupdf.Matrix.concat(mupdf.Matrix.scale(zoom, zoom), mupdf.Matrix.rotate(turn));
}

function annotationToModel(page, annotation, pageIndex) {
  const inverse = mupdf.Matrix.invert(page.getTransform());
  const rect = annotation.hasQuadPoints() ? annotation.getQuadPoints().map(function (quad) {
    const points = [];
    for (let i = 0; i < quad.length; i += 2) points.push(point(inverse, [quad[i], quad[i + 1]]));
    return normalizedRect(points);
  }) : [mupdf.Rect.transform(annotation.getRect(), inverse)];
  const typeMap = { Highlight: 'highlight', Underline: 'underline', Squiggly: 'underline', Text: 'note' };
  const type = typeMap[annotation.getType()];
  if (!type) return null;
  return {
    id: annotation.getName() || ('mupdf-' + pageIndex + '-' + annotation.pointer),
    type: type,
    color: colorHex(annotation.getColor()),
    text: '',
    comment: annotation.getContents() || '',
    position: { pageIndex: pageIndex, rects: rect },
    createdAt: Number(annotation.getCreationDate() || Date.now()),
    updatedAt: Number(annotation.getModificationDate() || Date.now())
  };
}

const methods = {
  openDocument(bytes, magic) {
    const doc = mupdf.Document.openDocument(bytes, magic || 'application/pdf');
    if (doc.needsPassword()) {
      doc.destroy();
      throw new Error('PDF requires a password');
    }
    const id = nextDocumentId++;
    documents.set(id, doc);
    return { id: id, numPages: doc.countPages(), title: doc.getMetaData(mupdf.Document.META_INFO_TITLE) || '' };
  },

  closeDocument(id) {
    const doc = documents.get(Number(id));
    if (doc) {
      documents.delete(Number(id));
      doc.destroy();
    }
    if (!documents.size) mupdf.emptyStore();
    return true;
  },

  getPageInfo(id, pageIndex) {
    const doc = getDocument(id);
    return withPage(doc, pageIndex, function (page) {
      const bounds = page.getBounds();
      return { bounds: bounds, transform: page.isPDF() ? page.getTransform() : mupdf.Matrix.identity };
    });
  },

  getOutline(id) {
    return getDocument(id).loadOutline() || [];
  },

  getPageLinks(id, pageIndex) {
    const doc = getDocument(id);
    return withPage(doc, pageIndex, function (page) {
      return page.getLinks().map(function (link) {
        const bounds = link.getBounds();
        const external = link.isExternal();
        const uri = link.getURI();
        return { rect: bounds, external: external, uri: uri || '', page: external ? -1 : doc.resolveLink(link) };
      });
    });
  },

  getPageText(id, pageIndex) {
    const doc = getDocument(id);
    return withPage(doc, pageIndex, function (page) {
      const text = page.toStructuredText('preserve-whitespace');
      try {
        const lines = [];
        let current = null;
        const flush = function () {
          if (current && current.text.trim() !== '') lines.push(current);
          current = null;
        };
        text.walk({
          beginTextBlock: function () {},
          beginLine: function (bbox, wmode, direction) {
            current = {
              bbox: [Number(bbox[0]), Number(bbox[1]), Number(bbox[2]), Number(bbox[3])],
              wmode: Number(wmode) || 0,
              dir: direction ? [Number(direction[0]) || 0, Number(direction[1]) || 0] : [1, 0],
              font: '', size: 0, text: '', sizes: [], quads: []
            };
          },
          onChar: function (c, origin, font, size, quad) {
            if (!current) return;
            const value = typeof c === 'string' ? c : String(c == null ? '' : c);
            const box = [Number(quad[0]) || 0, Number(quad[1]) || 0, Number(quad[2]) || 0, Number(quad[3]) || 0,
              Number(quad[4]) || 0, Number(quad[5]) || 0, Number(quad[6]) || 0, Number(quad[7]) || 0];
            const point = Number(size) || 0;
            // 每个 UTF-16 码元各占一槽：span.textContent 的偏移量必须与 quads 下标一一对应
            for (let i = 0; i < value.length; i++) {
              current.text += value[i];
              current.sizes.push(point);
              for (let k = 0; k < 8; k++) current.quads.push(box[k]);
            }
            if (!current.size && point) current.size = point;
            if (!current.font && font && typeof font.getName === 'function') {
              try { current.font = font.getName() || ''; } catch (error) { current.font = ''; }
            }
          },
          endLine: flush,
          endTextBlock: flush
        });
        lines.forEach(function (line) {
          line.sizes = Float32Array.from(line.sizes);
          line.quads = Float32Array.from(line.quads);
          transferOut.push(line.sizes.buffer, line.quads.buffer);
        });
        return { lines: lines };
      } finally { text.destroy(); }
    });
  },

  renderPage(id, pageIndex, scale, rotation) {
    const doc = getDocument(id);
    return withPage(doc, pageIndex, function (page) {
      const pixmap = page.toPixmap(pageMatrix(scale, rotation), mupdf.ColorSpace.DeviceRGB, false, true);
      try {
        const width = pixmap.getWidth();
        const height = pixmap.getHeight();
        const source = pixmap.getPixels();
        const stride = pixmap.getStride();
        const components = pixmap.getNumberOfComponents();
        const pixels = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const from = y * stride + x * components;
            const to = (y * width + x) * 4;
            pixels[to] = source[from] || 0;
            pixels[to + 1] = source[from + 1] || 0;
            pixels[to + 2] = source[from + 2] || 0;
            pixels[to + 3] = components > 3 ? source[from + 3] : 255;
          }
        }
        return { width: width, height: height, pixels: pixels.buffer };
      } finally { pixmap.destroy(); }
    });
  },

  getAnnotations(id) {
    const doc = getDocument(id);
    const out = [];
    for (let index = 0; index < doc.countPages(); index++) {
      withPage(doc, index, function (page) {
        if (!page.isPDF()) return;
        page.getAnnotations().forEach(function (annotation) {
          try {
            const value = annotationToModel(page, annotation, index);
            if (value) out.push(value);
          } finally { annotation.destroy(); }
        });
      });
    }
    return out;
  },

  inspectDocument(bytes, magic) {
    const doc = mupdf.Document.openDocument(bytes, magic || 'application/pdf');
    try {
      const pages = [];
      const limit = Math.min(5, doc.countPages());
      for (let index = 0; index < limit; index++) {
        pages.push(withPage(doc, index, function (page) {
          const text = page.toStructuredText('preserve-spans');
          try { return JSON.parse(text.asJSON()); } finally { text.destroy(); }
        }));
      }
      return { numPages: doc.countPages(), metadata: {
        title: doc.getMetaData(mupdf.Document.META_INFO_TITLE) || '',
        author: doc.getMetaData(mupdf.Document.META_INFO_AUTHOR) || ''
      }, pages: pages };
    } finally { doc.destroy(); mupdf.emptyStore(); }
  },

  extractText(bytes, magic) {
    const doc = mupdf.Document.openDocument(bytes, magic || 'application/pdf');
    try {
      const pages = [];
      for (let index = 0; index < doc.countPages(); index++) {
        pages.push(withPage(doc, index, function (page) {
          const text = page.toStructuredText('preserve-whitespace');
          try { return text.asText(); } finally { text.destroy(); }
        }));
      }
      return { pages: pages };
    } finally { doc.destroy(); mupdf.emptyStore(); }
  },

  writeAnnotations(bytes, annotations) {
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
    if (!doc) throw new Error('Not a PDF document');
    let written = 0;
    let skipped = 0;
    try {
      const grouped = {};
      (annotations || []).forEach(function (annotation) {
        if (!annotation || !annotation.position || annotation.type === 'snapshot' || annotation.type === 'ink') { skipped++; return; }
        const index = Number(annotation.position.pageIndex);
        (grouped[index] = grouped[index] || []).push(annotation);
      });
      Object.keys(grouped).forEach(function (key) {
        const pageIndex = Number(key);
        if (pageIndex < 0 || pageIndex >= doc.countPages()) { skipped += grouped[key].length; return; }
        withPage(doc, pageIndex, function (page) {
          const existing = {};
          page.getAnnotations().forEach(function (annotation) {
            try { existing[annotation.getName()] = true; } finally { annotation.destroy(); }
          });
          const transform = page.getTransform();
          grouped[key].forEach(function (annotation) {
            if (existing[annotation.id]) { skipped++; return; }
            const rects = Array.isArray(annotation.position.rects) ? annotation.position.rects : [];
            if (!rects.length) { skipped++; return; }
            const type = annotation.type === 'note' ? 'Text' : (annotation.type === 'underline' ? 'Underline' : 'Highlight');
            const target = page.createAnnotation(type);
            try {
              target.setName(String(annotation.id));
              target.setContents(annotation.comment || annotation.text || '');
              target.setAuthor('LitBoard');
              target.setColor(hexColor(annotation.color));
              target.setFlags(mupdf.PDFAnnotation.IS_PRINT);
              if (type === 'Text') {
                const first = rects[0];
                const position = point(transform, [first[0], first[3]]);
                target.setRect([position[0], position[1], position[0] + 20, position[1] + 20]);
              } else {
                const quads = rects.map(function (rect) {
                  const tl = point(transform, [rect[0], rect[3]]);
                  const tr = point(transform, [rect[2], rect[3]]);
                  const bl = point(transform, [rect[0], rect[1]]);
                  const br = point(transform, [rect[2], rect[1]]);
                  return [tl[0], tl[1], tr[0], tr[1], bl[0], bl[1], br[0], br[1]];
                });
                target.setQuadPoints(quads);
              }
              target.update();
              existing[annotation.id] = true;
              written++;
            } finally { target.destroy(); }
          });
        });
      });
      const result = doc.saveToBuffer('incremental').asUint8Array().slice();
      return { bytes: result.buffer, written: written, skipped: skipped };
    } finally { doc.destroy(); mupdf.emptyStore(); }
  },

  resourceState() { return { documents: documents.size }; }
};

self.onmessage = async function (event) {
  const input = event.data || {};
  const id = input.id;
  try {
    await ready;
    if (startupError || !mupdf) throw startupError || new Error('MuPDF worker failed to initialize');
    if (!methods[input.method]) throw new Error('Unknown MuPDF method: ' + input.method);
    transferOut = [];
    const result = methods[input.method].apply(null, input.args || []);
    const transfer = transferOut;
    transferOut = [];
    if (result && result.pixels instanceof ArrayBuffer) transfer.push(result.pixels);
    if (result && result.bytes instanceof ArrayBuffer) transfer.push(result.bytes);
    self.postMessage({ id: id, ok: true, result: result }, transfer);
  } catch (error) {
    self.postMessage({ id: id, ok: false, error: errorPayload(error) });
  }
};
