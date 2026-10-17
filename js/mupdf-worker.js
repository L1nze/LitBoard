/* LitBoard MuPDF.js module worker: all WASM objects stay off the renderer thread. */
globalThis.$libmupdf_wasm_Module = {
  locateFile: function (name) { return new URL('../vendor/mupdf/' + name, self.location.href).href; }
};
let mupdf = null;
let startupError = null;
let mupdfReady = null;
// WASM 模块懒加载（首条消息时才开始）：行为与旧的顶层 import 等价（client 不等待
// 'ready' 广播），同时让本文件可以在 Node vm 里整体求值——测试对拍搜索核心时
// 不需要 dynamic import 回调
function ensureMupdf() {
  if (!mupdfReady) {
    mupdfReady = import('../vendor/mupdf/mupdf.js').then(function (module) {
      mupdf = module;
      self.postMessage({ type: 'ready' });
    }).catch(function (error) {
      startupError = error;
      self.postMessage({ type: 'startup-error', error: errorPayload(error) });
    });
  }
  return mupdfReady;
}

const documents = new Map();
const documentHashes = new Map(); // id → Promise<sha256 hex>（打开时后台算，不挡 open 返回）
let nextDocumentId = 1;

// 小端检测：像素 Uint32 快速路径仅在 LE 上启用，其余平台回退逐字节写
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function errorPayload(error) {
  return { name: error && error.name || 'Error', message: String(error && error.message || error), stack: error && error.stack || '' };
}

