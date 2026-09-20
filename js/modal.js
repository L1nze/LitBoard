/* LitBoard 弹窗栈（M1）：所有覆盖层（modal-mask / 阅读器 overlay / 悬浮 popover）统一注册，
 * Esc 只关最顶层，不再一次隐藏全部弹窗。
 *
 * 结构分两层：
 * - createModalStack()：纯逻辑核心（注册表 + 显示序号 + top/closeTop 决策），Node 可测；
 * - 浏览器绑定：经 MutationObserver 跟踪元素的 hidden 属性进出栈，无需在每个显示点埋点。
 *   同时按显示时序给 .modal-mask 分派 z-index——它们同为 210，只靠 DOM 顺序无法表达
 *   「设置弹窗 → 导入向导」这类嵌套打开（后开者必须盖住先开者）。
 *
 * 用法（浏览器）：
 *   LitModal.watch(el, closeFn)  // closeFn 应走对应「取消/关闭」按钮路径，保证状态清理一致
 *   LitModal.closeTop()          // → boolean：是否关闭了一个覆盖层
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LitModal = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createModalStack() {
    var seq = 0;
    var entries = [];

    function find(id) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].id === id) return entries[i];
      }
      return null;
    }

    function top() {
      var best = null;
      entries.forEach(function (entry) {
        if (entry.visible && (!best || entry.shownAt > best.shownAt)) best = entry;
      });
      return best;
    }

    return {
      register: function (id, close) {
        var entry = find(id);
        if (!entry) {
          entry = { id: id, close: null, visible: false, shownAt: 0 };
          entries.push(entry);
        }
        entry.close = typeof close === 'function' ? close : null;
        return entry.id;
      },
      unregister: function (id) {
        entries = entries.filter(function (entry) { return entry.id !== id; });
      },
      setVisible: function (id, visible) {
        var entry = find(id);
        if (!entry) return;
        entry.visible = !!visible;
        if (entry.visible) entry.shownAt = ++seq;
      },
      top: function () {
        var entry = top();
        return entry ? entry.id : null;
      },
      closeTop: function () {
        var entry = top();
        if (!entry) return false;
        // 乐观置隐：close 回调负责真实关闭（通常点取消按钮 → hidden 变化 → 观察者复核一致）。
        // 异步「决定保留」的路径（如脏守卫确认后取消关闭）须经 sync() 把真实状态写回。
        entry.visible = false;
        if (entry.close) entry.close();
        return true;
      },
      list: function () {
        return entries.map(function (entry) {
          return { id: entry.id, visible: entry.visible, shownAt: entry.shownAt };
        });
      },
      /* 可见覆盖层按显示时序升序（早 → 晚）；渲染层据此分配 z-index，后显示者在上 */
      visibleIds: function () {
        return entries
          .filter(function (entry) { return entry.visible; })
          .sort(function (a, b) { return a.shownAt - b.shownAt; })
          .map(function (entry) { return entry.id; });
      }
    };
  }

  /* 浏览器绑定：watch(el, closeFn) 用 MutationObserver 同步 hidden 属性 → 栈。
   * MutationObserver 回调在微任务时机执行，先于下一个用户事件（keydown），时序安全。 */
  function bindBrowser(doc) {
    var stack = createModalStack();
    // 与 css 的 .modal-mask 默认值对齐；栈内第 n 层取 Z_BASE + n，
    // 未纳入栈的遮挡层（如快照拖拽遮罩）留在默认值上，永远在栈下方。
    var Z_BASE = 210;
    var maskEls = {};

    /* 重排 z-index：可见的 .modal-mask 按显示时序依次抬升（第 n 层 = Z_BASE + n，故未纳入
     * 栈的遮挡层仍留在默认值下方）。阅读器 overlay / 悬浮层不进这里——它们有各自的层叠契约
     * （须留在 topbar 之下）。同一任务里连续打开的多个遮挡层，MutationRecord 分不出先后，
     * 此时按观察者回调顺序即 DOM 顺序决定（与本次改动前一致）。 */
    function restack() {
      var order = stack.visibleIds();
      var visible = {};
      order.forEach(function (id, index) {
        var el = maskEls[id];
        if (!el) return;
        visible[id] = true;
        el.style.zIndex = String(Z_BASE + index + 1);
      });
      Object.keys(maskEls).forEach(function (id) {
        if (!visible[id]) maskEls[id].style.zIndex = '';
      });
    }

    function apply(el) {
      stack.setVisible(el.id, !el.hidden);
      restack();
    }

    function watch(el, closeFn) {
      if (!el || !el.id) return;
      stack.register(el.id, closeFn || null);
      if (el.classList && el.classList.contains('modal-mask')) maskEls[el.id] = el;
      stack.setVisible(el.id, !el.hidden);
      restack();
      if (typeof MutationObserver === 'undefined') return;
      new MutationObserver(function () { apply(el); }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
    }

    return {
      watch: watch,
      closeTop: function () { return stack.closeTop(); },
      top: function () { return stack.top(); },
      /* 异步关闭路径（如脏守卫确认后决定保留弹窗）手动回填真实可见性 */
      sync: function (el) { if (el && el.id) apply(el); },
      _stack: stack
    };
  }

  var browserApi = typeof document !== 'undefined' ? bindBrowser(document) : null;

  return browserApi || {
    watch: function () {},
    closeTop: function () { return false; },
    top: function () { return null; },
    createModalStack: createModalStack
  };
});
