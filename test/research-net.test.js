'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createResearchNet, createThrottleQueue } = require('../electron/research-net.js');

/* ---------------- 假时钟与假 fetch ---------------- */

function fakeClock() {
  let t = 1000;
  const sleeps = [];
  return {
    now: function () { return t; },
    sleep: async function (ms) { sleeps.push(ms); t += ms; },
    sleeps: sleeps,
    advance: function (ms) { t += ms; }
  };
}

function jsonResponse(body, status) {
  return {
    ok: (status || 200) >= 200 && (status || 200) < 300,
    status: status || 200,
    headers: { get: function () { return null; } },
    json: async function () { return body; }
  };
}

test('throttle queue respects concurrency limit', async function () {
  const clock = fakeClock();
  let inFlight = 0;
  let maxInFlight = 0;
  const done = [];
  const q = createThrottleQueue(async function () {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await clock.sleep(50);
    inFlight--;
    return jsonResponse({ ok: true });
  }, { sleep: clock.sleep, now: clock.now });
  q.setPolicy('api.test', { concurrency: 2, minIntervalMs: 0 });
  await Promise.all([0, 1, 2, 3, 4].map(function (i) {
    return q.requestJson('https://api.test/x?' + i).then(function () { done.push(i); });
  }));
  assert.equal(done.length, 5);
  assert.equal(maxInFlight, 2);
});

test('throttle queue enforces min interval between dispatches', async function () {
  const clock = fakeClock();
  const dispatchTimes = [];
  const q = createThrottleQueue(async function () {
    return jsonResponse({ ok: true });
  }, {
    sleep: clock.sleep, now: clock.now,
    onDispatch: function (_host, t) { dispatchTimes.push(t); }
  });
  q.setPolicy('api.test', { concurrency: 5, minIntervalMs: 100 });
  await Promise.all([1, 2, 3].map(function (i) { return q.requestJson('https://api.test/x?' + i); }));
  for (let i = 1; i < dispatchTimes.length; i++) {
    assert.ok(dispatchTimes[i] - dispatchTimes[i - 1] >= 100,
      'dispatch gap ' + (dispatchTimes[i] - dispatchTimes[i - 1]) + ' < 100');
  }
});

test('throttle queue retries on 429 then succeeds', async function () {
  const clock = fakeClock();
  let calls = 0;
  const q = createThrottleQueue(async function () {
    calls++;
    if (calls < 3) {
      return { ok: false, status: 429, headers: { get: function (k) { return k === 'retry-after' ? '0' : null; } }, json: async function () { return {}; } };
    }
    return jsonResponse({ value: 42 });
  }, { sleep: clock.sleep, now: clock.now });
  const data = await q.requestJson('https://api.test/retry');
  assert.equal(data.value, 42);
  assert.equal(calls, 3);
});

test('throttle queue gives up after max attempts with status', async function () {
  const clock = fakeClock();
  let calls = 0;
  const q = createThrottleQueue(async function () {
    calls++;
    return { ok: false, status: 503, headers: { get: function () { return null; } }, json: async function () { return {}; } };
  }, { sleep: clock.sleep, now: clock.now });
  await assert.rejects(function () { return q.requestJson('https://api.test/down'); }, function (err) {
    return err.status === 503;
  });
  assert.equal(calls, 3);
});

test('throttle queue throws immediately on non-retryable status', async function () {
  const clock = fakeClock();
  let calls = 0;
  const q = createThrottleQueue(async function () {
    calls++;
    return { ok: false, status: 403, headers: { get: function () { return null; } }, json: async function () { return {}; } };
  }, { sleep: clock.sleep, now: clock.now });
  await assert.rejects(function () { return q.requestJson('https://api.test/forbidden'); }, function (err) {
    return err.status === 403;
  });
  assert.equal(calls, 1); // 不重试
});

test('searchOpenAlex builds polite-pool URL and normalizes results', async function () {
  let seenUrl = '';
  const net = createResearchNet({
    fetch: async function (url) {
      seenUrl = url;
      return jsonResponse({
        meta: { count: 1 },
        results: [{
          id: 'https://openalex.org/W7',
          doi: 'https://doi.org/10.1/z',
          title: 'T',
          publication_year: 2024,
          open_access: { is_oa: true }
        }]
      });
    },
    getConfig: async function () { return { openalexEmail: 'a@b.c', openalexApiKey: 'K' }; }
  });
  const r = await net.searchOpenAlex({ query: 'battery', limit: 10, yearFrom: 2023 });
  assert.equal(r.count, 1);
  assert.equal(r.results[0].id, 'W7');
  assert.equal(r.results[0].doi, '10.1/z');
  assert.ok(seenUrl.indexOf('search=battery') !== -1);
  assert.ok(seenUrl.indexOf('mailto=a%40b.c') !== -1);
  assert.ok(seenUrl.indexOf('api_key=K') !== -1);
  assert.ok(seenUrl.indexOf('from_publication_date%3A2023-01-01') !== -1);
  assert.ok(seenUrl.indexOf('per_page=10') !== -1);
});

