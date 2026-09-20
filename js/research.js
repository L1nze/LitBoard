/* LitBoard 调研库纯函数层：OpenAlex 规范化、Windows 文件名消毒、身份合并、会话文档（浏览器 / Node 共用）
 *
 * 约定：
 * - 调研行（work row）是调研库的唯一内容形态：id 为代理身份（'W…' 外部 / 'local:<hex>' 本地），
 *   DOI / OpenAlex ID 等外部标识一律进 ext_ids 索引，身份本身永不变更（合并只并外部标识）；
 * - 本模块零 IO、零依赖，全部可被 node:test 直接覆盖；
 * - 消毒函数面向 Windows：非法字符、保留名（CON/PRN/…）、结尾点与空格、长度上限都要处理，
 *   否则会话目录在真实磁盘上落不了盘。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitResearch = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* ---------------- OpenAlex 规范化 ---------------- */

  // OpenAlex 各实体的短 ID 形态：W(works)/S(sources)/I(institutions)/A(authors)/C(concepts)/P(publishers)/F(funders)
  var OPENALEX_ID_RE = /^[WSIACPF]\d+$/i;

  /** 'https://openalex.org/W123' → 'W123'；已是的原样返回；空返回 '' */
  function shortWorkId(value) {
    var s = String(value == null ? '' : value).trim();
    if (!s) return '';
    var at = s.lastIndexOf('/');
    if (at >= 0 && OPENALEX_ID_RE.test(s.slice(at + 1))) return s.slice(at + 1).toUpperCase();
    if (OPENALEX_ID_RE.test(s)) return s.toUpperCase();
    return s;
  }

  /** 'https://doi.org/10.1234/abc' → '10.1234/abc'（小写、去前缀） */
  function normalizeDoi(value) {
    var s = String(value == null ? '' : value).trim();
    if (!s) return '';
    s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '');
    return s.toLowerCase();
  }

  /** OpenAlex 摘要倒排索引 → 正文（按位置重组；位置空洞留空位再压缩空白） */
  function abstractFromInvertedIndex(inverted) {
    if (!inverted || typeof inverted !== 'object' || Array.isArray(inverted)) return '';
    var slots = [];
    var max = -1;
    Object.keys(inverted).forEach(function (word) {
      var positions = inverted[word];
      if (!Array.isArray(positions)) return;
      positions.forEach(function (pos) {
        var p = Number(pos);
        if (!isFinite(p) || p < 0 || p > 20000) return;
        slots[p] = String(word);
        if (p > max) max = p;
      });
    });
    if (max < 0) return '';
    var out = [];
    for (var i = 0; i <= max; i++) out.push(slots[i] != null ? slots[i] : '');
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }

  function pickAuthors(authorships) {
    var list = Array.isArray(authorships) ? authorships : [];
    var out = [];
    for (var i = 0; i < list.length && out.length < 50; i++) {
      var a = list[i] || {};
      var name = '';
      if (typeof a.raw_author_name === 'string' && a.raw_author_name) name = a.raw_author_name;
      else if (a.author && typeof a.author.display_name === 'string') name = a.author.display_name;
      if (!name) continue;
      var entry = { name: name };
      if (a.author && typeof a.author.orcid === 'string' && a.author.orcid) {
        var orcid = a.author.orcid.replace(/^https?:\/\/orcid\.org\//i, '');
        if (orcid) entry.orcid = orcid;
      }
      out.push(entry);
    }
    return out;
  }

  /** OpenAlex work 对象 → 调研行（works 表的内容形态；幂等：同一输入恒同一行） */
  function normalizeOpenAlexWork(work) {
    var w = work && typeof work === 'object' ? work : {};
    var source = (w.primary_location && w.primary_location.source) || null;
    var oa = w.open_access || {};
    var row = {
      id: shortWorkId(w.id),
      doi: normalizeDoi(w.doi),
      title: String(w.title || w.display_name || '').trim(),
      year: Number(w.publication_year) || null,
      pubdate: String(w.publication_date || '').slice(0, 10),
      type: String(w.type || ''),
      sourceId: source ? shortWorkId(source.id) : '',
      sourceName: source && source.display_name ? String(source.display_name) : '',
      abstract: abstractFromInvertedIndex(w.abstract_inverted_index),
      lang: String(w.language || ''),
      citedBy: Number(w.cited_by_count) || 0,
      isOa: oa.is_oa === true,
      oaUrl: String(oa.oa_url || ''),
      authors: pickAuthors(w.authorships),
      refs: (Array.isArray(w.referenced_works) ? w.referenced_works : []).map(shortWorkId).filter(Boolean),
      concepts: (Array.isArray(w.concepts) ? w.concepts : []).slice(0, 10).map(function (c) {
        return String((c && c.display_name) || '');
      }).filter(Boolean),
      keywords: (Array.isArray(w.keywords) ? w.keywords : []).slice(0, 10).map(function (k) {
        return String((k && (k.display_name || k.keyword)) || '');
      }).filter(Boolean)
    };
    if (!row.id) row.id = '';
    return row;
  }

  /** 调研行 → 外部标识索引项（身份与 DOI 各一条；本地身份只有自己） */
  function extIdsForRow(row) {
    var out = [];
    if (row && row.id && row.id.indexOf('local:') !== 0) {
      out.push({ kind: 'openalex', value: row.id });
    }
    if (row && row.doi) out.push({ kind: 'doi', value: row.doi });
    if (row && row.s2Id) out.push({ kind: 's2', value: String(row.s2Id) });
    if (row && row.pageUrl) out.push({ kind: 'url', value: String(row.pageUrl) });
    return out;
  }

  /**
   * Semantic Scholar paper → 调研行（R16；字段语义比照 normalizeOpenAlexWork）。
   * 注意事项：
   * - s2Id 是 S2 自己的 paperId（哈希或 CorpusId:…），只作为 ext_id 溯源，**不当** workId——
   *   我们的身份是代理键（'W…' / 'local:…'），id 由调用方按 DOI→s2→local 顺序决定；
   * - publicationTypes 映射到我们认识的少量类型，认识不了就留空（不硬塞 'article'）；
   * - tldr 是上游机器生成的一句话摘要，不是论文摘要也不属于网页片段——
   *   放进 snippet（非摘要检索片段）以保证「缺摘要时仍有可检索文本」且不冒充 abstract。
   */
  function normalizeSemanticScholarPaper(paper) {
    var p = paper && typeof paper === 'object' ? paper : {};
    var ext = p.externalIds && typeof p.externalIds === 'object' ? p.externalIds : {};
    var oa = p.openAccessPdf && typeof p.openAccessPdf === 'object' ? p.openAccessPdf : {};
    var types = Array.isArray(p.publicationTypes) ? p.publicationTypes.map(function (t) {
      return String(t || '').toLowerCase();
    }) : [];
    var type = '';
    if (types.some(function (t) { return t.indexOf('journalarticle') !== -1 || t.indexOf('review') !== -1 || t.indexOf('conference') !== -1; })) type = 'article';
    else if (types.some(function (t) { return t.indexOf('book') !== -1; })) type = 'book';
    else if (types.some(function (t) { return t.indexOf('dataset') !== -1; })) type = 'dataset';
    var tldr = p.tldr && typeof p.tldr === 'object' && typeof p.tldr.text === 'string' ? p.tldr.text.trim() : '';
    var oaUrl = String(oa.url || '');
    var pageUrl = String(p.url || '');
    return {
      id: '',
      s2Id: String(p.paperId || ''),
      doi: normalizeDoi(ext.DOI || ''),
      title: String(p.title || '').trim(),
      year: Number(p.year) || null,
      pubdate: String(p.publicationDate || '').slice(0, 10),
      type: type,
      sourceId: '',
      sourceName: String(p.venue || ''),
      abstract: String(p.abstract || ''),
      snippet: tldr,
      pageUrl: /^https?:\/\//i.test(pageUrl) ? pageUrl : '',
      lang: '',
      citedBy: Number(p.citationCount) || 0,
      isOa: /^https?:\/\//i.test(oaUrl),
      oaUrl: /^https?:\/\//i.test(oaUrl) ? oaUrl : '',
      authors: (Array.isArray(p.authors) ? p.authors : []).map(function (a) {
        return { name: String((a && a.name) || '') };
      }).filter(function (a) { return a.name; }).slice(0, 50),
      refs: [],
      concepts: [],
      keywords: []
    };
  }

  /** 合并两组外部标识（去重，kind+value 为键）——身份合并时把被并方的标识并给保留方 */
  function mergeExtIdLists(a, b) {
    var seen = {};
    var out = [];
    (Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : []).forEach(function (item) {
      if (!item || !item.kind || !item.value) return;
      var key = item.kind + ':' + item.value;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ kind: item.kind, value: item.value });
    });
    return out;
  }

  /* ---------------- Windows 文件名 / 目录名消毒 ---------------- */

  var RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

  /**
   * 消毒为可安全落盘的文件名主干（不含扩展名）：
   * - 去非法字符 \ / : * ? " < > | 与控制字符；空白折叠为单空格；
   * - 基名（首个点之前）命中 Windows 保留名时加下划线后缀；
   * - 去结尾的点与空格（Windows 会静默剥掉它们，导致「看着存在却打不开」）；
   * - 超长截断（默认 50，调用方可放宽；截断点取字符边界，不做代理对切半）。
   */
  function sanitizeFileStem(value, maxLen) {
    var cap = Number(maxLen) || 50;
    var s = String(value == null ? '' : value);
    s = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    s = Array.from(s).slice(0, cap).join('');
    s = s.replace(/[\s.]+$/, '');
    if (!s) return '未命名';
    var base = s.split('.')[0];
    if (RESERVED_NAMES.test(base)) s = s + '_';
    return s;
  }

  /** 会话目录名：'<消毒标题> <两位序号>'（用户约定的布局，序号从 01 起） */
  function sessionDirName(title, seq) {
    var n = Math.max(1, Number(seq) || 1);
    return sanitizeFileStem(title, 50) + ' ' + String(n).padStart(2, '0');
  }

  /* ---------------- 会话文档 ---------------- */

  /** 首条用户消息 → 会话显示标题（截 ~20 字符，不消毒磁盘名——那由 sessionDirName 负责） */
  function sessionTitleFrom(text) {
    var s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!s) return '新会话';
    var chars = Array.from(s);
    return chars.length <= 20 ? s : chars.slice(0, 20).join('') + '…';
  }

  /** 工具结果落盘截断：字符串超限截断并标注（会话文件不能被一次检索结果撑爆） */
  function truncateForDisk(value, cap) {
    var limit = Number(cap) || 12000;
    var s = String(value == null ? '' : value);
    if (s.length <= limit) return s;
    return s.slice(0, limit) + '\n…[已截断，原长 ' + s.length + ' 字符]';
  }

  function mdEscape(s) {
    return String(s == null ? '' : s).replace(/([\\`*_[\]<>&])/g, '\\$1');
  }

  /** 会话对象 → 会话记录.md 全文（生成物，供直接阅读与归档；session.json 才是事实源） */
  function renderSessionMarkdown(session) {
    var s = session && typeof session === 'object' ? session : {};
    var lines = [];
    lines.push('# ' + mdEscape(s.title || '未命名会话'));
    lines.push('');
    lines.push('- 会话 ID：`' + String(s.id || '') + '`');
    lines.push('- 创建：' + String(s.createdAt || ''));
    lines.push('- 更新：' + String(s.updatedAt || ''));
    if (s.model) lines.push('- 模型：' + mdEscape(s.model));
    lines.push('');
    (Array.isArray(s.attachments) ? s.attachments : []).forEach(function (att) {
      if (!att || !att.file) return;
      lines.push('- 附件：`' + String(att.file) + '`' + (att.label ? '（' + mdEscape(att.label) + '）' : ''));
    });
    if ((s.attachments || []).length) lines.push('');
    lines.push('---');
    lines.push('');
    (Array.isArray(s.messages) ? s.messages : []).forEach(function (msg) {
      var role = msg && msg.role;
      if (role === 'user') {
        lines.push('## 🙋');
        lines.push('');
        lines.push(String(msg.content || ''));
        (Array.isArray(msg.images) ? msg.images : []).forEach(function (img) {
          if (img && img.ref) lines.push('');
          if (img && img.ref) lines.push('🖼️ `' + String(img.ref) + '`' + (img.label ? '（' + mdEscape(img.label) + '）' : ''));
        });
        lines.push('');
      } else if (role === 'assistant') {
        lines.push('## 🤖');
        lines.push('');
        if (msg.content) lines.push(String(msg.content));
        (Array.isArray(msg.toolCalls) ? msg.toolCalls : []).forEach(function (call) {
          if (!call || !call.name) return;
          lines.push('');
          lines.push('> 🔧 `' + mdEscape(call.name) + '`'
            + (call.status === 'error' ? '（失败）' : '')
            + (call.summary ? '：' + mdEscape(call.summary) : ''));
        });
        lines.push('');
      } else if (role === 'error') {
        lines.push('## ⚠️');
        lines.push('');
        lines.push(String(msg.content || ''));
        lines.push('');
      }
    });
    return lines.join('\n');
  }

  /** 会话对象瘦身校验：确保 JSON 可序列化、工具结果已截断（写盘前最后一道闸） */
  function sanitizeSessionForDisk(session, cap) {
    var s = JSON.parse(JSON.stringify(session && typeof session === 'object' ? session : {}));
    s.v = 1;
    if (!Array.isArray(s.messages)) s.messages = [];
    s.messages = s.messages.map(function (msg) {
      var m = msg || {};
      if (m.role === 'tool' || typeof m.content !== 'string') {
        m.content = typeof m.content === 'string' ? truncateForDisk(m.content, cap) : '';
      }
      // M9-5 多模态消息链：user 消息的图像**引用**随会话落盘（重启后可恢复）；
      // 只认 {type:'image', ref} 且拒绝 data: URL——内联 base64 一律剥掉，防会话文件膨胀
      if (Array.isArray(m.images) && m.images.length) {
        m.images = m.images.filter(function (img) {
          return img && typeof img === 'object' && img.type === 'image' &&
            typeof img.ref === 'string' && img.ref && img.ref.indexOf('data:') !== 0;
        }).slice(0, 8).map(function (img) {
          var out = { type: 'image', ref: String(img.ref) };
          if (img.label) out.label = String(img.label).slice(0, 200);
          return out;
        });
        if (!m.images.length) delete m.images;
      } else if (m.images) {
        delete m.images;
      }
      if (Array.isArray(m.toolCalls)) {
        m.toolCalls = m.toolCalls.map(function (call) {
          var c = call || {};
          if (c.result && typeof c.result === 'string') c.result = truncateForDisk(c.result, cap);
          return c;
        });
      }
      return m;
    });
    if (!Array.isArray(s.attachments)) s.attachments = [];
    return s;
  }

  /* ---------------- 嵌入（二期：调研库向量） ---------------- */

  // 嵌入配方版本：配方或模型变更必须 bump——旧版本向量视为缺失、全量重算。
  // 与上游 harness 的 EMBEDDING_VERSION 同语义（v2 = title + Abstract + Concepts + Keywords）。
  var EMBED_RECIPE = 2;

  /**
   * 嵌入文本配方（与上游 harness 已验证配方一致）：
   * title + Abstract + Concepts + Keywords，摘要截 2200 字符、总长截 3000。
   * 输入只取「代表内容本身」的字段——updatedAt 这类易变字段绝不参与（否则每次检索都重嵌）。
   */
  function embeddingText(row) {
    var r = row || {};
    var parts = [String(r.title || '').trim()];
    var abs = String(r.abstract || '').trim();
    if (abs) parts.push('Abstract: ' + abs.slice(0, 2200));
    var concepts = (Array.isArray(r.concepts) ? r.concepts : []).filter(Boolean);
    if (concepts.length) parts.push('Concepts: ' + concepts.join(', '));
    var keywords = (Array.isArray(r.keywords) ? r.keywords : []).filter(Boolean);
    if (keywords.length) parts.push('Keywords: ' + keywords.join(', '));
    return parts.join('\n').slice(0, 3000);
  }

  /** 内容 hash（FNV-1a 64bit 两段拼 hex）：判定「内容变了没」用，非安全用途 */
  function contentHash(text) {
    var s = String(text == null ? '' : text);
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ ((c << 1) & 0xffff), 0x85ebca6b) >>> 0;
    }
    return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8);
  }

  /** 嵌入内容的稳定指纹（同一调研行，剔除易变字段后恒等） */
  function embeddingHash(row) {
    return contentHash(embeddingText(row));
  }

  /** 粗估嵌入 token（成本确认框用）：CJK ~1 token/字，其余 ~1 token/4 字符 */
  function estimateEmbedTokens(texts) {
    var list = Array.isArray(texts) ? texts : [texts];
    var total = 0;
    list.forEach(function (t) {
      var s = String(t || '');
      var cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/g) || []).length;
      total += Math.ceil(cjk + (s.length - cjk) / 4);
    });
    return total;
  }

  return {
    EMBED_RECIPE: EMBED_RECIPE,
    shortWorkId: shortWorkId,
    normalizeDoi: normalizeDoi,
    abstractFromInvertedIndex: abstractFromInvertedIndex,
    normalizeOpenAlexWork: normalizeOpenAlexWork,
    normalizeSemanticScholarPaper: normalizeSemanticScholarPaper,
    extIdsForRow: extIdsForRow,
    mergeExtIdLists: mergeExtIdLists,
    sanitizeFileStem: sanitizeFileStem,
    sessionDirName: sessionDirName,
    sessionTitleFrom: sessionTitleFrom,
    truncateForDisk: truncateForDisk,
    renderSessionMarkdown: renderSessionMarkdown,
    sanitizeSessionForDisk: sanitizeSessionForDisk,
    embeddingText: embeddingText,
    contentHash: contentHash,
    embeddingHash: embeddingHash,
    estimateEmbedTokens: estimateEmbedTokens
  };
});
