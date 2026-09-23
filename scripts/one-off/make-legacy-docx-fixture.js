'use strict';

/* 一次性：用替换前（自写 stored-ZIP）的 js/docx.js 生成旧格式 fixture 字节。
 * 用途：test/docx.test.js 的「旧格式可读」回归——JSZip 替换后 zipRead 必须仍能
 * 逐字节读出这两个文件并解析出同样的引文域。重跑方式：git stash 出新实现后
 * `node scripts/one-off/make-legacy-docx-fixture.js`。 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const LitDocx = require('../../js/docx.js');

const outDir = path.join(__dirname, '..', '..', 'test', 'fixtures');

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4]);
const build = LitDocx.buildDocx([
  { text: '前言段落' },
  { runs: [
    { text: '甲说 ' },
    { citation: { payload: { version: 1, items: [{ paperId: 'p1' }] }, runs: [{ text: '[1' }, { text: ',2', sup: true }, { text: ']' }] } },
    { text: '。' },
    { image: { data: png, ext: '.png' } }
  ] },
  { runs: [{ text: '参考文献', bold: true }] }
]);
fs.writeFileSync(path.join(outDir, 'legacy-docx-build.bin'), Buffer.from(build));

const field = function (paperId, label) {
  return '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> ADDIN LitBoard.Citation.1 &quot;{&quot;version&quot;:1,&quot;items&quot;:[{&quot;paperId&quot;:&quot;' + paperId + '&quot;}]}</w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>' + label + '</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
};
const stories = LitDocx.zipStore([
  { name: 'word/document.xml', data: '<w:document>' + field('p1', '[1]') + '</w:document>' },
  { name: 'word/footnotes.xml', data: '<w:footnotes>' + field('p2', '[2]') + '</w:footnotes>' },
  { name: 'word/endnotes.xml', data: '<w:endnotes>' + field('p3', '[3]') + '</w:endnotes>' }
]);
fs.writeFileSync(path.join(outDir, 'legacy-docx-stories.bin'), Buffer.from(stories));

for (const name of ['legacy-docx-build.bin', 'legacy-docx-stories.bin']) {
  const bytes = fs.readFileSync(path.join(outDir, name));
  console.log(name, bytes.length, 'bytes, sha256 =', crypto.createHash('sha256').update(bytes).digest('hex'));
}
