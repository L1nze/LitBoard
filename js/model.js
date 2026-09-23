/* LitBoard 数据模型：校验、迁移与规范化（浏览器 / Node 共用） */
(function (root, factory) {
  var pinyinPro = root && root.pinyinPro;
  if (typeof module === 'object' && module.exports) {
    try { pinyinPro = require('../vendor/pinyin-pro/pinyin-pro.js'); } catch (e) { /* 浏览器 bundle 不走 require */ }
  }
  var api = factory(pinyinPro);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitModel = api;
})(typeof window !== 'undefined' ? window : null, function (pinyinPro) {
  'use strict';

  var SCHEMA_VERSION = 14;
  var VALID_STATUS = { unread: true, reading: true, read: true };
  var VALID_ENTRY_TYPES = {
    article: true, inproceedings: true, book: true, incollection: true,
    phdthesis: true, mastersthesis: true, report: true, newspaper: true,
    webpage: true, preprint: true, patent: true, misc: true
  };
  var VALID_ATTACHMENT_KINDS = { pdf: true, supp: true, epub: true, snapshot: true, other: true };
  var VALID_CREATOR_TYPES = { author: true, editor: true, translator: true, other: true };
  var VALID_NOTE_FORMATS = { markdown: true, richtext: true };

  /**
   * 纯出版商名黑名单（整串匹配）：部分元数据源（Semantic Scholar / OpenAlex）
   * 把 publisher 当venue 返回，如 "Elsevier"、"Springer"，把它们清洗掉。
   * 注意只做整串、忽略大小写/前后缀比较，不误伤 "Journal of ..." 这类真期刊名。
   */
  var PUBLISHER_NAMES = [
    'elsevier', 'elsevier sci ltd', 'elsevier science bv', 'elsevier b.v.', 'elsevier ltd',
    'springer', 'springer berlin heidelberg', 'springer berlin', 'springer international publishing',
    'springer nature', 'springer singapore', 'springer us',
    'wiley', 'wiley blackwell', 'wiley-vch', 'john wiley & sons', 'john wiley and sons', 'wiley-vch verlag',
    'taylor & francis', 'taylor and francis', 'informa uk limited',
    'mdpi', 'mdpi ag', 'multidisciplinary digital publishing institute',
    'ieee', 'ieee computer society', 'ieee international', 'ieee-',
    'academic press', 'academic press inc', 'academic press elsevier',
    'nature publishing group', 'nature research', 'publishing group',
    'oxford university press', 'oxford academic', 'cambridge university press',
    'sagе', 'sage publications', 'sage publications ltd',
    'penguin', 'penguin random house', 'hachette livre',
    'kluwer academic publishers', 'kluwer academic', 'springer netherlands',
    'frontiers', 'frontiers media sa', 'frontiers media',
    'plos', 'public library of science',
    'bmj publishing group', 'bmj group',
    'american physical society', 'iop publishing', 'aip publishing',
    'wolters kluwer', 'wolters kluwer medknow', 'dove medical press'
  ];
  function cleanVenue(v) {
    var s = text(v).trim();
    if (!s) return '';
    var norm = s
      .replace(/^https?:\/\/\S+$/, '')
      .replace(/[,.；;：:。\s]+$/, '')
      .trim();
    var lower = norm.toLowerCase();
    if (PUBLISHER_NAMES.indexOf(lower) !== -1) return '';
    // 带冒号的全名变体：Elsevier Science Ltd → Elsevier 前缀也判出版
    if (/^(elsevier|springer|wiley|taylor & francis)/i.test(lower) && lower.length <= 22) return '';
    return norm;
  }

  function text(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
  function finiteNumber(v) {
    // 空值（null/undefined/''）保持空，不落入 Number('')=0 的陷阱，保证 normalize 幂等
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function timestampOrNull(v) {
    var n = finiteNumber(v);
    return n != null && n > 0 ? Math.trunc(n) : null;
  }
  function stringList(v) {
    if (!Array.isArray(v)) return [];
    var seen = {};
    return v.map(function (x) { return text(x).trim(); }).filter(function (x) {
      if (!x || seen[x]) return false;
      seen[x] = true;
      return true;
    });
  }
  function isNoiseTag(value) {
    var tag = text(value).trim();
    var lower = tag.toLowerCase();
    return lower === '/unread' || lower.indexOf('no doi found') !== -1 || /[★☆⭐🌟✨✦✧✩✪✫✬✭✮✯✰]/u.test(tag);
  }
  function cleanTags(v) {
    return stringList(v).filter(function (tag) { return !isNoiseTag(tag); });
  }
  function stringMap(v) {
    var raw = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    var out = {};
    Object.keys(raw).sort().forEach(function (key) {
      var name = text(key).trim().toLowerCase();
      var value = text(raw[key]).trim();
      if (name && /^[a-z0-9_.:-]{1,80}$/.test(name) && value) out[name] = value.slice(0, 50000);
    });
    return out;
  }
  function safeUrl(v) {
    var s = text(v).trim();
    if (!s) return '';
    try {
      var u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
    } catch (e) { return ''; }
  }
  function validId(v) {
    var s = text(v);
    return /^[A-Za-z0-9_-]{1,120}$/.test(s) ? s : '';
  }

  function sourceLibraryId(value) {
    var s = text(value).trim();
    return /^[A-Za-z0-9_.:-]{1,120}$/.test(s) ? s : '';
  }

  function normalizeSourceMeta(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    var out = {};
    Object.keys(value).slice(0, 80).forEach(function (key) {
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(key)) return;
      var item = value[key];
      if (typeof item === 'string') out[key] = item.slice(0, 2000);
      else if (typeof item === 'number' && Number.isFinite(item)) out[key] = item;
      else if (typeof item === 'boolean') out[key] = item;
    });
    return out;
  }

  /* ---- 结构化创作者（v12）：creators 为权威，authors 为兼容投影 ---- */
  // 机构名线索：无逗号多词名命中此类词时整体保留为机构，不按"末词为姓"拆分
  var ORG_NAME_HINTS = /(university|institute|institut|college|academy|hospital|corporation|company|\binc\b|\bltd\b|\bllc\b|association|society|committee|commission|organization|organisation|consortium|department|division|group|center|centre|laborator|council|bureau|agency|foundation|press|大学|学院|研究院|研究所|协会|委员会|学会|公司|集团|中心|医院|出版社|实验室)/i;
  /** 旧式姓名字符串 → 创作者对象。支持 "Family, Given"、"Given Family"、CJK 全名、机构名。 */
  function parseCreatorName(raw) {
    var value = text(raw).trim().replace(/\s+/g, ' ');
    if (!value) return null;
    if (value.indexOf(',') !== -1) {
      var parts = value.split(',');
      var family = text(parts[0]).trim();
      var given = text(parts.slice(1).join(' ')).trim();
      if (!family) return given ? { creatorType: 'author', family: '', given: '', name: given } : null;
      return { creatorType: 'author', family: family, given: given, name: '' };
    }
    // CJK 全名（无空格无逗号）整体作姓
    if (/^[㐀-鿿·]+$/.test(value)) return { creatorType: 'author', family: value, given: '', name: '' };
    var tokens = value.split(' ');
    if (tokens.length === 1) return { creatorType: 'author', family: value, given: '', name: '' };
    if (ORG_NAME_HINTS.test(value)) return { creatorType: 'author', family: '', given: '', name: value };
    return { creatorType: 'author', family: tokens.pop(), given: tokens.join(' '), name: '' };
  }
  function normalizeCreator(raw) {
    if (typeof raw === 'string') return parseCreatorName(raw);
    var c = raw && typeof raw === 'object' ? raw : {};
    var creatorType = VALID_CREATOR_TYPES[c.creatorType] ? c.creatorType : 'author';
    var name = text(c.name).trim().slice(0, 200);
    var family = text(c.family).trim().slice(0, 120);
    var given = text(c.given).trim().slice(0, 120);
    if (name) { family = ''; given = ''; }
    if (!name && !family) {
      if (!given) return null;
      family = given; given = '';
    }
    return { creatorType: creatorType, family: family, given: given, name: name };
  }
  function normalizeCreators(value) {
    if (!Array.isArray(value)) return [];
    var out = [];
    value.slice(0, 500).forEach(function (raw) {
      var c = normalizeCreator(raw);
      if (c) out.push(c);
    });
    return out;
  }
  function creatorDisplayName(c) {
    if (c.name) return c.name;
    if (c.family && c.given) return c.family + ', ' + c.given;
    return c.family || c.given;
  }
  /** creators → authors 兼容投影（仅 author 角色；输出格式与 cite.js splitName 兼容） */
  function authorsFromCreators(creators) {
    var seen = {};
    return (creators || []).filter(function (c) { return c.creatorType === 'author'; })
      .map(creatorDisplayName)
      .filter(function (x) {
        if (!x || seen[x]) return false;
        seen[x] = true;
        return true;
      });
  }

  /** 部分日期：'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD'，非法一律归 '' */
  function normalizeDate(v) {
    var s = text(v).trim();
    var m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(s);
    if (!m) return '';
    var year = Number(m[1]);
    if (year < 1000 || year > 3000) return '';
    if (m[2] != null && (Number(m[2]) < 1 || Number(m[2]) > 12)) return '';
    if (m[3] != null) {
      var month = Number(m[2]);
      var day = Number(m[3]);
      var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (day < 1 || day > days[month - 1]) return '';
    }
    return s;
  }
  function citationKeyBase(paper) {
    var authors = paper && Array.isArray(paper.authors) ? paper.authors : [];
    var first = text(authors[0]).trim();
    var family = first ? (first.indexOf(',') !== -1 ? first.split(',')[0].trim() : first.split(/\s+/).pop()) : 'anon';
    // 自动 key 必须是 LaTeX/BibTeX 安全的 ASCII。中文姓名通过本地 vendored pinyin-pro
    // 转为无声调拼音；既有导入 key 与用户手动钉住的 key 不走这里，保持原值和稳定性。
    var romanized = family;
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(romanized) && pinyinPro && typeof pinyinPro.pinyin === 'function') {
      romanized = pinyinPro.pinyin(romanized, { toneType: 'none', mode: 'surname', separator: '' });
    }
    var normalized = romanized.normalize ? romanized.normalize('NFKD') : romanized;
    normalized = normalized.replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
    var year = finiteNumber(paper && paper.year);
    return (normalized || 'anon') + (year != null && year >= 1000 && year <= 3000 ? Math.trunc(year) : 'nodate');
  }
  /**
   * citekey 分配（v8 起）：
   * 1) keyPinned 的条目优先保留自己的 key；
   * 2) 其余已有非空 key（如导入的 bibkey）原样保留；
   * 3) 只有空 key 或与他人冲突时才按 姓氏+年份 生成，冲突加 a/b/… 后缀。
   * 这样 key 在编辑、同步、重导入之间保持稳定（LaTeX/Overleaf 工作流的前提）。
   */
  function assignCitationKeys(papers) {
    var list = Array.isArray(papers) ? papers : [];
    var used = {};
    var reserved = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    list.forEach(function (paper) {
      var key = text(paper && paper.key).trim();
      if (paper && paper.keyPinned && key && !used[key.toLowerCase()]) {
        paper.key = key;
        used[key.toLowerCase()] = true;
        if (reserved) reserved.add(paper);
      }
    });
    list.forEach(function (paper) {
      if (reserved && reserved.has(paper)) return; // 第一趟已保留
      var existing = text(paper && paper.key).trim();
      if (existing && !used[existing.toLowerCase()]) {
        paper.key = existing;
        used[existing.toLowerCase()] = true;
        return;
      }
      var base = citationKeyBase(paper);
      var key = base;
      var suffix = 0;
      while (used[key.toLowerCase()]) {
        suffix++;
        key = base + (suffix <= 26 ? String.fromCharCode(96 + suffix) : suffix);
      }
      paper.key = key;
      used[key.toLowerCase()] = true;
    });
    return papers;
  }
  function cleanRankText(value) {
    var result = text(value).trim();
    if (!result || /^(?:-|—|0|false|no|none|null|undefined|否|无)$/i.test(result) ||
        /(?:未收录|不收录|暂无|无数据|not\s*(?:indexed|found|available))/i.test(result)) return '';
    return result;
  }
  function positiveRankFlag(value, label) {
    if (value === true || Number(value) === 1) return label;
    var result = cleanRankText(value);
    if (!result || /(?:not\s*(?:top|core)|非\s*(?:top|北核|核心)|不是|不属于|未入选|未收录|不收录)/i.test(result)) return '';
    if (/^(?:true|yes|y|是|入选|收录)$/i.test(result)) return label;
    if (label === 'Top' && /top/i.test(result)) return 'Top';
    if (label === '北核' && /(?:北核|北大核心|中文核心)/i.test(result)) return '北核';
    return '';
  }
  function normalizeJournalRank(value) {
    if (!value || typeof value !== 'object') return null;
    var imf = finiteNumber(value.imf);
    var rank = {
      abbr: text(value.abbr), jcr: cleanRankText(value.jcr), cas: cleanRankText(value.cas), casTop: cleanRankText(value.casTop),
      xr: cleanRankText(value.xr), xrTop: positiveRankFlag(value.xrTop, 'Top'), beihe: positiveRankFlag(value.beihe, '北核'),
      imf: imf != null && imf > 0 ? imf : null, jci: finiteNumber(value.jci), updatedAt: finiteNumber(value.updatedAt)
    };
    return rank.abbr || rank.jcr || rank.cas || rank.casTop || rank.xr || rank.xrTop || rank.beihe || rank.imf != null || rank.jci != null ? rank : null;
  }
  function normalizePdfAnnotations(value) {
    if (!Array.isArray(value)) return [];
    var seen = {};
    var VALID_TYPES = { highlight: true, underline: true, note: true, snapshot: true, ink: true };
    return value.map(function (raw) {
      var item = raw && typeof raw === 'object' ? raw : {};
      var id = validId(item.id);
      if (!id || seen[id]) return null;
      var type = VALID_TYPES[item.type] ? item.type : 'highlight';
      var color = /^#[0-9a-f]{6}$/i.test(text(item.color)) ? text(item.color).toLowerCase() : '#ffd400';
      var position = item.position && typeof item.position === 'object' ? item.position : {};
      var pageIndex = finiteNumber(position.pageIndex);
      // EPUB CFI / 网页文本锚点（v12 预留，阶段六才产生数据）
      var cfi = text(position.cfi).slice(0, 2000);
      var anchor = null;
      if (position.textAnchor && typeof position.textAnchor === 'object') {
        var anchorExact = text(position.textAnchor.exact).slice(0, 2000);
        if (anchorExact) {
          anchor = {
            exact: anchorExact,
            prefix: text(position.textAnchor.prefix).slice(0, 500),
            suffix: text(position.textAnchor.suffix).slice(0, 500)
          };
        }
      }
      var hasNonPdfAnchor = !!(cfi || anchor);
      if ((pageIndex == null || pageIndex < 0) && !hasNonPdfAnchor) return null;
      var rects = Array.isArray(position.rects) ? position.rects.slice(0, 500).map(function (rect) {
        if (!Array.isArray(rect) || rect.length !== 4) return null;
        var values = rect.map(finiteNumber);
        if (values.some(function (n) { return n == null || Math.abs(n) > 100000; })) return null;
        return [Math.min(values[0], values[2]), Math.min(values[1], values[3]),
          Math.max(values[0], values[2]), Math.max(values[1], values[3])];
      }).filter(Boolean) : [];
      // 手写轨迹：position.points 为 PDF 坐标点列，rects 由轨迹包围盒派生
      var points = [];
      if (type === 'ink') {
        points = (Array.isArray(position.points) ? position.points : []).slice(0, 8000).map(function (pair) {
          if (!Array.isArray(pair) || pair.length !== 2) return null;
          var x = finiteNumber(pair[0]), y = finiteNumber(pair[1]);
          return x == null || y == null || Math.abs(x) > 100000 || Math.abs(y) > 100000 ? null : [x, y];
        }).filter(Boolean);
        if (!points.length) return null;
        if (!rects.length) {
          var xs = points.map(function (p) { return p[0]; }), ys = points.map(function (p) { return p[1]; });
          rects = [[Math.min.apply(null, xs), Math.min.apply(null, ys),
            Math.max.apply(null, xs), Math.max.apply(null, ys)]];
        }
      } else if (!rects.length && !hasNonPdfAnchor) return null;
      var createdAt = finiteNumber(item.createdAt) || Date.now();
      seen[id] = true;
      var normalized = {
        id: id,
        type: type,
        color: color,
        attachmentId: validId(item.attachmentId),
        tags: cleanTags(item.tags),
        text: text(item.text).slice(0, 12000),
        comment: text(item.comment).slice(0, 50000),
        position: {
          pageIndex: pageIndex != null && pageIndex >= 0 ? Math.trunc(pageIndex) : null,
          rects: rects
        },
        createdAt: createdAt,
        updatedAt: finiteNumber(item.updatedAt) || createdAt
      };
      if (cfi) normalized.position.cfi = cfi;
      if (anchor) normalized.position.textAnchor = anchor;
      if (type === 'ink') normalized.position.points = points;
      var annotationSourceLibraryId = sourceLibraryId(item.sourceLibraryId || item.libraryId);
      var annotationZoteroKey = validId(item.zoteroKey);
      if (annotationSourceLibraryId) normalized.sourceLibraryId = annotationSourceLibraryId;
      if (annotationZoteroKey) normalized.zoteroKey = annotationZoteroKey;
      if (type === 'snapshot') {
        normalized.imagePath = text(item.imagePath).slice(0, 500);
        var annotationCloudName = text(item.cloudName).trim();
        normalized.cloudName = annotationCloudName && annotationCloudName.length <= 200 &&
          !/[?#]/.test(annotationCloudName) && annotationCloudName.indexOf('..') === -1
          ? annotationCloudName : '';
        var annotationCloudHash = text(item.cloudHash).trim().toLowerCase();
        normalized.cloudHash = /^[a-f0-9]{64}$/.test(annotationCloudHash) ? annotationCloudHash : '';
        var annotationCloudSize = finiteNumber(item.cloudSize);
        normalized.cloudSize = annotationCloudSize != null && annotationCloudSize >= 0
          ? Math.trunc(annotationCloudSize) : null;
      }
      if (item.sourceStatus === 'unresolved' || item.pendingAssociation === true) normalized.sourceStatus = 'unresolved';
      return normalized;
    }).filter(Boolean).sort(function (a, b) {
      var pageA = a.position.pageIndex == null ? -1 : a.position.pageIndex;
      var pageB = b.position.pageIndex == null ? -1 : b.position.pageIndex;
      return pageA - pageB || a.createdAt - b.createdAt;
    });
  }
  function fallbackId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'p' + crypto.randomUUID().replace(/-/g, '');
    return 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  function fallbackNoteId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'n' + crypto.randomUUID().replace(/-/g, '');
    return 'n' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function attachmentKindForFile(name) {
    var n = text(name).toLowerCase();
    if (/\.pdf$/.test(n)) return 'pdf';
    if (/\.epub$/.test(n)) return 'epub';
    return '';
  }

  function normalizeAttachment(value, idFactory) {
    var a = value && typeof value === 'object' ? value : {};
    var fileName = text(a.fileName).trim();
    var path = text(a.path);
    var cloudName = text(a.cloudName).trim();
    if (!fileName && !path && !cloudName) return null;
    var kind = VALID_ATTACHMENT_KINDS[a.kind] ? a.kind : (attachmentKindForFile(fileName || path || cloudName) || 'other');
    return {
      id: validId(a.id) || (idFactory || fallbackId)(),
      kind: kind,
      fileName: fileName,
      path: path,
      fingerprint: /^[a-f0-9]{64}$/i.test(text(a.fingerprint)) ? text(a.fingerprint).toLowerCase() : '',
      cloudName: cloudName && cloudName.length <= 200 && !/[?#]/.test(cloudName) && cloudName.indexOf('..') === -1 ? cloudName : '',
      syncSignature: text(a.syncSignature),
      sourceLibraryId: sourceLibraryId(a.sourceLibraryId || a.libraryId),
      zoteroKey: validId(a.zoteroKey),
      cloudHash: /^[a-f0-9]{64}$/i.test(text(a.cloudHash)) ? text(a.cloudHash).toLowerCase() : '',
      cloudSize: (function () {
        var size = finiteNumber(a.cloudSize);
        return size != null && size >= 0 ? Math.trunc(size) : null;
      })(),
      addedAt: timestampOrNull(a.addedAt) || Date.now()
    };
  }

  function normalizePaper(raw, idFactory) {
    var p = raw && typeof raw === 'object' ? raw : {};
    var year = finiteNumber(p.year);
    var citations = finiteNumber(p.citations);
    var rating = finiteNumber(p.rating);
    var id = validId(p.id) || (idFactory || fallbackId)();
    var pdfCloudName = text(p.pdfCloudName);
    var paperSourceLibraryId = sourceLibraryId(p.sourceLibraryId || p.libraryId || (p.source && p.source.libraryId));
    var added = timestampOrNull(p.addedAt) || Date.now();

    // 多附件（v8）：旧版单 PDF 字段自动迁移为主 PDF 附件
    var attachments = [], seenAttachments = {};
    (Array.isArray(p.attachments) ? p.attachments : []).forEach(function (rawAtt) {
      var att = normalizeAttachment(rawAtt, idFactory);
      if (!att || seenAttachments[att.id]) return;
      if (!att.sourceLibraryId && paperSourceLibraryId) att.sourceLibraryId = paperSourceLibraryId;
      seenAttachments[att.id] = true;
      attachments.push(att);
    });
    var legacyFingerprint = /^[a-f0-9]{64}$/i.test(text(p.pdfFingerprint)) ? text(p.pdfFingerprint).toLowerCase() : '';
    var hasLegacyPdf = text(p.pdfPath) || text(p.pdfFileName) || legacyFingerprint || pdfCloudName;
    if (hasLegacyPdf && !attachments.some(function (att) { return att.kind === 'pdf'; })) {
      attachments.unshift({
        id: (idFactory || fallbackId)(),
        kind: 'pdf',
        fileName: text(p.pdfFileName),
        path: text(p.pdfPath),
        fingerprint: legacyFingerprint,
        cloudName: validId(pdfCloudName.replace(/\.pdf$/i, '')) ? pdfCloudName : '',
        syncSignature: text(p.pdfSyncSignature),
        sourceLibraryId: paperSourceLibraryId,
        addedAt: added
      });
    }
    // 主 PDF 附件回填旧字段，既有 UI / 查重 / 同步代码零改动继续工作
    var primary = null;
    for (var ai = 0; ai < attachments.length; ai++) {
      if (attachments[ai].kind === 'pdf') { primary = attachments[ai]; break; }
    }

    // 结构化创作者（v12）：creators 权威，authors 投影；仅有旧 authors 时解析回填
    var creators = normalizeCreators(p.creators);
    if (!creators.length) creators = normalizeCreators(p.authors);
    var authors = creators.length ? authorsFromCreators(creators) : stringList(p.authors);
    // 完整出版日期（v12）：date 权威，year 投影；仅有旧 year 时反投影 date
    var date = normalizeDate(p.date);
    if (date) year = Number(date.slice(0, 4));
    else if (year != null && year >= 1000 && year <= 3000) date = String(Math.trunc(year));
    // 批注附件关联（v12）：无 attachmentId 的旧批注回填主 PDF 附件；无附件则留空保留
    var annotations = normalizePdfAnnotations(p.pdfAnnotations);
    annotations.forEach(function (ann) {
      if (!ann.sourceLibraryId && paperSourceLibraryId) ann.sourceLibraryId = paperSourceLibraryId;
    });
    if (primary) {
      annotations.forEach(function (ann) { if (!ann.attachmentId) ann.attachmentId = primary.id; });
    }

    var entryType = text(p.entryType || 'article').trim().toLowerCase();
    var knownEntryType = !!VALID_ENTRY_TYPES[entryType];
    return {
      id: id,
      key: text(p.key),
      keyPinned: p.keyPinned === true,
      entryType: knownEntryType ? entryType : 'misc',
      sourceType: knownEntryType ? text(p.sourceType).trim().slice(0, 80) : (text(p.sourceType).trim() || entryType).slice(0, 80),
      originalType: text(p.originalType || p.cslType).trim().slice(0, 120),
      bibtexFlavor: p.bibtexFlavor === 'biblatex' ? 'biblatex' : 'bibtex',
      title: text(p.title).trim() || '(无标题)',
      creators: creators,
      authors: authors,
      date: date,
      accessDate: normalizeDate(p.accessDate),
      year: year != null && year >= 1000 && year <= 3000 ? Math.trunc(year) : null,
      venue: cleanVenue(p.venue),
      volume: text(p.volume),
      issue: text(p.issue),
      pages: text(p.pages),
      publisher: text(p.publisher),
      place: text(p.place).trim(),
      series: text(p.series).trim(),
      journalAbbreviation: text(p.journalAbbreviation).trim(),
      issn: text(p.issn),
      isbn: text(p.isbn),
      edition: text(p.edition),
      language: text(p.language),
      bibtexExtra: stringMap(p.bibtexExtra),
      doi: text(p.doi).replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '').trim(),
      url: safeUrl(p.url),
      abstract: text(p.abstract),
      citations: citations != null && citations >= 0 ? Math.trunc(citations) : null,
      citationSource: text(p.citationSource),
      citationUpdatedAt: text(p.citationUpdatedAt),
      oaUrl: safeUrl(p.oaUrl),
      openalexId: safeUrl(p.openalexId),
      pdfFileName: primary ? primary.fileName : '',
      pdfPath: primary ? primary.path : '',
      pdfFingerprint: primary ? primary.fingerprint : '',
      pdfCloudName: primary ? primary.cloudName : '',
      pdfSyncSignature: primary ? primary.syncSignature : '',
      attachments: attachments,
      sourceLibraryId: paperSourceLibraryId,
      sourceMeta: normalizeSourceMeta(p.sourceMeta || p.source),
      zoteroKey: validId(p.zoteroKey),
      zoteroAttachmentKey: validId(p.zoteroAttachmentKey),
      folderIds: stringList(p.folderIds).filter(function (fid) { return !!validId(fid); }),
      relatedIds: stringList(p.relatedIds).filter(function (rid) { return !!validId(rid) && rid !== id; }),
      // M9 二期：与调研库身份的关联（'W…' / 'local:…'），随工作区同步/备份走（加法式变更，旧端忽略未知字段）。
      // local: 前缀是调研库本地身份的既定格式（见 electron/research-db.js），放行冒号。
      researchIds: stringList(p.researchIds).filter(function (rid) {
        return !!validId(rid) || /^local:[A-Za-z0-9_-]{1,100}$/.test(rid);
      }).slice(0, 20),
      tags: cleanTags(p.tags),
      status: VALID_STATUS[p.status] ? p.status : 'unread',
      rating: rating != null ? Math.max(0, Math.min(5, Math.trunc(rating))) : 0,
      notes: text(p.notes),
      pdfAnnotations: annotations,
      journalRank: normalizeJournalRank(p.journalRank),
      journalRankCheckedAt: finiteNumber(p.journalRankCheckedAt),
      addedAt: added,
      updatedAt: timestampOrNull(p.updatedAt) || added,
      lastReadAt: timestampOrNull(p.lastReadAt),
      deletedAt: timestampOrNull(p.deletedAt)
    };
  }

  /** 就地刷新条目的修改时间（LWW 同步与增量存储依赖该时间戳） */
  function touch(paper) {
    if (paper && typeof paper === 'object') paper.updatedAt = Date.now();
    return paper;
  }

  function normalizeLibrary(value, idFactory) {
    var list = Array.isArray(value) ? value : (value && Array.isArray(value.papers) ? value.papers : []);
    var seenIds = {};
    var papers = list.map(function (raw) {
      var paper = normalizePaper(raw, idFactory);
      if (seenIds[paper.id]) paper.id = (idFactory || fallbackId)();
      seenIds[paper.id] = true;
      return paper;
    });
    return assignCitationKeys(papers);
  }

  function normalizeFolders(value) {
    var list = Array.isArray(value) ? value : [];
    var seen = {}, result = list.map(function (raw, index) {
      var folder = raw && typeof raw === 'object' ? raw : {};
      var id = validId(folder.id);
      var name = text(folder.name).trim().slice(0, 80);
      if (!id || !name || seen[id]) return null;
      seen[id] = true;
      var parentId = validId(folder.parentId);
      var sortIndex = Number(folder.sortIndex);
      if (!isFinite(sortIndex) || sortIndex < 0) sortIndex = index;
      return {
        id: id,
        name: name,
        parentId: parentId && parentId !== id ? parentId : '',
        sortIndex: sortIndex,
        updatedAt: timestampOrNull(folder.updatedAt) || Date.now(),
        deletedAt: timestampOrNull(folder.deletedAt)
      };
    }).filter(Boolean);
    var byId = {};
    result.forEach(function (folder) { byId[folder.id] = folder; });
    result.forEach(function (folder) { if (folder.parentId && !byId[folder.parentId]) folder.parentId = ''; });
    result.forEach(function (folder) {
      var visited = {}, current = folder;
      while (current && current.parentId) {
        if (visited[current.id]) { folder.parentId = ''; break; }
        visited[current.id] = true;
        current = byId[current.parentId];
      }
    });
    return result;
  }

  function normalizeSavedSearch(value, idFactory) {
    var s = value && typeof value === 'object' ? value : {};
    var name = text(s.name).trim().slice(0, 80);
    var query = text(s.query).trim().slice(0, 500);
    if (!name || !query) return null;
    var sortIndex = Number(s.sortIndex);
    return {
      id: validId(s.id) || (idFactory || fallbackId)(),
      name: name,
      query: query,
      ast: text(s.ast).slice(0, 20000), // 阶段四：版本化 AST 序列化（旧记录为空 → 运行时按 query 解析，自动迁移）
      sortIndex: isFinite(sortIndex) && sortIndex >= 0 ? Math.trunc(sortIndex) : 0,
      updatedAt: timestampOrNull(s.updatedAt) || Date.now(),
      deletedAt: timestampOrNull(s.deletedAt)
    };
  }
  function normalizeSavedSearches(value, idFactory) {
    var list = Array.isArray(value) ? value : [];
    var seen = {};
    return list.map(function (raw, index) {
      var search = normalizeSavedSearch(raw, idFactory);
      if (!search || seen[search.id]) return null;
      seen[search.id] = true;
      if (!raw || typeof raw !== 'object' || !isFinite(Number(raw.sortIndex)) || Number(raw.sortIndex) < 0) search.sortIndex = index;
      return search;
    }).filter(Boolean);
  }

  /* ---- 独立笔记实体（v12）：顶层同步集合，可挂文献（paperId）或作主题笔记（paperId=''） ---- */
  function normalizeNoteAsset(value) {
    var a = value && typeof value === 'object' ? value : {};
    var fileName = text(a.fileName).trim().slice(0, 200);
    var path = text(a.path).slice(0, 500);
    var cloudName = text(a.cloudName).trim();
    if (!fileName && !path && !cloudName) return null;
    var cloudHash = text(a.cloudHash).trim().toLowerCase();
    var size = finiteNumber(a.cloudSize);
    return {
      fileName: fileName,
      path: path,
      cloudName: cloudName && cloudName.length <= 200 && !/[?#]/.test(cloudName) && cloudName.indexOf('..') === -1 ? cloudName : '',
      cloudHash: /^[a-f0-9]{64}$/.test(cloudHash) ? cloudHash : '',
      cloudSize: size != null && size >= 0 ? Math.trunc(size) : null,
      addedAt: timestampOrNull(a.addedAt) || Date.now()
    };
  }
  function normalizeNote(value, idFactory) {
    var n = value && typeof value === 'object' ? value : {};
    var createdAt = timestampOrNull(n.createdAt) || Date.now();
    var assets = [], seenAssets = {};
    (Array.isArray(n.assets) ? n.assets : []).slice(0, 200).forEach(function (rawAsset) {
      var asset = normalizeNoteAsset(rawAsset);
      if (!asset) return;
      var key = asset.path || asset.cloudName || asset.fileName;
      if (seenAssets[key]) return;
      seenAssets[key] = true;
      assets.push(asset);
    });
    return {
      id: validId(n.id) || (idFactory || fallbackNoteId)(),
      paperId: validId(n.paperId),
      sourceLibraryId: sourceLibraryId(n.sourceLibraryId || n.libraryId),
      zoteroKey: validId(n.zoteroKey),
      title: text(n.title).trim().slice(0, 300),
      content: text(n.content).slice(0, 200000),
      format: VALID_NOTE_FORMATS[n.format] ? n.format : 'markdown',
      sourceMarkdown: text(n.sourceMarkdown).slice(0, 200000), // 旧 Markdown 原文（单向迁移后留存，导出用）
      sourceHtml: text(n.sourceHtml).slice(0, 500000),
      sourceMeta: normalizeSourceMeta(n.sourceMeta || n.source),
      assets: assets,
      createdAt: createdAt,
      updatedAt: timestampOrNull(n.updatedAt) || createdAt,
      deletedAt: timestampOrNull(n.deletedAt)
    };
  }
  function normalizeNotes(value, idFactory) {
    var list = Array.isArray(value) ? value : [];
    var seen = {};
    return list.map(function (raw) {
      var note = normalizeNote(raw, idFactory);
      if (seen[note.id]) return null;
      seen[note.id] = true;
      return note;
    }).filter(Boolean);
  }
  /** 旧 paper.notes 纯文本 → Note 实体（确定性 id 保证幂等；已有该文献笔记时仅清除旧字段） */
  function legacyNoteId(paperId) {
    return 'nlegacy_' + text(paperId).slice(0, 100);
  }
  function migrateLegacyPaperNotes(papers, notes) {
    var byPaper = {};
    (notes || []).forEach(function (note) {
      if (note.paperId) byPaper[note.paperId] = true;
    });
    (papers || []).forEach(function (paper) {
      var content = text(paper.notes);
      if (!content.trim()) return;
      if (byPaper[paper.id]) {
        // 笔记集合是权威：该文献已有笔记（含墓碑）时，旧字段只是过期投影，直接清除
        paper.notes = '';
        return;
      }
      byPaper[paper.id] = true;
      notes.push({
        id: legacyNoteId(paper.id),
        paperId: paper.id,
        title: '',
        content: content.slice(0, 200000),
        format: 'markdown',
        createdAt: paper.addedAt,
        updatedAt: paper.updatedAt,
        deletedAt: null
      });
      paper.notes = '';
    });
  }
  /** paper.notes 兼容投影 = 该文献首条未删除笔记的 content（供搜索/导出/角标等旧消费方使用） */
  function projectPaperNotes(papers, notes) {
    var firstByPaper = {};
    (notes || []).filter(function (note) { return !note.deletedAt && note.paperId; })
      .sort(function (a, b) { return a.createdAt - b.createdAt; })
      .forEach(function (note) {
        if (!firstByPaper[note.paperId]) firstByPaper[note.paperId] = note;
      });
    (papers || []).forEach(function (paper) {
      var note = firstByPaper[paper.id];
      paper.notes = note ? note.content : '';
    });
  }

  function normalizeTagColors(value) {
    var out = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    Object.keys(value).forEach(function (tag) {
      var name = text(tag).trim();
      var color = text(value[tag]);
      if (name && /^#[0-9a-f]{6}$/i.test(color)) out[name] = color.toLowerCase();
    });
    return out;
  }

  function normalizeTagColorRecord(value) {
    var record = value && typeof value === 'object' ? value : {};
    var tag = text(record.tag).trim();
    var color = text(record.color);
    var deletedAt = timestampOrNull(record.deletedAt);
    if (!tag || (!deletedAt && !/^#[0-9a-f]{6}$/i.test(color))) return null;
    return {
      tag: tag,
      color: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '',
      updatedAt: timestampOrNull(record.updatedAt) || Date.now(),
      deletedAt: deletedAt
    };
  }

  function normalizeTagColorRecords(value, legacyColors) {
    var records = Array.isArray(value) ? value : [];
    var seen = {}, result = [];
    records.forEach(function (raw) {
      var record = normalizeTagColorRecord(raw);
      if (!record || seen[record.tag]) return;
      seen[record.tag] = true;
      result.push(record);
    });
    var colors = normalizeTagColors(legacyColors);
    Object.keys(colors).forEach(function (tag) {
      if (seen[tag]) return;
      seen[tag] = true;
      result.push({ tag: tag, color: colors[tag], updatedAt: 1, deletedAt: null });
    });
    return result;
  }

  function tagColorsFromRecords(records) {
    var colors = {};
    (records || []).forEach(function (record) {
      if (!record.deletedAt && record.color) colors[record.tag] = record.color;
    });
    return colors;
  }

  /** 批注内容指纹：页码 + 取整矩形 + 文本前缀。用于识别「数据库批注 vs PDF 内嵌批注」重复。 */
  function annotationFingerprint(ann) {
    if (!ann || typeof ann !== 'object') return '';
    var position = ann.position && typeof ann.position === 'object' ? ann.position : {};
    // EPUB 锚点（CFI）：无 pageIndex/rects，用 cfi+文本定位，避免全部指纹相同
    if (position.pageIndex == null && !Array.isArray(position.rects) && text(position.cfi)) {
      return [ann.type || '', 'cfi', text(position.cfi).slice(0, 200), text(ann.text).slice(0, 64)].join('|');
    }
    var page = position.pageIndex == null ? '' : String(position.pageIndex);
    var rects = (Array.isArray(position.rects) ? position.rects : []).map(function (rect) {
      return (Array.isArray(rect) ? rect : []).map(function (n) { return Math.round(Number(n) || 0); }).join(',');
    }).join(';');
    return [ann.type || '', page, rects, text(ann.text).slice(0, 64)].join('|');
  }
  /** 同指纹去重（保留先出现者），供 PDF 打开合并路径使用 */
  function dedupeAnnotations(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    return list.filter(function (ann) {
      var fp = annotationFingerprint(ann);
      if (fp && seen[fp]) return false;
      if (fp) seen[fp] = true;
      return true;
    });
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    var out = {};
    Object.keys(value).sort().forEach(function (key) {
      out[key] = stableValue(value[key]);
    });
    return out;
  }

  function entitySignature(entity) {
    var content = {};
    Object.keys(entity || {}).forEach(function (key) {
      // lastReadAt 是高频阅读统计字段：参与存储与同步，但不作为「内容变化」触发脏写
      if (key !== 'updatedAt' && key !== 'addedAt' && key !== 'lastReadAt') content[key] = entity[key];
    });
    return JSON.stringify(stableValue(content));
  }

  function signatureMap(list, keyOf) {
    var signatures = {};
    (list || []).forEach(function (item) {
      signatures[keyOf(item)] = entitySignature(item);
    });
    return signatures;
  }

  function workspaceSignatures(workspace) {
    var value = workspace && typeof workspace === 'object' ? workspace : {};
    return {
      papers: signatureMap(value.papers, function (paper) { return paper.id; }),
      notes: signatureMap(value.notes, function (note) { return note.id; }),
      folders: signatureMap(value.folders, function (folder) { return folder.id; }),
      savedSearches: signatureMap(value.savedSearches, function (search) { return search.id; }),
      tagColorRecords: signatureMap(value.tagColorRecords, function (record) { return record.tag; })
    };
  }

  function touchChangedList(list, previous, keyOf, now) {
    (list || []).forEach(function (item) {
      var key = keyOf(item);
      if (!previous || previous[key] !== entitySignature(item)) item.updatedAt = now;
    });
  }

  function touchWorkspaceChanges(workspace, previousSignatures, now) {
    if (!workspace || typeof workspace !== 'object') return workspace;
    var previous = previousSignatures && typeof previousSignatures === 'object' ? previousSignatures : {};
    var timestamp = timestampOrNull(now) || Date.now();
    touchChangedList(workspace.papers, previous.papers, function (paper) { return paper.id; }, timestamp);
    touchChangedList(workspace.notes, previous.notes, function (note) { return note.id; }, timestamp);
    touchChangedList(workspace.folders, previous.folders, function (folder) { return folder.id; }, timestamp);
    touchChangedList(workspace.savedSearches, previous.savedSearches, function (search) { return search.id; }, timestamp);
    touchChangedList(workspace.tagColorRecords, previous.tagColorRecords, function (record) { return record.tag; }, timestamp);
    return workspace;
  }

  function normalizeWorkspace(value, idFactory) {
    var folders = normalizeFolders(value && value.folders);
    var folderSet = {};
    folders.forEach(function (folder) { if (!folder.deletedAt) folderSet[folder.id] = true; });
    var papers = normalizeLibrary(value, idFactory);
    papers.forEach(function (paper) {
      paper.folderIds = paper.folderIds.filter(function (id) { return !!folderSet[id]; });
      paper.relatedIds = paper.relatedIds.filter(function (rid) { return rid !== paper.id; });
    });
    var notes = normalizeNotes(value && value.notes, idFactory);
    migrateLegacyPaperNotes(papers, notes);
    projectPaperNotes(papers, notes);
    var tagColorRecords = normalizeTagColorRecords(value && value.tagColorRecords, value && value.tagColors);
    return {
      papers: papers,
      notes: notes,
      folders: folders,
      savedSearches: normalizeSavedSearches(value && value.savedSearches, idFactory),
      tagColors: tagColorsFromRecords(tagColorRecords),
      tagColorRecords: tagColorRecords
    };
  }

  function envelope(papers, folders, extra) {
    var more = extra && typeof extra === 'object' ? extra : {};
    var tagColorRecords = normalizeTagColorRecords(more.tagColorRecords, more.tagColors);
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      papers: normalizeLibrary(papers),
      notes: normalizeNotes(more.notes),
      folders: normalizeFolders(folders),
      savedSearches: normalizeSavedSearches(more.savedSearches),
      tagColors: tagColorsFromRecords(tagColorRecords),
      tagColorRecords: tagColorRecords
    };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    VALID_ENTRY_TYPES: VALID_ENTRY_TYPES,
    VALID_NOTE_FORMATS: VALID_NOTE_FORMATS,
    normalizePaper: normalizePaper,
    normalizeAttachment: normalizeAttachment,
    attachmentKindForFile: attachmentKindForFile,
    normalizeSourceMeta: normalizeSourceMeta,
    sourceLibraryId: sourceLibraryId,
    normalizeCreators: normalizeCreators,
    parseCreatorName: parseCreatorName,
    authorsFromCreators: authorsFromCreators,
    normalizeDate: normalizeDate,
    normalizeNote: normalizeNote,
    normalizeNotes: normalizeNotes,
    citationKeyBase: citationKeyBase,
    assignCitationKeys: assignCitationKeys,
    normalizeJournalRank: normalizeJournalRank,
    normalizeLibrary: normalizeLibrary,
    normalizePdfAnnotations: normalizePdfAnnotations,
    annotationFingerprint: annotationFingerprint,
    dedupeAnnotations: dedupeAnnotations,
    cleanTags: cleanTags,
    isNoiseTag: isNoiseTag,
    normalizeFolders: normalizeFolders,
    normalizeSavedSearch: normalizeSavedSearch,
    normalizeSavedSearches: normalizeSavedSearches,
    normalizeTagColors: normalizeTagColors,
    tagColorsFromRecords: tagColorsFromRecords,
    normalizeTagColorRecord: normalizeTagColorRecord,
    normalizeTagColorRecords: normalizeTagColorRecords,
    normalizeWorkspace: normalizeWorkspace,
    entitySignature: entitySignature,
    workspaceSignatures: workspaceSignatures,
    touchWorkspaceChanges: touchWorkspaceChanges,
    touch: touch,
    envelope: envelope
  };
});