test('fetchWorksByIds batches by 100 and dedupes', async function () {
  const urls = [];
  const net = createResearchNet({
    fetch: async function (url) {
      urls.push(url);
      const filter = decodeURIComponent(url.split('filter=')[1] || '');
      const count = (filter.match(/W\d+/g) || []).length;
      const results = [];
      for (let i = 0; i < count; i++) {
        results.push({ id: 'https://openalex.org/W' + (i + 1), title: 'w' + i });
      }
      return jsonResponse({ results: results });
    }
  });
  const ids = [];
  for (let i = 1; i <= 150; i++) ids.push('W' + i);
  ids.push('W1'); // 重复
  const rows = await net.fetchWorksByIds(ids);
  assert.equal(urls.length, 2); // 150 唯一 ID → 两批
  assert.equal(rows.length, 100 + 50);
});

test('parseCrossrefAbstract strips JATS tags and decodes entities', function () {
  const { parseCrossrefAbstract } = require('../electron/research-net.js');
  assert.equal(
    parseCrossrefAbstract({ abstract: '<jats:p>Background &amp; aims: <jats:italic>test</jats:italic> done</jats:p>' }),
    'Background & aims: test done'
  );
  assert.equal(parseCrossrefAbstract({}), '');
  assert.equal(parseCrossrefAbstract({ abstract: 42 }), '');
});

test('parseElsevierAbstract walks messy shapes', function () {
  const { parseElsevierAbstract } = require('../electron/research-net.js');
  const simple = { 'abstracts-retrieval-response': { item: { bibrecord: { head: { abstracts: [{ abstract: [{ '$': 'Hello world' }] }] } } } } };
  assert.equal(parseElsevierAbstract(simple), 'Hello world');
  const xml2js = { 'abstracts-retrieval-response': { item: { bibrecord: { head: { abstracts: [{ abstract: [{ _: 'Alt text' }] }] } } } } };
  assert.equal(parseElsevierAbstract(xml2js), 'Alt text');
  assert.equal(parseElsevierAbstract({}), '');
});

test('backfillAbstracts: crossref hit short-circuits, elsevier fallback, 429 stops the batch', async function () {
  const calls = [];
  const net = createResearchNet({
    fetch: async function (url) {
      calls.push(url);
      if (url.indexOf('api.crossref.org') !== -1) {
        if (url.indexOf('10.1%2Fhit') !== -1) {
          return jsonResponse({ message: { abstract: '<jats:p>from crossref</jats:p>' } });
        }
        return { ok: false, status: 404, headers: { get: function () { return null; } }, json: async function () { return {}; } };
      }
      if (url.indexOf('api.elsevier.com') !== -1) {
        if (url.indexOf('10.1%2Fratelimit') !== -1) {
          return { ok: false, status: 429, headers: { get: function () { return null; } }, json: async function () { return {}; } };
        }
        return jsonResponse({ 'abstracts-retrieval-response': { item: { bibrecord: { head: { abstracts: [{ abstract: [{ '$': 'from elsevier' }] }] } } } } });
      }
      throw new Error('unexpected ' + url);
    },
    getConfig: async function () { return { elsevierApiKey: 'EK' }; }
  });
  // hit：crossref 命中，不碰 elsevier
  const r1 = await net.backfillAbstracts([{ id: 'W1', doi: '10.1/hit' }]);
  assert.equal(r1.updated, 1);
  assert.equal(r1.results[0].source, 'crossref');
  assert.ok(calls.every(function (u) { return u.indexOf('elsevier') === -1; }));
  // fallback：crossref 404 → elsevier 命中
  const r2 = await net.backfillAbstracts([{ id: 'W2', doi: '10.1/miss' }]);
  assert.equal(r2.results[0].source, 'elsevier');
  // 429：记账停批
  const r3 = await net.backfillAbstracts([{ id: 'W3', doi: '10.1/ratelimit' }]);
  assert.equal(r3.stopped, true);
  assert.equal(r3.reason, 'rate_limited');
});

const { buildScopusQuery, normalizeScopusHit } = require('../electron/research-net.js');

