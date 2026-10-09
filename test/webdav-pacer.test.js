'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestPacer, loadPacingValue, WINDOW_MS, TAIL_RESERVE } = require('../electron/webdav-pacer.js');

/** 虚拟时钟：sleep 即推进时间，测试不需要真实等待 */
function fakeClock(start) {
  let now = start || 1000000;
  return {
    now: function () { return now; },
    sleep: async function (ms) { now += ms; },
    advance: function (ms) { now += ms; }
  };
}

test('loadPacingValue 容错：坏数据返回空白窗口', function () {
  const blank = loadPacingValue(null);
  assert.deepEqual(blank.requests, []);
  assert.equal(blank.resumeAt, 0);
  assert.deepEqual(loadPacingValue({ requests: ['x', -1, 123] }).requests, [123]);
  assert.equal(loadPacingValue({ resumeAt: 'abc' }).resumeAt, 0);
  assert.equal(loadPacingValue({ resumeAt: 999 }).resumeAt, 999);
});

test('最小间隔：连续 acquire 之间拉开档位间隔', async function () {
  const clock = fakeClock();
  const pacer = createRequestPacer({ profile: 'free', now: clock.now, sleep: clock.sleep });
  await pacer.acquire();
  const before = clock.now();
  await pacer.acquire();
  await pacer.acquire();
  // free 档 3100ms：两次间隔至少推进 2×3100（虚拟时钟下 sleep 即推进）
  assert.ok(clock.now() - before >= 2 * 3100, 'elapsed=' + (clock.now() - before));
  assert.equal(pacer.stats().requests, 3);
});

test('窗口预算：将尽时抛 SYNC_RATE_PAUSED，恢复时刻 = 最老请求滑出窗口', async function () {
  const clock = fakeClock();
  const pacer = createRequestPacer({ profile: 'free', now: clock.now, sleep: clock.sleep,
    maxPerWindow: 50 });
  for (let i = 0; i < 50 - TAIL_RESERVE; i++) await pacer.acquire();
  await assert.rejects(pacer.acquire(), function (error) {
    return error.code === 'SYNC_RATE_PAUSED' && error.resumeAt > clock.now();
  });
  // 老请求滑出窗口后预算恢复，可继续
  clock.advance(WINDOW_MS + 6000);
  await pacer.acquire();
});

test('暂停期内 acquire 立即拒绝，窗口过期后自动恢复', async function () {
  const clock = fakeClock();
  let saved = null;
  const pacer = createRequestPacer({ profile: 'free', now: clock.now, sleep: clock.sleep,
    loadState: async function () { return saved; },
    saveState: async function (value) { saved = value; } });
  await pacer.acquire(); // 先有一次正常请求（真实 429 都发生在已 acquire 的请求上）
  const error = pacer.noteRateLimited(30);
  assert.equal(error.code, 'SYNC_RATE_PAUSED');
  assert.ok(error.resumeAt > clock.now());
  await assert.rejects(pacer.acquire(), function (e) { return e.code === 'SYNC_RATE_PAUSED'; });
  clock.advance(60 * 1000);
  await pacer.acquire(); // resumeAt 已过：恢复
});

test('noteRateLimited 尊重 Retry-After，缺省按窗口恢复估算', async function () {
  const clock = fakeClock();
  const base = createRequestPacer({ profile: 'free', now: clock.now, sleep: clock.sleep });
  const withRetry = base.noteRateLimited(90);
  assert.ok(withRetry.resumeAt >= clock.now() + 90 * 1000, 'Retry-After=90s 被消费');
});

test('暂停错误不污染后续排队：失败后仍可继续 acquire', async function () {
  const clock = fakeClock();
  const pacer = createRequestPacer({ profile: 'free', now: clock.now, sleep: clock.sleep, maxPerWindow: 40 });
  for (let i = 0; i < 40 - TAIL_RESERVE; i++) await pacer.acquire();
  await assert.rejects(pacer.acquire());
  clock.advance(WINDOW_MS + 6000);
  await pacer.acquire();
  await pacer.acquire();
});

test('pro 档位间隔更短、预算更大', async function () {
  const clock = fakeClock();
  const pacer = createRequestPacer({ profile: 'pro', now: clock.now, sleep: clock.sleep });
  assert.equal(pacer.minIntervalMs, 1250);
  const before = clock.now();
  await pacer.acquire();
  await pacer.acquire();
  assert.equal(clock.now() - before, 1250);
});
