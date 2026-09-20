'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const LitCslDoc = require('../js/csldoc.js');
const LitDocx = require('../js/docx.js');

const VENDOR = path.join(__dirname, '..', 'vendor', 'citeproc');
const STYLE = {
  vancouver: fs.readFileSync(path.join(VENDOR, 'styles', 'vancouver.csl'), 'utf8'),
  apa: fs.readFileSync(path.join(VENDOR, 'styles', 'apa.csl'), 'utf8'),
  nature: fs.readFileSync(path.join(VENDOR, 'styles', 'nature.csl'), 'utf8')
};
const LOCALE_EN = fs.readFileSync(path.join(VENDOR, 'locales', 'en-US.xml'), 'utf8');
const LOCALE_ZH = fs.readFileSync(path.join(VENDOR, 'locales', 'zh-CN.xml'), 'utf8');

function paper(id, title, family, year, extra) {
  return Object.assign({
    id: id, title: title, authors: ['J ' + family], year: year, entryType: 'article',
    venue: 'Journal of Tests', volume: '3', pages: '1-10', doi: '10.1/' + id
  }, extra || {});
}

test('vancouver numbering renumbers on insert, move and remove', async function () {
  const doc = LitCslDoc.createDocument({ styleXml: STYLE.vancouver, localeXml: LOCALE_EN, styleId: 'vancouver' });
  await doc.updateLibrary([paper('p1', 'Alpha', 'Smith', 2020), paper('p2', 'Beta', 'Wang', 2021), paper('p3', 'Gamma', 'Li', 2022)]);
  const c1 = await doc.addCitation({ items: [{ paperId: 'p1' }] });
  const c2 = await doc.addCitation({ items: [{ paperId: 'p2' }] });
  assert.equal(c1.text, '[1]');
  assert.equal(c2.text, '[2]');
  // 在中间插入 → 后面重编号
  const cm = await doc.addCitation({ items: [{ paperId: 'p3' }] }, 1);
  assert.equal(cm.text, '[2]');
  assert.equal(doc.getCitationText(c2.citationId), '[3]');
  // 移动到最后到最前
  await doc.moveCitation(c2.citationId, 0);
  assert.equal(doc.getCitationText(c2.citationId), '[1]');
  assert.equal(doc.getCitationText(c1.citationId), '[2]');
  // 删除 → 重编号
  await doc.removeCitation(cm.citationId);
  assert.equal(doc.getCitationText(c2.citationId), '[1]');
  assert.equal(doc.getCitationText(c1.citationId), '[2]');
});

test('apa same-year disambiguation and repeated citation', async function () {
  const doc = LitCslDoc.createDocument({ styleXml: STYLE.apa, localeXml: LOCALE_EN, styleId: 'apa' });
  await doc.updateLibrary([
    paper('a', 'One Study', 'Doe', 2012), paper('b', 'Two Study', 'Doe', 2012), paper('c', 'Three', 'Doe', 2010)
  ]);
  await doc.addCitation({ items: [{ paperId: 'a' }] });
  await doc.addCitation({ items: [{ paperId: 'b' }] });
  await doc.addCitation({ items: [{ paperId: 'c' }] });
  const t1 = await doc.addCitation({ items: [{ paperId: 'a' }] });
  assert.match(t1.text, /2012a/);
  const bib = doc.getBibliography().join('\n');
  assert.match(bib, /2012a/);
  assert.match(bib, /2012b/);
});

test('locators, prefix, suffix and suppress-author', async function () {
  const doc = LitCslDoc.createDocument({ styleXml: STYLE.apa, localeXml: LOCALE_EN, styleId: 'apa' });
  await doc.updateLibrary([paper('p1', 'Alpha', 'Smith', 2020)]);
  const withLocator = await doc.addCitation({ items: [{ paperId: 'p1', locator: '23', label: 'page', prefix: 'see', suffix: 'esp. chap. 2' }] });
  assert.match(withLocator.text, /see/);
  assert.match(withLocator.text, /23/);
  assert.match(withLocator.text, /esp\. chap\. 2/);
  const suppressed = await doc.addCitation({ items: [{ paperId: 'p1', suppressAuthor: true }] });
  assert.doesNotMatch(suppressed.text, /Smith/);
  assert.match(suppressed.text, /2020/);
});