async function sha256Hex(buffer) {
  if (!crypto || !crypto.subtle || !buffer) return '';
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.prototype.map.call(new Uint8Array(digest), function (byte) {
    return byte.toString(16).padStart(2, '0');
  }).join('');
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

/* ---------- 文档级搜索核心 ----------
 * 逐字对齐 js/pdfimport.js 的 buildPageSearchIndex / runPageSearch（折叠/行界/
 * 连字符/全字规则），两边语义由 test/pdf-rendering.test.js 的对拍用例守护——
 * 改任一侧必须同步另一侧。items = 视觉行（{ str, hasEOL }），与渲染层
 * textItemsFromMuPdf 产出的行一一对应，因此 itemIndex 即文本层 textDivs 下标。 */
const SEARCH_WHITESPACE = /\s/;
const SEARCH_MARK = /[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u0711\u0730-\u074A\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;
const SEARCH_WORD_CHAR = /[A-Za-z0-9_]/;

function foldSearchChar(ch, preserveCase) {
  const code = ch.charCodeAt(0);
  if (code < 128) {
    if (!preserveCase && code >= 65 && code <= 90) return String.fromCharCode(code + 32);
    return ch;
  }
  if (SEARCH_MARK.test(ch)) return '';
  const folded = ch.normalize('NFKC');
  if (preserveCase) return folded;
  let out = '';
  for (let k = 0; k < folded.length; k++) {
    const c = folded.charAt(k);
    const lower = c.toLowerCase();
    out += lower.length === 1 ? lower : c;
  }
  return out;
}

function foldSearchText(text, preserveCase) {
  const s = String(text || '');
  let out = '';
  for (let j = 0; j < s.length; j++) {
    const ch = s.charAt(j);
    if (SEARCH_WHITESPACE.test(ch)) {
      if (out.length && out.charAt(out.length - 1) === ' ') continue;
      out += ' ';
    } else {
      const folded = foldSearchChar(ch, preserveCase);
      for (let k = 0; k < folded.length; k++) out += folded.charAt(k);
    }
  }
  return out.replace(/^ +| +$/g, '');
}

function isSearchCJK(code) {
  return (code >= 0x3040 && code <= 0x30FF) ||
    (code >= 0x3400 && code <= 0x9FFF) ||
    (code >= 0xF900 && code <= 0xFAFF);
}

function isWholeWordMatch(haystack, start, length) {
  const end = start + length;
  if (start > 0 && SEARCH_WORD_CHAR.test(haystack.charAt(start - 1))) return false;
  if (end < haystack.length && SEARCH_WORD_CHAR.test(haystack.charAt(end))) return false;
  return true;
}

function buildPageIndex(items) {
  items = items || [];
  const chars = [];
  const exactChars = [];
  const origins = [];
  function pushFolded(ch, item, off) {
    const exact = foldSearchChar(ch, true);
    for (let k = 0; k < exact.length; k++) {
      const c = exact.charAt(k);
      exactChars.push(c);
      const lower = c.toLowerCase();
      chars.push(lower.length === 1 ? lower : c);
      origins.push({ item: item, off: off });
    }
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const s = item && typeof item.str === 'string' ? item.str : '';
    for (let j = 0; j < s.length; j++) {
      const ch = s.charAt(j);
      if (SEARCH_WHITESPACE.test(ch)) {
        if (chars.length && chars[chars.length - 1] === ' ') continue;
        chars.push(' ');
        exactChars.push(' ');
        origins.push({ item: i, off: j });
        continue;
      }
      pushFolded(ch, i, j);
    }
    if (!(item && item.hasEOL) || i + 1 >= items.length) continue;
    const next = items[i + 1];
    const nextStr = next && typeof next.str === 'string' ? next.str : '';
    if (s.charAt(s.length - 1) === '-' && /^[A-Za-z]/.test(nextStr)) {
      chars.pop();
      exactChars.pop();
      origins.pop();
    } else if (chars.length && chars[chars.length - 1] !== ' ' && !isSearchCJK(s.charCodeAt(s.length - 1))) {
      chars.push(' ');
      exactChars.push(' ');
      origins.push(null);
    }
  }
  return { items: items, haystack: chars.join(''), haystackExact: exactChars.join(''), origins: origins };
}

function runPageSearchOnIndex(index, query, options) {
  options = options || {};
  const caseSensitive = options.caseSensitive === true;
  const wholeWord = options.wholeWord === true;
  const matches = [];
  const needle = foldSearchText(query, caseSensitive);
  if (!needle || !index) return matches;
  const haystack = caseSensitive ? index.haystackExact : index.haystack;
  if (!haystack) return matches;
  const origins = index.origins;
  let offset = haystack.indexOf(needle);
  while (offset !== -1) {
    if (wholeWord && !isWholeWordMatch(haystack, offset, needle.length)) {
      offset = haystack.indexOf(needle, offset + 1);
      continue;
    }
    const end = offset + needle.length;
    const byItem = {};
    const order = [];
    for (let p = offset; p < end; p++) {
      const origin = origins[p];
      if (!origin) continue;
      let span = byItem[origin.item];
      if (!span) { span = byItem[origin.item] = [origin.off, origin.off]; order.push(origin.item); }
      if (origin.off < span[0]) span[0] = origin.off;
      if (origin.off > span[1]) span[1] = origin.off;
    }
    if (order.length) {
      order.sort(function (a, b) { return a - b; });
      const fragments = order.map(function (itemIndex) {
        const span = byItem[itemIndex];
        return { itemIndex: itemIndex, start: span[0], end: span[1] + 1 };
      });
      let text = '';
      fragments.forEach(function (fragment, fi) {
        const str = index.items[fragment.itemIndex] ? index.items[fragment.itemIndex].str : '';
        if (fi > 0 && index.items[fragments[fi - 1].itemIndex] && index.items[fragments[fi - 1].itemIndex].hasEOL) text += '\n';
        text += str.slice(fragment.start, fragment.end);
      });
      matches.push({ fragments: fragments, text: text });
    }
    offset = haystack.indexOf(needle, offset + needle.length);
  }
  return matches;
}

function searchItems(items, query, options) {
  return runPageSearchOnIndex(buildPageIndex(items), query, options);
}

function withPage(doc, index, fn) {
  const page = doc.loadPage(Number(index));
  try { return fn(page); } finally { page.destroy(); }
}

/** RGB(3 分量) → RGBA：小端平台走 Uint32 单写（一次写 4 字节替代 4 次字节写，
 *  A4@2x ≈ 400 万像素页省 ~1200 万次写）；其余布局回退逐字节。 */
function copyPixels(pixels, width, height, source, stride, components) {
  if (LITTLE_ENDIAN && components === 3) {
    const words = new Uint32Array(pixels.buffer);
    for (let y = 0; y < height; y++) {
      let from = y * stride;
      const to = y * width;
      const rowEnd = to + width;
      for (let x = to; x < rowEnd; x++, from += 3) {
        words[x] = 0xFF000000 | (source[from + 2] << 16) | (source[from + 1] << 8) | source[from];
      }
    }
    return;
  }
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
    // 内容指纹后台算（批注「已扫无内嵌」缓存的键）：不 await，打开关键路径零开销
    documentHashes.set(id, sha256Hex(bytes).catch(function () { return ''; }));
    return { id: id, numPages: doc.countPages(), title: doc.getMetaData(mupdf.Document.META_INFO_TITLE) || '' };
  },

  closeDocument(id) {
    const doc = documents.get(Number(id));
    if (doc) {
      documents.delete(Number(id));
      documentHashes.delete(Number(id));
      doc.destroy();
    }
    if (!documents.size) mupdf.emptyStore();
    return true;
  },

  /** 文档内容指纹（openDocument 时后台计算；批注空结果缓存的内容寻址键） */
  async documentHash(id) {
    getDocument(id);
    const pending = documentHashes.get(Number(id));
    return pending ? await pending : '';
  },

  getPageInfo(id, pageIndex) {
    const doc = getDocument(id);
    return withPage(doc, pageIndex, function (page) {
      const bounds = page.getBounds();
      return { bounds: bounds, transform: page.isPDF() ? page.getTransform() : mupdf.Matrix.identity };
    });
  },

  /** 一次 RPC 取回全部页的 bounds/transform：取代「打开后逐页 getPageInfo」的串行链
   *  （500 页曾是 500 次往返、首页渲染前 0.5~2s 纯排队），页 sheet 骨架可立即建立。 */
  getPageInfos(id) {
    const doc = getDocument(id);
    const out = [];
    const total = doc.countPages();
    for (let index = 0; index < total; index++) {
      out.push(withPage(doc, index, function (page) {
        return { bounds: page.getBounds(), transform: page.isPDF() ? page.getTransform() : mupdf.Matrix.identity };
      }));
    }
    return out;
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

  /** opts.plain：只保留行 bbox/字号/文本，跳过逐字 quad/sizes 的构建与传输——
   *  导入元数据识别（标题/作者/期刊）只需要这些；阅读器文本层路径（quads 硬不变量
   *  text.length === quads.length/8）不传 plain，几何路径完全不变。 */
  getPageText(id, pageIndex, opts) {
    const doc = getDocument(id);
    return withPage(doc, pageIndex, function (page) {
      const text = page.toStructuredText('preserve-whitespace');
      const plain = !!(opts && opts.plain);
      try {
        const lines = [];
        const transfers = [];
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
            const point = Number(size) || 0;
            if (plain) {
              // 无几何模式：仍按 UTF-16 码元占位累计 text（长度语义不变），只是不建 quad
              current.text += value;
            } else {
              const box = [Number(quad[0]) || 0, Number(quad[1]) || 0, Number(quad[2]) || 0, Number(quad[3]) || 0,
                Number(quad[4]) || 0, Number(quad[5]) || 0, Number(quad[6]) || 0, Number(quad[7]) || 0];
              // 每个 UTF-16 码元各占一槽：span.textContent 的偏移量必须与 quads 下标一一对应
              for (let i = 0; i < value.length; i++) {
                current.text += value[i];
                current.sizes.push(point);
                for (let k = 0; k < 8; k++) current.quads.push(box[k]);
              }
            }
            if (!current.size && point) current.size = point;
            if (!current.font && font && typeof font.getName === 'function') {
              try { current.font = font.getName() || ''; } catch (error) { current.font = ''; }
            }
          },
          endLine: flush,
          endTextBlock: flush
        });
        if (!plain) {
          lines.forEach(function (line) {
            line.sizes = Float32Array.from(line.sizes);
            line.quads = Float32Array.from(line.quads);
            transfers.push(line.sizes.buffer, line.quads.buffer);
          });
          return { lines: lines, _transfer: transfers };
        }
        return { lines: lines };
      } finally { text.destroy(); }
    });
  },

  /** 页文本的「非空白字符数」（worker 侧 asText，零 quad 几何）：扫描件检测的轻量 API。
   *  语义对齐旧 detectScannedPdf 的 Σ item.str.trim().length（空白不计）。 */
  pageTextLength(id, pageIndex) {
    const doc = getDocument(id);
    return withPage(doc, pageIndex, function (page) {
      const text = page.toStructuredText('preserve-whitespace');
      try {
        const raw = text.asText();
        let count = 0;
        for (let i = 0; i < raw.length; i++) {
          const code = raw.charCodeAt(i);
          // 9–13 覆盖 \t\n\v\f\r；另剔 NBSP 与半角空格
          if (code === 32 || code === 0xA0 || (code >= 9 && code <= 13)) continue;
          count++;
        }
        return count;
      } finally { text.destroy(); }
    });
  },

  /** 文档级搜索（分块）：worker 内逐页 plain 文本折叠匹配，免逐页 RPC 与逐字 quad
   *  负载；返回 { hits, next }——hits 的每项与渲染层 handle.search 的页结果同形
   *  （{ pageIndex, page, count, matches }），next = 下一块起始页（-1 = 扫完）。
   *  items 来自 getPageText plain 路径的同一套 walker（纯空白行同规则丢弃），
   *  itemIndex 与文本层 textDivs 严格对齐。 */
  searchDocument(id, query, opts, start, count) {
    const doc = getDocument(id);
    const total = doc.countPages();
    const begin = Math.max(0, Number(start) || 0);
    const end = Math.min(total, count == null ? total : begin + Math.max(1, Number(count)));
    const hits = [];
    for (let index = begin; index < end; index++) {
      const lines = methods.getPageText(id, index, { plain: true }).lines || [];
      const items = lines.map(function (line) { return { str: line.text, hasEOL: true }; });
      const matches = searchItems(items, query, opts || {});
      if (matches.length) hits.push({ pageIndex: index, page: index + 1, count: matches.length, matches: matches });
    }
    return { hits: hits, next: end < total ? end : -1 };
  },

  /** 光栅页 → RGBA。ImageBitmap 快路径：worker 内封装位图并 transfer，主线程
   *  drawImage 免去 15–22MB putImageData 的同步整帧拷贝；任何失败（老环境/
   *  位图构造错误）都退回像素缓冲路径，消费方两条路都要支持。 */
  async renderPage(id, pageIndex, scale, rotation) {
    const doc = getDocument(id);
    return withPage(doc, pageIndex, async function (page) {
      const pixmap = page.toPixmap(pageMatrix(scale, rotation), mupdf.ColorSpace.DeviceRGB, false, true);
      try {
        const width = pixmap.getWidth();
        const height = pixmap.getHeight();
        const source = pixmap.getPixels();
        const stride = pixmap.getStride();
        const components = pixmap.getNumberOfComponents();
        const pixels = new Uint8ClampedArray(width * height * 4);
        copyPixels(pixels, width, height, source, stride, components);
        if (typeof self.createImageBitmap === 'function') {
          try {
            const bitmap = await self.createImageBitmap(new ImageData(pixels, width, height));
            return { width: width, height: height, bitmap: bitmap };
          } catch (error) { /* 回退像素缓冲 */ }
        }
        return { width: width, height: height, pixels: pixels.buffer };
      } finally { pixmap.destroy(); }
    });
  },

  /** 批注扫描支持按页区间（client 侧分块串行发，块间渲染请求可插队）；
   *  不传区间 = 全文档（兼容旧一次性调用）。 */
  getAnnotations(id, start, count) {
    const doc = getDocument(id);
    const total = doc.countPages();
    const begin = Math.max(0, Number(start) || 0);
    const end = count == null ? total : Math.min(total, begin + Math.max(1, Number(count)));
    const out = [];
    for (let index = begin; index < end; index++) {
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
    await ensureMupdf();
    if (startupError || !mupdf) throw startupError || new Error('MuPDF worker failed to initialize');
    if (!methods[input.method]) throw new Error('Unknown MuPDF method: ' + input.method);
    const result = await methods[input.method].apply(null, input.args || []);
    // 各方法在自己的结果上携带要 transfer 的缓冲（_transfer 数组 / pixels / bytes /
    // bitmap）——不再用模块级共享列表，async 方法在 await 点交错也不会串包
    const transfer = [];
    if (result && Array.isArray(result._transfer)) transfer.push.apply(transfer, result._transfer);
    if (result && result.pixels instanceof ArrayBuffer) transfer.push(result.pixels);
    if (result && result.bytes instanceof ArrayBuffer) transfer.push(result.bytes);
    if (result && result.bitmap) transfer.push(result.bitmap);
    self.postMessage({ id: id, ok: true, result: result }, transfer);
  } catch (error) {
    self.postMessage({ id: id, ok: false, error: errorPayload(error) });
  }
};

/* Node 对拍钩子：搜索核心是纯函数、不依赖 WASM。懒加载改造后本文件可在 vm 里
 * 整体求值（无顶层 dynamic import），测试经该钩子取核心引用，与渲染侧
 * js/pdfimport.js 的 buildPageSearchIndex/runPageSearch 对拍（见
 * test/pdf-rendering.test.js）。真实 worker 环境下该全局未定义，零开销跳过。 */
if (typeof globalThis.LitPdfWorkerSearchExpose === 'function') {
  globalThis.LitPdfWorkerSearchExpose({
    foldText: foldSearchText,
    buildIndex: buildPageIndex,
    runSearch: runPageSearchOnIndex,
    searchItems: searchItems
  });
}
