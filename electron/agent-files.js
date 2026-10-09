'use strict';

// Reference files are read only. The caller resolves an authorized session attachment
// or a file selected by the user; this module never accepts archive paths as disk paths.
const fs = require('node:fs/promises');
const path = require('node:path');
const { inflateRaw } = require('node:zlib');
const { promisify } = require('node:util');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const inflate = promisify(inflateRaw);
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_CHARS = 1000000;
const TEXT_EXTENSIONS = new Set(('txt md markdown csv tsv json jsonl xml html htm yaml yml toml ini log tex bib ris js mjs cjs ts tsx jsx py r rs go java c h cpp hpp cs sh ps1 sql css scss vue svelte ipynb').split(' '));
const IMAGE_MIMES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

function classifyFile(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (IMAGE_MIMES[ext]) return { kind: 'image', mime: IMAGE_MIMES[ext] };
  if (ext === '.pdf') return { kind: 'pdf', mime: 'application/pdf' };
  if (['.docx', '.xlsx', '.pptx'].includes(ext)) return { kind: ext.slice(1), mime: 'application/vnd.openxmlformats-officedocument.' + ({ '.docx': 'wordprocessingml.document', '.xlsx': 'spreadsheetml.sheet', '.pptx': 'presentationml.presentation' }[ext]) };
  if (TEXT_EXTENSIONS.has(ext.slice(1)) || ['LICENSE', 'README', 'Makefile', 'Dockerfile', '.gitignore'].includes(path.basename(String(name || '')))) return { kind: 'text', mime: 'text/plain' };
  return { kind: 'unsupported', mime: 'application/octet-stream' };
}

function bounded(value, fallback, maximum) {
  return Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), maximum) : fallback;
}

function readTextWindow(text, options) {
  const source = String(text || '');
  const opts = options || {};
  const offset = Number.isFinite(opts.offset) ? Math.max(0, Math.min(source.length, Math.floor(opts.offset))) : 0;
  const limit = bounded(opts.limit, 6000, 16000);
  const end = Math.min(source.length, offset + limit);
  return { text: source.slice(offset, end), offset: offset, nextOffset: end < source.length ? end : null, totalChars: source.length, truncated: end < source.length };
}

// Inspect the ZIP central directory before JSZip allocates inflated buffers.
function validateZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_BYTES) throw new Error('ZIP input limits exceeded');
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Invalid ZIP directory');
  const count = buffer.readUInt16LE(end + 10);
  const size = buffer.readUInt32LE(end + 12);
  let pos = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count || count === 65535 || count > 2048 || pos + size !== end) throw new Error('ZIP limits exceeded');
  const directoryEnd = pos + size;
  const directoryStart = pos;
  const entries = new Map();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > directoryEnd || buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const flags = buffer.readUInt16LE(pos + 8);
    const method = buffer.readUInt16LE(pos + 10);
    const compressed = buffer.readUInt32LE(pos + 20);
    const expanded = buffer.readUInt32LE(pos + 24);
    const length = buffer.readUInt16LE(pos + 28);
    const next = pos + 46 + length + buffer.readUInt16LE(pos + 30) + buffer.readUInt16LE(pos + 32);
    if (next > directoryEnd) throw new Error('Invalid ZIP entry');
    const name = buffer.subarray(pos + 46, pos + 46 + length).toString('utf8');
    total += expanded;
    if (flags & 1 || ![0, 8].includes(method) || expanded === 0xffffffff || total > MAX_EXPANDED_BYTES || expanded > Math.max(1024 * 1024, compressed * 200)) throw new Error('ZIP expansion limits exceeded');
    if (/^[\\/]|^[a-z]:|\\|\0/i.test(name) || name.split('/').includes('..')) throw new Error('Unsafe ZIP entry path');
    if (entries.has(name)) throw new Error('Duplicate ZIP entry');
    const local = buffer.readUInt32LE(pos + 42);
    if (local + 30 > directoryStart || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid ZIP local header');
    const localNameLength = buffer.readUInt16LE(local + 26);
    const dataOffset = local + 30 + localNameLength + buffer.readUInt16LE(local + 28);
    if (dataOffset + compressed > directoryStart || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method ||
        !buffer.subarray(local + 30, local + 30 + localNameLength).equals(buffer.subarray(pos + 46, pos + 46 + length))) throw new Error('Invalid ZIP local entry');
    if (!(flags & 8) && (buffer.readUInt32LE(local + 18) !== compressed || buffer.readUInt32LE(local + 22) !== expanded)) throw new Error('Invalid ZIP entry size');
    entries.set(name, { method, compressed, expanded, dataOffset, crc: buffer.readUInt32LE(pos + 16) });
    pos = next;
  }
  if (pos !== directoryEnd) throw new Error('Invalid ZIP directory size');
  return entries;
}

