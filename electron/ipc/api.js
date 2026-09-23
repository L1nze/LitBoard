'use strict';

/* api:fetch-json + pdf:download —— 主进程对外抓取/下载的两个出口（自 main.js registerIpc 平移）。
 * ALLOWED_API_HOSTS 是渲染层 enrichment 补全（DOI 等）的主机白名单（AGENTS.md「主进程网络出口」）。 */

const { net } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { downloadPdfToFile, safePdfFileName, composeAutoDownloadPath } = require('../pdfdownload.js');
const ctx = require('./context.js');

module.exports = { register: register, openAccessPdfDir: openAccessPdfDir };

const ALLOWED_API_HOSTS = new Set([
  'api.openalex.org',
  'api.semanticscholar.org',
  'api.crossref.org',
  'eutils.ncbi.nlm.nih.gov',
  'openlibrary.org'
]);

// 开放获取 PDF 的默认落盘目录：配置目录下的受管子目录（未设置「PDF 自动下载目录」时，
// 桌面下载与扩展抓取都落到这里）。已登记进 MANAGED_CONFIG_DIRS，迁移配置目录时随迁。
function openAccessPdfDir() {
  return path.join(ctx.dataPathState.configDir, 'open-access-pdf');
}

function register() {
  ctx.handle('api:fetch-json', async function (_event, rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch (error) { throw new Error(ctx.T('无效的 API 地址')); }
    if (url.protocol !== 'https:' || !ALLOWED_API_HOSTS.has(url.hostname)) {
      throw new Error(ctx.T('不允许访问该 API 地址'));
    }
    // 15s 硬超时兜底：fetch 的 AbortSignal 只覆盖到响应头，body 读取挂起时仍可能永不返回，
    // 这里用 race 包住「请求 + 读 body」全程，确保 IPC 一定会 settle。
    let timer = null;
    const timeout = new Promise(function (_resolve, reject) {
      timer = setTimeout(function () { reject(new Error(ctx.T('请求超时（15s）：') + url.hostname)); }, 15000);
    });
    const work = (async function () {
      const response = await net.fetch(url.href, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      });
      if (process.env.LITBOARD_DEBUG_FETCH) console.log('[fetch-json] HTTP', response.status, url.hostname);
      let data = null;
      // 仅对成功响应解析 JSON；限流(429)、5xx 等错误响应常返回 HTML/纯文本，
      // 此时保留原始 status 交给渲染层处理（重试 / 退避），不要因解析失败而丢掉状态码。
      if (response.ok) {
        const body = await response.text();
        if (body) {
          try { data = JSON.parse(body); } catch (error) { throw new Error(ctx.T('API 返回了无效 JSON')); }
        }
      }
      return { status: response.status, ok: response.ok, data };
    })();
    try {
      return await Promise.race([work, timeout]);
    } catch (error) {
      if (process.env.LITBOARD_DEBUG_FETCH) console.log('[fetch-json] FAIL', url.hostname, String(error && error.message || error));
      throw error;
    } finally {
      clearTimeout(timer);
    }
  });

  // 下载一篇开放获取 PDF：渲染层提供直链 + 建议文件名。
  // 统一落到配置目录下的 open-access-pdf 受管目录，不再允许为自动下载另选目录。
  ctx.handle('pdf:download', async function (event, options) {
    let url;
    try { url = new URL(String(options && options.url || '')); } catch (error) { return { error: ctx.T('无效的下载地址') }; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: ctx.T('无效的下载地址') };

    const suggestedName = safePdfFileName(options && options.name || 'paper.pdf');
    const autoDir = openAccessPdfDir();
    if (!path.isAbsolute(autoDir)) return { error: ctx.T('PDF 下载目录必须是绝对路径') };
    try {
      await fs.mkdir(autoDir, { recursive: true });
    } catch (error) {
      return { error: ctx.T('PDF 下载目录不可用：') + String(error && error.message || error) };
    }
    const target = composeAutoDownloadPath(autoDir, suggestedName);

    return downloadPdfToFile(url.href, target, {
      fetch: function (href, init) { return net.fetch(href, init); },
      onProgress: function (received, total) {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('pdf:download-progress', { received: received, total: total });
        }
      }
    });
  });
}
