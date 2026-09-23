/* LitBoard 最小 docx 读写（阶段二）：带 LitBoard 引文域的 Word 文档生成与解析（浏览器 / Node 共用）
 *
 * - 引文用复杂域保存：fldChar begin → instrText " ADDIN LitBoard.Citation.1 \"{json}\"" → separate → 渲染文本 → end。
 *   域命名版本化、独立命名（不冒充 Zotero 域），是下一轮 VBA 插件的定位契约；
 * - ZIP 容器走 vendored JSZip（vendor/jszip/）：STORE 写入 + 条目排序 + 固定 DOS 时间，
 *   同一 JSZip 版本内输出字节确定；读取 method 0/8 全平台可用（JSZip 自带 inflate，
 *   浏览器端也能读 Word 产出的 deflate 包）。zipStore/zipRead 及依赖它们的导出均为 async；
 * - convertZoteroFields：把 Zotero 域（ADDIN ZOTERO_ITEM CSL_CITATION …）换成 LitBoard 域，只生成新表示、不动原件。
 */
(function (root, factory) {
  var JSZip = null;
  if (typeof module === 'object' && module.exports) {
    try { JSZip = require('../vendor/jszip/jszip.min.js'); } catch (e) { JSZip = null; }
  } else if (root) {
    JSZip = root.JSZip || null;
  }
  var api = factory(JSZip);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitDocx = api;
})(typeof window !== 'undefined' ? window : null, function (JSZip) {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  function text(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
  function asBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new TextEncoder().encode(text(data));
  }
  function bytesToString(bytes) { return new TextDecoder('utf-8').decode(bytes); }

  /* ---------- ZIP 容器（vendored JSZip；STORE 写入 + 确定性输出） ---------- */
  var FIXED_DATE = new Date(1980, 0, 1, 0, 0, 0); // DOS 时间原点：同一 JSZip 版本内输出字节确定

  function requireZip() {
    if (!JSZip) throw new Error(T('ZIP 组件未加载'));
    return JSZip;
  }

  /** 写侧条目名规范化与校验（在启动异步工作前同步抛错，保持同步抛错语义） */
  function normalizeEntryName(name) {
    var clean = text(name).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean.split('/').indexOf('..') !== -1) {
      throw new Error(T('非法 ZIP 条目名：') + name);
    }
    return clean;
  }

  function assertSafeReadName(name) {
    if (!name || name.split('/').indexOf('..') !== -1 || /^(?:[A-Za-z]:)?[\\/]/.test(name)) {
      throw new Error(T('ZIP 包含非法条目名：') + name);
    }
  }

  /** entries: [{ name, data(Uint8Array|string) }] → Promise<完整 zip 字节>（STORE、条目排序、固定 DOS 时间） */
  function zipStore(entries) {
    var Zip = requireZip();
    var sorted = (entries || []).slice().sort(function (a, b) {
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    var zip = new Zip();
    sorted.forEach(function (entry) {
      zip.file(normalizeEntryName(entry.name), asBytes(entry.data), { date: FIXED_DATE, createFolders: false });
    });
    return zip.generateAsync({ type: 'uint8array', compression: 'STORE', createFolders: false });
  }

  /** 解析 zip → Promise<[{ name, data(Uint8Array) }]>；method 0/8 均可（JSZip 内置 inflate）。 */
  function zipRead(bytes) {
    var Zip = requireZip();
    return Zip.loadAsync(asBytes(bytes)).then(function (zip) {
      var names = Object.keys(zip.files);
      var out = [];
      var chain = Promise.resolve();
      names.forEach(function (key) {
        chain = chain.then(function () {
          var file = zip.files[key];
          if (file.dir) return;
          var name = String(file.name || '').replace(/\\/g, '/');
          assertSafeReadName(name);
          return file.async('uint8array').then(function (data) {
            out.push({ name: name, data: data });
          });
        });
      });
      return chain.then(function () { return out; });
    });
  }

  /* ---------- OOXML ---------- */
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  function escXml(value) {
    return text(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  /* 文本 run 的字符格式：bold/italic/smallCaps 是 <w:b/> 一类的开关，上标下标是 w:vertAlign。
     这些来自 cslcite.htmlToRuns（HTML 里的 <i>/<sup> 等标签），不是纯文本——纯文本 run 走不到这里。 */
  function runPropsXml(props) {
    var parts = '';
    if (props.bold) parts += '<w:b/>';
    if (props.italic) parts += '<w:i/>';
    if (props.smallCaps) parts += '<w:smallCaps/>';
    if (props.sup) parts += '<w:vertAlign w:val="superscript"/>';
    if (props.sub) parts += '<w:vertAlign w:val="subscript"/>';
    return parts ? '<w:rPr>' + parts + '</w:rPr>' : '';
  }
  function textRunXml(run, value) {
    var body;
    if (run && run.tab) body = '<w:tab/>';
    else if (run && run.br) body = '<w:br/>';
    else body = '<w:t xml:space="preserve">' + escXml(value) + '</w:t>';
    return '<w:r>' + runPropsXml(run || {}) + body + '</w:r>';
  }
  /* 段落级格式：悬挂缩进/左缩进、制表位、段后距、行距（twips；lineSpacing 是倍数）。
     参考文献表靠它对齐 second-field-align 的编号制表位（与 Word 插件同一套数值）。 */
  function paragraphPropsXml(paragraph) {
    var p = paragraph || {};
    var indent = Number(p.indent) || 0;
    var firstLine = Number(p.firstLineIndent) || 0;
    var after = Number(p.entrySpacing) || 0;
    var line = Number(p.lineSpacing) || 0;
    var tabStops = Array.isArray(p.tabStops) ? p.tabStops : [];
    var parts = '';
    if (indent || firstLine) {
      parts += '<w:ind w:left="' + indent + '"' +
        (firstLine ? ' w:hanging="' + Math.abs(firstLine) + '"' : '') + '/>';
    }
    if (tabStops.length) {
      parts += '<w:tabs>' + tabStops.map(function (stop) {
        return '<w:tab w:val="left" w:pos="' + (Number(stop) || 0) + '"/>';
      }).join('') + '</w:tabs>';
    }
    if (after || line > 1) {
      parts += '<w:spacing' + (after ? ' w:after="' + after + '"' : '') +
        (line > 1 ? ' w:line="' + (240 * line) + '" w:lineRule="auto"' : '') + '/>';
    }
    return parts ? '<w:pPr>' + parts + '</w:pPr>' : '';
  }
  function runXml(run, ctx) {
    if (run && run.citation) {
      var payload = typeof run.citation.payload === 'string'
        ? run.citation.payload : JSON.stringify(run.citation.payload);
      // 域结果里的引文文本是 HTML（citeproc 输出）：<sup> 之类的标签必须转成真正的
      // 字符格式 run，否则会被当成字面字符印进文档。调用方传 runs（htmlToRuns 的结果）；
      // 只给 text 时按纯文本处理（docx 读回路径拿到的就是纯文本）。
      var citationRuns = Array.isArray(run.citation.runs) && run.citation.runs.length
        ? run.citation.runs
        : [{ text: run.citation.text || '' }];
      return '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> ADDIN LitBoard.Citation.1 "' + escXml(payload) + '"</w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        citationRuns.map(function (item) { return textRunXml(item, item.text); }).join('') +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    }
    if (run && run.image) {
      // 图片 run：data(Uint8Array) + ext（.png/.jpg/…）；默认 4in 宽 2.25in 高
      var ext = String(run.image.ext || '.png').toLowerCase();
      if (ext.charAt(0) !== '.') ext = '.' + ext;
      var relId = 'rIdImg' + (ctx.images.length + 1);
      var imageName = 'img' + (ctx.images.length + 1) + ext;
      ctx.images.push({ relId: relId, name: imageName, data: run.image.data });
      var cx = Number(run.image.cx) || 3657600; // EMU（4 inch）
      var cy = Number(run.image.cy) || 2057400;
      return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" ' +
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
        '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
        '<wp:docPr id="' + (ctx.images.length + 100) + '" name="' + escXml(imageName) + '"/>' +
        '<wp:cNvGraphicFramePr/>' +
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:nvPicPr><pic:cNvPr id="' + (ctx.images.length + 100) + '" name="' + escXml(imageName) + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip xmlns:r="' + NS_R + '" r:embed="' + relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
        '</wp:inline></w:drawing></w:r>';
    }
    // 普通文本 run：bold/italic/smallCaps/上标下标以及 tab/br 都走同一个出口
    return textRunXml(run, run && run.text);
  }
  /** paragraph = { text } | { runs: [{text|bold|italic|sup|sub|smallCaps|tab|br|citation|image}], indent, firstLineIndent, entrySpacing, lineSpacing, tabStops } */
  function paragraphXml(paragraph, ctx) {
    var runs;
    if (paragraph && paragraph.runs) runs = paragraph.runs;
    else runs = [{ text: paragraph && paragraph.text }];
    return '<w:p>' + paragraphPropsXml(paragraph) +
      runs.map(function (run) { return runXml(run, ctx); }).join('') + '</w:p>';
  }

  var CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Default Extension="gif" ContentType="image/gif"/>' +
    '<Default Extension="svg" ContentType="image/svg+xml"/>' +
    '<Default Extension="webp" ContentType="image/webp"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  var RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  /** paragraphs → Promise<docx 字节>（最小包；图片 run 自动生成 media 部件与 rels） */
  function buildDocx(paragraphs) {
    var ctx = { images: [] };
    var body = (paragraphs || []).map(function (paragraph) { return paragraphXml(paragraph, ctx); }).join('');
    var documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="' + NS_R + '">' +
      '<w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
      '</w:body></w:document>';
    var entries = [
      { name: '[Content_Types].xml', data: CONTENT_TYPES },
      { name: '_rels/.rels', data: RELS },
      { name: 'word/document.xml', data: documentXml }
    ];
    if (ctx.images.length) {
      var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        ctx.images.map(function (image) {
          return '<Relationship Id="' + image.relId + '" ' +
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
            'Target="media/' + image.name + '"/>';
        }).join('') + '</Relationships>';
      entries.push({ name: 'word/_rels/document.xml.rels', data: docRels });
      ctx.images.forEach(function (image) {
        entries.push({ name: 'word/media/' + image.name, data: image.data });
      });
    }
    return zipStore(entries);
  }

  var FIELD_RE = /<w:fldChar\b[^>]*w:fldCharType="(begin|separate|end)"[^>]*\/>|<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  function decodeXml(value) {
    return text(value)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }
  /**
   * 按文档顺序提取复杂域：返回 [{ instr, payload, text }]。
   * payload 为域指令里 LitBoard.Citation.1 的 JSON（无则 null）。
   */
  function finalizeInstr(field) {
    var m = /^\s*ADDIN\s+(\S+)\s+"([\s\S]*)"\s*$/.exec(field.instr.trim());
    field.addin = m ? m[1] : '';
    field.payload = null;
    if (m) { try { field.payload = JSON.parse(m[2]); } catch (e) { field.payload = null; } }
  }
  function readDocxFieldsXml(xml) {
    var fields = [];
    var current = null;
    var inResult = false;
    var match;
    FIELD_RE.lastIndex = 0;
    while ((match = FIELD_RE.exec(xml))) {
      if (match[1] === 'begin') {
        current = { instr: '', payload: null, text: '' };
        inResult = false;
      } else if (match[1] === 'separate' && current) {
        finalizeInstr(current); // 多段 instrText 已拼接完
        inResult = true;
      } else if (match[1] === 'end' && current) {
        finalizeInstr(current);
        fields.push(current);
        current = null;
        inResult = false;
      } else if (match[2] !== undefined && current && !inResult) {
        current.instr += decodeXml(match[2]); // Word 会把长指令拆成多段 instrText：拼接而非覆盖（F08）
      } else if (match[3] !== undefined && current && inResult) {
        current.text += decodeXml(match[3]);
      }
    }
    return fields;
  }

  function readDocxFields(bytes) {
    return zipRead(bytes).then(function (entries) {
      var documentEntry = entries.filter(function (e) { return e.name === 'word/document.xml'; })[0];
      if (!documentEntry) throw new Error(T('docx 缺少 word/document.xml'));
      return readDocxFieldsXml(bytesToString(documentEntry.data));
    });
  }

  /** Read citation fields from the body, footnotes and endnotes in document order per story. */
  function readDocxFieldsAll(bytes) {
    var names = ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'];
    return zipRead(bytes).then(function (entries) {
      var out = [];
      names.forEach(function (name) {
        var entry = entries.filter(function (item) { return item.name === name; })[0];
        if (!entry) return;
        readDocxFieldsXml(bytesToString(entry.data)).forEach(function (field) {
          field.part = name;
          out.push(field);
        });
      });
      return out;
    });
  }

  /* ---------- Zotero 引文域转换 ---------- */
  var ZOTERO_FIELD_RE = /^ADDIN\s+ZOTERO_ITEM\s+CSL_CITATION\s+([\s\S]*)$/i;
  function zoteroKeyFromUris(uris) {
    var list = Array.isArray(uris) ? uris : [];
    for (var i = 0; i < list.length; i++) {
      var match = /\/items\/([A-Za-z0-9_-]+)\/?$/.exec(text(list[i]));
      if (match) return match[1];
    }
    return '';
  }

  /**
   * fields = readDocxFields 的输出；options.resolveKey(zoteroKey) → LitBoard paperId | null。
   * 命中：换成 LitBoard 域（cslItem 快照 = Zotero 嵌入条目，id 改写为 paperId）；
   * 未匹配：保留嵌入快照（paperId=''，status='unmatched'），由上层 UI 决定后续处理。
   * 返回 { fields, report: { citations, matched, unmatched, missingKeys } }。
   */
  function convertZoteroFields(fields, options) {
    var resolveKey = options && typeof options.resolveKey === 'function' ? options.resolveKey : function () { return null; };
    var report = { citations: 0, matched: 0, unmatched: 0, missingKeys: [] };
    var out = (Array.isArray(fields) ? fields : []).map(function (field) {
      var zoteroMatch = ZOTERO_FIELD_RE.exec(text(field.instr).trim());
      if (!zoteroMatch) return field; // 非 Zotero 域（含 LitBoard 自己的域）原样保留
      var data;
      try { data = JSON.parse(zoteroMatch[1]); } catch (e) {
        report.unmatched++;
        report.missingKeys.push(T('(payload 无法解析)'));
        return { instr: field.instr, text: field.text, payload: field.payload, part: field.part, status: 'unmatched' };
      }
      report.citations++;
      var items = (Array.isArray(data.citationItems) ? data.citationItems : []).map(function (item) {
        var zoteroKey = zoteroKeyFromUris(item.uris) || text(item.id);
        var paperId = zoteroKey ? resolveKey(zoteroKey) : null;
        if (!paperId && zoteroKey && report.missingKeys.indexOf(zoteroKey) === -1) report.missingKeys.push(zoteroKey);
        var snapshot = item.itemData && typeof item.itemData === 'object'
          ? Object.assign({}, item.itemData) : {};
        return {
          paperId: paperId || '',
          locator: item.locator != null ? String(item.locator) : '',
          label: text(item.label),
          prefix: text(item.prefix),
          suffix: text(item.suffix),
          suppressAuthor: item['suppress-author'] === true,
          cslItem: Object.assign({}, snapshot, { id: paperId || '' })
        };
      });
      if (items.length && items.every(function (item) { return !!item.paperId; })) report.matched++;
      else report.unmatched++;
      return {
        addin: 'LitBoard.Citation.1',
        payload: {
          version: 1,
          zoteroCitationId: text(data.citationID),
          items: items
        },
        instr: '', text: field.text, part: field.part,
        status: items.every(function (item) { return !!item.paperId; }) ? 'converted' : 'unmatched'
      };
    });
    return { fields: out, report: report };
  }

  /** 用转换后的 fields 重建 docx（新副本；原件不动） */
  function buildDocxFromFields(fields, extraParagraphs) {
    var paragraphs = [];
    (fields || []).forEach(function (field) {
      paragraphs.push({ runs: [{ citation: { payload: field.payload || field.instr, text: field.text } }] });
    });
    (extraParagraphs || []).forEach(function (p) { paragraphs.push(p); });
    return buildDocx(paragraphs);
  }

  /**
   * document.xml 级 Zotero 转换：把 ADDIN ZOTERO_ITEM 域的 instrText 原位替换为
   * LitBoard 指令（保留域结果文本、样式与其余全部内容；只生成新表示，调用方另存副本）。
   * fields = convertZoteroFields 输出（内部会过滤非 Zotero 域，PAGE 等不消费队列）；
   * Word 会把长指令拆成多个 instrText run：首段改写为新指令，其余段清空内容（F08）。
   */
  function convertZoteroDocxXml(xml, fields) {
    var source = text(xml);
    var queue = (fields || []).filter(function (f) {
      // 只消费 Zotero 源域：convertZoteroFields 的 status 标记（转换后 instr 已清空）
      // 或调用方直接传的原始 Zotero 域；PAGE 等其他域不消费队列（F08 错位修复）
      return f && (f.status === 'converted' || f.status === 'unmatched' ||
        ZOTERO_FIELD_RE.test(String(f.instr || '').trim()));
    }).slice();
    var TOKEN_RE = /<w:fldChar\b[^>]*w:fldCharType="(begin|separate|end)"[^>]*\/?>|<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g;
    var INSTR_PART_RE = /(<w:instrText\b[^>]*>)([\s\S]*?)(<\/w:instrText>)/;
    var out = [];
    var last = 0;
    var match;
    var field = null;       // 当前复杂域的指令累计
    var pending = [];       // 指令区的 instrText 原始段（改写前暂存）
    var inInstr = false;    // 指令区（separate 之前）
    var decided = false;    // 当前域是否已在 separate 处决策过（end 不重复消费队列）
    function flushPending(converted) {
      if (!pending.length) return;
      pending.forEach(function (seg, i) {
        if (converted && i === 0) {
          var instr = ' ADDIN LitBoard.Citation.1 "' + JSON.stringify(converted.payload) + '"';
          out.push(seg.replace(INSTR_PART_RE, function (full, a, b, c) { return a + escXml(instr) + c; }));
        } else if (converted) {
          out.push(seg.replace(INSTR_PART_RE, function (full, a, b, c) { return a + c; })); // 清余段，JSON 碎片不留
        } else {
          out.push(seg);
        }
      });
      pending = [];
    }
    while ((match = TOKEN_RE.exec(source))) {
      if (match[2] !== undefined && field && inInstr) {
        out.push(source.slice(last, match.index));
        field.instr += decodeXml(match[2]);
        pending.push(match[0]);
        last = TOKEN_RE.lastIndex;
        continue;
      }
      if (!match[1]) continue;
      out.push(source.slice(last, match.index));
      last = TOKEN_RE.lastIndex;
      if (match[1] === 'begin') {
        field = { instr: '' };
        pending = [];
        inInstr = true;
        decided = false;
        out.push(match[0]);
        continue;
      }
      // separate / end：指令区结束，决定转换
      if (!decided) {
        var zoteroField = field && ZOTERO_FIELD_RE.test(field.instr.trim());
        var fld = zoteroField ? queue.shift() : null;
        var resolved = fld && fld.payload && Array.isArray(fld.payload.items) && fld.payload.items.length &&
          fld.payload.items.every(function (item) { return !!item.paperId; });
        flushPending(resolved ? fld : null);
        decided = true;
      } else {
        flushPending(null);
      }
      out.push(match[0]);
      if (match[1] === 'separate') inInstr = false;
      if (match[1] === 'end') field = null;
    }
    flushPending(null);
    out.push(source.slice(last));
    return out.join('');
  }

  return {
    zipStore: zipStore,
    zipRead: zipRead,
    buildDocx: buildDocx,
    readDocxFields: readDocxFields,
    readDocxFieldsAll: readDocxFieldsAll,
    convertZoteroFields: convertZoteroFields,
    convertZoteroDocxXml: convertZoteroDocxXml,
    buildDocxFromFields: buildDocxFromFields
  };
});
