/* PDF 导入：提取 DOI / 标题 → 查 OpenAlex 元数据（pdf.js 从本地 vendor 按需加载，无 CDN 依赖） */
(function () {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  var LOCAL_PDFJS_URL = new URL('vendor/pdfjs/pdf.min.mjs', document.baseURI).href;
  var LOCAL_WORKER_URL = new URL('vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
  var CMAP_URL = new URL('vendor/pdfjs/cmaps/', document.baseURI).href;
  var STANDARD_FONT_URL = new URL('vendor/pdfjs/standard_fonts/', document.baseURI).href;
  var WASM_URL = new URL('vendor/pdfjs/wasm/', document.baseURI).href;
  var ICC_URL = new URL('vendor/pdfjs/iccs/', document.baseURI).href;
  var loading = null;

  // Match Zotero's PDF.js profile: render the PDF's own font programs on canvas,
  // use bundled metric-compatible fonts only when the source did not embed one.
  var RENDERING_PROFILE = Object.freeze({
    disableFontFace: false,
    useSystemFonts: false,
    isEvalSupported: false,
    enableXfa: false,
    useWasm: true,
    enableHWA: false
  });

  var CJK_SYSTEM_FONT_RE = /^(?:SimHei|SimSun|NSimSun|FangSong(?:_GB2312)?|KaiTi(?:_GB2312)?|Microsoft\s*YaHei|DengXian|STHeiti|STKaiti|STFangsong|STZhongsong)$/i;

  function preferPdfJsForFonts(fonts) {
    return (fonts || []).some(function (font) {
      var name = String(font && font.name || '').replace(/^\//, '');
      if (!font || !font.missingFile || /^[A-Z]{6}\+/.test(name)) return false;
      return CJK_SYSTEM_FONT_RE.test(name);
    });
  }

  function ensurePdfJsCompatibility() {
    if (typeof Map.prototype.getOrInsertComputed === 'function') return;
    // eslint-disable-next-line no-extend-native -- 内置 PDF.js 运行时会调用 Map.prototype.getOrInsertComputed，仅在其缺失时补齐
    Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
      configurable: true,
      writable: true,
      value: function (key, callback) {
        if (this.has(key)) return this.get(key);
        var value = callback(key);
        this.set(key, value);
        return value;
      }
    });
  }

  function loadPdfJs() {
    ensurePdfJsCompatibility();
    if (window.pdfjsLib) {
      if (window.litboardDesktop) window.pdfjsLib.GlobalWorkerOptions.workerSrc = LOCAL_WORKER_URL;
      return Promise.resolve(window.pdfjsLib);
    }
    if (loading) return loading;
    // 桌面与非桌面（纯浏览器打开 index.html）统一走本地 vendor 的 ESM 产物；
    // CDN 兜底已移除：与「第三方库一律本地 vendor」的项目约定和收紧后的 CSP 一致。
    loading = import(LOCAL_PDFJS_URL).then(function (pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = LOCAL_WORKER_URL;
      window.pdfjsLib = pdfjsLib;
      return pdfjsLib;
    });
    loading.catch(function () { loading = null; }); // 失败后允许重试
    return loading;
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
    return loadPdfJs().then(function (pdfjsLib) {
      var bytesPromise = providedBytes ? Promise.resolve(providedBytes) : getBytes(file);
      return bytesPromise.then(function (buf) {
        return pdfjsLib.getDocument({
          data: buf,
          cMapUrl: CMAP_URL,
          cMapPacked: true,
          standardFontDataUrl: STANDARD_FONT_URL,
          wasmUrl: WASM_URL,
          iccUrl: ICC_URL,
          disableFontFace: RENDERING_PROFILE.disableFontFace,
          useSystemFonts: RENDERING_PROFILE.useSystemFonts,
          isEvalSupported: RENDERING_PROFILE.isEvalSupported,
          enableXfa: RENDERING_PROFILE.enableXfa,
          useWasm: RENDERING_PROFILE.useWasm,
          enableHWA: RENDERING_PROFILE.enableHWA
        }).promise;
      });
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

  /** 取前 maxPages 页的文本项（含字号信息）；默认 5 页，与 Zotero RecognizeDocument.MAX_PAGES 一致 */
  function extractItems(file, maxPages, providedBytes) {
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

  function extractAuthors(contents) {
    var value = extractLabeledValue(contents, /作者\s*[:：]/, /DOI\s*[:：]|网络首发日期|网络首发时间|引用格式|作者简介|通信作者|基金项目|摘要\s*[:：]|Abstract\s*[:：]|机构|单位/);
    return cleanAuthors(value);
  }

  function extractAbstract(contents) {
    return extractLabeledValue(contents, /(?:摘\s*要|Abstract)\s*[:：]/i, /关键词\s*[:：]|Key\s*words\s*[:：]|中图分类号|文献标志码|基金项目|作者简介|通信作者|收稿日期|引\s*言|0\s*引\s*言/);
  }

  function extractVenue(contents) {
    var all = (contents || []).map(function (c) {
      return pageText(c && c.items, ' ');
    }).join(' ');
    var m = all.match(/\[J\s*\/?\s*OL\]\s*[．.]\s*([^\s.．，,；;]{2,60})/);
    if (!m) m = all.match(/\[J\]\s*[．.]\s*([^\s.．，,；;]{2,60})/);
    if (!m) m = all.match(/(?:期刊|杂志)\s*[：:]\s*([^\s，,；;]{2,60})/);
    return m ? cleanCjkWhitespace(m[1]) : '';
  }

  function extractYear(contents) {
    var all = (contents || []).map(function (c) {
      return pageText(c && c.items, ' ');
    }).join(' ');
    var m = all.match(/网络首发日期[:：]\s*(\d{4})/)
      || all.match(/网络首发时间[:：\s]*(\d{4})/)
      || all.match(/(\d{4})\s*年\s*\d+\s*月/)
      || all.match(/引用格式[\s\S]{0,80}?(\d{4})/);
    if (!m) return null;
    var year = Number(m[1]);
    return year >= 1000 && year <= 3000 ? year : null;
  }

  function extractVolumeIssue(contents) {
    var all = (contents || []).map(function (c) {
      return pageText(c && c.items, ' ');
    }).join(' ');
    var result = { volume: '', issue: '', pages: '' };
    var vm = all.match(/第\s*(\d+)\s*卷\s*第\s*(\d+)\s*期/);
    if (vm) {
      result.volume = vm[1];
      result.issue = vm[2];
    } else {
      vm = all.match(/Vol\.?\s*(\d+)\s*,\s*No\.?\s*(\d+)/i);
      if (vm) {
        result.volume = vm[1];
        result.issue = vm[2];
      }
    }
    var pm = all.match(/(?:页|pp\.?)\s*(\d+)\s*[-–—至]\s*(\d+)/i);
    if (pm) result.pages = pm[1] + '-' + pm[2];
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
      return {
        doi: findDoi(allText),
        title: guessTitle(contents),
        authors: extractAuthors(contents),
        abstract: extractAbstract(contents),
        venue: extractVenue(contents),
        year: extractYear(contents),
        volume: vi.volume,
        issue: vi.issue,
        pages: vi.pages,
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
   */
  function lookupPdfMetadata(info) {
    info = info || {};
    if (info.doi) {
      return window.LitEnrich.byDoi(info.doi).catch(function () { return null; }).then(function (patch) {
        if (patch) return { patch: patch, by: 'doi' };
        if (info.title) {
          return window.LitEnrich.byTitle(info.title).catch(function () { return null; }).then(function (patch2) {
            return { patch: patch2, by: 'title' };
          });
        }
        return { patch: null, by: null };
      });
    }
    if (info.title) {
      return window.LitEnrich.byTitle(info.title).catch(function () { return null; }).then(function (patch) {
        return { patch: patch, by: 'title' };
      });
    }
    return Promise.resolve({ patch: null, by: null });
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
    return page.getAnnotations({ intent: 'display' }).then(function (items) {
      if (!items.length) return;
      // 异步回调到达时本轮渲染可能已被更新的一轮取代（如缩放刷新），过期则丢弃
      if (isCurrent && !isCurrent()) return;
      var old = sheet.querySelector('.pdf-link-layer');
      if (old) old.remove();
      var layer = document.createElement('div');
      layer.className = 'pdf-link-layer';
      items.forEach(function (item) {
        if (item.subtype !== 'Link' || !item.rect) return;
        var rect = viewport.convertToViewportRectangle(item.rect);
        var left = Math.min(rect[0], rect[2]), top = Math.min(rect[1], rect[3]);
        var link = document.createElement(item.url ? 'a' : 'button');
        link.className = 'pdf-document-link';
        link.style.left = left + 'px';
        link.style.top = top + 'px';
        link.style.width = Math.abs(rect[2] - rect[0]) + 'px';
        link.style.height = Math.abs(rect[3] - rect[1]) + 'px';
        link.title = item.url || T('跳转到文档内位置');
        if (item.url) {
          link.href = item.url;
          link.target = '_blank';
          link.rel = 'noreferrer';
        } else if (item.dest) {
          link.type = 'button';
          link.addEventListener('click', function () {
            var destination = typeof item.dest === 'string' ? handle.doc.getDestination(item.dest) : Promise.resolve(item.dest);
            destination.then(function (dest) {
              if (!dest || !dest[0]) return;
              return handle.doc.getPageIndex(dest[0]).then(function (index) { handle.goToPage(index + 1); });
            }).catch(function () {});
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

  /**
   * PDF.js 阅读器内核：页面占位 + 邻近页按需渲染 + TextLayer + 链接/批注层。
   * 返回的 handle 负责导航、搜索、选择坐标转换和释放资源。
   */
  function renderPdf(file, container, opts) {
    opts = opts || {};
    var scale = opts.scale || 1.35;
    var layout = opts.layout === 'spread' ? 'spread' : 'single';
    var rotation = ((Number(opts.rotation) || 0) % 360 + 360) % 360;
    var withTextLayer = opts.textLayer === true;
    var rendererPreference = opts.renderer === 'pdfjs' || opts.renderer === 'pdfium' ? opts.renderer : 'auto';
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
    var pdfiumDocument = null;
    var pdfiumPromise = null;
    var autoRendererPromise = null;
    function openPdfium() {
      if (pdfiumPromise) return pdfiumPromise;
      pdfiumPromise = window.LitPdfium ? getSourceBytes().then(function (bytes) {
        return window.LitPdfium.openBytes(bytes);
      }).then(function (doc) {
        if (cancelled) { doc.destroy(); return null; }
        pdfiumDocument = doc;
        return doc;
      }) : Promise.resolve(null);
      return pdfiumPromise;
    }
    function pageFonts(page) {
      return page.getOperatorList().then(function (operatorList) {
        var ids = [];
        operatorList.fnArray.forEach(function (fn, index) {
          if (fn !== window.pdfjsLib.OPS.setFont) return;
          var id = operatorList.argsArray[index] && operatorList.argsArray[index][0];
          if (id && ids.indexOf(id) < 0) ids.push(id);
        });
        return ids.map(function (id) {
          try {
            var font = page.commonObjs.get(id);
            return { name: font && font.name || '', missingFile: !!(font && font.missingFile) };
          } catch (e) {
            return null;
          }
        }).filter(Boolean);
      });
    }
    function pageRenderer(page) {
      if (rendererPreference !== 'auto') return Promise.resolve(rendererPreference);
      if (!autoRendererPromise) {
        // PDFium 对绝大多数出版商/公式 PDF 更稳定；只有首屏明确依赖未嵌入的
        // Windows 中文系统字体时才切到 PDF.js 的 CMap/字体替代路径。
        autoRendererPromise = pageFonts(page).then(function (fonts) {
          return preferPdfJsForFonts(fonts) ? 'pdfjs' : 'pdfium';
        }).catch(function () { return 'pdfium'; });
      }
      return autoRendererPromise;
    }
    var pages = [], sheets = [], renderTasks = {}, textCache = {}, observer = null, scrollFrame = 0;
    // renderingPages：每页渲染串行化（避免连续缩放时并发写同一页）；
    // pendingRefresh：渲染途中被标记过期（stale/false）时，完成后自动补一轮重绘
    var renderingPages = {}, pendingRefresh = {};
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
        Object.keys(renderTasks).forEach(function (key) { try { renderTasks[key].cancel(); } catch (e) {} });
        if (pdfiumDocument) { try { pdfiumDocument.destroy(); } catch (e) {} pdfiumDocument = null; }
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
        if (nextScale === scale && nextLayout === layout && nextRotation === rotation) return true;
        // 记录滚动锚点（视口顶部命中的页 + 页内偏移比例），重排后恢复阅读位置
        var rootRect = container.getBoundingClientRect();
        var anchor = null;
        for (var i = 0; i < sheets.length; i++) {
          var rect = sheets[i] && sheets[i].getBoundingClientRect();
          if (rect && rect.bottom > rootRect.top && rect.top < rootRect.bottom) {
            anchor = { index: i, ratio: rect.height ? Math.max(0, Math.min(1, (rootRect.top - rect.top) / rect.height)) : 0 };
            break;
          }
        }
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
          var newRect = sheets[anchor.index].getBoundingClientRect();
          container.scrollTop += (newRect.top + newRect.height * anchor.ratio) - rootRect.top;
        }
        renderNearViewport();
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
       * 可据此在页面上画出高亮矩形。
       */
      search: function (query) {
        var needle = String(query || '').trim().toLocaleLowerCase();
        if (!needle) return Promise.resolve([]);
        var chain = Promise.resolve([]);
        pages.forEach(function (page, index) {
          chain = chain.then(function (results) {
            if (cancelled) return results;
            var pageTextPromise = textCache[index] ? Promise.resolve(textCache[index]) : page.getTextContent().then(function (content) {
              // 某些 PDF（如包含 XFA/嵌套标注流）的 items 会混入 undefined，
              // 需要更严格的防御：str 必须是字符串
              var items = (content.items || []).filter(function (item) {
                return item && typeof item.str === 'string' && item.str.length > 0;
              });
              var offsets = [];
              var parts = [];
              var pos = 0;
              items.forEach(function (item, i) {
                offsets.push({ start: pos, end: pos + item.str.length });
                parts.push(item.str);
                pos += item.str.length + (i < items.length - 1 ? 1 : 0);
              });
              var value = { items: items, offsets: offsets, joined: parts.join(' ') };
              textCache[index] = value;
              return value;
            });
            return pageTextPromise.then(function (pageText) {
              var haystack = pageText.joined.toLocaleLowerCase();
              var matches = [];
              var offset = 0;
              while ((offset = haystack.indexOf(needle, offset)) !== -1) {
                var matchEnd = offset + needle.length;
                var fragments = [];
                for (var i = 0; i < pageText.offsets.length; i++) {
                  var entry = pageText.offsets[i];
                  if (entry.end <= offset || entry.start >= matchEnd) continue;
                  // entry 只有 start/end，对应条目在 items[i]
                  var itemText = pageText.items[i] ? pageText.items[i].str : '';
                  var start = Math.max(0, offset - entry.start);
                  var end = Math.min(itemText.length, matchEnd - entry.start);
                  if (end > start) fragments.push({ itemIndex: i, start: start, end: end });
                }
                if (fragments.length) {
                  var text = fragments.map(function (fragment) {
                    return pageText.items[fragment.itemIndex].str.slice(fragment.start, fragment.end);
                  }).join(' ');
                  matches.push({ fragments: fragments, text: text });
                }
                offset += Math.max(1, needle.length);
              }
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

    // 立即重绘视口（含 120% 预取边距）内的过期页面，不等 IntersectionObserver
    function renderNearViewport() {
      if (cancelled || !sheets.length) return;
      var rootRect = container.getBoundingClientRect();
      if (!rootRect.height) return;
      var margin = rootRect.height * 1.2;
      sheets.forEach(function (sheet, index) {
        if (!sheet) return;
        var rect = sheet.getBoundingClientRect();
        if (rect.bottom >= rootRect.top - margin && rect.top <= rootRect.bottom + margin) renderPage(index + 1);
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
      var pdfJsTask = null;
      function renderWithPdfJs() {
        pdfJsTask = page.render({
          canvasContext: canvasContext,
          viewport: viewport,
          transform: outputScaleX === 1 && outputScaleY === 1 ? null : [outputScaleX, 0, 0, outputScaleY, 0, 0],
          intent: 'display'
        });
        return pdfJsTask.promise.then(function () { return 'pdfjs'; });
      }
      function renderWithPdfium() {
        return openPdfium().then(function (pdfium) {
          if (!pdfium) throw new Error('PDFium is unavailable');
          return pdfium.renderPage(pageNumber - 1, canvas, viewport.rotation);
        }).then(function () { return 'pdfium'; });
      }
      function renderWithFallback(preferred) {
        var primary = preferred === 'pdfjs' ? renderWithPdfJs : renderWithPdfium;
        var fallback = preferred === 'pdfjs' ? renderWithPdfium : renderWithPdfJs;
        return primary().catch(function (error) {
          if (cancelled || (error && error.name === 'RenderingCancelledException')) throw error;
          canvas.dataset[preferred + 'Error'] = String(error && error.message || error);
          return fallback();
        });
      }
      var renderTask = {
        cancel: function () {
          if (pdfJsTask) pdfJsTask.cancel();
        },
        promise: pageRenderer(page).then(renderWithFallback).then(function (renderer) {
          handle.renderer = renderer;
          if (renderer) canvas.dataset.renderer = renderer;
          placeCanvas();
        })
      };
      renderTasks[pageNumber] = renderTask;
      var tasks = [renderTask.promise];
      if (withTextLayer) {
        var layer = document.createElement('div');
        layer.className = 'pdf-text-layer textLayer';
        // PDF.js 5.x TextLayer 依赖宿主导入该变量把 span 字号映射到画布缩放，
        // 缺失时按继承字号渲染，选区几何会比可见文本小（约 0.74×）。
        layer.style.setProperty('--total-scale-factor', String(scale));
        sheet.appendChild(layer);
        tasks.push(page.getTextContent({ includeMarkedContent: true }).then(function (textContent) {
          var textLayer = new window.pdfjsLib.TextLayer({
            textContentSource: textContent,
            container: layer,
            viewport: viewport
          });
          return textLayer.render().then(function () {
            if (!isCurrent()) return;
            sheet._litTextDivs = textLayer.textDivs;
            sheet._litTextItems = textContent.items.filter(function (item) {
              return item && typeof item.str === 'string';
            });
          });
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

    handle.promise = loadPdfJs().then(function (pdfjsLib) {
      return getSourceBytes().then(function (bytes) {
        return openDocument(file, new Uint8Array(bytes)).then(function (doc) { return { doc: doc, pdfjsLib: pdfjsLib }; });
      });
    }).then(function (opened) {
      var doc = opened.doc;
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

  window.LitPdf = {
    pdfToPaper: pdfToPaper,
    fingerprint: fingerprint,
    inspectPdf: inspectPdf,
    extractText: extractText,
    renderPdf: renderPdf,
    renderPageToPng: renderPageToPng,
    renderSearchLayer: renderSearchLayer,
    load: loadPdfJs,
    renderingProfile: RENDERING_PROFILE,
    rendererPolicy: Object.freeze({ preferPdfJsForFonts: preferPdfJsForFonts }),
    selectionGeometry: Object.freeze({
      mergeRects: mergeClientRects,
      normalizeCharacterRect: normalizeCharacterRect,
      focusLineTrim: focusLineTrim,
      dropBandLine: dropBandLine
    })
  };
})();
