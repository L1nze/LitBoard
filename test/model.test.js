'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitModel = require('../js/model.js');

test('normalizePaper repairs unsafe and malformed backup fields and maps legacy read status', function () {
  const paper = LitModel.normalizePaper({
    id: '" onclick=alert(1)',
    title: 42,
    authors: 'not-an-array',
    tags: ['综述', '综述', 3],
    status: 'broken',
    rating: 99,
    citations: -1,
    url: 'javascript:alert(1)'
  }, function () { return 'psafe'; });
  assert.equal(paper.id, 'psafe');
  assert.equal(paper.title, '42');
  assert.deepEqual(paper.authors, []);
  assert.deepEqual(paper.tags, ['综述', '3']);
  assert.equal(paper.status, 'unread');
  assert.equal(paper.rating, 5);
  assert.equal(paper.citations, null);
  assert.equal(paper.url, '');
  assert.equal(LitModel.normalizePaper({ id: 'p1', title: 'Paper', status: 'read' }).status, 'reading');
});

test('normalizeLibrary accepts raw arrays and backup envelopes; envelope carries schema version', function () {
  const source = [{ id: 'p1', title: 'Paper', authors: [] }];
  assert.equal(LitModel.normalizeLibrary(source).length, 1);
  assert.equal(LitModel.normalizeLibrary({ schemaVersion: 1, papers: source }).length, 1);
  assert.deepEqual(LitModel.normalizeLibrary({ papers: 'bad' }), []);
  const value = LitModel.envelope([{ id: 'p1', title: 'Paper', status: 'invalid' }]);
  assert.equal(value.schemaVersion, LitModel.SCHEMA_VERSION);
  assert.equal(value.papers[0].status, 'unread');
  assert.match(value.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('workspace normalizes folders and paper folder assignments, preserving nesting and breaking cycles', function () {
  const value = LitModel.normalizeWorkspace({
    folders: [{ id: 'f1', name: 'Methods' }, { id: 'bad id', name: 'Ignored' }],
    papers: [{ id: 'p1', title: 'Paper', folderIds: ['f1', 'f1', 'orphan'] }]
  });
  assert.equal(value.folders.length, 1);
  assert.equal(value.folders[0].id, 'f1');
  assert.equal(value.folders[0].name, 'Methods');
  assert.equal(value.folders[0].parentId, '');
  assert.equal(value.folders[0].sortIndex, 0);
  assert.equal(typeof value.folders[0].updatedAt, 'number');
  assert.equal(value.folders[0].deletedAt, null);
  assert.deepEqual(value.papers[0].folderIds, ['f1']);
  const folders = LitModel.normalizeFolders([
    { id: 'root', name: 'Root' },
    { id: 'child', name: 'Child', parentId: 'root' },
    { id: 'a', name: 'A', parentId: 'b' },
    { id: 'b', name: 'B', parentId: 'a' },
    { id: 'orphan', name: 'Orphan', parentId: 'missing' }
  ]);
  const byId = Object.fromEntries(folders.map(function (folder) { return [folder.id, folder]; }));
  assert.equal(byId.child.parentId, 'root');
  assert.equal(byId.orphan.parentId, '');
  assert.ok(!byId.a.parentId || !byId.b.parentId);
});

test('normalizePaper strips Zotero noise tags and normalizes journal-rank cache and flags', function () {
  const tagPaper = LitModel.normalizePaper({
    id: 'p1', title: 'Paper', tags: ['/unread', '🌟 No DOI found', '🌟starred', '机器学习']
  });
  assert.deepEqual(tagPaper.tags, ['机器学习']);
  const rankPaper = LitModel.normalizePaper({
    id: 'p1', title: 'Paper', journalRank: { abbr: 'Nature', xr: '1', xrTop: '新锐 Top', beihe: '北大核心', imf: 48.5, jci: 11.14 }
  });
  assert.deepEqual(rankPaper.journalRank, {
    abbr: 'Nature', jcr: '', cas: '', casTop: '', xr: '1', xrTop: 'Top', beihe: '北核', imf: 48.5, jci: 11.14, updatedAt: null
  });
  const flagPaper = LitModel.normalizePaper({
    id: 'p1', title: 'Paper', journalRank: {
      xr: '未收录', xrTop: '未收录Top', beihe: '未收录', imf: 0, jcr: '未收录'
    }
  });
  assert.equal(flagPaper.journalRank, null);
});

test('normalizePaper validates annotation PDF coordinates and preserves remote asset metadata', function () {
  const annPaper = LitModel.normalizePaper({
    id: 'p1', title: 'Paper', pdfAnnotations: [
      { id: 'a1', type: 'underline', color: '#FFAA00', text: 'quote', comment: 'note',
        position: { pageIndex: 2, rects: [[30, 40, 10, 20]] }, createdAt: 10, updatedAt: 20 },
      { id: 'broken', position: { pageIndex: -1, rects: [] } }
    ]
  });
  assert.deepEqual(annPaper.pdfAnnotations, [{
    id: 'a1', type: 'underline', color: '#ffaa00', attachmentId: '', tags: [], text: 'quote', comment: 'note',
    position: { pageIndex: 2, rects: [[10, 20, 30, 40]] }, createdAt: 10, updatedAt: 20
  }]);
  const hash = 'a'.repeat(64);
  const assetPaper = LitModel.normalizePaper({ id: 'p-assets', attachments: [
    { id: 'a1', kind: 'pdf', fileName: 'paper.pdf', cloudName: 'p-assets.pdf', cloudHash: hash, cloudSize: 12 }
  ], pdfAnnotations: [{ id: 'n1', type: 'snapshot', cloudName: 'snapshots/p-assets/n1.png', cloudHash: hash, cloudSize: 8,
    position: { pageIndex: 0, rects: [[1, 2, 3, 4]] } }] });
  assert.equal(assetPaper.attachments[0].cloudHash, hash);
  assert.equal(assetPaper.attachments[0].cloudSize, 12);
  assert.equal(assetPaper.pdfAnnotations[0].cloudName, 'snapshots/p-assets/n1.png');
  assert.equal(assetPaper.pdfAnnotations[0].cloudHash, hash);
  assert.equal(assetPaper.pdfAnnotations[0].cloudSize, 8);
});

test('citation keys: lowercase family name and year, imported keys, disambiguation and pinned precedence', function () {
  assert.equal(LitModel.citationKeyBase({ authors: ['Ada Lovelace'], year: 1843 }), 'lovelace1843');
  assert.equal(LitModel.citationKeyBase({ authors: ['Lovelace, Ada'], year: 1843 }), 'lovelace1843');
  assert.equal(LitModel.citationKeyBase({ authors: ['José García'], year: 2024 }), 'garcia2024');
  assert.equal(LitModel.citationKeyBase({ authors: ['张三'], year: 2025 }), 'zhangsan2025');
  assert.equal(LitModel.citationKeyBase({ authors: ['欧阳娜娜'], year: 2025 }), 'ouyangnana2025');
  assert.equal(LitModel.citationKeyBase({ authors: [], year: null }), 'anonnodate');
  const papers = LitModel.normalizeLibrary([
    { id: 'p1', key: 'ImportedKey', title: 'First', authors: ['Ada Lovelace'], year: 1843 },
    { id: 'p2', key: 'OtherKey', title: 'Second', authors: ['Ada Lovelace'], year: 1843 },
    { id: 'p3', title: 'Third', authors: ['Ada Lovelace'], year: 1843 },
    { id: 'p4', title: 'Fourth', authors: ['Ada Lovelace'], year: 1843 }
  ]);
  assert.deepEqual(papers.map(function (paper) { return paper.key; }),
    ['ImportedKey', 'OtherKey', 'lovelace1843', 'lovelace1843a']);
  const pinned = LitModel.normalizeLibrary([
    { id: 'p1', key: 'smith2020', title: 'A', authors: ['John Smith'], year: 2020 },
    { id: 'p2', key: 'smith2020', keyPinned: true, title: 'B', authors: ['Jane Smith'], year: 2020 }
  ]);
  assert.equal(pinned[1].key, 'smith2020'); // 钉住者保住原 key
  assert.equal(pinned[0].key, 'smith2020a'); // 未钉住者让位
});

test('normalizePaper migrates legacy PDF fields into a primary attachment and keeps supplementary ones', function () {
  const paper = LitModel.normalizePaper({
    id: 'p1', title: 'Paper', pdfPath: 'D:\\docs\\a.pdf', pdfFileName: 'a.pdf',
    pdfFingerprint: 'A'.repeat(64), pdfCloudName: 'p1.pdf', pdfSyncSignature: '12:34'
  });
  assert.equal(paper.attachments.length, 1);
  assert.equal(paper.attachments[0].kind, 'pdf');
  assert.equal(paper.attachments[0].path, 'D:\\docs\\a.pdf');
  assert.equal(paper.attachments[0].fingerprint, 'a'.repeat(64));
  // 旧字段从主附件回填，保持兼容
  assert.equal(paper.pdfPath, 'D:\\docs\\a.pdf');
  assert.equal(paper.pdfFingerprint, 'a'.repeat(64));
  assert.equal(paper.pdfCloudName, 'p1.pdf');
  const suppPaper = LitModel.normalizePaper({
    id: 'p1', title: 'Paper', pdfPath: 'D:\\docs\\a.pdf',
    attachments: [
      { id: 'att1', kind: 'supp', fileName: 'code.zip', path: 'D:\\docs\\code.zip' }
    ]
  });
  assert.equal(suppPaper.attachments.length, 2);
  assert.equal(suppPaper.attachments[0].kind, 'pdf'); // 迁移的主 PDF 排最前
  assert.equal(suppPaper.attachments[1].id, 'att1');
});

test('normalizePaper carries v8 fields and tombstone timestamps', function () {
  const paper = LitModel.normalizePaper({
    id: 'p1', title: 'Paper', issue: '3', publisher: 'ACM', issn: '1234-5678',
    isbn: '978-0-13-468599-1', edition: '2', language: 'en',
    relatedIds: ['p2', 'p1', 'bad id!'], updatedAt: 100, deletedAt: 200, addedAt: 50
  }, function () { return 'pfallback'; });
  assert.equal(paper.issue, '3');
  assert.equal(paper.publisher, 'ACM');
  assert.equal(paper.isbn, '978-0-13-468599-1');
  assert.deepEqual(paper.relatedIds, ['p2']); // 自引用与非法 id 被剔除
  assert.equal(paper.updatedAt, 100);
  assert.equal(LitModel.touch(paper).updatedAt >= 200, true);
});

test('normalizePaper preserves unknown source types and accepts supported entry types', function () {
  const cases = [
    { input: 'video', entryType: 'misc', sourceType: 'video' },
    { input: 'dataset', entryType: 'misc', sourceType: 'dataset' },
    { input: 'mastersthesis', entryType: 'mastersthesis', sourceType: '' },
    { input: 'article', entryType: 'article', sourceType: '' }
  ];
  for (const scenario of cases) {
    const paper = LitModel.normalizePaper({ title: 'P', entryType: scenario.input });
    assert.equal(paper.entryType, scenario.entryType, scenario.input);
    assert.equal(paper.sourceType, scenario.sourceType, scenario.input);
  }
});

test('workspace normalizes saved searches and tag colors and preserves their sync metadata', function () {
  const ws = LitModel.normalizeWorkspace({
    papers: [],
    savedSearches: [{ id: 's1', name: '近三年高引', query: 'year>=2021 rating>=4' }, { name: '', query: 'x' }],
    tagColors: { 综述: '#FFAA00', bad: 'red' }
  });
  assert.equal(ws.savedSearches.length, 1);
  assert.equal(ws.savedSearches[0].query, 'year>=2021 rating>=4');
  assert.deepEqual(ws.tagColors, { 综述: '#ffaa00' });
  const syncWs = LitModel.normalizeWorkspace({
    papers: [],
    savedSearches: [{ id: 's1', name: '近三年高引', query: 'year>=2023', updatedAt: 100, deletedAt: 200 }],
    tagColors: { 综述: '#ffaa00' },
    tagColorRecords: [
      { tag: '综述', color: '#ffaa00', updatedAt: 100 },
      { tag: '旧标签', color: '#112233', updatedAt: 100, deletedAt: 200 }
    ]
  });
  assert.equal(syncWs.savedSearches[0].updatedAt, 100);
  assert.equal(syncWs.savedSearches[0].deletedAt, 200);
  assert.deepEqual(syncWs.tagColors, { 综述: '#ffaa00' });
  assert.equal(syncWs.tagColorRecords.length, 2);
  assert.equal(syncWs.tagColorRecords[1].deletedAt, 200);
});

test('workspace change tracking touches only changed entities', function () {
  const workspace = LitModel.normalizeWorkspace({
    papers: [{ id: 'p1', title: 'One', updatedAt: 100 }, { id: 'p2', title: 'Two', updatedAt: 100 }],
    folders: [{ id: 'f1', name: 'Folder', updatedAt: 100 }]
  });
  const signatures = LitModel.workspaceSignatures(workspace);
  workspace.papers[1].notes = 'changed';
  LitModel.touchWorkspaceChanges(workspace, signatures, 500);
  assert.equal(workspace.papers[0].updatedAt, 100);
  assert.equal(workspace.papers[1].updatedAt, 500);
  assert.equal(workspace.folders[0].updatedAt, 100);
});

test('normalizePaper validates fingerprints and bibtex extras and strips publisher-only venue names', function () {
  assert.equal(LitModel.normalizePaper({ title: 'Paper', pdfFingerprint: 'A'.repeat(64) }).pdfFingerprint, 'a'.repeat(64));
  assert.equal(LitModel.normalizePaper({ title: 'Paper', pdfFingerprint: 'not-a-hash' }).pdfFingerprint, '');
  const extraPaper = LitModel.normalizePaper({
    title: 'Paper',
    bibtexExtra: { keywords: 'ai, import', eprint: 1234, badKeyWithSpace: 'keep', empty: '' }
  });
  assert.deepEqual(extraPaper.bibtexExtra, {
    badkeywithspace: 'keep',
    eprint: '1234',
    keywords: 'ai, import'
  });
  assert.equal(LitModel.normalizePaper({ title: 'P', venue: 'Elsevier' }).venue, '');
  assert.equal(LitModel.normalizePaper({ title: 'P', venue: 'Elsevier Ltd.' }).venue, '');
  assert.equal(LitModel.normalizePaper({ title: 'P', venue: 'Springer' }).venue, '');
  assert.equal(LitModel.normalizePaper({ title: 'P', venue: 'Taylor & Francis' }).venue, '');
  assert.equal(LitModel.normalizePaper({ title: 'P', venue: 'Elsevier' }).venue, '');
  assert.equal(LitModel.normalizePaper({ title: 'P', venue: 'Journal of Molecular Biology' }).venue, 'Journal of Molecular Biology');
  assert.equal(LitModel.normalizePaper({ title: 'P', venue: '  Nature  ' }).venue, 'Nature');
  assert.equal(LitModel.normalizePaper({ title: 'P', venue: '' }).venue, '');
});

/* ---------- schema v12：结构化创作者 / 完整日期 / Note 实体 / 批注附件关联 ---------- */

test('v12 creators: authors project from structured creators and legacy strings parse back', function () {
  const paper = LitModel.normalizePaper({
    title: 'T',
    creators: [
      { creatorType: 'author', family: 'Vaswani', given: 'Ashish' },
      { creatorType: 'editor', family: 'Editor', given: 'Erin' },
      { creatorType: 'author', name: 'World Health Organization' }
    ]
  });
  assert.equal(paper.creators.length, 3);
  assert.deepEqual(paper.authors, ['Vaswani, Ashish', 'World Health Organization']);
  const legacyPaper = LitModel.normalizePaper({
    title: 'T',
    authors: ['Zhang San', '李四', 'World Health Organization', 'Smith, John']
  });
  assert.deepEqual(legacyPaper.creators.map(function (c) { return [c.family, c.given, c.name]; }), [
    ['San', 'Zhang', ''],
    ['李四', '', ''],
    ['', '', 'World Health Organization'],
    ['Smith', 'John', '']
  ]);
  assert.deepEqual(legacyPaper.authors, ['San, Zhang', '李四', 'World Health Organization', 'Smith, John']);
});

test('v12 date is authoritative with year as projection; validation follows the real calendar', function () {
  const full = LitModel.normalizePaper({ title: 'T', date: '2021-03-15', year: 1999 });
  assert.equal(full.year, 2021);
  assert.equal(full.date, '2021-03-15');
  const legacy = LitModel.normalizePaper({ title: 'T', year: 2017 });
  assert.equal(legacy.date, '2017');
  assert.equal(legacy.year, 2017);
  const invalid = LitModel.normalizePaper({ title: 'T', date: '2021-13-99', year: 3001 });
  assert.equal(invalid.date, '');
  assert.equal(invalid.year, null);
  const partial = LitModel.normalizePaper({ title: 'T', date: '2020-07' });
  assert.equal(partial.date, '2020-07');
  assert.equal(partial.year, 2020);
  assert.equal(LitModel.normalizeDate('2024-02-29'), '2024-02-29');
  assert.equal(LitModel.normalizeDate('2023-02-29'), '');
  assert.equal(LitModel.normalizeDate('2024-04-31'), '');
  assert.equal(LitModel.normalizeDate('2024-06-31'), '');
});

test('v12 notes: shape validation keeps tombstones, legacy migration is idempotent and projection is authoritative', function () {
  const notes = LitModel.normalizeNotes([
    { id: 'n1', paperId: 'p1', content: 'x', format: 'weird', createdAt: 5, updatedAt: 6 },
    { id: 'n2', paperId: '', title: '主题', content: '', deletedAt: 123, createdAt: 5, updatedAt: 6 },
    { id: 'n1', content: 'duplicate id' }
  ]);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].format, 'markdown');
  assert.equal(notes[1].deletedAt, 123); // 墓碑保留，供同步删除传播
  const rich = LitModel.normalizeNote({ id: 'n3', content: '{}', format: 'richtext' });
  assert.equal(rich.format, 'richtext');
  const ws = LitModel.normalizeWorkspace({
    papers: [{ id: 'p1', title: 'T', notes: 'hello note', addedAt: 10, updatedAt: 20 }]
  });
  assert.equal(ws.notes.length, 1);
  assert.equal(ws.notes[0].id, 'nlegacy_p1');
  assert.equal(ws.notes[0].paperId, 'p1');
  assert.equal(ws.notes[0].content, 'hello note');
  assert.equal(ws.notes[0].createdAt, 10);
  assert.equal(ws.papers[0].notes, 'hello note'); // 兼容投影
  const again = LitModel.normalizeWorkspace(ws);
  assert.equal(again.notes.length, 1); // 幂等：重复 normalize 不产生重复笔记
  assert.equal(again.papers[0].notes, 'hello note');
  const mixedWs = LitModel.normalizeWorkspace({
    papers: [{ id: 'p1', title: 'T', notes: 'stale copy', addedAt: 10, updatedAt: 20 }],
    notes: [{ id: 'n1', paperId: 'p1', content: 'authoritative', createdAt: 30, updatedAt: 30 }]
  });
  assert.equal(mixedWs.notes.length, 1); // 未把过期投影再迁移成新笔记
  assert.equal(mixedWs.papers[0].notes, 'authoritative');
});

test('v12 annotations: backfill attachmentId from the primary PDF and accept EPUB CFI / web anchors', function () {
  const paper = LitModel.normalizePaper({
    id: 'p1', title: 'T',
    attachments: [{ id: 'att1', kind: 'pdf', fileName: 'a.pdf', path: '/a.pdf' }],
    pdfAnnotations: [{ id: 'an1', type: 'highlight', position: { pageIndex: 0, rects: [[0, 0, 1, 1]] } }]
  });
  assert.equal(paper.pdfAnnotations[0].attachmentId, 'att1');
  const orphan = LitModel.normalizePaper({
    id: 'p2', title: 'T',
    pdfAnnotations: [{ id: 'an1', type: 'highlight', position: { pageIndex: 0, rects: [[0, 0, 1, 1]] } }]
  });
  assert.equal(orphan.pdfAnnotations[0].attachmentId, ''); // 无附件：保留记录、留空
  const anns = LitModel.normalizePdfAnnotations([
    { id: 'e1', type: 'highlight', position: { cfi: 'epubcfi(/6/4!/2)' } },
    { id: 'w1', type: 'highlight', position: { textAnchor: { exact: 'quoted', prefix: 'a', suffix: 'b' } } },
    { id: 'bad', type: 'highlight', position: {} }
  ]);
  assert.equal(anns.length, 2); // 无页码且无锚点的记录仍被丢弃
  const epub = anns.filter(function (a) { return a.id === 'e1'; })[0];
  assert.equal(epub.position.pageIndex, null);
  assert.equal(epub.position.cfi, 'epubcfi(/6/4!/2)');
  const web = anns.filter(function (a) { return a.id === 'w1'; })[0];
  assert.equal(web.position.textAnchor.exact, 'quoted');
});

test('v12 envelope and signatures carry the notes collection', function () {
  const env = LitModel.envelope([{ id: 'p1', title: 'T' }], [], {
    notes: [{ id: 'n1', paperId: 'p1', content: 'x', createdAt: 1, updatedAt: 1 }]
  });
  assert.equal(env.schemaVersion, LitModel.SCHEMA_VERSION);
  assert.equal(env.notes.length, 1);
  assert.equal(env.notes[0].content, 'x');
  const sigs = LitModel.workspaceSignatures({ notes: env.notes });
  assert.ok(sigs.notes.n1);
});

test('attachment and note-asset entries validate kind, zoteroKey, hashes and dedupe by path', function () {
  const epub = LitModel.normalizeAttachment({ id: 'a1', kind: 'epub', fileName: 'book.epub', zoteroKey: 'ABCD2345' });
  assert.equal(epub.kind, 'epub'); // 不因缺 .pdf 后缀回落 other
  assert.equal(epub.zoteroKey, 'ABCD2345');
  const snapshot = LitModel.normalizeAttachment({ id: 'a2', kind: 'snapshot', path: '/snaps/site' });
  assert.equal(snapshot.kind, 'snapshot');
  const unknown = LitModel.normalizeAttachment({ id: 'a3', kind: 'weird', fileName: 'note.txt' });
  assert.equal(unknown.kind, 'other');
  const invalidKey = LitModel.normalizeAttachment({ id: 'a4', kind: 'supp', fileName: 's.pdf', zoteroKey: 'bad key!' });
  assert.equal(invalidKey.kind, 'supp');
  assert.equal(invalidKey.zoteroKey, ''); // 非法字符清空
  const goodHash = 'a'.repeat(64);
  const note = LitModel.normalizeNote({
    id: 'n1', paperId: 'p1', content: 'x', zoteroKey: 'ZKEY1234',
    assets: [
      { fileName: 'img.png', path: '/data/note-assets/n1/img.png', cloudHash: goodHash, cloudSize: 12.9, addedAt: 5 },
      { fileName: 'cloud-only.png', cloudName: 'abc123.png' },
      { fileName: '', path: '', cloudName: '' }, // 三项全空丢弃
      { fileName: 'dup.png', path: '/data/note-assets/n1/img.png' }, // 重复 path 去重
      { fileName: 'bad-hash.png', path: '/data/note-assets/n1/bad.png', cloudHash: 'not-hex' }
    ]
  });
  assert.equal(note.zoteroKey, 'ZKEY1234');
  assert.equal(note.assets.length, 3);
  assert.equal(note.assets[0].fileName, 'img.png');
  assert.equal(note.assets[0].cloudHash, goodHash);
  assert.equal(note.assets[0].cloudSize, 12);
  assert.equal(note.assets[0].addedAt, 5);
  assert.equal(note.assets[1].cloudName, 'abc123.png');
  assert.equal(note.assets[2].fileName, 'bad-hash.png');
  assert.equal(note.assets[2].cloudHash, ''); // 非 64hex 清空
  assert.equal(LitModel.normalizeNote({ id: 'n2', zoteroKey: 'bad key!' }).zoteroKey, '');
});

test('annotation helpers: fingerprint rounds rects, dedupeAnnotations keeps first, tags are cleaned', function () {
  const a = { type: 'highlight', text: 'hello', position: { pageIndex: 2, rects: [[0.4, 10.2, 50.49, 3.6]] } };
  const b = { type: 'highlight', text: 'hello', position: { pageIndex: 2, rects: [[0, 10, 50, 4]] } };
  assert.equal(LitModel.annotationFingerprint(a), LitModel.annotationFingerprint(b));
  assert.equal(LitModel.annotationFingerprint(null), '');
  assert.notEqual(LitModel.annotationFingerprint(a),
    LitModel.annotationFingerprint({ type: 'highlight', text: 'hello', position: { pageIndex: 3, rects: [[0, 10, 50, 4]] } }));
  const first = { id: 'a1', type: 'highlight', text: 'same', position: { pageIndex: 0, rects: [[0.4, 1, 2, 3]] } };
  const dup = { id: 'a2', type: 'highlight', text: 'same', position: { pageIndex: 0, rects: [[0, 1, 2, 3]] } };
  const otherText = { id: 'a3', type: 'highlight', text: 'different', position: { pageIndex: 0, rects: [[0, 1, 2, 3]] } };
  const out = LitModel.dedupeAnnotations([first, dup, otherText]);
  assert.deepEqual(out.map(function (a) { return a.id; }), ['a1', 'a3']);
  assert.deepEqual(LitModel.dedupeAnnotations(null), []);
  const tagPaper = LitModel.normalizePaper({
    id: 'p1', title: 'T',
    pdfAnnotations: [{ id: 'a1', type: 'highlight', tags: ['方法', '方法', '/unread', '关键'], position: { pageIndex: 0, rects: [[0, 0, 1, 1]] } }]
  });
  assert.deepEqual(tagPaper.pdfAnnotations[0].tags, ['方法', '关键']); // 去重 + 噪音标签过滤
});

test('v12+ field preservation: sourceMarkdown cap, lastReadAt excluded from signatures, saved-search AST', function () {
  const note = LitModel.normalizeNote({ id: 'n1', content: '# 旧笔记\n> 摘录', format: 'markdown', sourceMarkdown: '# 旧笔记\n> 摘录' });
  assert.equal(note.sourceMarkdown, '# 旧笔记\n> 摘录');
  assert.equal(note.format, 'markdown');
  const migrated = LitModel.normalizeNote({ id: 'n2', content: '<p>富文本</p>', format: 'richtext', sourceMarkdown: '原文'.repeat(300000) });
  assert.ok(migrated.sourceMarkdown.length <= 200000);
  const p = LitModel.normalizePaper({ id: 'p1', title: 'T' });
  assert.equal(p.lastReadAt, null);
  const read = LitModel.normalizePaper({ id: 'p1', title: 'T', lastReadAt: 1700000000000 });
  assert.equal(read.lastReadAt, 1700000000000);
  const sigA = LitModel.workspaceSignatures({ papers: [p] }).papers.p1;
  const withRead = LitModel.normalizePaper({ id: 'p1', title: 'T', lastReadAt: 1700000000000 });
  const sigB = LitModel.workspaceSignatures({ papers: [withRead] }).papers.p1;
  assert.equal(sigA, sigB); // 阅读时间不构成内容变化
  const search = LitModel.normalizeSavedSearch({ id: 's1', name: '高引', query: 'citations>100', ast: '{"v":2,"root":{"op":"cmp"}}' });
  assert.equal(search.ast, '{"v":2,"root":{"op":"cmp"}}');
  const legacy = LitModel.normalizeSavedSearch({ id: 's2', name: '旧', query: 'has:pdf' });
  assert.equal(legacy.ast, ''); // 旧记录为空 → 运行时按 query 解析（自动迁移）
});

test('F03 回归：编辑弹窗改投影字段须同步权威 creators/date，否则 normalize 还原', function () {
  const LitModel = require('../js/model.js');
  const p = { id: 'p1', title: 'T',
    creators: [{ creatorType: 'author', family: 'Smith', given: 'John', name: '' }],
    date: '2025-06-10' };
  // 修复前行为（只写投影）：authors/year 被权威字段还原
  const stale = Object.assign({}, p, { authors: ['Jones'], year: 2026 });
  const bad = LitModel.normalizePaper(stale, function () { return 'x'; });
  assert.equal(bad.authors[0], 'Smith, John');
  assert.equal(bad.year, 2025);
  // 修复后流程（同步权威）：弹窗保存路径 app.js saveEditModal 相同操作
  const fixed = Object.assign({}, p, { authors: ['Jones'], year: 2026 });
  fixed.creators = fixed.authors.map(function (a) { return LitModel.parseCreatorName(a); }).filter(Boolean);
  fixed.date = '2026';
  const good = LitModel.normalizePaper(fixed, function () { return 'x'; });
  assert.equal(good.authors[0], 'Jones');
  assert.equal(good.year, 2026);
  assert.equal(good.date, '2026');
});

test('F04 回归：补全只写投影 year/authors 会漂移保存签名，须整体重规范化（app.js applyPatch）', function () {
  const LitModel = require('../js/model.js');
  const uid = function () { return 'x'; };
  const workspace = LitModel.normalizeWorkspace({ papers: [{ title: 'Deep Learning' }] }, uid);
  const payload = function () {
    return {
      papers: workspace.papers, notes: workspace.notes, folders: workspace.folders,
      savedSearches: workspace.savedSearches, tagColorRecords: workspace.tagColorRecords
    };
  };
  const rendererSig = function () { return LitModel.workspaceSignatures(payload()).papers[paper.id]; };
  const dbSig = function () { return LitModel.workspaceSignatures(LitModel.normalizeWorkspace(payload())).papers[paper.id]; };
  // 补全命中：OpenAlex 同时给出 year 与作者，两者都只写进投影字段
  const paper = workspace.papers[0];
  paper.year = 2015;
  paper.authors = ['Yoshua Bengio'];
  // 修复前（只写投影）：渲染层按内存算的签名 ≠ saveState 入库前 normalizeWorkspace 之后的签名，
  // confirmSaved 随之抛「写入后校验失败」，且该条目会让本会话后续每次保存都失败
  assert.notEqual(rendererSig(), dbSig());
  // 修复后流程（applyPatch 整体重规范化，同 addPapers）：两侧签名一致
  const norm = LitModel.normalizePaper(paper, uid);
  norm.id = paper.id;
  workspace.papers[0] = norm;
  assert.equal(rendererSig(), dbSig());
  assert.equal(norm.year, 2015);
  assert.equal(norm.date, '2015'); // year 反投影进权威 date
  assert.equal(norm.creators.length, 1); // authors 反投影进权威 creators
  assert.equal(norm.authors[0], 'Bengio, Yoshua');
});

test('researchIds: normalizePaper keeps valid ids and merge unions them as a set (M9 phase 2)', function () {
  const paper = LitModel.normalizePaper({
    id: 'p1', title: 'T',
    researchIds: ['W123', 'W123', 'local:abc', 42, '', null]
  }, function () { return 'pid'; });
  assert.deepEqual(paper.researchIds, ['W123', 'local:abc', '42']);
  const clean = LitModel.normalizePaper({ id: 'p2', title: 'T' }, function () { return 'pid2'; });
  assert.deepEqual(clean.researchIds, []);
  const LitMerge = require('../js/merge.js');
  const base = { id: 'p1', title: 'T', researchIds: ['W1'] };
  const local = { id: 'p1', title: 'T', researchIds: ['W1', 'W2'] };
  const remote = { id: 'p1', title: 'T', researchIds: ['W1', 'W3'] };
  const r = LitMerge.mergeEntity(base, local, remote, LitMerge.PAPER_SPEC);
  assert.deepEqual(r.merged.researchIds.slice().sort(), ['W1', 'W2', 'W3']);
});
