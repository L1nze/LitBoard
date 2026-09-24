'use strict';

/* 文献条目的受管附件目录。ID 作目录名，标题变更不会使附件路径失效。 */
const path = require('node:path');
const fs = require('node:fs/promises');
const nodeFs = require('node:fs');
const crypto = require('node:crypto');

function itemAttachmentDir(configDir, paperId) {
  const id = String(paperId || '');
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new Error('INVALID_PAPER_ID');
  return path.join(configDir, 'synced-attachments', 'items', id);
}

function isInsideItemDir(configDir, paperId, candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return false;
  const parent = itemAttachmentDir(configDir, paperId);
  const relative = path.relative(parent, candidate);
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of nodeFs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function digestPath(filePath) {
  const stat = await fs.lstat(filePath);
  if (stat.isFile()) return 'file:' + await hashFile(filePath);
  if (!stat.isDirectory()) throw new Error('不支持的附件类型');
  const names = (await fs.readdir(filePath)).sort();
  const parts = [];
  for (const name of names) parts.push(name + ':' + await digestPath(path.join(filePath, name)));
  return 'dir:' + crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

async function duplicatePdfPath(source, existing) {
  if (!/\.pdf$/i.test(String(source || ''))) return '';
  const sourceStat = await fs.stat(source);
  if (!sourceStat.isFile()) return '';
  let sourceHash = '';
  for (const item of (Array.isArray(existing) ? existing : []).slice(0, 200)) {
    if (!item || item.kind !== 'pdf' || !path.isAbsolute(String(item.path || ''))) continue;
    const candidate = String(item.path);
    const stat = await fs.stat(candidate).catch(function () { return null; });
    if (!stat || !stat.isFile() || stat.size !== sourceStat.size) continue;
    if (!sourceHash) sourceHash = await hashFile(source);
    if (await hashFile(candidate) === sourceHash) return candidate;
  }
  return '';
}

async function storeItemAttachment(configDir, paperId, source, extHint, verify, stores) {
  const dir = itemAttachmentDir(configDir, paperId);
  const src = String(source || '');
  if (!path.isAbsolute(src)) throw new Error('INVALID_SOURCE_PATH');
  const sourceStat = await fs.stat(src);
  if (isInsideItemDir(configDir, paperId, src) || path.resolve(src) === path.resolve(dir)) {
    return { path: src, name: path.basename(src), unchanged: true };
  }
  const stored = sourceStat.isDirectory()
    ? await stores.storeDirInto(dir, src)
    : await stores.storeFileInto(dir, src, extHint);
  if (verify && await digestPath(src) !== await digestPath(stored.path)) {
    throw new Error('ATTACHMENT_COPY_MISMATCH');
  }
  return { path: stored.path, name: path.basename(stored.path) };
}

module.exports = { itemAttachmentDir, isInsideItemDir, duplicatePdfPath, storeItemAttachment };