test('buildScopusQuery quotes terms, strips parens and builds PUBYEAR range', function () {
  assert.equal(
    buildScopusQuery({ query: 'lithium battery (SOH)' }),
    'TITLE-ABS-KEY("lithium" "battery" "SOH")'
  );
  assert.equal(
    buildScopusQuery({ query: '电池', yearFrom: 2020, yearTo: 2025 }),
    'TITLE-ABS-KEY("电池") AND PUBYEAR AFT 2019 AND PUBYEAR BEF 2026'
  );
  assert.throws(function () { buildScopusQuery({ query: '   ' }); });
});

test('normalizeScopusHit handles creator string/array, doi prefix and counts', function () {
  const hit = normalizeScopusHit({
    'dc:identifier': 'EID:2-s2.0-85123456789',
    'dc:title': 'A Scopus paper',
    'dc:creator': ['Zhang S.', 'Li W.'],
    'prism:publicationName': 'Journal X',
    'prism:coverDate': '2024-05-01',
    'prism:doi': 'doi:10.1016/J.XYZ.2024.01.001',
    'citedby-count': '17'
  });
  assert.equal(hit.eid, '2-s2.0-85123456789');
  assert.equal(hit.doi, '10.1016/j.xyz.2024.01.001');
  assert.equal(hit.year, 2024);
  assert.deepEqual(hit.authors, [{ name: 'Zhang S.' }, { name: 'Li W.' }]);
  assert.equal(hit.citedByScopus, 17);
  const single = normalizeScopusHit({ 'dc:creator': 'One Author', 'dc:title': 'T' });
  assert.deepEqual(single.authors, [{ name: 'One Author' }]);
  assert.equal(normalizeScopusHit({ 'prism:doi': 'not-a-doi' }).doi, '');
});

test('searchScopus sends STANDARD view + key, maps entitlement error clearly', async function () {
  let seen = {};
  const net = createResearchNet({
    fetch: async function (url, init) {
      seen = { url: url, key: init.headers['X-ELS-APIKey'] };
      return jsonResponse({
        'search-results': {
          'opensearch:totalResults': '42',
          entry: [{ 'dc:title': 'Hit', 'prism:doi': 'doi:10.1016/j.test.2024.001', 'citedby-count': '3' }]
        }
      });
    },
    getConfig: async function () { return { elsevierApiKey: 'EK' }; }
  });
  const result = await net.searchScopus({ query: 'battery', limit: 10 });
  assert.equal(result.count, 42);
  assert.equal(result.hits[0].doi, '10.1016/j.test.2024.001');
  assert.ok(seen.url.indexOf('view=STANDARD') !== -1);
  assert.ok(seen.url.indexOf('httpAccept=application%2Fjson') !== -1);
  assert.equal(seen.key, 'EK');
  // 无 Key
  const noKey = createResearchNet({
    fetch: async function () { throw new Error('should not call'); },
    getConfig: async function () { return {}; }
  });
  await assert.rejects(function () { return noKey.searchScopus({ query: 'x' }); }, function (e) {
    return e.code === 'NO_KEY';
  });
  // 403 → 明确的权限提示
  const forbidden = createResearchNet({
    fetch: async function () {
      return { ok: false, status: 403, headers: { get: function () { return null; } }, json: async function () { return {}; } };
    },
    getConfig: async function () { return { elsevierApiKey: 'EK' }; }
  });
  await assert.rejects(function () { return forbidden.searchScopus({ query: 'x' }); }, /权限不足/);
});

test('fetchWorksByDois batches 25 with doi: filter and normalizes', async function () {
  const urls = [];
  const net = createResearchNet({
    fetch: async function (url) {
      urls.push(url);
      return jsonResponse(urls.length === 1
        ? { results: [{ id: 'https://openalex.org/W7', doi: 'https://doi.org/10.1/aaaa.2024', title: 'T' }] }
        : { results: [] });
    }
  });
  const dois = [];
  for (let i = 0; i < 30; i++) dois.push('10.1234/x' + i);
  dois.push('invalid'); // 会被过滤
  const rows = await net.fetchWorksByDois(dois);
  assert.equal(urls.length, 2); // 30 个合法 DOI → 两批
  assert.ok(urls[0].indexOf('filter=doi:') !== -1 || urls[0].indexOf('filter=doi%3A') !== -1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'W7');
});

test('R16: createEndpointGate 串行化并保证最小间隔（假时钟）', async function () {
  const N = require('../electron/research-net.js');
  let clock = 0;
  const sleeps = [];
  const gate = N.createEndpointGate(1000, {
    now: function () { return clock; },
    sleep: async function (ms) { sleeps.push(ms); clock += ms; }
  });
  await gate();
  clock += 200;          // 距上次仅 200ms
  await gate();
  assert.deepEqual(sleeps, [800], '第二次调用补足到 1000ms 间隔');
  clock += 5000;
  await gate();
  assert.equal(sleeps.length, 1, '间隔足够时不 sleep');
});

