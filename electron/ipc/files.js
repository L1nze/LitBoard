'use strict';

/* files:* + clipboard:* + csl:* —— 文件对话框、受管目录存储、剪贴板与 CSL 样式缓存
 * （自 main.js registerIpc 平移）。 */

const { clipboard, dialog, net, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { storeFileInto, resolveSnapshotEntry } = require('../integrations.js');
const ctx = require('./context.js');

module.exports = { register: register };

function decodeImportText(bytes) {
  const buffer = Buffer.from(bytes || []);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(Math.max(0, buffer.length - 2));
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1];
      swapped[i - 1] = buffer[i];
    }
    return swapped.toString('utf16le');
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
}

function register() {
  ctx.handle('files:choose-import', async function () {
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      title: ctx.T('导入文献'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: ctx.T('支持的文献文件'), extensions: ['bib', 'bibtex', 'txt', 'json', 'ris', 'xml', 'pdf'] },
        { name: ctx.T('所有文件'), extensions: ['*'] }
      ]
    });
    if (result.canceled) return [];
    return Promise.all(result.filePaths.map(async function (filePath) {
      const ext = path.extname(filePath).toLowerCase();
      const item = { name: path.basename(filePath), path: filePath, extension: ext };
      try {
        if (ext !== '.pdf') item.text = decodeImportText(await fs.readFile(filePath));
      } catch (error) {
        item.error = String(error && error.message || error);
      }
      return item;
    }));
  });

  ctx.handle('files:save', async function (_event, options) {
    const result = await dialog.showSaveDialog(ctx.mainWindow, {
      title: ctx.T('导出 LitBoard 数据'),
      defaultPath: options && options.name ? options.name : 'litboard-export.txt',
      filters: options && Array.isArray(options.filters) ? options.filters : undefined
    });
    if (result.canceled || !result.filePath) return false;
    // 二进制导出（docx 等）走 bytes；文本走 content
    if (options && options.bytes && options.bytes.length) await fs.writeFile(result.filePath, Buffer.from(options.bytes));
    else await fs.writeFile(result.filePath, String(options.content || ''), 'utf8');
    return true;
  });

  ctx.handle('files:open-path', async function (_event, filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return ctx.T('无效的文件路径');
    return shell.openPath(filePath);
  });
  // 在系统文件管理器中定位（并选中）文件：Zotero「Show File」式
  ctx.handle('files:reveal', async function (_event, filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return ctx.T('无效的文件路径');
    try {
      await fs.access(filePath);
    } catch (error) {
      return ctx.T('文件不存在：') + filePath;
    }
    shell.showItemInFolder(filePath);
    return '';
  });
  ctx.handle('files:read-bytes', async function (_event, filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error(ctx.T('无效的文件路径'));
    // 目录 → 找快照主入口（Zotero 快照是目录型附件，入口为 index.html；F12）
    filePath = await resolveSnapshotEntry(filePath);
    return new Uint8Array(await fs.readFile(filePath));
  });
  ctx.handle('clipboard:write', function (_event, value) {
    clipboard.writeText(String(value || ''));
    return true;
  });

  ctx.handle('files:choose-directory', async function (_event, options) {
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      title: options && options.title ? String(options.title) : ctx.T('选择目录'),
      defaultPath: options && options.defaultPath && path.isAbsolute(String(options.defaultPath))
        ? String(options.defaultPath) : undefined,
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled || !result.filePaths[0] ? '' : result.filePaths[0];
  });

  // 通用文件选择（添加附件用）
  ctx.handle('files:choose-files', async function (_event, options) {
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      title: options && options.title ? String(options.title) : ctx.T('选择文件'),
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return [];
    return result.filePaths.map(function (filePath) {
      return { name: path.basename(filePath), path: filePath, extension: path.extname(filePath).toLowerCase() };
    });
  });

  // 按模板重命名附件：同目录改名，冲突自动加 -2 后缀，不覆盖任何现有文件
  ctx.handle('files:rename', async function (_event, options) {
    try {
      const oldPath = String(options && options.path || '');
      const base = String(options && options.baseName || '').trim();
      let illegal = !base || base !== base.trim();
      for (let i = 0; i < base.length && !illegal; i++) {
        const code = base.charCodeAt(i);
        if (code < 0x20 || '\\/:*?"<>|'.indexOf(base[i]) !== -1) illegal = true;
      }
      if (!path.isAbsolute(oldPath) || illegal) return { error: ctx.T('无效的重命名请求') };
      const dir = path.dirname(oldPath);
      const ext = path.extname(oldPath);
      let target = path.join(dir, base + ext);
      if (path.resolve(target) === path.resolve(oldPath)) {
        return { path: oldPath, name: path.basename(oldPath), unchanged: true };
      }
      let counter = 2;
      while (true) {
        try {
          await fs.access(target);
          target = path.join(dir, base + '-' + counter + ext);
          counter++;
        } catch (error) { break; }
      }
      await fs.rename(oldPath, target);
      return { path: target, name: path.basename(target) };
    } catch (error) { return { error: String(error && error.message || error) }; }
  });

  // 批量导出 PDF：把 sources 逐个复制到目标目录，重名自动加 -2/-3 后缀，不覆盖现有文件
  ctx.handle('files:export-pdfs', async function (_event, options) {
    try {
      const dir = String(options && options.dir || '');
      const files = Array.isArray(options && options.files) ? options.files : [];
      if (!path.isAbsolute(dir)) return { error: ctx.T('无效的目标目录') };
      if (!files.length) return { copied: [], failed: [] };
      await fs.mkdir(dir, { recursive: true });
      const copied = [];
      const failed = [];
      for (const file of files) {
        const src = String(file && file.path || '');
        let base = String(file && file.name || '').trim();
        if (!base) base = 'paper';
        if (!/\.pdf$/i.test(base)) base += '.pdf';
        if (!path.isAbsolute(src)) { failed.push({ name: base, reason: ctx.T('无效源路径') }); continue; }
        try { await fs.access(src); } catch (error) { failed.push({ name: base, reason: ctx.T('源文件不存在') }); continue; }
        const ext = path.extname(base);
        const stem = base.slice(0, base.length - ext.length);
        let target = path.join(dir, base);
        let counter = 2;
        while (true) {
          try { await fs.access(target); target = path.join(dir, stem + '-' + counter + ext); counter++; }
          catch (error) { break; }
        }
        try {
          await fs.copyFile(src, target);
          copied.push({ name: path.basename(target) });
        } catch (error) {
          failed.push({ name: base, reason: String(error && error.message || error) });
        }
      }
      return { copied: copied, failed: failed };
    } catch (error) {
      return { error: String(error && error.message || error) };
    }
  });

  // 把导入的 PDF 拷进配置目录/synced-attachments，按该目录惯例命名（z + 8 位随机键），保留原文件
  ctx.handle('files:store-pdf', async function (_event, options) {
    try {
      const src = String(options && options.path || '');
      if (!path.isAbsolute(src)) return { error: ctx.T('无效的源文件路径') };
      try { await fs.access(src); } catch (error) { return { error: ctx.T('源文件不存在：') + src }; }
      const dir = path.join(ctx.dataPathState.configDir, 'synced-attachments');
      return await storeFileInto(dir, src, '.pdf');
    } catch (error) {
      return { error: String(error && error.message || error) };
    }
  });

  // 选择自动导出 .bib 的目标文件
  ctx.handle('files:choose-save-path', async function (_event, options) {
    const result = await dialog.showSaveDialog(ctx.mainWindow, {
      title: options && options.title ? String(options.title) : ctx.T('选择文件'),
      defaultPath: options && options.name ? options.name : 'library.bib',
      filters: options && Array.isArray(options.filters) ? options.filters : undefined
    });
    return result.canceled || !result.filePath ? '' : result.filePath;
  });

  // 在线获取 CSL 样式（缓存到配置目录/csl-styles/）
  ctx.handle('csl:fetch-style', async function (_event, styleId) {
    const id = String(styleId || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(id)) throw new Error(ctx.T('无效的样式名'));
    const dir = path.join(ctx.dataPathState.configDir, 'csl-styles');
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, id + '.csl');
    try {
      return await fs.readFile(target, 'utf8');
    } catch (error) {}
    const response = await net.fetch('https://www.zotero.org/styles/' + encodeURIComponent(id));
    if (!response.ok) throw new Error(ctx.T('样式下载失败（') + response.status + '）');
    const text = await response.text();
    if (!/^\s*<\?xml[\s\S]*<style[\s>]/.test(text)) throw new Error(ctx.T('下载到的不是有效 CSL 样式'));
    await fs.writeFile(target, text, 'utf8');
    return text;
  });

  // 把修改后的 PDF 字节写回原文件（批注写回用；首次写前保留 .litbak 备份）
  ctx.handle('files:write-pdf', async function (_event, options) {
    const filePath = String(options && options.path || '');
    if (!path.isAbsolute(filePath) || !/\.pdf$/i.test(filePath)) return { error: ctx.T('无效的 PDF 路径') };
    const bytes = options && options.bytes;
    if (!bytes || !bytes.length) return { error: ctx.T('没有可写入的内容') };
    try {
      const backup = filePath + '.litbak';
      try {
        await fs.access(backup);
      } catch (error) {
        await fs.copyFile(filePath, backup); // 首次写回前留底
      }
      const temp = filePath + '.litwrite';
      await fs.writeFile(temp, Buffer.from(bytes));
      await fs.rm(filePath, { force: true });
      await fs.rename(temp, filePath);
      return { ok: true, backup: backup };
    } catch (error) {
      return { error: String(error && error.message || error) };
    }
  });

  // 批注截图等图片附件保存到配置目录/annotation-images/
  ctx.handle('files:save-annotation-image', async function (_event, options) {
    try {
      const name = String(options && options.name || '').replace(/[^A-Za-z0-9_-]/g, '');
      const dataUrl = String(options && options.dataUrl || '');
      const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
      if (!name || !match) return { error: ctx.T('无效的图片数据') };
      const dir = path.join(ctx.dataPathState.configDir, 'annotation-images');
      await fs.mkdir(dir, { recursive: true });
      const target = path.join(dir, name + '.png');
      await fs.writeFile(target, Buffer.from(match[1], 'base64'));
      return { path: target };
    } catch (error) { return { error: String(error && error.message || error) }; }
  });

  // 笔记图片入库：复制/解码写入 <配置目录>/note-assets/<noteId>/（受管目录，登记过路径迁移/备份/同步）
  ctx.handle('files:store-note-image', async function (_event, options) {
    try {
      const noteId = String(options && options.noteId || '').replace(/[^A-Za-z0-9_-]/g, '');
      if (!noteId) return { error: ctx.T('无效的笔记 ID') };
      const dir = path.join(ctx.dataPathState.configDir, 'note-assets', noteId);
      await fs.mkdir(dir, { recursive: true });
      let buffer = null;
      let baseName = 'image';
      const dataUrl = String(options && options.dataUrl || '');
      if (dataUrl) {
        const match = dataUrl.match(/^data:image\/([a-z0-9+.-]+);base64,(.+)$/i);
        if (!match) return { error: ctx.T('无效的图片数据') };
        buffer = Buffer.from(match[2], 'base64');
        baseName = 'image.' + (/^svg/i.test(match[1]) ? 'svg' : match[1].replace(/\+/g, '.').replace(/[^a-z0-9.]/g, '') || 'png');
      } else {
        const src = String(options && options.path || '');
        if (!path.isAbsolute(src)) return { error: ctx.T('无效的源文件路径') };
        try { buffer = await fs.readFile(src); } catch (error) { return { error: ctx.T('源文件不存在：') + src }; }
        baseName = path.basename(src);
      }
      const safe = baseName.replace(/[\\/:*"<>\u0000-\u001f|-]/g, '_').slice(-80) || 'image.png';
      let target = path.join(dir, safe);
      let suffix = 0;
      while (true) {
        try { await fs.access(target); suffix++; target = path.join(dir, suffix + '-' + safe); }
        catch (error) { break; }
      }
      await fs.writeFile(target, buffer);
      const rel = 'note-assets/' + noteId + '/' + path.basename(target);
      return { path: target, rel: rel };
    } catch (error) { return { error: String(error && error.message || error) }; }
  });
}
