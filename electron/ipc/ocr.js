'use strict';

/* ocr:* —— OCR 语言包（tessdata_fast，按需下载到配置目录/ocr；从 main.js registerIpc 平移） */

const { net } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const ctx = require('./context.js');

module.exports = { register: register };

const OCR_LANGS = {
  'eng.traineddata': 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@main/eng.traineddata',
  'chi_sim.traineddata': 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@main/chi_sim.traineddata'
};

function register() {
  ctx.handle('ocr:status', async function () {
    const dir = path.join(ctx.dataPathState.configDir, 'ocr');
    const missing = [];
    for (const name of Object.keys(OCR_LANGS)) {
      try { await fs.access(path.join(dir, name)); } catch (error) { missing.push(name); }
    }
    return { ready: missing.length === 0, dir: dir, missing: missing };
  });
  ctx.handle('ocr:ensure-data', async function (event) {
    const dir = path.join(ctx.dataPathState.configDir, 'ocr');
    await fs.mkdir(dir, { recursive: true });
    for (const name of Object.keys(OCR_LANGS)) {
      const target = path.join(dir, name);
      try { await fs.access(target); continue; } catch (error) {}
      const response = await net.fetch(OCR_LANGS[name]);
      if (!response.ok) throw new Error(ctx.T('语言包下载失败（') + response.status + '）');
      await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('ocr:data-progress', { name: name });
      }
    }
    return { ready: true, dir: dir };
  });
}
