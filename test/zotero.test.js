'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitModel = require('../js/model.js');
const LitZotero = require('../js/zotero.js');

function makeRaw() {
  return {
    allItems: [], deletedItemIDs: [], itemData: [], creators: [], tags: [],
    collections: [], collectionItems: [], notes: [], annotations: [],
    attachments: [], relations: [], tagColors: []
  };
}
function existsAll() { return function () { return true; }; }
function existsIn(list) {
  const set = new Set(list);
  return function (p) { return set.has(p); };
}
function paperByKey(ws, key) {
  return ws.papers.find(function (p) { return p.zoteroKey === key; });
}

test('条目类型映射：常规类型 / thesis 学位层次 / 未知类型 misc+sourceType / 已删除剔除', function () {
  const raw = makeRaw();
  raw.allItems = [
    { itemID: 1, key: 'PKEY0001', typeName: 'journalArticle' },
    { itemID: 2, key: 'PKEY0002', typeName: 'conferencePaper' },
    { itemID: 3, key: 'PKEY0003', typeName: 'thesis' },
    { itemID: 4, key: 'PKEY0004', typeName: 'thesis' },
    { itemID: 5, key: 'PKEY0005', typeName: 'dataset' },
    { itemID: 6, key: 'PKEY0006', typeName: 'journalArticle' },
    { itemID: 7, key: 'ATTKEY00', typeName: 'attachment' },
    { itemID: 8, key: 'NOTEKEY0', typeName: 'note' }
  ];
  raw.deletedItemIDs = [6];
  raw.itemData = [
    { itemID: 1, fieldName: 'title', value: 'A' },
    { itemID: 2, fieldName: 'title', value: 'B' },
    { itemID: 3, fieldName: 'title', value: 'C' },
    { itemID: 3, fieldName: 'thesisType', value: "Master's Thesis" },
    { itemID: 4, fieldName: 'title', value: 'D' },
    { itemID: 4, fieldName: 'thesisType', value: 'PhD dissertation' },
    { itemID: 5, fieldName: 'title', value: 'E' }
  ];
  const result = LitZotero.mapLibrary(raw, { dataDir: 'D:\\Zot', fileExists: existsAll() });
  assert.equal(result.workspace.papers.length, 5);
  assert.equal(paperByKey(result.workspace, 'PKEY0001').entryType, 'article');
  assert.equal(paperByKey(result.workspace, 'PKEY0002').entryType, 'inproceedings');
  assert.equal(paperByKey(result.workspace, 'PKEY0003').entryType, 'mastersthesis');
  assert.equal(paperByKey(result.workspace, 'PKEY0004').entryType, 'phdthesis');
  const dataset = paperByKey(result.workspace, 'PKEY0005');
  assert.equal(dataset.entryType, 'misc');
  assert.equal(dataset.sourceType, 'dataset');
  assert.equal(paperByKey(result.workspace, 'PKEY0006'), undefined);
  assert.equal(result.report.source.items, 5);
});

