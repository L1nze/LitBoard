'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitQuery = require('../js/query.js');

const papers = [
  { id: 'p1', title: 'Attention Is All You Need', authors: ['Ashish Vaswani'], year: 2017,
    entryType: 'article', venue: 'NeurIPS', tags: ['transformer', 'nlp'], citations: 90000, rating: 5,
    status: 'reading', doi: '10.1/abc', abstract: 'self-attention', notes: '里程碑', key: 'vaswani2017' },
  { id: 'p2', title: '深度学习综述', authors: ['Yann LeCun'], year: 2015,
    entryType: 'article', venue: 'Nature', tags: ['综述'], citations: 30000, rating: 4,
    status: 'reading', doi: '', abstract: 'deep learning review', notes: '', key: 'lecun2015' },
  { id: 'p3', title: 'Some obscure draft', authors: [], year: null, venue: '',
    entryType: 'preprint', tags: [], citations: null, rating: 0, status: 'unread', notes: 'todo', key: 'anonnodate',
    pdfPath: 'D:\\x.pdf', deletedAt: 123 }
];

function match(query) {
  const result = LitQuery.parse(query);
  assert.equal(result.error, null, 'parse error: ' + result.error);
  return papers.filter(result.matcher).map(function (p) { return p.id; });
}

test('bare words search across text fields', function () {
  assert.deepEqual(match('attention'), ['p1']);
  assert.deepEqual(match('深度学习'), ['p2']);
  assert.deepEqual(match('lecun'), ['p2']);
  assert.deepEqual(match('综述'), ['p2']); // 命中标签
  assert.deepEqual(match('里程碑'), ['p1']); // 命中笔记
});

test('普通关键词相关度：标题命中优先于摘要顺带命中，并返回可解释片段', function () {
  const titleHit = LitQuery.rankPlainText({
    id: 'title', title: 'Robust SOH estimation for lithium-ion batteries', abstract: 'battery study'
  }, 'soh estimation');
  const abstractHit = LitQuery.rankPlainText({
    id: 'abstract', title: 'A general battery management system',
    abstract: 'The system includes state of health (SOH) estimation and protective operation.'
  }, 'soh estimation');
  assert.equal(titleHit.matched, true);
  assert.equal(titleHit.field, 'title');
  assert.equal(abstractHit.matched, true);
  assert.equal(abstractHit.field, 'abstract');
  assert.ok(titleHit.score > abstractHit.score);
  assert.match(abstractHit.snippet, /SOH.*estimation/i);
});

test('普通关键词相关度保持跨字段 AND 语义；缺任一词则不命中', function () {
  const crossField = LitQuery.rankPlainText({
    title: 'Battery estimation method', tags: ['SOH'], abstract: ''
  }, 'soh estimation');
  const missing = LitQuery.rankPlainText({ title: 'Battery estimation method', abstract: '' }, 'soh estimation');
  assert.equal(crossField.matched, true);
  assert.equal(crossField.field, 'tags', '标题只解释一个词时，应展示另一个隐藏字段的命中原因');
  assert.equal(missing.matched, false);
});

test('implicit AND and explicit boolean operators', function () {
  assert.deepEqual(match('attention vaswani'), ['p1']);
  assert.deepEqual(match('attention AND lecun'), []);
  assert.deepEqual(match('attention OR 深度'), ['p1', 'p2']);
  assert.deepEqual(match('attention NOT vaswani'), []);
  assert.deepEqual(match('transformer -vaswani'), []);
  assert.deepEqual(match('(attention OR 深度) NOT lecun'), ['p1']);
});

test('field matching and numeric comparisons', function () {
  assert.deepEqual(match('venue:Nature'), ['p2']);
  assert.deepEqual(match('author:vaswani'), ['p1']);
  assert.deepEqual(match('tag:综述'), ['p2']);
  assert.deepEqual(match('year>=2016'), ['p1']);
  assert.deepEqual(match('citations>50000'), ['p1']);
  assert.deepEqual(match('rating>=4'), ['p1', 'p2']);
  assert.deepEqual(match('year<2016'), ['p2']);
  assert.deepEqual(match('status:reading'), ['p1', 'p2']);
  assert.deepEqual(match('key:lecun2015'), ['p2']);
  assert.deepEqual(match('type:article status:read'), ['p1', 'p2']); // 旧智能文件夹兼容
});

