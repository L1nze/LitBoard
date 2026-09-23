'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const LitDocx = require('../js/docx.js');

test('buildDocx/readDocxFields round-trips citation fields in document order', async function () {
  const bytes = await LitDocx.buildDocx([
    { text: '前言' },
    { runs: [{ text: '甲说 ' }, { citation: { payload: { version: 1, items: [{ paperId: 'p1' }] }, text: '[1]' } }, { text: '，乙说 ' }, { citation: { payload: { version: 1, items: [{ paperId: 'p2', locator: '3' }] }, text: '[2]' } }, { text: '。' }] },
    { runs: [{ text: '参考文献', bold: true }] },
    { text: 'Smith J. Alpha.' }
  ]);
  const entries = await LitDocx.zipRead(bytes);
  const names = entries.map(function (e) { return e.name; }).sort();
  assert.deepEqual(names, ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);

  const fields = await LitDocx.readDocxFields(bytes);
  assert.equal(fields.length, 2);
  assert.equal(fields[0].addin, 'LitBoard.Citation.1');
  assert.match(fields[0].instr, /^ ADDIN LitBoard\.Citation\.1 "/);
  assert.deepEqual(fields[0].payload, { version: 1, items: [{ paperId: 'p1' }] });
  assert.equal(fields[0].text, '[1]');
  assert.deepEqual(fields[1].payload.items[0], { paperId: 'p2', locator: '3' });
  assert.equal(fields[1].text, '[2]');
});

test('payload JSON with XML-sensitive characters survives the round trip', async function () {
  const payload = { version: 1, items: [{ paperId: 'p1', suffix: 'see <Table> & "Fig. 1"' }] };
  const bytes = await LitDocx.buildDocx([{ runs: [{ citation: { payload: payload, text: '[1]' } }] }]);
  const fields = await LitDocx.readDocxFields(bytes);
  assert.deepEqual(fields[0].payload, payload);
});

test('readDocxFieldsAll includes citation domains in footnotes and endnotes', async function () {
  const field = function (paperId, label) {
    return '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> ADDIN LitBoard.Citation.1 &quot;{&quot;version&quot;:1,&quot;items&quot;:[{&quot;paperId&quot;:&quot;' + paperId + '&quot;}]}</w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>' + label + '</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  };
  const bytes = await LitDocx.zipStore([
    { name: 'word/document.xml', data: '<w:document>' + field('p1', '[1]') + '</w:document>' },
    { name: 'word/footnotes.xml', data: '<w:footnotes>' + field('p2', '[2]') + '</w:footnotes>' },
    { name: 'word/endnotes.xml', data: '<w:endnotes>' + field('p3', '[3]') + '</w:endnotes>' }
  ]);
  const fields = await LitDocx.readDocxFieldsAll(bytes);
  assert.equal(fields.length, 3);
  assert.deepEqual(fields.map(function (item) { return item.part; }), ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml']);
  assert.deepEqual(fields.map(function (item) { return item.text; }), ['[1]', '[2]', '[3]']);
});

test('zip entries reject traversal names', function () {
  assert.throws(function () {
    LitDocx.zipStore([{ name: '../evil.txt', data: 'x' }]);
  }, /非法 ZIP 条目名/);
});

test('zipRead: foreign-crafted traversal entries are sanitized by JSZip on load', async function () {
  // JSZip 3.10.1 loadAsync 对条目名做 sanitizeRelativePath（剥 `..` 与前导斜杠），
  // 所以恶意名字到不了我们的 assertSafeReadName；这里锁定这一行为作为防线事实。
  const JSZip = require('../vendor/jszip/jszip.min.js');
  const zip = new JSZip();
  zip.file('../evil.txt', 'x');
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  const entries = await LitDocx.zipRead(bytes);
  assert.deepEqual(entries.map(function (e) { return e.name; }), ['evil.txt']);
});

test('zipRead inflates deflate (method 8) entries in any environment', async function () {
  const JSZip = require('../vendor/jszip/jszip.min.js');
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document><w:p>压缩内容</w:p></w:document>');
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const entries = await LitDocx.zipRead(bytes);
  assert.equal(entries.length, 1);
  assert.match(Buffer.from(entries[0].data).toString('utf8'), /压缩内容/);
});

test('zipStore output is deterministic for the same entries', async function () {
  const entries = [
    { name: 'b.xml', data: '乙' },
    { name: 'a.xml', data: '甲' }
  ];
  const first = await LitDocx.zipStore(entries);
  const second = await LitDocx.zipStore(entries.slice().reverse());
  assert.deepEqual(Buffer.from(first), Buffer.from(second));
});

/* ---------- 旧格式兼容：替换前自写 stored-ZIP 产出的字节必须仍然可读 ---------- */

test('legacy fixture: pre-JSZip buildDocx bytes still parse (fields + media)', async function () {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-docx-build.bin'));
  const entries = await LitDocx.zipRead(bytes);
  const names = entries.map(function (e) { return e.name; }).sort();
  assert.ok(names.indexOf('word/document.xml') !== -1);
  assert.ok(names.indexOf('word/media/img1.png') !== -1);
  assert.ok(names.indexOf('word/_rels/document.xml.rels') !== -1);
  const fields = await LitDocx.readDocxFields(bytes);
  assert.equal(fields.length, 1);
  assert.deepEqual(fields[0].payload, { version: 1, items: [{ paperId: 'p1' }] });
  assert.equal(fields[0].text, '[1,2]');
});

test('legacy fixture: pre-JSZip multi-story zip keeps footnotes/endnotes fields', async function () {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-docx-stories.bin'));
  const fields = await LitDocx.readDocxFieldsAll(bytes);
  assert.equal(fields.length, 3);
  assert.deepEqual(fields.map(function (item) { return item.part; }),
    ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml']);
  assert.deepEqual(fields.map(function (item) { return item.text; }), ['[1]', '[2]', '[3]']);
});

test('convertZoteroFields maps resolved keys and keeps unmatched embedded snapshots', function () {
  const zoteroField = function (citationID, key, title, year) {
    return {
      instr: ' ADDIN ZOTERO_ITEM CSL_CITATION ' + JSON.stringify({
        citationID: citationID,
        properties: { noteIndex: 1 },
        citationItems: [{
          id: 42,
          uris: ['http://zotero.org/users/local/ab12/items/' + key],
          itemData: { id: 42, type: 'article-journal', title: title, issued: { 'date-parts': [[year]] } },
          locator: '12',
          label: 'page',
          prefix: 'cf. ',
          'suppress-author': false
        }]
      }),
      text: '(Doe, 2020, p. 12)'
    };
  };
  const fields = [
    zoteroField('zc1', 'ITEMKEY1', 'Matched Paper', 2020),
    zoteroField('zc2', 'GONEKEY9', 'Gone Paper', 1999),
    { instr: ' ADDIN LitBoard.Citation.1 "{\\"version\\":1}"', text: '[1]' } // 已有 LitBoard 域原样保留
  ];
  const result = LitDocx.convertZoteroFields(fields, {
    resolveKey: function (key) { return key === 'ITEMKEY1' ? 'zITEMKEY1' : null; }
  });
  assert.equal(result.report.citations, 2);
  assert.equal(result.report.matched, 1);
  assert.equal(result.report.unmatched, 1);
  assert.deepEqual(result.report.missingKeys, ['GONEKEY9']);
  const converted = result.fields[0];
  assert.equal(converted.addin, 'LitBoard.Citation.1');
  assert.equal(converted.payload.items[0].paperId, 'zITEMKEY1');
  assert.equal(converted.payload.items[0].locator, '12');
  assert.equal(converted.payload.items[0].prefix, 'cf. ');
  assert.equal(converted.payload.items[0].cslItem.title, 'Matched Paper'); // 嵌入快照保留
  assert.equal(converted.payload.items[0].cslItem.id, 'zITEMKEY1');
  const unmatched = result.fields[1];
  assert.equal(unmatched.status, 'unmatched');
  assert.equal(unmatched.payload.items[0].paperId, ''); // 保留嵌入快照，等待 UI 选择
  assert.equal(unmatched.payload.items[0].cslItem.title, 'Gone Paper');
  assert.match(result.fields[2].instr, /LitBoard\.Citation\.1/); // 已有 LitBoard 域原样保留
});

test('buildDocxFromFields rebuilds a converted document (new copy)', async function () {
  const zotero = {
    instr: ' ADDIN ZOTERO_ITEM CSL_CITATION ' + JSON.stringify({
      citationID: 'z1',
      properties: {},
      citationItems: [{ id: 1, uris: ['http://zotero.org/users/local/x/items/K1'], itemData: { title: 'T' } }]
    }),
    text: '(Anon)'
  };
  const converted = LitDocx.convertZoteroFields([zotero], { resolveKey: function () { return 'pK1'; } });
  const bytes = await LitDocx.buildDocxFromFields(converted.fields, [{ text: '其余段落' }]);
  const fields = await LitDocx.readDocxFields(bytes);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].addin, 'LitBoard.Citation.1');
  assert.equal(fields[0].payload.items[0].paperId, 'pK1');
  assert.equal(fields[0].text, '(Anon)');
});

test('docx image runs embed media parts with rels', async function () {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4]);
  const bytes = await LitDocx.buildDocx([
    { runs: [{ text: '图文混排' }, { image: { data: png, ext: '.png' } }, { text: ' tail' }] },
    { runs: [{ citation: { payload: { version: 1, items: [{ paperId: 'p1' }] }, text: '[1]' } }] }
  ]);
  const entries = await LitDocx.zipRead(bytes);
  const names = entries.map(function (e) { return e.name; }).sort();
  assert.ok(names.indexOf('word/media/img1.png') !== -1);
  assert.ok(names.indexOf('word/_rels/document.xml.rels') !== -1);
  const rels = entries.filter(function (e) { return e.name === 'word/_rels/document.xml.rels'; })[0];
  assert.match(Buffer.from(rels.data).toString('utf8'), /relationships\/image/);
  const types = entries.filter(function (e) { return e.name === '[Content_Types].xml'; })[0];
  assert.match(Buffer.from(types.data).toString('utf8'), /Extension="png" ContentType="image\/png"/);
  const doc = entries.filter(function (e) { return e.name === 'word/document.xml'; })[0];
  assert.match(Buffer.from(doc.data).toString('utf8'), /<w:drawing>/);
  // 引文域仍可读
  const fields = await LitDocx.readDocxFields(bytes);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].payload.items[0].paperId, 'p1');
});