test('字段全量映射 + 未映射字段进 bibtexExtra + 非法日期 date_raw/year 兜底', function () {
  const raw = makeRaw();
  raw.allItems = [{ itemID: 1, key: 'PKEY0001', typeName: 'journalArticle' }];
  raw.itemData = [
    { itemID: 1, fieldName: 'title', value: '深度 学习' },
    { itemID: 1, fieldName: 'abstractNote', value: '摘要文本' },
    { itemID: 1, fieldName: 'DOI', value: 'https://doi.org/10.1000/xyz' },
    { itemID: 1, fieldName: 'url', value: 'https://example.com/paper' },
    { itemID: 1, fieldName: 'volume', value: '12' },
    { itemID: 1, fieldName: 'issue', value: '3' },
    { itemID: 1, fieldName: 'pages', value: '100-120' },
    { itemID: 1, fieldName: 'publisher', value: '某出版社' },
    { itemID: 1, fieldName: 'place', value: '北京' },
    { itemID: 1, fieldName: 'edition', value: '2' },
    { itemID: 1, fieldName: 'language', value: 'zh-CN' },
    { itemID: 1, fieldName: 'ISSN', value: '1234-5678' },
    { itemID: 1, fieldName: 'ISBN', value: '978-7-01-000000-0' },
    { itemID: 1, fieldName: 'journalAbbreviation', value: 'J. Test' },
    { itemID: 1, fieldName: 'accessDate', value: '2023-01-02' },
    { itemID: 1, fieldName: 'seriesTitle', value: '丛书名' },
    { itemID: 1, fieldName: 'publicationTitle', value: '测试学报' },
    { itemID: 1, fieldName: 'date', value: '2021-05-06' },
    { itemID: 1, fieldName: 'shortTitle', value: '短标题' }
  ];
  const result = LitZotero.mapLibrary(raw, { dataDir: 'D:\\Zot', fileExists: existsAll() });
  const p = result.workspace.papers[0];
  assert.equal(p.title, '深度 学习');
  assert.equal(p.abstract, '摘要文本');
  assert.equal(p.doi, '10.1000/xyz');
  assert.equal(p.url, 'https://example.com/paper');
  assert.equal(p.volume, '12');
  assert.equal(p.issue, '3');
  assert.equal(p.pages, '100-120');
  assert.equal(p.publisher, '某出版社');
  assert.equal(p.place, '北京');
  assert.equal(p.edition, '2');
  assert.equal(p.language, 'zh-CN');
  assert.equal(p.issn, '1234-5678');
  assert.equal(p.isbn, '978-7-01-000000-0');
  assert.equal(p.journalAbbreviation, 'J. Test');
  assert.equal(p.accessDate, '2023-01-02');
  assert.equal(p.series, '丛书名');
  assert.equal(p.venue, '测试学报');
  assert.equal(p.date, '2021-05-06');
  assert.equal(p.year, 2021);
  assert.equal(p.bibtexExtra.shorttitle, '短标题');

  // 非法日期：date_raw 保留原值、year 提取兜底
  const raw2 = makeRaw();
  raw2.allItems = [{ itemID: 1, key: 'PKEY0001', typeName: 'journalArticle' }];
  raw2.itemData = [
    { itemID: 1, fieldName: 'title', value: 'X' },
    { itemID: 1, fieldName: 'date', value: 'March 15, 2020' }
  ];
  const p2 = LitZotero.mapLibrary(raw2, {}).workspace.papers[0];
  assert.equal(p2.bibtexExtra.date_raw, 'March 15, 2020');
  assert.equal(p2.year, 2020);
});

test('extra 字段的 LitBoard 标记解析，余量进 bibtexExtra.extra', function () {
  const md = '你好 hello';
  const raw = makeRaw();
  raw.allItems = [{ itemID: 1, key: 'PKEY0001', typeName: 'journalArticle' }];
  raw.itemData = [
    { itemID: 1, fieldName: 'title', value: 'X' },
    { itemID: 1, fieldName: 'extra', value: [
      'LitBoard Status: read',
      'LitBoard Rating: 4',
      'LitBoard Markdown: ' + Buffer.from(md, 'utf8').toString('base64'),
      'PMID: 12345'
    ].join('\n') }
  ];
  const ws = LitZotero.mapLibrary(raw, {}).workspace;
  const p = ws.papers[0];
  assert.equal(p.status, 'reading');
  assert.equal(p.rating, 4);
  assert.equal(p.bibtexExtra.extra, 'PMID: 12345');
  // LitBoard Markdown 经旧 notes 字段迁移为 Note 实体并投影回 paper.notes
  assert.equal(p.notes, md);
  assert.ok(ws.notes.some(function (n) { return n.content === md; }));
});

