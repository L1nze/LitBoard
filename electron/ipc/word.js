'use strict';

/* word:* —— Word COM 桥（cscript 常驻进程）+ Zotero 域转换（自 main.js registerIpc 平移）。
 * wordBridge 在 register() 时创建（与原实现同时机）；实例写进 ctx.wordBridgeInstance
 * 供 will-quit 清理链 stop()。 */

const path = require('node:path');
const { createWordBridge } = require('../word-bridge.js');
const ctx = require('./context.js');

module.exports = { register: register };

function register() {
  const wordScriptCandidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'word', 'wordbridge.js'),
    path.join(__dirname, '..', '..', 'word', 'wordbridge.js'),
    path.join(process.resourcesPath || '', 'word', 'wordbridge.js')
  ];
  const wordScriptPath = wordScriptCandidates.find(function (candidate) {
    try { return require('node:fs').existsSync(candidate); } catch (error) { return false; }
  }) || wordScriptCandidates[1];
  const wordBridge = createWordBridge({ scriptPath: wordScriptPath });
  ctx.wordBridgeInstance = wordBridge;
  ctx.handle('word:invoke', function (_event, value) {
    const input = value && typeof value === 'object' ? value : { line: String(value || '') };
    const line = String(input.line || '');
    const command = String(input.command || '').toUpperCase();
    if (line && !/^[A-Z]+(?:\|.*)?$/.test(line)) throw new Error(ctx.T('无效的 Word 命令'));
    if (!line && !/^[A-Z][A-Z0-9_-]*$/.test(command)) throw new Error(ctx.T('无效的 Word 命令'));
    return wordBridge.invoke(input, Number(input.timeout) || 30000);
  });
  ctx.handle('word:zotero-convert-read', async function (_event, filePath) {
    const fs = require('node:fs/promises');
    const LitDocx = require('../../js/docx.js');
    const bytes = new Uint8Array(await fs.readFile(String(filePath || '')));
    return (LitDocx.readDocxFieldsAll || LitDocx.readDocxFields)(bytes);
  });
  ctx.handle('word:zotero-convert-write', async function (_event, value) {
    const fs = require('node:fs/promises');
    const LitDocx = require('../../js/docx.js');
    const sourceInput = String(value && value.source || '');
    const targetInput = String(value && value.target || '');
    if (!sourceInput || !targetInput) throw new Error(ctx.T('必须提供源文件和目标文件'));
    const source = path.resolve(sourceInput);
    const target = path.resolve(targetInput);
    if (source.toLowerCase() === target.toLowerCase()) throw new Error(ctx.T('源文件与目标文件必须不同'));
    try {
      await fs.access(target);
      throw new Error(ctx.T('目标文件已存在，为避免覆盖未执行转换'));
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }
    const bytes = new Uint8Array(await fs.readFile(source));
    const entries = await LitDocx.zipRead(bytes);
    const docEntry = entries.filter(function (e) { return e.name === 'word/document.xml'; })[0];
    if (!docEntry) throw new Error(ctx.T('docx 缺少 word/document.xml'));
    const fields = value.fields || [];
    const out = entries.map(function (e) {
      if (['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'].indexOf(e.name) === -1) {
        return { name: e.name, data: e.data };
      }
      const xml = Buffer.from(e.data).toString('utf8');
      const partFields = fields.filter(function (field) { return !field.part || field.part === e.name; });
      return { name: e.name, data: LitDocx.convertZoteroDocxXml(xml, partFields) };
    });
    const temp = target + '.litboard-tmp-' + process.pid + '-' + Date.now();
    try {
      await fs.writeFile(temp, Buffer.from(await LitDocx.zipStore(out)));
      const verified = new Uint8Array(await fs.readFile(temp));
      if (!((await LitDocx.zipRead(verified)).some(function (entry) { return entry.name === 'word/document.xml'; }))) {
        throw new Error(ctx.T('转换结果缺少 word/document.xml'));
      }
      await fs.rename(temp, target);
      return { ok: true, target: target };
    } finally {
      await fs.rm(temp, { force: true }).catch(function () {});
    }
  });
}