test('multi-item cluster renders combined citation', async function () {
  const doc = LitCslDoc.createDocument({ styleXml: STYLE.apa, localeXml: LOCALE_EN, styleId: 'apa' });
  await doc.updateLibrary([paper('p1', 'Alpha', 'Smith', 2020), paper('p2', 'Beta', 'Wang', 2021)]);
  const r = await doc.addCitation({ items: [{ paperId: 'p1' }, { paperId: 'p2', prefix: 'cf. ' }] });
  assert.match(r.text, /Smith/);
  assert.match(r.text, /Wang/);
});

test('switching style recomputes every citation and bibliography', async function () {
  const doc = LitCslDoc.createDocument({ styleXml: STYLE.vancouver, localeXml: LOCALE_EN, styleId: 'vancouver' });
  await doc.updateLibrary([paper('p1', 'Alpha', 'Smith', 2020), paper('p2', 'Beta', 'Wang', 2021)]);
  const c1 = await doc.addCitation({ items: [{ paperId: 'p1' }] });
  const c2 = await doc.addCitation({ items: [{ paperId: 'p2' }] });
  assert.match(doc.getCitationText(c1.citationId), /^\[1\]$/);
  await doc.setStyle(STYLE.apa, { styleId: 'apa' });
  assert.match(doc.getCitationText(c1.citationId), /Smith/);
  assert.match(doc.getCitationText(c2.citationId), /Wang/);
  assert.match(doc.getBibliography().join(' '), /Smith/);
});

test('missing paper keeps rendering via embedded snapshot and relinks', async function () {
  const doc = LitCslDoc.createDocument({ styleXml: STYLE.apa, localeXml: LOCALE_EN, styleId: 'apa' });
  await doc.updateLibrary([paper('p1', 'Alpha', 'Smith', 2020)]);
  await doc.addCitation({ items: [{ paperId: 'p1' }] });
  // 文献从库中消失（模拟另一台设备删除）：快照兜底仍可读可刷新
  await doc.updateLibrary([]);
  assert.deepEqual(doc.missingItemIds(), ['p1']);
  const still = await doc.addCitation({ items: [{ paperId: 'p1' }] });
  assert.match(still.text, /Smith/);
  assert.match(still.text, /2020/);
  // 重新关联：库内重新出现 → 用库内最新数据
  await doc.relink('p1', paper('p1', 'Alpha', 'Smith', 2020, { venue: 'Nature' }));
  assert.deepEqual(doc.missingItemIds(), []);
  const bib = doc.getBibliography().join(' ');
  assert.match(bib, /Nature/);
});

test('toJSON/fromJSON round-trips identical texts without the library', async function () {
  const doc = LitCslDoc.createDocument({ styleXml: STYLE.vancouver, localeXml: LOCALE_ZH, styleId: 'vancouver', localeId: 'zh-CN' });
  await doc.updateLibrary([paper('p1', 'Alpha', 'Smith', 2020), paper('p2', 'Beta', 'Wang', 2021)]);
  await doc.addCitation({ items: [{ paperId: 'p1', locator: '5', label: 'page' }] });
  await doc.addCitation({ items: [{ paperId: 'p2' }] });
  const json = doc.toJSON();
  assert.equal(json.version, 1);
  assert.equal(json.citations.length, 2);
  assert.equal(json.citations[0].items[0].cslItem.id, 'p1'); // CSL 快照随集群持久化
  const restored = await LitCslDoc.fromJSON(JSON.parse(JSON.stringify(json)), {
    styleXml: STYLE.vancouver, localeXml: LOCALE_ZH, styleId: 'vancouver', localeId: 'zh-CN'
  });
  const ids = json.citations.map(function (c) { return c.id; });
  ids.forEach(function (id, index) {
    assert.equal(restored.getCitationText(id), doc.getCitationText(id));
  });
  assert.deepEqual(restored.getBibliography(), doc.getBibliography());
});

test('updateLibrary refreshes snapshots of cited papers', async function () {
  const doc = LitCslDoc.createDocument({ styleXml: STYLE.apa, localeXml: LOCALE_EN, styleId: 'apa' });
  await doc.updateLibrary([paper('p1', 'Alpha', 'Smith', 2020)]);
  await doc.addCitation({ items: [{ paperId: 'p1' }] });
  await doc.updateLibrary([paper('p1', 'Alpha', 'Smith', 2020, { venue: 'Science' })]);
  const bib = doc.getBibliography().join(' ');
  assert.match(bib, /Science/);
});

/* ---------- 端到端：会话 → docx → 解析恢复 → 同样式文本逐字一致 ---------- */

