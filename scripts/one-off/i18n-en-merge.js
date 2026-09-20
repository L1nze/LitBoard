#!/usr/bin/env node
'use strict';
/* 把分块译文（<编号>\t<英文>，支持 \n \t \\ 转义）合并成 js/i18n-en.js 词典。
 * 用法：node scripts/one-off/i18n-en-merge.js <keys-all.json> <chunks-dir> [out]
 * chunks-dir 下形如 en-*.txt；未覆盖/重复/多余编号都会报错退出。
 * 一次性迁移工具（首版词典分块翻译合并用），日常增补直接手改 js/i18n-en.js。 */
const fs = require('fs');
const path = require('path');

const keysFile = process.argv[2];
const chunksDir = process.argv[3];
const outFile = process.argv[4] || path.join(__dirname, '..', '..', 'js', 'i18n-en.js');

const keys = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
const map = new Map();
const files = fs.readdirSync(chunksDir).filter((f) => /^en-.*\.txt$/.test(f)).sort();
for (const f of files) {
  const text = fs.readFileSync(path.join(chunksDir, f), 'utf8');
  for (let line of text.split('\n')) {
    line = line.replace(/\r$/, '');
    if (line === '') continue;
    const m = /^(\d+)\t(.*)$/.exec(line);
    if (!m) { console.error('BAD LINE in ' + f + ': ' + line.slice(0, 60)); process.exit(1); }
    const idx = Number(m[1]);
    if (map.has(idx)) { console.error('DUP index ' + idx + ' in ' + f); process.exit(1); }
    if (idx < 1 || idx > keys.length) { console.error('RANGE ' + idx + ' in ' + f); process.exit(1); }
    map.set(idx, m[2].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\'));
  }
}
const missing = [];
const identity = [];
for (let i = 1; i <= keys.length; i++) {
  const v = map.get(i);
  if (v === undefined) { missing.push(i); continue; }
  if (v === keys[i - 1]) identity.push(i);
}
if (missing.length) { console.error('MISSING ' + missing.length + ' entries: ' + missing.slice(0, 20).join(',') + '...'); process.exit(1); }
if (identity.length) console.warn('IDENTITY (untranslated) ' + identity.length + ': ' + identity.slice(0, 20).join(','));

const entries = keys.map((k, i) => '    ' + JSON.stringify(k) + ': ' + JSON.stringify(map.get(i + 1)));
const out = '/* LitBoard 英文词典：键 = 中文源串（与 js/i18n.js、界面源码一致）。\n'
  + ' * 由 scripts/one-off/i18n-en-merge.js 生成，手工维护译文；新增界面文案后请补条目\n'
  + ' * （test/i18n.test.js 会校验 T() 键与本词典的覆盖关系）。 */\n'
  + '(function (root, factory) {\n'
  + '  var LitI18n = (root && root.LitI18n) || (typeof module === \'object\' && module.exports ? require(\'./i18n.js\') : null);\n'
  + '  if (!LitI18n) return;\n'
  + '  factory(LitI18n.register.bind(LitI18n));\n'
  + '})(typeof window !== \'undefined\' ? window : null, function (register) {\n'
  + '  \'use strict\';\n'
  + '  register(\'en\', {\n'
  + entries.join(',\n')
  + '\n  });\n});\n';
fs.writeFileSync(outFile, out);
console.log('wrote ' + outFile + ' with ' + entries.length + ' entries');
