'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const Files = require('./agent-files.js');
const FileContext = require('../js/agentfilecontext.js');

// The session registry, rather than model supplied disk paths, grants read access.
function createReferences(getSessions) {
  const cache = new Map();
  async function registeredPath(id, file) {
    if (typeof file !== 'string' || !/^附件[/\\][^/\\]+$/.test(file) || file.includes('..')) throw new Error('Invalid reference path');
    const sessions = getSessions();
    const doc = await sessions.read(id);
    if (!doc || !(doc.attachments || []).some((att) => att.file === file)) throw new Error('Reference is not registered in this session');
    const target = await sessions.attachmentPath(id, file);
    const root = await fs.realpath(path.dirname(target));
    if ((await fs.lstat(path.dirname(target))).isSymbolicLink()) throw new Error('Invalid reference directory');
    const real = await fs.realpath(target);
    if (path.dirname(real) !== root || !(await fs.stat(real)).isFile()) throw new Error('Invalid reference path');
    return real;
  }
  async function importFiles(id, paths) {
    const imported = [], failed = [];
    const list = Array.isArray(paths) ? paths : [];
    if (list.length > 10) throw new Error('At most 10 reference files per upload');
    for (const source of list) {
      const name = path.basename(String(source));
      try {
        const type = Files.classifyFile(name);
        if (type.kind === 'unsupported') throw new Error('Unsupported reference format');
        const stat = await fs.stat(source);
        const cap = type.kind === 'image' ? 8 * 1024 * 1024 : Files.MAX_BYTES;
        if (!stat.isFile() || stat.size <= 0 || stat.size > cap) throw new Error('File must be nonempty and within ' + Math.floor(cap / 1048576) + ' MiB');
        const handle = await fs.open(source, 'r');
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            const chunk = Buffer.alloc(65536);
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
            if (!bytesRead) break;
            size += bytesRead;
            if (size > cap) throw new Error('Reference file exceeds size limit');
            chunks.push(chunk.subarray(0, bytesRead));
          }
        } finally { await handle.close(); }
        const bytes = Buffer.concat(chunks, size);
        const stored = await getSessions().saveAttachment(id, { name, label: name, dataBase64: bytes.toString('base64') });
        imported.push({ file: stored.file, name, kind: type.kind, size: bytes.length });
      } catch (error) { failed.push({ name, error: String(error.message || error) }); }
    }
    return { imported, failed, attachments: (await getSessions().read(id)).attachments };
  }
  async function extractedFile(id, file) {
    const real = await registeredPath(id, file);
    const stat = await fs.stat(real);
    const key = real + '|' + stat.size + '|' + stat.mtimeMs;
    let result = cache.get(key);
    if (!result) {
      result = await Files.extractFile(real);
      if (result.status === 'ready') {
        cache.set(key, result);
        if (cache.size > 8) cache.delete(cache.keys().next().value);
      }
    }
    return { real, stat, result };
  }
  async function listFiles(id) {
    const doc = await getSessions().read(id);
    if (!doc) throw new Error('Session not found');
    return { files: (doc.attachments || []).map((att) => ({ file: att.file, name: att.label || path.basename(att.file), kind: Files.classifyFile(att.file).kind, size: Number.isFinite(att.size) ? att.size : null })) };
  }
  async function searchFile(id, file, query, options) {
    const { real, stat, result } = await extractedFile(id, file);
    if (result.status === 'requires_pdf_extraction') return { file, kind: 'pdf', status: result.status, path: real, size: stat.size, revision: stat.mtimeMs };
    if (result.status !== 'ready') return { file, kind: result.kind, status: result.status, error: result.error || '', size: stat.size };
    return Object.assign({ file, kind: result.kind, status: 'ready', extractionTruncated: result.truncated }, FileContext.searchTextWindows(result.text, query, options));
  }
  async function readFile(id, file, offset) {
    const { real, stat, result } = await extractedFile(id, file);
    if (result.status === 'requires_pdf_extraction') return { file, kind: 'pdf', status: result.status, path: real, size: stat.size, revision: stat.mtimeMs };
    if (result.status !== 'ready') return { file, kind: result.kind, status: result.status, error: result.error || '', size: stat.size };
    return Object.assign({ file, kind: result.kind, status: 'ready', extractionTruncated: result.truncated }, Files.readTextWindow(result.text, { offset: Number(offset), limit: 6000 }));
  }
  return { importFiles, readFile, listFiles, searchFile, registeredPath };
}
module.exports = { createReferences };