test('quoted field values stay intact and DOI display labels are accepted', function () {
  const paper = { id: 'p', title: 'Battery health', doi: '10.3969/j.issn.1002-087X.2026.08.015' };
  const queries = [
    'doi:10.3969/j.issn.1002-087X.2026.08.015',
    'doi:"DOI 10.3969/j.issn.1002-087X.2026.08.015"',
    'doi:"DOI: 10.3969/j.issn.1002-087X.2026.08.015"',
    'doi:https://doi.org/10.3969/j.issn.1002-087X.2026.08.015',
    'doi:"https://doi.org/10.3969/j.issn.1002-087X.2026.08.015"'
  ];
  queries.forEach(function (query) {
    const parsed = LitQuery.parse(query);
    assert.equal(parsed.error, null, query);
    assert.equal(parsed.matcher(paper), true, query);
  });
  assert.deepEqual(match('abstract:"deep learning"'), ['p2']);
  assert.match(LitQuery.parse('doi:"DOI 10.3969/abc').error, /引号未闭合/);
});

test('has:/is: flags', function () {
  assert.deepEqual(match('has:doi'), ['p1']);
  assert.deepEqual(match('has:notes'), ['p1', 'p3']);
  assert.deepEqual(match('has:pdf'), ['p3']);
  assert.deepEqual(match('is:trash'), ['p3']);
  assert.deepEqual(match('NOT is:trash has:abstract'), ['p1', 'p2']);
});

test('quoted phrases and regex', function () {
  assert.deepEqual(match('"all you need"'), ['p1']);
  assert.deepEqual(match('/obscure/'), ['p3']); // 正则作用于合并文本域
  assert.deepEqual(match('type:preprint'), ['p3']);
});

test('parse errors are reported not thrown', function () {
  assert.ok(LitQuery.parse('(unbalanced').error);
  assert.ok(LitQuery.parse('"unclosed').error);
  assert.ok(LitQuery.parse('year>abc').error);
  assert.ok(LitQuery.parse('/[invalid/').error);
  assert.equal(LitQuery.parse('').matcher(papers[0]), true);
});

test('isPlainText detects simple queries', function () {
  assert.equal(LitQuery.isPlainText('深度学习'), true);
  assert.equal(LitQuery.isPlainText('year>=2020'), false);
  assert.equal(LitQuery.isPlainText('a OR b'), false);
  assert.equal(LitQuery.isPlainText('battery -health'), false);
  assert.equal(LitQuery.isPlainText('battery-health'), true);
});

/* ---------- 阶段四：AST / 新字段 / 跨层级组 / Unicode 规范化 ---------- */

test('parseAst returns versioned AST and serialize round-trips', function () {
  const ast = LitQuery.parseAst('tag:综述 year>=2020 AND has:pdf');
  assert.equal(ast.v, 3);
  assert.ok(ast.root);
  const text = LitQuery.astToText(ast);
  const again = LitQuery.parseAst(text);
  assert.equal(again.error, undefined);
  const paper = { tags: ['综述'], year: 2021, pdfPath: '/x.pdf' };
  const m1 = LitQuery.compile(ast).matcher;
  const m2 = LitQuery.compile(JSON.parse(LitQuery.serializeAst(ast))).matcher;
  assert.equal(m1(paper), true);
  assert.equal(m2(paper), true);
});

test('search-box parse accepts workspace context for note and folder conditions', function () {
  const context = {
    notes: [{ id: 'n1', paperId: 'p1', title: '实验记录', content: '电池状态估计' }],
    folders: [{ id: 'f1', name: '电池研究', parentId: '' }]
  };
  const paper = { id: 'p1', title: 'Battery paper', folderIds: ['f1'] };
  const matching = LitQuery.parse('note("电池状态") folder:"电池研究"', context);
  assert.equal(matching.error, null);
  assert.equal(matching.matcher(paper), true);
  assert.equal(matching.matcher({ id: 'p2', title: 'Other', folderIds: [] }), false);
});

test('AST text round-trip preserves AND, OR and NOT grouping', function () {
  const cases = [
    { query: '(alpha OR beta) gamma', titles: ['alpha', 'alpha gamma', 'beta gamma'] },
    { query: 'NOT (alpha OR beta)', titles: ['alpha', 'gamma'] },
    { query: 'alpha OR (beta gamma)', titles: ['alpha', 'beta', 'beta gamma'] }
  ];
  cases.forEach(function (item) {
    const original = LitQuery.parseAst(item.query);
    const restored = LitQuery.parseAst(LitQuery.astToText(original));
    assert.equal(original.error, undefined, item.query);
    assert.equal(restored.error, undefined, item.query);
    item.titles.forEach(function (title) {
      const paper = { title: title };
      assert.equal(LitQuery.compile(restored).matcher(paper),
        LitQuery.compile(original).matcher(paper), item.query + ' on ' + title);
    });
  });
});

