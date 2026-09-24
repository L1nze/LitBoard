/* LitBoard 查询构建器（#query-builder-mask）与批量字段编辑（#bulk-edit-mask）：
 * 行式条件组装走 LitQuery（rowsToText/parseAst 校验），批量编辑带不同值分布、
 * 预览影响数与「明确清空」，经撤销快照进会话级 undo。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitQueryBuilder = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function create(options) {
    var T = options.T;
    var $ = options.$;
    var esc = options.esc;
    var toast = options.toast;
    var state = options.state;
    var save = options.save;
    var renderAll = options.renderAll;
    var makeSnapshot = options.makeSnapshot;
    var commitUndo = options.commitUndo;
    var query = options.query || (typeof window !== 'undefined' ? window.LitQuery : null);
    var model = options.model || (typeof window !== 'undefined' ? window.LitModel : null);

    var qbRows = [];
    var QB_KINDS = [['field', T('字段')], ['flag', T('具备')], ['missing', T('缺失字段')], ['text', T('关键词')], ['ann', T('批注组')], ['note', T('笔记组')], ['attachment', T('附件组')], ['count', T('数量比较')]];
    var QB_FIELDS = ['title', 'author', 'venue', 'tag', 'type', 'status', 'year', 'citations', 'rating', 'doi', 'key', 'notes', 'abstract', 'folderid', 'lastread', 'annotations', 'attachments'];
    var QB_FIELD_LABELS = { title: T('标题'), author: T('作者'), venue: T('期刊/会议'), tag: T('标签'), type: T('类型'), status: T('状态'),
      year: T('年份'), citations: T('被引次数'), rating: T('评分'), doi: 'DOI', key: T('引用键'), notes: T('笔记'), abstract: T('摘要'),
      folderid: T('文件夹 ID'), lastread: T('最近阅读'), annotations: T('批注数'), attachments: T('附件数') };
    var QB_FLAGS = ['pdf', 'notes', 'annotations', 'epub', 'snapshot', 'doi', 'abstract', 'unread', 'reading'];

    function openQueryBuilder() {
      qbRows = [{ join: 'AND', kind: 'field', field: 'title', cmp: ':', value: '' }];
      $('#query-builder-mask').hidden = false;
      renderQbRows();
    }
    function renderQbRows() {
      var box = $('#qb-rows');
      box.innerHTML = '';
      qbRows.forEach(function (row, index) {
        var div = document.createElement('div');
        div.className = 'qb-row';
        var join = document.createElement('select');
        join.className = 'qb-join';
        join.innerHTML = T('<option value="AND">且</option><option value="OR">或</option>');
        join.value = row.join || 'AND';
        join.hidden = index === 0;
        join.addEventListener('change', function () { row.join = join.value; updateQbPreview(); });
        div.appendChild(join);
        var kind = document.createElement('select');
        kind.className = 'qb-kind';
        kind.innerHTML = QB_KINDS.map(function (k) { return '<option value="' + k[0] + '">' + k[1] + '</option>'; }).join('');
        kind.value = row.kind;
        div.appendChild(kind);
        var dynamic = document.createElement('span');
        dynamic.style.cssText = 'display:flex;gap:6px;flex:1;align-items:center';
        function valueInput(placeholder) {
          var input = document.createElement('input');
          input.className = 'qb-value';
          input.value = row.value || '';
          input.placeholder = placeholder || '';
          input.addEventListener('input', function () { row.value = input.value; updateQbPreview(); });
          return input;
        }
        function rebuild() {
          dynamic.innerHTML = '';
          if (row.kind === 'field') {
            var field = document.createElement('select');
            field.className = 'qb-field';
             field.innerHTML = QB_FIELDS.map(function (f) { return '<option value="' + f + '">' + (QB_FIELD_LABELS[f] || f) + '</option>'; }).join('');
            field.value = row.field || 'title';
            field.addEventListener('change', function () { row.field = field.value; updateQbPreview(); });
            dynamic.appendChild(field);
            var cmp = document.createElement('select');
            cmp.className = 'qb-cmp';
            cmp.innerHTML = T('<option value=":">包含</option><option value="=">等于</option><option value=">=">≥</option><option value="<=">≤</option><option value=">">&gt;</option><option value="<">&lt;</option>');
            cmp.value = row.cmp || ':';
            cmp.addEventListener('change', function () { row.cmp = cmp.value; updateQbPreview(); });
            dynamic.appendChild(cmp);
            dynamic.appendChild(valueInput(T('匹配值')));
          } else if (row.kind === 'flag') {
            var flag = document.createElement('select');
            flag.className = 'qb-field';
            flag.innerHTML = QB_FLAGS.map(function (f) { return '<option value="' + f + '">' + f + '</option>'; }).join('');
            flag.value = row.value || 'pdf';
            row.value = flag.value;
            flag.addEventListener('change', function () { row.value = flag.value; updateQbPreview(); });
            dynamic.appendChild(flag);
          } else if (row.kind === 'missing') {
            var mf = document.createElement('select');
            mf.className = 'qb-field';
             mf.innerHTML = QB_FIELDS.map(function (f) { return '<option value="' + f + '">' + (QB_FIELD_LABELS[f] || f) + '</option>'; }).join('');
            mf.value = row.field || 'doi';
            row.field = mf.value;
            mf.addEventListener('change', function () { row.field = mf.value; updateQbPreview(); });
            dynamic.appendChild(mf);
          } else if (row.kind === 'ann' || row.kind === 'note') {
             dynamic.appendChild(valueInput(T('组内条件，如 "量子" color:#ffd400（须同一对象满足）')));
          } else if (row.kind === 'attachment') {
            dynamic.appendChild(valueInput(T('组内条件，如 kind:pdf 或 name:"supp"')));
          } else if (row.kind === 'count') {
            var countField = document.createElement('select');
            countField.className = 'qb-field';
            countField.innerHTML = T('<option value="annotations">批注</option><option value="notes">笔记</option><option value="attachments">附件</option>');
            countField.value = row.field || 'annotations'; row.field = countField.value;
            countField.addEventListener('change', function () { row.field = countField.value; updateQbPreview(); });
            dynamic.appendChild(countField);
            var countCmp = document.createElement('select');
            countCmp.className = 'qb-cmp';
            countCmp.innerHTML = '<option value=">=">≥</option><option value="=">=</option><option value=">">&gt;</option><option value="<=">≤</option><option value="<">&lt;</option>';
            countCmp.value = row.cmp || '>=';
            countCmp.addEventListener('change', function () { row.cmp = countCmp.value; updateQbPreview(); });
            dynamic.appendChild(countCmp);
            dynamic.appendChild(valueInput(T('数量')));
          } else {
            dynamic.appendChild(valueInput(T('关键词')));
          }
        }
        kind.addEventListener('change', function () {
          row.kind = kind.value;
          row.value = ''; row.field = 'title'; row.cmp = ':';
          rebuild(); updateQbPreview();
        });
        rebuild();
        div.appendChild(dynamic);
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-ghost btn-xs';
        del.textContent = '×';
        del.title = T('删除条件');
        del.addEventListener('click', function () { qbRows.splice(index, 1); renderQbRows(); });
        div.appendChild(del);
        box.appendChild(div);
      });
      updateQbPreview();
    }
    function updateQbPreview() {
      var text = query ? query.rowsToText(qbRows) : '';
      var preview = $('#qb-preview');
      preview.textContent = text || T('（无条件）');
      preview.classList.remove('error');
      if (text && query) {
        var parsed = query.parseAst(text);
        if (parsed.error) { preview.textContent += T(' —— 语法错误：') + parsed.error; preview.classList.add('error'); }
      }
    }

    /* ---- 批量字段编辑（阶段四余项：展示不同值 / 明确清空 / 预览影响条目） ---- */
    var bulkEditPapers = [];
    function bulkEditCurrentValue(paper, field) {
      if (field === 'tags') return (paper.tags || []).join(', ');
      if (field === 'authors') return (paper.authors || []).join(', ');
      var v = paper[field];
      return v == null ? '' : String(v);
    }
    function openBulkEdit(papers) {
      bulkEditPapers = papers.filter(function (p) { return !p.deletedAt; });
      if (!bulkEditPapers.length) { toast(T('请先选择文献')); return; }
      $('#bulk-edit-summary').textContent = T('已选 ') + bulkEditPapers.length + T(' 篇文献。选择字段并输入新值；「明确清空」会把该字段置空。');
      $('#bulk-edit-value').value = '';
      $('#bulk-edit-clear').checked = false;
      $('#bulk-edit-mask').hidden = false;
      updateBulkEditView();
    }
    function updateBulkEditView() {
      var field = $('#bulk-edit-field').value;
      var counts = {}, order = [];
      bulkEditPapers.forEach(function (p) {
        var v = bulkEditCurrentValue(p, field) || T('（空）');
        if (!counts[v]) { counts[v] = 0; order.push(v); }
        counts[v]++;
      });
      $('#bulk-edit-distinct').innerHTML = T('<span class="field-hint">当前不同值：</span>') +
        order.slice(0, 12).map(function (v) {
          return '<span class="distinct-item">' + esc(v.length > 30 ? v.slice(0, 30) + '…' : v) + ' ×' + counts[v] + '</span>';
        }).join('') + (order.length > 12 ? '<span class="field-hint">…</span>' : '');
      updateBulkEditPreview();
    }
    function updateBulkEditPreview() {
      var field = $('#bulk-edit-field').value;
      var clear = $('#bulk-edit-clear').checked;
      var value = $('#bulk-edit-value').value.trim();
      if (!clear && !value) { $('#bulk-edit-preview').textContent = T('输入新值后可预览影响条目数。'); return; }
      var affected = bulkEditPapers.filter(function (p) {
        return bulkEditCurrentValue(p, field) !== (clear ? '' : value);
      }).length;
      $('#bulk-edit-preview').textContent = T('将影响 ') + affected + ' / ' + bulkEditPapers.length + T(' 篇') + (clear ? T('（清空 ') + field + '）' : '');
    }
    function confirmBulkEdit() {
      var field = $('#bulk-edit-field').value;
      var clear = $('#bulk-edit-clear').checked;
      var value = $('#bulk-edit-value').value.trim();
      if (!clear && !value) { toast(T('请输入新值或勾选「明确清空」')); return; }
      var changed = 0;
      var undoBefore = makeSnapshot({ papers: bulkEditPapers.map(function (p) { return p.id; }) });
      bulkEditPapers.forEach(function (p) {
        var next = clear ? '' : value;
        if (bulkEditCurrentValue(p, field) === next) return;
        if (field === 'status') {
          if (['unread', 'reading'].indexOf(next) === -1 && !clear) return;
          p.status = clear ? 'unread' : next;
        } else if (field === 'rating') {
          var r = clear ? 0 : Number(next);
          if (!Number.isFinite(r) || r < 0 || r > 5) return;
          p.rating = Math.trunc(r);
        } else if (field === 'year') {
          var y = clear ? null : Number(next);
          p.year = y != null && Number.isFinite(y) && y >= 1000 && y <= 3000 ? Math.trunc(y) : null;
          if (!clear && p.year == null) return;
          p.date = p.year != null ? String(p.year) : '';
        } else if (field === 'tags') {
          p.tags = clear ? [] : model.cleanTags(next.split(/[,，]/));
        } else if (field === 'authors') {
          var preservedCreators = (p.creators || []).filter(function (creator) { return creator.creatorType !== 'author'; });
          var authorCreators = clear ? [] : next.split(/\r?\n/).map(function (line) {
            return model.parseCreatorName(line.trim());
          }).filter(Boolean);
          authorCreators.forEach(function (creator) { creator.creatorType = 'author'; });
          p.creators = preservedCreators.concat(authorCreators);
          var norm = model.normalizePaper(p);
          norm.id = p.id;
          Object.keys(p).forEach(function (k) { delete p[k]; });
          Object.assign(p, norm);
        } else {
          if (!clear && ['title', 'venue', 'doi', 'abstract', 'language'].indexOf(field) === -1) return;
          p[field] = next;
        }
        model.touch(p);
        changed++;
      });
      commitUndo(T('批量编辑') + field, undoBefore, { papers: bulkEditPapers.map(function (p) { return p.id; }) });
      save(); renderAll();
      $('#bulk-edit-mask').hidden = true;
      toast(T('✓ 批量编辑完成：') + changed + T(' 篇已更新'));
    }

    $('#btn-query-builder').addEventListener('click', openQueryBuilder);
    $('#qb-add-row').addEventListener('click', function () {
      qbRows.push({ join: 'AND', kind: 'field', field: 'title', cmp: ':', value: '' });
      renderQbRows();
    });
    $('#qb-cancel').addEventListener('click', function () { $('#query-builder-mask').hidden = true; });
    $('#qb-apply').addEventListener('click', function () {
      var text = query ? query.rowsToText(qbRows) : '';
      if (text) {
        var parsed = query.parseAst(text);
        if (parsed.error) { toast(T('语法错误：') + parsed.error); return; }
      }
      $('#search').value = text;
      state.filters.q = text;
      state.tablePage = 0;
      $('#query-builder-mask').hidden = true;
      renderAll();
    });
    $('#bulk-edit-cancel').addEventListener('click', function () { $('#bulk-edit-mask').hidden = true; });
    $('#bulk-edit-confirm').addEventListener('click', confirmBulkEdit);
    $('#bulk-edit-field').addEventListener('change', updateBulkEditView);
    $('#bulk-edit-value').addEventListener('input', updateBulkEditPreview);
    $('#bulk-edit-clear').addEventListener('change', updateBulkEditPreview);


    var api = {
      open: openQueryBuilder,
      openBulkEdit: openBulkEdit,
      stateForTest: function () { return { qbRows: qbRows, bulkEditPapers: bulkEditPapers }; }
    };
    return api;
  }

  return { create: create };
});
