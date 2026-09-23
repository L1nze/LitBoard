'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const flow = require('../js/app/pdf-import-flow.js');

test('PDF 批量解析保留输入顺序、限制并发并忽略单项失败', async function () {
  let running = 0;
  let peak = 0;
  const failures = [];
  const values = await flow.parseMany([1, 2, 3, 4], function (value) {
    running++;
    peak = Math.max(peak, running);
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        running--;
        if (value === 3) reject(new Error('bad file'));
        else resolve({ value: value });
      }, value === 1 ? 20 : 5);
    });
  }, {
    concurrency: 2,
    timeoutMs: 50,
    onError: function (item, error) { failures.push([item, error.message]); }
  });

  assert.equal(peak, 2);
  assert.deepEqual(values, [{ value: 1 }, { value: 2 }, { value: 4 }]);
  assert.deepEqual(failures, [[3, 'bad file']]);
});

test('PDF 批量解析超时后继续处理剩余项', async function () {
  const failures = [];
  let running = 0;
  let peak = 0;
  const values = await flow.parseMany(['slow', 'fast'], function (value) {
    running++;
    peak = Math.max(peak, running);
    return new Promise(function (resolve) {
      setTimeout(function () { running--; resolve(value); }, value === 'slow' ? 30 : 1);
    });
  }, {
    concurrency: 1,
    timeoutMs: 5,
    onError: function (item, error) { failures.push([item, error.message]); }
  });

  assert.deepEqual(values, ['fast']);
  assert.deepEqual(failures, [['slow', 'timeout']]);
  assert.equal(peak, 1, '超时任务仍在运行时不能启动下一项');
  assert.equal(running, 0);
});

function pdf(id, fingerprint, path) {
  return {
    id: id,
    pdfFingerprint: fingerprint || '',
    attachments: [{ id: 'att-' + id, kind: 'pdf', fingerprint: fingerprint || '', path: path || ('C:/' + id + '.pdf') }]
  };
}

test('PDF 入库复制计划跳过库内已有内容，只保留文件夹软链合并', function () {
  const same = 'a'.repeat(64);
  const fresh = 'b'.repeat(64);
  const existing = [pdf('existing', same, 'D:/managed/existing.pdf')];
  const incomingSame = pdf('incoming-same', same, 'C:/source/copy.pdf');
  const incomingFresh = pdf('incoming-fresh', fresh, 'C:/source/fresh.pdf');

  const tasks = flow.pdfAttachmentsToStore([incomingSame, incomingFresh], existing);

  assert.deepEqual(tasks.map(function (attachment) { return attachment.id; }), ['att-incoming-fresh']);
});

test('PDF 入库复制计划在同一批次只复制一份相同内容', function () {
  const same = 'c'.repeat(64);
  const first = pdf('first', same, 'C:/folder-a/paper.pdf');
  const second = pdf('second', same, 'C:/folder-b/paper.pdf');

  const tasks = flow.pdfAttachmentsToStore([first, second], []);

  assert.deepEqual(tasks.map(function (attachment) { return attachment.id; }), ['att-first']);
});

test('PDF 入库复制计划保守复制无指纹文件和不同版本', function () {
  const oldFingerprint = 'd'.repeat(64);
  const newFingerprint = 'e'.repeat(64);
  const existing = [pdf('existing', oldFingerprint, 'D:/managed/old.pdf')];
  const newVersion = pdf('new-version', newFingerprint, 'C:/source/new.pdf');
  const noFingerprint = pdf('unknown', '', 'C:/source/unknown.pdf');

  const tasks = flow.pdfAttachmentsToStore([newVersion, noFingerprint], existing);

  assert.deepEqual(tasks.map(function (attachment) { return attachment.id; }), ['att-new-version', 'att-unknown']);
});

test('PDF 入库复制计划不复用回收站条目的附件', function () {
  const fingerprint = 'f'.repeat(64);
  const trashed = pdf('trashed', fingerprint, 'D:/managed/trashed.pdf');
  trashed.deletedAt = Date.now();
  const incoming = pdf('incoming', fingerprint, 'C:/source/incoming.pdf');

  const tasks = flow.pdfAttachmentsToStore([incoming], [trashed]);

  assert.deepEqual(tasks.map(function (attachment) { return attachment.id; }), ['att-incoming']);
});

test('PDF 受管复制失败时拒绝导入，且不改附件路径', async function () {
  const incoming = pdf('incoming', 'a'.repeat(64), 'C:/source/paper.pdf');
  await assert.rejects(
    flow.storePdfAttachments([incoming], [], function () {
      return Promise.resolve({ error: '磁盘已满' });
    }),
    /磁盘已满/
  );
  assert.equal(incoming.attachments[0].path, 'C:/source/paper.pdf');
});

test('PDF 受管复制成功后才更新附件路径', async function () {
  const incoming = pdf('incoming', 'b'.repeat(64), 'C:/source/paper.pdf');
  await flow.storePdfAttachments([incoming], [], function () {
    return Promise.resolve({ path: 'D:/managed/paper.pdf', name: 'paper.pdf' });
  });
  assert.equal(incoming.attachments[0].path, 'D:/managed/paper.pdf');
  assert.equal(incoming.attachments[0].fileName, 'paper.pdf');
});
