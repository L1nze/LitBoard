'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const JSZip = require('../vendor/jszip/jszip.min.js');
const { classifyFile, extractFile, readTextWindow, validateZip, MAX_BYTES } = require('../electron/agent-files.js');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-agent-files-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return async function (name, data, options) {
    const file = path.join(root, name);
    await fs.writeFile(file, data);
    return extractFile(file, options);
  };
}

async function archive(files, compression) {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: 'nodebuffer', compression: compression || 'DEFLATE' });
}

function central(buffer, suffix) {
  for (let pos = 0; pos + 46 <= buffer.length; pos++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) continue;
    const name = buffer.subarray(pos + 46, pos + 46 + buffer.readUInt16LE(pos + 28)).toString();
    if (name.endsWith(suffix)) return pos;
  }
  throw new Error('Fixture ZIP entry not found');
}

test('reference classification handles supported names and reports opaque files', () => {
  for (const name of ['note.MD', 'README', '.gitignore', 'data.csv', 'code.py', 'a.ipynb']) assert.equal(classifyFile(name).kind, 'text');
  for (const ext of ['docx', 'xlsx', 'pptx', 'pdf']) assert.equal(classifyFile('file.' + ext).kind, ext);
  assert.deepEqual(classifyFile('IMAGE.JPEG'), { kind: 'image', mime: 'image/jpeg' });
  assert.equal(classifyFile('data.exe').kind, 'unsupported');
  assert.equal(classifyFile('').kind, 'unsupported');
});

test('readTextWindow bounds offsets and limits and allows continuation', () => {
  assert.deepEqual(readTextWindow('abcdef', { offset: 2, limit: 2 }), { text: 'cd', offset: 2, nextOffset: 4, totalChars: 6, truncated: true });
  assert.equal(readTextWindow('abc', { offset: -3 }).text, 'abc');
  assert.deepEqual(readTextWindow('abc', { offset: 100 }), { text: '', offset: 3, nextOffset: null, totalChars: 3, truncated: false });
  assert.equal(readTextWindow('x'.repeat(20000), { limit: 99999 }).text.length, 16000);
  assert.equal(readTextWindow('abc', { offset: NaN, limit: 0.1 }).text, 'abc');
  assert.equal(readTextWindow('').totalChars, 0);
});

test('UTF8 and both UTF16 BOM forms decode and normalize line endings', async t => {
  const read = await fixture(t);
  assert.equal((await read('utf8.txt', '\ufeff中文\r\nnext\rend')).text, '中文\nnext\nend');
  const le = Buffer.from('中文\r\ntext', 'utf16le');
  assert.equal((await read('le.txt', Buffer.concat([Buffer.from([255, 254]), le]))).text, '中文\ntext');
  const be = Buffer.from(le).swap16();
  assert.equal((await read('be.txt', Buffer.concat([Buffer.from([254, 255]), be]))).text, '中文\ntext');
});

test('empty files, truncation and byte limits report actual extraction state', async t => {
  const read = await fixture(t);
  const empty = await read('empty.txt', '');
  assert.equal(empty.status, 'ready');
  assert.equal(empty.text, '');
  assert.equal(empty.totalChars, 0);
  const result = await read('limited.txt', 'abcdef', { maxChars: 3 });
  assert.equal(result.text, 'abc');
  assert.equal(result.totalChars, 6);
  assert.equal(result.truncated, true);
  assert.equal((await read('large.txt', 'abcdef', { maxBytes: 5 })).status, 'too_large');
  assert.equal((await read('huge.txt', Buffer.alloc(MAX_BYTES + 1))).status, 'too_large');
});

test('binary and invalid text are never passed through as extracted content', async t => {
  const read = await fixture(t);
  assert.equal((await read('nul.txt', 'a\0b')).status, 'binary');
  assert.equal((await read('invalid.txt', Buffer.from([0xff, 0x80]))).status, 'error');
  assert.equal((await read('odd-utf16.txt', Buffer.from([0xff, 0xfe, 0x61]))).status, 'error');
  assert.equal((await read('image.png', 'bytes')).status, 'vision');
  assert.equal((await read('paper.pdf', '%PDF')).status, 'requires_pdf_extraction');
  assert.equal((await read('legacy.doc', 'bytes')).status, 'unsupported');
});

test('missing and non-regular paths return an error instead of rejecting', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-agent-files-path-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.equal((await extractFile(path.join(root, 'missing.txt'))).status, 'error');
  assert.equal((await extractFile(root, { name: 'directory.txt' })).status, 'error');
});

test('DOCX extracts text, escapes, paragraph and tab boundaries', async t => {
  const read = await fixture(t);
  const xml = '<?xml version="1.0"?><w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>A &amp; B &#x4e2d;&#25991;</w:t><w:tab/><w:t>tail</w:t><w:br/></w:r></w:p></w:body></w:document>';
  const result = await read('word.docx', await archive({ 'word/document.xml': xml }));
  assert.equal(result.status, 'ready', result.error);
  assert.equal(result.text, 'A & B 中文\ttail\n\n');
});

test('PPTX reads slides in numeric order and XLSX reads shared and inline strings', async t => {
  const read = await fixture(t);
  const slide = text => '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:t>' + text + '</a:t></a:p></p:sld>';
  const ppt = await read('slides.pptx', await archive({ 'ppt/slides/slide10.xml': slide('ten'), 'ppt/slides/slide2.xml': slide('two') }));
  assert.equal(ppt.status, 'ready', ppt.error);
  assert.equal(ppt.text, '[Slide 1]\ntwo\n\n\n[Slide 2]\nten\n');
  const xlsx = await read('table.xlsx', await archive({
    'xl/sharedStrings.xml': '<sst><si><r><t>shared &lt;</t></r><r><t>rich</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>中文</t></is></c><c r="C1"><v>42</v></c></row></sheetData></worksheet>'
  }));
  assert.equal(xlsx.status, 'ready', xlsx.error);
  assert.equal(xlsx.text, '[xl/worksheets/sheet1.xml]\nA1=shared <rich\tB1=中文\tC1=42');
});

