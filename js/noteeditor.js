/* LitBoard 富文本笔记编辑器（阶段三下半 / M1 编辑安全）：宽弹窗 contenteditable 组件（浏览器专用）
 *
 * 约束：所有 HTML 只经 window.LitNoteMl 进出（构造即白名单，保存 sanitize）；
 * 交互弹窗（prompt/pick/选图/放弃确认）由调用方注入，组件内不用原生 dialog，也不依赖 app.js 内部函数。
 *
 * M1 编辑安全契约：
 * - 打开时编辑的是独立草稿状态，save() 把 sanitize 结果写进**克隆**并交给 onSave，不改传入实体；
 * - 编辑中草稿防抖持久化到本机 localStorage（litboard.noteDraft.<noteId>），不进同步正文；
 * - 保存成功（onSave 返回的 Promise 非 false）或明确放弃后清理草稿；保存失败保留草稿并回到 dirty；
 * - requestClose()：无改动直接关；有未保存改动经注入的 confirmDiscard 确认，保留弹窗时返回 false
 *   （调用方据此把弹窗栈状态 sync 回真实可见性）。
 *
 * LitNoteEditor.open({
 *   note,                    // Note 实体（format 'markdown' | 'richtext'）
 *   onSave(note),            // 保存回调（参数为内容写好的克隆；可返回 Promise<false|=失败>）
 *   prompt(title, label, value) → Promise<string|null>,
 *   pick(title, label, items[{id,label}]) → Promise<string|null>,
 *   pickImage() → Promise<{ path?: string, dataUrl?: string } | null>,
 *   confirmDiscard(title, body) → Promise<boolean>,   // 放弃未保存修改的确认
 *   citationLabel(paper) → string
 * })
 */
