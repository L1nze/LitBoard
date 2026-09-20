'use strict';

const nodeFs = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');

function safePdfFileName(name) {
  let value = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  if (!value) value = 'paper.pdf';
  if (!/\.pdf$/i.test(value)) value += '.pdf';
  return value;
}

function isProbablyPdfBytes(bytes) {
  const head = Buffer.from(bytes || []).subarray(0, 1024);
  return head.indexOf(Buffer.from('%PDF-')) !== -1;
}

async function fileLooksLikePdf(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1024);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    return isProbablyPdfBytes(buffer.subarray(0, result.bytesRead));
  } finally {
    await handle.close();
  }
}

async function removeQuietly(filePath) {
  try { await fs.rm(filePath, { force: true }); } catch (error) {}
}

async function streamBodyToFile(response, temp, onProgress) {
  const total = Number(response.headers.get('content-length') || 0);
  const out = nodeFs.createWriteStream(temp);
  await new Promise(function (resolve, reject) {
    let received = 0;
    const input = Readable.fromWeb(response.body);
    out.on('error', reject);
    out.on('finish', resolve);
    input.on('data', function (chunk) {
      received += chunk.length;
      if (onProgress) onProgress(received, total);
    });
    input.on('error', reject);
    input.pipe(out);
  });
}

async function downloadPdfResponseToFile(response, target, onProgress) {
  if (!response.ok) return { error: '下载失败：HTTP ' + response.status };
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.indexOf('text/html') !== -1) return { error: '服务器返回了网页而非 PDF（链接可能已失效）' };
  if (!response.body) return { error: '服务器没有返回文件内容' };

  const temp = target + '.part';
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await streamBodyToFile(response, temp, onProgress);
    if (!(await fileLooksLikePdf(temp))) {
      await removeQuietly(temp);
      return { error: '服务器返回的内容不是有效 PDF' };
    }
    await fs.rename(temp, target);
    return { path: target };
  } catch (error) {
    await removeQuietly(temp);
    return { error: '写入失败：' + String(error && error.message || error) };
  }
}

async function downloadPdfToFile(rawUrl, target, options) {
  let url;
  try { url = new URL(String(rawUrl || '')); } catch (error) { return { error: '无效的下载地址' }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: '无效的下载地址' };

  const fetchImpl = options && options.fetch ? options.fetch : fetch;
  let response;
  try {
    response = await fetchImpl(url.href, {
      headers: { Accept: 'application/pdf,*/*' },
      // 默认 30s 超时，防止服务器不响应导致调用方无限等待
      signal: AbortSignal.timeout(options && options.timeoutMs || 30000)
    });
  } catch (error) {
    if (error && error.name === 'TimeoutError') return { error: '下载超时' };
    return { error: '下载失败：' + String(error && error.message || error) };
  }
  return downloadPdfResponseToFile(response, target, options && options.onProgress);
}

/* 自动下载目标的落盘路径：目录 + 模板名（自动补 .pdf）。目录为空返回 null（防御用：
 * 调用方 pdf:download 已在更早处把空目录解析为配置目录下的 open-access-pdf 受管目录）。
 * 同名覆盖：命名模板含标题，重名基本只发生在重复下载同一篇时，覆盖即幂等更新
 * （downloadPdfToFile 先写 .part 再 rename）。 */
function composeAutoDownloadPath(dir, baseName) {
  const directory = String(dir || '').trim();
  if (!directory) return null;
  return path.join(directory, safePdfFileName(baseName || 'paper.pdf'));
}

module.exports = {
  composeAutoDownloadPath,
  downloadPdfResponseToFile,
  downloadPdfToFile,
  isProbablyPdfBytes,
  safePdfFileName
};
