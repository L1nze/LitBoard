/* LitBoard 阅读器侧栏笔记面板：PDF / EPUB 共用交互，阅读器只提供当前文献与各自的 DOM 前缀。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitNotePanel = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function create(options) {
    var selectedId = '';
    var saveSide = options.debounce(function () { options.save(); }, 500);

    function el(name) { return options.$('#' + options.prefix + '-' + name); }
    function current() {
      var paper = options.getPaper();
      if (!paper) return null;
      var note = selectedId ? options.findNote(selectedId) : null;
      if (note && (note.paperId === paper.id || !note.paperId)) return note;
      var own = options.notesForPaper(paper.id);
      return own.length ? own[0] : (options.topicNotes()[0] || null);
    }
    function renderPreview(note) {
      var preview = el('note-preview');
      if (!preview) return;
      if (!note || !String(note.content || '').trim()) {
        preview.innerHTML = options.T('<p class="d-abstract none">暂无内容</p>');
      } else if (note.format === 'richtext' && options.noteMl) {
        preview.innerHTML = options.noteMl.sanitizeHtml(note.content);
      } else {
        preview.innerHTML = options.markdown.render(note.content);
      }
    }
    function setMode(mode) {
      var previewMode = mode === 'preview';
      var textarea = el('note-textarea');
      var preview = el('note-preview');
      var editTab = el('note-edit-tab');
      var previewTab = el('note-preview-tab');
      if (!textarea || !preview || !editTab || !previewTab) return;
      textarea.hidden = previewMode;
      preview.hidden = !previewMode;
      editTab.classList.toggle('active', !previewMode);
      previewTab.classList.toggle('active', previewMode);
      if (previewMode) renderPreview(current());
    }
    function staleItems(note) {
      if (!note) return null;
      if (note.format === 'richtext' && options.noteMl) {
        return options.noteMl.parseExcerptBlocks(note.content).map(function (block) {
          var found = options.findAnnotationAnywhere(block.annotationId, block.paperId, block.attachmentId);
          if (!found) return { status: 'deleted', annotationId: block.annotationId, preview: block.quoteText };
          if (block.sourceUpdatedAt != null && Number(found.annotation.updatedAt) !== Number(block.sourceUpdatedAt)) {
            return { status: 'changed', annotationId: block.annotationId, preview: block.quoteText, current: found.annotation };
          }
          return { status: 'fresh', annotationId: block.annotationId, preview: block.quoteText };
        }).filter(function (item) { return item.status !== 'fresh'; });
      }
      if (!options.excerpt) return null;
      return options.excerpt.staleExcerpts(note.content, function (annotationId, excerpt) {
        var found = options.findAnnotationAnywhere(annotationId, excerpt && excerpt.paperId, excerpt && excerpt.attachmentId);
        return found ? found.annotation : null;
      }).filter(function (item) { return item.status !== 'fresh'; })
        .map(function (item) {
          return { status: item.status, annotationId: item.excerpt.annotationId, preview: item.excerpt.quote, current: item.current || null };
        });
    }
    function renderStale() {
      var box = el('note-stale');
      var items = staleItems(current());
      if (!box || !items) {
        if (box) { box.hidden = true; box.innerHTML = ''; }
        return;
      }
      box.innerHTML = '';
      if (!items.length) { box.hidden = true; return; }
      box.hidden = false;
      items.slice(0, 10).forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'pdf-note-stale-item';
        var badge = document.createElement('span');
        badge.className = 'pdf-note-stale-badge' + (item.status === 'deleted' ? ' deleted' : '');
        badge.textContent = item.status === 'deleted' ? options.T('来源已删除') : options.T('来源已更新');
        row.appendChild(badge);
        var quote = document.createElement('span');
        quote.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        quote.textContent = String(item.preview || '').split('\n')[0].slice(0, 40);
        row.appendChild(quote);
        function button(label, action) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn-ghost btn-xs';
          btn.dataset.staleAction = action;
          btn.dataset.annotationId = item.annotationId;
          btn.textContent = label;
          return btn;
        }
        if (item.status === 'changed') {
          row.appendChild(button(options.T('采用更新'), 'adopt'));
          row.appendChild(button(options.T('保留'), 'keep'));
        } else {
          row.appendChild(button(options.T('移除摘录'), 'remove'));
        }
        box.appendChild(row);
      });
    }
    function render() {
      var editor = el('note-editor');
      var paper = options.getPaper();
      if (!editor) return;
      if (!paper) { editor.hidden = true; return; }
      editor.hidden = false;
      var note = current();
      selectedId = note ? note.id : '';
      options.fillSelect(el('note-select'), paper.id, selectedId);
      var textarea = el('note-textarea');
      textarea.value = note ? note.content : '';
      textarea.disabled = !note;
      setMode(el('note-preview-tab').classList.contains('active') ? 'preview' : 'edit');
      renderStale();
    }
    function applyStaleAction(action, annotationId) {
      var note = current();
      if (!note) return;
      if (note.format === 'richtext' && options.noteMl) {
        var richTarget = options.noteMl.parseExcerptBlocks(note.content).find(function (block) {
          return block.annotationId === annotationId;
        });
        var found = richTarget ? options.findAnnotationAnywhere(annotationId, richTarget.paperId, richTarget.attachmentId) : null;
        if (action === 'adopt' && found) {
          note.content = options.noteMl.replaceExcerptBlock(note.content, annotationId, {
            quoteText: options.annotationQuote(found.annotation),
            commentText: found.annotation.comment || '',
            sourceUpdatedAt: found.annotation.updatedAt
          });
          options.toast(options.T('✓ 已采用来源更新'));
        } else if (action === 'keep' && found) {
          note.content = options.noteMl.markExcerptBlockCurrent(note.content, annotationId, found.annotation.updatedAt);
        } else if (action === 'remove') {
          note.content = options.noteMl.removeExcerptBlock(note.content, annotationId);
        } else return;
      } else if (options.excerpt) {
        var target = options.excerpt.parseExcerpts(note.content).find(function (item) { return item.annotationId === annotationId; });
        if (!target) return;
        var markdownFound = options.findAnnotationAnywhere(annotationId, target.paperId, target.attachmentId);
        if (action === 'adopt' && markdownFound) {
          note.content = options.excerpt.replaceExcerpt(note.content, target, {
            quote: options.annotationQuote(markdownFound.annotation),
            comment: markdownFound.annotation.comment || '',
            sourceUpdatedAt: markdownFound.annotation.updatedAt
          });
          options.toast(options.T('✓ 已采用来源更新'));
        } else if (action === 'keep' && markdownFound) {
          note.content = options.excerpt.markExcerptCurrent(note.content, target, markdownFound.annotation);
        } else if (action === 'remove') {
          note.content = options.excerpt.removeExcerpt(note.content, target);
        } else return;
      } else return;
      options.touch(note);
      options.save();
      el('note-textarea').value = note.content;
      renderStale();
      if (!el('note-preview').hidden) setMode('preview');
    }
    function createNew() {
      var paper = options.getPaper();
      if (!paper) return;
      options.prompt(options.T('新建笔记'), options.T('标题；留空则创建跨文献主题笔记'), '').then(function (title) {
        if (title == null) return;
        var note = options.createNote(String(title).trim() ? paper.id : '', String(title).trim());
        selectedId = note.id;
        options.save();
        render();
        options.toast(options.T('✓ 已创建笔记'));
      });
    }
    function bind() {
      el('note-select').addEventListener('change', function (event) { selectedId = event.target.value; render(); });
      el('note-new').addEventListener('click', createNew);
      el('note-edit-tab').addEventListener('click', function () { setMode('edit'); });
      el('note-preview-tab').addEventListener('click', function () { setMode('preview'); });
      el('note-richtext').addEventListener('click', function () { options.openRichtext(current()); });
      el('note-export-word').addEventListener('click', function () { options.exportWord(current()); });
      el('note-textarea').addEventListener('input', function (event) {
        var note = current();
        if (!note) return;
        note.content = event.target.value;
        options.touch(note);
        saveSide();
      });
      el('note-stale').addEventListener('click', function (event) {
        var button = event.target.closest('[data-stale-action]');
        if (button) applyStaleAction(button.dataset.staleAction, button.dataset.annotationId);
      });
    }
    return {
      bind: bind,
      applyStaleAction: applyStaleAction,
      current: current,
      flush: function () { saveSide.flush(); },
      render: render,
      renderStale: renderStale,
      setCurrentId: function (id) { selectedId = id || ''; },
      setMode: setMode
    };
  }

  return { create: create };
});
