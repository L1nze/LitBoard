'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const LitModel = require('../js/model.js');

test('index.html 表头不含标签列且包含核心列', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.ok(!html.includes('<th class="col-tags">'), '不应存在 col-tags 列');
  assert.ok(html.includes('<table class="lit-table" id="lit-table">'), '应包含 lit-table');
  assert.ok(html.includes('<th class="col-attachment"'), '必须保留 PDF 附件指示列');
  assert.ok(html.includes('<th class="col-title'), '必须保留标题列');
});

test('有附件条目与无附件条目的模型特征', () => {
  const pWithAtt = LitModel.normalizePaper({
    id: 'p1',
    title: 'Paper With Attachments',
    attachments: [
      { id: 'a1', kind: 'pdf', fileName: 'main.pdf', path: '/local/main.pdf' },
      { id: 'a2', kind: 'epub', fileName: 'book.epub', path: '/local/book.epub' }
    ]
  });
  assert.strictEqual(pWithAtt.attachments.length, 2);

  const pWithoutAtt = LitModel.normalizePaper({
    id: 'p2',
    title: 'Paper Without Attachments'
  });
  assert.strictEqual(pWithoutAtt.attachments.length, 0);
});

test('app.js 包含无附件不渲染展开按钮、有附件渲染展开按钮的逻辑', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  assert.ok(appJs.includes('row-expand-btn'), '应包含 row-expand-btn 类');
  assert.ok(appJs.includes('row-expand-spacer'), '应包含 row-expand-spacer 类');
  assert.ok(appJs.includes('attachment-subrow'), '应包含 attachment-subrow 类');
  assert.ok(appJs.includes('toggle-expand'), '应包含 toggle-expand 动作处理');
  assert.ok(appJs.includes('state.expandedRows'), '状态中应记录 expandedRows');
});

test('app.js 与 style.css 包含右键加入文件夹树状层级与搜索过滤契约', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  const styleCss = fs.readFileSync(path.join(__dirname, '../css/style.css'), 'utf8');
  assert.ok(appJs.includes('ctx-tree-branch'), 'app.js 应包含树枝连接符渲染');
  assert.ok(appJs.includes('ctx-folder-name'), 'app.js 应渲染纯文件夹名而非重复全路径');
  assert.ok(appJs.includes('ctx-search-input'), 'app.js 应支持文件夹搜索过滤输入');
  assert.ok(appJs.includes('ctx-folder-check'), 'app.js 应包含已归属文件夹对勾提示');
  assert.ok(styleCss.includes('.ctx-submenu'), 'style.css 应有 ctx-submenu 样式');
  assert.ok(styleCss.includes('.ctx-search-input'), 'style.css 应有搜索框样式');
  assert.ok(styleCss.includes('.ctx-tree-branch'), 'style.css 应有树枝样式');
});
