/* LitBoard Word 写作面板：COM 桥检测 / 引文插入（文献多选弹窗 + RTF 出口）/
 * 刷新重算 / 参考文献表 / 解除关联副本 / Zotero 引文转换；CSL 样式按文档记忆，
 * 自定义样式存 localStorage（custom- 前缀）。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitWordPanel = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function create(options) {
    var T = options.T;
    var $ = options.$;
    var toast = options.toast;
    var dlgPrompt = options.dlgPrompt;
    var dlgConfirm = options.dlgConfirm;
    var desktop = options.desktop();
    var state = options.state;
    var normHit = options.normHit || function (s) { return String(s == null ? '' : s).toLowerCase(); };
    var store = options.localStorage || localStorage;
    var csl = options.csl || (typeof window !== 'undefined' ? window.LitCsl : null);
    var csldoc = options.csldoc || (typeof window !== 'undefined' ? window.LitCslDoc : null);
    var docx = options.docx || (typeof window !== 'undefined' ? window.LitDocx : null);
    var query = options.query || (typeof window !== 'undefined' ? window.LitQuery : null);
    var citeSplitName = options.citeSplitName || null;

    function b64utf8(s) {
      var bytes = new TextEncoder().encode(String(s == null ? '' : s));
      var bin = '';
      bytes.forEach(function (b) { bin += String.fromCharCode(b); });
      return btoa(bin);
    }
    function unb64(s) {
      var bin = atob(String(s || ''));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    function wordFail(error) {
      $('#word-status').textContent = '⚠ ' + (error && error.message || String(error));
      toast('⚠ Word：' + (error && error.message || error));
    }
    function wordDetect() {
      if (!desktop || !desktop.wordInvoke) { wordFail(new Error(T('当前版本不支持 Word 集成'))); return; }
      $('#word-status').textContent = T('正在连接 Word…');
      desktop.wordInvoke({ line: 'INFO', timeout: 20000 }).then(function (rest) {
        var parts = String(rest || '').split('|');
        var version = parts[0] ? unb64(parts[0]) : '';
        var names = (parts[2] || '').split(';').filter(Boolean).map(unb64);
        var select = $('#word-doc-select');
        select.innerHTML = '';
        names.forEach(function (name) {
          var opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name.split(/[\\/]/).pop();
          select.appendChild(opt);
        });
        if (!names.length) {
          var empty = document.createElement('option');
          empty.value = '';
          empty.textContent = T('（Word 中没有打开的文档）');
          select.appendChild(empty);
        }
        $('#word-status').textContent = version
          ? T('已连接 Word ') + version + T('，打开文档 ') + names.length + T(' 个。') +
            T('插入引文前请把光标放到目标位置；引文格式跟随 LitBoard 当前 CSL 样式。')
          : T('未检测到正在运行的 Microsoft Word；请打开 Word 与目标文档后重新点击「检测 Word」。');
        wordSyncStyleSelect();
      }).catch(wordFail);
    }
    function wordTargetPath() {
      var path = $('#word-doc-select').value;
      if (!path) throw new Error(T('请先在 Word 中打开一个文档并重新检测'));
      return path;
    }
    function wordParseFieldsPayloads(codes) {
      // 域指令 → CitationCluster payload（与 docx.readDocxFields 同一契约）
      return codes.map(function (code) {
        var m = /^\s*ADDIN\s+LitBoard\.Citation\.1\s+"([\s\S]*)"\s*$/.exec(String(code || '').trim());
        if (!m) return null;
        try { return JSON.parse(m[1]); } catch (e) { return null; }
      }).filter(Boolean);
    }
    function wordCurrentStyle(documentId) {
      var styleMap = {};
      try { styleMap = JSON.parse(store.getItem('litboard.wordStyles') || '{}') || {}; } catch (e) {}
      var styleId = styleMap[documentId] || store.getItem('litboard.cslStyle') || 'apa';
      var localePromise = fetch('vendor/citeproc/locales/zh-CN.xml').then(function (r) { return r.text(); });
      var custom = wordCustomStyles()[styleId];
      if (custom) {
        return localePromise.then(function (localeXml) {
          return { styleXml: custom.xml, localeXml: localeXml, styleId: styleId };
        });
      }
      var isBuiltin = csl.BUILTIN_STYLES.some(function (s) { return s.id === styleId; });
      var stylePromise = isBuiltin
        ? fetch('vendor/citeproc/styles/' + styleId + '.csl').then(function (r) {
            if (!r.ok) throw new Error(T('样式文件缺失'));
            return r.text();
          })
        : desktop.fetchCslStyle(styleId);
      return Promise.all([stylePromise, localePromise])
        .then(function (texts) { return { styleXml: texts[0], localeXml: texts[1], styleId: styleId }; });
    }
    /** 从文档现有域重建 csldoc 会话（统一刷新/参考文献表/插入的渲染口径） */
    function wordBuildSession(payloads, documentId) {
      return wordCurrentStyle(documentId).then(function (env) {
        var doc = csldoc.createDocument({ styleXml: env.styleXml, localeXml: env.localeXml, styleId: env.styleId, localeId: 'zh-CN' });
        return doc.updateLibrary(state.papers.filter(function (p) { return !p.deletedAt; })).then(function () {
          return doc.restore(payloads).then(function () { return doc; });
        });
      });
    }
    /* Word 的域结果只认纯文本：citeproc 的 HTML 得先转成 RTF（上标/斜体/小型大写才真正生效），
       再包成最小 RTF 文档交给桥用 InsertFile 读进域——桥按 '{\rtf' 前缀识别，纯文本回退不受影响。 */
    function wordRtfDocument(html) { return '{\\rtf ' + csl.htmlToRtf(html) + '}'; }
    /* 参考文献条目：转成 RTF 片段后逐条交给桥（桥负责 \par 连接与外层包装） */
    function wordRtfEntries(entries) {
      return (entries || []).map(function (entry) { return b64utf8(csl.htmlToRtf(entry)); });
    }
    /* 参考文献段落格式负载：'rtf,indent,firstLineIndent,entrySpacing,lineSpacing,tabStops'
       （twips；行距是倍数：1 = 单倍，不设时不发送） */
    function wordBibliographyFormatSpec(session) {
      var format = session.getBibliographyFormat();
      return ['rtf', format.indent, format.firstLineIndent, format.entrySpacing, format.lineSpacing, format.tabStops.join('+')].join(',');
    }
    function wordRefresh() {
      try { wordTargetPath(); } catch (e) { wordFail(e); return; }
      var path = $('#word-doc-select').value;
      $('#word-status').textContent = T('正在读取文档引文域…');
      desktop.wordInvoke({ line: 'FIELDS|' + b64utf8(path) })
        .then(function (rest) {
          var parts = String(rest).split('|');
          var fields = (parts[1] || '').split(';').filter(Boolean).map(function (item) {
            var pair = item.split('~');
            return { code: unb64(pair[0] || ''), text: unb64(pair[1] || '') };
          });
          if (!fields.length) { toast(T('该文档没有 LitBoard 引文域')); $('#word-status').textContent = T('文档中没有 LitBoard 引文域。'); return; }
          var payloads = wordParseFieldsPayloads(fields.map(function (f) { return f.code; }));
          return wordBuildSession(payloads, path).then(function (session) {
            var clusters = session.toJSON().citations;
            var texts = clusters.map(function (c) { return b64utf8(wordRtfDocument(session.getCitationText(c.id))); });
            // 快照回写：会话已用库内最新文献刷新 cslItem，同时更新域内嵌快照（F10）
            var codes = clusters.map(function (c) { return b64utf8(JSON.stringify({ version: 1, items: c.items })); });
            // 参考文献条目按 rtf 片段原样传递（剥标签会连 \tab/\super 一起毁掉）；
            // 段落格式由会话按 CSL 样式算出，桥负责落到 Word 段落格式
            var bib = wordRtfEntries(session.getBibliography());
            var line = 'APPLY|' + b64utf8(path) + '|' + texts.join(';') + '|' + bib.join(';') + '|' + codes.join(';') +
              '|' + wordBibliographyFormatSpec(session);
            return desktop.wordInvoke({ line: line, timeout: 60000 }).then(function () {
              var missing = session.missingItemIds();
              $('#word-status').textContent = T('✓ 已刷新 ') + clusters.length + T(' 个引文') +
                (bib.length ? T('，参考文献表 ') + bib.length + T(' 条') : '') +
                (missing.length ? T('；有 ') + missing.length + T(' 条文献不在库中（按文档内快照渲染）') : '');
              toast(T('✓ Word 引文已刷新'));
            });
          });
        }).catch(wordFail);
    }
    /* Word 引文插入：文献多选弹窗（勾选顺序即同一处引文的合并顺序） */
    var wordCiteChosen = {};
    var wordCiteHayCache = null;
    /* 检索 haystack：标题 + 年份 + 作者的多种形态（姓/名分列、姓名倒序、「王, 小明」→「王小明」去分隔形态），
       走 normalizeForSearch 折叠大小写/变音符/全半角；按 paperId 缓存，弹窗打开时重置 */
    function wordCiteHaystack(p) {
      if (!wordCiteHayCache) wordCiteHayCache = {};
      var hit = wordCiteHayCache[p.id];
      if (hit != null) return hit;
      var parts = [String(p.title || ''), String(p.year == null ? '' : p.year)];
      (p.authors || []).forEach(function (a) {
        var n = citeSplitName ? citeSplitName(a) : { family: String(a || ''), given: '' };
        var fam = String(n.family || ''), giv = String(n.given || '');
        parts.push(String(a || ''), fam, giv, giv + ' ' + fam, String(a || '').replace(/[,\s，]+/g, ''));
      });
      hit = normHit(parts.join(' '));
      wordCiteHayCache[p.id] = hit;
      return hit;
    }
    function wordCiteUpdateCount() {
      $('#word-cite-count').textContent = T('已选 ') + Object.keys(wordCiteChosen).length + T(' 篇');
    }
    /* 检索走主检索框那一套：带语法的查询（tag: / year>= / 引号短语 / OR / 正则…）交给
       js/query.js 的 AST 求值，语法写错则退回本弹窗的「分词 AND 子串」并挂出提示。
       纯关键词也走分词路径——本弹窗的 haystack 比引擎多认年份与姓名倒序写法，
       挑引文时按年份找人是最常见的用法，不该因为换了引擎就搜不到。 */
    function renderWordCiteList() {
      var raw = String($('#word-cite-search').value || '').trim();
      var syntax = !!(raw && query && !query.isPlainText(raw));
      var parsed = null;
      if (syntax) {
        parsed = query.parse(raw);
        if (parsed.error) parsed = null;
      }
      var hint = $('#word-cite-hint');
      if (hint) {
        var badSyntax = syntax && !parsed;
        if (badSyntax) hint.textContent = T('检索语法有误，已按普通子串搜索（点搜索框旁的 ? 查看语法速查）');
        hint.hidden = !badSyntax;
      }
      var queryNorm = normHit(raw);
      var tokens = queryNorm ? queryNorm.split(/\s+/).filter(Boolean) : [];
      var box = $('#word-cite-list');
      box.innerHTML = '';
      var rendered = 0;
      state.papers.forEach(function (p) {
        if (p.deletedAt) return;
        if (raw) {
          if (parsed) { if (!parsed.matcher(p)) return; }
          else if (!tokens.every(function (t) { return wordCiteHaystack(p).indexOf(t) !== -1; })) return;
        }
        rendered++;
        var label = (p.authors && p.authors.length ? String(p.authors[0]).split(',')[0] : T('匿名')) +
          (p.year ? ', ' + p.year : '') + ' · ' + String(p.title || '').slice(0, 60);
        var row = document.createElement('div');
        row.className = 'excerpt-item wordcite-row' + (wordCiteChosen[p.id] ? ' wordcite-row-on' : '');
        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !!wordCiteChosen[p.id];
        var quote = document.createElement('span');
        quote.className = 'excerpt-item-quote';
        quote.textContent = label;
        row.appendChild(checkbox);
        row.appendChild(quote);
        checkbox.addEventListener('change', function () {
          if (checkbox.checked) wordCiteChosen[p.id] = true;
          else delete wordCiteChosen[p.id];
          row.classList.toggle('wordcite-row-on', checkbox.checked);
          wordCiteUpdateCount();
        });
        row.addEventListener('click', function () {
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        });
        box.appendChild(row);
      });
      if (!rendered && raw) {
        // 搜索无命中：别静默空白——给提示，计数如实归零
        var emptyRow = document.createElement('div');
        emptyRow.className = 'excerpt-item wordcite-row wordcite-empty';
        emptyRow.textContent = T('没有匹配文献');
        box.appendChild(emptyRow);
        var countEl = $('#word-cite-count');
        if (countEl) countEl.textContent = T('0 / 共 0');
        return;
      }
      wordCiteUpdateCount();
    }
    function wordInsertCitation() {
      try { wordTargetPath(); } catch (e) { wordFail(e); return; }
      var live = state.papers.filter(function (p) { return !p.deletedAt; });
      if (!live.length) { toast(T('文献库为空')); return; }
      wordCiteChosen = {};
      wordCiteHayCache = null;
      $('#word-cite-search').value = '';
      renderWordCiteList();
      $('#word-cite-mask').hidden = false;
    }
    function wordInsertCitationConfirm() {
      var targetPath;
      try { targetPath = wordTargetPath(); } catch (e) { wordFail(e); return; }
      var items = state.papers.filter(function (p) { return !p.deletedAt && wordCiteChosen[p.id]; })
        .map(function (p) { return { paperId: p.id }; });
      if (!items.length) { toast(T('请先勾选要引用的文献')); return; }
      $('#word-cite-mask').hidden = true;
      $('#word-status').textContent = T('正在渲染引文…');
      var payload = { version: 1, items: items };
      wordBuildSession([payload], targetPath).then(function (session) {
        var cluster = session.toJSON().citations[0];
        var text = wordRtfDocument(session.getCitationText(cluster.id));
        return desktop.wordInvoke({ command: 'INSERT', documentId: targetPath,
          args: { payload: JSON.stringify(cluster), text: text }, timeout: 30000 })
          .then(function () {
            $('#word-status').textContent = T('已插入 ') + items.length + T(' 条，正在按全文顺序重算引文编号…');
            wordRefresh(); // 插入后立即按文档序重算（数字制编号与既有引文顺序一致，F10）
            toast(T('✓ 已插入引文（') + items.length + T(' 篇）'));
          });
      }).catch(wordFail);
    }
    /* 引文格式：内置 CSL 样式；按目标文档记忆（litboard.wordStyles），未选文档时改全局默认。
     * 支持导入本地 .csl 自定义样式（localStorage 存 XML，key 前缀 custom-）。 */
    function wordStyleMap() {
      try { return JSON.parse(store.getItem('litboard.wordStyles') || '{}') || {}; } catch (e) { return {}; }
    }
    function wordCustomStyles() {
      try { return JSON.parse(store.getItem('litboard.customCslStyles') || '{}') || {}; } catch (e) { return {}; }
    }
    function wordImportCustomStyle() {
      if (!desktop || !desktop.chooseFiles || !desktop.readFileBytes) { wordFail(new Error(T('当前版本不支持导入'))); return; }
      desktop.chooseFiles({ title: T('选择 CSL 样式文件（.csl）') }).then(function (files) {
        if (!files || !files[0]) return;
        return desktop.readFileBytes(files[0]).then(function (bytes) {
          var xml = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
          if (!/<style[\s>]/.test(xml)) throw new Error(T('不是有效的 CSL 样式文件'));
          var m = /<title>([^<]+)<\/title>/.exec(xml);
          var title = (m ? m[1] : '').trim() || files[0].split(/[\\/]/).pop().replace(/\.csl$/i, '');
          var map = wordCustomStyles();
          var key = 'custom-' + Date.now().toString(36);
          var count = Object.keys(map).filter(function (k) { return map[k].title === title; }).length;
          if (count) key = Object.keys(map).find(function (k) { return map[k].title === title; }); // 同名重导入覆盖
          map[key] = { title: title, xml: xml };
          try { store.setItem('litboard.customCslStyles', JSON.stringify(map)); }
          catch (e) { throw new Error(T('样式过大或本地存储已满，无法保存')); }
          wordInitStyleSelect();
          var sel = $('#word-style-select');
          sel.value = key;
          sel.dispatchEvent(new Event('change'));
          $('#word-status').textContent = T('✓ 已导入样式「') + title + T('」，新插入引文立即生效。');
          toast(T('✓ 已导入 CSL 样式：') + title);
        });
      }).catch(wordFail);
    }
    function wordSyncStyleSelect() {
      var path = $('#word-doc-select').value;
      var styleId = (path ? wordStyleMap()[path] : null) || store.getItem('litboard.cslStyle') || 'apa';
      var sel = $('#word-style-select');
      var known = Array.prototype.some.call(sel.options, function (o) { return o.value === styleId; });
      sel.value = known ? styleId : 'apa';
      $('#word-style-hint').textContent = path ? T('格式跟随当前目标文档保存。') : '';
    }
    function wordInitStyleSelect() {
      var sel = $('#word-style-select');
      sel.innerHTML = '';
      csl.BUILTIN_STYLES.forEach(function (style) {
        var opt = document.createElement('option');
        opt.value = style.id;
        opt.textContent = style.label;
        sel.appendChild(opt);
      });
      var customs = wordCustomStyles();
      Object.keys(customs).forEach(function (key) {
        var opt = document.createElement('option');
        opt.value = key;
        opt.textContent = (customs[key].title || key) + T('（自定义）');
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () {
        var path = $('#word-doc-select').value;
        if (path) {
          var map = wordStyleMap();
          map[path] = sel.value;
          store.setItem('litboard.wordStyles', JSON.stringify(map));
          $('#word-style-hint').textContent = T('已切换（仅此文档）；已有引文点「刷新引文与参考文献表」按新格式重排。');
        } else {
          store.setItem('litboard.cslStyle', sel.value);
          $('#word-style-hint').textContent = T('未选目标文档，已设为全局默认引文格式。');
        }
      });
      wordSyncStyleSelect();
    }
    function wordBibliography() {
      try { wordTargetPath(); } catch (e) { wordFail(e); return; }
      var path = $('#word-doc-select').value;
      desktop.wordInvoke({ line: 'FIELDS|' + b64utf8(path) })
        .then(function (rest) {
          var parts = String(rest).split('|');
          var payloads = wordParseFieldsPayloads((parts[1] || '').split(';').filter(Boolean).map(function (item) { return unb64(item.split('~')[0] || ''); }));
          return wordBuildSession(payloads, path).then(function (session) {
            var bib = wordRtfEntries(session.getBibliography());
            if (!bib.length) { toast(T('没有可引用的文献（先插入引文）')); return; }
            return desktop.wordInvoke({ command: 'BIB', documentId: path, args: { entries: bib.join(';'), format: wordBibliographyFormatSpec(session) }, timeout: 30000 }).then(function () {
              toast(T('✓ 已插入参考文献表（') + bib.length + T(' 条）'));
            });
          });
        }).catch(wordFail);
    }
    function wordUnlink() {
      try { wordTargetPath(); } catch (e) { wordFail(e); return; }
      var path = $('#word-doc-select').value;
      dlgPrompt(T('副本文件名'), T('例如 manuscript-plain.docx（保存在原文档同目录）'), 'manuscript-plain.docx').then(function (name) {
        if (name == null) return;
        name = String(name).trim();
        if (!/\.docx$/i.test(name)) name += '.docx';
        var dir = path.replace(/[\\/][^\\/]*$/, '');
        var newPath = dir + '\\' + name.replace(/[\\/:*?"<>|]/g, '_');
        return desktop.wordInvoke({ line: 'UNLINKCOPY|' + b64utf8(path) + '|' + b64utf8(newPath), timeout: 30000 })
          .then(function () {
            $('#word-status').textContent = T('✓ 已生成解除关联副本：') + newPath;
            toast(T('✓ 已生成解除关联副本（原件未改动）'));
            wordDetect();
          });
      }).catch(wordFail);
    }
    function wordConvertZotero() {
      if (!desktop || !desktop.wordZoteroConvertRead) { wordFail(new Error(T('当前版本不支持转换'))); return; }
      desktop.chooseFiles({ filters: [{ name: T('Word 文档'), extensions: ['docx'] }] }).then(function (files) {
        if (!files || !files[0]) return;
        var source = files[0];
        return desktop.wordZoteroConvertRead(source).then(function (fields) {
          var keyToId = {};
          state.papers.forEach(function (p) { if (p.zoteroKey) keyToId[p.zoteroKey] = p.id; });
          var converted = docx.convertZoteroFields(fields, {
            resolveKey: function (key) { return keyToId[key] || null; }
          });
          var r = converted.report;
          var message = T('共识别 Zotero 引文 ') + r.citations + T(' 处：匹配库内文献 ') + r.matched +
            T('，未匹配 ') + r.unmatched + T('（保留嵌入快照，仍可读可刷新）。') +
            (r.missingKeys.length ? T('\n未匹配：') + r.missingKeys.slice(0, 10).join('、') : '');
          return dlgConfirm(T('转换 Zotero 引文'), message, T('生成 LitBoard 副本')).then(function (ok) {
            if (!ok) return;
            return dlgPrompt(T('副本文件名'), T('例如 manuscript-litboard.docx（保存在原文档同目录）'), 'manuscript-litboard.docx').then(function (name) {
              if (name == null) return;
              name = String(name).trim();
              if (!/\.docx$/i.test(name)) name += '.docx';
              var dir = source.replace(/[\\/][^\\/]*$/, '');
              var target = dir + '\\' + name.replace(/[\\/:*?"<>|]/g, '_');
              return desktop.wordZoteroConvertWrite({ source: source, target: target, fields: converted.fields })
                .then(function () {
                  toast(T('✓ 已生成转换副本：') + target + T('（原件未改动）'));
                  $('#word-status').textContent = T('✓ Zotero 引文转换完成：') + target;
                });
            });
          });
        });
      }).catch(wordFail);
    }

    function open() {
      $('#word-panel-mask').hidden = false;
      // 打开即检测一次：从外面进来没有「先点检测」的前置步骤，开箱就要能看到文档列表
      wordDetect();
    }
    function close() { $('#word-panel-mask').hidden = true; }

    function bind() {
      $('#word-detect').addEventListener('click', wordDetect);
    $('#word-insert-citation').addEventListener('click', wordInsertCitation);
    $('#word-refresh').addEventListener('click', wordRefresh);
    $('#word-bibliography').addEventListener('click', wordBibliography);
    $('#word-unlink').addEventListener('click', wordUnlink);
    $('#word-convert-zotero').addEventListener('click', wordConvertZotero);
    $('#word-cite-search').addEventListener('input', renderWordCiteList);
    $('#word-cite-cancel').addEventListener('click', function () { $('#word-cite-mask').hidden = true; });
    $('#word-cite-confirm').addEventListener('click', wordInsertCitationConfirm);
    $('#word-doc-select').addEventListener('change', wordSyncStyleSelect);
    $('#word-style-import').addEventListener('click', wordImportCustomStyle);
    wordInitStyleSelect();
      $('#word-panel-close').addEventListener('click', close);
      $('#word-panel-mask').addEventListener('click', function (e) { if (e.target === this) close(); });

    }

    var api = {
      bind: bind,
      close: close,
      open: open,
      stateForTest: function () { return { chosen: wordCiteChosen }; },
      _test: {
        b64utf8: b64utf8,
        unb64: unb64,
        haystack: wordCiteHaystack,
        renderCiteList: renderWordCiteList,
        parseFieldsPayloads: wordParseFieldsPayloads,
        styleMap: wordStyleMap,
        customStyles: wordCustomStyles
      }
    };
    return api;
  }

  return { create: create };
});
