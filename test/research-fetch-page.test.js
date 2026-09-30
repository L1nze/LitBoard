'use strict';

/* 驱动真实 research:fetch-page handler，覆盖单篇读取、墓碑与分块续读。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-fetchpage-'));
test.after(function () { fs.rmSync(tmpdir, { recursive: true, force: true }); });
const handlers = {};
const fakeSender = {
  isDestroyed: function () { return false; },
  sent: [],
  send: function (channel, payload) { this.sent.push({ channel: channel, payload: payload }); }
};
const electronStub = {
  app: { getPath: function () { return tmpdir; } },
  ipcMain: { handle: function (ch, fn) { handlers[ch] = fn; } },
  dialog: {}
};
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return electronStub;
  if (request.endsWith('integrations.js')) return { storeFileInto: async function () { throw new Error('stub'); } };
  return origLoad.apply(this, arguments);
};
try {
  require('../electron/ipc/research.js').register();
} finally {
  Module._load = origLoad;
}
const ctx = require('../electron/ipc/context.js');
ctx.mainWindow = { isDestroyed: function () { return false; }, webContents: fakeSender };

let caseSeq = 0;
const LONG_MARKDOWN = '# Probe Page\n\n' + 'x'.repeat(6000); // >4000 才有第二块

function setup(opts) {
  caseSeq += 1;
  const calls = { fetchPage: [], pdfTextPut: [] };
  ctx.webFetchNet = {
    fetchPage: async function (req) {
      calls.fetchPage.push(req);
      return { ok: true, partial: false, markdown: opts.markdown || LONG_MARKDOWN,
        title: opts.title || 'Probe Page', finalUrl: (req && req.url) || '' };
    }
  };
  ctx.libraryDb = {
    getSetting: function (key) {
      return key === 'webSearchEnabled' || key === 'webSearchEgressAcknowledged';
    },
    // 回归守卫：这条通道不允许退回整库 loadState（那是本修的根因）
    loadState: async function () { throw new Error('fetch-page 不得整库 loadState，应走 getPaper 单行读取'); },
    getPaper: async function (paperId) {
      const rows = opts.papers || {};
      const paper = rows[paperId];
      return paper ? Object.assign({}, paper) : null;
    },
    pdfTextPut: opts.pdfTextPut || async function (entry) { calls.pdfTextPut.push(entry); }
  };
  ctx.dataPathState = { configDir: path.join(tmpdir, 'case-' + caseSeq) };
  ctx.agentSessions = null;
  ctx.researchDb = null;
  return calls;
}

function invokeFetchPage(input) {
  return handlers['research:fetch-page']({ sender: fakeSender, senderFrame: null }, input || {});
}

test('存活文献：首块（offset=0）写快照附件并落 pdf_fts，fingerprint 是正文 sha256', async function () {
  const calls = setup({ papers: { p1: { id: 'p1', title: 'A paper', deletedAt: null } } });
  const r = await invokeFetchPage({ url: 'https://arxiv.org/abs/2401.00001', paperId: 'p1', offset: 0 });
  assert.equal(r.ok, true);
  assert.equal(calls.fetchPage.length, 1);
  // 快照附件目录与两个文件真实落盘
  assert.equal(r.attachment.kind, 'snapshot');
  assert.match(r.attachment.id, /^att/);
  assert.equal(r.attachment.path, path.join(ctx.dataPathState.configDir, 'synced-attachments', 'items', 'p1', r.attachment.id + '.snapshot'));
  assert.equal(fs.readFileSync(path.join(r.attachment.path, 'page.md'), 'utf8'), LONG_MARKDOWN, 'page.md = 原始 markdown');
  const html = fs.readFileSync(path.join(r.attachment.path, 'index.html'), 'utf8');
  assert.ok(html.indexOf('<!DOCTYPE html>') === 0 && html.indexOf('<title>Probe Page</title>') !== -1);
  // R07：索引写入必须 await 完成（这里是本测试同步可见的最终态）
  assert.equal(calls.pdfTextPut.length, 1, '首块必须且只写一次全文索引');
  const put = calls.pdfTextPut[0];
  assert.equal(put.paperId, 'p1');
  assert.equal(put.attachmentId, r.attachment.id);
  assert.equal(put.method, 'snapshot');
  assert.deepEqual(put.pages, [LONG_MARKDOWN]);
  assert.equal(put.fingerprint, crypto.createHash('sha256').update(LONG_MARKDOWN, 'utf8').digest('hex'));
  // 窗口语义：首块 4000 字，还有下文
  assert.equal(r.markdownExcerpt.length, 4000);
  assert.equal(r.nextOffset, 4000);
  assert.equal(r.title, 'Probe Page');
});

test('已删除文献（墓碑）：如实报「未找到」，不建快照目录、不写索引', async function () {
  const calls = setup({ papers: { p1: { id: 'p1', title: 'A paper', deletedAt: 1730000000000 } } });
  const r = await invokeFetchPage({ url: 'https://arxiv.org/abs/2401.00002', paperId: 'p1', offset: 0 });
  assert.equal(r.ok, false);
  assert.ok(String(r.error).indexOf('未找到该正式库文献') !== -1, '错误如实指向该文献：' + r.error);
  assert.equal(r.attachment, undefined);
  assert.equal(calls.pdfTextPut.length, 0);
  assert.equal(fs.existsSync(path.join(ctx.dataPathState.configDir, 'synced-attachments')), false, '不留任何快照目录');
});

test('文献不存在（getPaper 返回 null）：同路径如实报错，不写任何东西', async function () {
  const calls = setup({ papers: {} });
  const r = await invokeFetchPage({ url: 'https://arxiv.org/abs/2401.00003', paperId: 'p404', offset: 0 });
  assert.equal(r.ok, false);
  assert.ok(String(r.error).indexOf('未找到该正式库文献') !== -1);
  assert.equal(calls.pdfTextPut.length, 0);
  assert.equal(r.attachment, undefined);
});

test('R07：handler 必须等待 pdfTextPut 完成后才返回（索引写入不是 fire-and-forget）', async function () {
  const events = [];
  const puts = [];
  let resolvePut = null;
  const gate = new Promise(function (resolve) { resolvePut = resolve; });
  setup({
    papers: { p1: { id: 'p1', title: 'A paper', deletedAt: null } },
    pdfTextPut: async function (entry) {
      events.push('put-start');
      await gate;
      events.push('put-end');
      puts.push(entry);
    }
  });
  let settled = false;
  const pending = invokeFetchPage({ url: 'https://arxiv.org/abs/2401.00004', paperId: 'p1', offset: 0 })
    .then(function (r) { settled = true; return r; });
  // handler 在 pdfTextPut 之前还有几步真实 fs 异步（mkdir/writeFile），轮询等它到位
  const deadline = Date.now() + 5000;
  while (events.length === 0 && Date.now() < deadline) {
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
  }
  assert.deepEqual(events, ['put-start'], '应已进入 pdfTextPut');
  assert.equal(settled, false, 'pdfTextPut 未完成前 handler 不得返回');
  resolvePut();
  const r = await pending;
  assert.equal(r.ok, true);
  assert.deepEqual(events, ['put-start', 'put-end']);
  assert.equal(puts.length, 1);
});

test('续读（offset>0）：缓存命中不再发网络请求，也绝不重复写快照/索引', async function () {
  const calls = setup({ papers: { p1: { id: 'p1', title: 'A paper', deletedAt: null } } });
  const url = 'https://arxiv.org/abs/2401.00005';
  const first = await invokeFetchPage({ url: url, paperId: 'p1', offset: 0 });
  assert.equal(first.ok, true);
  assert.equal(calls.pdfTextPut.length, 1);
  const firstAttId = first.attachment.id;
  // 同 URL 续读：走 R12 内存缓存——零网络、零写入
  const second = await invokeFetchPage({ url: url, paperId: 'p1', offset: 4000 });
  assert.equal(second.ok, true);
  assert.equal(calls.fetchPage.length, 1, '续读命中缓存，不再抓取');
  assert.equal(calls.pdfTextPut.length, 1, '续读不得重复写索引');
  assert.equal(second.attachment, undefined, '续读不重复挂载快照附件');
  assert.equal(second.markdownExcerpt, LONG_MARKDOWN.slice(4000, 8000));
  assert.equal(second.nextOffset, null, '正文读完了');
  // 全新 URL 的续读（缓存未命中）允许再抓一次，但同样不写
  const third = await invokeFetchPage({ url: 'https://arxiv.org/abs/2401.00006', paperId: 'p1', offset: 100 });
  assert.equal(third.ok, true);
  assert.equal(calls.fetchPage.length, 2, '未命中缓存的续读重新抓取正文');
  assert.equal(calls.pdfTextPut.length, 1, '即使重新抓取，续读也不写快照/索引');
  assert.equal(third.attachment, undefined);
  assert.ok(firstAttId.length > 0);
});
