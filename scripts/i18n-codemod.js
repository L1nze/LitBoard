#!/usr/bin/env node
'use strict';
/* i18n 迁移/维护工具：
 *   node scripts/i18n-codemod.js wrap  <files...>   把文件里的中文静态串包成 T('…')
 *   node scripts/i18n-codemod.js keys  <files...>   输出文件中全部 T('…') 键（JSON）
 *   node scripts/i18n-codemod.js html  <index.html> 输出静态 HTML 可翻译串（JSON）
 *
 * 包装规则：仅处理含 CJK 的单双引号串与无插值模板串；跳过注释、正则字面量、
 * 对象键（{ 'x': … }）、switch case、成员访问 obj['x']、已包装的 T('…')。
 * 修改后请对每个文件跑 node --check 验证语法。
 */
const fs = require('fs');

const CJK = /[\u4e00-\u9fff]/;
const IDENT = /[A-Za-z0-9_$]/;

function prevNonWs(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  return j;
}
function nextNonWs(src, i) {
  let j = i;
  while (j < src.length && /\s/.test(src[j])) j++;
  return j;
}
function prevWord(src, i) {
  let j = prevNonWs(src, i);
  if (j < 0 || !IDENT.test(src[j])) return '';
  let k = j;
  while (k >= 0 && IDENT.test(src[k])) k--;
  return src.slice(k + 1, j + 1);
}

/* 单文件扫描。返回 { edits, flags } */
function scanFile(src) {
  const edits = [];
  const flags = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let start2 = 0; // 当前串起始（供上下文判断）
  // 模板串 ${ } 嵌套扫描：返回结束索引（闭反引号后一位），并收集插值信息
  function scanTemplate(start) {
    let k = start + 1;
    let interpFound = false;
    while (k < n) {
      const ch = src[k];
      if (ch === '\\') { k += 2; continue; }
      if (ch === '\n') { line++; k++; continue; }
      if (ch === '`') return { end: k + 1, interp: interpFound };
      if (ch === '$' && src[k + 1] === '{') {
        // 进入插值：当作代码扫描到配对 }
        interpFound = true;
        let depth = 1;
        k += 2;
        while (k < n && depth > 0) {
          const c2 = src[k];
          if (c2 === "'" || c2 === '"') {
            const q = c2;
            k++;
            while (k < n && src[k] !== q) { if (src[k] === '\\') k++; if (src[k] === '\n') line++; k++; }
            k++;
            continue;
          }
          if (c2 === '`') { const sub = scanTemplate(k); k = sub.end; continue; }
          if (c2 === '{') { depth++; k++; continue; }
          if (c2 === '}') { depth--; k++; continue; }
          if (c2 === '\n') line++;
          k++;
        }
        continue;
      }
      k++;
    }
    return { end: n, interp: true };
  }
  function isMemberAccess(end) {
    // obj['k'] / obj[expr]：'[' 前是标识符、) 或 ]
    const j = prevNonWs(src, start2);
    if (j < 0 || src[j] !== '[') return false;
    const k = prevNonWs(src, j);
    if (k < 0) return false;
    return IDENT.test(src[k]) || src[k] === ')' || src[k] === ']';
  }
  function isObjKey(end) {
    const j = nextNonWs(src, end);
    if (j >= n || src[j] !== ':') return false;
    const p = prevNonWs(src, start2);
    return p >= 0 && (src[p] === '{' || src[p] === ',');
  }
  function isCaseLabel() {
    return prevWord(src, start2) === 'case';
  }
  function alreadyWrapped() {
    const j = prevNonWs(src, start2);
    return j >= 1 && src[j] === '(' && src[j - 1] === 'T' && (j - 2 < 0 || !IDENT.test(src[j - 2]));
  }

  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      start2 = i;
      const q = c;
      let k = i + 1;
      while (k < n && src[k] !== q) {
        if (src[k] === '\\') k++;
        if (src[k] === '\n') { flags.push({ line, type: 'unterminated', text: src.slice(i, i + 40) }); break; }
        k++;
      }
      const end = k + 1;
      const body = src.slice(i + 1, k);
      if (CJK.test(body)) {
        if (isMemberAccess()) { /* 跳过：数据键 */ }
        else if (isObjKey(end)) { flags.push({ line, type: 'objkey', text: body.slice(0, 40) }); }
        else if (isCaseLabel()) { flags.push({ line, type: 'case', text: body.slice(0, 40) }); }
        else if (alreadyWrapped()) { /* 幂等重跑 */ }
        else {
          edits.push({ start: i, end, text: 'T(' + src.slice(i, end) + ')' });
        }
      }
      i = end;
      continue;
    }
    if (c === '`') {
      start2 = i;
      const r = scanTemplate(i);
      const body = src.slice(i, r.end);
      if (CJK.test(body)) {
        if (r.interp) flags.push({ line, type: 'tpl-interp', text: body.replace(/\s+/g, ' ').slice(0, 60) });
        else if (!alreadyWrapped()) edits.push({ start: i, end: r.end, text: 'T(' + body + ')' });
      }
      i = r.end;
      continue;
    }
    if (c === '/') {
      // 正则还是除号：按前导记号启发式；扫描失败按除号处理
      const p = prevNonWs(src, i);
      const w = prevWord(src, i);
      const regexCtx = p < 0 || '([{,;=:?!&|+-*%^~<>'.indexOf(src[p]) !== -1 ||
        ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof', 'do', 'else', 'yield', 'await'].indexOf(w) !== -1;
      if (regexCtx) {
        let k = i + 1, inClass = false, ok = false;
        while (k < n) {
          const ch = src[k];
          if (ch === '\\') { k += 2; continue; }
          if (ch === '\n') break;
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) { ok = true; break; }
          k++;
        }
        if (ok) {
          k++;
          while (k < n && /[gimsuyvd]/.test(src[k])) k++;
          i = k;
          continue;
        }
      }
      i++;
      continue;
    }
    if (c === '\n') { line++; i++; continue; }
    i++;
  }
  return { edits, flags };
}

