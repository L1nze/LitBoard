'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function item(str, size, y) {
  return { str: str, transform: [0, 0, 0, size, 0, y || 100] };
}

function loadPdfImport(options) {
  options = options || {};
  const pages = options.pages || [];
  const calls = { doi: [], title: [] };
  const doc = {
    numPages: pages.length,
    getPage: function (pageNum) {
      return Promise.resolve({
        getTextContent: function () {
          return Promise.resolve({ items: pages[pageNum - 1] || [] });
        }
      });
    },
    destroy: function () {}
  };
  const pdfjsLib = {
    getDocument: function () {
      return { promise: Promise.resolve(doc) };
    }
  };

  const hostSetTimeout = require('node:timers').setTimeout;
  function unrefSetTimeout(fn, ms) {
    const handle = hostSetTimeout(fn, ms);
    if (handle && typeof handle.unref === 'function') handle.unref();
    return handle;
  }

  const context = {
    console,
    URL,
    Uint8Array,
    Array,
    Math,
    Date,
    Promise,
    setTimeout: unrefSetTimeout,
    document: { baseURI: 'http://localhost/' },
    window: {
      pdfjsLib: pdfjsLib,
      LitEnrich: {
        byDoi: function (doi) {
          calls.doi.push(doi);
          return Promise.resolve(options.doiPatch || null);
        },
        byTitle: function (title) {
          calls.title.push(title);
          return Promise.resolve(options.titlePatch || null);
        }
      },
      crypto: options.crypto || null
    }
  };
  context.window.window = context.window;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js', 'pdfimport.js'), 'utf8'), context);
  return { LitPdf: context.window.LitPdf, calls };
}

const NETWORK_FIRST_PAGE = [
  item('声学技术', 9, 72),
  item('Technical Acoustics', 9, 89),
  item('《声学技术》网络首发论文', 14, 187),
  item('题目：', 10, 245),
  item('超声检测在锂离子电池评价中的应用综述', 10, 245),
  item('作者：', 10, 260),
  item('张丽，蒙训，杜文正，李发智', 10, 260),
  item('DOI：', 10, 276),
  item('10.16300/j.cnki.1000-3630.25121103', 10, 276)
];

const TITLE_PAGE = [
  item('超声检测在锂离子电池评价中的应用综述', 21, 147),
  item('张丽', 15, 184),
  item('摘要：', 9, 229)
];

const BODY_PAGE = [
  item('0 引 言', 14, 556),
  item('在能源短缺与环境恶化的双重压力下', 10.5, 589)
];

test('inspectPdf extracts DOI and title from CNKI network-first cover page', async function () {
  const loaded = loadPdfImport({
    pages: [NETWORK_FIRST_PAGE, TITLE_PAGE, BODY_PAGE]
  });

  const info = await loaded.LitPdf.inspectPdf(null, new Uint8Array([1, 2, 3]));

  assert.equal(info.doi, '10.16300/j.cnki.1000-3630.25121103');
  assert.equal(info.title, '超声检测在锂离子电池评价中的应用综述');
});

test('guessTitle skips network-first banner and chooses title-page headline across first 5 pages', async function () {
  const page1 = [
    item('声学技术', 9, 72),
    item('《声学技术》网络首发论文', 14, 187),
    item('网络首发日期：2026-07-13', 10, 291)
  ];
  const page2 = [
    item('超声检测在锂离子电池评价中的应用综述', 21, 147),
    item('张丽', 15, 184),
    item('摘要：超声检测技术在锂离子电池评价中的应用日益受到重视', 9, 229)
  ];

  const loaded = loadPdfImport({ pages: [page1, page2, BODY_PAGE] });
  const info = await loaded.LitPdf.inspectPdf(null, new Uint8Array([1, 2, 3]));

  assert.equal(info.title, '超声检测在锂离子电池评价中的应用综述');
});

