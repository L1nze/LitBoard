'use strict';

/* 拖入文件夹导入的规划层测试（js/folderimport.js，纯函数直载） */

const test = require('node:test');
const assert = require('node:assert/strict');
const LitFolderImport = require('../js/folderimport.js');

function scan(files, rootName) {
  return {
    ok: true,
    rootName: rootName || '导入根',
    rootPath: 'C:\\tmp\\' + (rootName || '导入根'),
    files: files.map(function (f) {
      const rel = f.rel;
      const name = rel.slice(rel.lastIndexOf('/') + 1);
      return { rel: rel, name: name, ext: name.slice(name.lastIndexOf('.')).toLowerCase(), abs: 'C:\\tmp\\root\\' + rel, size: 1 };
    }),
    hiddenSkipped: 0
  };
}

const FOLDERS = [
  { id: 'f-root', name: '我的文献', parentId: '' },
  { id: 'f-a', name: '已有同名', parentId: '' },
  { id: 'f-sub', name: 'Sub1', parentId: 'f-a' },
  { id: 'f-dead', name: '墓碑文件夹', parentId: '', deletedAt: 1 }
];

test('基本规划：目录链按深度建、PDF 带归属、根待新建', () => {
  const plan = LitFolderImport.planFolderImport({
    scan: scan([
      { rel: 'sub1/a.pdf' },
      { rel: 'sub1/inner/b.pdf' },
      { rel: 'sub2/c.pdf' },
      { rel: 'top.pdf' }
    ], '拖入根'),
    folders: [],
    targetFolderId: ''
  });
  assert.equal(plan.root.id, '');
  assert.equal(plan.root.name, '拖入根');
  assert.deepEqual(plan.createList.map(c => c.key), ['sub1', 'sub2', 'sub1/inner']);
  assert.equal(plan.createList[2].parentKey, 'sub1');
  assert.equal(plan.createList[0].parentKey, '');
  assert.equal(plan.createdCount, 3 + 1); // 三个子目录 + 根
  assert.equal(plan.pdfs.length, 4);
  assert.deepEqual(plan.pdfs.map(p => p.dirRel), ['sub1', 'sub1/inner', 'sub2', '']);
});

test('剪枝：支持文档所在目录都进入计划，未知格式计数', () => {
  const plan = LitFolderImport.planFolderImport({
    scan: scan([
      { rel: '只放word的分支/nested/deep.docx' },
      { rel: '只放word的分支/x.docx' },
      { rel: '有货/a.pdf' },
      { rel: '说明.txt' }
    ]),
    folders: [],
    targetFolderId: ''
  });
  assert.deepEqual(plan.createList.map(c => c.key), ['只放word的分支', '有货', '只放word的分支/nested']);
  assert.equal(plan.skippedUnsupported, 1);
  assert.equal(plan.pdfs.length, 1);
  assert.equal(plan.otherFiles.length, 2);
  assert.equal(plan.pdfs[0].dirRel, '有货');
});

test('无支持格式：空计划，连根也不建', () => {
  const plan = LitFolderImport.planFolderImport({
    scan: scan([{ rel: 'a.txt' }, { rel: 'b.png' }]),
    folders: FOLDERS,
    targetFolderId: 'f-root'
  });
  assert.equal(plan.pdfs.length, 0);
  assert.equal(plan.createList.length, 0);
  assert.equal(plan.createdCount, 0);
});

test('文档格式与多目录根去重按插件规则处理', () => {
  const extensions = ['pdf', 'epub', 'djvu', 'mobi', 'azw3', 'doc', 'docx', 'odt', 'rtf'];
  const plan = LitFolderImport.planFolderImport({
    scan: scan(extensions.map(ext => ({ rel: 'sub/file.' + ext })).concat([{ rel: 'sub/file.csv' }])),
    folders: [], targetFolderId: ''
  });
  assert.equal(plan.files.length, 9);
  assert.equal(plan.skippedUnsupported, 1);
  assert.deepEqual(plan.createList.map(item => item.key), ['sub']);
  assert.deepEqual(LitFolderImport.collapseRootPaths(['C:\\docs\\A', 'C:\\docs', 'C:\\docs\\B', 'C:\\docs2']),
    ['C:\\docs', 'C:\\docs2']);
});

