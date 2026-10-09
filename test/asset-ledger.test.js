'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assetLedgerRemoteKey,
  loadAssetLedgerValue,
  assetLedgerProof,
  recordAssetLedger,
  pruneAssetLedger,
  requestTimeoutMs
} = require('../electron/integrations.js');

const HASH = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);
const REMOTE_KEY = 'user@example.com\nhttps://dav.jianguoyun.com/dav/LitBoard/litboard-library.json';

test('loadAssetLedgerValue rejects garbage into a fresh empty ledger', function () {
  for (const bad of [null, undefined, 42, 'x', {}, { assets: null }, { assets: 'x' }, { remoteKey: REMOTE_KEY }]) {
    const ledger = loadAssetLedgerValue(bad, REMOTE_KEY);
    assert.equal(ledger.remoteKey, REMOTE_KEY);
    assert.deepEqual(ledger.assets, {});
  }
});

test('loadAssetLedgerValue drops the whole ledger when remoteKey differs', function () {
  const stale = { version: 1, remoteKey: 'other@x\nhttps://other/url', assets: { 'p1.pdf': { hash: HASH, size: 10 } } };
  const ledger = loadAssetLedgerValue(stale, REMOTE_KEY);
  assert.equal(ledger.remoteKey, REMOTE_KEY);
  assert.deepEqual(ledger.assets, {});
});

test('loadAssetLedgerValue keeps valid entries and drops malformed ones', function () {
  const raw = {
    version: 1,
    remoteKey: REMOTE_KEY,
    assets: {
      'p1.pdf': { hash: HASH, size: 123 },
      'p2.pdf': { hash: 'not-a-hash', size: 1 },
      'p3.pdf': { hash: HASH.toUpperCase(), size: -5 },
      'p4.pdf': { hash: HASH2 },
      'p5.pdf': null,
      'p6.pdf': { hash: HASH, size: '7' }
    }
  };
  const ledger = loadAssetLedgerValue(raw, REMOTE_KEY);
  assert.deepEqual(ledger.assets['p1.pdf'], { hash: HASH, size: 123 });
  assert.ok(!ledger.assets['p2.pdf'], '非十六进制 hash 应丢弃');
  assert.ok(!ledger.assets['p3.pdf'], '负数 size 应丢弃');
  assert.deepEqual(ledger.assets['p4.pdf'], { hash: HASH2, size: null }, '缺 size 视为未知，保留');
  assert.ok(!ledger.assets['p5.pdf']);
  assert.deepEqual(ledger.assets['p6.pdf'], { hash: HASH, size: 7 }, '字符串数字 size 可接受');
});

test('assetLedgerProof requires matching hash and size', function () {
  const ledger = { assets: {} };
  recordAssetLedger(ledger, 'p1.pdf', HASH, 100);
  assert.equal(assetLedgerProof(ledger, 'p1.pdf', HASH, 100, null), true);
  assert.equal(assetLedgerProof(ledger, 'p1.pdf', HASH, null, null), true, '未知 size 不否决');
  assert.equal(assetLedgerProof(ledger, 'p1.pdf', HASH2, 100, null), false, 'hash 不同不采信');
  assert.equal(assetLedgerProof(ledger, 'p1.pdf', HASH, 101, null), false, 'size 不同不采信');
  assert.equal(assetLedgerProof(ledger, 'p2.pdf', HASH, 100, null), false, '未记账不采信');
  assert.equal(assetLedgerProof(null, 'p1.pdf', HASH, 100, null), false);
});

test('assetLedgerProof defers to a populated remote listing that lacks the name', function () {
  const ledger = { assets: {} };
  recordAssetLedger(ledger, 'p1.pdf', HASH, 100);
  const remote = new Set(['p9.pdf']);
  assert.equal(assetLedgerProof(ledger, 'p1.pdf', HASH, 100, remote), false, '远端清单明确不含该对象时应照常上传');
  remote.add('p1.pdf');
  assert.equal(assetLedgerProof(ledger, 'p1.pdf', HASH, 100, remote), true);
  // 空清单 = 真实对账后云端一个对象都没有（对象确实不在了），不再视作
  // 「未知」采信台账——否则对象被外部删除后永远不会再重传（A2 事故）。
  assert.equal(assetLedgerProof(ledger, 'p1.pdf', HASH, 100, new Set()), false, '空真实清单：台账不得自证对象存在');
});

test('pruneAssetLedger keeps only names still referenced by the workspace', function () {
  const ledger = { assets: {} };
  recordAssetLedger(ledger, 'p1.pdf', HASH, 100);
  recordAssetLedger(ledger, 'gone/p2.pdf', HASH2, 5);
  const pruned = pruneAssetLedger(ledger, new Set(['p1.pdf']));
  assert.deepEqual(Object.keys(pruned.assets), ['p1.pdf']);
  assert.equal(pruned, ledger, '原地裁剪');
});

test('assetLedgerRemoteKey combines user and fileUrl', function () {
  assert.equal(assetLedgerRemoteKey({ user: 'u', fileUrl: 'f' }), 'u\nf');
});

test('requestTimeoutMs keeps plain requests at the base timeout', function () {
  assert.equal(requestTimeoutMs(0, 30000), 30000);
  assert.equal(requestTimeoutMs(null, 30000), 30000);
  assert.equal(requestTimeoutMs(1024, 30000), 30000, '小负载不超过基准');
});

test('requestTimeoutMs scales with upload size and caps at 10 minutes', function () {
  const mb = 1024 * 1024;
  assert.equal(requestTimeoutMs(25 * mb, 30000), 115000, '25MB ≈ 115s（256KB/s + 15s 余量）');
  assert.equal(requestTimeoutMs(2 * 1024 * mb, 30000), 600000, '超限封顶 10 分钟');
  assert.equal(requestTimeoutMs(25 * mb, 5000), 115000, '自定义基准值只在更宽松时生效');
  assert.equal(requestTimeoutMs(NaN, 30000), 30000);
});
