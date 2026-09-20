#!/usr/bin/env node
'use strict';
/* 对齐片段键的首尾空格：键以空格开头/结尾而译文没有时，补上空格。
 * 用法：node scripts/i18n-space-fix.js <keys-all.json> <chunks-dir> */
const fs = require('fs');
const path = require('path');

const keysFile = process.argv[2];
const chunksDir = process.argv[3];
const keys = JSON.parse(fs.readFileSync(keysFile, 'utf8'));

const files = fs.readdirSync(chunksDir).filter((f) => /^en-.*\.txt$/.test(f)).sort();
let fixed = 0;
for (const f of files) {
  const p = path.join(chunksDir, f);
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\d+)\t(.*)$/.exec(lines[i].replace(/\r$/, ''));
    if (!m) continue;
    const idx = Number(m[1]);
    const key = keys[idx - 1];
    let val = m[2];
    const keyLead = /^[ ]/.test(key);
    const keyTrail = /[ ]$/.test(key);
    if (keyLead && !/^\s/.test(val)) { val = ' ' + val; fixed++; }
    if (keyTrail && !/\s$/.test(val)) { val = val + ' '; fixed++; }
    lines[i] = idx + '\t' + val;
  }
  fs.writeFileSync(p, lines.join('\n'));
}
console.log('space fixes applied:', fixed);
