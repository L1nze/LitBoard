'use strict';

/* pdfsearch:* —— PDF 全文索引读写（SQLite + FTS5 trigram；从 main.js registerIpc 平移） */

const ctx = require('./context.js');

module.exports = { register: register };

function register() {
  ctx.handle('pdfsearch:get-pages', async function (_event, value) {
    const paperId = value && typeof value === 'object' ? value.paperId : value;
    const attachmentId = value && typeof value === 'object' ? value.attachmentId : '';
    const entry = await ctx.libraryDb.pdfTextGet(paperId, attachmentId);
    return entry ? entry.pages : null;
  });
  // AI 阅读助手：按页区间读取（每页封顶，避免大文档整篇过 IPC）
  ctx.handle('pdfsearch:get-page-range', async function (_event, value) {
    const input = value && typeof value === 'object' ? value : {};
    return ctx.libraryDb.pdfTextGetRange(input.paperId, input.attachmentId || '', input.from, input.to, input.capChars, input.fromChar);
  });
  ctx.handle('pdfsearch:meta', function () { return ctx.libraryDb.pdfTextMeta(); });
  ctx.handle('pdfsearch:put', function (_event, value) { return ctx.libraryDb.pdfTextPut(value || {}); });
  ctx.handle('pdfsearch:query', function (_event, query) { return ctx.libraryDb.pdfTextQuery(String(query || '')); });
  ctx.handle('pdfsearch:invalidate', function (_event, value) {
    if (value && typeof value === 'object') return ctx.libraryDb.pdfTextInvalidate(value.paperId, value.attachmentId);
    return ctx.libraryDb.pdfTextInvalidate(value);
  });
  ctx.handle('pdfsearch:clear', function () { return ctx.libraryDb.pdfTextClear(); });
  ctx.handle('pdfsearch:stats', function () { return ctx.libraryDb.pdfTextStats(); });
}
