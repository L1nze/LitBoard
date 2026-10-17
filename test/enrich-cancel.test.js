'use strict';

/* enrich 端到端取消通道（渲染层语义）回归：AbortSignal 不能过 IPC——
 * 桥上每个请求带 requestId 登记，abort 时经 api:fetch-abort 跨进程中止主进程
 * 在飞请求，同时本地立即以 aborted 拒绝（不等 IPC 往返，链条即刻停止消费结果）。
 * 主进程侧的台账/通道对等由 test/ipc-parity.test.js 守护。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/enrich.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function loadEnrich(bridge) {
  const sandbox = {
    window: { litboardDesktop: bridge },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    Date: Date, Promise: Promise, AbortController: AbortController
  };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.LitEnrich;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
  return { promise: promise, resolve: resolve, reject: reject };
}

test('已中止的 signal：请求不再发起，直接以 aborted 拒绝', async () => {
  let calls = 0;
  const LitEnrich = loadEnrich({
    fetchJson: function () { calls++; return deferred().promise; },
    abortFetch: function () {}
  });
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(LitEnrich.byDoi('10.1/x', false, { signal: ctl.signal }), /aborted/);
  assert.equal(calls, 0, '不应发起任何桥请求');
});

test('在飞请求 abort：跨进程 abortFetch 收到同一 requestId，本地立即拒绝不等 IPC', async () => {
  const seen = [];
  const gate = deferred();
  const LitEnrich = loadEnrich({
    fetchJson: function (_url, requestId) {
      seen.push(['fetch', requestId]);
      return gate.promise.then(function () { return { status: 200, ok: true, data: {} }; });
    },
    abortFetch: function (requestId) { seen.push(['abort', requestId]); return Promise.resolve(true); }
  });
  const ctl = new AbortController();
  const promise = LitEnrich.byDoi('10.2/y', false, { signal: ctl.signal });
  await tick();
  assert.deepEqual(seen.map(function (x) { return x[0]; }), ['fetch']);
  ctl.abort();
  await assert.rejects(promise, /aborted/);
  assert.deepEqual(seen.map(function (x) { return x[0]; }), ['fetch', 'abort'], '先登记请求、后按同一 id 中止');
  assert.equal(seen[0][1], seen[1][1], 'requestId 前后一致');
  gate.resolve(); // 主进程侧晚到的 settle 不影响已拒绝的链
});

test('enrichBatch 携带 ctl.signal：abort 收敛为该条未命中，不悬挂整批', async () => {
  const ctl = new AbortController();
  ctl.abort();
  const LitEnrich = loadEnrich({
    fetchJson: function () { throw new Error('abort 后不应发起桥请求'); }
  });
  const results = await LitEnrich.enrichBatch(
    [
      { id: 'p1', title: 'a long enough title here', doi: '' },
      { id: 'p2', title: 'another long title', doi: '10.3/z' }
    ],
    null,
    { paused: false, aborted: false, signal: ctl.signal }
  );
  assert.equal(results.length, 2);
  assert.ok(results.every(function (r) { return r.patch == null; }), 'abort 后逐条收敛为未命中');
});