(function (root) {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  var state = {
    note: null, onSave: null, prompt: null, pick: null, pickImage: null,
    citationLabel: null, confirmDiscard: null, bound: false, dirty: false
  };
  var DRAFT_PREFIX = 'litboard.noteDraft.';

  function $(sel) { return document.querySelector(sel); }
  function ml() { return root.LitNoteMl; }

  function area() { return $('#note-edit-area'); }
  function statusEl() { return $('#note-edit-status'); }

  function setStatus(text) {
    var el = statusEl();
    if (el) el.textContent = text || '';
  }

  /* ---- 本机草稿（localStorage，不进同步正文） ---- */

  function draftKey() {
    return state.note && state.note.id ? DRAFT_PREFIX + state.note.id : '';
  }

  function readDraft() {
    if (!draftKey()) return null;
    try {
      var raw = JSON.parse(localStorage.getItem(draftKey()) || 'null');
      return raw && typeof raw.html === 'string' ? raw : null;
    } catch (e) { return null; }
  }

  function persistDraft() {
    if (!draftKey()) return;
    try {
      localStorage.setItem(draftKey(), JSON.stringify({ html: area().innerHTML, savedAt: Date.now() }));
      setStatus(T('草稿已暂存 ') + new Date().toLocaleTimeString());
    } catch (e) { /* 存储不可用时静默：编辑器仍在内存中保留内容 */ }
  }

  function clearDraft() {
    if (!draftKey()) return;
    try { localStorage.removeItem(draftKey()); } catch (e) {}
  }

  var persistDraftTimer = null;
  function schedulePersistDraft() {
    clearTimeout(persistDraftTimer);
    persistDraftTimer = setTimeout(persistDraft, 400);
  }

  /* ---- 编辑命令 ---- */

  function exec(command, value) {
    try { document.execCommand('styleWithCSS', false, false); } catch (e) {}
    try { return document.execCommand(command, false, value); } catch (e) { return false; }
  }

  function insertHtml(html) {
    exec('insertHTML', html + '\u00a0');
  }

  function bindToolbar() {
    if (state.bound) return;
    state.bound = true;
    $('#note-editor-toolbar').addEventListener('mousedown', function (e) {
      // 保持选区不丢：阻止工具栏点击夺走焦点
      if (e.target.closest('button')) e.preventDefault();
    });
    $('#note-editor-toolbar').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-edit-cmd]');
      if (!btn || !state.note) return;
      var cmd = btn.dataset.editCmd;
      if (cmd === 'h1' || cmd === 'h2' || cmd === 'h3' || cmd === 'p' || cmd === 'blockquote' || cmd === 'pre') {
        exec('formatBlock', '<' + cmd + '>');
      } else if (cmd === 'code') {
        insertInlineCode();
      } else if (cmd === 'link') {
        insertLink();
      } else if (cmd === 'table') {
        insertTable();
      } else if (cmd === 'image') {
        insertImage();
      } else if (cmd === 'citation') {
        insertCitation();
      } else if (cmd === 'undo' || cmd === 'redo') {
        exec(cmd);
      } else {
        exec(cmd); // bold / italic / underline / insertUnorderedList / insertOrderedList
      }
      area().focus();
    });
    $('#note-edit-save').addEventListener('click', save);
    $('#note-edit-cancel').addEventListener('click', function () { requestClose(); });
    area().addEventListener('input', function () {
      state.dirty = true;
      setStatus(T('编辑中…'));
      schedulePersistDraft();
    });
    // 关页/崩溃前的最后兜底：立即落一次草稿
    root.addEventListener('pagehide', function () {
      if (state.dirty) persistDraft();
    });
  }

  function selectionCollapsed() {
    var selection = root.getSelection();
    return !selection || selection.isCollapsed;
  }

  function insertInlineCode() {
    var selection = root.getSelection();
    if (!selection || selection.isCollapsed) { insertHtml(T('<code>代码</code>')); return; }
    var text = selection.toString() || T('代码');
    insertHtml('<code>' + escapeHtml(text) + '</code>');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function insertLink() {
    if (!state.prompt) return;
    state.prompt(T('插入链接'), 'URL（http/https）', 'https://').then(function (url) {
      if (url == null) return;
      url = String(url).trim();
      if (!/^https?:\/\//i.test(url)) return;
      var label = selectionCollapsed() ? url : null;
      if (label) {
        insertHtml('<a href="' + escapeHtml(url) + '">' + escapeHtml(url) + '</a>');
      } else {
        exec('createLink', url);
      }
    });
  }

  function insertTable() {
    if (!state.prompt) return;
    state.prompt(T('插入表格'), T('行数'), '3').then(function (rows) {
      if (rows == null) return;
      return state.prompt(T('插入表格'), T('列数'), '3').then(function (cols) {
        if (cols == null) return;
        rows = Math.max(1, Math.min(30, Number(rows) || 1));
        cols = Math.max(1, Math.min(10, Number(cols) || 1));
        var html = '<table><tbody>';
        for (var r = 0; r < rows; r++) {
          html += '<tr>';
          for (var c = 0; c < cols; c++) {
            html += r === 0 ? T('<th>表头</th>') : '<td></td>';
          }
          html += '</tr>';
        }
        html += '</tbody></table><p></p>';
        insertHtml(html);
      });
    });
  }

  function insertImage() {
    if (!state.pickImage || !root.litboardDesktop || !root.litboardDesktop.storeNoteImage) return;
    var note = state.note;
    state.pickImage().then(function (picked) {
      if (!picked) return;
      root.litboardDesktop.storeNoteImage({ noteId: note.id, path: picked.path || '', dataUrl: picked.dataUrl || '' })
        .then(function (stored) {
          if (!stored || stored.error) return;
          insertHtml('<img src="' + escapeHtml(stored.rel) + '" alt="' + escapeHtml(picked.name || T('图片')) + '">');
        });
    });
  }

  function insertCitation() {
    if (!state.pick || !state.papers) return;
    var items = state.papers.map(function (paper) {
      return { id: paper.id, label: (state.citationLabel ? state.citationLabel(paper) : paper.title) };
    });
    state.pick(T('插入引用节点'), T('选择要引用的文献'), items).then(function (paperId) {
      if (!paperId) return;
      var paper = state.papers.find(function (p) { return p.id === paperId; });
      if (!paper) return;
      var finish = function (locator) {
        insertHtml(ml().buildCitationHtml({
          paperId: paper.id,
          label: state.citationLabel ? state.citationLabel(paper) : paper.title,
          locator: locator || ''
        }));
      };
      if (state.prompt) {
        state.prompt(T('定位符（可选）'), T('如页码 12，留空跳过'), '').then(function (locator) {
          if (locator == null) return;
          finish(String(locator).trim());
        });
      } else finish('');
    });
  }

  /* ---- 保存 / 关闭（M1 契约） ---- */

  function save() {
    if (!state.note) return;
    var note = Object.assign({}, state.note); // 不改正式实体：克隆交给调用方
    note.content = ml().sanitizeHtml(area().innerHTML);
    note.format = 'richtext';
    // Markdown → richtext 单向迁移：首次保存把原文存进 sourceMarkdown（导出可还原）
    if (state.note.format !== 'richtext' && !note.sourceMarkdown) {
      note.sourceMarkdown = String(state.note.content || '');
    }
    var result = typeof state.onSave === 'function' ? state.onSave(note) : null;
    state.dirty = false;
    var settle = function (ok) {
      if (ok === false) {
        // 落库失败：回到 dirty，草稿保留，用户可重试或继续编辑
        state.dirty = true;
        setStatus(T('保存失败，草稿已保留'));
      } else {
        clearDraft();
        setStatus('');
      }
    };
    if (result && typeof result.then === 'function') {
      setStatus(T('保存中…'));
      result.then(settle, function () { settle(false); });
    } else {
      settle(true);
    }
    closeMask();
  }

  function closeMask() {
    clearTimeout(persistDraftTimer);
    $('#note-edit-mask').hidden = true;
    state.note = null;
    area().innerHTML = '';
  }

  /** 关闭请求：有未保存改动时经注入的 confirmDiscard 确认。
   * 返回 Promise<boolean>：true=已关闭（或本来就没有未保存改动），false=保留编辑器（异步确认中）。 */
  function requestClose() {
    if (!state.dirty) { clearDraft(); closeMask(); return Promise.resolve(true); }
    persistDraft(); // 关闭前把最新内容落草稿，杜绝丢字
    var confirm = state.confirmDiscard;
    if (typeof confirm !== 'function') { closeMask(); return Promise.resolve(true); }
    return Promise.resolve(confirm(T('未保存的笔记修改'),
      T('有未保存的修改。关闭后修改不再进入笔记，但已保留本机草稿，下次打开同一笔记可恢复。')))
      .then(function (ok) {
        if (ok) { clearDraft(); state.dirty = false; closeMask(); return true; }
        return false; // 保留编辑器：调用方应把弹窗栈状态 sync 回真实可见性
      }, function () { return false; });
  }

  function open(options) {
    var opts = options || {};
    if (!opts.note || !root.LitNoteMl) return;
    bindToolbar();
    state.note = opts.note;
    state.onSave = opts.onSave;
    state.prompt = opts.prompt || null;
    state.pick = opts.pick || null;
    state.pickImage = opts.pickImage || null;
    state.confirmDiscard = opts.confirmDiscard || null;
    state.papers = opts.papers || [];
    state.citationLabel = opts.citationLabel || null;
    state.dirty = false;
    var note = opts.note;
    $('#note-edit-title').textContent = note.title || (note.paperId ? T('本篇笔记') : T('主题笔记'));
    var draft = readDraft();
    if (note.format === 'richtext') {
      area().innerHTML = draft ? draft.html : ml().sanitizeHtml(note.content);
    } else {
      // 单向迁移在保存时落到克隆（sourceMarkdown），打开阶段不改实体
      area().innerHTML = draft ? draft.html : ml().markdownToHtml(note.content);
    }
    if (draft) {
      state.dirty = true;
      setStatus(T('已恢复未保存草稿（') + new Date(draft.savedAt || Date.now()).toLocaleString() + '）');
    } else {
      setStatus('');
    }
    $('#note-edit-mask').hidden = false;
    setTimeout(function () { area().focus(); }, 30);
  }

  root.LitNoteEditor = { open: open, close: closeMask, save: save, requestClose: requestClose };
})(window);
