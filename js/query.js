/* LitBoard 高级检索：版本化 AST + 字段语法 + 跨层级条件组 + Unicode 规范化（浏览器 / Node 共用）
 *
 * 语法（阶段四）：
 *   裸词 / "短语"          → 跨 key/标题/作者/期刊/摘要/笔记/标签 子串（Unicode 规范化：café=cafe、弯引号、全半角、上下标）
 *   field:value            → title author venue tag type status year citations rating doi key notes abstract
 *   year>=2020 citations>10 rating>=4   → 数值比较
 *   lastread>=2024-01-01   → 阅读时间比较（: = 当天）；missing:lastread = 从未阅读
 *   folder:"名称"          → 文件夹（含子文件夹；需 ctx.folders）
 *   has:pdf|notes|doi|abstract|annotations|epub|snapshot|supp|attachment  is:unread|reading|read|trash
 *   missing:field          → 空值判断（与 has: 互补的字段维度）
 *   ann(text:"量子" color:#ffd400)  → 跨层级组：组内条件必须【同一批注】满足；
 *                                     多个 ann(...) 组 = 不同批注各满足（∃ 量词）。
 *                                     批注字段：text comment color page type tag
 *   note("材料" title:方法)         → 同理作用于该文献的笔记（字段：title content format）
 *   AND OR NOT（大写）、! 或 - 前缀取反、括号分组、/正则/（正则不规范化）
 *   相邻条件默认 AND。解析失败返回 { error }，调用方可降级为子串搜索。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitQuery = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  function text(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  /* ---------- Unicode 规范化（只用于匹配，不改显示） ---------- */
  function normalizeForSearch(value) {
    return text(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„‟«»]/g, '"')
      .replace(/\u200B|\u200C|\u200D|\u2060/g, '')
      .toLowerCase();
  }

  var FIELD_ALIASES = {
    title: 'title', author: 'authors', authors: 'authors', venue: 'venue', journal: 'venue',
    tag: 'tags', tags: 'tags', type: 'entryType', entrytype: 'entryType', status: 'status',
    rating: 'rating', year: 'year', citations: 'citations', cited: 'citations',
    doi: 'doi', key: 'key', bibkey: 'key', notes: 'notes', note: 'notes', abstract: 'abstract',
    publisher: 'publisher', place: 'place', series: 'series', sourcetype: 'sourceType'
  };
  var NUMERIC_FIELDS = { year: true, citations: true, rating: true };
  var COUNT_FIELDS = { annotations: 'annotations', annotation: 'annotations', notes: 'notes',
    attachments: 'attachments', attachment: 'attachments', pdfs: 'pdfs' };
  var DATE_FIELDS = { lastread: 'lastReadAt', lastreadat: 'lastReadAt', readat: 'lastReadAt' };
  // 跨层级组的字段表：ann → 批注对象；note → 笔记对象
  var ANN_FIELD_ALIASES = {
    text: 'text', quote: 'text', comment: 'comment', note: 'comment',
    color: 'color', page: 'page', type: 'type', tag: 'tags', tags: 'tags'
  };
  var ANN_NUMERIC = { page: true };
  var NOTE_FIELD_ALIASES = { title: 'title', content: 'content', text: 'content', format: 'format' };
  var ATT_FIELD_ALIASES = { kind: 'kind', type: 'kind', name: 'fileName', file: 'fileName',
    path: 'path', zotero: 'zoteroKey' };

  // ---------- 词法 ----------
  function tokenize(input) {
    var tokens = [];
    var s = String(input || '');
    var i = 0;
    while (i < s.length) {
      var ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '(' || ch === ')') { tokens.push({ t: ch }); i++; continue; }
      if (ch === '"') {
        var end = s.indexOf('"', i + 1);
        if (end === -1) return { error: T('引号未闭合') };
        tokens.push({ t: 'word', v: s.slice(i + 1, end), exact: true });
        i = end + 1;
        continue;
      }
      if (ch === '/') {
        var j = i + 1, escaped = false, body = '';
        while (j < s.length) {
          if (!escaped && s[j] === '/') break;
          if (!escaped && s[j] === '\\') { escaped = true; body += s[j]; j++; continue; }
          escaped = false; body += s[j]; j++;
        }
        if (j >= s.length) return { error: T('正则未闭合') };
        try {
          tokens.push({ t: 'regex', v: new RegExp(body, 'i') });
        } catch (e) { return { error: T('无效正则：') + e.message }; }
        i = j + 1;
        continue;
      }
      if (ch === '!' || (ch === '-' && i + 1 < s.length && !/\s/.test(s[i + 1]))) {
        tokens.push({ t: 'NOT' });
        i++;
        continue;
      }
      var k = i, inQuote = false;
      while (k < s.length) {
        if (s[k] === '"') { inQuote = !inQuote; k++; continue; }
        if (!inQuote && /[\s()]/.test(s[k])) break;
        k++;
      }
      if (inQuote) return { error: T('引号未闭合') };
      var word = s.slice(i, k);
      if (word === 'AND' || word === 'OR' || word === 'NOT') tokens.push({ t: word });
      else tokens.push({ t: 'word', v: word });
      i = k;
    }
    return { tokens: tokens };
  }

  // ---------- 语法（返回版本化 AST 的 root 树；节点为 {op,...}） ----------
  function parseDateValue(raw) {
    var m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(text(raw));
    if (!m) return null;
    var y = Number(m[1]), mo = m[2] ? Number(m[2]) : 1, d = m[3] ? Number(m[3]) : 1;
    var leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (mo < 1 || mo > 12 || d < 1 || d > days[mo - 1]) return null;
    return Date.UTC(y, mo - 1, d);
  }
  function dayEnd(start) {
    return start + 24 * 60 * 60 * 1000;
  }

  function doiSearchValue(value) {
    // 详情栏显示/复制的 DOI 往往带“DOI ”标签或 doi.org 前缀；字段查询只匹配标识符。
    return text(value).trim()
      .replace(/^doi(?:\s*[:：]\s*|\s+)/i, '')
      .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '');
  }

  function parseTokens(tokens) {
    var pos = 0;
    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }
    function parseOr(scope) {
      var left = parseAnd(scope);
      while (peek() && peek().t === 'OR') { next(); left = { op: 'or', a: left, b: parseAnd(scope) }; }
      return left;
    }
    function parseAnd(scope) {
      var left = parseUnary(scope);
      while (peek() && (peek().t === 'word' || peek().t === 'regex' || peek().t === '(' || peek().t === 'NOT' || peek().t === 'AND')) {
        if (peek().t === 'AND') next();
        left = { op: 'and', a: left, b: parseUnary(scope) };
      }
      return left;
    }
    function parseUnary(scope) {
      var token = peek();
      if (!token) throw new Error(T('表达式意外结束'));
      if (token.t === 'NOT') { next(); return { op: 'not', a: parseUnary(scope) }; }
      if (token.t === '(') {
        next();
        var inner = parseOr(scope);
        if (!peek() || peek().t !== ')') throw new Error(T('括号未闭合'));
        next();
        return inner;
      }
      // 跨层级组：ann(...) / note(...) —— 组内用组自己的字段表解析
      if (token.t === 'word' && (token.v === 'ann' || token.v === 'note' || token.v === 'attachment' || token.v === 'att')) {
        var groupKind = token.v;
        if (peek(1) && tokens[pos + 1] && tokens[pos + 1].t === '(') {
          next(); // ann / note
          next(); // (
            var groupScope = groupKind === 'ann' ? 'ann' : (groupKind === 'note' ? 'note' : 'attachment');
            var groupInner = parseOr(groupScope);
          if (!peek() || peek().t !== ')') throw new Error(T('括号未闭合（') + groupKind + T(' 组）'));
          next();
          return { op: groupKind === 'att' ? 'attachment' : groupKind, a: groupInner };
        }
      }
      if (token.t === 'word' || token.t === 'regex') { next(); return atomFromToken(token, scope); }
      throw new Error(T('无法解析的符号：') + (token.v || token.t));
    }
    var ast = parseOr('paper');
    if (pos < tokens.length) throw new Error(T('表达式尾部有多余内容'));
    return ast;
  }

  // field:value / field>=value / has:xxx / is:xxx / missing:xxx / 裸词；scope = paper|ann|note
  function atomFromToken(token, scope) {
    if (token.t === 'regex') {
      if (scope !== 'paper') throw new Error(T('组内暂不支持正则'));
      return { op: 'regex', source: token.v.source, re: token.v };
    }
    var word = token.v;
    var m = word.match(/^([A-Za-z]+)\s*(>=|<=|>|<|=|:)(.*)$/);
    if (m) {
      var fieldKey = m[1].toLowerCase();
      // 字段值允许成对引号包裹（folder:"名称" / tag:"深度学习"）
      var rawValue = m[3].replace(/^"(.*)"$/, '$1');
      if (fieldKey === 'has' || fieldKey === 'is') {
        if (scope !== 'paper') throw new Error(T('has:/is: 仅用于文献级条件'));
        return { op: 'flag', name: (m[2] === ':' ? m[3] : m[2] + m[3]).toLowerCase() };
      }
      if (fieldKey === 'missing') {
        var missingField = text(rawValue).toLowerCase();
        if (!missingField) throw new Error(T('missing: 缺少字段名'));
        if (scope !== 'paper') throw new Error(T('missing: 仅用于文献级条件'));
        return { op: 'missing', name: missingField };
      }
      if (scope === 'attachment') {
        var attachmentField = ATT_FIELD_ALIASES[fieldKey];
        if (!attachmentField) throw new Error(T('附件组不支持的字段：') + m[1] + T('（可用 kind name path zotero）'));
        if (m[2] !== ':' && m[2] !== '=') throw new Error(T('字段 ') + m[1] + T(' 只支持 : 匹配'));
        if (!rawValue) throw new Error(T('字段 ') + m[1] + T(' 缺少比较值'));
        return { op: 'field', field: attachmentField, value: normalizeForSearch(rawValue) };
      }
      // 跨层级组字段
      if (scope === 'ann') {
        var annField = ANN_FIELD_ALIASES[fieldKey];
        if (!annField) throw new Error(T('批注组不支持的字段：') + m[1] + T('（可用 text comment color page type tag）'));
        var annValue = rawValue;
        if (annValue === '') throw new Error(T('字段 ') + m[1] + T(' 缺少比较值'));
        if (ANN_NUMERIC[annField]) {
          var annNum = Number(annValue);
          if (!Number.isFinite(annNum)) throw new Error(T('字段 ') + m[1] + T(' 需要数字'));
          return { op: 'cmp', field: annField, cmp: m[2] === ':' ? ':' : m[2], value: annNum };
        }
        if (m[2] !== ':' && m[2] !== '=') throw new Error(T('字段 ') + m[1] + T(' 只支持 : 匹配'));
        return { op: 'field', field: annField, value: normalizeForSearch(annValue) };
      }
      if (scope === 'note') {
        var noteField = NOTE_FIELD_ALIASES[fieldKey];
        if (!noteField) throw new Error(T('笔记组不支持的字段：') + m[1] + T('（可用 title content format）'));
        if (m[2] !== ':' && m[2] !== '=') throw new Error(T('字段 ') + m[1] + T(' 只支持 : 匹配'));
        return { op: 'field', field: noteField, value: normalizeForSearch(rawValue) };
      }
      // 文献级字段
      if (DATE_FIELDS[fieldKey]) {
        var dateStart = parseDateValue(rawValue);
        if (dateStart == null) throw new Error(T('字段 ') + m[1] + T(' 需要日期（YYYY[-MM[-DD]]）'));
        return { op: 'datecmp', field: DATE_FIELDS[fieldKey], cmp: m[2] === ':' ? '=' : m[2], value: dateStart };
      }
      if (fieldKey === 'folder') {
        if (m[2] !== ':' && m[2] !== '=') throw new Error(T('字段 folder 只支持 : 匹配'));
        return { op: 'folder', value: normalizeForSearch(rawValue) };
      }
      if (fieldKey === 'folderid') {
        if (m[2] !== ':' && m[2] !== '=') throw new Error(T('字段 folderid 只支持 : 匹配'));
        if (!rawValue) throw new Error(T('folderid: 缺少文件夹 ID'));
        return { op: 'folder', id: rawValue };
      }
      if (COUNT_FIELDS[fieldKey] && !(fieldKey === 'notes' && m[2] === ':')) {
        if (m[2] === ':') throw new Error(T('数量字段 ') + m[1] + T(' 需要比较运算符'));
        var count = Number(rawValue);
        if (!Number.isFinite(count) || count < 0) throw new Error(T('数量字段 ') + m[1] + T(' 需要非负整数'));
        return { op: 'count', field: COUNT_FIELDS[fieldKey], cmp: m[2], value: Math.trunc(count) };
      }
      var field = FIELD_ALIASES[fieldKey];
      if (field) {
        var value = field === 'doi' ? doiSearchValue(rawValue) : rawValue;
        if (value === '') throw new Error(T('字段 ') + m[1] + T(' 缺少比较值'));
        var operator = m[2] === ':' ? ':' : m[2];
        if (NUMERIC_FIELDS[field]) {
          var num = Number(value);
          if (!Number.isFinite(num)) throw new Error(T('字段 ') + m[1] + T(' 需要数字'));
          return { op: 'cmp', field: field, cmp: operator, value: num };
        }
        if (operator !== ':' && operator !== '=') throw new Error(T('字段 ') + m[1] + T(' 只支持 : 匹配'));
        return { op: 'field', field: field, value: normalizeForSearch(value) };
      }
    }
    return { op: 'text', value: normalizeForSearch(word), exact: !!token.exact };
  }

  /* ---------- 版本化 AST ---------- */
  var AST_VERSION = 3;
  function parseAst(input) {
    var raw = String(input || '').trim();
    if (!raw) return { v: AST_VERSION, root: null };
    var lexed = tokenize(raw);
    if (lexed.error) return { v: AST_VERSION, root: null, error: lexed.error };
    if (!lexed.tokens.length) return { v: AST_VERSION, root: null };
    try {
      return { v: AST_VERSION, root: parseTokens(lexed.tokens) };
    } catch (e) {
      return { v: AST_VERSION, root: null, error: e.message };
    }
  }
  function reviveAst(ast) {
    // JSON 解析后正则节点丢失 RegExp 对象 → 重建；返回可求值 root
    function walk(node) {
      if (!node || typeof node !== 'object') return node;
      if (node.op === 'regex' && !(node.re instanceof RegExp)) {
        var source = typeof node.source === 'string' ? node.source
          : (node.re && typeof node.re.source === 'string' ? node.re.source : null);
        try { node.re = source == null ? /$^/ : new RegExp(source, 'i'); } catch (e) { node.re = /$^/; }
      }
      walk(node.a); walk(node.b);
      return node;
    }
    return walk(ast && ast.root);
  }
  function serializeAst(ast) {
    return JSON.stringify(ast && ast.root ? { v: AST_VERSION, root: ast.root } : { v: AST_VERSION, root: null },
      function (_key, value) { return value instanceof RegExp ? undefined : value; });
  }

  function repairLegacyRegexAst(ast, query) {
    function missingSource(node) {
      if (!node || typeof node !== 'object') return false;
      if (node.op === 'regex' && typeof node.source !== 'string' &&
          !(node.re && typeof node.re.source === 'string')) return true;
      return missingSource(node.a) || missingSource(node.b);
    }
    if (!ast || !missingSource(ast.root)) return ast;
    var reparsed = parseAst(query);
    return reparsed.error || !reparsed.root ? ast : reparsed;
  }

  function astToText(ast) {
    var root = ast && ast.root;
    if (!root) return '';
    function precedence(node) {
      return node.op === 'or' ? 1 : node.op === 'and' ? 2 : node.op === 'not' ? 3 : 4;
    }
    function walk(node, parentPrecedence) {
      if (!node) return '';
      var result = '';
      switch (node.op) {
        case 'and': result = walk(node.a, 2) + ' ' + walk(node.b, 2); break;
        case 'or': result = walk(node.a, 1) + ' OR ' + walk(node.b, 1); break;
        case 'not': result = 'NOT ' + walk(node.a, 3); break;
        case 'text': result = /\s/.test(node.value) ? '"' + node.value + '"' : node.value; break;
        case 'regex': result = '/' + (node.re instanceof RegExp ? node.re.source : node.source || '') + '/'; break;
        case 'field': result = node.field + ':"' + node.value + '"'; break;
        case 'cmp': result = node.field + node.cmp + node.value; break;
        case 'datecmp': result = node.field + node.cmp + new Date(node.value).toISOString().slice(0, 10); break;
        case 'flag': result = 'has:' + node.name; break;
        case 'missing': result = 'missing:' + node.name; break;
        case 'folder': result = node.id ? 'folderid:' + node.id : 'folder:"' + node.value + '"'; break;
        case 'ann': result = 'ann(' + walk(node.a, 0) + ')'; break;
        case 'note': result = 'note(' + walk(node.a, 0) + ')'; break;
        case 'attachment': result = 'attachment(' + walk(node.a, 0) + ')'; break;
        case 'count': result = node.field + node.cmp + node.value; break;
        default: return '';
      }
      return precedence(node) < parentPrecedence ? '(' + result + ')' : result;
    }
    return walk(root, 0);
  }

  // ---------- 求值 ----------
  var TEXT_HAY_FIELDS = ['key', 'title', 'authors', 'venue', 'abstract', 'notes', 'tags'];
  /* 缓存硬约束（本节三条缓存共用）：① 键 = id+updatedAt 依赖「改内容必抬 updatedAt」不变量
   * （lastReadAt 不进 haystack 字段，不受影响）；值内存 paper 引用，同 id 同版本的另一实例不串缓存。
   * ② notes 非文献自身字段，按「活跃笔记引用 + 各自 updatedAt 的有序快照」校验——编辑较早笔记、
   * 换引用、换序都会失效，重建 notesByPaper（笔记引用不变）照常命中。③ save 落库调 clearHaystackCache() 兜底清空。 */
  // 万级文献库一次全文搜索就会写满缓存：容量按规模放大，淘汰改为逐条最旧先出，
  // 不再用「超限即整表清空」——那会让同一次遍历的后半程全部 miss、下一次搜索重建一半。
  var HAY_CACHE_MAX = 20000;
  function notesSigOf(list) {
    if (list == null) return null; // null = 无笔记上下文（区别于「有上下文但活跃笔记为空」的 []）
    var sig = [];
    for (var i = 0; i < list.length; i++) {
      sig.push({ ref: list[i], updatedAt: (list[i] && list[i].updatedAt) || 0 });
    }
    return sig;
  }
  function notesSigMatch(stored, list) {
    if (stored == null && list == null) return true;   // 两边都无 notes 上下文
    if (!stored || !list || stored.length !== list.length) return false;
    for (var i = 0; i < stored.length; i++) {
      var n = list[i];
      if (!n || stored[i].ref !== n || stored[i].updatedAt !== (n.updatedAt || 0)) return false;
    }
    return true;
  }
  function cacheGet(store, key) {
    if (store.get) {
      var v = store.get(key);
      return v === undefined ? null : v; // 空串是合法缓存值（全空字段），不能用真值判断
    }
    return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
  }
  function cachePut(store, key, value, max) {
    if (store.set) {
      if (store.size >= max) {
        var oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      store.set(key, value);
    } else store[key] = value;
  }
  var hayCache = new (typeof Map !== 'undefined' ? Map : Object)();
  function buildHaystackValue(target, fields) {
    return normalizeForSearch(fields.map(function (f) {
      var v = target[f];
      return Array.isArray(v) ? v.join(' ') : text(v);
    }).join(' '));
  }
  function haystack(paper, fields, useCache) {
    var cacheable = !!(useCache && paper.id && paper.updatedAt != null);
    var key = cacheable ? paper.id + ':' + (paper.updatedAt || 0) : null;
    if (key != null) {
      var hit = cacheGet(hayCache, key);
      if (hit !== null && hit.paperRef === paper) return hit.value;
    }
    var value = buildHaystackValue(paper, fields);
    if (key != null) cachePut(hayCache, key, { paperRef: paper, value: value }, HAY_CACHE_MAX);
    return value;
  }
  /* AST text 条件的 notes 投影 haystack（ctx.notesByPaper 存在时）：
   * 独立缓存 + notes 签名，避免每次条件求值都克隆 paper 并重拼全部笔记。 */
  var notesHayCache = new (typeof Map !== 'undefined' ? Map : Object)();
  function projectedHaystack(paper, ctx) {
    var list = (ctx.notesByPaper && ctx.notesByPaper[paper.id]) || [];
    var key = paper.id && paper.updatedAt != null
      ? paper.id + ':' + (paper.updatedAt || 0) : null;
    if (key != null) {
      var hit = cacheGet(notesHayCache, key);
      if (hit !== null && hit.paperRef === paper && notesSigMatch(hit.notesSig, list)) return hit.value;
    }
    var value = buildHaystackValue(Object.assign({}, paper, { notes: noteSearchText(paper, ctx) }), TEXT_HAY_FIELDS);
    if (key != null) cachePut(notesHayCache, key, { paperRef: paper, notesSig: notesSigOf(list), value: value }, HAY_CACHE_MAX);
    return value;
  }
  /** 正则专用：原始（未规范化）小写 haystack —— 正则不做 Unicode 折叠，模式与原文字符对应 */
  function rawHaystack(paper, fields) {
    return fields.map(function (f) {
      var v = paper[f];
      return Array.isArray(v) ? v.join(' ') : text(v);
    }).join(' ').toLowerCase();
  }
  function clearHaystackCache() {
    if (hayCache.clear) hayCache.clear(); else hayCache = {};
    if (notesHayCache.clear) notesHayCache.clear(); else notesHayCache = {};
    if (plainFieldCache.clear) plainFieldCache.clear(); else plainFieldCache = {};
  }

  /* 普通关键词检索的相关度层：布尔命中语义仍是「所有词可分布在任意元数据字段」，
   * 这里只根据命中字段给结果排序，并返回一段可解释的上下文。高级语法不走此层。 */
  var PLAIN_SEARCH_FIELDS = [
    { key: 'title', weight: 50 },
    { key: 'tags', weight: 30 },
    { key: 'key', weight: 24 },
    { key: 'authors', weight: 20 },
    { key: 'venue', weight: 18 },
    { key: 'abstract', weight: 8 },
    { key: 'notes', weight: 6 }
  ];

  function plainSearchTerms(input) {
    // 查询词纯粹由输入串决定：按「上一次输入」记忆，避免逐篇文献重复规范化查询本身
    if (plainTermsMemo.terms && plainTermsMemo.input === input) return plainTermsMemo.terms;
    var normalized = normalizeForSearch(input).trim();
    if (!normalized) { plainTermsMemo = { input: input, terms: [] }; return []; }
    var seen = {};
    var terms = normalized.split(/\s+/).filter(function (term) {
      if (!term || seen[term]) return false;
      seen[term] = true;
      return true;
    });
    plainTermsMemo = { input: input, terms: terms };
    return terms;
  }

  function plainFieldText(paper, key) {
    var value = paper && paper[key];
    return Array.isArray(value) ? value.join(' ') : text(value);
  }

  function plainMatchSnippet(value, terms, maxLength) {
    var raw = text(value).replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    var normalized = normalizeForSearch(raw);
    var at = -1;
    var phrase = terms.join(' ');
    if (phrase) at = normalized.indexOf(phrase);
    if (at < 0) {
      terms.forEach(function (term) {
        var pos = normalized.indexOf(term);
        if (pos >= 0 && (at < 0 || pos < at)) at = pos;
      });
    }
    if (at < 0) at = 0;
    var cap = Math.max(60, Number(maxLength) || 180);
    var start = Math.max(0, at - 48);
    var end = Math.min(raw.length, start + cap);
    if (end - start < cap && start > 0) start = Math.max(0, end - cap);
    return (start > 0 ? '…' : '') + raw.slice(start, end) + (end < raw.length ? '…' : '');
  }

  /* 普通关键词检索的逐字段规范化缓存（按篇一条记录）：键 = id+updatedAt + paper 引用，
   * notes 另带引用快照签名（契约见上）。记录只读——score 等查询相关量不写入；raw 供命中说明取用。 */
  var plainFieldCache = new (typeof Map !== 'undefined' ? Map : Object)();
  var plainTermsMemo = { input: null, terms: null };
  function plainFieldValues(paper, ctx) {
    var hasNotesCtx = !!(ctx && (ctx.notesByPaper || Array.isArray(ctx.notes)));
    var notesList = hasNotesCtx ? activeNotesFor(paper, ctx) : null; // null = 无笔记上下文（投影用 paper.notes）
    var key = paper && paper.id && paper.updatedAt != null
      ? paper.id + ':' + (paper.updatedAt || 0) : null;
    var rec = key != null ? cacheGet(plainFieldCache, key) : null;
    if (rec && rec.paperRef === paper && notesSigMatch(rec.notesSig, notesList)) return rec.values;
    var samePaper = !!(rec && rec.paperRef === paper);
    var values = samePaper ? rec.values : {};
    PLAIN_SEARCH_FIELDS.forEach(function (spec) {
      if (samePaper && spec.key !== 'notes') return; // 记录其余字段仍有效，只重算 notes
      var raw = spec.key === 'notes'
        ? (notesList
          ? notesList.map(function (n) { return text(n.title) + ' ' + text(n.content); }).join(' ')
          : text(paper && paper.notes))
        : plainFieldText(paper, spec.key);
      values[spec.key] = { raw: raw, normalized: normalizeForSearch(raw) };
    });
    if (samePaper) rec.notesSig = notesSigOf(notesList);
    else if (key != null) {
      cachePut(plainFieldCache, key,
        { paperRef: paper, notesSig: notesSigOf(notesList), values: values }, HAY_CACHE_MAX);
    }
    return values;
  }

  /**
   * 普通关键词查询 → {matched, score, field, snippet, fields}。
   * 标题 > 标签/标识 > 作者/期刊 > 摘要 > 笔记；同字段完整短语另加权。
   */
  function rankPlainText(paper, input, ctx) {
    var terms = plainSearchTerms(input);
    if (!terms.length) return { matched: true, score: 0, field: '', snippet: '', fields: [] };
    var values = plainFieldValues(paper, ctx);
    var all = '';
    PLAIN_SEARCH_FIELDS.forEach(function (spec) { all += ' ' + values[spec.key].normalized; });
    var matched = terms.every(function (term) { return all.indexOf(term) !== -1; });
    if (!matched) return { matched: false, score: 0, field: '', snippet: '', fields: [] };
    var phrase = terms.join(' ');
    var total = 0;
    var best = null;
    var bestComplete = null;
    var bestNonTitle = null;
    var matchedFields = [];
    PLAIN_SEARCH_FIELDS.forEach(function (spec) {
      var value = values[spec.key];
      var count = 0;
      terms.forEach(function (term) { if (value.normalized.indexOf(term) !== -1) count++; });
      if (!count) return;
      var score = count * spec.weight;
      if (terms.length > 1 && value.normalized.indexOf(phrase) !== -1) score += spec.weight * 2;
      total += score;
      matchedFields.push(spec.key);
      var candidate = { key: spec.key, raw: value.raw, score: score };
      if (!best || score > best.score) best = candidate;
      if (count === terms.length && (!bestComplete || score > bestComplete.score)) bestComplete = candidate;
      if (spec.key !== 'title' && (!bestNonTitle || score > bestNonTitle.score)) bestNonTitle = candidate;
    });
    var explanation = bestComplete || (matchedFields.length > 1 && best && best.key === 'title' ? bestNonTitle : best);
    return {
      matched: true,
      score: total,
      field: explanation ? explanation.key : '',
      snippet: explanation ? plainMatchSnippet(explanation.raw, terms, 180) : '',
      fields: matchedFields
    };
  }

  function activeNotesFor(paper, ctx) {
    if (!paper || !ctx) return [];
    if (ctx.notesByPaper) return ctx.notesByPaper[paper.id] || [];
    if (Array.isArray(ctx.notes)) return ctx.notes.filter(function (note) {
      return note && !note.deletedAt && note.paperId === paper.id;
    });
    return [];
  }

  function noteSearchText(paper, ctx) {
    if (ctx && (ctx.notesByPaper || Array.isArray(ctx.notes))) {
      return activeNotesFor(paper, ctx).map(function (note) {
        return text(note.title) + ' ' + text(note.content);
      }).join(' ');
    }
    return text(paper && paper.notes);
  }

  function countValue(field, paper, ctx) {
    if (!paper) return 0;
    if (field === 'annotations') return (paper.pdfAnnotations || []).length;
    if (field === 'notes') return activeNotesFor(paper, ctx).length || (!ctx || !ctx.notesByPaper ? (paper.notes ? 1 : 0) : 0);
    if (field === 'attachments') return (paper.attachments || []).filter(function (a) { return !!(a.path || a.cloudName); }).length;
    if (field === 'pdfs') return (paper.attachments || []).filter(function (a) {
      return a.kind === 'pdf' && !!(a.path || a.cloudName);
    }).length;
    return 0;
  }

  function compareNumber(actual, cmp, expected) {
    switch (cmp) {
      case ':': case '=': return actual === expected;
      case '>': return actual > expected;
      case '<': return actual < expected;
      case '>=': return actual >= expected;
      case '<=': return actual <= expected;
      default: return false;
    }
  }

  function flagMatch(name, paper, ctx) {
    if (!paper) return false;
    switch (name) {
      case 'pdf': return !!(paper.pdfPath || paper.pdfFileName || paper.pdfCloudName ||
        (paper.attachments || []).some(function (a) { return a.kind === 'pdf' && (a.path || a.cloudName); }));
      case 'epub': return (paper.attachments || []).some(function (a) { return a.kind === 'epub' && (a.path || a.cloudName); });
      case 'snapshot': return (paper.attachments || []).some(function (a) { return a.kind === 'snapshot' && (a.path || a.cloudName); });
      case 'supp': return (paper.attachments || []).some(function (a) { return a.kind === 'supp' && (a.path || a.cloudName); });
      case 'attachment': case 'attachments': return (paper.attachments || []).some(function (a) { return a.path || a.cloudName; });
      case 'notes': return countValue('notes', paper, ctx) > 0;
      case 'doi': return !!paper.doi;
      case 'abstract': return !!paper.abstract;
      case 'annotations': return !!(paper.pdfAnnotations && paper.pdfAnnotations.length);
      case 'unread': case 'reading': return paper.status === name;
      case 'read': return paper.status === 'reading' || paper.status === 'read'; // 兼容旧智能文件夹
      case 'trash': case 'trashed': case 'deleted': return !!paper.deletedAt;
      default: return false;
    }
  }
  function fieldPresent(field, paper, ctx) {
    if (!paper) return false;
    if (field === 'pdf') return flagMatch('pdf', paper);
    if (field === 'epub') return flagMatch('epub', paper);
    if (field === 'snapshot') return flagMatch('snapshot', paper);
    if (field === 'attachment' || field === 'attachments') return flagMatch('attachment', paper);
    if (field === 'notes') return flagMatch('notes', paper, ctx);
    if (field === 'doi') return flagMatch('doi', paper);
    if (field === 'abstract') return flagMatch('abstract', paper);
    if (field === 'annotations') return flagMatch('annotations', paper);
    if (field === 'lastread') return paper.lastReadAt != null;
    var v = paper[FIELD_ALIASES[field] || field];
    if (Array.isArray(v)) return v.length > 0;
    return v != null && text(v).trim() !== '';
  }

  function folderIdSetByName(folders, name) {
    var targets = (folders || []).filter(function (f) { return normalizeForSearch(f.name) === name; });
    if (!targets.length) return null;
    var set = {};
    var walk = function (id) {
      if (set[id]) return;
      set[id] = true;
      (folders || []).forEach(function (f) { if (f.parentId === id) walk(f.id); });
    };
    targets.forEach(function (target) { walk(target.id); });
    return set;
  }

  function compileNode(node, paper, ctx, scope) {
    if (!paper) return false; // 主题笔记等无 paper 场景：paper 级条件一律 false，防空引用（F07）
    switch (node.op) {
      case 'and': return compileNode(node.a, paper, ctx, scope) && compileNode(node.b, paper, ctx, scope);
      case 'or': return compileNode(node.a, paper, ctx, scope) || compileNode(node.b, paper, ctx, scope);
      case 'not': return !compileNode(node.a, paper, ctx, scope);
      case 'text': {
        var fields = scope === 'ann' ? ['text', 'comment']
          : scope === 'note' ? ['title', 'content']
            : scope === 'attachment' ? ['fileName', 'path', 'kind', 'zoteroKey']
          : TEXT_HAY_FIELDS;
        if (scope === 'paper' && ctx && ctx.notesByPaper) {
          // notes 投影走独立缓存：缓存命中时不再克隆 paper / 重拼笔记
          return projectedHaystack(paper, ctx).indexOf(node.value) !== -1;
        }
        return haystack(paper, fields, scope === 'paper').indexOf(node.value) !== -1;
      }
      case 'regex': {
        try {
          var regexTarget = scope === 'paper' && ctx && ctx.notesByPaper
            ? Object.assign({}, paper, { notes: noteSearchText(paper, ctx) }) : paper;
          return node.re.test(rawHaystack(regexTarget, TEXT_HAY_FIELDS));
        } catch (e) { return false; }
      }
      case 'field': {
        if (node.field === 'tags') {
          return (paper.tags || []).some(function (tag) { return normalizeForSearch(tag) === node.value; });
        }
        if (node.field === 'status') {
          return normalizeForSearch(paper.status) === node.value ||
            (node.value === 'read' && paper.status === 'reading');
        }
        if (node.field === 'color') { // ann 组
          return normalizeForSearch(paper.color) === node.value;
        }
        if (node.field === 'type') {
          return normalizeForSearch(paper.type) === node.value;
        }
        if (node.field === 'format') {
          return normalizeForSearch(paper.format) === node.value;
        }
        var v = node.field === 'notes' ? noteSearchText(paper, ctx) : paper[node.field];
        if (Array.isArray(v)) v = v.join(' ');
        return normalizeForSearch(v).indexOf(node.value) !== -1;
      }
      case 'cmp': {
        var actual = node.field === 'page' ? (paper.position ? paper.position.pageIndex + 1 : null) : paper[node.field];
        if (actual == null || !Number.isFinite(Number(actual))) return false;
        actual = Number(actual);
        switch (node.cmp) {
          case ':': case '=': return actual === node.value;
          case '>': return actual > node.value;
          case '<': return actual < node.value;
          case '>=': return actual >= node.value;
          case '<=': return actual <= node.value;
          default: return false;
        }
      }
      case 'count': return compareNumber(countValue(node.field, paper, ctx), node.cmp, node.value);
      case 'datecmp': {
        var at = paper[node.field];
        if (at == null) return false;
        at = Number(at);
        switch (node.cmp) {
          case ':': case '=': return at >= node.value && at < dayEnd(node.value);
          case '>': return at >= dayEnd(node.value);
          case '<': return at < node.value;
          case '>=': return at >= node.value;
          case '<=': return at < dayEnd(node.value);
          default: return false;
        }
      }
      case 'folder': {
        if (!ctx.folders) return false;
        var folderKey = node.id ? 'id:' + node.id : 'name:' + node.value;
        var set = ctx.__folderCache && ctx.__folderCache[folderKey];
        if (set === undefined) {
          ctx.__folderCache = ctx.__folderCache || {};
          if (node.id) {
            set = {};
            var root = ctx.folders.find(function (folder) { return folder.id === node.id; });
            if (root) {
              (function walk(id) {
                if (set[id]) return;
                set[id] = true;
                ctx.folders.forEach(function (folder) { if (folder.parentId === id) walk(folder.id); });
              })(root.id);
            } else set = false;
          } else set = folderIdSetByName(ctx.folders, node.value) || false;
          ctx.__folderCache[folderKey] = set;
        }
        if (!set) return false;
        return (paper.folderIds || []).some(function (id) { return set[id]; });
      }
      case 'flag': return scope === 'paper' && flagMatch(node.name, paper, ctx);
      case 'missing': return scope === 'paper' && !fieldPresent(node.name, paper, ctx);
      case 'ann': {
        var annotations = paper.pdfAnnotations || [];
        for (var i = 0; i < annotations.length; i++) {
          if (compileNode(node.a, annotations[i], ctx, 'ann')) return true;
        }
        return false;
      }
      case 'note': {
        var notes = ctx.notesByPaper ? ctx.notesByPaper[paper.id] : null;
        if (!notes) return false;
        for (var n = 0; n < notes.length; n++) {
          if (compileNode(node.a, notes[n], ctx, 'note')) return true;
        }
        return false;
      }
      case 'attachment': {
        var attachments = paper.attachments || [];
        for (var a = 0; a < attachments.length; a++) {
          if (compileNode(node.a, attachments[a], ctx, 'attachment')) return true;
        }
        return false;
      }
      default: return false;
    }
  }

  /**
   * 编译 AST（或查询串）→ matcher(paper)。
   * ctx = { notes, folders }（notes 为活的笔记集合；跨层级 note() 需要）
   */
  function compile(astOrText, ctx) {
    var root;
    if (typeof astOrText === 'string') {
      var parsed = parseAst(astOrText);
      if (parsed.error) return { matcher: null, error: parsed.error };
      root = parsed.root;
    } else if (astOrText && typeof astOrText === 'object') {
      root = astOrText.root !== undefined ? astOrText.root : astOrText; // 兼容裸 root
      root = reviveAst({ root: root });
    } else {
      root = null;
    }
    var context = ctx || {};
    if (Array.isArray(context.notes) && !context.notesByPaper) {
      var byPaper = {};
      context.notes.forEach(function (note) {
        if (!note || note.deletedAt || !note.paperId) return;
        (byPaper[note.paperId] = byPaper[note.paperId] || []).push(note);
      });
      context = { notes: context.notes, folders: context.folders, notesByPaper: byPaper };
    }
    if (!root) return { matcher: function () { return true; }, error: null };
    return { matcher: function (paper) { return compileNode(root, paper, context, 'paper'); }, error: null };
  }

  /** 兼容包装：parse(query) → { matcher, error, ast } */
  function parse(input, ctx) {
    var raw = String(input || '').trim();
    if (!raw) return { matcher: function () { return true; }, error: null, ast: { v: AST_VERSION, root: null } };
    var ast = parseAst(raw);
    if (ast.error || !ast.root) return { matcher: null, error: ast.error || null, ast: ast };
    var compiled = compile(ast, ctx || null);
    return { matcher: compiled.matcher, error: compiled.error, ast: ast };
  }

  /** 是否为"纯裸词"查询（不需要高级语法时可走老路径） */
  function isPlainText(input) {
    var value = String(input || '');
    return !(/[()"/!]|\bAND\b|\bOR\b|\bNOT\b|[A-Za-z]+\s*(>=|<=|>|<|=|:)/.test(value) ||
      /(?:^|\s)-(?=\S)/.test(value));
  }

  /**
   * 阶段四余项：可视化构建器的行 → 查询文本（与文本语法同源，生成后仍走 parseAst 求值）。
    * rows = [{ join:'AND'|'OR', kind:'field'|'flag'|'missing'|'text'|'ann'|'note'|'attachment'|'count',
   *           field, cmp, value }]
   * 首行 join 忽略；kind=ann/note 时 value 为组内条件文本。
   */
  function rowsToText(rows) {
    var parts = [];
    (rows || []).forEach(function (row, index) {
      if (!row) return;
      var text = '';
      if (row.kind === 'flag') {
        if (!row.value) return;
        text = 'has:' + String(row.value).trim().toLowerCase();
      } else if (row.kind === 'missing') {
        if (!row.field) return;
        text = 'missing:' + String(row.field).trim().toLowerCase();
      } else if (row.kind === 'text') {
        if (!row.value) return;
        text = /\s/.test(row.value) ? '"' + row.value + '"' : String(row.value);
      } else if (row.kind === 'ann' || row.kind === 'note') {
        if (!row.value) return;
        text = row.kind + '(' + String(row.value) + ')';
      } else if (row.kind === 'attachment') {
        if (!row.value) return;
        text = 'attachment(' + String(row.value) + ')';
      } else if (row.kind === 'count') {
        if (!row.field || !row.value) return;
        text = String(row.field).trim().toLowerCase() + (row.cmp || '>=') + String(row.value).trim();
      } else {
        if (!row.field) return;
        var field = String(row.field).trim();
        var cmp = row.cmp || ':';
        var value = String(row.value == null ? '' : row.value).trim();
        if (!value) return;
        text = (cmp === ':' && /[\s()]/.test(value)) ? field + ':"' + value + '"' : field + cmp + value;
      }
      if (!text) return;
      if (!parts.length) parts.push(text);
      else parts.push((row.join === 'OR' ? ' OR ' : ' ') + text);
    });
    return parts.join('');
  }

  function entityContextText(entity, scope) {
    if (scope === 'annotation') return [entity.text, entity.comment, entity.type, (entity.tags || []).join(' ')].join(' ');
    if (scope === 'note') return [entity.title, entity.content].join(' ');
    if (scope === 'attachment') return [entity.fileName, entity.path, entity.kind, entity.zoteroKey].join(' ');
    return [entity.title, entity.abstract, entity.notes, (entity.tags || []).join(' ')].join(' ');
  }

  /**
   * 实体命中求值（F07 修正）：
   * - paper 级条件（组外 text/field/cmp/flag/...）始终对 paper 求值，不错配到批注/笔记对象上
   * - ann()/note()/attachment() 组在 paper 层为独立 ∃（compileNode 原生语义），在实体层按「实体满足任一组」列出
   * - 主题笔记（paper=null）：整条查询以 note 实体求值（纯文本可命中，paper 级字段自然不命中）
   */
  function collectPositiveTargets(node, groupOp, out) {
    if (!node) return out;
    if (node.op === 'and' || node.op === 'or') {
      collectPositiveTargets(node.a, groupOp, out);
      collectPositiveTargets(node.b, groupOp, out);
      return out;
    }
    if (node.op === 'not') {
      // 否定分支内的条件不是正向筛选实体的依据（例如 NOT ann(color:#000000)）
      return out;
    }
    if (node.op === groupOp) {
      out.push({ kind: 'group', node: node.a });
      return out;
    }
    if (node.op === 'text' || node.op === 'regex') {
      out.push({ kind: 'text', node: node });
      return out;
    }
    return out;
  }

  function groupTermsMatch(node, entity, ctx, entityScope) {
    if (!node) return true;
    if (node.op === 'and') return groupTermsMatch(node.a, entity, ctx, entityScope) && groupTermsMatch(node.b, entity, ctx, entityScope);
    if (node.op === 'or') return groupTermsMatch(node.a, entity, ctx, entityScope) || groupTermsMatch(node.b, entity, ctx, entityScope);
    if (node.op === 'not') return !groupTermsMatch(node.a, entity, ctx, entityScope);
    return compileNode(node, entity, ctx, entityScope);
  }

  function compilePaperForEntitySearch(node, paper, ctx, scope) {
    if (!node) return true;
    if (node.op === 'and') return compilePaperForEntitySearch(node.a, paper, ctx, scope) && compilePaperForEntitySearch(node.b, paper, ctx, scope);
    if (node.op === 'or') return compilePaperForEntitySearch(node.a, paper, ctx, scope) || compilePaperForEntitySearch(node.b, paper, ctx, scope);
    if (node.op === 'not') return !compilePaperForEntitySearch(node.a, paper, ctx, scope);
    if (node.op === 'text') {
      if (compileNode(node, paper, ctx, 'paper')) return true;
      if (scope === 'annotation') {
        return (paper.pdfAnnotations || []).some(function (a) { return compileNode(node, a, ctx, 'ann'); });
      }
      if (scope === 'note') {
        var notes = activeNotesFor(paper, ctx);
        return notes.some(function (n) { return compileNode(node, n, ctx, 'note'); });
      }
      if (scope === 'attachment') {
        return (paper.attachments || []).some(function (att) { return compileNode(node, att, ctx, 'attachment'); });
      }
      return false;
    }
    return compileNode(node, paper, ctx, 'paper');
  }

  function compileTopicNote(node, note, ctx) {
    if (!node || !note) return false;
    switch (node.op) {
      case 'and': return compileTopicNote(node.a, note, ctx) && compileTopicNote(node.b, note, ctx);
      case 'or': return compileTopicNote(node.a, note, ctx) || compileTopicNote(node.b, note, ctx);
      case 'not': return !compileTopicNote(node.a, note, ctx);
      case 'note': return compileNode(node.a, note, ctx, 'note');
      case 'text': return compileNode(node, note, ctx, 'note');
      case 'regex': {
        try { return node.re.test(((note.title || '') + ' ' + (note.content || '')).toLowerCase()); }
        catch (e) { return false; }
      }
      case 'field': {
        var f = NOTE_FIELD_ALIASES[node.field] || node.field;
        if (f === 'title' || f === 'content' || f === 'format') {
          return normalizeForSearch(note[f]).indexOf(node.value) !== -1;
        }
        if (f === 'tags') {
          return (note.tags || []).some(function (tag) { return normalizeForSearch(tag) === node.value; });
        }
        return false;
      }
      default: return false;
    }
  }

  /**
   * Return stable, navigable entity hits for the same AST used by paper search.
   * Each hit has entityId/paperId/attachmentId, context text, and a target.
   */
  function entityHits(astOrText, workspace, options) {
    options = options || {};
    var parts = workspace && typeof workspace === 'object' ? workspace : {};
    var papers = Array.isArray(parts.papers) ? parts.papers : [];
    var ctx = { notes: Array.isArray(parts.notes) ? parts.notes : [], folders: parts.folders || [], notesByPaper: {} };
    ctx.notes.forEach(function (note) {
      if (!note || note.deletedAt || !note.paperId) return;
      (ctx.notesByPaper[note.paperId] = ctx.notesByPaper[note.paperId] || []).push(note);
    });
    var parsed = typeof astOrText === 'string' ? parseAst(astOrText) : null;
    if (parsed && parsed.error) return [];
    var root = astOrText && typeof astOrText === 'object' && astOrText.root !== undefined
      ? reviveAst(astOrText) : (parsed ? parsed.root : astOrText);
    var scope = String(options.scope || 'annotation').toLowerCase();
    var groupOp = scope === 'annotation' ? 'ann' : scope === 'note' ? 'note' : scope === 'attachment' ? 'attachment' : null;
    var positiveTargets = groupOp && root ? collectPositiveTargets(root, groupOp, []) : [];
    var entityScope = scope === 'annotation' ? 'ann' : scope;
    var result = [];
    papers.forEach(function (paper) {
      if (!paper || paper.deletedAt) return;
      var list = scope === 'annotation' ? (paper.pdfAnnotations || [])
        : scope === 'attachment' ? (paper.attachments || [])
          : scope === 'note' ? ((ctx.notesByPaper && ctx.notesByPaper[paper.id]) || []) : [paper];
      // paper 级匹配：整条查询对 paper 求值（文本条件可由实体下钻命中）
      var paperOk = !root || compilePaperForEntitySearch(root, paper, ctx, scope);
      if (!paperOk) return;
      list.forEach(function (entity) {
        var entityOk = true;
        if (positiveTargets.length) {
          entityOk = positiveTargets.some(function (t) {
            if (t.kind === 'group') return groupTermsMatch(t.node, entity, ctx, entityScope);
            if (t.kind === 'text') return compileNode(t.node, entity, ctx, entityScope);
            return false;
          });
        }
        if (!entityOk) return;
        var entityId = scope === 'paper' ? paper.id : entity.id;
        var attachmentId = scope === 'attachment' ? entity.id : (entity.attachmentId || '');
        var target = { paperId: paper.id, attachmentId: attachmentId };
        if (scope === 'annotation') {
          target.annotationId = entity.id;
          target.page = entity.position && entity.position.pageIndex != null ? entity.position.pageIndex + 1 : 0;
          if (entity.position && entity.position.cfi) target.epubcfi = entity.position.cfi; // EPUB 批注定位（F05）
        }
        result.push({ entityId: entityId, entityType: scope, paperId: paper.id,
          attachmentId: attachmentId, context: entityContextText(entity, scope), entity: entity, target: target });
      });
    });
    if (scope === 'note') {
      ctx.notes.filter(function (note) { return note && !note.deletedAt && !note.paperId; }).forEach(function (note) {
        var ok = !root || compileTopicNote(root, note, ctx);
        if (!ok) return;
        result.push({ entityId: note.id, entityType: scope, paperId: '', attachmentId: '',
          context: entityContextText(note, scope), entity: note,
          target: { paperId: '', attachmentId: '', noteId: note.id } });
      });
    }
    return result;
  }

  function searchEntities(astOrText, workspace, options) {
    options = options || {};
    var parsed = typeof astOrText === 'string' ? parseAst(astOrText) : null;
    if (parsed && parsed.error) return { total: 0, page: 0, pageSize: 0, items: [], error: parsed.error };
    var all = entityHits(parsed || astOrText, workspace, options);
    var pageSize = Number(options.pageSize);
    pageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : all.length || 1;
    var page = Number(options.page);
    page = Number.isFinite(page) && page >= 0 ? Math.trunc(page) : 0;
    return { total: all.length, page: page, pageSize: pageSize, items: all.slice(page * pageSize, (page + 1) * pageSize) };
  }

  return {
    AST_VERSION: AST_VERSION,
    parse: parse,
    parseAst: parseAst,
    compile: compile,
    serializeAst: serializeAst,
    repairLegacyRegexAst: repairLegacyRegexAst,
    astToText: astToText,
    reviveAst: reviveAst,
    normalizeForSearch: normalizeForSearch,
    rankPlainText: rankPlainText,
    clearHaystackCache: clearHaystackCache,
    rowsToText: rowsToText,
    entityHits: entityHits,
    searchEntities: searchEntities,
    isPlainText: isPlainText
  };
});
