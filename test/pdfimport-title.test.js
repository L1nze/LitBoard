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
  const calls = { doi: [], title: [], issn: [] };
  // mupdf-worker 的 getPageText 走 StructuredText.walk，返回的是「视觉行」数组：
  // bbox 为 [x0,y0,x1,y1]（MuPDF 左上原点）+ 逐字 quad/size。这里的假 worker
  // 必须产出同一形状，否则 textItemsFromMuPdf 拿不到任何文本。
  function muPage(index) {
    return {
      lines: (pages[index] || []).map(function (value) {
        var size = Math.abs(value.transform[3]) || 1;
        var x = value.transform[4] || 0;
        var top = 800 - (value.transform[5] || 0);
        var text = String(value.str || '');
        var widths = new Float32Array(text.length);
        var quads = new Float32Array(text.length * 8);
        for (var i = 0; i < text.length; i++) {
          widths[i] = size;
          var o = i * 8;
          quads[o] = x; quads[o + 1] = top;
          quads[o + 2] = x + 300; quads[o + 3] = top;
          quads[o + 4] = x; quads[o + 5] = top + size;
          quads[o + 6] = x + 300; quads[o + 7] = top + size;
        }
        return {
          bbox: [x, top, x + 300, top + size],
          wmode: 0,
          dir: [1, 0],
          font: '',
          size: size,
          text: text,
          sizes: widths,
          quads: quads
        };
      })
    };
  }

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
      LitMuPdf: {
        resourceState: function () { return Promise.resolve({ documents: 0 }); },
        open: function () { return Promise.resolve({ id: 1, numPages: pages.length }); },
        close: function () { return Promise.resolve(); },
        pageInfo: function () { return Promise.resolve({ bounds: [0, 0, 600, 800], transform: [1, 0, 0, -1, 0, 800] }); },
        pageText: function (_id, index) { return Promise.resolve(muPage(index)); }
      },
      LitEnrich: {
        byDoi: function (doi) {
          calls.doi.push(doi);
          return Promise.resolve(options.doiPatch || null);
        },
        byTitle: function (title) {
          calls.title.push(title);
          return Promise.resolve(options.titlePatch || null);
        },
        venueByIssn: function (issn) {
          calls.issn.push(issn);
          return Promise.resolve(options.issnVenue || '');
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

  const loaded = loadPdfImport({
    pages: pages,
    doiPatch: {
      source: 'Crossref', titleFromApi: 'Correct DOI Title', doi: doi,
      authorsFromApi: ['Alice'], year: 2026, venue: 'Journal of Testing'
    },
    crypto: { subtle: { digest: function () { return Promise.resolve(new Uint8Array([1, 2, 3]).buffer); } } }
  });
  const paper = await loaded.LitPdf.pdfToPaper({
    name: 'paper.pdf',
    arrayBuffer: function () { return Promise.resolve(new Uint8Array([1, 2, 3])); }
  });

  assert.equal(paper.title, 'Correct DOI Title');
  assert.equal(paper.doi, doi);
  assert.deepEqual(loaded.calls.doi, [doi]);
  assert.deepEqual(loaded.calls.title, []);
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

// 正式出版的中文期刊排版（无“作者：”标签，作者行是标题与摘要之间的裸行）：
// 布局仿自《电源技术》真实页面——y 向上，字号取近似值
const POWER_JOURNAL_PAGE = [
  item('研 究 与 设 计', 10, 774),
  item('基于超声特征与 HHO 优化算法的锂电池 SOE 估计', 16, 729),
  item('1,21,21,21,21,2', 7, 693),
  item('刘素贞 ， 杜兆康 ， 宋光成 ， 徐志成 ，金 亮', 12, 687),
  item('(1. 河北工业大学 智能配用电装备与系统全国重点实验室，天津 300130；', 9, 672),
  item('2. 河北工业大学 河北省电磁场与电器可靠性重点实验室，天津 300130)', 9, 657),
  item('摘要：针对锂电池能量状态(SOE)估计中超声表征体系不完善以及高维特征与网络参数存在强耦合', 9, 624),
  item('关系的问题，构建了融合超声多域特征的哈里斯鹰优化(HHO)算法与卷积神经网络-长短期记忆网络', 9, 609),
  item('关键词：磷酸铁锂电池；能量状态；超声特征；哈里斯鹰优化算法；协同优化', 9, 498),
  item('中图分类号：TM 912 文献标识码：A 文章编号：1002-087 X(2026)08-1486-08', 9, 483),
  item('DOI: 10.3969/j.issn.1002-087X.2026.08.012', 9, 465),
  item('Battery SOE estimation based on ultrasonic features and HHO', 14, 429),
  item('optimization algorithm', 14, 408),
  item('LIU Suzhen, DU Zhaokang, SONG Guangcheng, XU Zhicheng, JIN Liang', 10, 393),
  item('(1. State Key Laboratory of Intelligent Power Distribution Equipment and System, Hebei University of Technology,', 9, 378),
  item('2026.8 Vol.50 No.8', 8, 36),
  item('1486', 8, 33)
];

test('inspectPdf parses unlabeled author line and article code from published journal pages', async function () {
  const loaded = loadPdfImport({ pages: [POWER_JOURNAL_PAGE] });
  const info = await loaded.LitPdf.inspectPdf(null, new Uint8Array([1, 2, 3]));

  assert.equal(info.title, '基于超声特征与 HHO 优化算法的锂电池 SOE 估计');
  assert.deepEqual(Array.from(info.authors), ['刘素贞', '杜兆康', '宋光成', '徐志成', '金亮']);
  assert.equal(info.year, 2026);
  assert.equal(info.volume, '50');
  assert.equal(info.issue, '8');
  assert.equal(info.pages, '1486-1493');
  assert.equal(info.issn, '1002-087X');
  assert.equal(info.doi, '10.3969/j.issn.1002-087X.2026.08.012');
  assert.equal(info.venue, '');
});

test('inspectPdf reads a repeated Chinese journal name from MuPDF page edges', async function () {
  const firstPage = POWER_JOURNAL_PAGE.concat([item('电源技术', 8, 36)]);
  const secondPage = [
    item('研 究 与 设 计', 10, 774),
    item('电源技术', 8, 36),
    item('1494', 8, 33)
  ];
  const loaded = loadPdfImport({ pages: [firstPage, secondPage] });
  const info = await loaded.LitPdf.inspectPdf(null, new Uint8Array([1, 2, 3]));

  assert.equal(info.venue, '电源技术');
});

test('pdfToPaper keeps a MuPDF journal name without calling the ISSN fallback', async function () {
  const firstPage = POWER_JOURNAL_PAGE.concat([item('电源技术', 8, 36)]);
  const secondPage = [
    item('研 究 与 设 计', 10, 774),
    item('电源技术', 8, 36),
    item('1494', 8, 33)
  ];
  const loaded = loadPdfImport({ pages: [firstPage, secondPage] });
  const paper = await loaded.LitPdf.pdfToPaper({
    name: '基于超声特征与HHO优化算法的锂电池SOE估计.pdf',
    arrayBuffer: function () { return Promise.resolve(new Uint8Array([1, 2, 3])); }
  });

  assert.equal(paper.venue, '电源技术');
  assert.deepEqual(loaded.calls.issn, []);
});

// PDF 的文本流顺序不必与视觉位置一致：本例“通信作者”先被抽取，真正作者行仍在标题与摘要之间。
// 不得把“通信作者”里的“作者：”当作全体作者标签，否则单位、摘要和关键词会污染 authors。
const CORRESPONDING_AUTHOR_PAGE = [
  item('不同工况下锂离子电池荷电状态导波检测分析', 16, 729),
  item('通信作者：高杰', 8, 650),
  item('1,21,21,2', 7, 693),
  item('陈天浩，耿萌萌，高杰，吕炎', 12, 687),
  item('(1. 北京工业大学信息科学与技术学院，北京 100124；', 9, 672),
  item('2. 国网电力科学研究院有限公司，北京 100193)', 9, 657),
  item('摘要：锂离子电池内部独特的物理化学特性以及不同的服役工况，对其运行状态的检测评估提出了严苛要求。', 9, 624),
  item('关键词：锂离子电池；荷电状态；导波检测', 9, 498)
];

test('inspectPdf ignores corresponding-author labels and keeps the visual author line', async function () {
  const loaded = loadPdfImport({ pages: [CORRESPONDING_AUTHOR_PAGE] });
  const info = await loaded.LitPdf.inspectPdf(null, new Uint8Array([1, 2, 3]));

  assert.deepEqual(Array.from(info.authors), ['陈天浩', '耿萌萌', '高杰', '吕炎']);
  assert.equal(info.authors.some(function (name) { return /大学|摘要|关键词|电池/.test(name); }), false);
});

test('pdfToPaper falls back to ISSN venue lookup when DOI and title misses', async function () {
  const loaded = loadPdfImport({
    pages: [POWER_JOURNAL_PAGE],
    issnVenue: 'Chinese Journal of Power Sources',
    crypto: { subtle: { digest: function () { return Promise.resolve(new Uint8Array([1, 2, 3]).buffer); } } }
  });
  const paper = await loaded.LitPdf.pdfToPaper({
    name: '基于超声特征与HHO优化算法的锂电池SOE估计.pdf',
    arrayBuffer: function () { return Promise.resolve(new Uint8Array([1, 2, 3])); }
  });

  assert.deepEqual(loaded.calls.issn, ['1002-087X']);
  assert.equal(paper.venue, 'Chinese Journal of Power Sources');
  assert.deepEqual(Array.from(paper.authors), ['刘素贞', '杜兆康', '宋光成', '徐志成', '金亮']);
  assert.equal(paper.year, 2026);
  assert.equal(paper.volume, '50');
  assert.equal(paper.issue, '8');
  assert.equal(paper.pages, '1486-1493');
});

test('pdfToPaper keeps venue empty when ISSN lookup misses too', async function () {
  const loaded = loadPdfImport({
    pages: [POWER_JOURNAL_PAGE],
    crypto: { subtle: { digest: function () { return Promise.resolve(new Uint8Array([1, 2, 3]).buffer); } } }
  });
  const paper = await loaded.LitPdf.pdfToPaper({
    name: '基于超声特征与HHO优化算法的锂电池SOE估计.pdf',
    arrayBuffer: function () { return Promise.resolve(new Uint8Array([1, 2, 3])); }
  });

  assert.equal(paper.venue, '');
  assert.deepEqual(Array.from(paper.authors), ['刘素贞', '杜兆康', '宋光成', '徐志成', '金亮']);
});