test('stored Office ZIP and streamed data descriptors are supported', async t => {
  const read = await fixture(t);
  const xml = '<w:document><w:p><w:t>stored</w:t></w:p></w:document>';
  assert.equal((await read('stored.docx', await archive({ 'word/document.xml': xml }, 'STORE'))).status, 'ready');
  const zip = new JSZip().file('word/document.xml', xml);
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', streamFiles: true });
  assert.equal((await read('stream.docx', bytes)).status, 'ready');
});

test('Office comments are omitted and CDATA remains literal reference text', async t => {
  const read = await fixture(t);
  const xml = '<w:document><!-- <w:t>hidden comment</w:t> --><w:p><w:t><![CDATA[actual & <tag>]]></w:t></w:p></w:document>';
  const result = await read('literal.docx', await archive({ 'word/document.xml': xml }));
  assert.equal(result.status, 'ready', result.error);
  assert.equal(result.text, 'actual & <tag>\n');
});

test('missing Office parts, malformed XML and entity declarations fail visibly', async t => {
  const read = await fixture(t);
  for (const ext of ['docx', 'pptx', 'xlsx']) assert.equal((await read('missing.' + ext, await archive({ 'empty.xml': '<empty/>' }))).status, 'error');
  for (const xml of ['<w:document><w:t>broken</w:document>', '<w:document broken=unquoted/>', '<w:document><w:t>&unknown;</w:t></w:document>', '<w:document><w:t>&#x110000;</w:t></w:document>', '<w:document><w:t>&#0;</w:t></w:document>', '<!DOCTYPE w:document [<!ENTITY file SYSTEM "file:///private">]><w:document/>']) {
    assert.equal((await read('invalid.docx', await archive({ 'word/document.xml': xml }))).status, 'error');
  }
  assert.equal((await read('notzip.docx', 'not a zip')).status, 'error');
});

test('ZIP central directory limits reject traversal, encryption and expansion claims', async () => {
  assert.throws(() => validateZip(Buffer.from('notzip')));
  const badPath = await archive({ '../word/document.xml': '<word/>' });
  assert.throws(() => validateZip(badPath), /Unsafe ZIP/);
  const good = await archive({ 'word/document.xml': '<word/>' });
  const pos = central(good, 'document.xml');
  const encrypted = Buffer.from(good);
  encrypted.writeUInt16LE(1, pos + 8);
  assert.throws(() => validateZip(encrypted), /expansion/);
  const expanded = Buffer.from(good);
  expanded.writeUInt32LE(33 * 1024 * 1024, pos + 24);
  assert.throws(() => validateZip(expanded), /expansion/);
  const ratio = Buffer.from(good);
  ratio.writeUInt32LE(2 * 1024 * 1024, pos + 24);
  assert.throws(() => validateZip(ratio), /expansion/);
  const multiDisk = Buffer.from(good);
  multiDisk.writeUInt16LE(1, multiDisk.length - 18);
  assert.throws(() => validateZip(multiDisk), /limits/);
  const tooMany = Buffer.from(good);
  tooMany.writeUInt16LE(2049, tooMany.length - 14);
  tooMany.writeUInt16LE(2049, tooMany.length - 12);
  assert.throws(() => validateZip(tooMany), /limits/);
  const corruptLocal = Buffer.from(good);
  corruptLocal.writeUInt32LE(0, good.readUInt32LE(pos + 42));
  assert.throws(() => validateZip(corruptLocal), /local header/);
  const duplicate = await archive({ 'word/doc1.xml': '<word/>', 'word/doc2.xml': '<word/>' });
  const duplicatePos = central(duplicate, 'doc2.xml');
  const duplicateLocal = duplicate.readUInt32LE(duplicatePos + 42);
  Buffer.from('word/doc1.xml').copy(duplicate, duplicatePos + 46);
  Buffer.from('word/doc1.xml').copy(duplicate, duplicateLocal + 30);
  assert.throws(() => validateZip(duplicate), /Duplicate/);
});

test('ZIP actual inflation limits and checksums catch forged headers', async t => {
  const read = await fixture(t);
  const good = await archive({ 'word/document.xml': '<w:document><w:t>' + 'z'.repeat(20000) + '</w:t></w:document>' });
  const pos = central(good, 'document.xml');
  const local = good.readUInt32LE(pos + 42);
  const forged = Buffer.from(good);
  forged.writeUInt32LE(100, pos + 24);
  forged.writeUInt32LE(100, local + 22);
  assert.equal((await read('forged.docx', forged)).status, 'error');
  const corrupt = Buffer.from(good);
  corrupt.writeUInt32LE(123, pos + 16);
  const result = await read('checksum.docx', corrupt);
  assert.equal(result.status, 'error');
  assert.match(result.error, /checksum/);
});

test('Office decoding leaves the calling event loop responsive', async t => {
  const read = await fixture(t);
  const randomish = Array.from({ length: 30000 }, (_, i) => '<w:t>' + i + '</w:t>').join('');
  const bytes = await archive({ 'word/document.xml': '<w:document><w:p>' + randomish + '</w:p></w:document>' });
  let pulses = 0;
  const timer = setInterval(() => pulses++, 5);
  t.after(() => clearInterval(timer));
  const result = await read('large.docx', bytes);
  clearInterval(timer);
  assert.equal(result.status, 'ready', result.error);
  assert.ok(pulses > 0, 'reference parsing must allow the main event loop to run');
});
