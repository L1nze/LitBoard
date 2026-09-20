/* LitBoard CSL 文档上下文引用服务（阶段二）：有状态的引文文档会话（浏览器 / Node 共用）
 *
 * 在 js/cslcite.js 的一次性渲染之上提供「文档」抽象：
 * - 引文集群按文档顺序登记，任何增删/移动/换样式都经 citeproc rebuildProcessorState 统一重算
 *   （编号、同年消歧、ibid、et-al 全部由引擎处理）；
 * - 每个引文条目携带 CSL-JSON 快照，文献暂时不在当前库时文档仍可读、可刷新，
 *   库内重新出现后经 updateLibrary 自动重新关联；
 * - 状态可序列化（toJSON/fromJSON），即计划中的 CitationCluster 文档内表示。
 */
(function (root, factory) {
  var csl = null;
  if (typeof module === 'object' && module.exports) csl = require('./cslcite.js');
  else csl = root && root.LitCsl;
  var api = factory(csl);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitCslDoc = api;
})(typeof window !== 'undefined' ? window : null, function (LitCsl) {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  function text(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  /* 西文条目「等」→ et al.（修正逻辑在 cslcite.fixLatinEtAl；浏览器端 LitCsl 恒在，Node 侧软依赖） */
  function applyEtAl(value) {
    return LitCsl && typeof LitCsl.fixLatinEtAl === 'function' ? LitCsl.fixLatinEtAl(value) : value;
  }

  var SCHEMA_VERSION = 1;

  /**
   * 创建一个引文文档会话。
   * options = { styleXml, localeXml, styleId, localeId }
   *
   * 会话恒以 citeproc 的 html 形态输出：引文编号、合并、同年消歧都来自 rebuildProcessorState，
   * 而它对 setOutputFormat 免疫、一律返回 HTML（citeproc 1.4.61 实测）。写进 Word 需要的 RTF
   * 由 cslcite.htmlToRtf 在出口转换，所以这里不提供 outputFormat 选项。
   */
  function createDocument(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var styleXml = text(opts.styleXml);
    var localeXml = text(opts.localeXml);
    var styleId = text(opts.styleId) || 'custom';
    var localeId = text(opts.localeId) || '';
    if (!styleXml) throw new Error(T('缺少 CSL 样式 XML'));

    // 文档顺序的引文集群：{ citationId, citationItems, properties }
    var citations = [];
    var byId = {};
    // 库条目缓存：paperId → cslItem（updateLibrary 刷新）
    var library = {};
    var texts = {};   // citationId → 最新渲染文本
    var engine = null;

    function loadCSL() {
      if (!LitCsl || typeof LitCsl.loadCiteproc !== 'function') return Promise.reject(new Error(T('LitCsl 不可用')));
      return LitCsl.loadCiteproc();
    }

    function ensureEngine(CSL) {
      if (!engine) {
        var sys = {
          retrieveLocale: function () { return localeXml; },
          retrieveItem: function (id) {
            // 优先库内条目，回退到引文条目的 CSL 快照（文献暂不在库）
            if (library[id]) return library[id];
            for (var i = 0; i < citations.length; i++) {
              var items = citations[i].citationItems;
              for (var j = 0; j < items.length; j++) {
                if (String(items[j].id) === String(id) && items[j].cslItem) return items[j].cslItem;
              }
            }
            return null;
          }
        };
        engine = new CSL.Engine(sys, styleXml);
      }
      return engine;
    }

    /** 统一重算：全部引文文本 + 参考文献表。返回 { texts: {citationId: text} } */
    function rebuild(CSL) {
      engine = null; // rebuildProcessorState 要求干净引擎
      ensureEngine(CSL);
      // 仅脚注制使用 noteIndex；缺省按文档顺序补齐（Word 侧下一轮传真实脚注号）
      if (engine.opt && engine.opt.xclass === 'note') {
        citations.forEach(function (cluster, index) {
          if (cluster.properties.noteIndex == null) cluster.properties.noteIndex = index + 1;
        });
      }
      var result = engine.rebuildProcessorState(citations) || [];
      texts = {};
      result.forEach(function (entry) {
        // 返回项为 [citationID, noteIndex|null, text]（脚注制多中间项），文本恒在末位
        texts[String(entry[0])] = entry[entry.length - 1];
      });
      // 参考文献表按首次出现顺序
      var order = [];
      citations.forEach(function (citation) {
        citation.citationItems.forEach(function (item) {
          var key = String(item.id);
          if (order.indexOf(key) === -1) order.push(key);
        });
      });
      engine.updateItems(order);
      return texts;
    }

    /** 把库内条目的最新数据写回各引文快照（「更新文献 → 刷新」） */
    function refreshSnapshots() {
      citations.forEach(function (citation) {
        citation.citationItems.forEach(function (item) {
          if (library[String(item.id)]) item.cslItem = clone(library[String(item.id)]);
        });
      });
    }

    function normalizeClusterInput(input) {
      var items = Array.isArray(input && input.items) ? input.items
        : (Array.isArray(input && input.paperIds) ? input.paperIds.map(function (id) { return { paperId: id }; }) : []);
      return items.map(function (raw) {
        var paperId = text(raw.paperId || raw.id);
        var item = {
          id: paperId,
          paperId: paperId,
          locator: raw.locator != null ? String(raw.locator) : '',
          label: text(raw.label),
          prefix: text(raw.prefix),
          suffix: text(raw.suffix),
          'suppress-author': raw.suppressAuthor === true || raw['suppress-author'] === true
        };
        // CSL 数据快照：库内现值优先（若库中存在该文献），其次调用方显式给的快照
        if (library[paperId]) item.cslItem = clone(library[paperId]);
        else if (raw.cslItem && typeof raw.cslItem === 'object') item.cslItem = clone(raw.cslItem);
        return item;
      }).filter(function (item) { return !!item.paperId; });
    }

    var doc = {
      /** 刷新库条目（papers → cslItem，id 统一为 paperId；整体替换，缺失文献的引文靠快照继续工作） */
      updateLibrary: function (papers) {
        library = {};
        (Array.isArray(papers) ? papers : []).forEach(function (paper) {
          if (!paper || !paper.id) return;
          var item = LitCsl.paperToCslItemFull(paper);
          item.id = text(paper.id);
          library[item.id] = item;
        });
        refreshSnapshots();
        return loadCSL().then(function (CSL) { rebuild(CSL); return doc; });
      },

      /** 在 toIndex（缺省末尾）插入引文集群。input = { items:[{paperId, locator, label, prefix, suffix, suppressAuthor, cslItem?}], noteIndex? } */
      addCitation: function (input, toIndex) {
        var citationItems = normalizeClusterInput(input);
        if (!citationItems.length) return Promise.reject(new Error(T('引文集群为空')));
        var citationId = 'cit_' + Math.random().toString(36).slice(2, 10);
        var cluster = {
          citationID: citationId,
          citationItems: citationItems,
          properties: input && input.noteIndex != null ? { noteIndex: Number(input.noteIndex) } : {}
        };
        var index = toIndex == null ? citations.length : Math.max(0, Math.min(citations.length, Number(toIndex)));
        citations.splice(index, 0, cluster);
        byId[citationId] = cluster;
        return loadCSL().then(function (CSL) {
          rebuild(CSL);
          return { citationId: citationId, text: texts[citationId] };
        });
      },

      /** 就地更新集群内容（定位符/前后缀/省略作者/条目集合） */
      updateCitation: function (citationId, patch) {
        var cluster = byId[citationId];
        if (!cluster) return Promise.reject(new Error(T('引文不存在：') + citationId));
        var next = patch && (patch.items || patch.paperIds) ? normalizeClusterInput(patch) : cluster.citationItems;
        if (!next.length) return Promise.reject(new Error(T('引文集群为空')));
        cluster.citationItems = next;
        if (patch && patch.noteIndex != null) cluster.properties.noteIndex = Number(patch.noteIndex);
        return loadCSL().then(function (CSL) {
          rebuild(CSL);
          return { citationId: citationId, text: texts[citationId] };
        });
      },

      /** 删除集群；其余引文统一重算（数字制重编号） */
      removeCitation: function (citationId) {
        var index = citations.findIndex(function (c) { return c.citationID === citationId; });
        if (index === -1) return Promise.resolve({ removed: false });
        citations.splice(index, 1);
        delete byId[citationId];
        delete texts[citationId];
        return loadCSL().then(function (CSL) {
          rebuild(CSL);
          return { removed: true, texts: clone(texts) };
        });
      },

      /** 移动集群到文档顺序 toIndex（数字制重编号） */
      moveCitation: function (citationId, toIndex) {
        var from = citations.findIndex(function (c) { return c.citationID === citationId; });
        if (from === -1) return Promise.reject(new Error(T('引文不存在：') + citationId));
        var cluster = citations.splice(from, 1)[0];
        var index = Math.max(0, Math.min(citations.length, Number(toIndex)));
        citations.splice(index, 0, cluster);
        return loadCSL().then(function (CSL) {
          rebuild(CSL);
          return { citationId: citationId, text: texts[citationId] };
        });
      },

      /** 换样式：重建引擎并统一重算。options = { styleId, localeXml } */
      setStyle: function (nextStyleXml, nextOptions) {
        if (text(nextStyleXml)) styleXml = text(nextStyleXml);
        if (nextOptions && text(nextOptions.localeXml)) localeXml = text(nextOptions.localeXml);
        if (nextOptions && text(nextOptions.styleId)) styleId = text(nextOptions.styleId);
        return loadCSL().then(function (CSL) {
          rebuild(CSL);
          return doc;
        });
      },

      getCitationText: function (citationId) { return applyEtAl(texts[citationId] || ''); },

      /** 参考文献表（HTML 条目数组） */
      getBibliography: function () {
        if (!engine) return [];
        var bib = engine.makeBibliography();
        return ((bib && bib[1]) || []).map(function (entry) { return applyEtAl(entry); });
      },

      /**
       * 参考文献表的段落格式（单位 twips，÷20 = 磅；lineSpacing 为行距倍数）。
       * 规则照 Zotero `Zotero.Cite.getBibliographyFormatParameters`：
       * - hanging-indent → 左缩进 720 / 首行 -720（0.5 英寸）
       * - 否则 second-field-align → alignAt = 24 + maxoffset*120：flush 时左缩进取 alignAt
       *   并在同位置放制表位（对应条目里的 [1]\tab），margin 时不缩进、制表位在 0
       * - 段后距 = 240 * entryspacing（0 = 不设），行距倍数 = linespacing
       */
      getBibliographyFormat: function () {
        var format = { indent: 0, firstLineIndent: 0, lineSpacing: 0, entrySpacing: 0, tabStops: [] };
        if (!engine) return format;
        var params = (engine.makeBibliography() || [])[0] || {};
        format.lineSpacing = Number(params.linespacing) || 0;
        format.entrySpacing = 240 * (Number(params.entryspacing) || 0);
        if (params.hangingindent) {
          format.indent = 720;
          format.firstLineIndent = -720;
        } else if (params['second-field-align']) {
          var alignAt = 24 + (Number(params.maxoffset) || 0) * 120;
          format.firstLineIndent = -alignAt;
          if (params['second-field-align'] === 'margin') {
            format.tabStops = [0];
          } else {
            format.indent = alignAt;
            format.tabStops = [alignAt];
          }
        }
        return format;
      },

      /** 库中已缺失、仅靠快照渲染的条目 id（重新关联的候选） */
      missingItemIds: function () {
        var missing = {};
        citations.forEach(function (citation) {
          citation.citationItems.forEach(function (item) {
            if (!library[String(item.id)]) missing[String(item.id)] = true;
          });
        });
        return Object.keys(missing);
      },

      /** 重新关联：为某条目注入库内最新数据（paper 或显式 cslItem） */
      relink: function (paperId, paper) {
        if (paper && typeof paper === 'object') {
          var item = LitCsl.paperToCslItemFull(paper);
          item.id = text(paperId || paper.id);
          library[item.id] = item;
        }
        refreshSnapshots();
        return loadCSL().then(function (CSL) {
          rebuild(CSL);
          return doc;
        });
      },

      citationCount: function () { return citations.length; },
      styleId: function () { return styleId; },
      localeId: function () { return localeId; },

      /** 批量灌入集群（fromJSON 用）；clusters = [{id, noteIndex, items:[{paperId, locator, label, prefix, suffix, suppressAuthor, cslItem?}]}] */
      restore: function (clusters) {
        citations = [];
        byId = {};
        texts = {};
        (Array.isArray(clusters) ? clusters : []).forEach(function (raw, index) {
          var items = normalizeClusterInput({ items: raw.items });
          if (!items.length) return;
          var citationId = text(raw.id) || ('cit_' + Math.random().toString(36).slice(2, 10));
          var cluster = {
            citationID: citationId,
            citationItems: items,
            properties: { noteIndex: raw.noteIndex != null ? Number(raw.noteIndex) : index + 1 }
          };
          citations.push(cluster);
          byId[citationId] = cluster;
        });
        refreshSnapshots();
        return loadCSL().then(function (CSL) {
          rebuild(CSL);
          return doc;
        });
      },

      /**
       * 序列化（CitationCluster 文档内表示）。
       * 输出可直接嵌进 docx 域 payload 或独立保存。
       */
      toJSON: function () {
        return {
          version: SCHEMA_VERSION,
          styleId: styleId,
          localeId: localeId,
          citations: citations.map(function (cluster) {
            return {
              id: cluster.citationID,
              noteIndex: cluster.properties.noteIndex,
              items: cluster.citationItems.map(function (item) {
                return {
                  paperId: item.paperId,
                  locator: item.locator,
                  label: item.label,
                  prefix: item.prefix,
                  suffix: item.suffix,
                  suppressAuthor: !!item['suppress-author'],
                  cslItem: item.cslItem || null
                };
              })
            };
          })
        };
      }
    };
    return doc;
  }

  /**
   * 从序列化状态恢复会话（样式 XML 由调用方按 styleId 提供）。返回 Promise<doc>。
   * json = toJSON() 的输出（或域 payload 里的 citations 数组 + 文档级 styleId/localeId）。
   */
  function fromJSON(json, options) {
    var data = typeof json === 'string' ? JSON.parse(json) : (json || {});
    var doc = createDocument(options || {});
    return doc.restore(Array.isArray(data) ? data : (data.citations || [])).then(function () { return doc; });
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    createDocument: createDocument,
    fromJSON: fromJSON
  };
});
