'use strict';

/* research:register（补登记）的回归测试——stub electron 模块后驱动真实 handler。
 * 根因回归：带 DOI 的正式库条目若不在调研库 ext_ids 里，旧实现既不做在线反查、
 * 两个兜底分支又被 `!doi` 守卫挡住，永远拿不到调研身份——用户点「补登记」显示
 * 成功，右键「构建引文网络」却始终提示「所选文献还没有调研身份」。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-register-'));
const handlers = {};
const fakeSender = {};
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
let ctx;
let createResearchDb;
try {
  ctx = require('../electron/ipc/context.js');
  createResearchDb = require('../electron/research-db.js').createResearchDb;
  require('../electron/ipc/research.js').register();
} finally {
  Module._load = origLoad;
}
ctx.mainWindow = { isDestroyed: function () { return false; }, webContents: fakeSender };

let caseSeq = 0;
async function setup(opts) {
  caseSeq += 1;
  const db = createResearchDb({ dir: path.join(tmpdir, 'case-' + caseSeq) });
  await db.open();
  if (opts.researchRows && opts.researchRows.length) db.upsertWorks(opts.researchRows);
  ctx.researchDb = db;
  ctx.researchNet = opts.researchNet || null;
  ctx.libraryDb = { loadState: async function () { return { papers: opts.papers || [] }; } };
  return db;
}

function invokeRegister(input) {
  return handlers['research:register']({ sender: fakeSender, senderFrame: null }, input || {});
}

function paper(over) {
  return Object.assign({ id: 'p', title: 'A paper', doi: '', year: 2020, deletedAt: null, researchIds: [] }, over);
}

test('DOI 已在调研库：本地直查命中，不触网', async function () {
  const db = await setup({
    researchRows: [{ id: 'W42', doi: '10.1/a', title: 'Known locally', year: 2021 }],
    researchNet: {
      fetchWorksByDois: async function () { throw new Error('不应被调用'); }
    },
    papers: [paper({ id: 'p1', doi: '10.1/A', title: 'Known locally' })]
  });
  const r = await invokeRegister();
  assert.equal(r.scanned, 1);
  assert.deepEqual(r.proposals.map(function (p) { return p.researchId; }), ['W42']);
  assert.equal(r.unresolved, 0);
  db.close();
});

test('DOI 不在调研库：批量在线反查 OpenAlex，解析为真实 W 身份并入库', async function () {
  const calls = [];
  const db = await setup({
    researchNet: {
      fetchWorksByDois: async function (dois) {
        calls.push(dois.slice());
        return [{ id: 'W1000', doi: '10.1000/known', title: 'Resolved online', year: 2024 }];
      }
    },
    papers: [paper({ id: 'p1', doi: '10.1000/KNOWN', title: 'Resolved online' })]
  });
  const r = await invokeRegister();
  assert.equal(calls.length, 1, '缺失 DOI 应批量反查一次');
  assert.deepEqual(calls[0], ['10.1000/known'], 'DOI 须规范化后再查');
  assert.deepEqual(r.proposals.map(function (p) { return p.researchId; }), ['W1000']);
  assert.equal(r.unresolved, 0);
  // 反查到的 work 已入调研库（含 ext_ids），下次补登记不再触网
  assert.equal(db.findByExtId('doi', '10.1000/known'), 'W1000');
  db.close();
});

test('DOI 在线反查不到：不建 local: 身份（防身份分裂），如实计入 unresolved', async function () {
  const db = await setup({
    researchNet: { fetchWorksByDois: async function () { return []; } },
    papers: [paper({ id: 'p1', doi: '10.1000/unknown', title: 'Nowhere to be found' })]
  });
  const r = await invokeRegister();
  assert.equal(r.proposals.length, 0);
  assert.equal(r.unresolved, 1);
  assert.equal(db.findByExtId('doi', '10.1000/unknown'), null, 'doi 不得绑定到 local: 身份');
  db.close();
});

test('在线反查抛错（离线/限流）：不阻断，无 DOI 条目照常拿本地身份', async function () {
  const db = await setup({
    researchNet: {
      fetchWorksByDois: async function () { throw new Error('network down'); }
    },
    papers: [
      paper({ id: 'p1', doi: '10.1000/x', title: 'DOI but offline' }),
      paper({ id: 'p2', doi: '', title: 'No DOI at all' })
    ]
  });
  const r = await invokeRegister();
  assert.equal(r.unresolved, 1);
  assert.equal(r.proposals.length, 1);
  assert.equal(r.proposals[0].paperId, 'p2');
  assert.match(r.proposals[0].researchId, /^local:/);
  db.close();
});

test('无 DOI 且标题命中既有条目：认领既有身份而不是新建 local:', async function () {
  const db = await setup({
    researchRows: [{ id: 'W7', doi: '', title: 'An existing research work', year: 2019 }],
    papers: [paper({ id: 'p1', doi: '', title: 'An existing research work' })]
  });
  const r = await invokeRegister();
  assert.deepEqual(r.proposals.map(function (p) { return p.researchId; }), ['W7']);
  db.close();
});

test('带 DOI 条目在线反查失败但标题命中既有条目：按标题认领（零分裂风险）', async function () {
  const db = await setup({
    researchRows: [{ id: 'local:web1', doi: '', title: 'Found by web search earlier', year: 2023 }],
    researchNet: {
      fetchWorksByDois: async function () { throw new Error('offline'); }
    },
    papers: [paper({ id: 'p1', doi: '10.1000/y', title: 'Found by web search earlier' })]
  });
  const r = await invokeRegister();
  assert.deepEqual(r.proposals.map(function (p) { return p.researchId; }), ['local:web1']);
  assert.equal(r.unresolved, 0);
  db.close();
});

test('已有调研身份的条目不重复扫描', async function () {
  const db = await setup({
    papers: [paper({ id: 'p1', doi: '10.1/a', researchIds: ['W42'] })]
  });
  const r = await invokeRegister();
  assert.equal(r.scanned, 0);
  assert.equal(r.proposals.length, 0);
  db.close();
});
