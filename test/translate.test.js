'use strict';
/* 划词翻译免费服务适配层：分块 / Google tk / 请求构建 / 响应解析 */
const test = require('node:test');
const assert = require('node:assert');
const LitTranslate = require('../js/translate.js');

test('splitChunks：短文本不分块', () => {
  assert.deepStrictEqual(LitTranslate.splitChunks('Hello world', 100), ['Hello world']);
  assert.deepStrictEqual(LitTranslate.splitChunks('', 100), ['']);
});

test('splitChunks：优先句界切分且拼回原文', () => {
  const text = '第一句。第二句！This is sentence three. 第四句？第五句；The last one.';
  const chunks = LitTranslate.splitChunks(text, 10);
  assert.ok(chunks.length > 1);
  chunks.forEach(c => assert.ok(c.length <= 10));
  assert.strictEqual(chunks.join(''), text);
});

test('splitChunks：英文句点随空白断句、缩写与小数不断开', () => {
  const text = 'Use e.g. words and 3.14 values. Next sentence here.';
  const chunks = LitTranslate.splitChunks(text, 25);
  assert.strictEqual(chunks.join(''), text);
  chunks.forEach(c => assert.ok(c.length <= 25));
  assert.ok(chunks.some(c => c.includes('3.14 values.')));
});

