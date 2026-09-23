/* PDF 导入：MuPDF.js 单内核（Worker）负责解析、光栅、文本、链接和标准批注。 */
(function () {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  function loadMuPdf() {
    if (!window.LitMuPdf) return Promise.reject(new Error(T('MuPDF.js worker 未加载')));
    return window.LitMuPdf.resourceState().then(function () { return window.LitMuPdf; });
  }

  /** MuPDF walker 的视觉行 → 文本项。每条自带逐字 quad，供文本层与高亮共用同一份几何。 */
  function textItemsFromMuPdf(pageData, bounds) {
    var items = [];
    var pageHeight = Math.max(1, Number(bounds && bounds[3]) - Number(bounds && bounds[1]));
    (pageData && pageData.lines || []).forEach(function (line) {
      var box = line && line.bbox;
      if (!Array.isArray(box) || box.length < 4) return;
      var text = String(line.text == null ? '' : line.text);
      if (!text.trim()) return; // 纯空白行不建 span（曾把文本层拆成一堆空盒，选区会误命中）
      var size = Number(line.size) || (Number(box[3]) - Number(box[1])) || 1;
      var quads = line.quads && line.quads.length === text.length * 8 ? line.quads : null;
      items.push({
        str: text,
        transform: [size, 0, 0, size, Number(box[0]) || 0, pageHeight - (Number(box[1]) || 0)],
        width: (Number(box[2]) - Number(box[0])) || 0,
        height: (Number(box[3]) - Number(box[1])) || size,
        hasEOL: true,
        fontName: String(line.font || ''),
        muBox: [Number(box[0]) || 0, Number(box[1]) || 0, Number(box[2]) || 0, Number(box[3]) || 0],
        muQuads: quads,
        muSizes: line.sizes && line.sizes.length === text.length ? line.sizes : null
      });
    });
    return { items: items, styles: {} };
  }

  function matrixPoint(matrix, value) {
    return [matrix[0] * value[0] + matrix[2] * value[1] + matrix[4], matrix[1] * value[0] + matrix[3] * value[1] + matrix[5]];
  }

  function invertMatrix(matrix) {
    var det = matrix[0] * matrix[3] - matrix[1] * matrix[2];
    if (!det) return [1, 0, 0, 1, 0, 0];
    return [matrix[3] / det, -matrix[1] / det, -matrix[2] / det, matrix[0] / det,
      (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / det, (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / det];
  }

  function viewportFor(bounds, scale, rotation, pdfToMu) {
    var zoom = Number(scale) || 1;
    var turn = ((Number(rotation) || 0) % 360 + 360) % 360;
    var rad = turn * Math.PI / 180;
    var transform = [zoom * Math.cos(rad), zoom * Math.sin(rad), -zoom * Math.sin(rad), zoom * Math.cos(rad), 0, 0];
    var corners = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[0], bounds[3]], [bounds[2], bounds[3]]].map(function (p) { return matrixPoint(transform, p); });
    var bbox = [Math.min.apply(null, corners.map(function (p) { return p[0]; })), Math.min.apply(null, corners.map(function (p) { return p[1]; })),
      Math.max.apply(null, corners.map(function (p) { return p[0]; })), Math.max.apply(null, corners.map(function (p) { return p[1]; }))];
    function fromMu(value) {
      var p = matrixPoint(transform, value);
      return [p[0] - bbox[0], p[1] - bbox[1]];
    }
    function fromPdf(value) { return fromMu(matrixPoint(pdfToMu || [1, 0, 0, 1, 0, 0], value)); }
    function toPdf(value) {
      var mu = matrixPoint(invertMatrix(transform), [value[0] + bbox[0], value[1] + bbox[1]]);
      return matrixPoint(invertMatrix(pdfToMu || [1, 0, 0, 1, 0, 0]), mu);
    }
    return {
      width: bbox[2] - bbox[0], height: bbox[3] - bbox[1], scale: zoom, rotation: turn,
      convertToViewportPoint: function (x, y) { return fromPdf([x, y]); },
      convertToPdfPoint: function (x, y) { return toPdf([x, y]); },
      convertToViewportRectangle: function (rect) {
        var a = fromPdf([rect[0], rect[1]]), b = fromPdf([rect[2], rect[3]]);
        return [a[0], a[1], b[0], b[1]];
      },
      convertMuRect: function (rect) {
        var a = fromMu([rect[0], rect[1]]), b = fromMu([rect[2], rect[3]]);
        return [a[0], a[1], b[0], b[1]];
      }
    };
  }

  function createMuDocument(info) {
    var pageInfo = {};
    var textCache = {};
    var annotationPromise = null;
    var closed = false;
    function page(number) {
      var index = Number(number) - 1;
      return Promise.resolve(pageInfo[index] || window.LitMuPdf.pageInfo(info.id, index).then(function (value) {
        pageInfo[index] = value;
        return value;
      })).then(function (detail) {
        return {
          getViewport: function (opts) { return viewportFor(detail.bounds, Number(opts && opts.scale) || 1, opts && opts.rotation, detail.transform); },
          getTextContent: function () {
            if (!textCache[index]) textCache[index] = window.LitMuPdf.pageText(info.id, index)
              .then(function (value) { return textItemsFromMuPdf(value, detail.bounds); });
            return textCache[index];
          },
          getAnnotations: function () {
            if (!annotationPromise) annotationPromise = window.LitMuPdf.annotations(info.id);
            return annotationPromise.then(function (items) { return items.filter(function (item) { return item.position.pageIndex === index; }); });
          },
          getLinks: function () { return window.LitMuPdf.pageLinks(info.id, index); },
          renderToCanvas: function (canvas, scale, rotation) {
            return window.LitMuPdf.renderPage(info.id, index, Number(scale) || 1, rotation).then(function (image) {
              canvas.width = image.width;
              canvas.height = image.height;
              canvas.getContext('2d', { alpha: false }).putImageData(
                new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
              return canvas;
            });
          },
          render: function (opts) {
            var cancelled = false;
            var transform = opts && opts.transform;
            var pixelScale = transform && transform[0] ? transform[0] : 1;
            var view = opts.viewport;
            var promise = window.LitMuPdf.renderPage(info.id, index, (view && view.scale || 1) * pixelScale, view && view.rotation)
              .then(function (image) {
                if (cancelled) throw Object.assign(new Error('Rendering cancelled'), { name: 'RenderingCancelledException' });
                var canvas = opts.canvasContext.canvas;
                if (canvas.width !== image.width) canvas.width = image.width;
                if (canvas.height !== image.height) canvas.height = image.height;
                opts.canvasContext.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
              });
            return { promise: promise, cancel: function () { cancelled = true; } };
          }
        };
      });
    }
    return {
      numPages: info.numPages,
      getPage: page,
      getOutline: function () { return window.LitMuPdf.outline(info.id); },
      destroy: function () { if (closed) return; closed = true; window.LitMuPdf.close(info.id).catch(function () {}); },
      _muId: info.id
    };
  }

  /** 取文件字节（桌面读本地路径，浏览器读 File 对象） */
  function getBytes(file) {
    if (window.litboardDesktop) {
      var filePath = typeof file === 'string' ? file : file.path;
      return window.litboardDesktop.readFileBytes(filePath);
    }
    return file.arrayBuffer();
  }

  function fingerprint(file) {
    if (!window.crypto || !window.crypto.subtle) return Promise.resolve('');
    return getBytes(file).then(function (value) {
      return window.crypto.subtle.digest('SHA-256', value);
    }).then(function (hash) {
      return Array.prototype.map.call(new Uint8Array(hash), function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  /** 打开一个 PDF 文档对象 */
  function openDocument(file, providedBytes) {
    return loadMuPdf().then(function () {
      return (providedBytes ? Promise.resolve(providedBytes) : getBytes(file));
    }).then(function (bytes) {
      return window.LitMuPdf.open(bytes, 'application/pdf').then(createMuDocument);
    });
  }

  var MAX_TITLE_PAGES = 5;

  /** R11（多模态消息链）：把指定页渲染为 PNG dataURL——阅读助手截图与 agent 视觉
   *  工具共用的生产端。与 OCR 同一路线（PDF.js viewport × scale 离屏渲染），
   *  一次一页一文档，渲染完即销毁文档句柄不占 worker。页码 1 基。 */
  function renderPageToPng(file, pageIndex, scale) {
    var pageNum = Math.max(1, Number(pageIndex) || 1);
    var zoom = Math.max(0.5, Math.min(3, Number(scale) || 1.6));
    return openDocument(file).then(function (doc) {
      var release = function () { try { doc.destroy(); } catch (error) {} };
      if (pageNum > doc.numPages) {
        release();
        return Promise.reject(new Error('页码超出范围：' + pageNum + ' / ' + doc.numPages));
      }
      return doc.getPage(pageNum).then(function (page) {
        var viewport = page.getViewport({ scale: zoom });
        var canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        return page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: viewport }).promise
          .then(function () {
            var result = {
              dataUrl: canvas.toDataURL('image/png'),
              width: canvas.width, height: canvas.height,
              pageCount: doc.numPages, page: pageNum
            };
            release();
            return result;
          }, function (error) {
            release();
            throw error;
          });
      }, function (error) {
        release();
        throw error;
      });
    });
  }

  /** 多页批量渲染（agent 视觉工具用）：一次开文档渲染 N 页。
   *  逐页调用 renderPageToPng 会为每一页重读整份 PDF 并重新解析（80MB 的 PDF 就是 3 次
   *  全文件 IPC + 3 次解析，主线程同步光栅期间界面卡死），所以这里文档只开一次。
   *  返回 [{ page, dataUrl, width, height } | { page, error }]，逐页失败不拖垮整批。 */
  function renderPagesToPng(file, pages, scale) {
    var wanted = (Array.isArray(pages) ? pages : [])
      .map(function (p) { return Math.max(1, Math.floor(Number(p) || 0)); })
      .filter(function (p, i, arr) { return p >= 1 && arr.indexOf(p) === i; });
    var zoom = Math.max(0.5, Math.min(3, Number(scale) || 1.6));
    if (!wanted.length) return Promise.resolve([]);
    return openDocument(file).then(function (doc) {
      var release = function () { try { doc.destroy(); } catch (error) {} };
      var chain = Promise.resolve([]);
      wanted.forEach(function (pageNum) {
        chain = chain.then(function (acc) {
          if (pageNum > doc.numPages) {
            acc.push({ page: pageNum, error: '页码超出范围：' + pageNum + ' / ' + doc.numPages });
            return acc;
          }
          return doc.getPage(pageNum).then(function (page) {
            var viewport = page.getViewport({ scale: zoom });
            var canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            return page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: viewport }).promise
              .then(function () {
                acc.push({
                  page: pageNum, dataUrl: canvas.toDataURL('image/png'),
                  width: canvas.width, height: canvas.height, pageCount: doc.numPages
                });
                return acc;
              });
          }, function (error) {
            acc.push({ page: pageNum, error: String(error && error.message || error) });
            return acc;
          });
        });
      });
      return chain.then(function (acc) { release(); return acc; }, function (error) {
        release();
        throw error;
      });
    });
  }

  /** 取前 maxPages 页的文本项（含字号信息）；默认 5 页，与 Zotero RecognizeDocument.MAX_PAGES 一致 */  function extractItems(file, maxPages, providedBytes) {
    return openDocument(file, providedBytes).then(function (doc) {
      var pages = Math.min(doc.numPages, maxPages || MAX_TITLE_PAGES);
      var tasks = [];
      for (var p = 1; p <= pages; p++) {
        tasks.push(doc.getPage(p).then(function (page) {
          return page.getTextContent();
        }));
      }
      return Promise.all(tasks).then(function (contents) {
        try { doc.destroy(); } catch (e) {}
        return contents;
      }, function (err) {
        try { doc.destroy(); } catch (e) {}
        throw err;
      });
    });
  }

  var DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>]+)/;

  function findDoi(text) {
    var m = text.match(DOI_RE);
    if (!m) return '';
    // 去掉常见句尾符号
    return m[1].replace(/[).,;\]]+$/, '');
  }

  /** 拼接页面文本；compact 用于中文（去掉 pdf.js 在字符间插入的空白） */
  function pageText(items, joiner) {
    return (items || []).map(function (it) { return it.str || ''; }).join(joiner || ' ');
  }

  function cleanTitleText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim()
      .replace(/^题目\s*[:：]\s*/, '')
      .replace(/^标题\s*[:：]\s*/, '');
  }

  /** 期刊封面、网络首发说明、版权页等不应被当成标题的特征 */
  function hasFrontMatterSignals(text) {
    var t = String(text || '').trim();
    if (!t) return false;
    if (/网络首发|首发论文|录用定稿|排版定稿|整期汇编定稿|出版确认|出版管理条例|期刊出版管理规定|征稿简则|投稿须知|稿约|目次|目录|引用格式|基金项目|作者简介|通信作者|收稿日期|修回日期|中图分类号|文献标志码/.test(t)) return true;
    if (/ISSN\s*\d|ISBN\s*\d|CN\s*\d{2}[-—]/.test(t)) return true;
    if (/^doi\s*[:：]/i.test(t)) return true;
    if (/^(题目|标题)\s*[:：]/.test(t)) return true;
    if (/^《[^》]+》\s*$/.test(t) && t.length <= 30) return true;
    return false;
  }

  /** 页面内字号最大的一组文本，作为标题候选 */
  function guessTitleFromPageItems(items) {
    if (!items || !items.length) return null;
    var maxH = 0;
    items.forEach(function (it) {
      var h = Math.abs(it.transform ? it.transform[3] : 0);
      if (h > maxH && it.str && it.str.trim().length > 1) maxH = h;
    });
    if (!maxH) return null;
    var parts = [];
    items.forEach(function (it) {
      var h = Math.abs(it.transform ? it.transform[3] : 0);
      if (h >= maxH - 0.5 && it.str && it.str.trim()) parts.push(it.str.trim());
    });
    var text = cleanTitleText(parts.join(' '));
    if (text.length < 10 || text.length > 350) return null;
    return { text: text, maxH: maxH };
  }

  /** 网络首发/期刊页常见“题目：xxx”标签，明确给出标题 */
  function extractLabeledTitle(contents) {
    for (var i = 0; i < (contents || []).length; i++) {
      var raw = pageText(contents[i] && contents[i].items, ' ');
      var compact = raw.replace(/\s+/g, '');
      var m = compact.match(/题目[:：](.{4,200}?)(?=作者[:：]|DOI[:：]|网络首发日期|引用格式|$)/);
      if (m) {
        var title = cleanTitleText(m[1]);
        if (title.length >= 4 && !hasFrontMatterSignals(title)) return title;
      }
    }
    return '';
  }

  function scoreTitleCandidate(candidate, pageIndex) {
    var t = candidate.text;
    var hasCjk = /[\u4e00-\u9fff]/.test(t);
    var len = t.length;
    var score = 0;

    if (hasCjk) {
      if (len >= 15 && len <= 80) score += 40;
      else if (len >= 10 && len <= 120) score += 20;
      else score -= 10;
    } else {
      if (len >= 20 && len <= 200) score += 40;
      else if (len >= 10 && len <= 300) score += 20;
      else score -= 10;
    }

    // 标题极少以句号/分号结尾
    if (/[。；;]$/.test(t)) score -= 30;
    if (/[.．]$/.test(t)) score -= 10;
    // 更倾向于大字号标题（同一 PDF 中标题字号通常最大）
    score += Math.log10(candidate.maxH + 1) * 8;
    // 同分时偏向前面的页（通常首页就是标题页；首页是封面/首发说明时已被过滤）
    score -= pageIndex * 1.5;
    return score;
  }

  /**
   * 标题识别：扫描前 5 页，优先“题目：”标签，否则从每页最大字号文本里选最像标题的。
   * 首页若为期刊介绍、网络首发宣传页等，会被 hasFrontMatterSignals 过滤。
   */
  function guessTitle(contents) {
    var labeled = extractLabeledTitle(contents);
    if (labeled) return labeled;

    var best = null;
    var bestScore = -Infinity;
    for (var i = 0; i < (contents || []).length; i++) {
      var candidate = guessTitleFromPageItems(contents[i] && contents[i].items);
      if (!candidate) continue;
      if (hasFrontMatterSignals(candidate.text)) continue;
      var score = scoreTitleCandidate(candidate, i + 1);
      if (score > bestScore) {
        bestScore = score;
        best = candidate.text;
      }
    }
    return best || '';
  }

  function cleanCjkWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ')
      .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2').trim();
  }

  function extractLabeledValue(contents, labelRe, endRe) {
    for (var i = 0; i < (contents || []).length; i++) {
      var raw = pageText(contents[i] && contents[i].items, ' ');
      var re = new RegExp(labelRe.source + '\\s*([\\s\\S]*?)(?=' + endRe.source + '|$)', 'i');
      var m = raw.match(re);
      if (m) {
        var value = cleanCjkWhitespace(m[1]);
        if (value) return value;
      }
    }
    return '';
  }

  function cleanAuthors(value) {
    return String(value || '').split(/[，,；;、]/).map(function (s) {
      return s.replace(/^\s*\d+[\s.．]*/, '').replace(/[\s.．]*\d+$/, '').replace(/[·.．]*$/, '').trim();
    }).filter(function (s) { return s && s.length <= 40; });
  }

  /** 页面文本项按基线 y 聚成行（PDF 坐标 y 向上；相邻 ≤2.5pt 视为同行） */
  function groupPageLines(items) {
    var sorted = (items || []).filter(function (it) { return it && it.str && it.str.trim(); })
      .map(function (it) {
        return { str: it.str, x: it.transform ? it.transform[4] : 0, y: it.transform ? it.transform[5] : 0, h: Math.abs(it.transform ? it.transform[3] : 0) };
      }).sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var lines = [];
    var current = null;
    sorted.forEach(function (it) {
      if (!current || current.y - it.y > 2.5) {
        current = { y: it.y, items: [] };
        lines.push(current);
      }
      current.items.push(it);
      current.y = Math.max(current.y, it.y);
    });
    return lines.map(function (ln) {
      ln.items.sort(function (a, b) { return a.x - b.x; });
      ln.text = ln.items.map(function (it) { return it.str; }).join('');
      ln.maxH = ln.items.reduce(function (m, it) { return Math.max(m, it.h); }, 0);
      return ln;
    });
  }

  /** 作者行候选的排除规则：上标角标行、单位/机构行、脚注行 */
  function isAuthorBandNoise(line) {
    var t = line.text.replace(/\s+/g, '');
    if (!t) return true;
    if (/^[\d,，.．、*]+$/.test(t)) return true;   // 上标行 "1,21,21,2"
    if (/^[（(]/.test(t)) return true;             // 单位行 "(1. 河北工业大学…"
    if (/收稿日期|修回日期|基金项目|作者简介|通信作者|中图分类号|文献标志码|文献标识码|DOI/i.test(t)) return true;
    if (/[大学学院研究院研究所实验室公司医院]|School|College|Institute|University|Laborator|Department|Academy|Hospital|Center/i.test(t)) return true;
    return false;
  }

  /** 标题行与摘要行之间的第一个姓名行（无“作者：”标签的期刊排版） */
  function guessAuthorLineFromLayout(items) {
    var lines = groupPageLines(items);
    if (!lines.length) return null;
    var maxH = 0;
    lines.forEach(function (ln) { if (ln.maxH > maxH) maxH = ln.maxH; });
    if (!maxH) return null;
    var titleBottom = null;
    var abstractY = null;
    lines.forEach(function (ln) {
      var t = ln.text.trim();
      if (ln.maxH >= maxH - 0.5) {
        // 标题可能折行：取同字号多行的最低基线为下界
        titleBottom = titleBottom == null ? ln.y : Math.min(titleBottom, ln.y);
        return;
      }
      if (abstractY == null && /^(?:摘\s*要|Abstract|ABSTRACT|Abstract\s*[:：]|SUMMARY)\s*[:：]?/.test(t)) abstractY = ln.y;
    });
    if (titleBottom == null || abstractY == null || abstractY >= titleBottom) return null;
    var band = lines.filter(function (ln) {
      return ln.y < titleBottom && ln.y > abstractY && ln.maxH < maxH - 0.5;
    }).sort(function (a, b) { return b.y - a.y; });
    for (var i = 0; i < band.length; i++) {
      if (isAuthorBandNoise(band[i])) continue;
      return band[i];
    }
    return null;
  }

  /** 姓名行 → 姓名数组；中文行返回纯姓名，西文行 "SURNAME Given" 归一为 "Surname, Given"；不像姓名则返回 null */
  function parseAuthorLineNames(line) {
    var text = line.text.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    if (/[\u4e00-\u9fff]/.test(text)) {
      var names = cleanAuthors(text).map(function (s) { return cleanCjkWhitespace(s); })
        .filter(function (s) { return /^[\u4e00-\u9fff·]{2,6}$/.test(s); });
      return names.length ? names : null;
    }
    var tokens = text.split(/[，,;；]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var m = tokens[i].match(/^([A-Z][A-Z'’-]*)[\s.]+([A-Za-z'’.\- ]+)$/);
      if (!m) return null;
      out.push(m[1].charAt(0) + m[1].slice(1).toLowerCase() + ', ' + m[2].replace(/\s+/g, ' ').trim());
    }
    return out.length ? out : null;
  }

  function extractAuthors(contents) {
    // “通信作者/通讯作者”不是全体作者字段。若从其内部的“作者：”开始抓取，
    // PDF 文本流里其后的单位、摘要和关键词都会被误存进 authors。
    var value = extractLabeledValue(contents, /(?<!通[讯信])作者\s*[:：]/, /DOI\s*[:：]|网络首发日期|网络首发时间|引用格式|作者简介|通信作者|基金项目|摘要\s*[:：]|Abstract\s*[:：]|机构|单位/);
    var labeled = cleanAuthors(value);
    if (labeled.length) return labeled;
    // 正式出版的期刊 PDF 没有“作者：”标签：作者行是标题与摘要之间的裸行（带角标上标）
    if (contents && contents.length && contents[0] && contents[0].items) {
      var line = guessAuthorLineFromLayout(contents[0].items);
      if (line) {
        var names = parseAuthorLineNames(line);
        if (names && names.length) return names;
      }
    }
    return [];
  }

  function extractAbstract(contents) {
    return extractLabeledValue(contents, /(?:摘\s*要|Abstract)\s*[:：]/i, /关键词\s*[:：]|Key\s*words\s*[:：]|中图分类号|文献标志码|基金项目|作者简介|通信作者|收稿日期|引\s*言|0\s*引\s*言/);
  }

  function repeatedEdgeVenue(contents, title, authors) {
    var counts = Object.create(null);
    var order = [];
    var normalizedTitle = String(title || '').replace(/\s+/g, '');
    var authorSet = Object.create(null);
    (authors || []).forEach(function (name) { authorSet[String(name || '').replace(/\s+/g, '')] = true; });
    var noise = /^(?:研究与设计|研究与开发|研究论文|技术研究|技术应用|综述|专论|专题|行业评论|实验研究|理论研究|应用研究|参考文献|摘要|关键词|作者简介|通信作者|收稿日期|基金项目|中图分类号|文献标识码|文献标志码|文章编号)$/;
    (contents || []).forEach(function (content) {
      var lines = groupPageLines(content && content.items);
      var edge = lines.slice(0, 3).concat(lines.slice(Math.max(3, lines.length - 3)));
      var seen = Object.create(null);
      edge.forEach(function (line) {
        var compact = String(line.text || '').replace(/\s+/g, '');
        var runs = compact.match(/[\u4e00-\u9fff]+/g) || [];
        runs.forEach(function (candidate) {
          if (candidate.length < 3 || candidate.length > 16 || noise.test(candidate)) return;
          if (/等$/.test(candidate) || authorSet[candidate]) return;
          if (candidate.length >= 6 && normalizedTitle.indexOf(candidate) !== -1) return;
          if (!seen[candidate]) seen[candidate] = true;
        });
      });
      Object.keys(seen).forEach(function (candidate) {
        if (!counts[candidate]) order.push(candidate);
        counts[candidate] = (counts[candidate] || 0) + 1;
      });
    });
    var best = '';
    var bestScore = 0;
    order.forEach(function (candidate) {
      if (counts[candidate] < 2) return;
      var score = counts[candidate] * 100 + candidate.length;
      if (/(?:学报|杂志|通报|期刊)$/.test(candidate)) score += 20;
      if (score > bestScore) { best = candidate; bestScore = score; }
    });
    return best;
  }

  function extractVenue(contents, title, authors) {
    var all = (contents || []).map(function (c) {
      return pageText(c && c.items, ' ');
    }).join(' ');
    var m = all.match(/\[J\s*\/?\s*OL\]\s*[．.]\s*([^\s.．，,；;]{2,60})/);
    if (!m) m = all.match(/\[J\]\s*[．.]\s*([^\s.．，,；;]{2,60})/);
    if (!m) m = all.match(/(?:期刊|杂志)\s*[：:]\s*([^\s，,；;]{2,60})/);
    return m ? cleanCjkWhitespace(m[1]) : repeatedEdgeVenue(contents, title, authors);
  }

  /** 全部空白剔除后的前 5 页拼接串：文章编号/页脚这类被空格打散的模式在紧凑串上匹配 */
  function compactAllText(contents) {
    return (contents || []).map(function (c) {
      return pageText(c && c.items, '');
    }).join(' ').replace(/\s+/g, '');
  }

  /**
   * 文章编号（GB/T 7713）：ISSN(年)期-起始页-页数。
   * 例：1002-087X(2026)08-1486-08 → 2026 年第 8 期，第 1486 页起共 8 页（即 1486-1493）。
   * 中文期刊联网查不到（DOI 多注册在 ISTIC 而非 Crossref）时，这是年份/期次/页码的本地权威来源。
   */
  function extractArticleCode(contents) {
    var compact = compactAllText(contents);
    var m = compact.match(/文章编号[：:]?(\d{4}-\d{3}[\dXx])\((\d{4})\)(\d{1,3})-(\d{1,5})-(\d{1,3})(?!\d)/);
    if (!m) return null;
    var year = Number(m[2]);
    var spage = Number(m[4]);
    var npages = Number(m[5]);
    if (year < 1000 || year > 3000 || !spage || !npages || npages > 60) return null;
    return { issn: m[1], year: year, issue: String(Number(m[3])), spage: spage, npages: npages };
  }

  /** 期刊页脚（如 "2026.8 Vol.50 No.8"）：年/卷/期的另一处本地来源 */
  function extractFooterVolumeInfo(contents) {
    var compact = compactAllText(contents);
    var m = compact.match(/(\d{4})\.(\d{1,2})Vol\.(\d{1,4})No\.(\d{1,3})(?!\d)/);
    if (!m) return null;
    var year = Number(m[1]);
    if (year < 1000 || year > 3000) return null;
    return { year: year, volume: String(Number(m[3])), issue: String(Number(m[4])) };
  }

  /** ISSN：文章编号 → DOI 里的 j.issn.XXXX-XXXX → 显式 ISSN 标签 */
  function extractIssn(contents) {
    var code = extractArticleCode(contents);
    if (code) return code.issn;
    var compact = compactAllText(contents);
    var m = compact.match(/j\.issn\.(\d{4}-?\d{3}[\dXx])/) || compact.match(/ISSN[：:]?(\d{4}-?\d{3}[\dXx])/);
    return m ? m[1] : '';
  }

  function extractYear(contents) {
    var all = (contents || []).map(function (c) {
      return pageText(c && c.items, ' ');
    }).join(' ');
    var m = all.match(/网络首发日期[:：]\s*(\d{4})/)
      || all.match(/网络首发时间[:：\s]*(\d{4})/)
      || all.match(/(\d{4})\s*年\s*\d+\s*月/)
      || all.match(/引用格式[\s\S]{0,80}?(\d{4})/);
    var year = m ? Number(m[1]) : null;
    if (!(year >= 1000 && year <= 3000)) {
      var code = extractArticleCode(contents);
      if (code) year = code.year;
    }
    if (!(year >= 1000 && year <= 3000)) {
      var footer = extractFooterVolumeInfo(contents);
      if (footer) year = footer.year;
    }
    if (!(year >= 1000 && year <= 3000)) {
      // 最弱兜底：收稿年（正式出版年通常不早于它）
      var rm = all.match(/收稿日期[:：]\s*(\d{4})/);
      year = rm ? Number(rm[1]) : null;
    }
    return year >= 1000 && year <= 3000 ? year : null;
  }

  function extractVolumeIssue(contents) {
    var all = (contents || []).map(function (c) {
      return pageText(c && c.items, ' ');
    }).join(' ');
    var result = { volume: '', issue: '', pages: '' };
    var code = extractArticleCode(contents);
    var vm = all.match(/第\s*(\d+)\s*卷\s*第\s*(\d+)\s*期/);
    if (vm) {
      result.volume = vm[1];
      result.issue = vm[2];
    } else if ((vm = all.match(/Vol\.?\s*(\d+)\s*,?\s*No\.?\s*(\d+)/i))) {
      result.volume = vm[1];
      result.issue = vm[2];
    } else if (code) {
      result.issue = code.issue;
    }
    var fm = extractFooterVolumeInfo(contents);
    if (!result.volume && fm) {
      result.volume = fm.volume;
      if (!code) result.issue = fm.issue;
    }
    var pm = all.match(/(?:页|pp\.?)\s*(\d+)\s*[-–—至]\s*(\d+)/i);
    if (pm) result.pages = pm[1] + '-' + pm[2];
    if (!result.pages && code) result.pages = code.spage + '-' + (code.spage + code.npages - 1);
    return result;
  }


  /**
   * 提取全部页面的文本（跨库全文索引用；调用方负责缓存复用）。
   * 页与页互不依赖：游标 + 6 worker 并发抽取（extractItems 已验证同一 pdf.js 文档
   * 支持并发取页），结果按页码落位而非 push，页序与串行版完全一致；
   * 任一页失败记为首个错误、全部 worker 收尾后统一 reject（不产生游离 rejection）。
   */
  function extractText(file, providedBytes) {
    return openDocument(file, providedBytes).then(function (doc) {
      var pages = new Array(doc.numPages);
      var cursor = 0;
      var firstError = null;
      function worker() {
        var pageNum = ++cursor;
        if (pageNum > doc.numPages) return Promise.resolve();
        return doc.getPage(pageNum).then(function (page) {
          return page.getTextContent().then(function (content) {
            pages[pageNum - 1] = content.items.map(function (it) { return it.str || ''; }).join(' ');
          });
        }).catch(function (error) {
          if (!firstError) firstError = error;
        }).then(worker);
      }
      var runners = [];
      for (var w = 0; w < 6; w++) runners.push(worker());
      return Promise.all(runners).then(function () {
        if (firstError) {
          try { doc.destroy(); } catch (e) {}
          return Promise.reject(firstError);
        }
        try { doc.destroy(); } catch (e) {}
        return { numPages: doc.numPages, pages: pages };
      });
    });
  }

  /**
   * 解析一个 PDF 文件 → { doi, title, rawText }
   */
  function inspectPdf(file, providedBytes) {
    return extractItems(file, MAX_TITLE_PAGES, providedBytes).then(function (contents) {
      var allText = contents.map(function (c) {
        return (c.items || []).map(function (it) { return it.str; }).join(' ');
      }).join(' ');
      var vi = extractVolumeIssue(contents);
      var title = guessTitle(contents);
      var authors = extractAuthors(contents);
      return {
        doi: findDoi(allText),
        title: title,
        authors: authors,
        abstract: extractAbstract(contents),
        venue: extractVenue(contents, title, authors),
        year: extractYear(contents),
        volume: vi.volume,
        issue: vi.issue,
        pages: vi.pages,
        issn: extractIssn(contents),
        rawText: allText.slice(0, 5000)
      };
    });
  }

  function normLookupTitle(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '');
  }

  function titlesCompatible(localTitle, apiTitle) {
    var a = normLookupTitle(localTitle);
    var b = normLookupTitle(apiTitle);
    if (!a || !b || a.length < 12 || b.length < 12) return true;
    return a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
  }

  function localPdfPaper(file, resolvedPath, fingerprintValue, info, patch, lookupType) {
    info = info || {};
    var fileName = (file && file.name) || (typeof file === 'string' ? file.split(/[\\/]/).pop() : '');
    var fileTitle = fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
    var localTitle = info.title || fileTitle || '(未识别标题)';
    var localTitleIsFrontMatter = hasFrontMatterSignals(localTitle);
    // 只有“标题检索”才做本地/远端标题一致性校验；DOI 是强标识，即使本地猜错也以 DOI 元数据为准。
    var titleConflict = patch && patch.titleFromApi && info.title
      && lookupType !== 'doi'
      && !localTitleIsFrontMatter
      && !titlesCompatible(info.title, patch.titleFromApi);
    if (titleConflict) patch = null;
    var doi = titleConflict ? '' : ((patch && patch.doi) || info.doi || '');
    return {
      key: '',
      entryType: 'article',
      title: (patch && patch.titleFromApi) || localTitle,
      authors: (patch && patch.authorsFromApi) || info.authors || [],
      year: (patch && patch.year) || info.year || null,
      venue: (patch && patch.venue) || info.venue || '',
      doi: doi,
      url: '',
      abstract: (patch && patch.abstract) || info.abstract || '',
      volume: (patch && patch.volume) || info.volume || '',
      issue: (patch && patch.issue) || info.issue || '',
      pages: (patch && patch.pages) || info.pages || '',
      citations: (patch && patch.citations != null) ? patch.citations : null,
      oaUrl: (patch && patch.oaUrl) || '',
      openalexId: (patch && patch.openalexId) || '',
      attachments: [{
        kind: 'pdf',
        fileName: fileName,
        path: resolvedPath,
        fingerprint: fingerprintValue || '',
        cloudName: '',
        syncSignature: '',
        addedAt: Date.now()
      }]
    };
  }

  /**
   * 先按 DOI 查（强标识）；DOI 查不到再退化为标题检索。
   * 返回 { patch, by }，by 为 'doi' | 'title' | null，供本地/远端标题校验使用。
   * 全部落空时（中文期刊/新文献常见），用文章编号里的 ISSN 反查期刊名兜底 venue——
   * venue 有了，期刊等级的按刊名查询链路才会触发。
   */
  function lookupPdfMetadata(info) {
    info = info || {};
    function withIssnFallback(patch, by) {
      if (patch || info.venue || !info.issn || !window.LitEnrich || !window.LitEnrich.venueByIssn) {
        return Promise.resolve({ patch: patch, by: by });
      }
      return window.LitEnrich.venueByIssn(info.issn).catch(function () { return ''; }).then(function (venue) {
        if (!venue) return { patch: null, by: null };
        return {
          patch: { venue: venue, citations: null, openalexId: '', enrichedAt: new Date().toISOString() },
          by: 'issn'
        };
      });
    }
    if (info.doi) {
      return window.LitEnrich.byDoi(info.doi).catch(function () { return null; }).then(function (patch) {
        if (patch) return withIssnFallback(patch, 'doi');
        if (info.title) {
          return window.LitEnrich.byTitle(info.title).catch(function () { return null; }).then(function (patch2) {
            return withIssnFallback(patch2, patch2 ? 'title' : null);
          });
        }
        return withIssnFallback(null, null);
      });
    }
    if (info.title) {
      return window.LitEnrich.byTitle(info.title).catch(function () { return null; }).then(function (patch) {
        return withIssnFallback(patch, patch ? 'title' : null);
      });
    }
    return withIssnFallback(null, null);
  }


  /**
   * PDF → 文献对象（尽量补全元数据；查不到就用文件名占位）
   */
  function pdfToPaper(file) {
    var resolvedPath = (file && file.path) || (typeof file === 'string' ? file : '');
    if (!resolvedPath && window.litboardDesktop && file) {
      try { resolvedPath = window.litboardDesktop.getPathForFile(file); } catch (e) {}
    }
    var input = resolvedPath ? { name: file && file.name, path: resolvedPath } : file;
    return getBytes(input).then(function (bytes) {
      var hashPromise = window.crypto && window.crypto.subtle
        ? window.crypto.subtle.digest('SHA-256', bytes).then(function (hash) {
          return Array.prototype.map.call(new Uint8Array(hash), function (byte) {
            return byte.toString(16).padStart(2, '0');
          }).join('');
        })
        : Promise.resolve('');
      return hashPromise.then(function (hash) {
        return inspectPdf(input, bytes).catch(function () {
          return { doi: '', title: '', rawText: '' };
        }).then(function (info) { return { info: info, fingerprint: hash }; });
      });
    }).then(function (result) {
      var info = result.info;
      var lookup = lookupPdfMetadata(info);

      // 联网补全是尽力而为的增强，绝不能卡住导入：20s 不返回就按本地解析结果建条目
      var lookupWithTimeout = Promise.race([
        lookup.catch(function () { return { patch: null, by: null }; }),
        new Promise(function (resolve) { setTimeout(function () { resolve({ patch: null, by: null }); }, 20000); })
      ]);

      return lookupWithTimeout.then(function (resolved) {
        return localPdfPaper(file, resolvedPath, result.fingerprint, info, resolved && resolved.patch, resolved && resolved.by);
      });
    }).catch(function () {
      return localPdfPaper(file, resolvedPath, '', { doi: '', title: '', rawText: '' }, null);
    });
  }

  function addLinkLayer(page, sheet, viewport, handle, isCurrent) {
    return page.getLinks().then(function (items) {
      if (!items.length) return;
      // 异步回调到达时本轮渲染可能已被更新的一轮取代（如缩放刷新），过期则丢弃
      if (isCurrent && !isCurrent()) return;
      var old = sheet.querySelector('.pdf-link-layer');
      if (old) old.remove();
      var layer = document.createElement('div');
      layer.className = 'pdf-link-layer';
      items.forEach(function (item) {
        if (!item.rect) return;
        var rect = viewport.convertMuRect(item.rect);
        var left = Math.min(rect[0], rect[2]), top = Math.min(rect[1], rect[3]);
        var link = document.createElement(item.external ? 'a' : 'button');
        link.className = 'pdf-document-link';
        link.style.left = left + 'px';
        link.style.top = top + 'px';
        link.style.width = Math.abs(rect[2] - rect[0]) + 'px';
        link.style.height = Math.abs(rect[3] - rect[1]) + 'px';
        link.title = item.uri || T('跳转到文档内位置');
        if (item.external && item.uri) {
          link.href = item.uri;
          link.target = '_blank';
          link.rel = 'noreferrer';
        } else if (item.page >= 0) {
          link.type = 'button';
          link.addEventListener('click', function () {
            handle.goToPage(item.page + 1);
          });
        } else return;
        layer.appendChild(link);
      });
      if (layer.childElementCount) sheet.appendChild(layer);
    }).catch(function () {});
  }

  function renderAnnotationLayer(sheet, viewport, annotations, onAnnotationClick) {
    var old = sheet.querySelector('.pdf-annotation-layer');
    if (old) old.remove();
    var pageIndex = Number(sheet.dataset.page) - 1;
    var list = (annotations || []).filter(function (item) {
      return item.position && item.position.pageIndex === pageIndex;
    });
    if (!list.length) return;
    var layer = document.createElement('div');
    layer.className = 'pdf-annotation-layer';
    list.forEach(function (annotation) {
      // 手写批注：按 PDF 坐标轨迹重绘为画布折线
      if (annotation.type === 'ink' && annotation.position.points && annotation.position.points.length > 1) {
        var inkRect = annotation.position.rects[0];
        var inkCorners = [
          viewport.convertToViewportPoint(inkRect[0], inkRect[1]),
          viewport.convertToViewportPoint(inkRect[2], inkRect[3])
        ];
        var inkLeft = Math.min(inkCorners[0][0], inkCorners[1][0]);
        var inkTop = Math.min(inkCorners[0][1], inkCorners[1][1]);
        var inkWidth = Math.max(2, Math.abs(inkCorners[1][0] - inkCorners[0][0]));
        var inkHeight = Math.max(2, Math.abs(inkCorners[1][1] - inkCorners[0][1]));
        var inkCanvas = document.createElement('canvas');
        inkCanvas.className = 'pdf-annotation-mark pdf-annotation-ink';
        inkCanvas.dataset.annotationId = annotation.id;
        inkCanvas.style.left = inkLeft + 'px';
        inkCanvas.style.top = inkTop + 'px';
        inkCanvas.style.width = inkWidth + 'px';
        inkCanvas.style.height = inkHeight + 'px';
        inkCanvas.width = Math.round(inkWidth * 2);
        inkCanvas.height = Math.round(inkHeight * 2);
        var inkCtx = inkCanvas.getContext('2d');
        inkCtx.scale(2, 2);
        inkCtx.strokeStyle = annotation.color || '#ffd400';
        inkCtx.lineWidth = 2;
        inkCtx.lineCap = 'round';
        inkCtx.lineJoin = 'round';
        inkCtx.beginPath();
        annotation.position.points.forEach(function (pt, ptIndex) {
          var view = viewport.convertToViewportPoint(pt[0], pt[1]);
          if (ptIndex === 0) inkCtx.moveTo(view[0] - inkLeft, view[1] - inkTop);
          else inkCtx.lineTo(view[0] - inkLeft, view[1] - inkTop);
        });
        inkCtx.stroke();
        inkCanvas.title = annotation.comment || T('手写批注');
        if (onAnnotationClick) inkCanvas.addEventListener('click', function () { onAnnotationClick(annotation.id); });
        layer.appendChild(inkCanvas);
        return;
      }
      annotation.position.rects.forEach(function (pdfRect, rectIndex) {
        var corners = [
          viewport.convertToViewportPoint(pdfRect[0], pdfRect[1]),
          viewport.convertToViewportPoint(pdfRect[0], pdfRect[3]),
          viewport.convertToViewportPoint(pdfRect[2], pdfRect[1]),
          viewport.convertToViewportPoint(pdfRect[2], pdfRect[3])
        ];
        var xs = corners.map(function (point) { return point[0]; });
        var ys = corners.map(function (point) { return point[1]; });
        var mark = document.createElement('button');
        mark.type = 'button';
        mark.className = 'pdf-annotation-mark pdf-annotation-' + annotation.type;
        mark.dataset.annotationId = annotation.id;
        var left = Math.min.apply(Math, xs), top = Math.min.apply(Math, ys);
        var width = Math.max.apply(Math, xs) - left, height = Math.max.apply(Math, ys) - top;
        mark.style.left = left + 'px';
        mark.style.top = (annotation.type === 'underline' ? top + height - 2 : top) + 'px';
        mark.style.width = width + 'px';
        mark.style.height = (annotation.type === 'underline' ? 2 : height) + 'px';
        mark.style.setProperty('--annotation-color', annotation.color);
        mark.title = annotation.comment || annotation.text || T('PDF 批注');
        mark.setAttribute('aria-label', mark.title);
        if (rectIndex === 0 && annotation.type === 'note') mark.classList.add('pdf-annotation-note-anchor');
        if (onAnnotationClick) mark.addEventListener('click', function () { onAnnotationClick(annotation.id); });
        layer.appendChild(mark);
      });
    });
    sheet.appendChild(layer);
  }

  function mergeClientRects(rects) {
    var sorted = rects.slice().sort(function (a, b) { return a.top - b.top || a.left - b.left; });
    var out = [];
    sorted.forEach(function (rect) {
      var prev = out[out.length - 1];
      var sameLine = prev && Math.min(prev.bottom, rect.bottom) - Math.max(prev.top, rect.top) >= Math.min(prev.height, rect.height) * 0.6;
      if (sameLine && rect.left <= prev.right + 3) {
        prev.left = Math.min(prev.left, rect.left);
        prev.top = Math.min(prev.top, rect.top);
        prev.right = Math.max(prev.right, rect.right);
        prev.bottom = Math.max(prev.bottom, rect.bottom);
        prev.width = prev.right - prev.left;
        prev.height = prev.bottom - prev.top;
      } else {
        out.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
          width: rect.width, height: rect.height });
      }
    });
    return out;
  }

  function textOffsetWithin(element, container, offset) {
    if (!element || !container || !element.contains(container)) return null;
    try {
      var prefix = document.createRange();
      prefix.selectNodeContents(element);
      prefix.setEnd(container, offset);
      return prefix.toString().length;
    } catch (e) {
      return null;
    }
  }

  function textPointAtOffset(element, offset) {
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    var node, remaining = Math.max(0, offset);
    while ((node = walker.nextNode())) {
      if (remaining <= node.data.length) return { node: node, offset: remaining };
      remaining -= node.data.length;
    }
    return { node: element, offset: element.childNodes.length };
  }

  // 选区行带相交：range.getClientRects() 给出用户真实划过的逐行矩形
  // （起始/结束行只含实际划过的部分，中间行是整行）。DOM Range.intersectsNode
  // 按「文档顺序」而非几何位置判断，内容流夹在起止之间的 span（旋转页边戳、
  // 页眉页脚装饰等）会被误判为整段选中——表现为选框横贯到页面右缘、文本混入
  // 无关内容，因此候选 span 一律按行带几何相交筛选（±2px 容差吸收取整误差）。
  function selectionBands(range) {
    var rects;
    try { rects = range.getClientRects(); } catch (e) { return []; }
    return Array.prototype.slice.call(rects || []).filter(function (rect) {
      return rect.width > 0.25 && rect.height > 0.25;
    });
  }

  function intersectsBands(divRect, bands) {
    // div 纵向中心必须落在行带内（±2px 容差）：文本层行盒高度略大于行距，
    // 相邻行的 div 会与行带边缘侵入几个 px，若按「有任何重叠」判定就会把
    // 选区结束行的下一行也整段选中（表现为选框拉到页尾、文本混入下一行）。
    var cy = (divRect.top + divRect.bottom) / 2;
    for (var i = 0; i < bands.length; i++) {
      var band = bands[i];
      if (cy >= band.top - 2 && cy <= band.bottom + 2 &&
        divRect.left < band.right - 2 && divRect.right > band.left + 2) return true;
    }
    return false;
  }

  // 拖选焦点行判定：文本层行盒（约 1em 高）之间的空隙通常只有几像素，原生拖选
  // 的端点一旦越过上一行行盒下缘，浏览器就把选区扩展到下一行行首——表现为
  // 「本想选到段尾，手稍微一晃就带上下一段」。这里要求鼠标在焦点方向上真正
  // 「进入」焦点行行带（越过行带边界 eps 像素）才算选中该行；否则返回该行的
  // 合并行带供调用方剔除。eps 随行盒高度放宽（约 0.3 倍行高、3–10px 封顶），
  // 行间距/段间距本身又提供了额外宽容度——想选中下一行必须把鼠标指到该行
  // 文本上，而不是只越过上一行的下缘。anchorAtStart：拖选锚点在选区起点
  // （正向拖选，焦点行 = 最后一行）；否则焦点行 = 第一行。竖排/旋转文本
  // （行盒高 > 宽）不参与判定。
  function focusLineTrim(bands, focusY, anchorAtStart) {
    if (!bands || bands.length < 2 || !isFinite(focusY)) return null;
    var lines = mergeClientRects(bands);
    if (lines.length < 2) return null;
    var line = anchorAtStart ? lines[lines.length - 1] : lines[0];
    var adjacent = anchorAtStart ? lines[lines.length - 2] : lines[1];
    var height = line.bottom - line.top;
    var pitch = adjacent ? Math.abs(line.top - adjacent.top) : height;
    if (!(line.width > line.height) || height < 6) return null;
    var eps = Math.max(3, Math.min(10, Math.min(0.35 * pitch, 0.3 * height)));
    var entry = anchorAtStart ? focusY - line.top : line.bottom - focusY;
    return entry < eps ? line : null;
  }

  /** 从原始行带里剔除属于某条合并行带的矩形（判定与 intersectsBands 的中心法一致） */
  function dropBandLine(bands, line) {
    return bands.filter(function (rect) {
      var cy = (rect.top + rect.bottom) / 2;
      var inLine = cy >= line.top - 2 && cy <= line.bottom + 2 &&
        rect.left < line.right - 2 && rect.right > line.left + 2;
      return !inLine;
    });
  }

  function selectedTextDivs(range, textDivs, bands) {
    var fragments = [];
    bands = bands || selectionBands(range);
    // 个别合成 range 拿不到行带时退回文档序判定（不劣于旧行为）
    var useBands = bands.length > 0;
    (textDivs || []).forEach(function (div, itemIndex) {
      var text = div.textContent || '';
      if (!text) return;
      try {
        if (useBands) {
          var divRect = div.getBoundingClientRect();
          if (!divRect || !intersectsBands(divRect, bands)) return;
        } else if (!range.intersectsNode(div)) return;
      } catch (e) { return; }
      var start = textOffsetWithin(div, range.startContainer, range.startOffset);
      var end = textOffsetWithin(div, range.endContainer, range.endOffset);
      start = start == null ? 0 : Math.max(0, Math.min(text.length, start));
      end = end == null ? text.length : Math.max(0, Math.min(text.length, end));
      if (end <= start) return;
      fragments.push({ div: div, itemIndex: itemIndex, start: start, end: end, text: text.slice(start, end) });
    });
    return fragments;
  }

  /**
   * 用真实字体度量裁剪浏览器行盒：以 baseline 为锚，上下各留
   * ascender/descender，而不是拍脑袋固定比例 —— 固定比例会切掉
   * 下伸字母（g、y、p 等）或给 CJK 留下过高的空白。
 * metrics 形如 { fontSize, ascent, descent }（measureText 的
 * fontBoundingBoxAscent/Descent，单位 px）；缺失时回退 0.86 比例。
 */
 function normalizeCharacterRect(rect, angle, metrics) {
    var left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
    if (Math.abs(angle % 180) < 1) {
      if (metrics && metrics.fontSize > 0 &&
          (metrics.ascent + metrics.descent) > 0 && rect.height > 0) {
        // line-height:1 下基线在行盒内的位置：半行距 + 上伸
        var leading = Math.max(0, (rect.height - (metrics.ascent + metrics.descent)) / 2);
        var baseline = rect.top + leading + metrics.ascent;
        top = Math.max(rect.top, baseline - metrics.ascent);
        bottom = Math.min(rect.bottom, baseline + metrics.descent);
      } else {
        var height = rect.height * 0.86;
        top += (rect.height - height) / 2;
        bottom = top + height;
      }
    } else if (Math.abs(Math.abs(angle % 180) - 90) < 1) {
      var width = rect.width * 0.86;
      left += (rect.width - width) / 2;
      right = left + width;
    }
    return { left: left, top: top, right: right, bottom: bottom,
      width: right - left, height: bottom - top };
  }

  /**
   * 片段矩形（视口坐标系）——直接取 MuPDF 逐字 quad 的并集。
   * 高亮与画布上的字形出自同一份几何，不再让浏览器用替代字体把整行重排一遍；
   * 中文内容流碎片多、字体又常常缺字，重排后的行盒与真实字形对不上（曾出现
   * 「选四五个字，高亮拉长/压到相邻行」）。返回 null 表示该 span 没有逐字 quad，
   * 调用方退回 Range 路径。
   */
  function muFragmentViewportRect(div, start, end) {
    var charRects = div && div._litCharRects;
    var box = div && div._litBox;
    if (!charRects || !box) return null;
    var length = (div.textContent || '').length;
    if (charRects.length !== length) return null;
    var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (var i = Math.max(0, start); i < Math.min(end, length); i++) {
      var rect = charRects[i];
      if (!rect) continue;
      if (rect[0] < left) left = rect[0];
      if (rect[1] < top) top = rect[1];
      if (rect[2] > right) right = rect[2];
      if (rect[3] > bottom) bottom = rect[3];
    }
    if (!(right > left) || !(bottom > top)) return null;
    return { box: box, rect: [left, top, right, bottom] };
  }

  var fontMetricsCache = Object.create(null);
  function measureFontMetrics(div) {
    try {
      var style = window.getComputedStyle(div);
      var family = style.fontFamily || '';
      var fontSize = parseFloat(style.fontSize) || 0;
      if (!family || !fontSize) return null;
      var key = fontSize + '|' + family;
      if (fontMetricsCache[key]) return fontMetricsCache[key];
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      ctx.font = fontSize + 'px ' + family;
      var m = ctx.measureText(div.textContent || 'X');
      var ascent = m.fontBoundingBoxAscent, descent = m.fontBoundingBoxDescent;
      var metrics = (ascent || descent) ? { fontSize: fontSize, ascent: ascent || 0, descent: descent || 0 } : null;
      fontMetricsCache[key] = metrics;
      return metrics;
    } catch (e) {
      return null;
    }
  }

  function fragmentClientRects(fragment) {
    var precise = muFragmentViewportRect(fragment.div, fragment.start, fragment.end);
    if (precise) {
      // span 的「视口盒 → 客户端盒」是仿射映射（缩放预览会给文本层整层加 CSS
      // scale），按同一比例把逐字 quad 映到客户端坐标即可，无需再裁剪行盒。
      var client = fragment.div.getBoundingClientRect();
      var box = precise.box;
      var boxWidth = box[2] - box[0];
      var boxHeight = box[3] - box[1];
      var sx = boxWidth > 0 ? client.width / boxWidth : 1;
      var sy = boxHeight > 0 ? client.height / boxHeight : 1;
      var left = client.left + (precise.rect[0] - box[0]) * sx;
      var top = client.top + (precise.rect[1] - box[1]) * sy;
      var right = client.left + (precise.rect[2] - box[0]) * sx;
      var bottom = client.top + (precise.rect[3] - box[1]) * sy;
      if (isFinite(left) && isFinite(top) && right > left && bottom > top) {
        return [{ left: left, top: top, right: right, bottom: bottom,
          width: right - left, height: bottom - top }];
      }
    }
    var start = textPointAtOffset(fragment.div, fragment.start);
    var end = textPointAtOffset(fragment.div, fragment.end);
    var selected = document.createRange();
    selected.setStart(start.node, start.offset);
    selected.setEnd(end.node, end.offset);
    var computed = window.getComputedStyle(fragment.div);
    var angle = parseFloat(computed.getPropertyValue('--rotate')) || 0;
    var metrics = Math.abs(angle % 180) < 1 ? measureFontMetrics(fragment.div) : null;
    return Array.prototype.slice.call(selected.getClientRects()).filter(function (rect) {
      return rect.width > 0.25 && rect.height > 0.25;
    }).map(function (rect) {
      // Browser ranges use the full CSS line box. Zotero-style selection follows
      // character geometry, so trim only the cross-axis while preserving endpoints.
      return normalizeCharacterRect(rect, angle, metrics);
    });
  }

  function renderSelectionLayer(sheet, bounds, rects) {
    var old = sheet.querySelector('.pdf-selection-layer');
    if (old) old.remove();
    if (!rects.length) return;
    var layer = document.createElement('div');
    layer.className = 'pdf-selection-layer';
    rects.forEach(function (rect) {
      var mark = document.createElement('i');
      mark.style.left = (rect.left - bounds.left) + 'px';
      mark.style.top = (rect.top - bounds.top) + 'px';
      mark.style.width = rect.width + 'px';
      mark.style.height = rect.height + 'px';
      layer.appendChild(mark);
    });
    sheet.appendChild(layer);
  }

  /** 片段的文本矩形（与选区共用字符几何逻辑） */
  function itemFragmentRects(div, start, end) {
    if (!div || !div.textContent) return [];
    var length = div.textContent.length;
    start = Math.max(0, Math.min(length, start));
    end = Math.max(0, Math.min(length, end));
    if (end <= start) return [];
    return fragmentClientRects({ div: div, start: start, end: end });
  }

  /* ---------- 阅读器搜索纯逻辑层（对照 PDF.js PDFFindController 的架构） ----------
   * 不变量：fragment.itemIndex 必须是渲染后 textDivs 的数组下标。renderMuTextLayer
   * 为「str 有定义的每个 item」各占一个 span 槽位，因此搜索流必须用与文本层**完全
   * 相同**的过滤条件（typeof str === 'string'）；两边一旦差一项，命中就会整体错位一行。
   * （纯空白行已由 mupdf-worker 的 getPageText 丢弃，所以槽位与视觉行一一对应。）
   * 拼接规则：item 原样连接（词间空格来自 PDF 真实空格字形，chunk 断开处没有空格就
   * 不补）；hasEOL 处按行界处理——拉丁补单空格、CJK 行界不补、行尾连字符视为断词
   * 一并吃掉（PDF.js BrokenWord 规则）。命中先落在「折叠文本」上，逐字符的 origin
   * 数组把命中映回 { itemIndex, offset }，省去 Firefox 的坐标 diff 表。 */

  var SEARCH_WHITESPACE = /\s/;
  var SEARCH_MARK = /[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u0711\u0730-\u074A\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;
  var SEARCH_WORD_CHAR = /[A-Za-z0-9_]/;

  /** 折叠单个字符：NFKC（连字/全角/兼容形）+ 组合记号丢弃（与 PDF.js 查找一致）。
   *  preserveCase 为真时不做小写化（区分大小写检索）。小写化逐字符做且要求长度
   *  稳定——两套 haystack（忽略/区分大小写）必须等长才能共享同一份 origins，
   *  极少数字符（如 İ）小写后变长时退回原字符（该字符的大小写不敏感匹配随之退化为精确匹配） */
  function foldSearchChar(ch, preserveCase) {
    var code = ch.charCodeAt(0);
    if (code < 128) {
      if (!preserveCase && code >= 65 && code <= 90) return String.fromCharCode(code + 32);
      return ch;
    }
    if (SEARCH_MARK.test(ch)) return '';
    var folded = ch.normalize('NFKC');
    if (preserveCase) return folded;
    var out = '';
    for (var k = 0; k < folded.length; k++) {
      var c = folded.charAt(k);
      var lower = c.toLowerCase();
      out += lower.length === 1 ? lower : c;
    }
    return out;
  }

  function foldSearchText(text, preserveCase) {
    var s = String(text || '');
    var out = '';
    for (var j = 0; j < s.length; j++) {
      var ch = s.charAt(j);
      if (SEARCH_WHITESPACE.test(ch)) {
        if (out.length && out.charAt(out.length - 1) === ' ') continue;
        out += ' ';
      } else {
        var folded = foldSearchChar(ch, preserveCase);
        for (var k = 0; k < folded.length; k++) out += folded.charAt(k);
      }
    }
    return out.replace(/^ +| +$/g, '');
  }

  function isSearchCJK(code) {
    return (code >= 0x3040 && code <= 0x30FF) || // 假名
      (code >= 0x3400 && code <= 0x9FFF) ||      // CJK 统一表意（含扩展 A）
      (code >= 0xF900 && code <= 0xFAFF);        // CJK 兼容表意
  }

  /** 全字匹配：命中两侧不得紧邻词字符（与 JS \b 同语义；CJK 不是词字符，
   *  中文检索的邻接汉字视作边界，与 Firefox whole words 行为一致） */
  function isWholeWordMatch(haystack, start, length) {
    var end = start + length;
    if (start > 0 && SEARCH_WORD_CHAR.test(haystack.charAt(start - 1))) return false;
    if (end < haystack.length && SEARCH_WORD_CHAR.test(haystack.charAt(end))) return false;
    return true;
  }

  /** 把「str 有定义的 items（含空串，与 textDivs 对齐）」折叠为可检索页文本。
   *  返回 { items, haystack, haystackExact, origins }：haystack 忽略大小写（默认检索）、
   *  haystackExact 区分大小写——两者等长，共享同一份逐字符 origins
   *  （第 k 个字符的来源 { item, off }；行界分隔符为 null，不属于任何 div）。 */
  function buildPageSearchIndex(items) {
    items = items || [];
    var chars = [];
    var exactChars = [];
    var origins = [];
    function pushFolded(ch, item, off) {
      var exact = foldSearchChar(ch, true);
      for (var k = 0; k < exact.length; k++) {
        var c = exact.charAt(k);
        exactChars.push(c);
        var lower = c.toLowerCase();
        chars.push(lower.length === 1 ? lower : c);
        origins.push({ item: item, off: off });
      }
    }
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var s = item && typeof item.str === 'string' ? item.str : '';
      for (var j = 0; j < s.length; j++) {
        var ch = s.charAt(j);
        if (SEARCH_WHITESPACE.test(ch)) {
          // 连续空白（含跨 item）折叠为单个空格，只保留首个的 origin
          if (chars.length && chars[chars.length - 1] === ' ') continue;
          chars.push(' ');
          exactChars.push(' ');
          origins.push({ item: i, off: j });
          continue;
        }
        pushFolded(ch, i, j);
      }
      if (!(item && item.hasEOL) || i + 1 >= items.length) continue;
      var next = items[i + 1];
      var nextStr = next && typeof next.str === 'string' ? next.str : '';
      if (s.charAt(s.length - 1) === '-' && /^[A-Za-z]/.test(nextStr)) {
        // 行尾连字符断词（PDF.js BrokenWord）：连同刚入栈的 '-' 一起吃掉
        chars.pop();
        exactChars.pop();
        origins.pop();
      } else if (chars.length && chars[chars.length - 1] !== ' ' && !isSearchCJK(s.charCodeAt(s.length - 1))) {
        // 拉丁行界补单空格（分隔符不属于任何 div）；CJK 行界按 PDF.js CJK\n 规则不补
        chars.push(' ');
        exactChars.push(' ');
        origins.push(null);
      }
    }
    return { items: items, haystack: chars.join(''), haystackExact: exactChars.join(''), origins: origins };
  }

  /** 在折叠页文本上检索；命中映射为与 textDivs 对齐的片段组。
   *  options.caseSensitive = 区分大小写（默认忽略）；options.wholeWord = 全字匹配。 */
  function runPageSearch(index, query, options) {
    options = options || {};
    var caseSensitive = options.caseSensitive === true;
    var wholeWord = options.wholeWord === true;
    var matches = [];
    var needle = foldSearchText(query, caseSensitive);
    if (!needle || !index) return matches;
    var haystack = caseSensitive ? index.haystackExact : index.haystack;
    if (!haystack) return matches;
    var origins = index.origins;
    var offset = haystack.indexOf(needle);
    while (offset !== -1) {
      if (wholeWord && !isWholeWordMatch(haystack, offset, needle.length)) {
        // 边界不符逐位推进：后续有效命中可能与被否决的部分重叠
        offset = haystack.indexOf(needle, offset + 1);
        continue;
      }
      var end = offset + needle.length;
      var byItem = {};   // itemIndex -> [minOff, maxOff]
      var order = [];
      for (var p = offset; p < end; p++) {
        var origin = origins[p];
        if (!origin) continue;
        var span = byItem[origin.item];
        if (!span) { span = byItem[origin.item] = [origin.off, origin.off]; order.push(origin.item); }
        if (origin.off < span[0]) span[0] = origin.off;
        if (origin.off > span[1]) span[1] = origin.off;
      }
      if (order.length) {
        order.sort(function (a, b) { return a - b; });
        var fragments = order.map(function (itemIndex) {
          var span = byItem[itemIndex];
          return { itemIndex: itemIndex, start: span[0], end: span[1] + 1 };
        });
        var text = '';
        fragments.forEach(function (fragment, fi) {
          var str = index.items[fragment.itemIndex] ? index.items[fragment.itemIndex].str : '';
          if (fi > 0 && index.items[fragments[fi - 1].itemIndex] && index.items[fragments[fi - 1].itemIndex].hasEOL) text += '\n';
          text += str.slice(fragment.start, fragment.end);
        });
        matches.push({ fragments: fragments, text: text });
      }
      offset = haystack.indexOf(needle, offset + needle.length);
    }
    return matches;
  }

  function searchPageText(items, query, options) {
    return runPageSearch(buildPageSearchIndex(items), query, options);
  }


  /** 在已渲染页面上绘制搜索高亮层（activeIndex 高亮当前命中的词） */
  function renderSearchLayer(sheet, matches, activeIndex) {
    var old = sheet.querySelector('.pdf-search-layer');
    if (old) old.remove();
    if (!sheet || !sheet._litTextDivs || !matches || !matches.length) return;
    var layer = document.createElement('div');
    layer.className = 'pdf-search-layer';
    var bounds = sheet.getBoundingClientRect();
    matches.forEach(function (match, index) {
      var rects = [];
      match.fragments.forEach(function (fragment) {
        var div = sheet._litTextDivs[fragment.itemIndex];
        if (!div) return;
        rects = rects.concat(itemFragmentRects(div, fragment.start, fragment.end));
      });
      mergeClientRects(rects).forEach(function (rect) {
        var mark = document.createElement('i');
        mark.className = 'pdf-search-mark' + (index === activeIndex ? ' active' : '');
        mark.style.left = (rect.left - bounds.left) + 'px';
        mark.style.top = (rect.top - bounds.top) + 'px';
        mark.style.width = rect.width + 'px';
        mark.style.height = rect.height + 'px';
        layer.appendChild(mark);
      });
    });
    sheet.appendChild(layer);
  }

  /** 逐字 quad → 视口矩形（与画布上的字形同源，取代浏览器替代字体排版） */
  function muCharViewportRects(item, viewport) {
    var text = item && item.str || '';
    var quads = item && item.muQuads;
    if (!quads || !text || quads.length !== text.length * 8) return null;
    var rects = [];
    for (var i = 0; i < text.length; i++) {
      var o = i * 8;
      var x0 = Math.min(quads[o], quads[o + 2], quads[o + 4], quads[o + 6]);
      var y0 = Math.min(quads[o + 1], quads[o + 3], quads[o + 5], quads[o + 7]);
      var x1 = Math.max(quads[o], quads[o + 2], quads[o + 4], quads[o + 6]);
      var y1 = Math.max(quads[o + 1], quads[o + 3], quads[o + 5], quads[o + 7]);
      rects.push(viewport.convertMuRect([x0, y0, x1, y1]));
    }
    return rects;
  }

  /* MuPDF StructuredText → 透明 DOM 文本层。
   * 几何全部由逐字 quad 决定：span 的位置/高度取字符盒并集，宽度靠 --scale-x 拉伸到
   * MuPDF 的实际推进宽度。这样鼠标命中判定（浏览器按自身排版找字符）与实际字形落在同一
   * 区间，高亮矩形也不再依赖浏览器对替代字体的排版。文本节点仍在 DOM 里，Ctrl+C 与原生
   * Range 走原路径。 */
  function renderMuTextLayer(layer, textContent, viewport) {
    var divs = [];
    // 过滤条件必须与 search() 里的 items 过滤完全一致：textDivs 的下标就是
    // fragment.itemIndex，一旦两边差一项，搜索高亮会整体错位一行。
    // 纯空白行已由 mupdf-worker 的 getPageText 丢弃，这里不会出现空 span。
    var items = (textContent && textContent.items || []).filter(function (item) {
      return item && typeof item.str === 'string';
    });
    layer.style.setProperty('--total-scale-factor', String(viewport.scale));
    var pending = [];
    items.forEach(function (item) {
      var charRects = muCharViewportRects(item, viewport);
      var box = null;
      if (charRects) {
        box = [charRects[0][0], charRects[0][1], charRects[0][2], charRects[0][3]];
        charRects.forEach(function (rect) {
          box[0] = Math.min(box[0], rect[0]); box[1] = Math.min(box[1], rect[1]);
          box[2] = Math.max(box[2], rect[2]); box[3] = Math.max(box[3], rect[3]);
        });
      } else {
        var point = viewport.convertToViewportPoint(item.transform[4] || 0, item.transform[5] || 0);
        var rough = Math.max(1, Math.abs(item.transform[3] || item.height || 1) * viewport.scale);
        box = [point[0], point[1] - rough, point[0] + Math.max(1, Math.abs(item.width || 0) * viewport.scale), point[1]];
      }
      // 字形盒（MuPDF quad 的纵向并集）比字面略窄——CJK 约 1.0 em、拉丁约 0.88 em。
      // 命中盒补到近一个字面高，鼠标压在行内任意位置都能起选；横向仍按真实推进宽度。
      var glyphHeight = Math.max(1, box[3] - box[1]);
      var emHeight = Math.max(1, Math.abs(item.transform[3] || 0) * viewport.scale);
      var height = Math.max(glyphHeight, emHeight * 0.98);
      var top = box[1] - (height - glyphHeight) / 2;
      var span = document.createElement('span');
      span.textContent = item.str;
      span.style.left = box[0] + 'px';
      span.style.top = top + 'px';
      span.style.height = height + 'px';
      span.style.lineHeight = height + 'px';
      span.style.fontSize = Math.max(1, Math.abs(item.transform[3] || height) * viewport.scale) + 'px';
      span.style.fontFamily = 'serif';
      span._litCharRects = charRects;
      span._litBox = [box[0], top, box[2], top + height];
      span._litTargetWidth = Math.max(1, box[2] - box[0]);
      layer.appendChild(span);
      divs.push(span);
      pending.push(span);
    });
    // 先统一读 offsetWidth、再统一写 --scale-x：避免逐 span 读写交替触发强制重排
    var natural = pending.map(function (span) { return span.offsetWidth || 0; });
    pending.forEach(function (span, index) {
      if (!natural[index]) return;
      var scaleX = span._litTargetWidth / natural[index];
      if (isFinite(scaleX) && scaleX > 0) span.style.setProperty('--scale-x', String(scaleX));
    });
    return { textDivs: divs, items: items };
  }

  /**
   * MuPDF.js 阅读器内核：页面占位 + 邻近页按需渲染 + 文本/链接/批注层。
   * 返回的 handle 负责导航、搜索、选择坐标转换和释放资源。
   */
  function renderPdf(file, container, opts) {
    opts = opts || {};
    var scale = opts.scale || 1.35;
    var layout = opts.layout === 'spread' ? 'spread' : 'single';
    var rotation = ((Number(opts.rotation) || 0) % 360 + 360) % 360;
    var withTextLayer = opts.textLayer === true;
    var preferredPixelRatio = Math.max(window.devicePixelRatio || 1, Number(opts.pixelRatio) || 2.5);
    var maxCanvasPixels = Number(opts.maxCanvasPixels) || 16777216;
    var annotations = Array.isArray(opts.annotations) ? opts.annotations : [];
    var cancelled = false;
    var sourceBytesPromise = null;
    function getSourceBytes() {
      if (!sourceBytesPromise) {
        sourceBytesPromise = getBytes(file).then(function (value) { return new Uint8Array(value); });
      }
      return sourceBytesPromise;
    }
    var pages = [], sheets = [], renderTasks = {}, textCache = {}, observer = null, scrollFrame = 0;
    // renderingPages：每页渲染串行化（避免连续缩放时并发写同一页）；
    // pendingRefresh：渲染途中被标记过期（stale/false）时，完成后自动补一轮重绘
    var renderingPages = {}, pendingRefresh = {};
    // lastPreviewAt：最近一次 zoomPreview 的时刻。缩放手势窗口内 IntersectionObserver
    // 不启动重绘——此刻进环的页等手势收尾的 renderNearViewport 统一画，避免连续
    // 缩放中 IO 把同步光栅风暴又放进来
    var lastPreviewAt = 0;
    // ready：初始页框全部就位后才允许 relayout（否则走全量重开）
    var ready = false;

    // ---- 拖选精度：跟踪拖选中的鼠标位置，配合 focusLineTrim 约束选区焦点行 ----
    // dragPoint 仅在「文本层上按下主键 → 抬起」之间有效；拖选中容器发生滚动
    // （自动滚屏/滚轮）会让 clientY 与行带坐标错位，此时置空停用判定，待下次
    // pointermove 带回新坐标再恢复。
    var dragPoint = null;
    function onSelectionPointerDown(event) {
      if (event.button !== 0) return;
      if (!(event.target && event.target.closest && event.target.closest('.pdf-text-layer'))) return;
      dragPoint = { x: event.clientX, y: event.clientY };
      window.addEventListener('pointermove', onSelectionPointerMove, { passive: true });
      window.addEventListener('pointerup', onSelectionPointerUp);
      window.addEventListener('pointercancel', onSelectionPointerCancel);
    }
    function onSelectionPointerMove(event) {
      if (dragPoint) dragPoint = { x: event.clientX, y: event.clientY };
    }
    function onSelectionPointerUp() {
      var point = dragPoint;
      endSelectionDragTracking();
      if (point) applyDragEndCorrection(point);
    }
    function onSelectionPointerCancel() { endSelectionDragTracking(); }
    function onSelectionScroll() { if (dragPoint) dragPoint = null; }
    function endSelectionDragTracking() {
      dragPoint = null;
      window.removeEventListener('pointermove', onSelectionPointerMove);
      window.removeEventListener('pointerup', onSelectionPointerUp);
      window.removeEventListener('pointercancel', onSelectionPointerCancel);
    }
    container.addEventListener('pointerdown', onSelectionPointerDown);
    container.addEventListener('scroll', onSelectionScroll, { passive: true });

    /** 拖选方向：锚点在选区起点 → 正向（焦点 = 末行）；锚点在终点 → 反向；无法判定返回 null */
    function selectionAnchorAtStart(range) {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return null;
      if (range.startContainer === sel.anchorNode && range.startOffset === sel.anchorOffset) return true;
      if (range.endContainer === sel.anchorNode && range.endOffset === sel.anchorOffset) return false;
      return null;
    }

    /**
     * 松手收尾：把原生选区一次性收缩到与高亮一致的范围。拖选期间的剔除只影响
     * 自绘高亮；若不收缩原生 range，Ctrl+C 会复制出多带的一行、翻译弹层也会
     * 定位到误选行下方，与所见高亮不一致。
     */
    function applyDragEndCorrection(point) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed) return;
      var range = sel.getRangeAt(0);
      var anchorAtStart = selectionAnchorAtStart(range);
      if (anchorAtStart == null) return;
      var rawBands = selectionBands(range);
      var dropped = focusLineTrim(rawBands, point.y, anchorAtStart);
      if (!dropped) return;
      var bands = dropBandLine(rawBands, dropped);
      var boundary = null;
      for (var i = 0; i < sheets.length; i++) {
        var sheet = sheets[i];
        if (!sheet || !sheet._litTextDivs) continue;
        var fragments = selectedTextDivs(range, sheet._litTextDivs, bands);
        if (!fragments.length) continue;
        if (anchorAtStart) boundary = fragments[fragments.length - 1];
        else { boundary = fragments[0]; break; }
      }
      if (!boundary) return;
      var textPoint = textPointAtOffset(boundary.div, anchorAtStart ? boundary.end : boundary.start);
      try {
        if (anchorAtStart) range.setEnd(textPoint.node, textPoint.offset);
        else range.setStart(textPoint.node, textPoint.offset);
      } catch (e) {}
    }

    var handle = {
      doc: null,
      pageCount: 0,
      cancel: function () {
        if (cancelled) return;
        cancelled = true;
        if (observer) observer.disconnect();
        endSelectionDragTracking();
        container.removeEventListener('pointerdown', onSelectionPointerDown);
        container.removeEventListener('scroll', onSelectionScroll);
        container.removeEventListener('scroll', scheduleViewportUpdate);
        if (scrollFrame) { cancelAnimationFrame(scrollFrame); scrollFrame = 0; }
        if (nearViewportFrame) { cancelAnimationFrame(nearViewportFrame); nearViewportFrame = 0; }
        if (nearViewportTimer) { clearTimeout(nearViewportTimer); nearViewportTimer = 0; }
        Object.keys(renderTasks).forEach(function (key) { try { renderTasks[key].cancel(); } catch (e) {} });
        if (handle.doc) { try { handle.doc.destroy(); } catch (e) {} }
      },
      goToPage: function (pageNumber) {
        var index = Math.max(0, Math.min(sheets.length - 1, Number(pageNumber) - 1));
        if (!sheets[index]) return Promise.resolve(null);
        var rendered = renderPage(index + 1);
        sheets[index].scrollIntoView({ block: 'start', behavior: 'smooth' });
        return rendered;
      },
      setAnnotations: function (value) {
        annotations = Array.isArray(value) ? value : [];
        sheets.forEach(function (sheet) {
          if (sheet && sheet._litViewport && sheet.dataset.rendered === 'true') {
            renderAnnotationLayer(sheet, sheet._litViewport, annotations, opts.onAnnotationClick);
          }
        });
      },
      clearSelection: function () {
        sheets.forEach(function (sheet) {
          var layer = sheet && sheet.querySelector('.pdf-selection-layer');
          if (layer) layer.remove();
        });
      },
      /**
       * 原位重排：缩放/版式/旋转变化时复用已打开的文档，只按新参数重排页框
       * 并重绘。旧位图保留为拉伸预览（CSS 尺寸先行到位），新位图渲染完成后
       * 原子替换，避免「清空容器 → 白屏 → 逐页出现」的闪烁。
       * 返回 false 表示文档尚未就绪（初始加载中），调用方应走全量重开。
       */
      relayout: function (newOpts) {
        newOpts = newOpts || {};
        if (cancelled || !ready || !handle.doc) return false;
        var nextScale = Number(newOpts.scale) || scale;
        var nextLayout = newOpts.layout === 'spread' ? 'spread' : 'single';
        var nextRotation = ((Number(newOpts.rotation) || 0) % 360 + 360) % 360;
        if (nextScale === scale && nextLayout === layout && nextRotation === rotation) {
          // 参数没变也可能有活干：zoomPreview 只把 CSS 尺寸/层变换先行到位（页被标
          // stale/false、没有重绘），这里补排一轮重绘，让「手势停顿后走一次 relayout」
          // 的收尾语义成立
          scheduleNearViewportRender();
          return true;
        }
        // 记录滚动锚点（视口顶部命中的页 + 页内偏移比例），重排后恢复阅读位置
        var anchor = captureScrollAnchor();
        scale = nextScale; layout = nextLayout; rotation = nextRotation;
        container.classList.toggle('pdf-layout-spread', layout === 'spread');
        container.classList.toggle('pdf-layout-single', layout !== 'spread');
        sheets.forEach(function (sheet, index) {
          var page = pages[index];
          if (!sheet || !page) return;
          var viewport = page.getViewport({ scale: scale, rotation: rotation });
          sheet._litViewport = viewport;
          sheet.style.width = viewport.width + 'px';
          sheet.style.height = viewport.height + 'px';
          var canvas = sheet.querySelector('canvas.pdf-page');
          if (canvas) {
            // 位图不重画，只把 CSS 尺寸拉到位：浏览器先拉伸旧位图当预览
            canvas.style.width = viewport.width + 'px';
            canvas.style.height = viewport.height + 'px';
            sheet.dataset.rendered = 'stale';
          } else if (sheet.dataset.rendered === 'true') {
            // 渲染进行中的页：标回未渲染，完成/进入视口时按新参数重绘
            sheet.dataset.rendered = 'false';
          }
        });
        if (anchor && sheets[anchor.index]) {
          restoreScrollAnchor(anchor);
        }
        scheduleNearViewportRender();
        return true;
      },
      /**
       * 缩放手势的轻量预览：只改 CSS——页框/旧位图拉到新尺寸，既有文本/链接/
       * 批注/搜索层用 transform 等比缩放保持与拉伸位图对齐——零位图重绘、
       * 零文本层重建，连续 Ctrl+滚轮期间每档零阻塞；清晰位图由调用方在
       * 手势停顿后走一次完整 relayout 收尾（参数未变时 relayout 会补排重绘）。
       * 返回 false 表示文档尚未就绪（调用方应退回全量路径）。
       */
      zoomPreview: function (next) {
        if (cancelled || !ready || !handle.doc) return false;
        var nextScale = Number(next);
        if (!isFinite(nextScale) || nextScale <= 0) return false;
        if (nextScale === scale) return true;
        var anchor = captureScrollAnchor();
        scale = nextScale;
        lastPreviewAt = Date.now();
        sheets.forEach(function (sheet, index) {
          var page = pages[index];
          if (!sheet || !page) return;
          var previousWidth = sheet._litViewport ? sheet._litViewport.width : 0;
          var viewport = page.getViewport({ scale: scale, rotation: rotation });
          sheet._litViewport = viewport;
          sheet.style.width = viewport.width + 'px';
          sheet.style.height = viewport.height + 'px';
          var canvas = sheet.querySelector('canvas.pdf-page');
          if (canvas) {
            canvas.style.width = viewport.width + 'px';
            canvas.style.height = viewport.height + 'px';
            sheet.dataset.rendered = 'stale';
          } else if (sheet.dataset.rendered === 'true') {
            // 渲染进行中的页：标回未渲染，完成/进入视口时按新参数重绘
            sheet.dataset.rendered = 'false';
          }
          var factor = previousWidth > 0 ? viewport.width / previousWidth : 1;
          if (Math.abs(factor - 1) > 1e-6) {
            sheet.querySelectorAll('.pdf-text-layer, .pdf-link-layer, .pdf-annotation-layer, .pdf-search-layer')
              .forEach(function (layer) {
                layer.style.transformOrigin = '0 0';
                layer.style.transform = 'scale(' + factor + ')';
              });
          }
        });
        restoreScrollAnchor(anchor);
        return true;
      },
      selectionToData: function (range) {
        handle.clearSelection();
        if (!range) return { text: '', positions: [] };
        // 拖选中按鼠标位置剔除「未真正进入」的焦点行（见 focusLineTrim），
        // 高亮/文本/坐标全部基于剔除后的行带，与松手后的 range 收缩保持一致
        var bands = null;
        if (dragPoint) {
          var anchorAtStart = selectionAnchorAtStart(range);
          if (anchorAtStart != null) {
            var rawBands = selectionBands(range);
            var droppedLine = focusLineTrim(rawBands, dragPoint.y, anchorAtStart);
            if (droppedLine) bands = dropBandLine(rawBands, droppedLine);
          }
        }
        var textParts = [];
        var positions = sheets.map(function (sheet, pageIndex) {
          if (!sheet || !sheet._litViewport || !sheet._litTextDivs) return null;
          var fragments = selectedTextDivs(range, sheet._litTextDivs, bands);
          if (!fragments.length) return null;
          var bounds = sheet.getBoundingClientRect();
          var clipped = fragments.reduce(function (all, fragment) {
            return all.concat(fragmentClientRects(fragment));
          }, []).map(function (rect) {
            var left = Math.max(rect.left, bounds.left), top = Math.max(rect.top, bounds.top);
            var right = Math.min(rect.right, bounds.right), bottom = Math.min(rect.bottom, bounds.bottom);
            return right > left && bottom > top ? { left: left, top: top, right: right, bottom: bottom,
              width: right - left, height: bottom - top } : null;
          }).filter(Boolean);
          if (!clipped.length) return null;
          var merged = mergeClientRects(clipped);
          renderSelectionLayer(sheet, bounds, merged);
          var pageText = '';
          fragments.forEach(function (fragment, index) {
            var previousItem = index && sheet._litTextItems[fragments[index - 1].itemIndex];
            if (previousItem && previousItem.hasEOL) {
              pageText += '\n';
            } else if (index > 0 && pageText) {
              // 部分 PDF 的文本项不带词尾空格，逐项拼接会吃掉词间空格
              var tail = pageText.slice(-1);
              var head = fragment.text.charAt(0);
              if (!/\s/.test(tail) && !/\s/.test(head)) pageText += ' ';
            }
            pageText += fragment.text;
          });
          if (pageText) textParts.push(pageText);
          var viewport = sheet._litViewport;
          var rects = merged.map(function (rect) {
            var a = viewport.convertToPdfPoint(rect.left - bounds.left, rect.top - bounds.top);
            var b = viewport.convertToPdfPoint(rect.right - bounds.left, rect.bottom - bounds.top);
            return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
          });
          return { pageIndex: pageIndex, rects: rects };
        }).filter(Boolean);
        return { text: textParts.join('\n'), positions: positions };
      },
      selectionToPositions: function (range) {
        return handle.selectionToData(range).positions;
      },
      /**
       * 词级全文搜索：返回每页的命中列表及其文本片段定位。
       * 每个片段 { itemIndex, start, end } 与渲染后的 textDivs 一一对应，
       * 可据此在页面上画出高亮矩形。items 过滤条件必须与文本层一致
       * （typeof str === 'string'，含空串），否则空串 item 之后全部错位。
       * options.caseSensitive / options.wholeWord 透传给 runPageSearch。
       */
      search: function (query, options) {
        if (!foldSearchText(query, options && options.caseSensitive)) return Promise.resolve([]);
        var chain = Promise.resolve([]);
        pages.forEach(function (page, index) {
          chain = chain.then(function (results) {
            if (cancelled) return results;
            var pageTextPromise = textCache[index] ? Promise.resolve(textCache[index]) : page.getTextContent().then(function (content) {
              // 某些 PDF（如包含 XFA/嵌套标注流）的 items 会混入 undefined，
              // 需要更严格的防御：str 必须是字符串（但不过滤空串，见上）
              var items = (content.items || []).filter(function (item) {
                return item && typeof item.str === 'string';
              });
              var value = buildPageSearchIndex(items);
              textCache[index] = value;
              return value;
            });
            return pageTextPromise.then(function (pageData) {
              var matches = runPageSearch(pageData, query, options);
              if (matches.length) results.push({ pageIndex: index, page: index + 1, count: matches.length, matches: matches });
              return results;
            });
          });
        });
        return chain;
      }
    };

    function releasePage(pageNumber) {
      var sheet = sheets[pageNumber - 1];
      if (!sheet) return;
      var state = sheet.dataset.rendered;
      if (state !== 'true' && state !== 'stale') return;
      sheet._litRenderEpoch = (sheet._litRenderEpoch || 0) + 1;
      delete pendingRefresh[pageNumber];
      if (renderTasks[pageNumber]) { try { renderTasks[pageNumber].cancel(); } catch (e) {} delete renderTasks[pageNumber]; }
      var canvas = sheet.querySelector('canvas');
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      sheet.innerHTML = '';
      sheet._litTextDivs = null;
      sheet._litTextItems = null;
      sheet.dataset.rendered = 'false';
      try { pages[pageNumber - 1].cleanup(); } catch (e) {}
    }

    function removeOverlayLayers(sheet) {
      sheet.querySelectorAll('.pdf-text-layer, .pdf-link-layer, .pdf-annotation-layer, .pdf-selection-layer, .pdf-search-layer')
        .forEach(function (node) { node.remove(); });
    }

    // 滚动锚点：视口顶部命中的页 + 页内偏移比例，重排/预览改尺寸后恢复阅读位置
    function captureScrollAnchor() {
      var rootRect = container.getBoundingClientRect();
      for (var i = 0; i < sheets.length; i++) {
        var rect = sheets[i] && sheets[i].getBoundingClientRect();
        if (rect && rect.bottom > rootRect.top && rect.top < rootRect.bottom) {
          return {
            index: i,
            top: rootRect.top,
            ratio: rect.height ? Math.max(0, Math.min(1, (rootRect.top - rect.top) / rect.height)) : 0
          };
        }
      }
      return null;
    }
    function restoreScrollAnchor(anchor) {
      if (anchor && sheets[anchor.index]) {
        var rect = sheets[anchor.index].getBoundingClientRect();
        container.scrollTop += (rect.top + rect.height * anchor.ratio) - anchor.top;
      }
    }

    // 立即重绘视口（含 120% 预取边距）内的过期页面，不等 IntersectionObserver；
    // 先画真正落在视口里的页，再画预取环——缩放收尾时当前阅读页最先变清晰
    function renderNearViewport() {
      if (cancelled || !sheets.length) return;
      var rootRect = container.getBoundingClientRect();
      if (!rootRect.height) return;
      var margin = rootRect.height * 1.2;
      var inView = [], prefetch = [];
      for (var i = 0; i < sheets.length; i++) {
        var sheet = sheets[i];
        if (!sheet) continue;
        var rect = sheet.getBoundingClientRect();
        if (rect.top > rootRect.bottom + margin) break; // 页框按文档序排列，越过下边界即可停
        if (rect.bottom < rootRect.top - margin || rect.top > rootRect.bottom + margin) continue;
        if (rect.bottom >= rootRect.top && rect.top <= rootRect.bottom) inView.push(i + 1);
        else prefetch.push(i + 1);
      }
      inView.concat(prefetch).forEach(function (pageNumber) { renderPage(pageNumber); });
    }

    // 先让浏览器把「旧位图 CSS 拉伸」的预览帧画出来，再向 MuPDF Worker 派发重绘。
    var nearViewportFrame = 0, nearViewportTimer = 0;
    function scheduleNearViewportRender() {
      if (cancelled || nearViewportFrame || nearViewportTimer) return;
      nearViewportFrame = requestAnimationFrame(function () {
        nearViewportFrame = 0;
        if (cancelled) return;
        nearViewportTimer = setTimeout(function () {
          nearViewportTimer = 0;
          renderNearViewport();
        }, 0);
      });
    }

    function renderPage(pageNumber) {
      if (cancelled) return Promise.resolve(null);
      var page = pages[pageNumber - 1], sheet = sheets[pageNumber - 1];
      if (!page || !sheet) return Promise.resolve(page || null);
      if (renderingPages[pageNumber]) {
        // 上一轮渲染未完成又被要求重绘（如连续缩放）：挂起一次刷新，避免并发写同一页
        if (sheet.dataset.rendered !== 'true') pendingRefresh[pageNumber] = true;
        return renderingPages[pageNumber];
      }
      if (sheet.dataset.rendered === 'true') return Promise.resolve(page);
      sheet.dataset.rendered = 'true';
      // epoch：本轮渲染的代际标记；releasePage/新一轮 renderPage 会使旧轮的
      // 异步落地（putImageData 后的挂接、链接层追加等）全部失效
      var epoch = (sheet._litRenderEpoch = (sheet._litRenderEpoch || 0) + 1);
      function isCurrent() {
        return !cancelled && sheet._litRenderEpoch === epoch && sheet.dataset.rendered === 'true';
      }
      var viewport = page.getViewport({ scale: scale, rotation: rotation });
      sheet._litViewport = viewport;
      var pixelRatio = Math.min(3, preferredPixelRatio,
        Math.sqrt(maxCanvasPixels / Math.max(1, viewport.width * viewport.height)));
      pixelRatio = Math.max(1, pixelRatio);
      var canvas = document.createElement('canvas');
      canvas.className = 'pdf-page';
      canvas.width = Math.ceil(viewport.width * pixelRatio);
      canvas.height = Math.ceil(viewport.height * pixelRatio);
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      canvas.dataset.pixelRatio = pixelRatio.toFixed(2);
      canvas.setAttribute('aria-hidden', 'true');
      var canvasContext = canvas.getContext('2d', { alpha: false });
      var oldCanvas = sheet.querySelector('canvas.pdf-page');
      // 旧缩放下画的覆盖层（文本/链接/批注/高亮）已失效，移除后由本轮重建
      removeOverlayLayers(sheet);
      sheet._litTextDivs = null;
      sheet._litTextItems = null;
      if (oldCanvas) {
        // 旧位图留作预览（relayout 已把 CSS 尺寸拉到新大小），
        // 新位图渲染完成前不摘下，避免缩放白屏闪烁
      } else {
        sheet.appendChild(canvas);
      }
      function placeCanvas() {
        if (!isCurrent()) return;
        if (oldCanvas && oldCanvas.parentNode === sheet) oldCanvas.remove();
        if (canvas.parentNode !== sheet) sheet.insertBefore(canvas, sheet.firstChild);
      }
      var outputScaleX = canvas.width / viewport.width;
      var outputScaleY = canvas.height / viewport.height;
      var muTask = null;
      function renderWithMuPdf() {
        muTask = page.render({
          canvasContext: canvasContext,
          viewport: viewport,
          transform: outputScaleX === 1 && outputScaleY === 1 ? null : [outputScaleX, 0, 0, outputScaleY, 0, 0]
        });
        return muTask.promise.then(function () { return 'mupdf'; });
      }
      var renderTask = {
        cancel: function () {
          if (muTask) muTask.cancel();
        },
        promise: Promise.resolve().then(function () {
          // 本轮已被标废（连续缩放/重排把 sheet 标成 stale/false）：位图注定作废，
          // 跳过同步光栅这类重活，补绘交给 pendingRefresh / renderNearViewport
          if (!isCurrent()) return null;
          return renderWithMuPdf();
        }).then(function (renderer) {
          if (!renderer || !isCurrent()) return;
          handle.renderer = renderer;
          canvas.dataset.renderer = renderer;
          placeCanvas();
        })
      };
      renderTasks[pageNumber] = renderTask;
      var tasks = [renderTask.promise];
      if (withTextLayer) {
        var layer = document.createElement('div');
        layer.className = 'pdf-text-layer textLayer';
        sheet.appendChild(layer);
        tasks.push(page.getTextContent().then(function (textContent) {
          if (!isCurrent()) return; // 过期：别再建整页 span 的 DOM
          var textLayer = renderMuTextLayer(layer, textContent, viewport);
          if (!isCurrent()) return;
          sheet._litTextDivs = textLayer.textDivs;
          sheet._litTextItems = textLayer.items;
        }));
      }
      tasks.push(addLinkLayer(page, sheet, viewport, handle, isCurrent));
      renderAnnotationLayer(sheet, viewport, annotations, opts.onAnnotationClick);
      var done = Promise.all(tasks).then(function () {
        if (renderTasks[pageNumber] === renderTask) delete renderTasks[pageNumber];
        if (isCurrent() && opts.onSheetRendered) opts.onSheetRendered(sheet, pageNumber - 1);
        return page;
      }).catch(function (error) {
        if (renderTasks[pageNumber] === renderTask) delete renderTasks[pageNumber];
        if (!cancelled && error && error.name !== 'RenderingCancelledException' && sheet._litRenderEpoch === epoch) {
          sheet.dataset.renderError = String(error && error.message || error);
          if (oldCanvas && oldCanvas.parentNode === sheet) {
            // 刷新失败：保留旧位图，标记过期等待后续重试
            sheet.dataset.rendered = 'stale';
          } else {
            sheet.dataset.rendered = 'error';
            sheet.innerHTML = '<div class="pdf-page-error">' + T('本页渲染失败') + '</div>';
          }
        }
        return null;
      }).then(function (result) {
        if (renderingPages[pageNumber] === done) delete renderingPages[pageNumber];
        if (pendingRefresh[pageNumber]) {
          delete pendingRefresh[pageNumber];
          return renderPage(pageNumber).then(function () { return result; });
        }
        return result;
      });
      renderingPages[pageNumber] = done;
      return done;
    }

    function updateCurrentPage() {
      scrollFrame = 0;
      if (cancelled || !sheets.length) return;
      var rootRect = container.getBoundingClientRect();
      var center = rootRect.top + rootRect.height * 0.35;
      var current = 1, best = Infinity;
      sheets.forEach(function (sheet, index) {
        var rect = sheet.getBoundingClientRect();
        var distance = Math.abs(Math.max(rect.top, Math.min(center, rect.bottom)) - center);
        if (distance < best) { best = distance; current = index + 1; }
      });
      var keep = layout === 'spread' ? 7 : 5;
      sheets.forEach(function (_sheet, index) {
        if (Math.abs(index + 1 - current) > keep) releasePage(index + 1);
      });
      if (opts.onPageChange) opts.onPageChange(current, handle.pageCount);
    }
    function scheduleViewportUpdate() {
      if (!scrollFrame) scrollFrame = requestAnimationFrame(updateCurrentPage);
    }

    handle.promise = getSourceBytes().then(function (bytes) {
      return openDocument(file, new Uint8Array(bytes));
    }).then(function (doc) {
      handle.doc = doc;
      handle.pageCount = doc.numPages;
      container.innerHTML = '';
      container.classList.toggle('pdf-layout-spread', layout === 'spread');
      container.classList.toggle('pdf-layout-single', layout !== 'spread');
      var chain = Promise.resolve();
      for (var p = 1; p <= doc.numPages; p++) {
        (function (pageNum) {
          chain = chain.then(function () {
            if (cancelled) return null;
            return doc.getPage(pageNum).then(function (page) {
              if (cancelled) return null;
              pages[pageNum - 1] = page;
              var viewport = page.getViewport({ scale: scale, rotation: rotation });
              var sheet = document.createElement('div');
              sheet.className = 'pdf-page-sheet';
              sheet.dataset.page = pageNum;
              sheet.dataset.rendered = 'false';
              sheet.style.width = viewport.width + 'px';
              sheet.style.height = viewport.height + 'px';
              sheet._litViewport = viewport;
              sheets[pageNum - 1] = sheet;
              container.appendChild(sheet);
              return null;
            });
          });
        })(p);
      }
      return chain.then(function () {
        if (cancelled) { try { doc.destroy(); } catch (e) {} return null; }
        ready = true;
        if (typeof IntersectionObserver === 'function') {
          observer = new IntersectionObserver(function (entries) {
            // 缩放手势窗口内不启动重绘（见 lastPreviewAt 注释）：
            // IO 的预取环与 renderNearViewport 同为 120%，收尾会统一覆盖
            if (Date.now() - lastPreviewAt < 250) return;
            entries.forEach(function (entry) {
              if (entry.isIntersecting) renderPage(Number(entry.target.dataset.page));
            });
          }, { root: container, rootMargin: '120% 0px' });
          sheets.forEach(function (sheet) { observer.observe(sheet); });
        }
        container.addEventListener('scroll', scheduleViewportUpdate, { passive: true });
        if (opts.onPageChange) opts.onPageChange(1, doc.numPages);
        return renderPage(1).then(function () { return doc; });
      });
    });
    return handle;
  }

  function readAnnotations(file, providedBytes) {
    return openDocument(file, providedBytes).then(function (doc) {
      return window.LitMuPdf.annotations(doc._muId).then(function (items) {
        doc.destroy();
        return items;
      }, function (error) {
        doc.destroy();
        throw error;
      });
    });
  }

  function writeAnnotations(pdfBytes, annotations) {
    return loadMuPdf().then(function () {
      return window.LitMuPdf.writeAnnotations(pdfBytes, annotations);
    }).then(function (result) {
      return { bytes: new Uint8Array(result.bytes), written: result.written || 0, skipped: result.skipped || 0 };
    });
  }

  window.LitPdf = {
    pdfToPaper: pdfToPaper,
    fingerprint: fingerprint,
    inspectPdf: inspectPdf,
    extractText: extractText,
    renderPdf: renderPdf,
    renderPageToPng: renderPageToPng,
    renderPagesToPng: renderPagesToPng,
    readAnnotations: readAnnotations,
    writeAnnotations: writeAnnotations,
    renderSearchLayer: renderSearchLayer,
    load: loadMuPdf,
    engine: 'mupdf',
    selectionGeometry: Object.freeze({
      mergeRects: mergeClientRects,
      normalizeCharacterRect: normalizeCharacterRect,
      focusLineTrim: focusLineTrim,
      dropBandLine: dropBandLine,
      charViewportRects: muCharViewportRects,
      fragmentViewportRect: muFragmentViewportRect,
      textItems: textItemsFromMuPdf
    }),
    buildPageSearchIndex: buildPageSearchIndex,
    runPageSearch: runPageSearch,
    searchPageText: searchPageText
  };
})();