test('serialized regex AST keeps its pattern and never becomes match-all', function () {
  const source = LitQuery.parseAst('/battery/');
  const restored = JSON.parse(LitQuery.serializeAst(source));
  const matcher = LitQuery.compile(restored).matcher;
  assert.equal(matcher({ title: 'Battery health' }), true);
  assert.equal(matcher({ title: 'Unrelated paper' }), false);
  const legacy = { v: 3, root: { op: 'regex', re: {} } };
  const repaired = LitQuery.repairLegacyRegexAst(legacy, '/battery/');
  assert.equal(LitQuery.compile(repaired).matcher({ title: 'Battery health' }), true);
  assert.equal(LitQuery.compile(repaired).matcher({ title: 'Unrelated paper' }), false);
  assert.equal(LitQuery.compile(legacy).matcher({ title: 'Unrelated paper' }), false);
});

test('plain, notes field and regex searches include every active top-level note', function () {
  const paper = { id: 'p1', title: 'Battery paper', notes: 'first note' };
  const context = {
    notes: [
      { id: 'n1', paperId: 'p1', content: 'first note' },
      { id: 'n2', paperId: 'p1', title: 'Important methods', content: 'second-note keyword' },
      { id: 'n3', paperId: 'p1', content: 'deleted-only', deletedAt: 1 }
    ]
  };
  assert.equal(LitQuery.rankPlainText(paper, 'keyword', context).matched, true);
  assert.equal(LitQuery.parse('notes:keyword', context).matcher(paper), true);
  assert.equal(LitQuery.parse('/second-note/', context).matcher(paper), true);
  assert.equal(LitQuery.parse('methods', context).matcher(paper), true);
  assert.equal(LitQuery.parse('notes:deleted-only', context).matcher(paper), false);
});

test('ann() group requires the SAME annotation to satisfy all inner conditions', function () {
  const paper = {
    pdfAnnotations: [
      { id: 'a1', type: 'highlight', text: '量子纠缠', comment: '', color: '#ffd400', position: { pageIndex: 2 }, tags: [] },
      { id: 'a2', type: 'highlight', text: '量子计算', comment: '重要', color: '#ff6b6b', position: { pageIndex: 4 }, tags: [] }
    ]
  };
  // 同一批注：量子 + 黄色 → 只有 a1 满足
  let compiled = LitQuery.compile(LitQuery.parseAst('ann("量子" color:#ffd400)'));
  assert.equal(compiled.matcher(paper), true);
  compiled = LitQuery.compile(LitQuery.parseAst('ann("量子" color:#5aa9ff)'));
  assert.equal(compiled.matcher(paper), false);
  // 同一批注：量子 + 评论含「重要」→ a2 满足（a1 无评论）
  compiled = LitQuery.compile(LitQuery.parseAst('ann("量子" comment:重要)'));
  assert.equal(compiled.matcher(paper), true);
  // 两个独立 ann 组 = 不同批注各满足：量子(两条都有) + 黄色(a1) → 命中
  compiled = LitQuery.compile(LitQuery.parseAst('ann("量子") ann(color:#ff6b6b)'));
  assert.equal(compiled.matcher(paper), true);
  // 组内数值比较：page:5 → a2 在第 5 页
  compiled = LitQuery.compile(LitQuery.parseAst('ann(page:5)'));
  assert.equal(compiled.matcher(paper), true);
  compiled = LitQuery.compile(LitQuery.parseAst('ann(page:6)'));
  assert.equal(compiled.matcher(paper), false);
});

test('note() group matches notes of the paper via ctx', function () {
  const notes = [
    { id: 'n1', paperId: 'p1', title: '方法笔记', content: '用了材料模拟', deletedAt: null },
    { id: 'n2', paperId: 'p2', title: '其他', content: '无关', deletedAt: null }
  ];
  const ctx = { notes: notes, folders: [] };
  const paper = { id: 'p1' };
  let compiled = LitQuery.compile(LitQuery.parseAst('note("材料")'), ctx);
  assert.equal(compiled.matcher(paper), true);
  compiled = LitQuery.compile(LitQuery.parseAst('note(title:方法)'), ctx);
  assert.equal(compiled.matcher(paper), true);
  compiled = LitQuery.compile(LitQuery.parseAst('note("不存在的词")'), ctx);
  assert.equal(compiled.matcher(paper), false);
  // 另一篇的笔记不影响
  compiled = LitQuery.compile(LitQuery.parseAst('note("材料")'), ctx);
  assert.equal(compiled.matcher({ id: 'p2' }), false);
});

