'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

function loadPdfSearchModule(windowOverrides) {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(root, 'js', 'pdfsearch.js'), 'utf8');
  const context = { window: Object.assign({}, windowOverrides) };
  vm.runInNewContext(source, context);
  return context.window.LitPdfSearch;
}

/** 桌面桥接桩：meta 空（全部视为待建索引），extractText 返回固定两页文本 */
function fakeDesktopBridge() {
  const puts = [];
  return {
    puts: puts,
    litboardDesktop: {
      pdfSearchMeta: function () { return Promise.resolve({}); },
      readFileBytes: function () { return Promise.resolve(new Uint8Array([37, 37, 69, 79, 70])); },
      pdfSearchPut: function (entry) { puts.push(entry); return Promise.resolve({}); },
      pdfSearchQuery: function () { return Promise.resolve([]); }
    },
    LitPdf: {
      load: function () { return Promise.resolve(); },
      extractText: function () { return Promise.resolve({ pages: ['hello world', 'second page'] }); }
    }
  };
}

test('cross-library search module loads and scans page texts', function () {
  const module = loadPdfSearchModule();
  assert.ok(module);

  assert.equal(module.scanTexts('attention', [
    'Attention is all you need',
    'no match here',
    'More about attention mechanisms'
  ]).join(','), '0,2');
  assert.equal(module.scanTexts('attention', []).length, 0);
  assert.equal(module.scanTexts('', ['attention']).length, 0);
  assert.equal(module.scanTexts('  attention  ', ['Attention!']).join(','), '0');
});

test('cross-library search requires pdfPath candidates and empty query short-circuits', function () {
  const module = loadPdfSearchModule();
  return module.search('anything', [{ id: 'a', pdfPath: 'x.pdf' }]).then(function (hits) {
    assert.ok(Array.isArray(hits));
  });
});

test('reindex builds missing entries, reports progress, and skips fresh ones on repeat', async function () {
  const bridge = fakeDesktopBridge();
  const module = loadPdfSearchModule(bridge);
  const papers = [{ id: 'p1', attachments: [{ id: 'a1', kind: 'pdf', path: 'D:/x/one.pdf', fingerprint: 'f1' }] }];
  const progress = [];
  const first = await module.reindex(papers, function (p) { progress.push(p); });
  assert.deepEqual(Object.assign({}, first), { indexed: 1, total: 1, stale: 1 });
  assert.equal(bridge.puts.length, 1);
  assert.equal(bridge.puts[0].paperId, 'p1');
  assert.equal(bridge.puts[0].attachmentId, 'a1');
  assert.equal(bridge.puts[0].method, 'mupdf');
  assert.equal(bridge.puts[0].pages.length, 2);
  assert.equal(progress.length, 1);
  assert.deepEqual(Object.assign({}, progress[0]), { done: 1, total: 1, title: '' });

  const second = await module.reindex(papers);
  assert.equal(second.stale, 0);
  assert.equal(bridge.puts.length, 1, '指纹未变不应重复提取');

  papers[0].attachments[0].fingerprint = 'f2';
  const third = await module.reindex(papers);
  assert.equal(third.stale, 1);
  assert.equal(bridge.puts.length, 2, '指纹变化后应重新提取');
});

test('reindex without desktop bridge short-circuits', async function () {
  const module = loadPdfSearchModule();
  const result = await module.reindex([{ id: 'a', pdfPath: 'x.pdf' }]);
  assert.deepEqual(Object.assign({}, result), { indexed: 0, total: 0, stale: 0 });
});

test('pdfimport exposes word-level search fragments and a search highlight layer', function () {
  const source = fs.readFileSync(path.join(root, 'js', 'pdfimport.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(source, /matches\.push\(\{ fragments: fragments, text: text \}\)/);
  assert.match(source, /renderSearchLayer: renderSearchLayer/);
  assert.match(source, /extractText: extractText/);
  assert.match(source, /opts\.onSheetRendered\s*\(\s*sheet,\s*pageNumber - 1\s*\)/);
  assert.match(html, /js\/pdfsearch\.js/);
  assert.match(html, /id="btn-ft"/);
});
