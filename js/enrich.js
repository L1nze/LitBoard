/* OpenAlex 元数据补全（免费、无需 key、支持 CORS） */
(function () {
  'use strict';

  var API = 'https://api.openalex.org';

  /** 可选：在浏览器控制台执行 localStorage.setItem('litboard.mailto','你的邮箱')
      即可进入 OpenAlex / Crossref 礼貌池（polite pool），限流宽松很多 */
  function withMailto(url) {
    if (url.indexOf('openalex.org') === -1 && url.indexOf('crossref.org') === -1) return url;
    var mail = '';
    try { mail = localStorage.getItem('litboard.mailto') || ''; } catch (e) {}
    if (!mail) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'mailto=' + encodeURIComponent(mail);
  }

  /** abstract_inverted_index → 正文 */
  function invertedToText(inv) {
    if (!inv) return '';
    var arr = [];
    for (var word in inv) {
      var positions = inv[word];
      for (var i = 0; i < positions.length; i++) arr[positions[i]] = word;
    }
    return arr.join(' ').replace(/\s+/g, ' ').trim();
  }

  function normTitle(t) {
    return String(t || '').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '');
  }

  /**
   * 出版商名黑名单（整串匹配）：Semantic Scholar / OpenAlex 会把 publisher
   * 填进 venue（如 "Elsevier"、"Springer"），清洗为空以避免期刊栏显示出版商。
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
    'sage', 'sage publications', 'sage publications ltd',
    'penguin', 'penguin random house', 'hachette livre',
    'kluwer academic publishers', 'kluwer academic', 'springer netherlands',
    'frontiers', 'frontiers media sa', 'frontiers media',
    'plos', 'public library of science',
    'bmj publishing group', 'bmj group',
    'american physical society', 'iop publishing', 'aip publishing',
    'wolters kluwer', 'wolters kluwer medknow', 'dove medical press'
  ];
  function sanitizeVenue(v) {
    var s = String(v || '').trim();
    if (!s) return '';
    var lower = s.toLowerCase().replace(/[.。]+$/, '').trim();
    if (PUBLISHER_NAMES.indexOf(lower) !== -1) return '';
    if (/^(elsevier|springer|wiley|taylor & francis|mdpi)/i.test(lower) && lower.length <= 22) return '';
    return s.replace(/[.。]+$/, '');
  }

  function fetchJson(url, retried) {
    var target = withMailto(url);
    var request = window.litboardDesktop
      ? window.litboardDesktop.fetchJson(target).then(function (result) {
          return {
            status: result.status,
            ok: result.ok,
            json: function () { return Promise.resolve(result.data); }
          };
        })
      : fetch(target, { headers: { 'Accept': 'application/json' } });
    return request.then(function (r) {
      if (r.status === 404) return null;
      if (r.status === 429) {
        if (!retried) {
          // 限流：等 2 秒重试一次
          return new Promise(function (res) { setTimeout(res, 2000); })
            .then(function () { return fetchJson(url, true); });
        }
        throw new Error('rate-limited');
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /** OpenAlex work 对象 → 补全字段 */
  function workToPatch(w) {
    if (!w) return null;
    var patch = {
      citations: (typeof w.cited_by_count === 'number') ? w.cited_by_count : null,
      openalexId: w.id || '',
      enrichedAt: new Date().toISOString()
    };
    var abs = invertedToText(w.abstract_inverted_index);
    if (abs) patch.abstract = abs;
    if (w.publication_year) patch.year = w.publication_year;
    if (w.doi) patch.doi = String(w.doi).replace(/^https?:\/\/doi\.org\//i, '');
    var loc = w.primary_location || {};
    var oaVenue = sanitizeVenue(loc.source && loc.source.display_name);
    if (oaVenue && oaVenue.toLowerCase() !== 'arxiv') patch.venue = oaVenue;
    if (loc.source && Array.isArray(loc.source.issn) && loc.source.issn[0]) patch.issn = loc.source.issn[0];
    var biblio = w.biblio || {};
    if (biblio.volume) patch.volume = String(biblio.volume);
    if (biblio.issue) patch.issue = String(biblio.issue);
    if (biblio.first_page) patch.pages = String(biblio.first_page) + (biblio.last_page ? '-' + biblio.last_page : '');
    var oa = w.open_access || {};
    if (oa.oa_url) patch.oaUrl = oa.oa_url;
    else if (w.best_oa_location && w.best_oa_location.pdf_url) patch.oaUrl = w.best_oa_location.pdf_url;
    if (Array.isArray(w.authorships) && w.authorships.length) {
      patch.authorsFromApi = w.authorships.map(function (a) {
        return (a.author && a.author.display_name) || '';
      }).filter(Boolean);
    }
    if (w.title) patch.titleFromApi = w.title;
    return patch;
  }

  /** 标题相似度校验，避免张冠李戴 */
  function titleMatches(want, got) {
    var a = normTitle(want), b = normTitle(got);
    if (!a || !b) return false;
    if (a === b) return true;
    // 允许副标题级别的微小差异，但拒绝“同名开头的另一篇论文”
    var shorter = Math.min(a.length, b.length), longer = Math.max(a.length, b.length);
    return (a.indexOf(b) === 0 || b.indexOf(a) === 0) && shorter / longer >= 0.9;
  }

  // ============ 数据源 1：OpenAlex ============
  function oaByDoi(doi) {
    return fetchJson(API + '/works/https://doi.org/' + encodeURIComponent(doi)).then(workToPatch);
  }
  function oaByTitle(t) {
    var url = API + '/works?filter=title.search:' + encodeURIComponent(t.replace(/[,:;]/g, ' ')) + '&per-page=3';
    return fetchJson(url).then(function (data) {
      if (!data || !data.results) return null;
      for (var i = 0; i < data.results.length; i++) {
        if (titleMatches(t, data.results[i].title || data.results[i].display_name)) {
          return workToPatch(data.results[i]);
        }
      }
      return null;
    });
  }

  // ============ 数据源 2：Semantic Scholar ============
  var S2 = 'https://api.semanticscholar.org/graph/v1';
  var S2_FIELDS = 'title,abstract,year,venue,citationCount,openAccessPdf,externalIds,authors,journal';

  function s2ToPatch(w) {
    if (!w || w.error) return null;
    var patch = {
      citations: (typeof w.citationCount === 'number') ? w.citationCount : null,
      enrichedAt: new Date().toISOString()
    };
    if (w.abstract) patch.abstract = w.abstract;
    if (w.year) patch.year = w.year;
    // S2 的 `venue` 字段经常是出版商名或会议名（"Elsevier"…），
    // journal.name 才是期刊名；取不到可靠的才回退并清洗
    var s2Venue = (w.journal && w.journal.name) ? w.journal.name : w.venue;
    s2Venue = sanitizeVenue(s2Venue);
    if (s2Venue && s2Venue.toLowerCase() !== 'arxiv') patch.venue = s2Venue;
    if (w.journal && w.journal.volume) patch.volume = String(w.journal.volume);
    if (w.journal && w.journal.pages) patch.pages = String(w.journal.pages);
    if (w.openAccessPdf && w.openAccessPdf.url) patch.oaUrl = w.openAccessPdf.url;
    if (w.externalIds && w.externalIds.DOI) patch.doi = w.externalIds.DOI;
    if (Array.isArray(w.authors) && w.authors.length) {
      patch.authorsFromApi = w.authors.map(function (a) { return a.name || ''; }).filter(Boolean);
    }
    if (w.title) patch.titleFromApi = w.title;
    return patch;
  }
  function s2ByDoi(doi) {
    return fetchJson(S2 + '/paper/DOI:' + encodeURIComponent(doi) + '?fields=' + S2_FIELDS).then(s2ToPatch);
  }
  function s2ByTitle(t) {
    var url = S2 + '/paper/search?query=' + encodeURIComponent(t) + '&limit=3&fields=' + S2_FIELDS;
    return fetchJson(url).then(function (data) {
      if (!data || !data.data) return null;
      for (var i = 0; i < data.data.length; i++) {
        if (titleMatches(t, data.data[i].title)) return s2ToPatch(data.data[i]);
      }
      return null;
    });
  }

  // ============ 数据源 3：Crossref ============
  function stripJats(s) {
    return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().replace(/^Abstract\s*/i, '');
  }
  function crToPatch(m) {
    if (!m) return null;
    var patch = {
      citations: (typeof m['is-referenced-by-count'] === 'number') ? m['is-referenced-by-count'] : null,
      enrichedAt: new Date().toISOString()
    };
    var abs = stripJats(m.abstract);
    if (abs) patch.abstract = abs;
    var dp = m.issued && m.issued['date-parts'] && m.issued['date-parts'][0];
    if (dp && dp[0]) patch.year = dp[0];
    if (m['container-title'] && m['container-title'][0]) {
      var crVenue = sanitizeVenue(m['container-title'][0]);
      if (crVenue && crVenue.toLowerCase() !== 'arxiv') patch.venue = crVenue;
    }
    if (m.DOI) patch.doi = m.DOI;
    if (m.volume) patch.volume = String(m.volume);
    if (m.issue) patch.issue = String(m.issue);
    if (m.page) patch.pages = String(m.page);
    if (m.publisher) patch.publisher = String(m.publisher);
    if (Array.isArray(m.ISSN) && m.ISSN[0]) patch.issn = m.ISSN[0];
    if (Array.isArray(m.ISBN) && m.ISBN[0]) patch.isbn = m.ISBN[0];
    if (Array.isArray(m.author) && m.author.length) {
      patch.authorsFromApi = m.author.map(function (a) {
        return ((a.given || '') + ' ' + (a.family || '')).trim();
      }).filter(Boolean);
    }
    if (m.title && m.title[0]) patch.titleFromApi = m.title[0];
    return patch;
  }
  function crByDoi(doi) {
    return fetchJson('https://api.crossref.org/works/' + encodeURIComponent(doi)).then(function (d) {
      return d && d.message ? crToPatch(d.message) : null;
    });
  }
  function crByTitle(t) {
    var url = 'https://api.crossref.org/works?rows=3&query.bibliographic=' + encodeURIComponent(t);
    return fetchJson(url).then(function (d) {
      var items = d && d.message && d.message.items;
      if (!items) return null;
      for (var i = 0; i < items.length; i++) {
        if (titleMatches(t, items[i].title && items[i].title[0])) return crToPatch(items[i]);
      }
      return null;
    });
  }

  // ============ 依次尝试各数据源 ============
  var PROVIDERS = [
    { name: 'OpenAlex', byDoi: oaByDoi, byTitle: oaByTitle },
    { name: 'Semantic Scholar', byDoi: s2ByDoi, byTitle: s2ByTitle },
    { name: 'Crossref', byDoi: crByDoi, byTitle: crByTitle }
  ];

  // 某个源被限流后，10 分钟内跳过它，避免批量补全时每条都白等
  var providerDownUntil = {};
  function isDown(name) { return providerDownUntil[name] && Date.now() < providerDownUntil[name]; }
  function markDown(name) { providerDownUntil[name] = Date.now() + 10 * 60 * 1000; }

  function tryProviders(call) {
    var i = 0, lastError = null, hadCleanMiss = false;
    function next() {
      if (i >= PROVIDERS.length) {
        if (lastError && !hadCleanMiss) return Promise.reject(lastError);
        return Promise.resolve(null);
      }
      var prov = PROVIDERS[i++];
      if (isDown(prov.name)) return next();
      return call(prov).then(function (patch) {
        if (patch) { patch.source = prov.name; return patch; }
        hadCleanMiss = true;
        return next();
      }).catch(function (err) {
        lastError = err;
        if (err && err.message === 'rate-limited') markDown(prov.name);
        return next();
      });
    }
    return next();
  }

  function byDoi(doi) {
    var clean = String(doi || '').replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '').trim();
    if (!clean) return Promise.resolve(null);
    return tryProviders(function (p) { return p.byDoi(clean); });
  }

  function byTitle(title) {
    var t = String(title || '').trim();
    if (t.length < 8) return Promise.resolve(null);
    return tryProviders(function (p) { return p.byTitle(t); });
  }

  /** 补全一条：优先 DOI，退回标题 */
  function enrichPaper(paper) {
    var p = paper.doi ? byDoi(paper.doi) : Promise.resolve(null);
    return p.then(function (patch) {
      if (patch) return patch;
      return byTitle(paper.title);
    });
  }

  /**
   * 批量补全（串行 + 间隔，尊重 OpenAlex 限速；约 10 req/s 上限，这里取 250ms）
   * onProgress(done, total, paper, patch)
   * ctl（可选）：调用方持有的控制句柄，随时可改——
   *   ctl.paused = true  暂停（在取任务前生效，在飞的请求不打断，结果照常落地）；
   *   ctl.aborted = true 中断（不再取新任务，Promise 以已完成的部分结果 resolve）；
   *   两者置回后须调 ctl.wake()（批量挂起时自动附上）唤醒等在暂停门上的 worker。
   * 不传 ctl 则行为与旧版完全一致。
   */
  function enrichBatch(papers, onProgress, ctl) {
    var cursor = 0, done = 0, results = [];
    var WORKERS = Math.min(3, papers.length);
    var pauseGate = null, openGate = null;

    function waitWhilePaused() {
      if (!ctl || ctl.aborted || !ctl.paused) return Promise.resolve();
      if (!pauseGate) pauseGate = new Promise(function (resolve) { openGate = resolve; });
      return pauseGate.then(waitWhilePaused);
    }
    function wake() {
      if (openGate) { var open = openGate; openGate = null; pauseGate = null; open(); }
    }
    if (ctl) ctl.wake = wake;

    function delay(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

    function enrichOne(paper) {
      return enrichPaper(paper)
        .catch(function (err) {
          if (err && err.message === 'rate-limited') {
            return delay(3000).then(function () { return enrichPaper(paper); })
              .catch(function () { return null; });
          }
          return null;
        });
    }

    function worker() {
      return waitWhilePaused().then(function () {
        if ((ctl && ctl.aborted) || cursor >= papers.length) return undefined;
        var paper = papers[cursor++];
        return enrichOne(paper).then(function (patch) {
          results.push({ paper: paper, patch: patch });
          done++;
          if (onProgress) onProgress(done, papers.length, paper, patch);
          return delay(250).then(worker);
        });
      });
    }

    var workers = [];
    for (var w = 0; w < WORKERS; w++) workers.push(worker());
    return Promise.all(workers).then(function () { return results; });
  }

  /**
   * 断点续补台账：记录「哪篇刚查过」（命中与否都算），让顶栏补全按钮再点时
   * 跳过近期查过的、只补剩下的——中断/重启后从上次进度接着来，而不是整批重查。
   * store = { get(): any, set(map): void }，由调用方决定放 localStorage 还是内存；
   * opts = { ttlMs, now }，均可注入以便测试。所有方法纯同步。
   */
  function createAttemptLedger(store, opts) {
    opts = opts || {};
    var ttl = opts.ttlMs || 24 * 60 * 60 * 1000;
    var now = opts.now || function () { return Date.now(); };
    var map = {};
    try {
      var raw = store.get();
      if (raw && typeof raw === 'object') map = raw;
    } catch (e) { map = {}; }
    function persist() { try { store.set(map); } catch (e) { /* 存不了就只在内存里记账 */ } }
    (function prune() {
      var cutoff = now() - ttl;
      for (var k in map) { if (!(map[k] >= cutoff)) delete map[k]; }
    })();
    return {
      isRecent: function (id) { return typeof map[id] === 'number' && now() - map[id] < ttl; },
      mark: function (id) { map[id] = now(); persist(); },
      clear: function (id) { if (id in map) { delete map[id]; persist(); } },
      count: function () { return Object.keys(map).length; }
    };
  }

  // ============ PDF 资源定位（OpenAlex / Semantic Scholar / Crossref） ============
  function httpUrl(u) {
    try {
      var url = new URL(u);
      return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : '';
    } catch (e) { return ''; }
  }
  function isLikelyPdfUrl(u) {
    var href = httpUrl(u);
    if (!href) return false;
    try {
      var url = new URL(href);
      return /\.pdf$/i.test(url.pathname) || /\/pdf(?:\/|$)/i.test(url.pathname) ||
        /(?:[?&](?:format|type|download)=pdf)(?:&|$)/i.test(url.search);
    } catch (e) {
      return /\.pdf(?:$|[?#])/i.test(href);
    }
  }
  function pushPdfUrl(out, raw, force) {
    var url = httpUrl(raw);
    if (!url) return;
    if (force || isLikelyPdfUrl(url)) out.push(url);
  }
  function uniqueUrls(urls) {
    var seen = {}, out = [];
    for (var i = 0; i < urls.length; i++) {
      if (!urls[i] || seen[urls[i]]) continue;
      seen[urls[i]] = true;
      out.push(urls[i]);
    }
    return out;
  }

  /** 从 OpenAlex work 里只收集明确 PDF 字段；落地页不能当 PDF 直链 */
  function oaPdfUrlsFromWork(w) {
    var urls = [];
    if (!w) return urls;
    var best = w.best_oa_location || {};
    pushPdfUrl(urls, best.pdf_url, true);
    var primary = w.primary_location || {};
    pushPdfUrl(urls, primary.pdf_url, true);
    if (Array.isArray(w.locations)) {
      for (var i = 0; i < w.locations.length; i++) {
        if (w.locations[i]) pushPdfUrl(urls, w.locations[i].pdf_url, true);
      }
    }
    var oa = w.open_access || {};
    pushPdfUrl(urls, oa.oa_url, false);
    return uniqueUrls(urls);
  }
  function s2PdfUrlsFromWork(w) {
    var urls = [];
    if (w && w.openAccessPdf && w.openAccessPdf.url) pushPdfUrl(urls, w.openAccessPdf.url, true);
    return uniqueUrls(urls);
  }
  function crPdfUrlsFromMessage(m) {
    var urls = [];
    var links = m && Array.isArray(m.link) ? m.link : [];
    for (var i = 0; i < links.length; i++) {
      var link = links[i] || {};
      var contentType = String(link['content-type'] || link.contentType || '').toLowerCase();
      pushPdfUrl(urls, link.URL || link.url, contentType.indexOf('application/pdf') !== -1);
    }
    return uniqueUrls(urls);
  }
  function arxivPdfUrlsFromDoi(doi) {
    var m = String(doi || '').match(/^10\.48550\/arxiv\.([0-9]{4}\.[0-9]{4,5})(?:v\d+)?$/i);
    return m ? ['https://arxiv.org/pdf/' + m[1]] : [];
  }

  function findOaPdfByDoi(doi) {
    return fetchJson(API + '/works/https://doi.org/' + encodeURIComponent(doi)).then(function (w) {
      return oaPdfUrlsFromWork(w);
    }).catch(function () { return []; });
  }
  function findOaPdfByTitle(t) {
    var url = API + '/works?filter=title.search:' + encodeURIComponent(t.replace(/[,:;]/g, ' ')) + '&per-page=5';
    return fetchJson(url).then(function (data) {
      if (!data || !data.results) return [];
      for (var i = 0; i < data.results.length; i++) {
        var w = data.results[i];
        if (titleMatches(t, w.title || w.display_name)) {
          var hits = oaPdfUrlsFromWork(w);
          if (hits.length) return hits;
        }
      }
      return [];
    }).catch(function () { return []; });
  }
  function findS2PdfByDoi(doi) {
    return fetchJson(S2 + '/paper/DOI:' + encodeURIComponent(doi) + '?fields=openAccessPdf,title').then(function (w) {
      return s2PdfUrlsFromWork(w);
    }).catch(function () { return []; });
  }
  function findS2PdfByTitle(t) {
    var url = S2 + '/paper/search?query=' + encodeURIComponent(t) + '&limit=5&fields=openAccessPdf,title';
    return fetchJson(url).then(function (data) {
      if (!data || !data.data) return [];
      for (var i = 0; i < data.data.length; i++) {
        var w = data.data[i];
        if (titleMatches(t, w.title)) {
          var hits = s2PdfUrlsFromWork(w);
          if (hits.length) return hits;
        }
      }
      return [];
    }).catch(function () { return []; });
  }
  function findCrPdfByDoi(doi) {
    return fetchJson('https://api.crossref.org/works/' + encodeURIComponent(doi)).then(function (d) {
      return d && d.message ? crPdfUrlsFromMessage(d.message) : [];
    }).catch(function () { return []; });
  }
  function findCrPdfByTitle(t) {
    var url = 'https://api.crossref.org/works?rows=5&query.bibliographic=' + encodeURIComponent(t);
    return fetchJson(url).then(function (d) {
      var items = d && d.message && d.message.items;
      if (!items) return [];
      for (var i = 0; i < items.length; i++) {
        if (titleMatches(t, items[i].title && items[i].title[0])) {
          var hits = crPdfUrlsFromMessage(items[i]);
          if (hits.length) return hits;
        }
      }
      return [];
    }).catch(function () { return []; });
  }

  /**
   * 为一条文献查找开放获取 PDF 直链
   * 优先按 DOI 精确匹配，找不到再按标题匹配；返回 [{ source, url }]，按来源去重
   */
  function findPdfUrls(paper) {
    var p = paper || {};
    var doi = String(p.doi || '').replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '').trim();
    var title = String(p.title || '').trim();
    function run(tasks) {
      var seen = {};
      return Promise.all(tasks.map(function (task) {
        return task.p.then(function (urls) {
          if (!Array.isArray(urls)) urls = urls ? [urls] : [];
          return urls.map(function (url) { return { source: task.source, url: url }; });
        });
      })).then(function (groups) {
        var out = [];
        groups.forEach(function (items) {
          items.forEach(function (item) {
            if (!item || seen[item.url]) return;
            seen[item.url] = true;
            out.push(item);
          });
        });
        return out;
      });
    }
    if (doi) {
      return run([
        { source: 'arXiv', p: Promise.resolve(arxivPdfUrlsFromDoi(doi)) },
        { source: 'OpenAlex', p: findOaPdfByDoi(doi) },
        { source: 'Semantic Scholar', p: findS2PdfByDoi(doi) },
        { source: 'Crossref', p: findCrPdfByDoi(doi) }
      ]).then(function (list) {
        if (list.length || title.length < 8) return list;
        return run([
          { source: 'OpenAlex', p: findOaPdfByTitle(title) },
          { source: 'Semantic Scholar', p: findS2PdfByTitle(title) },
          { source: 'Crossref', p: findCrPdfByTitle(title) }
        ]);
      });
    }
    if (title.length >= 8) {
      return run([
        { source: 'OpenAlex', p: findOaPdfByTitle(title) },
        { source: 'Semantic Scholar', p: findS2PdfByTitle(title) },
        { source: 'Crossref', p: findCrPdfByTitle(title) }
      ]);
    }
    return Promise.resolve([]);
  }

  /** 从摘要猜样本量（启发式，仅供参考） */
  function guessSampleSize(text) {
    if (!text) return null;
    var m = text.match(/\b[nN]\s*=\s*([\d][\d,]{0,9})/);
    if (m) return m[1].replace(/,/g, '');
    m = text.match(/([\d][\d,]{0,9})\s+(participants|patients|subjects|respondents|individuals|adults|children|samples)/i);
    if (m) return m[1].replace(/,/g, '');
    return null;
  }

  // ============ 数据源 4：PubMed（PMID）============
  function byPmid(pmid) {
    var id = String(pmid || '').replace(/\D/g, '');
    if (!id) return Promise.resolve(null);
    var url = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=' + id;
    return fetchJson(url).then(function (data) {
      var rec = data && data.result && data.result[id];
      if (!rec || rec.error) return null;
      var patch = { source: 'PubMed', citations: null, enrichedAt: new Date().toISOString() };
      if (rec.title) patch.titleFromApi = String(rec.title).replace(/\s*\.$/, '');
      var pubVenue = sanitizeVenue(rec.fulljournalname);
      if (pubVenue && pubVenue.toLowerCase() !== 'arxiv') patch.venue = pubVenue;
      var dateMatch = String(rec.pubdate || '').match(/(\d{4})/);
      if (dateMatch) patch.year = Number(dateMatch[1]);
      if (rec.volume) patch.volume = String(rec.volume);
      if (rec.issue) patch.issue = String(rec.issue);
      if (rec.pages) patch.pages = String(rec.pages);
      if (Array.isArray(rec.authors)) {
        patch.authorsFromApi = rec.authors.map(function (a) { return a && a.name || ''; }).filter(Boolean);
      }
      if (Array.isArray(rec.articleids)) {
        rec.articleids.forEach(function (aid) {
          if (aid && aid.idtype === 'doi' && aid.value) patch.doi = String(aid.value);
        });
      }
      return patch.titleFromApi ? patch : null;
    }).catch(function () { return null; });
  }

  // ============ 数据源 5：OpenLibrary（ISBN）============
  function byIsbn(isbn) {
    var id = String(isbn || '').replace(/[-\s]/g, '');
    if (!/^\d{10}(\d{3})?$/.test(id)) return Promise.resolve(null);
    var url = 'https://openlibrary.org/api/books?bibkeys=ISBN:' + id + '&format=json&jscmd=data';
    return fetchJson(url).then(function (data) {
      var rec = data && data['ISBN:' + id];
      if (!rec) return null;
      var patch = { source: 'OpenLibrary', citations: null, enrichedAt: new Date().toISOString() };
      if (rec.title) patch.titleFromApi = rec.title + (rec.subtitle ? ': ' + rec.subtitle : '');
      var yearMatch = String(rec.publish_date || '').match(/(\d{4})/);
      if (yearMatch) patch.year = Number(yearMatch[1]);
      if (Array.isArray(rec.authors)) {
        patch.authorsFromApi = rec.authors.map(function (a) { return a && a.name || ''; }).filter(Boolean);
      }
      if (Array.isArray(rec.publishers) && rec.publishers[0] && rec.publishers[0].name) {
        patch.publisher = rec.publishers[0].name;
      }
      patch.isbn = id;
      if (rec.url) patch.url = rec.url;
      return patch.titleFromApi ? patch : null;
    }).catch(function () { return null; });
  }

  window.LitEnrich = {
    enrichPaper: enrichPaper,
    enrichBatch: enrichBatch,
    createAttemptLedger: createAttemptLedger,
    byDoi: byDoi,
    byTitle: byTitle,
    byPmid: byPmid,
    byIsbn: byIsbn,
    guessSampleSize: guessSampleSize,
    findPdfUrls: findPdfUrls
  };
})();