test('document exports to docx and restores with identical citation texts', async function () {
  const doc = LitCslDoc.createDocument({ styleXml: STYLE.nature, localeXml: LOCALE_EN, styleId: 'nature' });
  await doc.updateLibrary([paper('p1', 'Alpha', 'Smith', 2020), paper('p2', 'Beta', 'Wang', 2021)]);
  await doc.addCitation({ items: [{ paperId: 'p1' }] });
  await doc.addCitation({ items: [{ paperId: 'p2' }] });
  const clusters = doc.toJSON().citations;
  const paragraphs = clusters.map(function (cluster) {
    return { runs: [{ text: '正文 ' }, { citation: { payload: cluster, text: doc.getCitationText(cluster.id) } }, { text: '。' }] };
  });
  paragraphs.push({ runs: [{ text: '参考文献', bold: true }] });
  doc.getBibliography().forEach(function (entry) {
    paragraphs.push({ text: entry.replace(/<[^>]*>/g, '') });
  });
  const bytes = LitDocx.buildDocx(paragraphs);

  const fields = LitDocx.readDocxFields(bytes);
  assert.equal(fields.length, 2);
  assert.equal(fields[0].addin, 'LitBoard.Citation.1');
  assert.match(fields[0].instr, /ADDIN LitBoard\.Citation\.1/);
  assert.equal(fields[0].payload.items[0].paperId, 'p1');
  assert.match(fields[0].text, /1/);

  // 用域 payload 恢复原会话（跨环境：不依赖原库，只靠快照）
  const restored = await LitCslDoc.fromJSON({ citations: fields.map(function (f) { return f.payload; }) }, {
    styleXml: STYLE.nature, localeXml: LOCALE_EN, styleId: 'nature'
  });
  clusters.forEach(function (cluster, index) {
    assert.equal(restored.getCitationText(cluster.id), doc.getCitationText(cluster.id));
  });
});

/* ---------- 写入 Word 用的参考文献段落格式（Zotero 公式） ---------- */

test('getBibliographyFormat: second-field-align 换算成左缩进与制表位（Zotero 公式）', async function () {
  const gbt = fs.readFileSync(path.join(VENDOR, 'styles', 'china-national-standard-gb-t-7714-2015-numeric.csl'), 'utf8');
  const doc = LitCslDoc.createDocument({ styleXml: gbt, localeXml: LOCALE_ZH, styleId: 'gbt' });
  await doc.updateLibrary([paper('p1', 'Alpha', 'Smith', 2020), paper('p2', 'Beta', 'Wang', 2021)]);
  await doc.addCitation({ items: [{ paperId: 'p1' }, { paperId: 'p2' }] });
  // second-field-align="flush" + maxoffset=3 → alignAt = 24 + 3*120 = 384 twips
  assert.deepEqual(doc.getBibliographyFormat(),
    { indent: 384, firstLineIndent: -384, lineSpacing: 1, entrySpacing: 0, tabStops: [384] });
});

test('getBibliographyFormat: hanging-indent 样式（APA）给出 720/-720 与 2 倍行距', async function () {
  const doc = LitCslDoc.createDocument({ styleXml: STYLE.apa, localeXml: LOCALE_EN, styleId: 'apa' });
  await doc.updateLibrary([paper('p1', 'Alpha', 'Smith', 2020)]);
  await doc.addCitation({ items: [{ paperId: 'p1' }] });
  assert.deepEqual(doc.getBibliographyFormat(),
    { indent: 720, firstLineIndent: -720, lineSpacing: 2, entrySpacing: 0, tabStops: [] });
});

test('会话输出保持 html（应用内预览与 docx 导出共用），RTF 只在写 Word 时由 cslcite 转换', async function () {
  const gbt = fs.readFileSync(path.join(VENDOR, 'styles', 'china-national-standard-gb-t-7714-2015-numeric.csl'), 'utf8');
  const doc = LitCslDoc.createDocument({ styleXml: gbt, localeXml: LOCALE_ZH, styleId: 'gbt' });
  await doc.updateLibrary([paper('p1', 'Alpha', 'Smith', 2020), paper('p2', 'Beta', 'Wang', 2021)]);
  const cluster = await doc.addCitation({ items: [{ paperId: 'p1' }, { paperId: 'p2' }] });
  assert.match(cluster.text, /^<sup>\[1/);
  assert.match(doc.getBibliography()[0], /csl-entry/);
});