test('创作者：多角色映射、orderIndex 排序、fieldMode=1 单字段与机构名', function () {
  const raw = makeRaw();
  raw.allItems = [{ itemID: 1, key: 'PKEY0001', typeName: 'journalArticle' }];
  raw.itemData = [{ itemID: 1, fieldName: 'title', value: 'X' }];
  raw.creators = [
    { itemID: 1, creatorType: 'editor', firstName: 'Bob', lastName: 'Editor', fieldMode: 0, orderIndex: 2 },
    { itemID: 1, creatorType: 'author', firstName: 'Alice', lastName: 'Author', fieldMode: 0, orderIndex: 0 },
    { itemID: 1, creatorType: 'reviewedAuthor', firstName: 'Carol', lastName: 'Reviewer', fieldMode: 0, orderIndex: 3 },
    { itemID: 1, creatorType: 'author', firstName: '', lastName: 'World Health Organization', fieldMode: 1, orderIndex: 1 }
  ];
  const p = LitZotero.mapLibrary(raw, {}).workspace.papers[0];
  assert.equal(p.creators.length, 4);
  assert.deepEqual(p.creators[0], { creatorType: 'author', family: 'Author', given: 'Alice', name: '' });
  assert.equal(p.creators[1].creatorType, 'author');
  assert.equal(p.creators[1].name, 'World Health Organization');
  assert.equal(p.creators[2].creatorType, 'editor');
  assert.equal(p.creators[3].creatorType, 'other');
  // authors 投影只含 author 角色
  assert.deepEqual(p.authors, ['Author, Alice', 'World Health Organization']);
});

