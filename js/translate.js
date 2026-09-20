/* LitBoard 划词翻译免费服务适配层（浏览器 / Node 共用，纯函数）
 *
 * 参考 windingwind/zotero-pdf-translate（MIT）的免费翻译路径，选取 5 个无需
 * API Key 的服务端点，把「请求构建 / 响应解析 / 文本分块 / Google tk 签名」
 * 收敛为可测纯函数；网络收发与令牌缓存（CNKI）在 electron/integrations.js。
 *
 * 各端点契约（改动需同步测试）：
 *   google    GET  translate.googleapis.com/translate_a/single?client=gtx&dt=t&tk=…&q=…
 *                  响应 [0] 为句段数组 [译文, 原文, …]
 *   volc      POST translate.volcengine.com/crx/translate/v1/
 *                  体 {source_language,target_language,text}，响应 {translation}
 *   tencent   POST transmart.qq.com/api/imt（header.fn=auto_translation）
 *                  响应 auto_translation[] 与 text_list 一一对应
 *   cnki      GET  dict.cnki.net/fyzs-front-api/getToken → {code:200,data:令牌}
 *             POST literaltranslation，words = URL 安全 base64(AES-ECB(text))，
 *                  AES-128 密钥 4e87183cfd3a45fe（加密在主进程做），响应 data.mResult；
 *                  两个请求都须带 dict.cnki.net 的 Origin/Referer（否则连接被 WAF 重置）；
 *                  单次 ≤800 字符，超限自动按句分块，被限流时提示网页端过验证
 *   mymemory  GET  api.mymemory.translated.net/get?q=…&langpair=Autodetect|zh-CN
 *                  响应 responseData.translatedText；匿名每日 5000 字符配额
 *
 *   微软必应 Edge/网页两路免费接口 2026-09 在国内网络实测均不可用
 *   （edge …/translatetext 恒 400、ttranslatev3 拒绝），故不接入。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitTranslate = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  // 免费服务商规格：chunk = 单次请求分块上限（字符），max = 划词总量上限，
  // target = 项目目标语言（zh/en）到各服务语言代码的映射。CNKI 中英互译自动识别，
  // target 仅作占位。
  var FREE_SERVICES = {
    google: { chunk: 1400, max: 10000, target: { zh: 'zh-CN', en: 'en' } },
    tencent: { chunk: 2000, max: 10000, target: { zh: 'zh', en: 'en' } },
    volc: { chunk: 4000, max: 10000, target: { zh: 'zh', en: 'en' } },
    cnki: { chunk: 750, max: 4000, target: { zh: 'zh', en: 'en' } },
    // MyMemory 匿名配额每日 5000 字符、单请求 500 字节，故总量与分块都收小
    mymemory: { chunk: 450, max: 4000, target: { zh: 'zh-CN', en: 'en' } }
  };

  function isFreeService(id) {
    return Object.prototype.hasOwnProperty.call(FREE_SERVICES, String(id || ''));
  }

  function freeTargetCode(id, target) {
    var spec = FREE_SERVICES[String(id || '')];
    if (!spec) throw new Error(T('未知免费翻译服务商：') + id);
    return spec.target[target === 'en' ? 'en' : 'zh'];
  }

  // ---------- 文本分块：优先句界切分，超长单句硬切；切点保留标点与前段尾部空白 ----------

  var SENTENCE_CLOSERS = '"\'\u201d\u2019」』）)]】》';

  function isSentenceEnd(text, index) {
    var ch = text.charAt(index);
    if (ch === '\n' || ch === '。' || ch === '！' || ch === '？' || ch === '!' || ch === '?' ||
      ch === ';' || ch === '；') return true;
    // 英文句点只在后随空白 / 引号 / 结尾时视为句界（缩写、小数不断开）
    if (ch === '.') {
      var next = index + 1 < text.length ? text.charAt(index + 1) : '';
      return next === '' || /[\s"'’”)\]}]/.test(next);
    }
    return false;
  }

  function splitSentences(text) {
    var pieces = [];
    var start = 0;
    for (var i = 0; i < text.length; i++) {
      if (!isSentenceEnd(text, i)) continue;
      var end = i + 1;
      while (end < text.length && SENTENCE_CLOSERS.indexOf(text.charAt(end)) >= 0) end++;
      pieces.push(text.slice(start, end));
      start = end;
      i = end - 1;
    }
    if (start < text.length) pieces.push(text.slice(start));
    return pieces;
  }

  function splitChunks(text, max) {
    var source = String(text == null ? '' : text);
    if (!(max > 0) || source.length <= max) return [source];
    var sentences = splitSentences(source);
    var chunks = [];
    var current = '';
    for (var i = 0; i < sentences.length; i++) {
      var piece = sentences[i];
      if (!piece) continue;
      if (piece.length > max) {
        if (current) { chunks.push(current); current = ''; }
        for (var j = 0; j < piece.length; j += max) chunks.push(piece.slice(j, j + max));
        continue;
      }
      if (current.length + piece.length > max) { chunks.push(current); current = piece; }
      else current += piece;
    }
    if (current) chunks.push(current);
    return chunks;
  }

  // ---------- Google（translate.googleapis.com 免费接口，tk 为固定密钥变体签名） ----------

  // tk 算法移植自 windingwind/zotero-pdf-translate（MIT），其本身源自 Google 翻译
  // 网页脚本公开版本；b/b1 为该变体的固定常量，不依赖服务端下发 TKK。
  function googleRl(a, b) {
    for (var c = 0; c < b.length - 2; c += 3) {
      var d = b.charAt(c + 2);
      d = d >= 'a' ? d.charCodeAt(0) - 87 : Number(d);
      d = b.charAt(c + 1) === '+' ? a >>> d : a << d;
      a = b.charAt(c) === '+' ? (a + d) & 4294967295 : a ^ d;
    }
    return a;
  }

  function googleTk(text) {
    var SHIFT_A = '+-a^+6';
    var SHIFT_B = '+-3^+b+-f';
    var bytes = [];
    var f = 0;
    for (var i = 0; i < text.length; i++) {
      var m = text.charCodeAt(i);
      if (m < 128) {
        bytes[f++] = m;
      } else if (m < 2048) {
        bytes[f++] = (m >> 6) | 192;
        bytes[f++] = (m & 63) | 128;
      } else if ((m & 64512) === 55296 && i + 1 < text.length && (text.charCodeAt(i + 1) & 64512) === 56320) {
        m = 65536 + ((m & 1023) << 10) + (text.charCodeAt(++i) & 1023);
        bytes[f++] = (m >> 18) | 240;
        bytes[f++] = ((m >> 12) & 63) | 128;
        bytes[f++] = ((m >> 6) & 63) | 128;
        bytes[f++] = (m & 63) | 128;
      } else {
        bytes[f++] = (m >> 12) | 224;
        bytes[f++] = ((m >> 6) & 63) | 128;
        bytes[f++] = (m & 63) | 128;
      }
    }
    var a = 406644;
    for (i = 0; i < bytes.length; i++) {
      a += bytes[i];
      a = googleRl(a, SHIFT_A);
    }
    a = googleRl(a, SHIFT_B);
    a ^= 3293161072;
    if (a < 0) a = (a & 2147483647) + 2147483648;
    a %= 1000000;
    return String(a) + '.' + (a ^ 406644);
  }

  function buildGoogleUrl(text, targetCode) {
    return 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
      encodeURIComponent(targetCode) + '&dt=t&tk=' + googleTk(String(text)) +
      '&q=' + encodeURIComponent(String(text));
  }

  function parseGoogleText(data) {
    if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error(T('谷歌翻译返回了无法解析的结果'));
    var out = '';
    for (var i = 0; i < data[0].length; i++) {
      var row = data[0][i];
      if (row && row[0]) out += String(row[0]);
    }
    if (!out.trim()) throw new Error(T('谷歌翻译未返回结果'));
    return out;
  }

  // ---------- 腾讯交互翻译（transmart.qq.com 网页端接口） ----------

  // client_key 为 transmart 网页客户端公开固定值（与 zotero-pdf-translate 同源）
  var TENCENT_CLIENT_KEY = 'browser-chrome-110.0.0-Mac OS-df4bd4c5-a65d-44b2-a40f-42f34f3535f2-1677486696487';

  function buildTencentRequest(text, targetCode) {
    return {
      url: 'https://transmart.qq.com/api/imt',
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
          Referer: 'https://transmart.qq.com/zh-CN/index'
        },
        body: JSON.stringify({
          header: { fn: 'auto_translation', client_key: TENCENT_CLIENT_KEY },
          type: 'plain',
          model_category: 'normal',
          source: { lang: 'auto', text_list: [String(text)] },
          target: { lang: targetCode }
        })
      }
    };
  }

  function parseTencentText(data) {
    var rows = data && data.auto_translation;
    if (!Array.isArray(rows)) throw new Error(T('腾讯交互翻译返回了无法解析的结果'));
    var out = rows.filter(Boolean).join('\n').trim();
    if (!out) throw new Error(T('腾讯交互翻译未返回结果'));
    return out;
  }

  // ---------- 火山翻译（translate.volcengine.com 浏览器扩展接口） ----------

  function buildVolcRequest(text, targetCode) {
    return {
      url: 'https://translate.volcengine.com/crx/translate/v1/',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_language: 'auto', target_language: targetCode, text: String(text) })
      }
    };
  }

  function parseVolcText(data) {
    var out = data && data.translation;
    if (!out || !String(out).trim()) throw new Error(T('火山翻译未返回结果'));
    return String(out);
  }

  // ---------- CNKI 学术翻译（dict.cnki.net，自动中英互译；AES 加密在主进程完成） ----------

  // CNKI 的 WAF 会重置不带站点来源的连接，两个请求都必须带浏览器式 Origin/Referer
  var CNKI_BROWSER_HEADERS = {
    Origin: 'https://dict.cnki.net',
    Referer: 'https://dict.cnki.net/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  };
  var CNKI_TOKEN_URL = 'https://dict.cnki.net/fyzs-front-api/getToken';
  var CNKI_TRANSLATE_URL = 'https://dict.cnki.net/fyzs-front-api/translate/literaltranslation';

  function buildCnkiTokenRequest() {
    return { url: CNKI_TOKEN_URL, init: { method: 'GET', headers: CNKI_BROWSER_HEADERS } };
  }

  function parseCnkiToken(data) {
    if (!data || data.code !== 200 || !data.data) throw new Error(T('无法获取 CNKI 翻译令牌'));
    return String(data.data);
  }

  function buildCnkiRequest(wordsBase64Url, token) {
    return {
      url: CNKI_TRANSLATE_URL,
      init: {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json;charset=UTF-8', Token: String(token || '') }, CNKI_BROWSER_HEADERS),
        body: JSON.stringify({ words: String(wordsBase64Url || ''), translateType: null })
      }
    };
  }

  function parseCnkiText(data) {
    var payload = data && data.data;
    if (payload && payload.isInputVerificationCode) {
      throw new Error(T('CNKI 翻译被临时限流，请到 dict.cnki.net 网页端完成一次人机验证后重试'));
    }
    var out = payload && payload.mResult;
    if (!out || !String(out).trim()) throw new Error(T('CNKI 学术翻译未返回结果'));
    return String(out);
  }

  // base64 → URL 安全 base64（CNKI words 参数要求 /→_、+→-）
  function toUrlSafeBase64(base64Text) {
    return String(base64Text || '').replace(/\//g, '_').replace(/\+/g, '-');
  }

  // ---------- MyMemory（翻译记忆库，匿名每日 5000 字符，Autodetect 源语言） ----------

  function buildMyMemoryUrl(text, targetCode) {
    return 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(String(text)) +
      '&langpair=Autodetect%7C' + encodeURIComponent(targetCode);
  }

  function parseMyMemoryText(data) {
    var detail = String((data && data.responseDetails) || '');
    var status = data ? data.responseStatus : null;
    if (Number(status) === 429 || /LIMIT/i.test(detail)) {
      throw new Error(T('MyMemory 免费额度已用完（匿名每日约 5000 字符），请明日再试或改用其他服务商'));
    }
    var out = data && data.responseData && data.responseData.translatedText;
    if (!out || !String(out).trim() || /QUERY LENGTH LIMIT/i.test(String(out))) {
      throw new Error(T('MyMemory 未返回结果'));
    }
    return String(out);
  }

  return {
    FREE_SERVICES: FREE_SERVICES,
    isFreeService: isFreeService,
    freeTargetCode: freeTargetCode,
    splitChunks: splitChunks,
    splitSentences: splitSentences,
    googleTk: googleTk,
    buildGoogleUrl: buildGoogleUrl,
    parseGoogleText: parseGoogleText,
    buildTencentRequest: buildTencentRequest,
    parseTencentText: parseTencentText,
    buildVolcRequest: buildVolcRequest,
    parseVolcText: parseVolcText,
    buildCnkiTokenRequest: buildCnkiTokenRequest,
    parseCnkiToken: parseCnkiToken,
    buildCnkiRequest: buildCnkiRequest,
    parseCnkiText: parseCnkiText,
    buildMyMemoryUrl: buildMyMemoryUrl,
    parseMyMemoryText: parseMyMemoryText,
    toUrlSafeBase64: toUrlSafeBase64
  };
});
