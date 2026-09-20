'use strict';

const test = require('node:test');
const assert = require('node:assert');
const LitModal = require('../js/modal.js');

test('弹窗栈：closeTop 只关最顶层，按显示顺序后进先出', () => {
  const stack = LitModal.createModalStack();
  const closed = [];
  stack.register('base', () => closed.push('base'));
  stack.register('nested', () => closed.push('nested'));

  stack.setVisible('base', true);
  stack.setVisible('nested', true);
  assert.strictEqual(stack.top(), 'nested');
  assert.strictEqual(stack.closeTop(), true);
  assert.deepStrictEqual(closed, ['nested']);
  assert.strictEqual(stack.top(), 'base');
  assert.strictEqual(stack.closeTop(), true);
  assert.deepStrictEqual(closed, ['nested', 'base']);
  assert.strictEqual(stack.top(), null);
  assert.strictEqual(stack.closeTop(), false);
});

test('弹窗栈：隐藏后再显示回到栈顶；close 回调缺失时仅置不可见', () => {
  const stack = LitModal.createModalStack();
  stack.register('a');
  stack.register('b', () => {});
  stack.setVisible('a', true);
  stack.setVisible('b', true);
  stack.setVisible('b', false);
  assert.strictEqual(stack.top(), 'a');
  stack.setVisible('b', true);
  assert.strictEqual(stack.top(), 'b');
  // b 有 close 回调：调用回调但回调没改 visible → closeTop 仍返回 true（回调负责真实关闭）
  assert.strictEqual(stack.closeTop(), true);
  // 无回调的 a：直接置不可见
  assert.strictEqual(stack.closeTop(), true);
  assert.strictEqual(stack.top(), null);
});

test('弹窗栈：重复 register 更新回调且不清可见状态；unregister 移除', () => {
  const stack = LitModal.createModalStack();
  let calls = 0;
  stack.register('x', () => calls++);
  stack.setVisible('x', true);
  stack.register('x', () => { calls += 10; });
  stack.setVisible('y', true); // 未注册的 id：no-op
  assert.strictEqual(stack.top(), 'x');
  assert.strictEqual(stack.closeTop(), true);
  assert.strictEqual(calls, 10);
  stack.unregister('x');
  stack.setVisible('x', true);
  assert.strictEqual(stack.top(), null);
});

test('弹窗栈：后显示者盖住早显示者（与 DOM 顺序无关）', () => {
  const stack = LitModal.createModalStack();
  const order = [];
  stack.register('first-in-list', () => order.push('first'));
  stack.register('second-in-list', () => order.push('second'));
  stack.setVisible('first-in-list', true);
  stack.setVisible('second-in-list', true);
  stack.closeTop();
  assert.deepStrictEqual(order, ['second']);
  stack.closeTop();
  assert.deepStrictEqual(order, ['second', 'first']);
});

test('弹窗栈：visibleIds 按显示时序升序，供渲染层分配 z-index', () => {
  const stack = LitModal.createModalStack();
  stack.register('settings');
  stack.register('wizard');
  stack.register('dialog');
  assert.deepStrictEqual(stack.visibleIds(), []);
  stack.setVisible('settings', true);
  stack.setVisible('wizard', true);
  stack.setVisible('dialog', true);
  // 设置 → 向导 → 通用对话框：后开者在后，层级依次抬升
  assert.deepStrictEqual(stack.visibleIds(), ['settings', 'wizard', 'dialog']);
  // 隐藏后重开回到序列末尾；隐藏的条目不再占位
  stack.setVisible('settings', false);
  assert.deepStrictEqual(stack.visibleIds(), ['wizard', 'dialog']);
  stack.setVisible('settings', true);
  assert.deepStrictEqual(stack.visibleIds(), ['wizard', 'dialog', 'settings']);
});