test('pdfToPaper trusts DOI metadata even when local title candidate disagrees', async function () {
  const doi = '10.1234/doi-trust';
  const pages = [
    [
      item('A Local Title That Is Wrong', 20, 120),
      item('DOI：', 10, 240),
      item(doi, 10, 240)
    ],
    [item('Body text of the paper', 10, 200)]
  ];

  const hostSetTimeout = require('node:timers').setTimeout;
  function unrefSetTimeout(fn, ms) {
    const handle = hostSetTimeout(fn, ms);
    if (handle && typeof handle.unref === 'function') handle.unref();
    return handle;
  }

  const calls = { doi: [], title: [] };
  const doc = {
    numPages: pages.length,
    getPage: function (pageNum) {
      return Promise.resolve({
        getTextContent: function () {
          return Promise.resolve({ items: pages[pageNum - 1] || [] });
        }
      });
    },
    destroy: function () {}
  };
  const pdfjsLib = {
    getDocument: function () { return { promise: Promise.resolve(doc) }; }
  };
  const context = {
    console,
    URL,
    Uint8Array,
    Array,
    Math,
    Date,
    Promise,
    setTimeout: unrefSetTimeout,
    document: { baseURI: 'http://localhost/' },
    window: {
      pdfjsLib: pdfjsLib,
      LitEnrich: {
        byDoi: function (d) {
          calls.doi.push(d);
          return Promise.resolve({
            source: 'Crossref',
            titleFromApi: 'Correct DOI Title',
            doi: d,
            authorsFromApi: ['Alice'],
            year: 2026,
            venue: 'Journal of Testing'
          });
        },
        byTitle: function (t) {
          calls.title.push(t);
          return Promise.resolve(null);
        }
      },
      crypto: { subtle: { digest: function () { return Promise.resolve(new Uint8Array([1, 2, 3]).buffer); } } }
    }
  };
  context.window.window = context.window;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js', 'pdfimport.js'), 'utf8'), context);

  const paper = await context.window.LitPdf.pdfToPaper({
    name: 'paper.pdf',
    arrayBuffer: function () { return Promise.resolve(new Uint8Array([1, 2, 3])); }
  });

  assert.equal(paper.title, 'Correct DOI Title');
  assert.equal(paper.doi, doi);
  assert.deepEqual(calls.doi, [doi]);
  assert.deepEqual(calls.title, []);
});


const CHINESE_META_PAGES = [
  [
    item('声学技术', 9, 72),
    item('《声学技术》网络首发论文', 14, 187),
    item('题目：', 10, 245),
    item('超声检测在锂离子电池评价中的应用综述', 10, 245),
    item('作者：', 10, 260),
    item('张丽，蒙训，杜文正，李发智', 10, 260),
    item('DOI：', 10, 276),
    item('10.16300/j.cnki.1000-3630.25121103', 10, 276),
    item('网络首发日期：', 10, 291),
    item('2026-07-13', 10, 291),
    item('引用格式：', 10, 307),
    item('张丽，蒙训，杜文正，李发智．超声检测在锂离子电池评价中的应用综述[J/OL]．声学技术.', 10, 309)
  ],
  [
    item('超声检测在锂离子电池评价中的应用综述', 21, 147),
    item('张丽', 15, 184),
    item('摘要：', 9, 229),
    item('超声检测技术在锂离子电池评价中的应用日益受到重视。随着电池技术的不断发展，确保其安全性与性能变得尤为重要。', 9, 245),
    item('关键词：', 9, 290),
    item('超声检测；锂离子电池；荷电状态；健康状态', 9, 305),
    item('中图分类号：', 9, 305),
    item('TB559', 9, 305),
    item('0 引 言', 14, 556)
  ],
  [item('正文内容', 10.5, 589)]
];

test('inspectPdf extracts Chinese journal metadata from CNKI network-first pages', async function () {
  const loaded = loadPdfImport({ pages: CHINESE_META_PAGES });
  const info = await loaded.LitPdf.inspectPdf(null, new Uint8Array([1, 2, 3]));

  assert.equal(info.title, '超声检测在锂离子电池评价中的应用综述');
  assert.deepEqual(Array.from(info.authors), ['张丽', '蒙训', '杜文正', '李发智']);
  assert.equal(info.abstract, '超声检测技术在锂离子电池评价中的应用日益受到重视。随着电池技术的不断发展，确保其安全性与性能变得尤为重要。');
  assert.equal(info.venue, '声学技术');
  assert.equal(info.year, 2026);
});

test('pdfToPaper uses locally parsed Chinese metadata when network lookup misses', async function () {
  const loaded = loadPdfImport({
    pages: CHINESE_META_PAGES,
    crypto: { subtle: { digest: function () { return Promise.resolve(new Uint8Array([1, 2, 3]).buffer); } } }
  });
  const paper = await loaded.LitPdf.pdfToPaper({
    name: '超声检测在锂离子电池评价中的应用综述_张丽.pdf',
    arrayBuffer: function () { return Promise.resolve(new Uint8Array([1, 2, 3])); }
  });

  assert.equal(paper.title, '超声检测在锂离子电池评价中的应用综述');
  assert.deepEqual(Array.from(paper.authors), ['张丽', '蒙训', '杜文正', '李发智']);
  assert.equal(paper.abstract, '超声检测技术在锂离子电池评价中的应用日益受到重视。随着电池技术的不断发展，确保其安全性与性能变得尤为重要。');
  assert.equal(paper.venue, '声学技术');
  assert.equal(paper.year, 2026);
});