test('笔记：HTML→Markdown（标题/粗斜体/列表/链接/引用块），非 http 链接剥壳', function () {
  const raw = makeRaw();
  raw.allItems = [{ itemID: 1, key: 'PKEY0001', typeName: 'journalArticle' }];
  raw.itemData = [{ itemID: 1, fieldName: 'title', value: 'X' }];
  raw.notes = [{
    itemID: 20, parentItemID: 1, key: 'NOTEKEY1', title: '我的笔记',
    note: '<h2>小节</h2><p>一段<strong>加粗</strong>与<em>斜体</em></p>' +
      '<ul><li>甲</li><li>乙</li></ul><ol><li>第一</li></ol>' +
      '<blockquote>引文</blockquote>' +
      '<p><a href="https://example.com/a">好链接</a> <a href="javascript:alert(1)">坏链接</a></p>'
  }];
  const result = LitZotero.mapLibrary(raw, {});
  const note = result.workspace.notes[0];
  assert.equal(note.id, 'znote_NOTEKEY1');
  assert.equal(note.zoteroKey, 'NOTEKEY1');
  assert.equal(note.paperId, 'zPKEY0001');
  assert.equal(note.title, '我的笔记');
  assert.equal(note.format, 'markdown');
  assert.match(note.content, /## 小节/);
  assert.match(note.content, /\*\*加粗\*\*/);
  assert.match(note.content, /\*斜体\*/);
  assert.match(note.content, /- 甲/);
  assert.match(note.content, /- 乙/);
  assert.match(note.content, /1\. 第一/);
  assert.match(note.content, /> 引文/);
  assert.match(note.content, /\[好链接\]\(https:\/\/example\.com\/a\)/);
  assert.match(note.content, /坏链接/);
  assert.ok(!/坏链接\]\(/.test(note.content));
  // 主题笔记（无父条目）→ paperId 为空
  const raw2 = makeRaw();
  raw2.notes = [{ itemID: 21, parentItemID: null, key: 'NOTEKEY2', title: '', note: '<p>独立</p>' }];
  const note2 = LitZotero.mapLibrary(raw2, {}).workspace.notes[0];
  assert.equal(note2.paperId, '');
});

test('笔记图片：data-URI 资产 / 存储相对路径资产 / 解析失败入 unconverted', function () {
  const raw = makeRaw();
  const storageImg = 'D:\\Zot\\storage\\NOTEKEY2\\images\\pic.png';
  raw.notes = [
    { itemID: 20, parentItemID: null, key: 'NOTEKEY1', title: '',
      note: '<p>图<img src="data:image/png;base64,iVBORw0KGgo="></p>' },
    { itemID: 21, parentItemID: null, key: 'NOTEKEY2', title: '',
      note: '<p><img src="images/pic.png"> <img src="gone.png"></p>' }
  ];
  const result = LitZotero.mapLibrary(raw, {
    dataDir: 'D:\\Zot',
    fileExists: existsIn([storageImg])
  });
  const note1 = result.workspace.notes.find(function (n) { return n.zoteroKey === 'NOTEKEY1'; });
  assert.match(note1.content, /!\[\]\(note-assets\/znote_NOTEKEY1\/image-1\.png\)/);
  assert.deepEqual(note1.assets, [{ fileName: 'image-1.png', path: 'note-assets/znote_NOTEKEY1/image-1.png',
    cloudName: '', cloudHash: '', cloudSize: null, addedAt: note1.assets[0].addedAt }]);
  const dataAsset = result.assets.find(function (a) { return a.zoteroKey === 'NOTEKEY1'; });
  assert.equal(dataAsset.kind, 'note-image');
  assert.equal(dataAsset.noteId, 'znote_NOTEKEY1');
  assert.equal(dataAsset.fileName, 'image-1.png');
  assert.equal(dataAsset.sourcePath, '');
  assert.match(dataAsset.dataUri, /^data:image\/png;base64,/);

  const note2 = result.workspace.notes.find(function (n) { return n.zoteroKey === 'NOTEKEY2'; });
  assert.match(note2.content, /!\[\]\(note-assets\/znote_NOTEKEY2\/pic\.png\)/);
  assert.match(note2.content, /!\[\]\(gone\.png\)/); // 解析失败保留原 src
  const fileAsset = result.assets.find(function (a) { return a.zoteroKey === 'NOTEKEY2'; });
  assert.equal(fileAsset.kind, 'note-image');
  assert.equal(fileAsset.sourcePath, storageImg);
  assert.equal(fileAsset.fileName, 'pic.png');
  assert.equal(fileAsset.dataUri, '');
  assert.ok(result.report.unconverted.some(function (u) {
    return u.kind === 'note-image' && u.key === 'NOTEKEY2' && u.detail === 'gone.png';
  }));
});

test('笔记：table 保留原始 HTML 并入 unconverted；citation 节点剥壳计数', function () {
  const raw = makeRaw();
  raw.notes = [{
    itemID: 20, parentItemID: null, key: 'NOTEKEY1', title: '',
    note: '<p>前文</p><table><tr><td>单元格</td></tr></table>' +
      '<p>引文 <span class="citation">(Doe, 2020)</span> 与 <span data-citation="x">(Roe, 2021)</span></p>'
  }];
  const result = LitZotero.mapLibrary(raw, {});
  const note = result.workspace.notes[0];
  assert.match(note.content, /<table><tr><td>单元格<\/td><\/tr><\/table>/);
  assert.match(note.content, /\(Doe, 2020\)/);
  assert.match(note.content, /\(Roe, 2021\)/);
  assert.ok(!/data-citation/.test(note.content));
  const kinds = result.report.unconverted.map(function (u) { return u.kind; });
  assert.equal(kinds.filter(function (k) { return k === 'note-table'; }).length, 1);
  assert.equal(kinds.filter(function (k) { return k === 'note-citation'; }).length, 2);
});

test('附件：storage 相对路径 / 绝对路径 / 链接文件基准 / linkMode 3 补 url / 独立附件 / 缺失文件', function () {
  const raw = makeRaw();
  raw.allItems = [
    { itemID: 1, key: 'PKEY0001', typeName: 'journalArticle' },
    { itemID: 2, key: 'PKEY0002', typeName: 'journalArticle' },
    { itemID: 100, key: 'ATTKEY01', typeName: 'attachment' },
    { itemID: 101, key: 'ATTKEY02', typeName: 'attachment' },
    { itemID: 102, key: 'ATTKEY03', typeName: 'attachment' },
    { itemID: 103, key: 'ATTKEY04', typeName: 'attachment' },
    { itemID: 104, key: 'ATTKEY05', typeName: 'attachment' },
    { itemID: 105, key: 'ATTKEY06', typeName: 'attachment' },
    { itemID: 106, key: 'ATTKEY07', typeName: 'attachment' },
    { itemID: 107, key: 'ATTKEY08', typeName: 'attachment' }
  ];
  raw.itemData = [
    { itemID: 1, fieldName: 'title', value: 'A' },
    { itemID: 2, fieldName: 'title', value: 'B' },
    { itemID: 2, fieldName: 'url', value: 'https://existing.example/x' }
  ];
  raw.attachments = [
    { itemID: 100, parentItemID: 1, key: 'ATTKEY01', linkMode: 0, contentType: 'application/pdf', path: 'storage:paper.pdf', url: '' },
    { itemID: 101, parentItemID: 1, key: 'ATTKEY02', linkMode: 2, contentType: 'application/pdf', path: 'D:\\else\\abs.pdf', url: '' },
    { itemID: 102, parentItemID: 1, key: 'ATTKEY03', linkMode: 2, contentType: '', path: 'linked.pdf', url: '' },
    { itemID: 103, parentItemID: 1, key: 'ATTKEY04', linkMode: 3, contentType: '', path: '', url: 'https://example.com/linked' },
    { itemID: 104, parentItemID: 1, key: 'ATTKEY05', linkMode: 0, contentType: 'application/pdf', path: 'storage:missing.pdf', url: '' },
    { itemID: 105, parentItemID: null, key: 'ATTKEY06', linkMode: 0, contentType: 'application/pdf', path: 'storage:solo.pdf', url: '' },
    { itemID: 106, parentItemID: 2, key: 'ATTKEY07', linkMode: 3, contentType: '', path: '', url: 'https://other.example/y' },
    { itemID: 107, parentItemID: 999, key: 'ATTKEY08', linkMode: 0, contentType: 'application/pdf', path: 'storage:orphan.pdf', url: '' }
  ];
  const paths = [
    'D:\\Zot\\storage\\ATTKEY01\\paper.pdf',
    'D:\\else\\abs.pdf',
    'D:\\base\\linked.pdf',
    'D:\\Zot\\storage\\ATTKEY06\\solo.pdf'
    // ATTKEY05 的 missing.pdf 故意不存在
  ];
  const result = LitZotero.mapLibrary(raw, {
    dataDir: 'D:\\Zot', baseAttachmentPath: 'D:\\base', fileExists: existsIn(paths)
  });
  const ws = result.workspace;
  const p1 = paperByKey(ws, 'PKEY0001');
  const kinds = p1.attachments.map(function (a) { return a.zoteroKey; });
  assert.deepEqual(kinds, ['ATTKEY01', 'ATTKEY02', 'ATTKEY03', 'ATTKEY05']);
  const att1 = p1.attachments[0];
  assert.equal(att1.id, 'zatt_ATTKEY01');
  assert.equal(att1.kind, 'pdf');
  assert.equal(att1.fileName, 'paper.pdf');
  assert.equal(att1.path, 'D:\\Zot\\storage\\ATTKEY01\\paper.pdf');
  assert.equal(p1.attachments[1].path, 'D:\\else\\abs.pdf');
  assert.equal(p1.attachments[2].path, 'D:\\base\\linked.pdf');
  assert.equal(p1.attachments[3].path, ''); // not-found
  // linkMode 3：不入附件，补父条目 url（已有 url 的不覆盖）
  assert.equal(p1.url, 'https://example.com/linked');
  assert.equal(paperByKey(ws, 'PKEY0002').url, 'https://existing.example/x');
  // 首个 PDF 附件 key 回填 zoteroAttachmentKey
  assert.equal(p1.zoteroAttachmentKey, 'ATTKEY01');
  // 独立附件 → 占位 paper
  const solo = paperByKey(ws, 'ATTKEY06');
  assert.ok(solo);
  assert.equal(solo.entryType, 'misc');
  assert.equal(solo.sourceType, 'attachment');
  assert.equal(solo.title, 'solo.pdf');
  assert.equal(solo.attachments.length, 1);
  assert.equal(solo.attachments[0].path, 'D:\\Zot\\storage\\ATTKEY06\\solo.pdf');
  // missing 报告
  const reasons = result.report.missing.map(function (m) { return m.zoteroKey + ':' + m.reason; });
  assert.ok(reasons.indexOf('ATTKEY05:not-found') !== -1);
  // unconverted：独立附件登记
  assert.ok(result.report.unconverted.some(function (u) {
    return u.kind === 'standalone-attachment' && u.key === 'ATTKEY06';
  }));
  // 父条目不存在 → failures 并跳过
  assert.ok(result.report.failures.some(function (f) {
    return f.kind === 'attachment' && f.key === 'ATTKEY08';
  }));
  // assets 清单（linkMode 3 与孤儿附件不产生资产）
  const fileAssets = result.assets.filter(function (a) { return a.kind === 'file'; });
  assert.equal(fileAssets.length, 5);
  const missingAsset = fileAssets.find(function (a) { return a.zoteroKey === 'ATTKEY05'; });
  assert.equal(missingAsset.sourcePath, '');
  // mapping 计数
  assert.equal(result.report.mapping.items, ws.papers.length);
  assert.equal(result.report.mapping.attachments, 5);
  assert.equal(result.report.imported.attachments, 5);
  // linkMode 2 相对路径缺 baseAttachmentPath → relative-no-base
  const rawNoBase = makeRaw();
  rawNoBase.allItems = [
    { itemID: 1, key: 'PKEY0001', typeName: 'journalArticle' },
    { itemID: 100, key: 'ATTKEY01', typeName: 'attachment' }
  ];
  rawNoBase.itemData = [{ itemID: 1, fieldName: 'title', value: 'A' }];
  rawNoBase.attachments = [{ itemID: 100, parentItemID: 1, key: 'ATTKEY01', linkMode: 2, contentType: 'application/pdf', path: 'nobase.pdf', url: '' }];
  const noBase = LitZotero.mapLibrary(rawNoBase, { dataDir: 'D:\\Zot', fileExists: existsAll() });
  assert.ok(noBase.report.missing.some(function (m) {
    return m.zoteroKey === 'ATTKEY01' && m.reason === 'relative-no-base';
  }));
  assert.equal(noBase.workspace.papers[0].attachments[0].path, '');
  // 快照：text/html + linkMode 1 → snapshot 目录资产
  const raw2 = makeRaw();
  raw2.allItems = [
    { itemID: 1, key: 'PKEY0001', typeName: 'webpage' },
    { itemID: 100, key: 'ATTKEY01', typeName: 'attachment' }
  ];
  raw2.itemData = [{ itemID: 1, fieldName: 'title', value: 'W' }];
  raw2.attachments = [{ itemID: 100, parentItemID: 1, key: 'ATTKEY01', linkMode: 1, contentType: 'text/html', path: 'storage:index.html', url: '' }];
  const result2 = LitZotero.mapLibrary(raw2, {
    dataDir: 'D:\\Zot', fileExists: existsIn(['D:\\Zot\\storage\\ATTKEY01\\index.html'])
  });
  const snap = result2.workspace.papers[0].attachments[0];
  assert.equal(snap.kind, 'snapshot');
  assert.equal(snap.path, 'D:\\Zot\\storage\\ATTKEY01');
  const snapAsset = result2.assets[0];
  assert.equal(snapAsset.kind, 'snapshot-dir');
  assert.equal(snapAsset.fileName, 'index.html');
});

test('批注：highlight/ink 展平/image 两路 + attachmentId 关联 + 孤儿入 missing', function () {
  const raw = makeRaw();
  raw.allItems = [
    { itemID: 1, key: 'PKEY0001', typeName: 'journalArticle' },
    { itemID: 100, key: 'ATTKEY01', typeName: 'attachment' }
  ];
  raw.itemData = [{ itemID: 1, fieldName: 'title', value: 'A' }];
  raw.attachments = [{ itemID: 100, parentItemID: 1, key: 'ATTKEY01', linkMode: 0, contentType: 'application/pdf', path: 'storage:p.pdf', url: '' }];
  raw.annotations = [
    { itemID: 200, parentItemID: 100, key: 'ANNKEY01', type: 'highlight', text: '引用文本', comment: '评注',
      color: '#FFD400', pageLabel: '3', position: JSON.stringify({ pageIndex: 2, rects: [[1, 2, 3, 4]] }), sortOrder: 0, imagePath: '' },
    { itemID: 201, parentItemID: 100, key: 'ANNKEY02', type: 'ink', text: '', comment: '',
      color: '#ff0000', pageLabel: '2', position: JSON.stringify({ pageIndex: 1, paths: [[[1, 2], [3, 4]], [[5, 6]]] }), sortOrder: 1, imagePath: '' },
    { itemID: 202, parentItemID: 100, key: 'ANNKEY03', type: 'image', text: '', comment: '',
      color: '', pageLabel: '1', position: JSON.stringify({ pageIndex: 0, rects: [[10, 10, 50, 50]] }), sortOrder: 2, imagePath: 'ann.png' },
    { itemID: 203, parentItemID: 100, key: 'ANNKEY04', type: 'image', text: '', comment: '',
      color: '', pageLabel: '1', position: JSON.stringify({ pageIndex: 0, rects: [[60, 60, 90, 90]] }), sortOrder: 3, imagePath: 'gone.png' },
    { itemID: 204, parentItemID: 999, key: 'ANNKEY05', type: 'highlight', text: '孤儿', comment: '',
      color: '', pageLabel: '1', position: JSON.stringify({ pageIndex: 0, rects: [[0, 0, 1, 1]] }), sortOrder: 4, imagePath: '' }
  ];
  const result = LitZotero.mapLibrary(raw, {
    dataDir: 'D:\\Zot',
    fileExists: existsIn(['D:\\Zot\\storage\\ATTKEY01\\p.pdf', 'D:\\Zot\\ann.png'])
  });
  const p = result.workspace.papers[0];
  const anns = p.pdfAnnotations;
  assert.equal(anns.length, 4); // 孤儿不入库
  const highlight = anns.find(function (a) { return a.id === 'zann_ANNKEY01'; });
  assert.equal(highlight.type, 'highlight');
  assert.equal(highlight.attachmentId, 'zatt_ATTKEY01');
  assert.equal(highlight.text, '引用文本');
  assert.equal(highlight.comment, '评注');
  assert.equal(highlight.color, '#ffd400');
  assert.equal(highlight.position.pageIndex, 2);
  assert.deepEqual(highlight.position.rects, [[1, 2, 3, 4]]);
  const ink = anns.find(function (a) { return a.id === 'zann_ANNKEY02'; });
  assert.equal(ink.type, 'ink');
  assert.deepEqual(ink.position.points, [[1, 2], [3, 4], [5, 6]]);
  assert.deepEqual(ink.position.rects, [[1, 2, 5, 6]]); // model 由轨迹派生包围盒
  const img = anns.find(function (a) { return a.id === 'zann_ANNKEY03'; });
  assert.equal(img.type, 'snapshot');
  const imgAsset = result.assets.find(function (a) { return a.kind === 'annotation-image'; });
  assert.equal(imgAsset.annotationId, 'zann_ANNKEY03');
  assert.equal(imgAsset.sourcePath, 'D:\\Zot\\ann.png');
  assert.equal(imgAsset.fileName, 'ann.png');
  const gone = anns.find(function (a) { return a.id === 'zann_ANNKEY04'; });
  assert.equal(gone.imagePath, '');
  assert.ok(result.report.unconverted.some(function (u) {
    return u.kind === 'annotation-image' && u.key === 'ANNKEY04';
  }));
  assert.ok(result.report.missing.some(function (m) {
    return m.reason === 'annotation-orphan' && m.zoteroKey === 'ANNKEY05';
  }));
  assert.equal(result.report.imported.annotations, 4);
});

test('单项失败不丢整批：position 非法 JSON 的批注入 failures，其余照常', function () {
  const raw = makeRaw();
  raw.allItems = [
    { itemID: 1, key: 'PKEY0001', typeName: 'journalArticle' },
    { itemID: 100, key: 'ATTKEY01', typeName: 'attachment' }
  ];
  raw.itemData = [{ itemID: 1, fieldName: 'title', value: 'A' }];
  raw.attachments = [{ itemID: 100, parentItemID: 1, key: 'ATTKEY01', linkMode: 0, contentType: 'application/pdf', path: 'storage:p.pdf', url: '' }];
  raw.annotations = [
    { itemID: 200, parentItemID: 100, key: 'ANNKEY01', type: 'highlight', text: '坏', comment: '',
      color: '', pageLabel: '', position: 'not-json{{{', sortOrder: 0, imagePath: '' },
    { itemID: 201, parentItemID: 100, key: 'ANNKEY02', type: 'underline', text: '好', comment: '',
      color: '', pageLabel: '', position: JSON.stringify({ pageIndex: 0, rects: [[0, 0, 1, 1]] }), sortOrder: 1, imagePath: '' }
  ];
  const result = LitZotero.mapLibrary(raw, { dataDir: 'D:\\Zot', fileExists: existsAll() });
  assert.equal(result.report.failures.length, 1);
  assert.equal(result.report.failures[0].kind, 'annotation');
  assert.equal(result.report.failures[0].key, 'ANNKEY01');
  const p = result.workspace.papers[0];
  assert.equal(p.pdfAnnotations.length, 1);
  assert.equal(p.pdfAnnotations[0].type, 'underline');
});

test('关联双向 relatedIds、文件夹层级与归集、标签颜色', function () {
  const raw = makeRaw();
  raw.allItems = [
    { itemID: 1, key: 'PKEY0001', typeName: 'journalArticle' },
    { itemID: 2, key: 'PKEY0002', typeName: 'journalArticle' }
  ];
  raw.itemData = [
    { itemID: 1, fieldName: 'title', value: 'A' },
    { itemID: 2, fieldName: 'title', value: 'B' }
  ];
  raw.relations = [{ subjectItemID: 1, objectKey: 'PKEY0002' }, { subjectItemID: 1, objectKey: 'NOPE1234' }];
  raw.collections = [
    { collectionID: 5, key: 'COLLKEY1', name: '父集合', parentCollectionID: null },
    { collectionID: 6, key: 'COLLKEY2', name: '子集合', parentCollectionID: 5 }
  ];
  raw.collectionItems = [{ collectionID: 6, itemID: 1 }];
  raw.tagColors = [{ name: '重要', color: '#FF0000' }, { name: '坏色', color: 'red' }];
  const result = LitZotero.mapLibrary(raw, {});
  const ws = result.workspace;
  const p1 = paperByKey(ws, 'PKEY0001');
  const p2 = paperByKey(ws, 'PKEY0002');
  assert.deepEqual(p1.relatedIds, ['zPKEY0002']);
  assert.deepEqual(p2.relatedIds, ['zPKEY0001']);
  assert.equal(result.report.imported.related, 1);
  const parent = ws.folders.find(function (f) { return f.id === 'fzcCOLLKEY1'; });
  const child = ws.folders.find(function (f) { return f.id === 'fzcCOLLKEY2'; });
  assert.equal(parent.parentId, '');
  assert.equal(child.parentId, 'fzcCOLLKEY1');
  assert.deepEqual(p1.folderIds, ['fzcCOLLKEY2']);
  const record = ws.tagColorRecords.find(function (r) { return r.tag === '重要'; });
  assert.equal(record.color, '#ff0000');
  assert.equal(record.updatedAt, 1);
  assert.equal(ws.tagColors['重要'], '#ff0000');
  // 非法颜色被 model 剔除
  assert.ok(!ws.tagColorRecords.some(function (r) { return r.tag === '坏色'; }));
  assert.equal(result.report.imported.tagColors, 2);
});

test('输出工作区再过 normalizeWorkspace 幂等：papers/notes 数量不变', function () {
  const raw = makeRaw();
  raw.allItems = [
    { itemID: 1, key: 'PKEY0001', typeName: 'journalArticle' },
    { itemID: 100, key: 'ATTKEY01', typeName: 'attachment' }
  ];
  raw.itemData = [{ itemID: 1, fieldName: 'title', value: 'A' }];
  raw.attachments = [{ itemID: 100, parentItemID: 1, key: 'ATTKEY01', linkMode: 0, contentType: 'application/pdf', path: 'storage:p.pdf', url: '' }];
  raw.notes = [{ itemID: 20, parentItemID: 1, key: 'NOTEKEY1', title: 'n', note: '<p>内容</p>' }];
  raw.collections = [{ collectionID: 5, key: 'COLLKEY1', name: '集合', parentCollectionID: null }];
  raw.collectionItems = [{ collectionID: 5, itemID: 1 }];
  const first = LitZotero.mapLibrary(raw, { dataDir: 'D:\\Zot', fileExists: existsAll() }).workspace;
  const second = LitModel.normalizeWorkspace(first);
  assert.equal(second.papers.length, first.papers.length);
  assert.equal(second.notes.length, first.notes.length);
  assert.equal(second.folders.length, first.folders.length);
  assert.equal(second.papers[0].id, first.papers[0].id);
  assert.equal(second.notes[0].id, first.notes[0].id);
  assert.equal(second.papers[0].attachments.length, 1);
});
