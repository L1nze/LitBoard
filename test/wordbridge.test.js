'use strict';
/* Word COM 桥静态契约（F11 回归）：JScript 侧必须调用真实存在的 Word 对象模型 API 名 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'word', 'wordbridge.js'), 'utf8');

test('撤销记录调用正确的 Word API 名（StartCustomRecord/EndCustomRecord）', () => {
  assert.match(SRC, /UndoRecord\.StartCustomRecord\(/);
  assert.match(SRC, /UndoRecord\.EndCustomRecord\(\)/);
  assert.doesNotMatch(SRC, /CustomRecordStart|CustomRecordEnd\(/);
});

test('脚本保持纯 ASCII（cscript 按 ANSI 解码）且为 ES3 兼容子集', () => {
  assert.doesNotMatch(SRC, /[^\x00-\x7F]/, 'wordbridge.js 不允许非 ASCII 字符');
});

test('RTF 流以 nosupersub 收尾、光标落在域「之后」而非域结果内', () => {
  // {\super [1-4]} 组虽闭合，Word 导入后插入点的「当前输入格式」仍停在上标，
  // 用户接着打字全是上标：流尾 \nosupersub + 光标落位后显式清 super/sub 双保险
  assert.match(SRC, /withTrailingNosupersub\(rtfText\)/);
  assert.match(SRC, /nosupersub/);
  assert.match(SRC, /placeCursorAfterField\(fI, docI\.Application\)/);
  // 关键：折叠「域结果」的末尾（Word 视作域内），再用 MoveRight 越过域结束符。
  // 实测（Word 16.0）：Field.Range 返回 null，不能用域自身范围；域结果范围可正常读写。
  const fn = /function placeCursorAfterField[\s\S]*?\n\}/.exec(SRC);
  assert.ok(fn, 'placeCursorAfterField 必须存在');
  assert.match(fn[0], /field\.Result/);
  assert.match(fn[0], /result\.Duplicate/);
  assert.match(fn[0], /rng\.Collapse\(0/);
  assert.match(fn[0], /sel\.MoveRight\(1 /);
  assert.match(fn[0], /sel\.Font\.Superscript = 0/);
  assert.match(fn[0], /sel\.Font\.Subscript = 0/);
  assert.doesNotMatch(fn[0], /field\.Range/, 'Field.Range 在 Word 16.0 上为 null，不可依赖');
});

test('单行引文写入后删除 InsertFile 塞入的尾部段落符（幽灵空行/吞字根因）', () => {
  // InsertFile 会在域结果末尾追加一个 \r：域凭空多出一个空行、底纹盖住它，
  // 用户点一下引文旁边就落进域内，之后打的字全部被吞（真机截图复现）。
  // Zotero field.cpp 同款收尾：内容自带 \par（参考文献多段落）时保留，单行引文才删。
  assert.match(SRC, /function deleteTrailingReturn\(field\)/);
  const fn = /function deleteTrailingReturn[\s\S]*?\n\}/.exec(SRC);
  assert.match(fn[0], /tail\.MoveStart\(1/);
  assert.match(fn[0], /tail\.Text === '\\r'/);
  assert.match(fn[0], /tail\.Text = ''/);
  // 调用条件：仅无 \par 的内容（引文），参考文献不删
  assert.match(SRC, /if \(value\.indexOf\('\\\\par'\) === -1\) deleteTrailingReturn\(field\);/);
});

test('域结果字体沿用文档字体（InsertFile 会带进 RTF 默认字体）', () => {
  // 实测：写引文 RTF 后域结果字体从宋体变成 Times New Roman，用户在引文后打的字也是 Times New Roman。
  // Zotero 同路线（field.cpp setText）：插入前记下 Font.Name/Size，插入后回填。
  const fn = /function writeFieldText[\s\S]*?\n\}/.exec(SRC);
  assert.ok(fn, 'writeFieldText 必须存在');
  assert.match(fn[0], /insertRtfFile\(result, value\)/);
  // 回填必须用插入后重新取的 field.Result：插入前捕获的 Range 已不再覆盖新文本（实测回填静默失效）
  assert.match(fn[0], /after = field\.Result/);
  assert.match(fn[0], /after\.Font\.Name = name/);
  assert.match(fn[0], /after\.Font\.Size = size/);
  // 字体取自域前的正文字符：读域结果自身的字体会把旧的错字体（Times New Roman）永久「保留」下去
  assert.match(fn[0], /fontBeforeField\(doc, field\)/);
  const ctx = /function fontBeforeField[\s\S]*?\n\}/.exec(SRC);
  assert.ok(ctx, 'fontBeforeField 必须存在');
  assert.match(ctx[0], /field\.Code\.Start/);
  assert.match(ctx[0], /doc\.Range\(start - 1, start\)/);
  assert.match(ctx[0], /probe\.Font\.Name/);
  // 三个写入点都要带上文档（没有 doc 就退化为读域结果，修不了旧引文）
  assert.match(SRC, /writeFieldText\(fA, b64decode\(texts\[idx\]\), docA\)/);
  assert.match(SRC, /writeFieldText\(fI, b64decode\(parts\[2\]\), docI\)/);
  assert.match(SRC, /writeFieldText\(field, assembleBibliographyRtf\(entries\), doc\)/);
});

test('APPLY/BIB 收尾兜底：光标若在引文域结果内则挪到域外', () => {
  // 插入后 app 会立刻 APPLY 重写全部域；不论哪一步把光标带回域内，收尾都要把它请出去
  assert.match(SRC, /function ejectCaretFromLitFields\(doc, app\)/);
  assert.match(SRC, /ejectCaretFromLitFields\(docA, docA\.Application\)/);
  assert.match(SRC, /ejectCaretFromLitFields\(docB, docB\.Application\)/);
  const fn = /function ejectCaretFromLitFields[\s\S]*?\n\}/.exec(SRC);
  assert.match(fn[0], /isLitField\(f\)/);
  assert.match(fn[0], /caret >= rs && caret <= re/);
  assert.match(fn[0], /placeCursorAfterField\(f, app\)/);
});

test('挤在正文引文后的旧参考文献域必须按可见前置文本识别，而非按域代码长度放行', () => {
  // 真实故障形态：正文 [1-3] 后立刻跟着参考文献域的 [1]。域代码本身很长，
  // 不能用其长度当阈值，否则短短的 [1-3] 永远检测不到，刷新也无法自动修复。
  const fn = /function bibFieldIsJammed[\s\S]*?\n\}/.exec(SRC);
  assert.ok(fn, 'bibFieldIsJammed 必须存在');
  assert.match(fn[0], /replace\(\/\[\\x13\\x14\\x15\\r\]/, '仅 Word 域控制字符可忽略');
  assert.doesNotMatch(fn[0], /codeLen/, '域代码长度不属于可见前置文本');
});