function applyWrap(file) {
  const src = fs.readFileSync(file, 'utf8');
  const { edits, flags } = scanFile(src, file);
  if (!edits.length && !flags.length) return { file, count: 0, flags: [] };
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  fs.writeFileSync(file, out);
  return { file, count: edits.length, flags };
}

function unescapeLiteral(body) {
  // JS 字符串字面量转义 → 实际值（支持 \n \t \r \b \f \v \0 \\ \' \" \` \$ \xXX \uXXXX 与行续接）
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { out += c; continue; }
    const d = body[++i];
    if (d === 'n') out += '\n';
    else if (d === 't') out += '\t';
    else if (d === 'r') out += '\r';
    else if (d === 'b') out += '\b';
    else if (d === 'f') out += '\f';
    else if (d === 'v') out += '\v';
    else if (d === '0') out += '\0';
    else if (d === 'x') { out += String.fromCharCode(parseInt(body.slice(i + 1, i + 3), 16)); i += 2; }
    else if (d === 'u') {
      if (body[i + 1] === '{') {
        const end = body.indexOf('}', i);
        out += String.fromCodePoint(parseInt(body.slice(i + 2, end), 16));
        i = end;
      } else { out += String.fromCharCode(parseInt(body.slice(i + 1, i + 5), 16)); i += 4; }
    } else if (d === '\n') { /* 行续接 */ }
    else out += d; // \\ \' \" \` \$ 及其他
  }
  return out;
}

function extractKeys(file) {
  const src = fs.readFileSync(file, 'utf8');
  const keys = new Set();
  const re = /\bT\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|(`(?:[^`\\]|\\.)*`))/g;
  let m;
  while ((m = re.exec(src))) {
    const body = m[1] != null ? m[1] : m[2] != null ? m[2] : m[3].slice(1, -1);
    keys.add(unescapeLiteral(body));
  }
  return keys;
}

function htmlKeys(file) {
  const src = fs.readFileSync(file, 'utf8');
  const keys = new Set();
  // 文本节点：>…中文…<
  let re = />([^<>]*[\u4e00-\u9fff][^<>]*)</g;
  let m;
  while ((m = re.exec(src))) {
    const t = m[1].trim();
    if (t) keys.add(t);
  }
  // 属性：title/placeholder/aria-label
  re = /\b(title|placeholder|aria-label)="([^"]*[\u4e00-\u9fff][^"]*)"/g;
  while ((m = re.exec(src))) keys.add(m[2]);
  return keys;
}

function main() {
  const mode = process.argv[2];
  const files = process.argv.slice(3);
  if (mode === 'wrap') {
    let total = 0;
    for (const f of files) {
      const r = applyWrap(f);
      total += r.count;
      console.log(r.file + ': wrapped ' + r.count);
      for (const fl of r.flags) console.log('  FLAG line ' + fl.line + ' [' + fl.type + '] ' + fl.text);
    }
    console.log('TOTAL wrapped: ' + total);
  } else if (mode === 'keys') {
    const all = new Set();
    for (const f of files) for (const k of extractKeys(f)) all.add(k);
    console.log(JSON.stringify([...all], null, 0));
  } else if (mode === 'html') {
    const all = htmlKeys(files[0]);
    console.log(JSON.stringify([...all], null, 0));
  } else {
    console.error('usage: i18n-codemod.js wrap|keys|html <files...>');
    process.exit(1);
  }
}
module.exports = { scanFile, applyWrap, extractKeys, htmlKeys, unescapeLiteral };
if (require.main === module) main();
