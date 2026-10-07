'use strict';

/* research:semantic-search 的 2026-10 提速回归（对照上游 literature-mcp registry.py 的
 * create_task(_top_up) 并发路线）：向量索引已就绪时，查询文本嵌入必须与 topUp **并行**
 * 发出——串行实现里查询要白等补齐批次（最多 50 篇一轮嵌入的网络耗时）才发自己的向量。
 * 同时守住计费红线：索引未就绪时查询嵌入绝不提前发（那次检索可能整体降级为关键词，
 * 白花一次调用）；topUp 的基础设施性报错按非致命降级（上游：top-up failures stay
 * non-fatal for the read），检索按现有向量照常完成。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-semantic-'));
const handlers = {};
const fakeSender = {
  isDestroyed: function () { return false; },
  send: function () {}
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
let ctx;
let createResearchDb;
let LitResearch;
try {
  ctx = require('../electron/ipc/context.js');
  createResearchDb = require('../electron/research-db.js').createResearchDb;
  LitResearch = require('../js/research.js');
  require('../electron/ipc/research.js').register();
} finally {
  Module._load = origLoad;
}
ctx.mainWindow = { isDestroyed: function () { return false; }, webContents: fakeSender };

const MODEL = 'm1';
let caseSeq = 0;
async function setup(opts) {
  caseSeq += 1;
  const db = createResearchDb({ dir: path.join(tmpdir, 'case-' + caseSeq) });
  await db.open();
  db.upsertWorks(opts.rows || [{ id: 'W1', title: 'Alpha study', abstract: 'alpha text', year: 2020 }]);
  if (!opts.noVectors) {
    const pending = db.pendingEmbeddings({ model: MODEL, recipe: LitResearch.EMBED_RECIPE, limit: 100 });
    db.vecPut(pending.map(function (p) {
      return { workId: p.work.id, model: MODEL, dim: 1, recipe: LitResearch.EMBED_RECIPE,
        hash: p.hash, vec: Buffer.from(new Float32Array([0.5]).buffer) };
    }));
  }
  ctx.researchDb = db;
  ctx.embedService = opts.embedService;
  ctx.researchEmbedder = opts.researchEmbedder || null;
  return db;
}
function invoke(input) {
  return handlers['research:semantic-search']({ sender: fakeSender, senderFrame: null }, input || {});
}
const tick = function () { return new Promise(function (resolve) { setImmediate(resolve); }); };

test('向量已就绪：查询嵌入与 topUp 并行发出，不等补齐批次收尾', async function () {
  const events = [];
  let releaseTopUp;
  const gate = new Promise(function (resolve) { releaseTopUp = resolve; });
  const db = await setup({
    embedService: {
      resolveTarget: async function () { return { ok: true, model: MODEL, source: 'test' }; },
      embedTexts: async function () {
        events.push('query-embed');
        return { model: MODEL, vectors: [[1]] };
      }
    },
    researchEmbedder: {
      topUp: async function () {
        events.push('topUp-start');
        await gate; // 补齐批次挂起，模拟 50 篇一轮嵌入的网络耗时
        events.push('topUp-end');
        return { embedded: 0, pending: 0 };
      }
    }
  });
  try {
    const pendingResult = invoke({ query: 'battery life' });
    await tick(); await tick();
    // 查询嵌入必须在 topUp 收尾之前发出；串行实现在这个时点只有 topUp-start
    assert.ok(events.indexOf('query-embed') >= 0 && events.indexOf('topUp-end') < 0,
      '查询嵌入应与 topUp 并行发出，实际事件序：' + events.join(' → '));
    releaseTopUp();
    const result = await pendingResult;
    assert.equal(result.mode, 'vector');
    assert.equal(result.works.length, 1);
  } finally { db.close(); }
});

test('向量未就绪：查询嵌入不提前发（计费红线），topUp 补齐后才发', async function () {
  const events = [];
  const db = await setup({
    noVectors: true,
    embedService: {
      resolveTarget: async function () { return { ok: true, model: MODEL, source: 'test' }; },
      embedTexts: async function () { events.push('embed'); return { model: MODEL, vectors: [[1]] }; }
    },
    researchEmbedder: {
      topUp: async function () {
        events.push('topUp');
        // 补齐真实落库，让覆盖转为可用（验证「topUp 后才允许发查询嵌入」的顺序）
        const pending = ctx.researchDb.pendingEmbeddings({ model: MODEL, recipe: LitResearch.EMBED_RECIPE, limit: 10 });
        ctx.researchDb.vecPut(pending.map(function (p) {
          return { workId: p.work.id, model: MODEL, dim: 1, recipe: LitResearch.EMBED_RECIPE,
            hash: p.hash, vec: Buffer.from(new Float32Array([0.5]).buffer) };
        }));
        return { embedded: pending.length, pending: pending.length };
      }
    }
  });
  try {
    const result = await invoke({ query: 'battery life' });
    assert.deepEqual(events, ['topUp', 'embed'], '未就绪时查询嵌入必须在 topUp 之后才发：' + events.join(' → '));
    assert.equal(result.mode, 'vector');
  } finally { db.close(); }
});

test('topUp 基础设施报错不拖垮检索：按现有向量照常完成（non-fatal for the read）', async function () {
  const db = await setup({
    embedService: {
      resolveTarget: async function () { return { ok: true, model: MODEL, source: 'test' }; },
      embedTexts: async function () { return { model: MODEL, vectors: [[1]] }; }
    },
    researchEmbedder: {
      topUp: async function () { throw new Error('db boomed'); }
    }
  });
  try {
    const result = await invoke({ query: 'battery life' });
    assert.equal(result.mode, 'vector');
    assert.equal(result.works.length, 1);
  } finally { db.close(); }
});
