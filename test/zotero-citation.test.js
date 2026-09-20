'use strict';
/* F14 回归：Zotero 笔记 data-citation → litboard 引用链接（markdown 与 richtext 两路） */
const test = require('node:test');
const assert = require('node:assert/strict');
const LitZotero = require('../js/zotero.js');

function makeRaw() {
  return {
    allItems: [], deletedItemIDs: [], itemData: [], creators: [], tags: [],
    collections: [], collectionItems: [], notes: [], annotations: [],
    attachments: [], relations: [], tagColors: []
  };
}

const CITE_JSON = JSON.stringify({
  citationItems: [{ uris: ['http://zotero.org/users/local/x/items/PKEY0001'] }]
});
const NOTE_HTML = '<p>前文 <span class="citation" data-citation="' +
  CITE_JSON.replace(/"/g, '&quot;') + '">(Smith, 2020)</span> 后文。</p>';

test('F14：Markdown 路径 — 引用节点转 litboard 链接，且不再记入 unconverted', () => {
  const raw = makeRaw();
  raw.allItems = [
    { itemID: 1, key: 'PKEY0001', typeName: 'journalArticle' },
    { itemID: 2, key: 'NOTEKEY1', typeName: 'note' }
  ];
  raw.itemData = [{ itemID: 1, fieldName: 'title', value: 'Cited Paper' }];
  raw.notes = [{ itemID: 2, key: 'NOTEKEY1', parentItemID: 1, note: NOTE_HTML }];
  const result = LitZotero.mapLibrary(raw, {});
  const note = result.workspace.notes.find(function (n) { return n.zoteroKey === 'NOTEKEY1'; });
  assert.ok(note, '笔记被映射');
  assert.ok(note.content.indexOf('[(Smith, 2020)](litboard://open/paper/zPKEY0001)') !== -1,
    '应生成 litboard 引用链接，实际内容：' + note.content.slice(0, 300));
  assert.equal(result.report.unconverted.filter(function (u) { return u.kind === 'note-citation'; }).length, 0,
    '可解析引文不应记入 unconverted');
});

test('F14：不可解析 key 的引用节点留纯文本并记入 unconverted', () => {
  const raw = makeRaw();
  raw.allItems = [{ itemID: 1, key: 'PKEY0001', typeName: 'journalArticle' },
    { itemID: 2, key: 'NOTEKEY2', typeName: 'note' }];
  raw.itemData = [{ itemID: 1, fieldName: 'title', value: 'Cited Paper' }];
  raw.notes = [{ itemID: 2, key: 'NOTEKEY2', parentItemID: 1,
    note: '<p><span class="citation">(Broken, 1999)</span></p>' }];
  const result = LitZotero.mapLibrary(raw, {});
  const note = result.workspace.notes.find(function (n) { return n.zoteroKey === 'NOTEKEY2'; });
  assert.ok(note.content.indexOf('(Broken, 1999)') !== -1);
  assert.equal(result.report.unconverted.filter(function (u) { return u.kind === 'note-citation'; }).length, 1);
});
