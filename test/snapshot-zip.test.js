'use strict';

/* WS2b 兼容门禁：网页快照 stored-ZIP 从自写实现切换到 vendored JSZip 后，
 * 跨版本双向可读（云端存量快照 = 旧实现字节；旧版本客户端会读到新实现字节）。
 * 本文件内嵌替换前的旧实现作为参考（原样复制自 2026-09 的 electron/integrations.js，勿改）。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { zipStoreEntries, extractZipAll } = require('../electron/integrations.js');

/* ---------- 旧实现（参考，勿改） ---------- */
const ZIP_CRC_TABLE = (function () {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function legacyCrc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) crc = ZIP_CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function legacyZipStoreEntries(entries) {
  const sorted = (entries || []).slice().sort(function (a, b) {
    return String(a.name) < String(b.name) ? -1 : (String(a.name) > String(b.name) ? 1 : 0);
  });
  const parts = [];
  const centrals = [];
  let offset = 0;
  sorted.forEach(function (entry) {
    const name = Buffer.from(String(entry.name).replace(/\\/g, '/').replace(/^\/+/, ''), 'utf8');
    if (!name.length || name.toString('utf8').split('/').indexOf('..') !== -1) {
      throw new Error('非法 ZIP 条目名：' + String(entry.name));
    }
    const data = Buffer.from(entry.data);
    const crc = legacyCrc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  });
  const centralSize = centrals.reduce(function (sum, buf) { return sum + buf.length; }, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(sorted.length, 8); eocd.writeUInt16LE(sorted.length, 10);
  eocd.writeUInt32LE(centralSize, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat(parts.concat(centrals).concat([eocd]));
}
function legacyExtractZipAll(value) {
  const zlib = require('node:zlib');
  const buffer = Buffer.from(value);
  const minEocd = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minEocd; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('不是有效 ZIP');
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
    offset += 46 + nameLength + extraLength + commentLength;
    if (!name || name.endsWith('/')) continue;
    if (name.split('/').indexOf('..') !== -1 || /^(?:[A-Za-z]:)?[\\/]/.test(name)) {
      throw new Error('ZIP 包含非法条目名：' + name);
    }
    if (flags & 1) throw new Error('不支持加密的 ZIP');
    if (uncompressedSize > 500 * 1024 * 1024 || compressedSize > 500 * 1024 * 1024) throw new Error('ZIP 条目过大');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('ZIP 结构损坏');
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed, { maxOutputLength: 500 * 1024 * 1024 });
    else throw new Error('不支持的 ZIP 压缩格式');
    out.push({ name: name, data: data });
  }
  return out;
}

/* ---------- 门禁测试 ---------- */

const SAMPLE = [
  { name: 'index.html', data: '<html><body>快照 页面</body></html>' },
  { name: 'assets/style.css', data: 'body { color: #333 }' },
  { name: 'assets/img/logo.bin', data: Buffer.from([0, 1, 2, 250, 251, 255]) },
  { name: 'page.md', data: '# 标题\n\n正文 100% αβγ' }
];

function sameFiles(actual, entries) {
  const expected = entries.map(function (e) {
    return { name: String(e.name), data: Buffer.from(e.data) };
  }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  const got = actual.map(function (e) {
    return { name: e.name, data: Buffer.from(e.data) };
  }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  assert.deepEqual(got, expected);
}

test('旧写 → 新读（云端存量快照字节必须仍可解包）', async function () {
  const legacy = legacyZipStoreEntries(SAMPLE);
  const files = await extractZipAll(legacy);
  sameFiles(files, SAMPLE);
});

test('新写 → 旧读（旧版本客户端必须能解包新实现产出的 ZIP）', async function () {
  const packed = await zipStoreEntries(SAMPLE);
  const files = legacyExtractZipAll(packed);
  sameFiles(files, SAMPLE);
});

test('新实现往返一致且字节确定（cloudHash 语义保住）', async function () {
  const first = await zipStoreEntries(SAMPLE);
  const second = await zipStoreEntries(SAMPLE.slice().reverse());
  assert.deepEqual(first, second);
  const files = await extractZipAll(first);
  sameFiles(files, SAMPLE);
});

test('新实现拒绝非法条目名（写侧同步抛错）', async function () {
  await assert.rejects(zipStoreEntries([{ name: '../evil.txt', data: 'x' }]), /非法 ZIP 条目名/);
});

test('读侧：外来 ZIP 的穿越条目被 JSZip 装载时清洗（与 docx 链同一防线）', async function () {
  const JSZip = require('../vendor/jszip/jszip.min.js');
  const zip = new JSZip();
  zip.file('../evil.txt', 'x');
  zip.file('ok.txt', 'y');
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  const files = await extractZipAll(bytes);
  assert.deepEqual(files.map(function (f) { return f.name; }).sort(), ['evil.txt', 'ok.txt']);
});

test('读侧：deflate（method 8）条目照常解压', async function () {
  const JSZip = require('../vendor/jszip/jszip.min.js');
  const zip = new JSZip();
  zip.file('page.md', '# 压缩内容\n'.repeat(100));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const files = await extractZipAll(bytes);
  assert.equal(files.length, 1);
  assert.match(files[0].data.toString('utf8'), /^# 压缩内容/);
});