// OOXML uses no DTD. Reject declarations and malformed nesting instead of
// treating corrupt XML as a successful extraction. No content is executed.
function validateXml(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML declarations are not supported');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml)) throw new Error('Invalid XML character');
  const escaped = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  if (/&(?!(?:#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);)/i.test(escaped)) throw new Error('Invalid XML entity');
  decodeXml(escaped);
  const stack = [];
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+[^<>]*?)?\s*\/?>/g;
  let end = 0;
  let roots = 0;
  for (const token of xml.matchAll(tokens)) {
    const gap = xml.slice(end, token.index);
    if (gap.includes('<') || (!stack.length && gap.trim())) throw new Error('Invalid XML text');
    const tag = token[0];
    end = token.index + tag.length;
    if (/^<\?|^<!/.test(tag)) continue;
    const name = tag.match(/^<\/?([^\s/>]+)/)[1];
    const attributes = tag.replace(/^<\/?[^\s/>]+/, '').replace(/\/?\s*>$/, '');
    if (attributes.replace(/\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*')/g, '').trim()) throw new Error('Invalid XML attributes');
    if (tag.startsWith('</')) {
      if (stack.pop() !== name) throw new Error('Invalid XML nesting');
    } else {
      if (!stack.length && ++roots > 1) throw new Error('Invalid XML root');
      if (!tag.endsWith('/>')) stack.push(name);
    }
  }
  if (stack.length || !roots || xml.slice(end).trim()) throw new Error('Incomplete XML document');
}

const CRC_TABLE = Array.from({ length: 256 }, function (_, n) {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1;
  return n >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeXml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (match, entity) {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff || code < 0x20 && ![9, 10, 13].includes(code) || [0xfffe, 0xffff].includes(code)) throw new Error('Invalid XML character entity');
      return String.fromCodePoint(code);
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity.toLowerCase()];
  });
}

function xmlText(xml) {
  // Only textual OOXML elements: drawings, metadata and field instructions are omitted.
  return Array.from(xml.matchAll(/<(?:w|a):t\b[^>]*>([\s\S]*?)<\/(?:w|a):t>|<\/(?:w|a):p>|<w:(?:tab|br)\b[^>]*\/?\s*>/g), function (match) {
    return match[1] === undefined ? (match[0].startsWith('<w:tab') ? '\t' : '\n') : decodeXml(match[1]);
  }).join('');
}

async function officeText(buffer, kind) {
  const entries = validateZip(buffer);
  const names = Array.from(entries.keys());
  const get = async function (name) {
    const entry = entries.get(name);
    if (!entry) return '';
    const compressed = buffer.subarray(entry.dataOffset, entry.dataOffset + entry.compressed);
    // maxOutputLength enforces the actual inflated size, including a forged
    // central directory which understates expansion. Never extract to disk.
    const data = entry.method === 0 ? compressed : await inflate(compressed, { maxOutputLength: Math.max(1, entry.expanded) });
    if (data.length !== entry.expanded) throw new Error('Invalid ZIP expanded size');
    if (crc32(data) !== entry.crc) throw new Error('Invalid ZIP checksum');
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(data);
    validateXml(xml);
    return xml.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, function (_, text) {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    });
  };
  if (kind === 'docx') {
    if (!entries.has('word/document.xml')) throw new Error('Missing Word document');
    return xmlText(await get('word/document.xml'));
  }
  if (kind === 'pptx') {
    const slides = names.filter(function (name) { return /^ppt\/slides\/slide\d+\.xml$/.test(name); }).sort(function (a, b) { return Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]); });
    if (!slides.length) throw new Error('Missing presentation slides');
    const texts = [];
    for (let i = 0; i < slides.length; i++) texts.push('[Slide ' + (i + 1) + ']\n' + xmlText(await get(slides[i])));
    return texts.join('\n\n');
  }
  const shared = Array.from((await get('xl/sharedStrings.xml')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), function (m) {
    return Array.from(m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), function (t) { return decodeXml(t[1]); }).join('');
  });
  const sheets = names.filter(function (name) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(name); }).sort(function (a, b) { return Number(a.match(/sheet(\d+)/)[1]) - Number(b.match(/sheet(\d+)/)[1]); });
  if (!sheets.length) throw new Error('Missing workbook sheets');
  const texts = [];
  for (const sheet of sheets) {
    const xml = await get(sheet);
    const rows = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const v = cell[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        let value = v ? decodeXml(v[1]) : '';
        if (/\bt=["']s["']/.test(cell[1])) value = shared[Number(value)] || '';
        if (/\bt=["']inlineStr["']/.test(cell[1])) value = Array.from(cell[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), function (m) { return decodeXml(m[1]); }).join('');
        const ref = cell[1].match(/\br=["']([^"']+)["']/);
        cells.push((ref ? ref[1] + '=' : '') + value);
      }
      rows.push(cells.join('\t'));
    }
    texts.push('[' + sheet + ']\n' + rows.join('\n'));
  }
  return texts.join('\n\n');
}

async function extractFileLocal(filePath, options) {
  const opts = options || {};
  const type = classifyFile(opts.name || filePath);
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Reference must be a regular file');
    const maxBytes = bounded(opts.maxBytes, MAX_BYTES, MAX_BYTES);
    if (stat.size > maxBytes) return Object.assign(type, { status: 'too_large', size: stat.size, maxBytes: maxBytes, text: '' });
    if (type.kind === 'image') return Object.assign(type, { status: 'vision', size: stat.size, text: '' });
    if (type.kind === 'pdf') return Object.assign(type, { status: 'requires_pdf_extraction', size: stat.size, text: '' });
    if (type.kind === 'unsupported') return Object.assign(type, { status: 'unsupported', size: stat.size, text: '' });
    // Bound the actual read as well as stat, including a file growing during the read.
    const chunks = [];
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > maxBytes) return Object.assign(type, { status: 'too_large', size: bytes, maxBytes: maxBytes, text: '' });
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    let text;
    if (type.kind === 'text') {
      if (buffer[0] === 0xff && buffer[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(buffer.subarray(2));
      else if (buffer[0] === 0xfe && buffer[1] === 0xff) text = new TextDecoder('utf-16be', { fatal: true }).decode(buffer.subarray(2));
      else text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      if (text.includes('\0')) return Object.assign(type, { status: 'binary', size: bytes, text: '' });
    } else text = await officeText(buffer, type.kind);
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const cap = bounded(opts.maxChars, MAX_CHARS, MAX_CHARS);
    return Object.assign(type, { status: 'ready', size: bytes, text: text.slice(0, cap), totalChars: text.length, truncated: text.length > cap });
  } catch (error) {
    return Object.assign(type, { status: 'error', text: '', error: String(error && error.message || error) });
  } finally { if (handle) await handle.close().catch(function () {}); }
}

// XML scans and decoding large reference files run away from Electron's message
// pump. A timeout also bounds pathological input without blocking the window.
async function extractFile(filePath, options) {
  const type = classifyFile(options && options.name || filePath);
  try {
    return await new Promise(function (resolve, reject) {
      const worker = new Worker(__filename, { workerData: { agentReference: true, filePath, options } });
      const timer = setTimeout(function () { worker.terminate(); reject(new Error('Reference extraction timed out')); }, 20000);
      worker.once('message', function (result) { clearTimeout(timer); resolve(result); });
      worker.once('error', function (error) { clearTimeout(timer); reject(error); });
      worker.once('exit', function () { clearTimeout(timer); reject(new Error('Reference extraction worker stopped')); });
    });
  } catch (error) {
    return Object.assign(type, { status: 'error', text: '', error: String(error && error.message || error) });
  }
}

if (!isMainThread && workerData && workerData.agentReference) {
  extractFileLocal(workerData.filePath, workerData.options).then(function (result) { parentPort.postMessage(result); });
}

module.exports = { classifyFile, extractFile, readTextWindow, validateZip, MAX_BYTES, MAX_CHARS };
