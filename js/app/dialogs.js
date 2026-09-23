/* LitBoard 通用对话框：确认、输入和列表选择共用一份可等待状态。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitDialogs = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function create(options) {
    var state = null;
    function $(selector) { return options.$(selector); }
    function settle(value) {
      if (!state) return;
      var current = state;
      state = null;
      $('#dlg-mask').hidden = true;
      current.resolve(value);
    }
    function cancel() {
      if (!state) return;
      settle(state.mode === 'confirm' ? false : null);
    }
    function open(input) {
      if (state) cancel();
      return new Promise(function (resolve) {
        var mode = input.list ? 'list' : (input.input ? 'input' : 'confirm');
        state = { resolve: resolve, mode: mode };
        $('#dlg-title').textContent = input.title || options.T('确认');
        var body = $('#dlg-body');
        body.textContent = input.body || '';
        body.hidden = !input.body;
        var field = $('#dlg-input');
        field.hidden = !input.input;
        if (input.input) {
          field.placeholder = input.input.placeholder || '';
          field.value = input.input.value || '';
        }
        var list = $('#dlg-list');
        list.innerHTML = '';
        list.hidden = !input.list;
        if (input.list) {
          input.list.forEach(function (item) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'dlg-option';
            button.textContent = item.label;
            button.addEventListener('click', function () { settle(item.id); });
            list.appendChild(button);
          });
        }
        var ok = $('#dlg-ok');
        ok.hidden = mode === 'list';
        ok.textContent = input.okText || options.T('确定');
        ok.className = 'btn ' + (input.danger ? 'btn-danger-solid' : 'btn-primary');
        $('#dlg-mask').hidden = false;
        setTimeout(function () {
          if (mode === 'input') { field.focus(); field.select(); }
          else if (mode === 'list') { var first = list.querySelector('.dlg-option'); if (first) first.focus(); }
          else ok.focus();
        }, 0);
      });
    }
    return {
      cancel: cancel,
      confirm: function (title, body, okText, danger) { return open({ title: title, body: body, okText: okText, danger: danger }); },
      mode: function () { return state ? state.mode : ''; },
      pick: function (title, body, items) { return open({ title: title, body: body, list: items }); },
      prompt: function (title, body, placeholder, value) { return open({ title: title, body: body, input: { placeholder: placeholder, value: value } }); },
      submit: function () {
        if (!state) return;
        settle(state.mode === 'input' ? $('#dlg-input').value : true);
      }
    };
  }

  return { create: create };
});
