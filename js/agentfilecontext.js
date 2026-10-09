(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LitAgentFileContext = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function integer(value, fallback, max) {
    return Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.min(Math.floor(Number(value)), max) : fallback;
  }
  // Literal keyword lookup. Offsets always refer to the original UTF-16 text.
  function searchTextWindows(text, query, options) {
    var source = String(text || ''), needle = String(query || '').trim(), opts = options || {};
    if (!needle || needle.length > 256) throw new Error('Search query must contain 1 to 256 characters');
    var offset = integer(opts.offset, 0, source.length);
    var limit = Math.max(1, integer(opts.limit, 8, 20));
    var context = Math.min(integer(opts.context, 240, 800), Math.max(0, Math.floor((10000 / limit - needle.length) / 2)));
    var scanEnd = Math.min(source.length, offset + 1000000);
    var regexp = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.caseSensitive ? 'g' : 'gi');
    regexp.lastIndex = offset;
    var matches = [], match, nextOffset = null;
    var scanned = source.slice(0, scanEnd);
    while ((match = regexp.exec(scanned))) {
      if (matches.length === limit) { nextOffset = match.index; break; }
      var start = Math.max(0, match.index - context), end = Math.min(source.length, match.index + match[0].length + context);
      matches.push({ offset: start, endOffset: end, matchOffset: match.index, matchEnd: match.index + match[0].length, text: source.slice(start, end) });
    }
    if (nextOffset === null && scanEnd < source.length) nextOffset = Math.max(offset + 1, scanEnd - needle.length + 1);
    return { query: needle, matches: matches, totalChars: source.length, scannedOffset: offset, scannedEnd: scanEnd, nextOffset: nextOffset, truncated: nextOffset !== null };
  }
  // Character intervals use [start,end); page ranges use inclusive physical page numbers.
  function mergeIntervals(ranges, maximum) {
    var cap = Number.isFinite(maximum) ? Math.max(0, maximum) : Number.MAX_SAFE_INTEGER;
    var sorted = (Array.isArray(ranges) ? ranges : []).filter(function (r) {
      return Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[0] >= 0 && r[1] > r[0];
    }).map(function (r) { return [Math.min(cap, Math.floor(r[0])), Math.min(cap, Math.floor(r[1]))]; }).filter(function (r) { return r[1] > r[0]; }).sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    sorted.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r.slice());
    });
    return merged;
  }
  function mergeCoverage(previous, reading) {
    var before = previous || {}, added = reading || {};
    var totalChars = integer(added.totalChars, integer(before.totalChars, 0, Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
    var totalPages = integer(added.totalPages, integer(before.totalPages, 0, Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
    var chars = mergeIntervals((before.chars || []).concat(added.chars || []), totalChars || Number.MAX_SAFE_INTEGER);
    var pages = mergeIntervals((before.pages || []).concat(added.pages || []).filter(function (r) { return Array.isArray(r) && r[0] >= 1 && r[1] >= r[0]; }).map(function (r) { return [r[0] - 1, r[1]]; }), totalPages || Number.MAX_SAFE_INTEGER).map(function (r) { return [r[0] + 1, r[1]]; });
    return { chars: chars, pages: pages, totalChars: totalChars, totalPages: totalPages, extractionTruncated: !!(before.extractionTruncated || added.extractionTruncated) };
  }
  function coverageSummary(coverage) {
    var c = mergeCoverage({}, coverage);
    var readChars = c.chars.reduce(function (n, r) { return n + r[1] - r[0]; }, 0);
    var readPages = c.pages.reduce(function (n, r) { return n + r[1] - r[0] + 1; }, 0);
    return Object.assign({}, c, { readChars: readChars, readPages: readPages, textComplete: c.totalChars > 0 && readChars === c.totalChars && !c.extractionTruncated, pagesComplete: c.totalPages > 0 && readPages === c.totalPages });
  }
  function getFileCoverage(messages, file) {
    var coverage = {};
    (Array.isArray(messages) ? messages : []).forEach(function (message) {
      if (!message || message.role !== 'tool' || message.error || !['read_session_file', 'render_session_pdf_pages'].includes(message.name)) return;
      var result;
      try { result = typeof message.content === 'string' ? JSON.parse(message.content) : message.content; } catch (_) { return; }
      if (!result || result.error || result.file !== file) return;
      var reading = { extractionTruncated: result.extractionTruncated };
      if (Number.isFinite(result.totalChars) && result.totalChars > 0) reading.totalChars = result.totalChars;
      if (Number.isFinite(result.totalPages) && result.totalPages > 0) reading.totalPages = result.totalPages;
      if (message.name === 'read_session_file' && typeof result.text === 'string' && Number.isFinite(result.offset) && result.offset >= 0) reading.chars = [[result.offset, result.offset + result.text.length]];
      if (message.name === 'render_session_pdf_pages') reading.pages = (Array.isArray(result.renderedPages) ? result.renderedPages : []).filter(function (p) { return Number.isSafeInteger(p) && p >= 1; }).map(function (p) { return [p, p]; });
      coverage = mergeCoverage(coverage, reading);
    });
    return coverageSummary(coverage);
  }
  return { searchTextWindows: searchTextWindows, mergeIntervals: mergeIntervals, mergeCoverage: mergeCoverage, coverageSummary: coverageSummary, getFileCoverage: getFileCoverage };
});