test('convertZoteroDocxXml swaps Zotero field instructions in place and keeps everything else', function () {
  const zotero = {
    instr: ' ADDIN ZOTERO_ITEM CSL_CITATION ' + JSON.stringify({
      citationID: 'z1',
      properties: {},
      citationItems: [{ id: 1, uris: ['http://zotero.org/users/local/x/items/K1'], itemData: { title: 'T' } }]
    }),
    text: '(Anon)'
  };
  const converted = LitDocx.convertZoteroFields([zotero], { resolveKey: function () { return 'pK1'; } });
  const xml = '<?xml version="1.0"?><w:document xmlns:w="w">' +
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> ADDIN ZOTERO_ITEM CSL_CITATION {&quot;json&quot;}</w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>(Anon)</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
    '<w:p><w:r><w:t>正文保留</w:t></w:r></w:p></w:document>';
  const next = LitDocx.convertZoteroDocxXml(xml, converted.fields);
  assert.match(next, /ADDIN LitBoard\.Citation\.1 &quot;\{&quot;version/);
  assert.doesNotMatch(next, /ZOTERO_ITEM/);
  assert.match(next, /正文保留/);
  assert.match(next, /<w:t>\(Anon\)<\/w:t>/); // 域结果文本保留
  // 未匹配项不消费：原域保留
  const unmatched = LitDocx.convertZoteroFields([zotero], { resolveKey: function () { return null; } });
  const kept = LitDocx.convertZoteroDocxXml(xml, unmatched.fields);
  assert.match(kept, /ZOTERO_ITEM/);
});

test('F08 回归：多段 instrText 拼接（Word 长指令拆段）', async function () {
  const LitDocx = require('../js/docx.js');
  const payload = JSON.stringify({ version: 1, items: [{ paperId: 'p1', cslItem: { id: 'p1' } }] });
  const instr = ' ADDIN LitBoard.Citation.1 "' + payload + '"';
  const mid = Math.floor(instr.length / 2);
  // Word 会把长域指令拆成两个 instrText run
  const xml = '<?xml version="1.0"?><w:document xmlns:w="w"><w:p>' +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve">' + instr.slice(0, mid).replace(/"/g, '&quot;') + '</w:instrText></w:r>' +
    '<w:r><w:instrText xml:space="preserve">' + instr.slice(mid).replace(/"/g, '&quot;') + '</w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>(Smith 2020)</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:document>';
  const fields = await LitDocx.readDocxFields(await LitDocx.zipStore([{ name: 'word/document.xml', data: Buffer.from(xml, 'utf8') }]));
  assert.equal(fields.length, 1);
  assert.equal(fields[0].addin, 'LitBoard.Citation.1');
  assert.equal(fields[0].payload.items[0].paperId, 'p1');
  assert.equal(fields[0].text, '(Smith 2020)');
});

test('F08 回归：PAGE 等非 Zotero 域混排不错位，分段 Zotero 指令完整转换', async function () {
  const LitDocx = require('../js/docx.js');
  function fldChar(t) { return '<w:r><w:fldChar w:fldCharType="' + t + '"/></w:r>'; }
  function instrRun(s) { return '<w:r><w:instrText xml:space="preserve">' + s.replace(/"/g, '&quot;') + '</w:instrText></w:r>'; }
  const zJson = JSON.stringify({ citationID: 'z1', properties: {}, citationItems: [{ id: 1, uris: ['http://zotero.org/users/local/x/items/K1'], itemData: { title: 'T1' } }] });
  // PAGE 域 + Zotero 域（指令拆两段）混排
  const xml = '<?xml version="1.0"?><w:document xmlns:w="w"><w:p>' +
    fldChar('begin') + instrRun(' PAGE ') + fldChar('separate') + '<w:r><w:t>1</w:t></w:r>' + fldChar('end') +
    fldChar('begin') +
    instrRun(' ADDIN ZOTERO_ITEM CSL_CITATION ' + zJson.slice(0, 40)) +
    instrRun(zJson.slice(40)) +
    fldChar('separate') + '<w:r><w:t>(T1)</w:t></w:r>' + fldChar('end') +
    '</w:p></w:document>';
  const fields = LitDocx.convertZoteroFields(
    [{ instr: ' ADDIN ZOTERO_ITEM CSL_CITATION ' + zJson, text: '(T1)' }],
    { resolveKey: function () { return 'pK1'; } }
  ).fields;
  const out = LitDocx.convertZoteroDocxXml(xml, fields);
  assert.match(out, / PAGE /);                                    // PAGE 域完好
  assert.doesNotMatch(out, /ZOTERO_ITEM/);                        // Zotero 域全替换
  assert.match(out, /ADDIN LitBoard\.Citation\.1 &quot;/);        // 新指令写入
  assert.doesNotMatch(out, /citationID/);                         // 分段 JSON 碎片被清空
  // 输出的域仍可被读取且 payload 正确（不多段拼接丢 JSON）
  const reread = await LitDocx.readDocxFields(await LitDocx.zipStore([{ name: 'word/document.xml', data: Buffer.from(out, 'utf8') }]));
  assert.equal(reread.length, 2); // PAGE + LitBoard
  const lit = reread.filter(function (f) { return f.addin === 'LitBoard.Citation.1'; })[0];
  assert.ok(lit && lit.payload.items[0].paperId === 'pK1');
});

/* ---------- 富文本 run 与参考文献段落格式（导出 Word 用） ---------- */

async function documentXml(bytes) {
  const entry = (await LitDocx.zipRead(bytes)).filter(function (e) { return e.name === 'word/document.xml'; })[0];
  return Buffer.from(entry.data).toString('utf8');
}

test('富文本 run：上标/斜体/小型大写转成真正的字符格式，而不是字面标签', async function () {
  const bytes = await LitDocx.buildDocx([{ runs: [
    { text: '[1]' },
    { text: ',2', sup: true },
    { text: ' of ' },
    { text: 'Nature', italic: true },
    { text: ' and ' },
    { text: 'et al', bold: true },
    { text: ' ' },
    { text: 'smith', smallCaps: true },
    { text: ' sub', sub: true }
  ] }]);
  const xml = await documentXml(bytes);
  assert.match(xml, /<w:rPr><w:vertAlign w:val="superscript"\/><\/w:rPr><w:t xml:space="preserve">,2<\/w:t>/);
  assert.match(xml, /<w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">Nature<\/w:t>/);
  assert.match(xml, /<w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">et al<\/w:t>/);
  assert.match(xml, /<w:rPr><w:smallCaps\/><\/w:rPr><w:t xml:space="preserve">smith<\/w:t>/);
  assert.match(xml, /<w:rPr><w:vertAlign w:val="subscript"\/><\/w:rPr>/);
  // 没有任何 HTML 标签残留
  assert.doesNotMatch(xml, /&lt;sup&gt;|<sup>/);
});

test('制表位与换行 run：w:tab / w:br 直接产出，不参与文本', async function () {
  const bytes = await LitDocx.buildDocx([{ runs: [{ text: '[1]' }, { tab: true }, { text: 'HE K.' }, { br: true }, { text: 'next' }] }]);
  const xml = await documentXml(bytes);
  assert.match(xml, /<w:r><w:tab\/><\/w:r>/);
  assert.match(xml, /<w:r><w:br\/><\/w:r>/);
  const fields = await LitDocx.readDocxFields(bytes);
  assert.equal(fields.length, 0);   // 没有域时读回为空，制表位不会混进文本
});

test('引文域的 runs 形态：域结果可以是多个带格式 run，且读回文本仍然正确', async function () {
  const payload = { version: 1, items: [{ paperId: 'p1' }] };
  const bytes = await LitDocx.buildDocx([{ runs: [{ text: '见 ' }, {
    citation: { payload: payload, runs: [{ text: '[1' }, { text: '–3', sup: true }, { text: ']' }] }
  }] }]);
  const fields = await LitDocx.readDocxFields(bytes);
  assert.equal(fields.length, 1);
  assert.deepEqual(fields[0].payload, payload);
  assert.equal(fields[0].text, '[1–3]');            // 域结果文本跨 run 拼接
  assert.match(await documentXml(bytes), /<w:vertAlign w:val="superscript"\/>/);
});

test('引文域只给 text 时按纯文本处理（docx 读回路径的兼容形态）', async function () {
  const bytes = await LitDocx.buildDocx([{ runs: [{ citation: { payload: { version: 1, items: [] }, text: '<sup>[1]</sup>' } }] }]);
  const xml = await documentXml(bytes);
  assert.match(xml, /<w:t xml:space="preserve">&lt;sup&gt;\[1\]&lt;\/sup&gt;<\/w:t>/);
  assert.doesNotMatch(xml, /vertAlign/);
});

test('段落格式：悬挂缩进/制表位/段后距/行距按 twips 落成 w:pPr', async function () {
  const bytes = await LitDocx.buildDocx([
    { runs: [{ text: '[1]' }, { tab: true }, { text: 'Entry' }],
      indent: 384, firstLineIndent: -384, entrySpacing: 240, lineSpacing: 2, tabStops: [384] },
    { runs: [{ text: 'plain' }] }
  ]);
  const xml = await documentXml(bytes);
  assert.match(xml, /<w:p><w:pPr><w:ind w:left="384" w:hanging="384"\/><w:tabs><w:tab w:val="left" w:pos="384"\/><\/w:tabs><w:spacing w:after="240" w:line="480" w:lineRule="auto"\/><\/w:pPr>/);
  // 没有格式的段落不带 pPr（不污染其它段落）
  assert.match(xml, /<w:p><w:r><w:t xml:space="preserve">plain<\/w:t><\/w:r><\/w:p>/);
  // 单倍行距不下发 w:line
  const single = await documentXml(await LitDocx.buildDocx([{ text: 'x', indent: 0, firstLineIndent: 0, lineSpacing: 1, tabStops: [] }]));
  assert.doesNotMatch(single, /w:spacing/);
});