test('unicode normalization matches accents, curly quotes, fullwidth and superscripts', function () {
  const paper = { title: 'Café “深度学习” 模型 ¹²', authors: [], tags: [] };
  const hay = (q) => {
    const compiled = LitQuery.compile(LitQuery.parseAst('"' + q + '"'));
    return compiled.matcher(paper);
  };
  const hayRaw = (query) => LitQuery.compile(LitQuery.parseAst(query)).matcher(paper);
  assert.equal(hay('cafe'), true);           // 重音折叠
  assert.equal(hay('CAFÉ'), true);           // 大小写 + 重音
  assert.equal(hayRaw('“深度学习”'), true);   // 弯引号
  assert.equal(hayRaw('"深度学习"'), true);   // 直引号（规范化后相同）
  assert.equal(hay('12'), true);             // 上标折叠
  assert.equal(hay('ｃａｆｅ'), true);       // 全角折叠
  // 原文显示不被修改
  assert.equal(paper.title, 'Café “深度学习” 模型 ¹²');
  // 正则不规范化
  const reCompiled = LitQuery.compile(LitQuery.parseAst('/café/'));
  assert.equal(reCompiled.matcher(paper), true);
});

test('new fields: folder / lastread compare / missing / has:epub', function () {
  const folders = [
    { id: 'f1', name: '方法', parentId: '' },
    { id: 'f2', name: '实验', parentId: 'f1' }
  ];
  const day = Date.UTC(2024, 0, 15);
  const paper = {
    id: 'p1', folderIds: ['f2'], lastReadAt: day + 3 * 3600 * 1000,
    attachments: [{ kind: 'epub', path: '/x.epub' }], venue: '', tags: []
  };
  const ctx = { notes: [], folders: folders };
  assert.equal(LitQuery.compile(LitQuery.parseAst('folder:"方法"'), ctx).matcher(paper), true); // 子文件夹下钻
  assert.equal(LitQuery.compile(LitQuery.parseAst('lastread:2024-01-15'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('lastread>=2024-01-01'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('lastread>2024-01-15'), ctx).matcher(paper), false);
  assert.equal(LitQuery.compile(LitQuery.parseAst('missing:lastread'), ctx).matcher(paper), false);
  assert.equal(LitQuery.compile(LitQuery.parseAst('missing:lastread'), ctx).matcher({ id: 'p2' }), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('missing:venue'), ctx).matcher(paper), true); // 空字符串算缺失
  assert.equal(LitQuery.compile(LitQuery.parseAst('has:epub'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('has:snapshot'), ctx).matcher(paper), false);
});

test('legacy query strings still parse (backward compatibility)', function () {
  const paper = { title: 'Alpha', year: 2021, tags: ['x'], status: 'read', pdfPath: '/a.pdf', authors: [] };
  const cases = ['alpha', 'year>=2020', 'tag:x', 'has:pdf AND is:read', '(alpha OR beta) NOT gamma'];
  cases.forEach(function (q) {
    const parsed = LitQuery.parse(q);
    assert.equal(parsed.error, null, q);
    assert.equal(parsed.matcher(paper), true, q);
  });
});

test('rowsToText builds queries shared with the text syntax evaluator', function () {
  const rows = [
    { kind: 'field', field: 'tag', cmp: ':', value: '综述' },
    { kind: 'field', field: 'year', cmp: '>=', value: '2020' },
    { kind: 'flag', value: 'pdf' }
  ];
  const text = LitQuery.rowsToText(rows);
  assert.equal(text, 'tag:综述 year>=2020 has:pdf');
  const compiled = LitQuery.compile(LitQuery.parseAst(text));
  assert.equal(compiled.matcher({ tags: ['综述'], year: 2021, pdfPath: '/x' }), true);
  assert.equal(compiled.matcher({ tags: ['综述'], year: 2019, pdfPath: '/x' }), false);
  // OR 连接 + 批注组 + 空值判断 + 短语
  const rows2 = [
    { kind: 'text', value: '深度学习' },
    { join: 'OR', kind: 'ann', value: '"量子" color:#ffd400' },
    { kind: 'missing', field: 'doi' }
  ];
  const text2 = LitQuery.rowsToText(rows2);
  assert.match(text2, /^深度学习 OR ann\("量子" color:#ffd400\) missing:doi$/);
  const compiled2 = LitQuery.compile(LitQuery.parseAst(text2), { notes: [], folders: [] });
  assert.equal(compiled2.matcher({ title: '深度学习', doi: '' }), true);
});

test('AST v3 counts complete notes and attachments and supports stable folder ids', function () {
  const folders = [
    { id: 'f1', name: '同名', parentId: '' },
    { id: 'f2', name: '同名', parentId: 'f1' },
    { id: 'f3', name: '同名', parentId: '' }
  ];
  const notes = [
    { id: 'n1', paperId: 'p1', content: 'first body', deletedAt: null },
    { id: 'n2', paperId: 'p1', content: 'second body', deletedAt: null },
    { id: 'n3', paperId: 'p1', content: 'deleted body', deletedAt: 10 },
    { id: 'n4', paperId: '', content: 'topic body', deletedAt: null }
  ];
  const ctx = { notes: notes, folders: folders };
  const paper = {
    id: 'p1', title: 'Paper', notes: '', folderIds: ['f2'], pdfAnnotations: [],
    attachments: [
      { id: 'a1', kind: 'pdf', fileName: 'main.pdf', path: '/main.pdf' },
      { id: 'a2', kind: 'supp', fileName: 'supp.zip', path: '/supp.zip' }
    ]
  };
  assert.equal(LitQuery.compile(LitQuery.parseAst('has:notes'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('notes>=2'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('notes>=3'), ctx).matcher(paper), false);
  assert.equal(LitQuery.compile(LitQuery.parseAst('"second body"'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('attachments=2'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('attachment(kind:pdf)'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('attachment(kind:epub)'), ctx).matcher(paper), false);
  assert.equal(LitQuery.compile(LitQuery.parseAst('folderid:f1'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('folderid:f3'), ctx).matcher(paper), false);
});

test('entity search returns attachment-scoped navigable hits', function () {
  const workspace = {
    papers: [{ id: 'p1', title: 'Paper', attachments: [
      { id: 'a1', kind: 'pdf', fileName: 'main.pdf', path: '/main.pdf' },
      { id: 'a2', kind: 'supp', fileName: 'supp.zip', path: '/supp.zip' }
    ], pdfAnnotations: [
      { id: 'ann1', type: 'highlight', text: 'quantum', comment: '', attachmentId: 'a1', position: { pageIndex: 4 } },
      { id: 'ann2', type: 'highlight', text: 'other', comment: '', attachmentId: 'a2', position: { pageIndex: 1 } }
    ] }],
    notes: [{ id: 'n1', paperId: '', title: 'Topic', content: 'quantum note', deletedAt: null }], folders: []
  };
  const annotations = LitQuery.searchEntities('ann("quantum")', workspace, { scope: 'annotation', pageSize: 1 });
  assert.equal(annotations.total, 1);
  assert.equal(annotations.items[0].entityId, 'ann1');
  assert.equal(annotations.items[0].attachmentId, 'a1');
  assert.deepEqual(annotations.items[0].target, { paperId: 'p1', attachmentId: 'a1', annotationId: 'ann1', page: 5 });
  const topics = LitQuery.searchEntities('quantum', workspace, { scope: 'note' });
  assert.equal(topics.total, 1);
  assert.equal(topics.items[0].paperId, '');
  assert.equal(topics.items[0].target.noteId, 'n1');
});

test('invalid entity search does not return every entity', function () {
  const workspace = {
    papers: [{ id: 'p1', title: 'Battery', pdfAnnotations: [
      { id: 'a1', text: 'health', position: { pageIndex: 0 } }
    ] }],
    notes: [], folders: []
  };
  const result = LitQuery.searchEntities('title:"unclosed', workspace, { scope: 'annotation' });
  assert.equal(result.total, 0);
  assert.match(result.error, /引号未闭合/);
});

test('F07 回归：author+ann 混合条件实体命中不为空', function () {
  const Q = require('../js/query.js');
  const ws = { papers: [{ id: 'p1', title: 'X', authors: ['Smith'], pdfAnnotations: [
    { id: 'a1', color: '#ffd400', text: 'hello', comment: '', position: { pageIndex: 0 }, attachmentId: 'att1' }
  ] }], notes: [], folders: [] };
  const r = Q.searchEntities('author:Smith ann(color:#ffd400)', ws, { scope: 'annotation' });
  assert.deepEqual(r.items.map(function (i) { return i.entityId; }), ['a1']);
  // author 不匹配时 paper 级不命中 → 无实体
  const r2 = Q.searchEntities('author:Jones ann(color:#ffd400)', ws, { scope: 'annotation' });
  assert.equal(r2.items.length, 0);
});

test('F07 回归：多个独立 ann 组分别命中不同批注（组间独立 ∃）', function () {
  const Q = require('../js/query.js');
  const ws = { papers: [{ id: 'p1', title: 'X', pdfAnnotations: [
    { id: 'a1', color: '#ffd400', text: 'hello', position: { pageIndex: 0 }, attachmentId: 'att1' },
    { id: 'a2', color: '#5aa9ff', text: 'world', position: { pageIndex: 1 }, attachmentId: 'att1' }
  ] }], notes: [], folders: [] };
  // 同一批注不可能同时 color=黄 且 text:world；独立组应命中两条不同批注
  const r = Q.searchEntities('ann(color:#ffd400) ann(text:world)', ws, { scope: 'annotation' });
  assert.deepEqual(r.items.map(function (i) { return i.entityId; }).sort(), ['a1', 'a2']);
});

test('F07 回归：主题笔记查询 has:pdf 不抛异常；纯文本可命中主题笔记', function () {
  const Q = require('../js/query.js');
  const ws = { papers: [], notes: [
    { id: 'n1', paperId: '', title: '主题笔记', content: '机器学习' }
  ], folders: [] };
  const r = Q.searchEntities('has:pdf', ws, { scope: 'note' });
  assert.equal(r.items.length, 0); // 不抛 TypeError
  const r2 = Q.searchEntities('机器学习', ws, { scope: 'note' });
  assert.deepEqual(r2.items.map(function (i) { return i.entityId; }), ['n1']);
});

test('F05 回归：EPUB 批注实体命中 target 携带 epubcfi', function () {
  const Q = require('../js/query.js');
  const ws = { papers: [{ id: 'p1', title: 'X', pdfAnnotations: [
    { id: 'a2', color: '#5aa9ff', text: 'world', position: { cfi: 'epubcfi(/6/4!/2)' }, attachmentId: 'attE1' }
  ] }], notes: [], folders: [] };
  const r = Q.searchEntities('ann(text:world)', ws, { scope: 'annotation' });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].target.epubcfi, 'epubcfi(/6/4!/2)');
});

/* ---------- 检索缓存：命中/失效契约（普通关键词 + AST notes 投影） ---------- */

/* 带 getter 计数的文献：title/abstract 每被读取一次计数 +1，用于观测缓存是否真的跳过了重算；
 * __data 为可变后援存储，配合 updatedAt 抬升模拟「原地编辑」。 */
function countingPaper(id, base, updatedAt) {
  const counts = { abstract: 0, title: 0 };
  const box = { title: (base && base.title) || '', abstract: (base && base.abstract) || '' };
  const paper = Object.assign({ id: id, updatedAt: updatedAt || 100, key: '', authors: [], venue: '',
    abstract: '', notes: '', tags: [] }, base);
  Object.defineProperty(paper, 'title', { enumerable: true, configurable: true,
    get: function () { counts.title++; return box.title; } });
  Object.defineProperty(paper, 'abstract', { enumerable: true, configurable: true,
    get: function () { counts.abstract++; return box.abstract; } });
  paper.__reads = counts;
  paper.__data = box;
  return paper;
}

test('缓存：warm 重复检索不再重读字段 getter；结果与冷算完全一致', function () {
  const paper = countingPaper('cache-warm', { title: 'Battery SOH estimation', abstract: 'state of health' });
  const cold = LitQuery.rankPlainText(paper, 'soh estimation');
  const readsAfterCold = paper.__reads.abstract + paper.__reads.title;
  assert.ok(readsAfterCold > 0);
  const warm = LitQuery.rankPlainText(paper, 'soh estimation');
  assert.equal(paper.__reads.abstract + paper.__reads.title, readsAfterCold, 'warm 命中不应重读字段');
  assert.deepEqual(warm, cold, 'warm 与冷算的 matched/score/field/snippet 完全一致');
});

test('缓存：同 id 同 updatedAt 的替换实例不读旧内容（alpha→beta 各自如实命中）', function () {
  const oldPaper = countingPaper('cache-swap', { title: 'alpha', abstract: 'alpha' }, 77);
  assert.equal(LitQuery.rankPlainText(oldPaper, 'alpha').matched, true);
  assert.equal(LitQuery.rankPlainText(oldPaper, 'beta').matched, false);
  const newPaper = countingPaper('cache-swap', { title: 'beta', abstract: 'beta' }, 77);
  assert.equal(LitQuery.rankPlainText(newPaper, 'beta').matched, true, '替换实例的新内容必须可见（旧缓存是 alpha）');
  assert.equal(LitQuery.rankPlainText(newPaper, 'alpha').matched, false, '不得读到旧实例的 alpha 缓存');
  // 旧实例仍然如实：同键已被新实例占据，旧实例必须重算自己的内容（而不是读新实例的缓存）
  const oldReads = oldPaper.__reads.abstract + oldPaper.__reads.title;
  assert.equal(LitQuery.rankPlainText(oldPaper, 'alpha').matched, true);
  assert.ok(oldPaper.__reads.abstract + oldPaper.__reads.title > oldReads, '旧实例被迫重算');
});

test('缓存：原地编辑 + updatedAt 抬升后重算；clearHaystackCache 清空后重算', function () {
  const paper = countingPaper('cache-bump', { title: 'alpha', abstract: 'alpha' });
  assert.equal(LitQuery.rankPlainText(paper, 'beta').matched, false);
  assert.equal(LitQuery.rankPlainText(paper, 'beta').matched, false);
  paper.__data.abstract = 'beta zebra';
  paper.updatedAt = paper.updatedAt + 1;
  const readsBefore = paper.__reads.abstract;
  assert.equal(LitQuery.rankPlainText(paper, 'beta').matched, true, '原地编辑 + updatedAt 抬升后应重算');
  assert.ok(paper.__reads.abstract > readsBefore);
  assert.equal(LitQuery.rankPlainText(paper, 'beta').matched, true);
  assert.equal(paper.__reads.abstract, readsBefore + 1, '重算一次后再次命中缓存');
  LitQuery.clearHaystackCache();
  const readsCleared = paper.__reads.abstract;
  LitQuery.rankPlainText(paper, 'beta');
  assert.ok(paper.__reads.abstract > readsCleared, 'clearHaystackCache 后应重新读字段');
});

test('缓存：笔记删除（墓碑）后旧 notes 投影失效；上下文撤除回落 paper.notes', function () {
  const paper = countingPaper('cache-note-del', { title: 'alpha', abstract: 'alpha', notes: '' }, 500);
  const n1 = { id: 'n1', paperId: 'cache-note-del', title: 't1', content: 'zebra body', updatedAt: 10 };
  // notesByPaper 的既有契约：只含活跃笔记（app.js / compile / entityHits 构建时都先滤墓碑）
  const ctxOf = function (list) { return { notesByPaper: { 'cache-note-del': list }, folders: [] }; };
  assert.equal(LitQuery.rankPlainText(paper, 'zebra', ctxOf([n1])).matched, true);
  n1.deletedAt = 99; // 墓碑：下一轮构建的活跃列表不含它
  assert.equal(LitQuery.rankPlainText(paper, 'zebra', ctxOf([])).matched, false, '笔记删除后不得命中旧投影');
  n1.deletedAt = null;
  assert.equal(LitQuery.rankPlainText(paper, 'zebra', ctxOf([n1])).matched, true, '恢复后重算可见');
  assert.equal(LitQuery.rankPlainText(paper, 'zebra', null).matched, false, '撤除上下文回落 paper.notes 投影（此处为空）');
  paper.__data.abstract = 'zebra fallback'; // paper.notes 为空 → 用 abstract 保证语义切换本身可命中
  paper.updatedAt = 501;
  assert.equal(LitQuery.rankPlainText(paper, 'zebra', null).matched, true, '无上下文路径按 paper 自身字段求值');
});

test('缓存：编辑较早笔记（max updatedAt 不动）也会失效，不再命中旧 notes 投影', function () {
  const paper = countingPaper('cache-note-edit', { title: 'alpha', abstract: 'alpha' }, 500);
  const n1 = { id: 'n1', paperId: 'cache-note-edit', title: 't1', content: 'plain body', updatedAt: 10 };
  const n2 = { id: 'n2', paperId: 'cache-note-edit', title: 't2', content: 'later body', updatedAt: 1000 };
  const ctxA = { notesByPaper: { 'cache-note-edit': [n1, n2] }, folders: [] };
  assert.equal(LitQuery.rankPlainText(paper, 'zebra', ctxA).matched, false);
  // 只改较早的 n1：条数不变、max(1000) 不变——引用快照必须仍能识别变化
  n1.updatedAt = 20;
  n1.content = 'zebra body';
  assert.equal(LitQuery.rankPlainText(paper, 'zebra', ctxA).matched, true,
    '编辑较早笔记后不得命中旧缓存（count+max 签名会漏检这种场景）');
});

test('缓存：同条数同时间戳的不同笔记子集不共享缓存', function () {
  const paper = countingPaper('cache-note-subset', { title: 'alpha', abstract: 'alpha' }, 500);
  const setA = [
    { id: 'a1', paperId: 'cache-note-subset', title: 't1', content: 'plain', updatedAt: 10 },
    { id: 'a2', paperId: 'cache-note-subset', title: 't2', content: 'plain', updatedAt: 1000 }
  ];
  const setB = [
    { id: 'b1', paperId: 'cache-note-subset', title: 't1', content: 'zebra', updatedAt: 10 },
    { id: 'b2', paperId: 'cache-note-subset', title: 't2', content: 'plain', updatedAt: 1000 }
  ];
  const ctxA = { notesByPaper: { 'cache-note-subset': setA }, folders: [] };
  const ctxB = { notesByPaper: { 'cache-note-subset': setB }, folders: [] };
  assert.equal(LitQuery.rankPlainText(paper, 'zebra', ctxA).matched, false);
  assert.equal(LitQuery.rankPlainText(paper, 'zebra', ctxB).matched, true, '不同笔记引用子集不得串缓存');
});

test('缓存：重建 notesByPaper（新 Map、同笔记引用）仍命中，不重读字段', function () {
  const n1 = { id: 'n1', paperId: 'cache-rebuild', title: 't1', content: 'zebra body', updatedAt: 10 };
  const paper = countingPaper('cache-rebuild', { title: 'alpha', abstract: 'alpha' });
  const ctx1 = { notesByPaper: { 'cache-rebuild': [n1] }, folders: [] };
  assert.equal(LitQuery.rankPlainText(paper, 'zebra', ctx1).matched, true);
  const reads = paper.__reads.abstract + paper.__reads.title;
  const ctx2 = { notesByPaper: { 'cache-rebuild': [n1] }, folders: [] }; // 全新 Map，笔记引用相同
  assert.equal(LitQuery.rankPlainText(paper, 'zebra', ctx2).matched, true);
  assert.equal(paper.__reads.abstract + paper.__reads.title, reads, '重建 notesByPaper 不应导致重算');
});

test('缓存：全空字段文献的空串缓存值可命中（真值判断回归，普通与 AST 两路）', function () {
  const paper = countingPaper('cache-empty', {}, 42);
  assert.equal(LitQuery.rankPlainText(paper, 'anything').matched, false);
  const reads = paper.__reads.abstract;
  assert.equal(LitQuery.rankPlainText(paper, 'anything').matched, false);
  assert.equal(paper.__reads.abstract, reads, '空规范化串（""）也是合法缓存值');
  // AST 无上下文路径（hayCache）：空串值同样必须命中
  const astPaper = countingPaper('cache-empty-ast', {}, 43);
  const matcher = LitQuery.parse('zebra').matcher;
  assert.equal(matcher(astPaper), false);
  const astReads = astPaper.__reads.abstract + astPaper.__reads.title;
  assert.equal(matcher(astPaper), false);
  assert.equal(astPaper.__reads.abstract + astPaper.__reads.title, astReads, 'AST 路径空串 haystack 也命中缓存');
});

test('缓存：AST 多词查询 warm 重复不重拼笔记（notes 投影走缓存）', function () {
  let contentReads = 0;
  const note = { id: 'n1', paperId: 'cache-ast', title: 'note title',
    get content() { contentReads++; return 'alpha beta gamma body'; }, updatedAt: 10 };
  const paper = countingPaper('cache-ast', { title: 'Battery paper', abstract: 'x' }, 300);
  const ctx = { notesByPaper: { 'cache-ast': [note] }, folders: [] };
  const matcher = LitQuery.parse('alpha beta gamma', ctx).matcher;
  assert.equal(matcher(paper), true);
  const readsAfterFirst = contentReads;
  assert.ok(readsAfterFirst > 0, '冷算应至少读取一次笔记内容');
  assert.equal(matcher(paper), true);
  assert.equal(matcher(paper), true);
  assert.equal(contentReads, readsAfterFirst, '同查询重复求值不应重拼笔记（多词也不重拼）');
  // 笔记内容变化（updatedAt 抬升）→ 失效重算
  note.updatedAt = 11;
  assert.equal(matcher(paper), true);
  assert.ok(contentReads > readsAfterFirst, '笔记 updatedAt 变化后应重拼');
});
