'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assetLocalSignature, assetSignatureUnchanged } = require('../electron/integrations.js');

const HASH = 'c'.repeat(64);
const HASH2 = 'd'.repeat(64);
const MTIME = 1700000000000;

function statLike(size, mtimeMs) {
  return { size: size, mtimeMs: mtimeMs };
}

/** 一条「上轮已完整核对过」的附件记录：cloudHash/cloudSize/签名彼此一致 */
function verifiedAsset(overrides) {
  return Object.assign({
    id: 'att1',
    cloudHash: HASH,
    cloudSize: 100,
    syncSignature: assetLocalSignature(statLike(100, MTIME), HASH)
  }, overrides || {});
}

test('assetLocalSignature pairs the recorded cloudHash with size:mtime', function () {
  assert.equal(assetLocalSignature(statLike(100, MTIME + 0.7), HASH), HASH + ':100:' + MTIME);
  assert.equal(assetLocalSignature(statLike(0, 42.2), 'A'.repeat(64)), 'a'.repeat(64) + ':0:42');
  assert.equal(assetLocalSignature(statLike(1, 1), ''), ':1:1');
});

test('assetSignatureUnchanged skips the re-hash when nothing changed', function () {
  assert.equal(assetSignatureUnchanged(verifiedAsset(), assetLocalSignature(statLike(100, MTIME), HASH), 'p1.pdf', null, 100), true);
  // 毫秒以下的小数抖动不影响判定（与写入侧同一截断）
  assert.equal(assetSignatureUnchanged(verifiedAsset(), assetLocalSignature(statLike(100, MTIME + 0.9), HASH), 'p1.pdf', null, 100), true);
});

test('assetSignatureUnchanged requires a previous verification record', function () {
  assert.equal(assetSignatureUnchanged(verifiedAsset({ syncSignature: '' }), assetLocalSignature(statLike(100, MTIME), HASH), 'p1.pdf', null, 100), false);
  assert.equal(assetSignatureUnchanged(verifiedAsset(), 'stale', 'p1.pdf', null, 100), false);
  assert.equal(assetSignatureUnchanged(null, assetLocalSignature(statLike(100, MTIME), HASH), 'p1.pdf', null, 100), false);
});

test('assetSignatureUnchanged refuses to skip without a cloud hash to trust', function () {
  assert.equal(assetSignatureUnchanged(verifiedAsset({ cloudHash: '' }), assetLocalSignature(statLike(100, MTIME), HASH), 'p1.pdf', null, 100), false);
  assert.equal(assetSignatureUnchanged(verifiedAsset({ cloudHash: undefined }), assetLocalSignature(statLike(100, MTIME), HASH), 'p1.pdf', null, 100), false);
});

test('assetSignatureUnchanged invalidates the signature when cloudHash changed after recording', function () {
  // 多设备合并：本机保留旧签名（内嵌旧 HASH），但采纳了远端新 cloudHash——
  // 必须退回逐字节核对（真实流程里本地内容与远端不符会重传），不能跳过
  const merged = verifiedAsset({ cloudHash: HASH2 });
  assert.equal(assetSignatureUnchanged(merged, assetLocalSignature(statLike(100, MTIME), HASH2), 'p1.pdf', null, 100), false);
  // 重新核对后按新哈希记录签名，恢复正常跳过
  merged.syncSignature = assetLocalSignature(statLike(100, MTIME), HASH2);
  assert.equal(assetSignatureUnchanged(merged, assetLocalSignature(statLike(100, MTIME), HASH2), 'p1.pdf', null, 100), true);
});

test('assetSignatureUnchanged honors the cloudSize vs local size check', function () {
  // 大小对不上：不能跳过（真实流程里这个组合会走重传分支）
  assert.equal(assetSignatureUnchanged(verifiedAsset({ cloudSize: 99 }), assetLocalSignature(statLike(100, MTIME), HASH), 'p1.pdf', null, 100), false);
  // cloudSize 尚缺：允许跳过（哈希在册即可信）
  assert.equal(assetSignatureUnchanged(verifiedAsset({ cloudSize: null }), assetLocalSignature(statLike(100, MTIME), HASH), 'p1.pdf', null, 100), true);
  // localSize=null（目录签名）：不做大小比对
  assert.equal(assetSignatureUnchanged(verifiedAsset({ syncSignature: 'listsig:' + HASH }), 'listsig:' + HASH, 'p1/x.zip', null, null), true);
});

test('assetSignatureUnchanged defers to the remote asset manifest', function () {
  const sig = assetLocalSignature(statLike(100, MTIME), HASH);
  assert.equal(assetSignatureUnchanged(verifiedAsset(), sig, 'p1.pdf', new Set(['p1.pdf']), 100), true);
  // 远端清单明确缺这个对象：即使本地没变也要重传
  assert.equal(assetSignatureUnchanged(verifiedAsset(), sig, 'p1.pdf', new Set(['other.pdf']), 100), false);
  // 清单不可用（null/undefined）：退回哈希比对口径，允许跳过
  assert.equal(assetSignatureUnchanged(verifiedAsset(), sig, 'p1.pdf', undefined, 100), true);
});

test('assetSignatureUnchanged demands a cloud name', function () {
  assert.equal(assetSignatureUnchanged(verifiedAsset(), assetLocalSignature(statLike(100, MTIME), HASH), '', null, 100), false);
});

test('snapshot directory signatures embed the cloudHash at record time', function () {
  // 目录签名的组成方式：清单哈希 + ':' + 当时 cloudHash（见 integrations.js processSnapshotDir）
  const listingSig = 'e'.repeat(64);
  const asset = verifiedAsset({ syncSignature: listingSig + ':' + HASH });
  assert.equal(assetSignatureUnchanged(asset, listingSig + ':' + HASH, 'p1/x.zip', null, null), true);
  assert.equal(assetSignatureUnchanged(asset, listingSig + ':' + HASH2, 'p1/x.zip', null, null), false);
});
