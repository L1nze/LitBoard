/* LitBoard 科研网页检索纯函数层（浏览器 / Node 共用，零依赖）
 *
 * 职责（对应 roadmap M9-4 / R15 修订）：
 * - 学术域白名单判定（固定后缀表，边界精确匹配；Fetch 只放行白名单内 URL）；
 * - TinyFish Search 响应规范化（research_paper 增广字段名各家不一，防御式取值）；
 * - **元数据保真（R15）**：pageUrl（网页地址）与 pdfUrl（PDF 直链）分开保存、
 *   venue（真实期刊/会议名）与 siteName（站点名）分开、snippet（网页片段）与
 *   abstract（真实摘要）分开——三者混为一谈会让「网页片段」冒充「摘要」、
 *   让「/abs/ 页面」冒充「PDF 直链」，后续下载与引用都跟着错；
 * - entryType 推断：有 DOI / PDF / venue 视为 article，否则如实标 web（不再一律 web）；
 * - Fetch 响应解析：per-URL 失败在 HTTP 200 内以 errors[] 返回——必须解析，不得只看状态码；
 *   final_url 离开学术域 → 丢弃该结果（我们只能校验自己发出的 URL，重定向在对方侧）；
 * - 标题规范化（DOI 缺失时按标题匹配补齐调研身份用）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitWebFetch = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /** 公开学术域固定后缀表（不做「任意 https」；出版商域只列开放可见的主站） */
  var ACADEMIC_SUFFIXES = [
    'doi.org', 'arxiv.org', 'pmc.ncbi.nlm.nih.gov', 'europepmc.org',
    'biorxiv.org', 'medrxiv.org', 'osf.io', 'zenodo.org', 'figshare.com',
    'hal.science', 'aclanthology.org', 'openreview.net',
    'plos.org', 'nature.com', 'science.org', 'sciencedirect.com', 'springer.com',
    'link.springer.com', 'wiley.com', 'onlinelibrary.wiley.com', 'tandfonline.com',
    'sagepub.com', 'ieee.org', 'ieeexplore.ieee.org', 'acm.org', 'dl.acm.org',
    'apa.org', 'cambridge.org', 'oup.com', 'academic.oup.com', 'jstor.org',
    'semanticscholar.org', 'openalex.org', 'core.ac.uk', 'base-search.net',
    'ssrn.com', 'researchgate.net', 'scielo.org', 'arxiv-sanity.com'
  ];
  var ACADEMIC_TLD_SUFFIXES = ['.edu', '.ac.uk', '.edu.cn', '.ac.jp', '.edu.au', '.ac.kr', '.edu.hk', '.ac.cn', '.gov'];

  /** 后缀边界精确匹配：'cambridge.org' 命中 'www.cambridge.org'，不命中 'evilcambridge.org' */
  function suffixMatches(host, suffix) {
    if (suffix.charAt(0) === '.') return host.slice(-suffix.length) === suffix;
    return host === suffix || host.slice(-(suffix.length + 1)) === '.' + suffix;
  }

  /**
   * 学术域判定：{ ok: true, host } 或 { ok: false, host, reason }。
   * 无协议/非 http(s)/无法解析一律拒绝（Fetch 只交出白名单内 URL）。
   */
  function isAcademicUrl(url) {
    var s = String(url == null ? '' : url).trim();
    var host = '';
    try {
      var parsed = new URL(s);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { ok: false, host: '', reason: '仅允许 http(s) 链接' };
      }
      host = parsed.hostname.toLowerCase();
    } catch (error) {
      return { ok: false, host: '', reason: '无法解析的 URL' };
    }
    if (!host) return { ok: false, host: '', reason: 'URL 缺少主机名' };
    for (var i = 0; i < ACADEMIC_SUFFIXES.length; i++) {
      if (suffixMatches(host, ACADEMIC_SUFFIXES[i])) return { ok: true, host: host };
    }
    for (var j = 0; j < ACADEMIC_TLD_SUFFIXES.length; j++) {
      if (suffixMatches(host, ACADEMIC_TLD_SUFFIXES[j])) return { ok: true, host: host };
    }
    return { ok: false, host: host, reason: '不在公开学术域白名单内（' + host + '）' };
  }

  function pick(result, names) {
    for (var i = 0; i < names.length; i++) {
      var v = result ? result[names[i]] : null;
      if (v != null && v !== '') return v;
    }
    return null;
  }

  /** DOI 规范化（去 https://doi.org/ 前缀、去 doi:、小写）。
   *  只做形态归一，不做注册机构号位数校验——上游给的值原样保留比静默丢弃安全，
   *  需要严格校验的调用方（OpenAlex filter / 索引查询）自己再判。 */
  function normalizeDoiValue(value) {
    var s = String(value == null ? '' : value).trim();
    if (!s) return '';
    s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '').toLowerCase();
    return /^10\.\d+\//.test(s) ? s : '';
  }

  /** PDF 直链候选字段名（research_paper 增广字段上游未稳定，多候选防御式取值）。
   *  只认 http(s) 直链；返回 '' 表示上游没给。 */
  function pickPdfUrl(result) {
    var raw = pick(result, ['pdf_url', 'pdfUrl', 'pdf', 'open_access_pdf', 'openAccessPdf', 'oa_pdf_url', 'full_text_url']);
    var s = '';
    if (typeof raw === 'string') s = raw;
    else if (raw && typeof raw === 'object' && typeof raw.url === 'string') s = raw.url; // S2 openAccessPdf: {url}
    s = String(s || '').trim();
    if (!/^https?:\/\//i.test(s)) return '';
    return s;
  }

  /**
   * 条目类型推断（R15）：旧实现把所有网页检索结果一律标 'web'，于是有 DOI、有 PDF 直链
   * 的正规论文也和「会议主页/数据集页」同型，引用与导出都失真。
   * 判据保守：有 DOI 或 PDF 直链或 venue 才认 article，其余如实标 web。
   */
  function inferEntryType(result) {
    var hint = String(pick(result, ['type', 'publication_type', 'entry_type', 'work_type']) || '').trim().toLowerCase();
    if (hint === 'article' || hint === 'journal-article' || hint === 'conference' || hint === 'proceedings-article' ||
        hint === 'preprint' || hint === 'book' || hint === 'dataset' || hint === 'report') {
      return hint === 'journal-article' || hint === 'proceedings-article' ? 'article' : hint;
    }
    if (result && (result.doi || result.pdfUrl || result.venue)) return 'article';
    return 'web';
  }

  /**
   * Search 响应规范化：research_paper 增广字段（作者/期刊/年份/被引）上游字段名未稳定，
   * 多候选名防御式取值；results/total 缺失视为形状不符（shapeOk=false，调用方如实上报）。
   * R15：pageUrl 与 pdfUrl 分开、venue 与 siteName 分开、snippet 不当 abstract。
   */
  function normalizeSearchResponse(payload, query) {
    var ok = !!(payload && typeof payload === 'object' && Array.isArray(payload.results));
    var list = ok ? payload.results : [];
    var results = list.map(function (result) {
      var year = Number(pick(result, ['year', 'publication_year', 'pub_year', 'published_year'])) || null;
      var venue = String(pick(result, ['venue', 'journal', 'journal_name', 'publication_venue', 'container_title']) || '').trim();
      var pdfUrl = pickPdfUrl(result);
      var doi = normalizeDoiValue(pick(result, ['doi', 'doi_url']));
      var row = {
        title: String(pick(result, ['title']) || '').trim(),
        // url = 网页地址（页面所在处）；pdfUrl = 可直接下载的 PDF 直链——两者语义不同，
        // 旧实现把 url 塞进 oaUrl 导致「有 OA 直链却下载 /abs/ 页面」
        url: String(pick(result, ['url', 'link', 'page_url', 'landing_page_url']) || '').trim(),
        pdfUrl: pdfUrl,
        snippet: String(pick(result, ['snippet', 'description']) || '').trim(),
        // 真实摘要字段（若有）；没有就留空，绝不用 snippet 顶替
        abstract: String(pick(result, ['abstract', 'abstract_text']) || '').trim(),
        siteName: String(pick(result, ['site_name', 'domain', 'source']) || ''),
        venue: venue,
        authors: (function () {
          var a = pick(result, ['authors', 'authors_json', 'author_names']);
          if (Array.isArray(a)) return a.map(function (x) { return typeof x === 'string' ? x : String(x && x.name || ''); }).filter(Boolean);
          if (typeof a === 'string') return a.split(/[,;、]/).map(function (x) { return x.trim(); }).filter(Boolean);
          return [];
        })(),
        year: year && year > 1000 && year < 10000 ? year : null,
        citations: (function () {
          var c = Number(pick(result, ['citation_count', 'citations', 'cited_by', 'cited_by_count']));
          return isFinite(c) && c >= 0 ? c : null;
        })(),
        doi: doi
      };
      row.entryType = inferEntryType(row);
      return row;
    }).filter(function (r) { return r.title && r.url; });
    return {
      shapeOk: ok,
      query: String(query || (payload && payload.query) || ''),
      total: ok ? (Number(payload.total_results) || results.length) : 0,
      results: results
    };
  }

  /**
   * Fetch 响应解析（单 URL 调用）：
   * - HTTP 200 内 errors[] 非空 → { ok:false, partial:true, error }（部分失败语义，如实上报）；
   * - final_url 离开学术域 → 丢弃正文并报错（信任边界：重定向发生在对方侧，我们只能校验落点）；
   * - 正常 → { ok:true, markdown, finalUrl, title }。
   */
  function parseFetchResponse(payload, requestedUrl) {
    if (!payload || typeof payload !== 'object') {
      return { ok: false, error: '响应不是 JSON 对象' };
    }
    var errors = Array.isArray(payload.errors) ? payload.errors : [];
    if (errors.length) {
      var first = errors[0] || {};
      return {
        ok: false,
        partial: true,
        error: String(first.error || first.code || first.message || '抓取失败（上游 errors[]）'),
        failedUrl: String(first.url || requestedUrl || '')
      };
    }
    var results = Array.isArray(payload.results) ? payload.results : [];
    var hit = results.filter(function (r) { return r && (r.url === requestedUrl || r.final_url === requestedUrl); })[0] ||
      results[0];
    if (!hit || !hit.text) {
      return { ok: false, error: '上游未返回正文（可能被反爬或页面为空）' };
    }
    var finalUrl = String(hit.final_url || hit.url || requestedUrl);
    var check = isAcademicUrl(finalUrl);
    if (!check.ok) {
      return { ok: false, error: '重定向后离开学术域（' + (check.host || finalUrl.slice(0, 80)) + '），正文已按策略丢弃' };
    }
    return {
      ok: true,
      markdown: String(hit.text || ''),
      finalUrl: finalUrl,
      title: String(hit.title || '').trim(),
      description: String(hit.description || '').trim(),
      language: String(hit.language || '')
    };
  }

  /** 标题规范化（标题匹配补 DOI 用）：小写、去标点、压空白 */
  function normalizedTitle(title) {
    return String(title == null ? '' : title)
      .toLowerCase()
      .replace(/[\p{P}\p{S}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 调研行草稿：网页检索结果入库用（id 由调用方生成：已匹配→既有身份；未匹配→local:）。
   * R15 字段归属（不再混淆）：
   * - oaUrl 只放**PDF 直链**（有才给，没有就空——空值不会被误当下载地址）；
   * - pageUrl 放网页地址（溯源用；渲染层「打开来源」走它）；
   * - sourceName 优先 venue（真实期刊/会议名），没有才退回 siteName（站点名）；
   * - abstract 只收真实摘要；网页片段进 snippet 列（检索索引覆盖，但不冒充摘要）。
   */
  function workFromSearchResult(result) {
    var r = result || {};
    return {
      id: '',
      doi: r.doi || '',
      title: String(r.title || ''),
      year: r.year || null,
      pubdate: '',
      type: r.entryType || inferEntryType(r),
      sourceId: '',
      sourceName: String(r.venue || r.siteName || ''),
      abstract: String(r.abstract || ''),
      snippet: String(r.snippet || ''),
      pageUrl: String(r.url || ''),
      oaUrl: String(r.pdfUrl || ''),
      lang: '',
      citedBy: r.citations || 0,
      isOa: !!r.pdfUrl,
      authors: (r.authors || []).map(function (name) { return { name: name }; }),
      refs: [],
      concepts: [],
      keywords: []
    };
  }

  return {
    ACADEMIC_SUFFIXES: ACADEMIC_SUFFIXES,
    ACADEMIC_TLD_SUFFIXES: ACADEMIC_TLD_SUFFIXES,
    isAcademicUrl: isAcademicUrl,
    normalizeDoiValue: normalizeDoiValue,
    pickPdfUrl: pickPdfUrl,
    inferEntryType: inferEntryType,
    normalizeSearchResponse: normalizeSearchResponse,
    parseFetchResponse: parseFetchResponse,
    normalizedTitle: normalizedTitle,
    workFromSearchResult: workFromSearchResult
  };
});
