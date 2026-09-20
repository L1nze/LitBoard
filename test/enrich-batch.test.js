'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadEnrichModule() {
  const calls = [];
  const context = {
    URL,
    setTimeout,
    Promise,
    localStorage: { getItem: function () { return ''; } },
    window: {
      litboardDesktop: {
        fetchJson: function (url) {
          calls.push(url);
          // 一律命中 OpenAlex：每篇一次请求、立即返回最小 work 对象
          if (String(url).indexOf('api.openalex.org') !== -1) {
            return Promise.resolve({ status: 200, ok: true, data: { id: 'W1', cited_by_count: 3 } });
          }
          return Promise.resolve({ status: 404, ok: false, data: null });
        }
      }
    }
  };
  context.window.window = context.window;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js', 'enrich.js'), 'utf8'), context);
  return { enrich: context.window.LitEnrich, calls: calls };
}

function makePapers(n) {
  const papers = [];
  for (let i = 0; i < n; i++) papers.push({ id: 'p' + i, doi: '10.1000/x' + i, title: 'Paper ' + i });
  return papers;
}

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

test('enrichBatch 不带 ctl 时行为不变：全部完成', async function () {
  const { enrich } = loadEnrichModule();
  const papers = makePapers(4);
  const seen = [];
  const results = await enrich.enrichBatch(papers, function (done) { seen.push(done); });
  assert.equal(results.length, 4);
  assert.deepEqual(seen, [1, 2, 3, 4]);
  assert.equal(results[0].patch.citations, 3);
});

test('enrichBatch 支持中断：保留已完成部分，之后不再推进', async function () {
  const { enrich } = loadEnrichModule();
  const papers = makePapers(8);
  const seen = [];
  const ctl = { paused: false, aborted: false };
  const promise = enrich.enrichBatch(papers, function (done) { seen.push(done); }, ctl);
  await sleep(120);            // 首轮 3 个 worker 已完成各自动作
  assert.equal(seen.length, 3);
  ctl.aborted = true;
  ctl.wake();
  const results = await promise;
  assert.ok(results.length < 8, '中断后不应跑完全部');
  assert.equal(seen.length, results.length);
  const frozen = seen.length;
  await sleep(600);
  assert.equal(seen.length, frozen, '中断后不应再有新进度');
});

test('enrichBatch 支持暂停与继续：暂停期间零推进', async function () {
  const { enrich } = loadEnrichModule();
  const papers = makePapers(6);
  const seen = [];
  const ctl = { paused: false, aborted: false };
  const promise = enrich.enrichBatch(papers, function (done) { seen.push(done); }, ctl);
  await sleep(120);
  ctl.paused = true;           // 在飞的做完、间隔走完后撞上暂停门
  await sleep(500);
  const frozen = seen.length;
  assert.ok(frozen > 0 && frozen < 6, '暂停前应已完成一部分');
  await sleep(400);
  assert.equal(seen.length, frozen, '暂停期间不应推进');
  ctl.paused = false;
  ctl.wake();
  const results = await promise;
  assert.equal(results.length, 6, '继续后应跑完全部');
});

test('enrichBatch 暂停中也能中断：wake 释放暂停门后按 aborted 退出', async function () {
  const { enrich } = loadEnrichModule();
  const papers = makePapers(6);
  const seen = [];
  const ctl = { paused: false, aborted: false };
  const promise = enrich.enrichBatch(papers, function (done) { seen.push(done); }, ctl);
  await sleep(120);
  ctl.paused = true;
  await sleep(500);            // worker 已堵在暂停门上
  ctl.aborted = true;
  ctl.wake();                  // 不唤醒会永远挂起——这条测试同时是挂起回归
  const results = await promise;
  assert.ok(results.length > 0 && results.length < 6);
});

test('createAttemptLedger：TTL 内算查过、过期自动修剪、可清除、写回 store', function () {
  const { enrich } = loadEnrichModule();
  let saved = null;
  let nowMs = 1000000;
  const ledger = enrich.createAttemptLedger(
    { get: function () { return saved; }, set: function (m) { saved = m; } },
    { ttlMs: 1000, now: function () { return nowMs; } }
  );
  ledger.mark('a');
  assert.equal(ledger.isRecent('a'), true);
  assert.deepEqual(Object.keys(saved), ['a'], 'mark 要写回 store');
  assert.equal(saved.a, 1000000);
  nowMs += 999;
  assert.equal(ledger.isRecent('a'), true);
  nowMs += 2;
  assert.equal(ledger.isRecent('a'), false, '超过 TTL 不算查过');
  ledger.clear('a');
  assert.equal(ledger.isRecent('a'), false);
  assert.deepEqual(Object.keys(saved), []);

  // 预存的过期台账在创建时即被修剪，不会把老记录当「查过」跳过
  saved = { stale: nowMs - 5000, fresh: nowMs };
  const ledger2 = enrich.createAttemptLedger(
    { get: function () { return saved; }, set: function (m) { saved = m; } },
    { ttlMs: 1000, now: function () { return nowMs; } }
  );
  assert.equal(ledger2.isRecent('stale'), false);
  assert.equal(ledger2.isRecent('fresh'), true);

  // store 抛错/返回垃圾时不炸，退化为空台账
  const ledger3 = enrich.createAttemptLedger(
    { get: function () { throw new Error('boom'); }, set: function () { throw new Error('boom'); } },
    { ttlMs: 1000, now: function () { return nowMs; } }
  );
  ledger3.mark('x');
  assert.equal(ledger3.isRecent('x'), true);
  assert.equal(ledger3.count(), 1);
});
