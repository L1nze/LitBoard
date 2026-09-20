'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  downloadPdfResponseToFile,
  isProbablyPdfBytes,
  safePdfFileName,
  composeAutoDownloadPath
} = require('../electron/pdfdownload.js');

test('PDF download rejects non-PDF bytes even when the response is not HTML', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-pdf-download-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const target = path.join(dir, 'paper.pdf');

  const result = await downloadPdfResponseToFile(
    new Response('{"error":"forbidden"}', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }),
    target
  );

  assert.match(result.error, /不是有效 PDF/);
  await assert.rejects(fs.access(target), { code: 'ENOENT' });
  await assert.rejects(fs.access(target + '.part'), { code: 'ENOENT' });
});

test('PDF download streams and saves valid PDF bytes', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-pdf-download-ok-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const target = path.join(dir, 'paper.pdf');
  const progress = [];

  const result = await downloadPdfResponseToFile(
    new Response('%PDF-1.7\nbody', {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'content-length': '13' }
    }),
    target,
    function (received, total) { progress.push([received, total]); }
  );

  assert.deepEqual(result, { path: target });
  assert.equal(await fs.readFile(target, 'utf8'), '%PDF-1.7\nbody');
  assert.ok(progress.length >= 1);
  assert.equal(progress[progress.length - 1][1], 13);
});

test('PDF byte sniffing tolerates leading transport noise within the first kilobyte', function () {
  assert.equal(isProbablyPdfBytes(Buffer.from('%PDF-1.4\n')), true);
  assert.equal(isProbablyPdfBytes(Buffer.concat([Buffer.alloc(32), Buffer.from('%PDF-1.7\n')])), true);
  assert.equal(isProbablyPdfBytes(Buffer.from('<!doctype html>')), false);
});

test('PDF file names are safe for Windows save dialogs', function () {
  assert.equal(safePdfFileName('A/B:C*D?E"F<G>H|I.pdf'), 'A_B_C_D_E_F_G_H_I.pdf');
  assert.equal(safePdfFileName(''), 'paper.pdf');
});

test('auto download target joins the configured dir and applies safe naming', function () {
  const path = require('node:path');
  // 目录 + 模板主名 → 落盘路径；主名缺 .pdf 自动补
  assert.equal(
    composeAutoDownloadPath('D:\\papers', 'Vaswani A - 2017 - Attention Is All You Need'),
    path.join('D:\\papers', 'Vaswani A - 2017 - Attention Is All You Need.pdf')
  );
  // 主名里的 Windows 非法字符清洗掉（模板值来自文献元数据，不可信）
  assert.equal(
    composeAutoDownloadPath('D:\\papers', 'a<b>:c'),
    path.join('D:\\papers', 'a_b__c.pdf')
  );
  // 目录未设置 → null，调用方回退弹保存框
  assert.equal(composeAutoDownloadPath('', 'x'), null);
  assert.equal(composeAutoDownloadPath('   ', 'x'), null);
});