test('splitChunks：超长无标点单句硬切', () => {
  const text = 'a'.repeat(25);
  const chunks = LitTranslate.splitChunks(text, 10);
  assert.deepStrictEqual(chunks, ['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)]);
});

test('splitChunks：句后引号并入前句', () => {
  const chunks = LitTranslate.splitChunks('他说：“你好。”然后离开。', 8);
  assert.strictEqual(chunks.join(''), '他说：“你好。”然后离开。');
  assert.ok(chunks[0].includes('。”'));
});

test('googleTk：相同输入签名稳定且为「余数.异或」形态', () => {
  const tk = LitTranslate.googleTk('Attention is all you need');
  assert.match(tk, /^-?\d+\.-?\d+$/);
  assert.strictEqual(tk, LitTranslate.googleTk('Attention is all you need'));
  const tkCjk = LitTranslate.googleTk('注意力即一切');
  assert.match(tkCjk, /^-?\d+\.-?\d+$/);
});

test('buildGoogleUrl：sl=auto、dt=t、tk 与 q 编码齐全', () => {
  const url = LitTranslate.buildGoogleUrl('hello 世界', 'zh-CN');
  assert.ok(url.startsWith('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&tk='));
  assert.ok(url.endsWith('&q=hello%20%E4%B8%96%E7%95%8C'));
});

test('parseGoogleText：拼接句段、跳过空行', () => {
  const data = [[['Hello ', null], ['world', null], [null, null], null], null, 'en'];
  assert.strictEqual(LitTranslate.parseGoogleText(data), 'Hello world');
  assert.throws(() => LitTranslate.parseGoogleText({}), /无法解析/);
  assert.throws(() => LitTranslate.parseGoogleText([[[null, null]]]), /未返回结果/);
});

test('buildTencentRequest / parseTencentText：transmart 接口契约', () => {
  const req = LitTranslate.buildTencentRequest('hello', 'zh');
  assert.strictEqual(req.url, 'https://transmart.qq.com/api/imt');
  const body = JSON.parse(req.init.body);
  assert.strictEqual(body.header.fn, 'auto_translation');
  assert.deepStrictEqual(body.source.text_list, ['hello']);
  assert.strictEqual(body.source.lang, 'auto');
  assert.strictEqual(body.target.lang, 'zh');
  assert.ok(req.init.headers.Referer.includes('transmart.qq.com'));
  assert.strictEqual(LitTranslate.parseTencentText({ auto_translation: ['你好'] }), '你好');
  assert.throws(() => LitTranslate.parseTencentText({ auto_translation: '' }), /无法解析/);
});

test('buildVolcRequest / parseVolcText：火山扩展接口契约', () => {
  const req = LitTranslate.buildVolcRequest('hello', 'zh');
  assert.strictEqual(req.url, 'https://translate.volcengine.com/crx/translate/v1/');
  const body = JSON.parse(req.init.body);
  assert.deepStrictEqual(body, { source_language: 'auto', target_language: 'zh', text: 'hello' });
  assert.strictEqual(LitTranslate.parseVolcText({ translation: '你好' }), '你好');
  assert.throws(() => LitTranslate.parseVolcText({}), /未返回结果/);
});

test('CNKI：令牌校验、浏览器来源头、words 参数与限流提示', () => {
  const tokenReq = LitTranslate.buildCnkiTokenRequest();
  assert.strictEqual(tokenReq.url, 'https://dict.cnki.net/fyzs-front-api/getToken');
  assert.strictEqual(tokenReq.init.headers.Origin, 'https://dict.cnki.net');
  assert.ok(tokenReq.init.headers.Referer.startsWith('https://dict.cnki.net'));
  assert.strictEqual(LitTranslate.parseCnkiToken({ code: 200, data: 'tk-1' }), 'tk-1');
  assert.throws(() => LitTranslate.parseCnkiToken({ code: 500 }), /令牌/);

  const req = LitTranslate.buildCnkiRequest('a-b_c', 'tk-1');
  assert.strictEqual(req.url, 'https://dict.cnki.net/fyzs-front-api/translate/literaltranslation');
  assert.strictEqual(req.init.headers.Token, 'tk-1');
  assert.strictEqual(req.init.headers.Origin, 'https://dict.cnki.net');
  assert.deepStrictEqual(JSON.parse(req.init.body), { words: 'a-b_c', translateType: null });

  assert.throws(
    () => LitTranslate.parseCnkiText({ code: 200, data: { isInputVerificationCode: true } }),
    /人机验证/
  );
  assert.strictEqual(LitTranslate.parseCnkiText({ code: 200, data: { mResult: '译文' } }), '译文');
});

test('buildMyMemoryUrl / parseMyMemoryText：翻译记忆库接口契约', () => {
  const url = LitTranslate.buildMyMemoryUrl('hello world', 'zh-CN');
  assert.ok(url.startsWith('https://api.mymemory.translated.net/get?q=hello%20world&langpair=Autodetect%7Czh-CN'));
  assert.strictEqual(LitTranslate.parseMyMemoryText({ responseStatus: 200, responseData: { translatedText: ' 你好 ' } }), ' 你好 ');
  assert.throws(
    () => LitTranslate.parseMyMemoryText({ responseStatus: 429, responseDetails: 'DAILY REQUEST LIMIT EXCEEDED' }),
    /额度/
  );
  assert.throws(
    () => LitTranslate.parseMyMemoryText({ responseStatus: 200, responseData: { translatedText: 'QUERY LENGTH LIMIT EXCEEDED' } }),
    /未返回结果/
  );
  assert.throws(() => LitTranslate.parseMyMemoryText({ responseStatus: 200, responseData: {} }), /未返回结果/);
});

test('toUrlSafeBase64：/ → _、+ → -，其余不动', () => {
  assert.strictEqual(LitTranslate.toUrlSafeBase64('a/b+c='), 'a_b-c=');
});

test('免费服务注册表：目标语言代码映射与上限齐全', () => {
  ['google', 'tencent', 'volc', 'cnki', 'mymemory'].forEach(id => {
    assert.ok(LitTranslate.isFreeService(id), id);
    assert.ok(LitTranslate.FREE_SERVICES[id].chunk > 0);
    assert.ok(LitTranslate.FREE_SERVICES[id].max >= LitTranslate.FREE_SERVICES[id].chunk);
    assert.strictEqual(LitTranslate.freeTargetCode(id, 'zh').length > 0, true);
    assert.strictEqual(LitTranslate.freeTargetCode(id, 'en'), 'en');
  });
  assert.strictEqual(LitTranslate.isFreeService('qwen'), false);
  assert.strictEqual(LitTranslate.freeTargetCode('google', 'zh'), 'zh-CN');
  assert.strictEqual(LitTranslate.freeTargetCode('mymemory', 'zh'), 'zh-CN');
  assert.throws(() => LitTranslate.freeTargetCode('nope', 'zh'), /未知免费/);
});

test('splitChunks：分块规格与各服务 chunk 上限一致（复击回归）', () => {
  Object.keys(LitTranslate.FREE_SERVICES).forEach(id => {
    const spec = LitTranslate.FREE_SERVICES[id];
    const count = Math.ceil((spec.max * 2) / 4);
    const text = new Array(count).fill('句子0。').join('');
    const chunks = LitTranslate.splitChunks(text, spec.chunk);
    assert.ok(chunks.length > 1);
    chunks.forEach(c => assert.ok(c.length <= spec.chunk, id + ' chunk 超限'));
    assert.strictEqual(chunks.join(''), text);
  });
});