test('同名复用：根与子层大小写不敏感、精确大小写优先、墓碑不参与', () => {
  const folders = FOLDERS.concat([{ id: 'f-exact', name: 'EXACT', parentId: 'f-a' }]);
  const plan = LitFolderImport.planFolderImport({
    scan: scan([{ rel: 'exact/x.pdf' }], '已有同名'),
    folders: folders,
    targetFolderId: ''
  });
  // 根复用（同名不同 case 也复用）；子层 'exact' 命中 'EXACT'
  assert.equal(plan.root.id, 'f-a');
  assert.equal(plan.createList.length, 0);
  assert.equal(plan.reuseMap['exact'], 'f-exact');
  assert.equal(plan.createdCount, 0);
});

test('精确大小写优先于先出现的不同 case 候选', () => {
  const folders = [
    { id: 'f-lower', name: 'a', parentId: '' },
    { id: 'f-upper', name: 'A', parentId: '' }
  ];
  const plan = LitFolderImport.planFolderImport({
    scan: scan([{ rel: 'x.pdf' }], 'A'),
    folders: folders,
    targetFolderId: ''
  });
  assert.equal(plan.root.id, 'f-upper');
});

test('父层待新建时子层只能新建（不跨层误复用）', () => {
  const folders = [{ id: 'f-ghost', name: 'inner', parentId: 'f-nonexistent' }];
  const plan = LitFolderImport.planFolderImport({
    scan: scan([{ rel: 'newroot/inner/a.pdf' }], '新根'),
    folders: folders,
    targetFolderId: ''
  });
  assert.equal(plan.root.id, '');
  assert.deepEqual(plan.createList.map(c => c.key), ['newroot', 'newroot/inner']);
  // f-ghost 挂在不存在的父层，不会被误认作 newroot/inner 的复用对象
  assert.equal(plan.reuseMap['newroot/inner'], undefined);
});

test('落在指定文件夹内部：以其为根解析，子级同名复用', () => {
  const folders = FOLDERS.concat([
    { id: 'f-troot', name: '拖入根', parentId: 'f-a' },
    { id: 'f-sub2', name: 'Sub1', parentId: 'f-troot' }
  ]);
  const plan = LitFolderImport.planFolderImport({
    scan: scan([{ rel: 'sub1/a.pdf' }], '拖入根'),
    folders: folders,
    targetFolderId: 'f-a'
  });
  assert.equal(plan.root.id, 'f-troot');         // f-a 下已有「拖入根」→ 复用
  assert.equal(plan.reuseMap['sub1'], 'f-sub2'); // 其下的 Sub1 大小写不敏感复用
  assert.equal(plan.createList.length, 0);
  assert.equal(plan.createdCount, 0);
});

test('无效/墓碑目标文件夹回退根级', () => {
  const plan = LitFolderImport.planFolderImport({
    scan: scan([{ rel: 'x.pdf' }], '根'),
    folders: FOLDERS,
    targetFolderId: 'f-dead'
  });
  // 按根级解析：根级下没有「根」→ 待新建
  assert.equal(plan.root.id, '');
  assert.equal(plan.createList.length, 0);
});

test('名称清理：超长截断 80、空白名兜底（key 保留原样）', () => {
  const long = 'L'.repeat(120);
  const plan = LitFolderImport.planFolderImport({
    scan: scan([{ rel: long + '/' + ' '.repeat(6) + '/a.pdf' }], long),
    folders: [],
    targetFolderId: ''
  });
  assert.equal(plan.root.name.length, 80);
  const deep = plan.createList.find(c => c.name.length === 80);
  assert.ok(deep && deep.key.length === 120); // key 用原始 rel，只有 name 截断
  const blank = plan.createList.find(c => c.name === '(未命名)');
  assert.ok(blank && blank.parentKey === long);
});

test('PDF 判定兼容大写扩展名（ext 缺失时按文件名兜底）', () => {
  const raw = scan([{ rel: 'a.PDF' }, { rel: 'b.pdf' }, { rel: 'c.docx' }]);
  raw.files[0].ext = ''; // 模拟上游 ext 缺失，防御分支按 name 判定
  const plan = LitFolderImport.planFolderImport({ scan: raw, folders: [], targetFolderId: '' });
  assert.equal(plan.pdfs.length, 2);
  assert.equal(plan.skippedUnsupported, 0);
});
