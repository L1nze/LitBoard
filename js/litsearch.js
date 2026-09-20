/* LitBoard 段落找文献 · 证据归因纯函数层（浏览器 / Node 共用，零依赖）
 *
 * 定位（对应复审 R16「为这段话找文献」入口）：把「一段话 → 多个可检索论点 → 多源召回 →
 * 摘要级证据筛选 → 逐论点输出候选文献与支撑片段」拆成可测的纯逻辑。
 * 网络召回在主进程（research-net / webfetch-net），本模块只做字符串与排序决策。
 *
 * 三条不可退让的判据：
 * 1. **主题相近 ≠ 支撑论点**：没有命中论点的证据句子就返回 verdict='none'，
 *    绝不因为「召回到了」就标成支持（这是本模块存在的全部理由）；
 * 2. **证据来源必须如实标注**：abstract 是论文摘要、snippet 是网页片段、title 只有标题——
 *    三者可信度不同，输出里逐条带 evidenceSource，界面/模型都能看出强弱；
 * 3. **否定极性要能识别**：论点说「X 无效」而摘要说「X 有效」时标 polarityMismatch，
 *    不把反向证据当作支持证据（矛盾证据是重要发现，不是噪音）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitLitSearch = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var MAX_CLAIMS = 12;
  var MAX_EVIDENCE_PER_CLAIM = 3;
  var EVIDENCE_MIN_SCORE = 0.34;   // 证据句命中的论点词占比下限
  var CANDIDATE_LIMIT_PER_CLAIM = 8;

  // 否定标记：中英各一遍（判定极性用，不做完整语义分析——只防「反向证据被当支持」）
  var NEGATION_RE = /(?:不|无|未|没有|非|否|缺|禁止|抑制|避免|难以|无法|\bnot\b|\bno\b|\bnever\b|\bwithout\b|\black(?:s|ing)?\b|\bfail(?:s|ed|ure)?\b|\bcannot\b|\bcan't\b|\bdoes not\b|\bis not\b|\bunable\b|\binsignificant\b|\bno significant\b)/i;

  // S1：方向词对（上升/下降，中英混排）。词面匹配判不了语义，但「论点说提高、证据句说降低」
  // 这类反向结论必须拦下——否则矛盾证据会被标成 supports（审计复现：increases vs decreases
  // 拿到 verdict=supports）。词表刻意保守（常见比较动词 + 中文对应），词表外的方向靠
  // assessEvidence 的「同向要求」兜底降级。
  var DIRECTION_UP_RE = /increas(?:e|es|ed|ing)?|rais(?:e|es|ed|ing)?|elevat(?:e|es|ed|ion)|improv(?:e|es|ed|ement)|enhanc(?:e|es|ed|ement)|promot(?:e|es|ed|ion)|accelerat(?:e|es|ed|ion)|boost(?:s|ed|ing)?|up-?regulat|augment(?:s|ed|ing)?|提高|提升|增加|升高|改善|促进|上调|增强|加快|延长|上升|更高|更长/i;
  var DIRECTION_DOWN_RE = /decreas(?:e|es|ed|ing)?|reduc(?:e|es|ed|ing)?|lower(?:s|ed|ing)?|diminish(?:es|ed|ing)?|inhibit(?:s|ed|ion)|suppress(?:es|ed|ion)|attenuat(?:e|es|ed|ion)|slow(?:s|ed|ing)?|down-?regulat|worsen(?:s|ed|ing)?|shorten(?:s|ed|ing)?|declin(?:e|es|ed)|降低|减少|下降|恶化|抑制|下调|减弱|减缓|延缓|缩短|更短/i;

  /** 方向检测：'up' | 'down' | 'both'（句内双向并存，自己就矛盾）| ''（无方向词） */
  function directionOf(text) {
    var s = String(text == null ? '' : text);
    var up = DIRECTION_UP_RE.test(s);
    var down = DIRECTION_DOWN_RE.test(s);
    if (up && down) return 'both';
    if (up) return 'up';
    if (down) return 'down';
    return '';
  }
  var STOPWORDS = {
    the: 1, and: 1, for: 1, with: 1, that: 1, this: 1, from: 1, are: 1, was: 1, were: 1,
    has: 1, have: 1, been: 1, its: 1, our: 1, their: 1, than: 1, then: 1, into: 1, over: 1,
    can: 1, may: 1, also: 1, such: 1, more: 1, most: 1, less: 1, but: 1, not: 1, all: 1,
    use: 1, used: 1, using: 1, based: 1, show: 1, shows: 1, shown: 1, results: 1, result: 1,
    study: 1, studies: 1, paper: 1, method: 1, methods: 1, approach: 1, propose: 1, proposed: 1,
    // 中文高频功能词（单字层面已在 bigram 里被稀释，这里挡一部分二字虚词）
    '我们': 1, '他们': 1, '可以': 1, '因此': 1, '以及': 1, '并且': 1, '但是': 1, '然而': 1,
    '本文': 1, '研究': 1, '方法': 1, '结果': 1, '表明': 1, '一个': 1, '这种': 1, '这些': 1
  };
  // 单字层面的高频虚字：留着只会把「论点词命中率」的分母撑大（覆盖度被稀释到阈值以下），
  // 真正承载语义的是 bigram（电池/寿命/精度），所以单字只保留非虚字的。
  var CJK_FUNCTION_CHARS = '的了和是在有与及对为以等就都也很将会能可要不这那我你他它之其于而或则被把从到向由使让给对上下中里时个一二三';

  function isCjk(ch) {
    var code = ch.charCodeAt(0);
    return (code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0x3040 && code <= 0x30ff);
  }

  /**
   * 论点词提取（匹配用，不追求语言学正确）：
   * - 拉丁词：长度 ≥3 的小写词（挡掉停用词）；
   * - CJK：单字 + 相邻 bigram——bigram 让「电池寿命」这类术语比单字匹配可信得多。
   */
  function termsOf(text) {
    var s = String(text == null ? '' : text);
    var out = [];
    var seen = {};
    var push = function (t) {
      if (!t || seen[t] || STOPWORDS[t]) return;
      seen[t] = true;
      out.push(t);
    };
    (s.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []).forEach(push);
    var chars = Array.from(s);
    var cjkRun = [];
    var flush = function () {
      for (var i = 0; i < cjkRun.length; i++) {
        if (CJK_FUNCTION_CHARS.indexOf(cjkRun[i]) === -1) push(cjkRun[i]);
      }
      for (var j = 0; j + 1 < cjkRun.length; j++) push(cjkRun[j] + cjkRun[j + 1]);
      cjkRun = [];
    };
    chars.forEach(function (ch) {
      if (isCjk(ch)) cjkRun.push(ch);
      else flush();
    });
    flush();
    return out;
  }

  /** 论点间共享词比例（0..1）：用于「两个论点其实是同一件事」的合并去重 */
  function overlapRatio(aTerms, bTerms) {
    var a = aTerms || [], b = bTerms || [];
    if (!a.length || !b.length) return 0;
    var setB = {};
    b.forEach(function (t) { setB[t] = 1; });
    var hit = 0;
    a.forEach(function (t) { if (setB[t]) hit++; });
    return hit / Math.min(a.length, b.length);
  }

  /** 论点拆解：模型没给 claims 时按句子切（句末标点/换行），并把高度重叠的句子并成一个 */
  function splitClaims(text, options) {
    var opts = options || {};
    var limit = Math.max(1, Number(opts.limit) || MAX_CLAIMS);
    var minChars = Math.max(4, Number(opts.minChars) || 8);
    var raw = String(text == null ? '' : text)
      .split(/(?<=[。！？；.!?;])\s*|\n+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) {
        // 纯标题式标记与过短片段不是论点
        return Array.from(s).length >= minChars && /[\p{L}\p{N}]/u.test(s);
      });
    var out = [];
    raw.forEach(function (sentence) {
      var terms = termsOf(sentence);
      // 与已有论点高度重叠（≥70%）视为同一条，取更长的那句（信息更全）
      for (var i = 0; i < out.length; i++) {
        if (overlapRatio(terms, out[i].terms) >= 0.7) {
          if (sentence.length > out[i].text.length) {
            out[i] = { text: sentence, terms: terms };
          }
          return;
        }
      }
      out.push({ text: sentence, terms: terms });
    });
    return out.slice(0, limit);
  }

  /** 句子切分（摘要 → 证据候选句） */
  function splitSentences(text) {
    return String(text == null ? '' : text)
      .split(/(?<=[。！？；.!?;])\s*/)
      .map(function (s) { return s.trim(); })
      // 句子太短（"et al." 之类残片）或纯符号的丢掉
      .filter(function (s) { return Array.from(s).length >= 12 && /[\p{L}\p{N}]/u.test(s); });
  }

  function hasNegation(text) {
    return NEGATION_RE.test(String(text == null ? '' : text));
  }

  /**
   * 从候选文献里为一条论点找证据句。
   * 返回 { verdict, polarityMismatch, best, matches[] }：
   * - verdict='none' 表示这篇候选**没有**支撑该论点的可引用句子（不要当支持证据用）；
   * - evidenceSource 如实区分 abstract / snippet / title。
   */
  function assessEvidence(claim, work) {
    var claimText = String(claim == null ? '' : claim);
    var claimTerms = termsOf(claimText);
    var claimNegated = hasNegation(claimText);
    var w = work || {};
    var sources = [
      { kind: 'abstract', text: String(w.abstract || '') },
      { kind: 'snippet', text: String(w.snippet || '') },
      { kind: 'title', text: String(w.title || '') }
    ];
    var matches = [];
    var claimDir = directionOf(claimText); // S1：论点方向（up/down/both/''）——方向性核验的基准
    sources.forEach(function (src) {
      if (!src.text) return;
      var sentences = src.kind === 'title' ? [src.text] : splitSentences(src.text);
      sentences.forEach(function (sentence) {
        var terms = termsOf(sentence);
        if (!terms.length) return;
        var setS = {};
        terms.forEach(function (t) { setS[t] = 1; });
        var hit = 0;
        claimTerms.forEach(function (t) { if (setS[t]) hit++; });
        if (!claimTerms.length) return;
        var score = hit / claimTerms.length;
        if (score < EVIDENCE_MIN_SCORE) return;
        // S1：方向相反（提高 vs 降低）= 极性不符；证据句与论点方向都明确且不一致时绝不 supports
        var sentenceDir = directionOf(sentence);
        var dirMismatch = (claimDir === 'up' && sentenceDir === 'down') ||
          (claimDir === 'down' && sentenceDir === 'up');
        matches.push({
          text: sentence.slice(0, 500),
          score: Math.round(score * 1000) / 1000,
          source: src.kind,
          direction: sentenceDir,
          polarityMismatch: claimNegated !== hasNegation(sentence) || dirMismatch
        });
      });
    });
    matches.sort(function (a, b) { return b.score - a.score; });
    var top = matches.slice(0, MAX_EVIDENCE_PER_CLAIM);
    if (!top.length) {
      // 跨语言是词面匹配的硬边界：中文论点匹配不了英文摘要。如实提示而不是让模型
      // 以为「查过了、确实没有」——英文文献要用英文论点再查一次。
      var claimCjk = /[\u3400-\u9fff]/.test(claimText);
      var workText = String(w.abstract || w.snippet || w.title || '');
      var workCjk = /[\u3400-\u9fff]/.test(workText);
      var crossLang = !!workText && claimCjk !== workCjk;
      return {
        verdict: 'none', polarityMismatch: false, best: null, matches: [],
        note: (w.abstract ? '摘要中未找到支持该论点的句子' : '该候选无摘要（仅有标题），无法判定是否支撑') +
          (crossLang ? '（论点与文献语言不同：证据匹配是词面匹配，英文文献请用英文论点再查；这是未判定，不等于不存在）' : '')
      };
    }
    // 摘要证据优先于网页片段；同级别比分数
    var rank = { abstract: 0, snippet: 1, title: 2 };
    top.sort(function (a, b) {
      if (rank[a.source] !== rank[b.source]) return rank[a.source] - rank[b.source];
      return b.score - a.score;
    });
    var best = top[0];
    var verdict;
    var note = '';
    if (best.source === 'title') {
      // 标题永远不可能承载「证据」——它只说明这篇文献主题相关。
      // 标题命中一律降级为 partial，避免「主题相近」被当成「支撑论点」。
      verdict = 'partial';
      note = '仅在标题中命中该论点（主题相关，标题不含可引用的支撑内容；有摘要时请以摘要证据为准）';
    } else if (best.polarityMismatch) {
      verdict = 'partial';
      note = '证据句与论点极性相反，可能是矛盾证据而非支持证据';
    } else if (claimDir && claimDir !== 'both' && (!best.direction || best.direction === 'both')) {
      // S1 同向要求：论点本身是方向性结论（提高/降低…），而最佳证据句没有出现任何同向
      // 方向词——词面相关但方向未经证实，降级 partial，让模型转述证据原句而不是宣称支持
      verdict = 'partial';
      note = '论点含方向性表述（' + (claimDir === 'up' ? '上升' : '下降') + '），但证据句未出现同向的方向词：仅词面相关，方向是否一致未经证实，请转述证据原句让用户判断';
    } else {
      verdict = 'supports';
    }
    return { verdict: verdict, polarityMismatch: best.polarityMismatch, best: best, matches: top, note: note };
  }

  /**
   * 多变体证据判定（跨语言的关键）：同一条论点可能同时给中文与英文两版，
   * 逐版评一次、取**最好**的判定——中文论点查中文文献、英文论点查英文文献，
   * 而不是让中文论点在英文摘要上必然落空。
   */
  function assessVariants(variants, work) {
    var list = (Array.isArray(variants) ? variants : []).filter(function (v) { return v; });
    if (!list.length) return assessEvidence('', work);
    var rank = { supports: 0, partial: 1, none: 2 };
    var best = null;
    list.forEach(function (v) {
      var ev = assessEvidence(v, work);
      if (!best) { best = ev; return; }
      if (rank[ev.verdict] < rank[best.verdict]) { best = ev; return; }
      if (rank[ev.verdict] === rank[best.verdict] &&
        ev.best && (!best.best || ev.best.score > best.best.score)) best = ev;
    });
    // 附上「这是哪一版论点命中的」，便于模型判断证据语言
    if (best && best.best) {
      var hitVariant = null;
      list.forEach(function (v) {
        if (!hitVariant && assessEvidence(v, work).best &&
          assessEvidence(v, work).best.text === best.best.text) hitVariant = v;
      });
      best.matchedVariant = hitVariant || list[0];
    }
    return best;
  }

  function identityKeys(work) {
    var w = work || {};
    var keys = [];
    var doi = String(w.doi || '').trim().toLowerCase();
    if (doi) keys.push('doi:' + doi);
    var id = String(w.id || w.workId || '').trim();
    if (id) keys.push('id:' + id);
    var title = String(w.title || '').trim().toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
    if (title.length >= 8) keys.push('t:' + title);
    return keys;
  }

  /**
   * 跨源合并（同一篇被多个 provider 召回只留一条）：
   * 匹配键优先级 DOI → workId → 规范化标题；合并时**取各字段的最优值**
   * （摘要谁有就用谁的、被引取最大、OA 直链谁有就用谁的），并把 sources 记全。
   */
  function mergeCandidates(groups) {
    var byKey = {};
    var order = [];
    (Array.isArray(groups) ? groups : []).forEach(function (group) {
      var provider = String((group && group.provider) || '');
      var list = (group && Array.isArray(group.works)) ? group.works : [];
      list.forEach(function (work) {
        if (!work) return;
        var keys = identityKeys(work);
        var existingKey = null;
        for (var i = 0; i < keys.length; i++) {
          if (byKey[keys[i]]) { existingKey = keys[i]; break; }
        }
        var target = existingKey ? byKey[existingKey] : null;
        if (!target) {
          target = {
            workId: String(work.id || work.workId || ''),
            doi: String(work.doi || ''),
            title: String(work.title || ''),
            year: work.year == null ? null : Number(work.year),
            venue: String(work.sourceName || work.venue || ''),
            sourceName: String(work.sourceName || work.venue || ''),
            abstract: String(work.abstract || ''),
            snippet: String(work.snippet || ''),
            pageUrl: String(work.pageUrl || ''),
            oaUrl: String(work.oaUrl || ''),
            citedBy: Number(work.citedBy) || 0,
            type: String(work.type || ''),
            sources: [],
            _terms: termsOf(String(work.title || '') + ' ' + String(work.abstract || ''))
          };
          order.push(target);
        } else {
          // 字段级择优：有值胜过空值，被引取最大
          if (!target.doi && work.doi) target.doi = String(work.doi);
          if (!target.abstract && work.abstract) target.abstract = String(work.abstract);
          if (!target.snippet && work.snippet) target.snippet = String(work.snippet);
          if (!target.pageUrl && work.pageUrl) target.pageUrl = String(work.pageUrl);
          if (!target.oaUrl && work.oaUrl) target.oaUrl = String(work.oaUrl);
          if (!target.venue && (work.sourceName || work.venue)) target.venue = String(work.sourceName || work.venue);
          if (!target.year && work.year) target.year = Number(work.year);
          if (!target.workId && (work.id || work.workId)) target.workId = String(work.id || work.workId);
          if (Number(work.citedBy) > target.citedBy) target.citedBy = Number(work.citedBy);
          if (!target._terms.length) {
            target._terms = termsOf(String(work.title || '') + ' ' + String(work.abstract || ''));
          }
        }
        if (provider && target.sources.indexOf(provider) === -1) target.sources.push(provider);
        keys.forEach(function (key) {
          if (!byKey[key]) byKey[key] = target;
          // 别名也要指向同一条，避免后续同篇从另一个键重复建条目
          else if (byKey[key] !== target) byKey[key] = target;
        });
      });
    });
    return order.map(function (item) {
      delete item._terms;
      return item;
    });
  }

  /** 综合排序：论点词覆盖 + 有摘要 + 被引先验 + 多源命中（被多个 provider 召回说明更相关） */
  function rankForClaim(claimTerms, work) {
    var terms = claimTerms || [];
    var hay = termsOf(String((work && work.title) || '') + ' ' + String((work && work.abstract) || '') +
      ' ' + String((work && work.snippet) || ''));
    var setH = {};
    hay.forEach(function (t) { setH[t] = 1; });
    var hit = 0;
    terms.forEach(function (t) { if (setH[t]) hit++; });
    var coverage = terms.length ? hit / terms.length : 0;
    var cited = Math.log10(Math.max(1, Number(work && work.citedBy) || 0) + 1) / 4;
    var diversity = Math.min(0.1, 0.05 * ((work && work.sources ? work.sources.length : 1) - 1));
    var hasAbstract = (work && work.abstract) ? 0.05 : 0;
    return Math.round((coverage * 0.8 + cited * 0.1 + diversity + hasAbstract) * 1000) / 1000;
  }

  /**
   * 生成逐论点的发现（主进程返回给工具层的最终结构）：
   * candidates 是按打分排序的候选文献，每条带 evidence（verdict/证据句/来源）。
   * 排序把「有支撑证据」的排在前面，但**不隐藏** none 的候选——模型需要看到
   * 「召回到但不支撑」与「根本没召回」的区别。
   *
   * claims 项可以是字符串，也可以是 { text, variants: [其他语言的同一论点] }。
   */
  function buildFindings(claims, candidates, options) {
    var opts = options || {};
    var limit = Math.max(1, Number(opts.perClaim) || CANDIDATE_LIMIT_PER_CLAIM);
    var list = Array.isArray(candidates) ? candidates : [];
    return (Array.isArray(claims) ? claims : []).map(function (claim) {
      var claimText = typeof claim === 'string' ? claim : String((claim && claim.text) || '');
      var variants = (typeof claim === 'object' && claim && Array.isArray(claim.variants))
        ? claim.variants.filter(Boolean)
        : [];
      if (!variants.length) variants = [claimText];
      if (variants.indexOf(claimText) === -1) variants = [claimText].concat(variants);
      var claimTerms = termsOf(variants.join(' '));
      var scored = list.map(function (work) {
        var ev = assessVariants(variants, work);
        return {
          workId: work.workId || '',
          doi: work.doi || '',
          title: work.title || '',
          year: work.year == null ? null : work.year,
          venue: work.venue || work.sourceName || '',
          citedBy: Number(work.citedBy) || 0,
          pageUrl: work.pageUrl || '',
          oaUrl: work.oaUrl || '',
          sources: (work.sources || []).slice(),
          hasAbstract: !!work.abstract,
          score: rankForClaim(claimTerms, work),
          evidence: {
            verdict: ev.verdict,
            polarityMismatch: ev.polarityMismatch,
            source: ev.best ? ev.best.source : '',
            text: ev.best ? ev.best.text : '',
            score: ev.best ? ev.best.score : 0,
            matchedVariant: ev.matchedVariant || '',
            otherMatches: ev.matches.slice(1).map(function (m) {
              return { source: m.source, text: m.text, score: m.score };
            }),
            note: ev.note || ''
          }
        };
      });
      var verdictRank = { supports: 0, partial: 1, none: 2 };
      scored.sort(function (a, b) {
        if (verdictRank[a.evidence.verdict] !== verdictRank[b.evidence.verdict]) {
          return verdictRank[a.evidence.verdict] - verdictRank[b.evidence.verdict];
        }
        return b.score - a.score;
      });
      var top = scored.slice(0, limit);
      var supported = top.filter(function (c) { return c.evidence.verdict === 'supports'; });
      var partial = top.filter(function (c) { return c.evidence.verdict === 'partial'; });
      return {
        claim: claimText,
        terms: claimTerms.slice(0, 12),
        candidates: top,
        summary: supported.length
          ? { status: 'supported', supportedCount: supported.length, partialCount: partial.length }
          : (partial.length
            ? { status: 'partial', supportedCount: 0, partialCount: partial.length }
            : { status: 'not_found', supportedCount: 0, partialCount: 0, note: '未找到支撑该论点的可引用证据（不要用主题相近的文献充当依据）' })
      };
    });
  }

  return {
    MAX_CLAIMS: MAX_CLAIMS,
    EVIDENCE_MIN_SCORE: EVIDENCE_MIN_SCORE,
    termsOf: termsOf,
    overlapRatio: overlapRatio,
    splitClaims: splitClaims,
    splitSentences: splitSentences,
    hasNegation: hasNegation,
    assessEvidence: assessEvidence,
    assessVariants: assessVariants,
    identityKeys: identityKeys,
    mergeCandidates: mergeCandidates,
    rankForClaim: rankForClaim,
    buildFindings: buildFindings
  };
});