test('R16: OpenAlex 语义模式走 search.semantic 且受 1req/s 闸门约束；关键词模式仍用 search', async function () {
  const N = require('../electron/research-net.js');
  const calls = [];
  let clock = 0;
  const sleeps = [];
  const net = N.createResearchNet({
    fetch: async function (url) {
      calls.push({ url: url, at: clock });
      return {
        ok: true, status: 200, headers: { get: function () { return null; } },
        json: async function () { return { meta: { count: 1 }, results: [{ id: 'https://openalex.org/W1', title: 'T' }] }; }
      };
    },
    now: function () { return clock; },
    sleep: async function (ms) { sleeps.push(ms); clock += ms; },
    getConfig: async function () { return {}; }
  });
  await net.searchOpenAlex({ query: '一段自然语言研究描述', mode: 'semantic', limit: 5 });
  assert.ok(calls[0].url.indexOf('search.semantic=') !== -1, '语义模式用 search.semantic 参数');
  assert.ok(calls[0].url.indexOf('per_page=5') !== -1);
  await net.searchOpenAlex({ query: 'battery', mode: 'keyword', limit: 5 });
  assert.ok(calls[1].url.indexOf('&search=battery') !== -1 || calls[1].url.indexOf('?search=battery') !== -1);
  assert.ok(calls[1].url.indexOf('search.semantic') === -1, '关键词模式不带 semantic 参数');
  // 两次语义调用之间被闸门拉开 ≥1s
  calls.length = 0;
  await net.searchOpenAlex({ query: 'q2', mode: 'semantic' });
  await net.searchOpenAlex({ query: 'q3', mode: 'semantic' });
  assert.ok(calls[1].at - calls[0].at >= 1000, '语义端点两次发起间隔 ≥1000ms');
});

test('R16: Semantic Scholar 检索带 fields/x-api-key，解析 total/next 并归一化 paper', async function () {
  const N = require('../electron/research-net.js');
  let seen = null;
  const net = N.createResearchNet({
    fetch: async function (url, init) {
      seen = { url: url, headers: (init && init.headers) || {} };
      return {
        ok: true, status: 200, headers: { get: function () { return null; } },
        json: async function () {
          return {
            total: 42, offset: 0, next: 20,
            data: [{
              paperId: 'abc123', title: 'S2 Paper', abstract: 'abs', venue: 'Nature',
              year: 2024, citationCount: 9, url: 'https://www.semanticscholar.org/paper/abc',
              externalIds: { DOI: '10.1038/X' },
              openAccessPdf: { url: 'https://x/y.pdf' },
              publicationTypes: ['JournalArticle'],
              authors: [{ name: 'Zhang' }],
              tldr: { text: '一句话概述' }
            }]
          };
        }
      };
    },
    sleep: async function () {},
    getConfig: async function () { return { semanticscholarApiKey: 'K1' }; }
  });
  const r = await net.searchSemanticScholar({ query: 'q', limit: 20, yearFrom: 2020, yearTo: 2024 });
  assert.ok(seen.url.indexOf('fields=') !== -1, '必须带 fields 才能拿到摘要等字段');
  assert.equal(seen.headers['x-api-key'], 'K1', 'Key 走 x-api-key 头');
  assert.equal(r.total, 42);
  assert.equal(r.hasMore, true);
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].title, 'S2 Paper');
  assert.equal(r.results[0].s2Id, 'abc123');
  assert.equal(r.results[0].doi, '10.1038/x');
  assert.equal(r.results[0].oaUrl, 'https://x/y.pdf');
  assert.equal(r.results[0].pageUrl, 'https://www.semanticscholar.org/paper/abc');
  assert.equal(r.results[0].type, 'article');
  assert.equal(r.results[0].snippet, '一句话概述', 'tldr 进 snippet 而非 abstract');
  assert.equal(r.results[0].abstract, 'abs');
});

test('R16: normalizeSemanticScholarPaper 边界（无 DOI/无 OA/未知类型不硬塞 article）', async function () {
  const LitResearch = require('../js/research.js');
  const row = LitResearch.normalizeSemanticScholarPaper({
    paperId: 'p1', title: 'T', publicationTypes: ['Dataset'], authors: [], tldr: {}
  });
  assert.equal(row.doi, '');
  assert.equal(row.oaUrl, '');
  assert.equal(row.isOa, false);
  assert.equal(row.type, 'dataset');
  assert.equal(row.snippet, '');
  const unknown = LitResearch.normalizeSemanticScholarPaper({ paperId: 'p2', title: 'X', publicationTypes: ['SomethingNew'] });
  assert.equal(unknown.type, '', '认识不了的类型留空而非硬塞 article');
  assert.equal(LitResearch.normalizeSemanticScholarPaper(null).title, '');
});
