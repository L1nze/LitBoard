'use strict';
/* PDF 重排阅读分析层（阶段六切片 4）：行聚簇 / 栏检测 / 阅读序 / 段落合并 */
const test = require('node:test');
const assert = require('node:assert');
const LitReflow = require('../js/reflow.js');

// 构造 pdf.js textContent item：transform=[a,b,c,d,e,f]，x=e, y=f, d≈字号
function item(str, x, y, size, width) {
  return { str, transform: [size, 0, 0, size, x, y], width: width != null ? width : str.length * size * 0.5 };
}

test('linesFromItems：y 聚簇成行、行内按 x 拼接、词间补空格', () => {
  const items = [
    item('Hello', 100, 500, 10, 25),
    item('world', 130, 500, 10, 28),   // 间隙 5 > 2.5（行高×0.25）→ 补空格
    item('第二行', 100, 480, 10, 30),
    item('', 100, 480, 10),            // 空串忽略
    item('x', 105, 481, 10, 5)         // 同簇（容差内）→ 并入第二行，小间隙不补空格
  ];
  const lines = LitReflow.linesFromItems(items, 0);
  assert.strictEqual(lines.length, 2);
  const byText = {};
  lines.forEach(l => { byText[l.text] = l; });
  assert.strictEqual(byText['Hello world'].text, 'Hello world');
  assert.strictEqual(byText['第二行x'].text, '第二行x');
  assert.strictEqual(byText['Hello world'].page, 0);
});

test('linesFromItems：乱序输入也按坐标聚簇', () => {
  const items = [item('b', 106, 100, 10, 5), item('a', 100, 100, 10, 5), item('c', 100, 90, 10, 5)];
  const lines = LitReflow.linesFromItems(items, 3);
  assert.strictEqual(lines.length, 2);
  const byText = {};
  lines.forEach(l => { byText[l.text] = l; });
  assert.strictEqual(byText['c'].page, 3);
  assert.strictEqual(byText['ab'].text, 'ab');      // x 排序拼接，小间隙不补空格
});

test('linesFromItems：空输入安全', () => {
  assert.deepStrictEqual(LitReflow.linesFromItems([], 0), []);
  assert.deepStrictEqual(LitReflow.linesFromItems(null, 0), []);
});

function twoColumnPage() {
  // 页宽 600；通栏标题 y=550；左右两栏正文；通栏页脚 y=40
  const items = [item('Full Title Here', 60, 550, 12, 480)];
  let y = 520;
  for (let i = 0; i < 8; i++) {           // 左栏 x=60
    items.push(item('Left' + i, 60, y, 10, 200));
    items.push(item('Right' + i, 330, y, 10, 200));  // 右栏 x=330
    y -= 14;
  }
  items.push(item('Footnote across the bottom', 60, 40, 9, 480));
  return items;
}

test('readingOrder：双栏页 → 通栏标题 → 左栏 → 右栏 → 通栏页脚', () => {
  const lines = LitReflow.linesFromItems(twoColumnPage(), 0);
  const blocks = LitReflow.readingOrder(lines, 600);
  const texts = blocks.map(b => b.text);
  const titleIdx = texts.findIndex(t => t.indexOf('Full Title') === 0);
  const leftIdx = texts.findIndex(t => t.indexOf('Left0') === 0);
  const rightIdx = texts.findIndex(t => t.indexOf('Right0') === 0);
  const footIdx = texts.findIndex(t => t.indexOf('Footnote') === 0);
  assert.ok(titleIdx !== -1 && leftIdx !== -1 && rightIdx !== -1 && footIdx !== -1, '四部分都出现');
  assert.ok(titleIdx < leftIdx, '标题在左栏前');
  assert.ok(leftIdx < rightIdx, '左栏在右栏前');
  assert.ok(rightIdx < footIdx, '页脚在最后');
  // 栏内行合并为段落（行距 14 ≤ 1.9×行高）
  assert.strictEqual(blocks[leftIdx].text.indexOf('Left0'), 0);
  assert.ok(blocks[leftIdx].text.indexOf('Left7') !== -1, '左栏 8 行并成一段');
  assert.strictEqual(blocks.filter(b => b.text.indexOf('Right') === 0).length, 1, '右栏单段');
});

test('readingOrder：单栏页顺序不变', () => {
  const items = [];
  let y = 500;
  for (let i = 0; i < 6; i++) { items.push(item('Line' + i, 60, y, 10, 400)); y -= 15; }
  const blocks = LitReflow.readingOrder(LitReflow.linesFromItems(items, 0), 600);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].text.indexOf('Line0'), 0);
  assert.ok(blocks[0].text.indexOf('Line5') !== -1);
});

test('readingOrder：三栏以上退化单栏（先 y 后 x）', () => {
  const items = [];
  let y = 500;
  for (let i = 0; i < 4; i++) {
    items.push(item('C1_' + i, 40, y, 10, 120));
    items.push(item('C2_' + i, 220, y, 10, 120));
    items.push(item('C3_' + i, 400, y, 10, 120));
    y -= 14;
  }
  const blocks = LitReflow.readingOrder(LitReflow.linesFromItems(items, 0), 600);
  const texts = blocks.map(b => b.text);
  // 退化模式：同 y 的三行按 x 排 → C1 在 C2 前、C2 在 C3 前（整体作为相邻块或同块）
  const all = texts.join(' ');
  assert.ok(all.indexOf('C1_0') < all.indexOf('C2_0'));
  assert.ok(all.indexOf('C2_0') < all.indexOf('C3_0'));
});

test('readingOrder：段落按行距拆分', () => {
  const items = [
    item('Para1 line1', 60, 500, 10, 200),
    item('Para1 line2', 60, 486, 10, 200),   // 行距 14 ≤ 1.9×10
    item('Para2 line1', 60, 440, 10, 200)    // 行距 46 > 19 → 新段落
  ];
  const blocks = LitReflow.readingOrder(LitReflow.linesFromItems(items, 0), 600);
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].text, 'Para1 line1 Para1 line2');
  assert.strictEqual(blocks[1].text, 'Para2 line1');
});

test('readingOrder：空输入 / 无页宽（取行最大右缘）', () => {
  assert.deepStrictEqual(LitReflow.readingOrder([], 600), []);
  const items = [item('only', 60, 100, 10, 100)];
  const blocks = LitReflow.readingOrder(LitReflow.linesFromItems(items, 2));
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].page, 2);
});
