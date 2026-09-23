'use strict';

/* ocr:* —— OCR 模型（PP-OCRv5 mobile，按需下载到配置目录/ocr/paddle；从 main.js registerIpc 平移，tesseract → PaddleOCR 时重写）。
 * 模型 tar 自包含（inference.onnx + inference.yml，字典内嵌），许可 apache-2.0（tar 内 README 声明）。
 * 渲染层契约不变：status 返回 { ready, dir, missing }，dir 指向模型目录（file:// 化后由 SDK 在 worker 内 fetch）。 */

const { net } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const ctx = require('./context.js');

module.exports = { register: register };

const OCR_MODELS = {
  'det.tar': 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar',
  'rec.tar': 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_rec_onnx_infer.tar'
};

function register() {
  ctx.handle('ocr:status', async function () {
    const dir = path.join(ctx.dataPathState.configDir, 'ocr', 'paddle');
    const missing = [];
    for (const name of Object.keys(OCR_MODELS)) {
      try { await fs.access(path.join(dir, name)); } catch (error) { missing.push(name); }
    }
    return { ready: missing.length === 0, dir: dir, missing: missing };
  });
  ctx.handle('ocr:ensure-data', async function (event) {
    const dir = path.join(ctx.dataPathState.configDir, 'ocr', 'paddle');
    await fs.mkdir(dir, { recursive: true });
    for (const name of Object.keys(OCR_MODELS)) {
      const target = path.join(dir, name);
      try { await fs.access(target); continue; } catch (error) {}
      const response = await net.fetch(OCR_MODELS[name]);
      if (!response.ok) throw new Error(ctx.T('模型下载失败（') + response.status + '）');
      await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('ocr:data-progress', { name: name });
      }
    }
    return { ready: true, dir: dir };
  });
}
