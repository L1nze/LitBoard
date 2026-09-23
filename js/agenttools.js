/* LitBoard Agent 工具集（渲染层）：把现有检索能力包成模型可调用的只读工具
 *
 * 约定：
 * - 工具描述是给模型看的提示词（数据），不是界面文案——不走 T()，不进 i18n 词典；
 * - 一期全部只读：直执行、无确认门；写类工具（收藏/PDF）二期经 dlgConfirm 接入；
 * - 每个工具的返回都是已封顶的字符串（条数/摘要长度），大结果在源头截断。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitAgent = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var MAX_ITEMS = 20;
  var MAX_ABSTRACT = 2000;
  // R12：单次 read_pdf_pages 的正文预算——core 的工具结果上限是 12000 字符，
  // 超过会在 JSON 中部被硬截断（不可解析、后续页全丢）；在源头按预算裁页并给出 nextFrom
  var READ_PAGE_BUDGET = 10000;

  function schema(name, description, properties, required) {
    return {
      type: 'function',
      function: {
        name: name,
        description: description,
        parameters: {
          type: 'object',
          properties: properties,
          required: required || []
        }
      }
    };
  }

  var qProp = { type: 'string', description: '检索关键词（支持空格分隔多词，AND 匹配）' };
  var yearFromProp = { type: 'integer', description: '年份下限（含）' };
  var yearToProp = { type: 'integer', description: '年份上限（含）' };
  var limitProp = { type: 'integer', description: '返回条数上限（默认 20，最大 20）' };

  /** 联网文献检索默认偏新文献（对齐上游 literature-mcp 的 `publication_year=">2021"`）：
   *  不传 yearFrom 时只看 DEFAULT_MIN_YEAR 及以后；显式传 0 表示不限年份（要早期经典文献时用）。
   *  本地库检索（search_library / search_research）与段落找文献（find_literature）不加这个默认——
   *  用户自己的库和「论点证据」都不该被静默裁掉早期文献。 */
  var DEFAULT_MIN_YEAR = 2022;
  var yearFromNetProp = {
    type: 'integer',
    description: '年份下限（含）。**不传则默认 ' + DEFAULT_MIN_YEAR + '**（只看近年文献）；要覆盖更早的经典文献请显式传 0 = 不限年份'
  };
  function netYearFrom(args) {
    var raw = args && args.yearFrom;
    if (raw == null || raw === '') return DEFAULT_MIN_YEAR;
    var n = Number(raw);
    if (!isFinite(n) || n <= 0) return null; // 0 / 负数 / 非法 = 不限年份
    return Math.floor(n);
  }
  /** 应用了默认年份下限时如实回报，免得模型把「没检索到」说成「没有早期文献」 */
  function netYearNote(args, applied) {
    if (args && args.yearFrom != null && args.yearFrom !== '') return '';
    return applied
      ? '已按默认只看 ' + applied + ' 年以后的文献（要更早的文献请传 yearFrom: 0）'
      : '';
  }
  /** 把若干说明拼成一句（空串自动省略） */
  function joinNotes(list) {
    return list.filter(Boolean).join('；');
  }

  // 二期写类工具：执行前必须经过用户确认（agentui 在循环里拦截弹确认框）
  var WRITE_TOOLS = { collect_papers: true, download_pdfs: true, add_pdfs_to_folder: true };

  /** R08：动态写权限判定——除静态白名单外，fetch_page 带 paperId 即写正式库
   *  （落快照附件 + 全文索引 + save 管线），同样必须先经用户确认。 */
  function isWriteTool(name, args) {
    if (WRITE_TOOLS[name]) return true;
    if (name === 'fetch_page') return !!(args && String(args.paperId || '').trim());
    return false;
  }

  function createTools(deps) {
    var desktop = deps.desktop;

    function clampLimit(args) {
      var n = Number(args && args.limit);
      if (!isFinite(n) || n <= 0) n = MAX_ITEMS;
      return Math.min(MAX_ITEMS, Math.floor(n));
    }

    function paperHits(papers, q) {
      var terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
      return (papers || []).filter(function (p) { return p && !p.deletedAt; }).map(function (p) {
        var haystack = [
          p.title || '', (p.authors || []).join(' '), p.venue || '', (p.tags || []).join(' '),
          String(p.year || ''), p.doi || '', p.abstract || ''
        ].join('\n').toLowerCase();
        var score = 0;
        for (var i = 0; i < terms.length; i++) {
          if (haystack.indexOf(terms[i]) === -1) return null;
          score++;
        }
        return { paper: p, score: score };
      }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).map(function (hit) { return hit.paper; });
    }

    function paperSummary(p) {
      return {
        id: p.id,
        title: p.title || '',
        year: p.year || null,
        authors: (p.authors || []).slice(0, 3),
        venue: p.venue || '',
        doi: p.doi || '',
        tags: (p.tags || []).slice(0, 5)
      };
    }

    function workSummary(w) {
      return {
        workId: w.id,
        title: w.title || '',
        year: w.year || null,
        doi: w.doi || '',
        source: w.sourceName || '',
        citedBy: w.citedBy || 0
      };
    }

    var tools = [
      schema('search_library', '在用户的正式文献库（已收藏的文献）中按关键词检索标题/作者/期刊/标签/摘要。适合回答「我库里有没有关于…的文献」「我收藏过的某主题文献」。可用 folder 参数限定在某个文件夹内检索。', {
        query: qProp,
        folder: { type: 'string', description: '可选：限定检索范围的文件夹名称（如「PINN」）；未提供则全库检索' },
        limit: limitProp
      }, ['query']),
      schema('search_research', '在本地调研库（历次检索累积的全部文献元数据，通常远大于正式库）中检索标题与摘要全文。适合「调研库里关于…的文献」这类回顾性问题。', {
        query: qProp, yearFrom: yearFromProp, yearTo: yearToProp, limit: limitProp
      }, ['query']),
      schema('search_openalex', '联网检索 OpenAlex 发现新文献，结果自动存入本地调研库。mode=keyword（默认，词匹配，适合明确的术语/作者/标题）与 mode=semantic（整段自然语言按含义检索，官方基于标题/摘要向量）各有所长：查术语用 keyword，找「和这段话同主题」的用 semantic。默认只检索 ' + DEFAULT_MIN_YEAR + ' 年以后的文献（偏新文献）；要找更早的经典文献传 yearFrom: 0。', {
        query: qProp, yearFrom: yearFromNetProp, yearTo: yearToProp, limit: limitProp,
        mode: { type: 'string', description: '检索模式：keyword（默认）或 semantic（整段自然语言的语义检索）' }
      }, ['query']),
      schema('get_research_work', '按 workId 取调研库中一篇文献的完整信息（含摘要全文）。workId 来自 search_research / search_openalex 的结果。', {
        workId: { type: 'string', description: '调研库文献 ID（W 开头）' }
      }, ['workId']),
      schema('get_work', '精确解析一篇文献：输入 DOI（含 doi.org 链接）、OpenAlex ID（W 开头）或**精确标题**，返回该文献的元数据并入本地调研库。本地已有所需身份时不联网。适合用户直接给出 DOI/链接时；不确定的模糊/主题检索请改用 search_openalex。', {
        query: { type: 'string', description: 'DOI / doi.org 或 openalex.org 链接 / W 开头的 OpenAlex ID / 精确标题' }
      }, ['query']),
      schema('autocomplete_entity', '把作者/期刊/机构/出版商/资助方的**名称**联想成 OpenAlex ID（≤10 条候选）。适合用户说「查某某大学/某期刊的论文」：先用本工具拿 ID，再把 ID 放进检索或引图种子。', {
        entity: { type: 'string', description: '实体类型：authors | sources | institutions | publishers | funders' },
        query: { type: 'string', description: '名称（部分即可联想）' }
      }, ['entity', 'query']),
      schema('backfill_abstracts', '为调研库里**缺摘要**的文献批量补摘要（Crossref → Elsevier 逐级回退，回填即入库）。做大规模综述前先跑一遍可显著提高后续证据判断质量；返回补到的条数与停止原因。', {
        limit: { type: 'integer', description: '可选：本轮最多处理多少篇（默认 100）' }
      }, []),
      schema('read_work_fulltext', '读取一篇调研库文献的**开放获取全文正文**（仅文本参考）：首次调用会联网下载 OA PDF→抽取文本→**PDF 立即删除**，文本缓存在调研库（此后再读不再联网、并可被 search_research 全文命中）；正式库里已收藏的 PDF 请改用 read_pdf_pages。适合：需要具体实验细节、方法学步骤、参数方案而摘要不够时。全文较长，按窗口返回——带 nextFromChar 时用同一 workId + fromChar 续读。', {
        workId: { type: 'string', description: '调研库文献 ID（W 开头，来自检索结果）' },
        fromChar: { type: 'integer', description: '可选：续读偏移（上次返回的 nextFromChar）；首次不传' }
      }, ['workId']),
      schema('get_paper', '按 paperId 取正式库一篇文献的详细信息（标题/作者/摘要/标签，含附件清单与各自的 id/类型/文件名）。读取 PDF 前先看这里确认可读附件；attachmentId 来自本工具或 fulltext_search 结果。paperId 来自 search_library / fulltext_search 的结果。', {
        paperId: { type: 'string', description: '正式库文献 ID' }
      }, ['paperId']),
      schema('fulltext_search', '在正式库已建全文索引的 PDF / EPUB / 网页快照正文里检索，返回命中的文献与片段（含 attachmentId——继续读取时带上它可保持在同一份附件；EPUB 命中的 page 是章节序号）。适合「哪篇论文的正文里提到过…」。', {
        query: qProp, limit: limitProp
      }, ['query']),
      // AI 阅读助手（期一）：按页读正文与批注——解释选段/整篇问答的上下文来源
      schema('read_pdf_pages', '按页码区间读取一篇文献 PDF 的逐页正文文本（来自已建的全文索引，无需重新解析）。attachmentId 省略时自动读主 PDF（第一个 PDF 附件；没有 PDF 附件时读 EPUB 附件）。EPUB 附件的页 = spine 章节序号（第 1 章是第 1 页），同样支持区间与续读。适合：解释某页内容、理解上下文、回答「这篇第 N 部分讲了什么」。页码 1 起；一次最多 8 页，但单次结果有总字符预算——超预算带 truncated:true 与 nextFrom/nextFromChar（nextFromChar 是页内偏移：单页文字很长被截断时，用同一页码 + fromChar 续读该页余下部分，不必重读整页）。返回「没有找到该附件的全文索引」说明尚未建索引，可在 设置 → 数据与备份 → 全文索引 构建。', {
        paperId: { type: 'string', description: '正式库文献 ID（来自 get_paper / fulltext_search / 当前文献上下文）' },
        from: { type: 'integer', description: '起始页码（含），1 起' },
        to: { type: 'integer', description: '结束页码（含），与 from 相差不超过 7' },
        attachmentId: { type: 'string', description: '可选：附件 ID（读补充材料等非主 PDF 时必填；get_paper 返回附件清单）' },
        fromChar: { type: 'integer', description: '可选：起始页的页内字符偏移（上次返回的 nextFromChar）；首次不传' }
      }, ['paperId', 'from', 'to']),
      schema('summarize_paper', '梳理一篇文献的完整研究逻辑链时使用（例如“梳理整篇”“完整解读这篇论文”）。工具分批读取正文并返回续读位置；必须持续调用到 complete=true，不能仅凭摘要或部分页面声称已读全文。首次调用只传 paperId，可选 attachmentId；之后按返回的 nextFrom/nextFromChar 续读。', {
        paperId: { type: 'string', description: '文献库 ID；用户说“这篇”时使用当前文献上下文中的 paperId' },
        attachmentId: { type: 'string', description: '可选：要梳理的 PDF / EPUB 附件 ID；省略时选主 PDF，若没有则选 EPUB' },
        from: { type: 'integer', description: '续读页码；首次不传，之后使用上次返回的 nextFrom' },
        fromChar: { type: 'integer', description: '续读页内字符偏移；首次不传，之后使用上次返回的 nextFromChar（若有）' }
      }, ['paperId']),
      schema('list_pdf_annotations', '列出用户在某一篇文献 PDF 上做过的批注（高亮/下划线/笔记），含页码、划选文本、批注 id 与所属 attachmentId（主 PDF/补充材料/EPUB 不混淆）。超过 50 条时带 total 与 nextOffset，用 offset 续取。适合「我标过什么」「结合我的批注讲讲这篇」。', {
        paperId: { type: 'string', description: '正式库文献 ID' },
        offset: { type: 'integer', description: '可选：续取偏移（上次返回的 nextOffset）；首次不传' }
      }, ['paperId'])
    ];
    // 二期：语义检索（本地调研库向量）。未配置嵌入模型时不注册 semantic_search，
    // 改由 find_literature 的关键词降级路线承担（模型看不到就不会乱调）。
    if (deps.includeSemantic) {
      tools.push(schema('semantic_search', '按向量相似度检索本地调研库（需要已配置嵌入模型并构建过索引）。适合「和某个主题相近的文献」这类含义导向的查询。未配置嵌入服务时会自动降级为关键词检索并在结果中说明。', {
        query: qProp, yearFrom: yearFromProp, yearTo: yearToProp, limit: limitProp
      }, ['query']));
    }
    // R16：为一段话找文献——多源召回 + 逐论点证据归因。不依赖任何单一服务的配置：
    // 没配嵌入模型就走关键词（本地 + OpenAlex），配了才加向量召回。
    tools.push(schema('find_literature', '为一段论述/论点找文献并给出**支撑证据**：把文本拆成可检索论点（或直接用你拆好的 claims），多路召回（本地调研库关键词/向量、OpenAlex 语义与关键词、Semantic Scholar、学术网页）后合并去重，再逐论点从摘要里挑出真正支持该论点的句子。**当用户给出一段话问「有没有文献支持」「帮我找依据」「这段话的依据是什么」时用本工具。** 返回里每条候选带 evidence.verdict：supports（摘要里有支持该论点的句子）/ partial（只有标题级或极性存疑）/ none（召回到但不支撑，不要当依据用）。summary.status=not_found 表示确实没找到依据——此时如实告诉用户没有找到，不要用主题相近的文献充当证据。inLibrary 表示该文献已在用户正式库收藏中。', {
        text: { type: 'string', description: '要为其找文献依据的整段论述（工具会拆成若干论点）；与 claims 二选一' },
        claims: {
          type: 'array', items: { type: 'string' },
          description: '可选：你已经拆好的论点列表（每项是一个可独立验证的陈述句）。给出时优先用它们，比自动拆句更准'
        },
        yearFrom: yearFromProp, yearTo: yearToProp,
        perClaim: { type: 'integer', description: '每条论点返回的候选文献数（默认 5，最大 10）' },
        remoteClaimBudget: { type: 'integer', description: '远端召回覆盖的论点条数（默认 4）。OpenAlex 语义限 1 次/秒，论点很多时按需调大或分次调用' },
        claimsEn: {
          type: 'array', items: { type: 'string' },
          description: '可选但强烈建议：上面 claims 的英文版（一一对应）。证据匹配是**词面匹配**，中文论点匹配不了英文摘要——调研英文文献时请把同样的论点也用英文给一遍，否则中文论点对英文文献一律返回 none 且附带跨语言提示。用户用中文提问、你要查英文文献时，这正是该做的一步。'
        }
      }, ['text']));
    // Semantic Scholar 相关度检索（R16 第二发现源）：与 OpenAlex 互补召回。
    // 事实边界：S2 公开 API 没有文本→向量端点，/paper/search 是它自己的相关度排序。
    if (deps.includeSemanticscholar && desktop.researchSearchSemanticscholar) {
      tools.push(schema('search_semanticscholar', '联网检索 Semantic Scholar 索引（与 OpenAlex 互补的发现源：引用数与被引语境常有差异，另提供 OA PDF 直链）。适合交叉验证召回、补充 OpenAlex 漏掉的结果。注意：这是 S2 自己的相关度排序（不是向量语义检索），段落级语义检索请用 find_literature。默认只检索 ' + DEFAULT_MIN_YEAR + ' 年以后的文献；要找更早的文献传 yearFrom: 0。', {
        query: qProp, yearFrom: yearFromNetProp, yearTo: yearToProp, limit: limitProp,
        openAccessOnly: { type: 'boolean', description: '仅返回有开放获取 PDF 的条目（默认否）' }
      }, ['query']));
    }
    // Scopus 检索（配置了 Elsevier Key 才注册）：与 search_openalex 互补的第二发现源。
    // 价值：Scopus 引用数更权威（尤其早期文献）、独立召回可对照 OpenAlex 盲区；
    // 限制：检索结果不含摘要（API 限制，命中后可经回填链补）。
    if (deps.includeScopus && desktop.researchSearchScopus) {
      tools.push(schema('search_scopus', '联网检索 Elsevier Scopus 索引（需已配置 Elsevier Key）。与 search_openalex 互补：Scopus 引用数更权威、召回略有差异；返回 Scopus 引用数但不含摘要。适合：需要权威引用数、OpenAlex 结果偏少想交叉验证、或用户明确提到 Scopus 时。默认只检索 ' + DEFAULT_MIN_YEAR + ' 年以后的文献；查早期文献（Scopus 引用数在此更有参考价值）时传 yearFrom: 0。', {
        query: qProp, yearFrom: yearFromNetProp, yearTo: yearToProp, limit: limitProp
      }, ['query']));
    }
    // 二期写类工具（收藏 / PDF 两步）——执行前 agentui 会弹用户确认
    if (deps.includeWrite) {
      tools.push(schema('collect_papers', '把调研库中的文献收藏进用户的正式库（执行前会向用户确认；已存在的自动去重合并）。调研产生了值得保留的结果时使用。', {
        workIds: { type: 'array', items: { type: 'string' }, description: '调研库文献 ID 列表（来自 search_research / search_openalex / semantic_search）' },
        folderId: { type: 'string', description: '目标文件夹 ID（可选，缺省用当前文件夹）' }
      }, ['workIds']));
      tools.push(schema('download_pdfs', '下载开放获取 PDF 到当前会话的附件目录（执行前会向用户确认；无 OA 链接的条目会返回原因）。用户要求「下载这些论文」时使用。', {
        workIds: { type: 'array', items: { type: 'string' }, description: '要下载的调研库文献 ID 列表' }
      }, ['workIds']));
      tools.push(schema('add_pdfs_to_folder', '把当前会话附件目录里已下载的 PDF 正式收入文献库：复制进受管目录、创建或合并条目并挂附件（执行前会向用户确认）。典型流程：先 download_pdfs，再用本工具收入。', {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string', description: '会话附件相对路径（download_pdfs 返回的 file）' },
              workId: { type: 'string', description: '对应调研库文献 ID' }
            },
            required: ['file', 'workId']
          },
          description: '要收入的附件列表'
        },
        folderId: { type: 'string', description: '目标文件夹 ID（可选）' }
      }, ['files']));
    }
    // 三期：引文网络（只读构建 + 快照存会话附件；不动正式库，无需确认门）
    if (deps.buildGraph) {
      tools.push(schema('build_graph', '基于调研库构建引文网络：以给定文献为种子按引用关系扩邻居（缺的会自动补库），只在集合内部成边后计算并展示（左侧论文列表 + 中间画布 + 右侧详情），同时把离线 HTML 快照存进当前会话附件。用户要求「看引文网络/引用关系图」时使用。种子多而杂时按重要性（被引/PageRank/集合内被引/奠基年份）择优保留。', {
        workIds: { type: 'array', items: { type: 'string' }, description: '种子调研库文献 ID 列表（建议先用 search_research/semantic_search 选出一批相关文献再建图）' },
        depth: { type: 'integer', description: '扩边深度 0-3（默认 2；0 = 只用给定文献本身，不扩邻居）' },
        maxNodes: { type: 'integer', description: '节点上限 10-80（默认 60，超过按重要性截取）' }
      }, ['workIds']));
    }
    // R18：库内引文邻接（对照 literature-mcp graph_neighbors）——不扩边不补库，
    // 只回答「这几篇在库内谁引用谁」，与 build_graph（扩边建图）互补
    tools.push(schema('graph_neighbors', '查询给定文献在**本地调研库内**的直接引文邻接：它引用了谁（out）、谁引用了它（in）。只看库内已存的引用边，不联网扩边（要扩边建图用 build_graph）。适合「这篇的参考文献里哪几篇我库里也有」「库里谁引了它」。', {
      workIds: { type: 'array', items: { type: 'string' }, description: '调研库文献 ID 列表（≤20）' },
      direction: { type: 'string', description: 'out=它引用谁；in=谁引用它；both（默认）' }
    }, ['workIds']));
    // M9-4：科研网页检索（TinyFish）——用户在设置中开启并确认出境告知后才注册；readpdf 之外的最新信息/非索引内容入口
    if (deps.includeWebSearch) {
      tools.push(schema('web_search', '联网检索学术网页索引（覆盖预印本聚合页、会议页、机构库、数据集等结构化 API 之外的内容），结果自动存入调研库并关联可收藏的 workId。调研库和 OpenAlex 都没命中、或需要最新/灰色文献时使用。', {
        query: qProp, yearFrom: yearFromProp, yearTo: yearToProp,
        limit: { type: 'integer', description: '返回条数上限（默认 10，最大 20）' }
      }, ['query']));
      tools.push(schema('fetch_page', '抓取公开学术域白名单内 URL 的正文（返回干净 markdown 分块）。仅限 arxiv.org、doi.org、nature.com、*.edu 等学术域名；域外 URL 会被拒绝。正文较长时返回带 nextOffset，传同一 url + offset 续读（命中缓存，不再重复抓取）。paperId 提供时正文会作为该文献的网页快照附件入库并可全文检索（写正式库，执行前会向用户确认）。', {
        url: { type: 'string', description: '要抓取的公开学术域 URL' },
        paperId: { type: 'string', description: '可选：正式库文献 ID，提供则正文挂为该文献的网页快照附件' },
        offset: { type: 'integer', description: '续读偏移（上次返回的 nextOffset）；首次抓取不传' }
      }, ['url']));
    }
    // M9-5（R11）：视觉渲染工具——仅 vision 模型 + 页面渲染能力注入时注册；文本优先
    if (deps.includeVisionRender && deps.renderPageImage) {
      tools.push(schema('render_pdf_pages', '把一篇文献 PDF 的指定页渲染成图片并附加到本轮对话（截图作为图像消息紧随工具结果，可直接以视觉理解）。文本优先：先 read_pdf_pages 读文本；遇到公式（纯文本抽取出乱码）、图表/图题、或整页几乎无文本（扫描页）时才用本工具。一次最多 3 页。', {
        paperId: { type: 'string', description: '正式库文献 ID' },
        pages: { type: 'array', items: { type: 'integer' }, description: '要渲染的页码列表（1 基物理页，最多 3 页）' },
        attachmentId: { type: 'string', description: '可选：附件 ID（省略时用主 PDF）' }
      }, ['paperId', 'pages']));
    }

    async function execute(name, args, ctx) {
      var a = args || {};
      var context = ctx || {};
      if (name === 'search_library') {
        var papers = deps.getPapers ? deps.getPapers() : [];
        var scopeNote = '';
        var folderName = String(a.folder || '').trim();
        if (folderName) {
          var folders = (deps.getFolders ? deps.getFolders() : []);
          var folder = folders.filter(function (f) { return (f.name || '') === folderName; })[0];
          if (!folder) {
            return JSON.stringify({ error: '文件夹不存在：' + folderName, knownFolders: folders.map(function (f) { return f.name; }).slice(0, 30) });
          }
          var inFolder = {};
          (deps.getPapersInFolder ? deps.getPapersInFolder(folder.id) : []).forEach(function (p) { inFolder[p.id] = true; });
          papers = papers.filter(function (p) { return inFolder[p.id]; });
          scopeNote = folderName;
        }
        var hit = paperHits(papers, a.query).slice(0, clampLimit(a));
        return JSON.stringify({
          source: '正式库' + (scopeNote ? ' · 文件夹「' + scopeNote + '」' : ''), query: String(a.query || ''), count: hit.length,
          papers: hit.map(paperSummary)
        });
      }
      if (name === 'search_research') {
        var r = await desktop.researchQuery({
          q: String(a.query || ''),
          yearFrom: Number(a.yearFrom) || null,
          yearTo: Number(a.yearTo) || null,
          limit: clampLimit(a)
        });
        return JSON.stringify({
          source: '调研库', query: String(a.query || ''), total: r.total,
          totalNote: r.totalIsLowerBound ? '取满一页，total 为下限（至少这么多条）' : undefined,
          works: (r.works || []).slice(0, clampLimit(a)).map(workSummary)
        });
      }
      if (name === 'search_openalex') {
        var oaMode = a.mode === 'semantic' ? 'semantic' : 'keyword';
        var oaYearFrom = netYearFrom(a);
        var r2 = await desktop.researchSearchOpenalex({
          query: String(a.query || ''),
          yearFrom: oaYearFrom,
          yearTo: Number(a.yearTo) || null,
          limit: clampLimit(a),
          mode: oaMode
        });
        return JSON.stringify({
          source: 'OpenAlex · ' + (oaMode === 'semantic' ? '语义检索' : '关键词检索') + '（已存入调研库）',
          query: String(a.query || ''), mode: r2.mode || oaMode, total: r2.count, stored: r2.stored,
          yearFrom: oaYearFrom, note: netYearNote(a, oaYearFrom),
          works: (r2.works || []).slice(0, clampLimit(a)).map(workSummary)
        });
      }
      if (name === 'search_semanticscholar') {
        if (!desktop.researchSearchSemanticscholar) return '当前环境不支持 Semantic Scholar 检索';
        var scYearFrom = netYearFrom(a);
        var sc = await desktop.researchSearchSemanticscholar({
          query: String(a.query || ''),
          yearFrom: scYearFrom,
          yearTo: Number(a.yearTo) || null,
          limit: clampLimit(a),
          openAccessOnly: a.openAccessOnly === true
        });
        return JSON.stringify({
          source: 'Semantic Scholar（相关度检索，已存入调研库）', query: String(a.query || ''),
          total: sc.count, stored: sc.stored, hasMore: !!sc.hasMore,
          yearFrom: scYearFrom,
          note: joinNotes([netYearNote(a, scYearFrom),
            'S2 公开 API 无文本→向量的语义检索端点；这是 S2 自身的相关度排序。段落级语义检索请用 find_literature。']),
          works: (sc.works || []).slice(0, clampLimit(a)).map(function (w) {
            return {
              workId: w.id, title: w.title, year: w.year, doi: w.doi,
              source: w.sourceName || '', citedBy: w.citedBy || 0,
              hasAbstract: !!w.hasAbstract, oaPdf: w.oaUrl || '',
              alreadyInResearch: !!w.existed
            };
          })
        });
      }
      if (name === 'find_literature') {
        if (!desktop.researchFindLiterature) return '当前环境不支持段落找文献';
        var claims = (Array.isArray(a.claims) ? a.claims : []).map(String).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 12);
        var claimsEn = (Array.isArray(a.claimsEn) ? a.claimsEn : []).map(String).map(function (s) { return s.trim(); }).slice(0, 12);
        if (!claims.length && !String(a.text || '').trim()) return 'text 与 claims 至少要有一个';
        var fl = await desktop.researchFindLiterature({
          text: String(a.text || ''),
          claims: claims,
          claimsEn: claimsEn,
          yearFrom: Number(a.yearFrom) || null,
          yearTo: Number(a.yearTo) || null,
          perClaim: Number(a.perClaim) || null,
          remoteClaimBudget: Number(a.remoteClaimBudget) || null
        });
        // 严格按结构返回：证据句 + 来源 + 判定，让模型无法把「主题相近」当成「有依据」
        return JSON.stringify({
          source: '多源召回 + 摘要级证据归因',
          claimCount: (fl.claims || []).length,
          providerStats: fl.providerStats,
          remoteClaimsCovered: fl.remoteClaimsCovered,
          remoteClaimsSkipped: fl.remoteClaimsSkipped,
          candidateTotal: fl.candidateTotal,
          routeFailures: fl.routeFailures,
          notes: fl.notes,
          claimKey: {
            verdict: 'supports=摘要里有支撑该论点的原句；partial=仅标题级命中或与论点极性相反（可能是矛盾证据）；none=召回到但不支撑，不可当依据',
            evidenceSource: 'abstract=论文摘要（最可信）；snippet=网页片段或上游生成的一句话概述（较弱）；title=仅标题命中'
          },
          claims: (fl.claims || []).map(function (c) {
            return {
              claim: c.claim,
              status: c.summary && c.summary.status,
              statusNote: c.summary && c.summary.note,
              candidates: (c.candidates || []).map(function (x) {
                return {
                  workId: x.workId, doi: x.doi, title: x.title, year: x.year,
                  venue: x.venue, citedBy: x.citedBy, inLibrary: !!x.inLibrary,
                  foundIn: x.sources, oaPdf: x.oaUrl || '', pageUrl: x.pageUrl || '',
                  evidence: {
                    verdict: x.evidence.verdict,
                    source: x.evidence.source,
                    text: x.evidence.text,
                    polarityMismatch: x.evidence.polarityMismatch,
                    note: x.evidence.note || ''
                  }
                };
              })
            };
          })
        });
      }
      if (name === 'get_research_work') {
        var rows = await desktop.researchGetWorks([String(a.workId || '')]);
        if (!rows || !rows.length) return '未找到该调研文献：' + String(a.workId || '');
        var w = rows[0];
        return JSON.stringify({
          workId: w.id, title: w.title, year: w.year, doi: w.doi,
          source: w.sourceName, type: w.type, citedBy: w.citedBy,
          authors: (w.authors || []).map(function (x) { return x.name; }).slice(0, 10),
          keywords: (w.keywords || []).slice(0, 10),
          abstract: String(w.abstract || '').slice(0, MAX_ABSTRACT)
        });
      }
      if (name === 'get_work') {
        if (!desktop.researchGetWork) return '当前版本不支持 get_work';
        var resolved = await desktop.researchGetWork({ query: String(a.query || '').trim() });
        if (!resolved || !resolved.found) return JSON.stringify({ found: false, note: resolved && resolved.note || '未命中' });
        var rw = resolved.work;
        return JSON.stringify({
          found: true, origin: resolved.origin,
          workId: rw.id, doi: rw.doi, title: rw.title, year: rw.year,
          source: rw.sourceName, citedBy: rw.citedBy, isOa: rw.isOa, oaUrl: rw.oaUrl,
          hasAbstract: rw.hasAbstract,
          abstract: rw.hasAbstract ? rw.abstract : '',
          note: rw.hasAbstract ? '' : '该文献暂无摘要，可用 backfill_abstracts 补齐'
        });
      }
      if (name === 'autocomplete_entity') {
        if (!desktop.researchAutocomplete) return '当前版本不支持 autocomplete_entity';
        var ac = await desktop.researchAutocomplete({ entity: String(a.entity || ''), query: String(a.query || '') });
        return JSON.stringify({
          entity: String(a.entity || ''), count: (ac || []).length,
          results: (ac || []).map(function (item) {
            return { id: item.id, name: item.name, citedBy: item.citedBy, hint: item.hint };
          })
        });
      }
      if (name === 'graph_neighbors') {
        if (!desktop.researchGraphNeighbors) return '当前版本不支持 graph_neighbors';
        var gn = await desktop.researchGraphNeighbors({
          workIds: Array.isArray(a.workIds) ? a.workIds.map(String) : [],
          direction: String(a.direction || 'both')
        });
        return JSON.stringify(gn);
      }
      if (name === 'backfill_abstracts') {
        if (!desktop.researchBackfill) return '当前版本不支持 backfill_abstracts';
        var bf = await desktop.researchBackfill({ limit: Math.max(1, Math.min(300, Number(a.limit) || 100)) });
        return JSON.stringify({
          updated: bf && bf.updated || 0, done: bf && bf.done || 0, total: bf && bf.total || 0,
          stopped: !!(bf && bf.stopped), reason: bf && bf.reason || '',
          note: 'Crossref → Elsevier 逐级回退；被限流会 stopped 并给原因，稍后可再跑续补'
        });
      }
      if (name === 'read_work_fulltext') {
        if (!desktop.researchFulltextRead || !desktop.researchFulltextStore) return '当前版本不支持全文参考读取';
        var ftWorkId = String(a.workId || '');
        var ftFrom = Math.max(0, Math.floor(Number(a.fromChar) || 0));
        var ftTitle = '';
        var read1 = await desktop.researchFulltextRead({ workId: ftWorkId, fromChar: ftFrom, length: 10000 });
        if (!read1) return JSON.stringify({ error: '读取失败', workId: ftWorkId });
        if (read1.error) return JSON.stringify({ workId: ftWorkId, error: read1.error });
        var ftWindow = null;
        var ftCached = true;
        if (read1.cached && read1.window) {
          ftWindow = read1.window;
        } else if (read1.tempPath) {
          // 首次拉取：渲染层抽取文本 → 存库（主进程随即删临时 PDF）→ 按请求偏移再取窗口
          ftCached = false;
          ftTitle = read1.title || '';
          if (!deps.extractPdfText) {
            await desktop.researchFulltextStore({ workId: ftWorkId, tempPath: read1.tempPath, text: '' });
            return JSON.stringify({ workId: ftWorkId, error: '当前环境无法解析 PDF（需要桌面版）' });
          }
          var ftText = await deps.extractPdfText(read1.tempPath);
          var stored = await desktop.researchFulltextStore({ workId: ftWorkId, tempPath: read1.tempPath, text: ftText || '', length: 10000 });
          if (!stored || !stored.stored) {
            return JSON.stringify({ workId: ftWorkId, error: '全文抽取失败（可能是扫描件或受保护 PDF；公式/图表天然失真）' });
          }
          var read2 = ftFrom > 0 ? await desktop.researchFulltextRead({ workId: ftWorkId, fromChar: ftFrom, length: 10000 }) : null;
          ftWindow = read2 && read2.window ? read2.window : stored.window;
        }
        if (!ftWindow) return JSON.stringify({ workId: ftWorkId, error: '未取到全文窗口' });
        var ftEnd = ftWindow.fromChar + ftWindow.text.length;
        return JSON.stringify({
          workId: ftWindow.workId || ftWorkId,
          title: ftTitle || undefined,
          cached: ftCached,
          charTotal: ftWindow.charTotal,
          fromChar: ftWindow.fromChar,
          nextFromChar: ftEnd < ftWindow.charTotal ? ftEnd : null,
          text: ftWindow.text,
          note: (ftCached ? '（全文已缓存在调研库）' : '（本次已下载并抽取 OA 全文，PDF 已删除，下次读取走缓存）') +
            '（正文含【第 N 页】标记，引用页码以此为准；公式与图表在纯文本抽取中可能失真）'
        });
      }
      if (name === 'get_paper') {
        var p = deps.getPaperById ? deps.getPaperById(String(a.paperId || '')) : null;
        if (!p) return '未找到该正式库文献：' + String(a.paperId || '');
        return JSON.stringify({
          id: p.id, title: p.title || '', year: p.year || null,
          authors: (p.authors || []).slice(0, 10), venue: p.venue || '', doi: p.doi || '',
          tags: (p.tags || []).slice(0, 10),
          // R18 辅助阅读：用户是否读过/最近何时读——回答阅读类问题时先对齐用户的进度
          lastReadAt: p.lastReadAt || null,
          abstract: String(p.abstract || '').slice(0, MAX_ABSTRACT),
          // R10：附件清单随文献返回——模型据此选 attachmentId，不再凭空猜
          attachments: (Array.isArray(p.attachments) ? p.attachments : []).slice(0, 20).map(function (att) {
            return { id: att && att.id, kind: att && att.kind || '', fileName: att && att.fileName || '' };
          })
        });
      }
      if (name === 'fulltext_search') {
        var hits = await desktop.pdfSearchQuery(String(a.query || ''));
        var papersIndex = {};
        (deps.getPapers ? deps.getPapers() : []).forEach(function (p) { papersIndex[p.id] = p; });
        var mapped = (hits || []).slice(0, clampLimit(a)).map(function (hit) {
          var p = papersIndex[hit.paperId];
          return {
            paperId: hit.paperId,
            // R10：命中保留 attachmentId——从检索跳到按页读取保持在同一份附件
            attachmentId: hit.attachmentId || '',
            title: p ? (p.title || '') : '',
            pages: (hit.pages || []).slice(0, 8),
            snippets: (hit.snippets || []).slice(0, 2)
          };
        });
        return JSON.stringify({ source: '全文索引（PDF / EPUB / 网页快照）', query: String(a.query || ''), count: mapped.length, hits: mapped });
      }
      if (name === 'summarize_paper') {
        var summaryPaperId = String(a.paperId || '');
        if (!summaryPaperId) return '缺少 paperId，无法梳理文献';
        var summaryFrom = Math.max(1, Math.floor(Number(a.from) || 1));
        var summaryFromChar = Math.max(0, Math.floor(Number(a.fromChar) || 0));
        var summaryBatch = await execute('read_pdf_pages', {
          paperId: summaryPaperId, attachmentId: String(a.attachmentId || ''),
          from: summaryFrom, to: summaryFrom + 7, fromChar: summaryFromChar
        }, context);
        var summaryData;
        try { summaryData = JSON.parse(summaryBatch); } catch (error) { return summaryBatch; }
        if (!summaryData || !Array.isArray(summaryData.pages)) return summaryBatch;
        if (!summaryData.pages.length) return JSON.stringify({ error: '该附件没有可读取的正文页面', paperId: summaryPaperId, attachmentId: summaryData.attachmentId });
        summaryData.pages.forEach(function (pg) {
          if (pg.truncatedInCall) pg.text = String(pg.text || '').replace(/…\[本页在此截断\]$/, '');
        });
        summaryData.complete = summaryData.nextFrom == null && summaryData.pages.length > 0;
        if (summaryFrom === 1 && summaryFromChar === 0) {
          summaryData.taskPrompt = '梳理这篇文献从问题到结论的证据链。完整读取可用正文，遇到截断按 nextFrom/nextFromChar 续读，直到 complete=true。依次说明：研究背景与缺口、核心问题或假设、方法与数据、各项实验或分析、关键结果、结果如何支撑结论、作者承认的局限。把作者声称的内容与实际证据对应起来，关键结果标注 PDF 物理页码（EPUB 标注章节序号）。最后给出简短章节地图和三条最值得记住的结论。无法读取的页面、图表或附件单独列出，不当作已核实内容；未读完不得宣称已梳理全文。';
        }
        // 单条工具结果不得被 core 的 12000 字符护栏从 JSON 中间截断；必要时
        // 缩短本批最后一页并回退游标，下次仍从该页的未读位置继续。
        var summaryText = JSON.stringify(summaryData);
        while (summaryText.length > 11000 && summaryData.pages.length) {
          var lastPage = summaryData.pages[summaryData.pages.length - 1];
          var lastText = String(lastPage.text || '');
          var removeChars = Math.min(lastText.length, Math.max(200, summaryText.length - 11000));
          lastPage.text = lastText.slice(0, lastText.length - removeChars);
          summaryData.nextFrom = lastPage.page;
          summaryData.nextFromChar = (lastPage.charOffset || 0) + lastPage.text.length;
          summaryData.truncated = true;
          summaryData.complete = false;
          if (!lastPage.text) summaryData.pages.pop();
          summaryText = JSON.stringify(summaryData);
        }
        if (!summaryData.pages.length) return JSON.stringify({ error: '单页正文无法在工具输出限制内完整返回', paperId: summaryPaperId, attachmentId: summaryData.attachmentId });
        summaryData.to = summaryData.pages[summaryData.pages.length - 1].page;
        summaryData.coverageNote = '本次实际读取 ' + summaryData.from + '–' + summaryData.to + ' 页，共 ' + summaryData.totalPages + ' 页' +
          (summaryData.nextFrom == null ? '；已读到文末' : '；尚未读完，请按 nextCall 续读');
        if (!summaryData.complete) {
          summaryData.nextCall = {
            paperId: summaryPaperId, attachmentId: summaryData.attachmentId,
            from: summaryData.nextFrom, fromChar: summaryData.nextFromChar || 0
          };
        }
        return JSON.stringify(summaryData);
      }
      if (name === 'read_pdf_pages') {
        if (!desktop.pdfSearchGetPageRange) return '此版本不支持按页读取 PDF 正文';
        var from = Math.max(1, Number(a.from) || 1);
        var to = Math.min(from + 7, Math.max(from, Number(a.to) || from)); // 单次 ≤8 页，成本护栏
        var fromChar = Math.max(0, Math.floor(Number(a.fromChar) || 0)); // R4：起始页的页内偏移
        var attId = String(a.attachmentId || '');
        var resolvedNote = '';
        if (!attId) {
          // R10：省略 attachmentId 时解析主 PDF（第一个 PDF 附件）——索引按真实附件 ID
          // 存储，拿空 ID 去查只会命中旧版单 PDF 时代的空 ID 行；
          // 无 PDF 附件时回退 EPUB 附件（页 = spine 章节序号）
          var paperForAtt = deps.getPaperById ? deps.getPaperById(String(a.paperId || '')) : null;
          var atts = (paperForAtt && Array.isArray(paperForAtt.attachments) ? paperForAtt.attachments : []);
          var primary = atts.filter(function (att) { return att && att.kind === 'pdf'; })[0];
          if (primary) {
            attId = primary.id;
            resolvedNote = 'attachmentId 省略，已自动选用主 PDF（' + (primary.fileName || attId) + '）';
          } else {
            var epubAtt = atts.filter(function (att) { return att && att.kind === 'epub' && att.path; })[0];
            if (epubAtt) {
              attId = epubAtt.id;
              resolvedNote = 'attachmentId 省略且无 PDF 附件，已自动选用 EPUB（' + (epubAtt.fileName || attId) + '；页 = 章节序号）';
            }
          }
        }
        var range = await desktop.pdfSearchGetPageRange({
          paperId: String(a.paperId || ''),
          attachmentId: attId,
          from: from,
          to: to,
          capChars: READ_PAGE_BUDGET,
          fromChar: fromChar
        });
        if (!range) {
          // A-followup #2：索引按附件身份独立存储——指定附件没有索引时**不会**退回主 PDF 的
          // 旧索引，所以这里必须如实报出问的是哪份附件，不能让它以为读到的就是所要的内容
          return '没有找到该附件的全文索引（paperId=' + String(a.paperId || '') +
            '，attachmentId=' + (attId || '(空)') +
            '）。索引按附件分别存储，请求的附件未建索引时不会退回该文献其它附件的正文；' +
            '可在 设置 → 数据与备份 → PDF 全文索引 构建，或核对 paperId/attachmentId。';
        }
        // R12：按总预算裁页——放不下的页不进本次结果，nextFrom 告知从哪续读；
        // R4：页内截断不再「从本页重新开始」——本页返回 charOffset/charTotal，
        // 续读用同一页码 + fromChar=charOffset+本次取到的长度，逐段读完整页
        var budget = READ_PAGE_BUDGET;
        var outPages = [];
        var nextFrom = null;
        var nextFromChar = null;
        var pageTruncated = false;
        for (var pi = 0; pi < range.pages.length; pi++) {
          var pg = range.pages[pi] || {};
          var pgText = String(pg.text || '');
          var charOffset = pg.charOffset || 0;
          var charTotal = pg.charTotal != null ? pg.charTotal : pgText.length;
          // 数据库层单页 capChars 截断会附加标记；标记不属于正文，页内余量必须续读。
          if (/…\[截断\]$/.test(pgText) && charOffset + pgText.length - '…[截断]'.length < charTotal) {
            pgText = pgText.replace(/…\[截断\]$/, '');
          }
          if (pgText.length <= budget) {
            outPages.push({ page: pg.page, charOffset: charOffset, charTotal: charTotal, text: pgText });
            budget -= pgText.length;
            if (charOffset + pgText.length < charTotal) {
              nextFrom = pg.page;
              nextFromChar = charOffset + pgText.length;
              pageTruncated = true;
              break;
            }
          } else {
            if (budget > 800) {
              outPages.push({ page: pg.page, charOffset: charOffset, charTotal: charTotal, text: pgText.slice(0, budget) + '…[本页在此截断]', truncatedInCall: true });
              pageTruncated = true;
              nextFromChar = charOffset + budget;
            } else {
              nextFromChar = charOffset;
            }
            nextFrom = pg.page;
            break;
          }
        }
        if (nextFrom == null && range.to < range.total) nextFrom = range.to + 1;
        var out = {
          paperId: range.paperId, attachmentId: range.attachmentId,
          totalPages: range.total, from: range.from, to: range.from + outPages.length - 1,
          truncated: nextFrom != null,
          nextFrom: nextFrom,
          nextFromChar: nextFromChar,
          coverageNote: '本次读取 ' + (range.from) + '–' + (range.from + outPages.length - 1) + ' 页，共 ' + range.total + ' 页' +
            (nextFrom != null
              ? '；未读完，用 from=' + nextFrom + (nextFromChar ? ' + fromChar=' + nextFromChar : '') + ' 续读'
              : '；已到文末或请求区间末尾'),
          note: '页码为 PDF 物理页（EPUB 附件页码 = spine 章节序号）；每页超长会截断并给 charOffset/charTotal，用同页码 + fromChar 续读该页余下文字。公式与图表在纯文本抽取中可能失真，精确理解时请向用户说明该局限。'
        };
        if (resolvedNote) out.resolvedAttachment = resolvedNote;
        out.pages = outPages;
        if (pageTruncated) out.note += ' 本次因字符预算在页内截断。';
        return JSON.stringify(out);
      }
      if (name === 'render_pdf_pages') {
        if (!deps.renderPageImage) return '当前环境不支持页面渲染（需要桌面版）';
        var rvPaper = deps.getPaperById ? deps.getPaperById(String(a.paperId || '')) : null;
        if (!rvPaper) return '未找到该正式库文献：' + String(a.paperId || '');
        if (!context.sessionId) return '缺少会话上下文，无法保存页面截图';
        var rvPages = (Array.isArray(a.pages) ? a.pages : []).map(function (p) { return Math.floor(Number(p)) || 0; })
          .filter(function (p, i, arr) { return p >= 1 && arr.indexOf(p) === i; }).slice(0, 3);
        if (!rvPages.length) return 'pages 为空';
        var rvAttId = String(a.attachmentId || '');
        var rvAtt = null;
        var rvAttachments = Array.isArray(rvPaper.attachments) ? rvPaper.attachments : [];
        if (rvAttId) {
          rvAtt = rvAttachments.filter(function (att) { return att && att.id === rvAttId; })[0] || null;
        } else {
          rvAtt = rvAttachments.filter(function (att) { return att && att.kind === 'pdf'; })[0] || null;
          rvAttId = rvAtt ? rvAtt.id : '';
        }
        if (!rvAtt || !rvAtt.path) return '该文献没有本地 PDF 附件（无法渲染页面）';
        var rvRefs = [];
        var rvFailures = [];
        // 批量渲染：文档只开一次（逐页调用会为每页重读整份 PDF 并重新解析，大文件上界面直接卡住）
        var rvRendered = deps.renderPagesImage
          ? await deps.renderPagesImage({ path: rvAtt.path, pages: rvPages, scale: 1.6 })
          : await Promise.all(rvPages.map(function (page) {
            return deps.renderPageImage({ path: rvAtt.path, pageIndex: page, scale: 1.6 })
              .then(function (png) { return { page: page, dataUrl: png && png.dataUrl }; },
                function (error) { return { page: page, error: String(error && error.message || error) }; });
          }));
        (Array.isArray(rvRendered) ? rvRendered : []).forEach(function (item) {
          if (item && item.error) rvFailures.push({ page: item.page, error: item.error });
        });
        for (var ri = 0; ri < (rvRendered || []).length; ri++) {
          var rvItem = rvRendered[ri];
          if (!rvItem || !rvItem.dataUrl) continue;
          var rvPage = rvItem.page;
          try {
            var saved = await desktop.sessionSaveAttachment(context.sessionId, {
              name: 'page-' + rvPage + '-' + Date.now() + '.png',
              label: String(rvPaper.title || rvPaper.id).slice(0, 40) + ' 第 ' + rvPage + ' 页',
              dataBase64: rvItem.dataUrl.slice(rvItem.dataUrl.indexOf(',') + 1)
            });
            rvRefs.push({ type: 'image', ref: 'session:' + context.sessionId + '|' + saved.file, label: '第 ' + rvPage + ' 页' });
          } catch (error) {
            rvFailures.push({ page: rvPage, error: String(error && error.message || error) });
          }
        }
        if (!rvRefs.length) return '渲染失败：' + ((rvFailures[0] && rvFailures[0].error) || '未知错误');
        // 返回 {text, images}：编排层把 images 以合成 user 消息注入本轮，
        // vision 模型在下一请求直接看到页面图（见 agentloop.appendSyntheticImages）
        return {
          text: JSON.stringify({
            rendered: rvRefs.length, attachmentId: rvAttId,
            pages: rvPages.filter(function (p) { return !rvFailures.some(function (f) { return f.page === p; }); }),
            note: '截图已作为图像附加到本轮对话（紧随本结果的图像消息），请以视觉理解回答；回答时注明依据的页码。',
            failures: rvFailures
          }),
          images: rvRefs
        };
      }
      if (name === 'list_pdf_annotations') {
        var paper = deps.getPaperById ? deps.getPaperById(String(a.paperId || '')) : null;
        if (!paper) return '未找到该正式库文献：' + String(a.paperId || '');
        // R3：批注带附件身份（主 PDF / 补充材料 / EPUB 不再混作一团）、稳定 id 可引用，
        // 超过单页上限时如实给出总数与 nextOffset——调用方看得到「还有更多」
        var annOffset = Math.max(0, Math.floor(Number(a.offset) || 0));
        var annAll = (paper.pdfAnnotations || []);
        var annos = annAll.map(function (item) {
          return {
            id: item.id || '',
            attachmentId: item.attachmentId || '',
            page: (item.position && item.position.pageIndex != null) ? item.position.pageIndex + 1 : null,
            type: item.type || 'highlight',
            color: item.color || '',
            text: String(item.text || '').slice(0, 400),
            comment: String(item.comment || '').slice(0, 400)
          };
        });
        var annPage = annos.slice(annOffset, annOffset + 50);
        return JSON.stringify({
          paperId: paper.id,
          total: annAll.length,
          offset: annOffset,
          count: annPage.length,
          truncated: annOffset + annPage.length < annAll.length,
          nextOffset: annOffset + annPage.length < annAll.length ? annOffset + annPage.length : null,
          note: annOffset + annPage.length < annAll.length ? '批注超过 50 条，用 offset=' + (annOffset + annPage.length) + ' 续取' : '',
          annotations: annPage
        });
      }
      if (name === 'semantic_search') {
        var sr = await desktop.researchSemanticSearch({
          query: String(a.query || ''),
          yearFrom: Number(a.yearFrom) || null,
          yearTo: Number(a.yearTo) || null,
          limit: clampLimit(a)
        });
        return JSON.stringify({
          source: '调研库（语义）', query: String(a.query || ''),
          // 如实回报实际走的路径：mode=keyword 表示没配嵌入模型/索引为空（或上次构建失败），
          // note 里写明原因——模型不能把关键词结果当成语义结果来汇报
          mode: sr.mode || '', note: sr.note || '',
          works: (sr.works || []).map(function (w) {
            return { workId: w.id, title: w.title, year: w.year, doi: w.doi, source: w.sourceName, score: Math.round((w.score || 0) * 1000) / 1000 };
          })
        });
      }
      if (name === 'build_graph') {
        var gIds = (Array.isArray(a.workIds) ? a.workIds : []).map(String).filter(Boolean).slice(0, 500);
        if (!gIds.length) return 'workIds 为空';
        var g = await desktop.researchGraph({
          workIds: gIds,
          depth: a.depth == null ? null : Number(a.depth),
          maxNodes: Number(a.maxNodes) || null
        });
        var gFile = '';
        if (context.sessionId && deps.saveGraphHtmlToSession) {
          try {
            var gSaved = await deps.saveGraphHtmlToSession(g, context.sessionId);
            gFile = gSaved && gSaved.file || '';
          } catch (error) { /* 快照失败不阻断展示 */ }
        }
        if (deps.openGraphPanel) deps.openGraphPanel(g);
        // truncated/hidden/missing 如实回报：模型不能说「这就是全部引用网络」
        return JSON.stringify({
          built: true, nodes: g.meta.nodeCount, edges: g.meta.edgeCount,
          depth: g.meta.depth, maxNodes: g.meta.maxNodes,
          communities: g.meta.communityCount,
          truncated: !!g.meta.truncated, hidden: g.meta.hiddenCount || 0,
          missing: g.meta.missing || [],
          note: '节点 = 给定文献集合（含扩边），边只在集合内部生成（A→B 表示 A 引用 B）；' +
            '超出节点上限时按重要性（被引 50% + PageRank 25% + 集合内被引 15% + 年份 10%）截取，' +
            'truncated/hidden 即被隐藏的篇数',
          snapshot: gFile || '（快照保存失败，图已在面板展示）'
        });
      }
      if (name === 'web_search') {
        var ws = await desktop.researchWebSearch({
          query: String(a.query || ''),
          yearFrom: Number(a.yearFrom) || null,
          yearTo: Number(a.yearTo) || null,
          limit: clampLimit(a)
        });
        return JSON.stringify({
          source: '网页（TinyFish · research_paper，已入调研库）', query: String(a.query || ''),
          total: ws.total, matched: ws.matched, created: ws.created,
          // A-followup #3：collected = 已收藏到**正式库**（正式库反查），inResearch = 调研库
          // 已有。两者是两件事：调研库命中不等于用户收藏过
          keyNote: 'collected=已收藏到用户正式文献库；inResearch=调研库已有该条（不等于已收藏）',
          works: (ws.works || []).map(function (w) {
            return {
              workId: w.workId, title: w.title, year: w.year, site: w.siteName,
              url: w.url, snippet: w.snippet, citations: w.citations,
              collected: !!w.inLibrary, inResearch: !!w.inResearch
            };
          })
        });
      }
      if (name === 'fetch_page') {
        // R08：带 paperId 是写正式库的操作——确认通过后、实际提交前再核一次取消状态
        if (String(a.paperId || '').trim() && context.cancelRequested && context.cancelRequested()) {
          return '该轮已停止，未写入正式库';
        }
        var fp = await desktop.researchFetchPage({
          url: String(a.url || ''),
          paperId: String(a.paperId || '') || null,
          sessionId: context.sessionId || null,
          offset: Math.max(0, Number(a.offset) || 0)
        });
        if (!fp.ok) return '抓取失败：' + fp.error + (fp.partial ? '（上游部分失败）' : '');
        // R12：正文按块返回（主进程 4000 字符/块），带 nextOffset 续读——
        // 不再在工具层截 1500 字符让模型猜剩余内容
        var fpOut = {
          fetched: true, title: fp.title, finalUrl: fp.finalUrl,
          offset: fp.offset || 0, totalLength: fp.totalLength || 0,
          truncated: fp.nextOffset != null,
          nextOffset: fp.nextOffset != null ? fp.nextOffset : null,
          excerpt: fp.markdownExcerpt
        };
        if (fp.attachment) {
          if (deps.attachSnapshot) deps.attachSnapshot(String(a.paperId), fp.attachment);
          fpOut.savedAs = '网页快照附件（已入全文索引，可在正式库检索命中）';
        } else if (fp.file) {
          fpOut.savedTo = fp.file;
        }
        return JSON.stringify(fpOut);
      }
      if (name === 'search_scopus') {
        var scpYearFrom = netYearFrom(a);
        var scp = await desktop.researchSearchScopus({
          query: String(a.query || ''),
          yearFrom: scpYearFrom,
          yearTo: Number(a.yearTo) || null,
          limit: clampLimit(a)
        });
        return JSON.stringify({
          source: 'Scopus（已按 DOI 归并入库）', query: String(a.query || ''), total: scp.count, stored: scp.stored,
          yearFrom: scpYearFrom,
          note: joinNotes([netYearNote(a, scpYearFrom),
            'citedBy 为 Scopus 引用数；本接口不返回摘要，摘要可经回填链（Crossref/Elsevier）补全。']),
          works: (scp.works || []).slice(0, clampLimit(a)).map(function (w) {
            return {
              workId: w.id, title: w.title, year: w.year, doi: w.doi,
              source: w.sourceName, citedByScopus: w.citedBy,
              // A-followup #3：alreadyInLibrary 只认真式库反查结果；调研库命中的是 inResearch
              alreadyInLibrary: !!w.inLibrary, inResearch: !!w.existed
            };
          })
        });
      }
      if (name === 'collect_papers') {
        var ids = (Array.isArray(a.workIds) ? a.workIds : []).map(String).filter(Boolean).slice(0, 50);
        if (!ids.length) return 'workIds 为空';
        if (!deps.collectWorks) return '当前环境不支持收藏';
        // A-followup #6：同一取消纪律——取文献与确认框都是异步边界，提交前复核
        var collectStopped = function () { return !!(context.cancelRequested && context.cancelRequested()); };
        if (collectStopped()) return '该轮已停止，未收藏';
        var cr = await deps.collectWorks(ids, String(a.folderId || '') || null, { isCancelled: collectStopped });
        if (cr && cr.stopped) return '该轮已停止，未收藏';
        if (cr && cr.canceled) return '用户取消了收藏';
        return JSON.stringify({ collected: true, added: cr && cr.added || 0, merged: cr && cr.merged || 0 });
      }
      if (name === 'download_pdfs') {
        var dlIds = (Array.isArray(a.workIds) ? a.workIds : []).map(String).filter(Boolean).slice(0, 20);
        if (!dlIds.length) return 'workIds 为空';
        if (!context.sessionId) return '缺少会话上下文';
        var dl = await desktop.researchDownloadPdfs({ sessionId: context.sessionId, workIds: dlIds });
        return JSON.stringify({
          results: (dl.results || []).map(function (r) {
            return r.error
              ? { workId: r.workId, error: r.error }
              : { workId: r.workId, file: r.file, title: r.title };
          })
        });
      }
      if (name === 'add_pdfs_to_folder') {
        var files = (Array.isArray(a.files) ? a.files : []).slice(0, 20);
        if (!files.length) return 'files 为空';
        if (!context.sessionId) return '缺少会话上下文';
        if (!deps.importStagedPdfs) return '当前环境不支持收入 PDF';
        // A-followup #6：确认门只保护「进入工具之前」——暂存（下载/复制到受管目录）是长
        // 异步操作，用户完全可能在此期间点停止。异步边界前后各核一次取消状态。
        var stopped = function () { return !!(context.cancelRequested && context.cancelRequested()); };
        if (stopped()) return '该轮已停止，未收入 PDF';
        var staged = await desktop.researchStagePdfs({ sessionId: context.sessionId, files: files });
        if (stopped()) return '该轮已停止，未收入 PDF（已暂存的文件未进正式库）';
        var ok = (staged.results || []).filter(function (r) { return r.path; });
        if (!ok.length) {
          return JSON.stringify({ staged: 0, errors: (staged.results || []).map(function (r) { return r.error; }).filter(Boolean) });
        }
        // 确认框也是异步边界：isCancelled 交给渲染层在「确认通过后、实际提交前」再核一次
        var ir = await deps.importStagedPdfs(ok, String(a.folderId || '') || null, { isCancelled: stopped });
        if (ir && ir.stopped) return '该轮已停止，未收入 PDF';
        if (ir && ir.canceled) return '用户取消了收入';
        return JSON.stringify({ staged: ok.length, added: ir && ir.added || 0, merged: ir && ir.merged || 0 });
      }
      throw new Error('未知工具：' + name);
    }

    return { tools: tools, execute: execute };
  }

  return { createTools: createTools, WRITE_TOOLS: WRITE_TOOLS, isWriteTool: isWriteTool };
});
