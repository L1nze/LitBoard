'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const LitModel = require('../js/model.js');
const LitSync = require('../js/sync.js');
const LitZotero = require('../js/zotero.js');
const LitNoteMl = require('../js/noteml.js');
const LitTranslate = require('../js/translate.js');
const LitEmbedCfg = require('../js/embedcfg.js');

/** 快照入口解析：目录 → 内部 index.html / 首个 .html；文件 → 原样返回（Zotero 快照是目录型附件，F12） */
async function resolveSnapshotEntry(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isDirectory()) return filePath;
  const entries = await fs.readdir(filePath);
  const entry = entries.find(function (name) { return /^index\.html?$/i.test(name); }) ||
    entries.find(function (name) { return /\.html?$/i.test(name); });
  if (!entry) throw new Error('快照目录中没有可读的 HTML 入口文件：' + filePath);
  return path.join(filePath, entry);
}

function extractFirstPdfFromZip(value) {
  const buffer = Buffer.from(value);
  const minEocd = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minEocd; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Zotero 附件不是有效 ZIP');
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (/\.pdf$/i.test(name) && !name.endsWith('/')) {
      if (flags & 1) throw new Error('不支持加密的 Zotero 附件 ZIP');
      if (uncompressedSize > 500 * 1024 * 1024 || compressedSize > 250 * 1024 * 1024) {
        throw new Error('Zotero PDF 附件过大');
      }
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new Error('Zotero 附件 ZIP 结构损坏');
      }
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.slice(dataStart, dataStart + compressedSize);
      let data;
      if (method === 0) data = Buffer.from(compressed);
      else if (method === 8) data = zlib.inflateRawSync(compressed, { maxOutputLength: 500 * 1024 * 1024 });
      else throw new Error('不支持的 Zotero ZIP 压缩格式');
      return { name: path.posix.basename(name.replace(/\\/g, '/')), data: data };
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('Zotero ZIP 中没有 PDF');
}

/* ---------- stored-ZIP（不压缩）写入/全量解压：网页快照目录的云端载体 ---------- */
const ZIP_CRC_TABLE = (function () {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) crc = ZIP_CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 生成确定性的 stored-ZIP：条目按文件名排序、固定 DOS 日期（1980-01-01）、无压缩。
 * 同样的文件集合永远得到同样的字节，因此 cloudHash（zip 的 sha256）可直接当目录内容指纹。
 */
function zipStoreEntries(entries) {
  const sorted = (entries || []).slice().sort(function (a, b) {
    return String(a.name) < String(b.name) ? -1 : (String(a.name) > String(b.name) ? 1 : 0);
  });
  const parts = [];
  const centrals = [];
  let offset = 0;
  sorted.forEach(function (entry) {
    const name = Buffer.from(String(entry.name).replace(/\\/g, '/').replace(/^\/+/, ''), 'utf8');
    if (!name.length || name.toString('utf8').split('/').indexOf('..') !== -1) {
      throw new Error('非法 ZIP 条目名：' + String(entry.name));
    }
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(33, 12); // 1980-01-01 00:00
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);  // 签名（4 字节）
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0, 8);           // flags
    central.writeUInt16LE(0, 10);          // method = stored
    central.writeUInt16LE(0, 12);          // time
    central.writeUInt16LE(33, 14);         // date = 1980-01-01
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);          // extra length
    central.writeUInt16LE(0, 32);          // comment length
    central.writeUInt16LE(0, 34);          // disk number
    central.writeUInt16LE(0, 36);          // internal attrs
    central.writeUInt32LE(0, 38);          // external attrs
    central.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  });
  const centralSize = centrals.reduce(function (sum, buf) { return sum + buf.length; }, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(sorted.length, 8); eocd.writeUInt16LE(sorted.length, 10);
  eocd.writeUInt32LE(centralSize, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat(parts.concat(centrals).concat([eocd]));
}

/** 全量解压（method 0/8），跳过目录条目；非法条目名（.. / 绝对路径）直接拒绝 */
function extractZipAll(value) {
  const buffer = Buffer.from(value);
  const minEocd = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minEocd; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('不是有效 ZIP');
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
    offset += 46 + nameLength + extraLength + commentLength;
    if (!name || name.endsWith('/')) continue;
    if (path.isAbsolute(name) || name.split('/').indexOf('..') !== -1) {
      throw new Error('ZIP 包含非法条目名：' + name);
    }
    if (flags & 1) throw new Error('不支持加密的 ZIP');
    if (uncompressedSize > 500 * 1024 * 1024 || compressedSize > 500 * 1024 * 1024) throw new Error('ZIP 条目过大');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('ZIP 结构损坏');
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed, { maxOutputLength: 500 * 1024 * 1024 });
    else throw new Error('不支持的 ZIP 压缩格式');
    out.push({ name: name, data: data });
  }
  return out;
}

/* ---------- 受管附件入库复制（files:store-pdf 与 Zotero 导入共用同一命名规则） ---------- */
const STORE_KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function makeStoreKey() {
  let key = 'z';
  for (let i = 0; i < 8; i++) key += STORE_KEY_ALPHABET.charAt(Math.floor(Math.random() * STORE_KEY_ALPHABET.length));
  return key;
}

/** 把单文件复制进受管目录（z + 8 位随机键命名，防冲突循环；源文件保留） */
async function storeFileInto(dir, src, extHint) {
  const ext = /^\.[a-z0-9]{1,12}$/i.test(String(extHint || '')) ? String(extHint).toLowerCase()
    : (path.extname(String(src || '')).toLowerCase() || '.bin');
  const safeExt = /^\.[a-z0-9]{1,12}$/.test(ext) ? ext : '.bin';
  await fs.mkdir(dir, { recursive: true });
  let target = path.join(dir, makeStoreKey() + safeExt);
  while (true) {
    try { await fs.access(target); target = path.join(dir, makeStoreKey() + safeExt); } catch (error) { break; }
  }
  if (path.resolve(src) === path.resolve(target)) {
    return { path: target, name: path.basename(target), unchanged: true };
  }
  await fs.copyFile(src, target);
  return { path: target, name: path.basename(target) };
}

/** 把快照目录整树复制进受管目录（目标 = dir/<z键>/）；返回 { path, files, bytes } */
async function storeDirInto(dir, srcDir, limits) {
  const maxFiles = limits && limits.maxFiles || 2000;
  const maxBytes = limits && limits.maxBytes || 500 * 1024 * 1024;
  await fs.mkdir(dir, { recursive: true });
  let target = path.join(dir, makeStoreKey());
  while (true) {
    try { await fs.access(target); target = path.join(dir, makeStoreKey()); } catch (error) { break; }
  }
  let files = 0, bytes = 0;
  await fs.cp(srcDir, target, { recursive: true });
  // 复制后统计规模（超限即整目录退回，不留半成品）
  async function measure(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) { await measure(abs); continue; }
      if (!entry.isFile()) continue;
      files++;
      bytes += (await fs.stat(abs)).size;
    }
  }
  await measure(target);
  if (files > maxFiles || bytes > maxBytes) {
    await fs.rm(target, { recursive: true, force: true });
    throw new Error('快照目录过大（>' + maxFiles + ' 个文件或 >500MB）');
  }
  return { path: target, files: files, bytes: bytes };
}

function createIntegrations(options) {
  const configFile = path.join(options.baseDir, 'integrations.json');
  const rawRequest = options.fetch;
  const configuredTimeout = Number(options.requestTimeoutMs);
  const REQUEST_TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 30000;
  const request = function (url, init) {
    return new Promise(function (resolve, reject) {
      let settled = false;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const requestInit = Object.assign({}, init || {});
      if (controller) requestInit.signal = controller.signal;
      // 上传大附件时 30s 默认值会中途掐死传输：按负载大小放宽最后期限
      const reqBody = requestInit.body;
      const bodySize = reqBody == null ? 0 : (typeof reqBody === 'string' ? Buffer.byteLength(reqBody) :
        (typeof reqBody.length === 'number' ? reqBody.length : (typeof reqBody.byteLength === 'number' ? reqBody.byteLength : 0)));
      const timeoutMs = requestTimeoutMs(bodySize, REQUEST_TIMEOUT_MS);
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        if (controller) controller.abort();
        reject(new Error('网络请求超时（' + Math.round(timeoutMs / 1000) + 's）：' + String(url)));
      }, timeoutMs);
      Promise.resolve().then(function () { return rawRequest(url, requestInit); }).then(function (response) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      }, function (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  };
  const safeStorage = options.safeStorage;
  // AI 助手接口协议（与 js/agentproto.js 的 DIALECTS 对应；空串 = 自动判定）
  const AGENT_DIALECTS = ['chat', 'responses', 'messages'];
  // AI 助手上下文 / 单轮输出预算（token）的存储上限；默认值在 js/agentcore DEFAULTS
  const AGENT_CONTEXT_TOKENS_MAX = 10000000;
  const AGENT_MAX_OUTPUT_TOKENS_MAX = 1000000;
  // 未配置/非法服务商时的默认值：火山翻译国内直连可用且无需凭据（开箱即用）
  const DEFAULT_TRANSLATOR = 'volc';
  const translators = {
    qwen: { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-mt-plus' },
    aliyun: { url: 'https://mt.cn-hangzhou.aliyuncs.com/', credential: 'accessKey' },
    openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
    deepseek: { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
    // 免费接口（无需凭据）：free=true，请求/解析逻辑见 LitTranslate 与 translateFreeChunk
    google: { free: true },
    tencent: { free: true },
    volc: { free: true },
    cnki: { free: true },
    mymemory: { free: true }
  };
  const FREE_PROVIDER_LABELS = {
    google: '谷歌翻译免费接口',
    tencent: '腾讯交互翻译',
    volc: '火山翻译',
    cnki: 'CNKI 学术翻译',
    mymemory: 'MyMemory 翻译记忆库'
  };

  function encrypt(value) {
    if (!value) return '';
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，无法安全保存密码');
    return safeStorage.encryptString(value).toString('base64');
  }
  function decrypt(value) {
    if (!value || !safeStorage.isEncryptionAvailable()) return '';
    try { return safeStorage.decryptString(Buffer.from(value, 'base64')); } catch (error) { return ''; }
  }
  /** AI 助手的上下文 / 输出预算（token）：0 或非法值 = 「留空」，由渲染层用
   *  js/agentcore DEFAULTS（256000 / 12800）。上限只挡手输的离谱值（1000 万 token 上下文 /
   *  100 万 token 输出已远超任何真实模型），不猜各模型自己的上限——那类边界由端点在 400 里说。 */
  function agentTokenBudget(value, max) {
    const n = Math.floor(Number(value));
    if (!isFinite(n) || n <= 0) return 0;
    return Math.min(n, max);
  }
  async function loadRawConfig() {
    let raw = {};
    try { raw = JSON.parse(await fs.readFile(configFile, 'utf8')); } catch (error) { return {}; }
    if (raw.translatorProvider && !translators[raw.translatorProvider]) {
      // 已移除或未知的翻译服务商：回退默认服务商并丢弃其凭据，
      // 避免残留的 Key 被其他服务商误用。
      raw.translatorProvider = DEFAULT_TRANSLATOR;
      raw.translatorApiKey = '';
    }
    return raw;
  }
  async function writeRawConfig(value) {
    await fs.mkdir(options.baseDir, { recursive: true });
    const temp = configFile + '.tmp-' + process.pid + '-' + Date.now();
    await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
    try {
      await fs.rename(temp, configFile);
    } catch (error) {
      // Windows cannot always replace an existing file with rename; retain a
      // complete temp payload and use overwrite-copy as the compatibility path.
      try { await fs.copyFile(temp, configFile); }
      finally { await fs.rm(temp, { force: true }).catch(function () {}); }
    }
  }
  async function getConfig() {
    const raw = await loadRawConfig();
    // 向量模型目标解析（唯一权威规则在 js/embedcfg.js）：设置页据此显示「当前用谁的 Key」
    // 与调研库向量是否可用——Key 只判有无，密文不出主进程。
    const embedTarget = LitEmbedCfg.resolveTarget({
      embedProvider: raw.embedProvider,
      embedBaseUrl: raw.embedBaseUrl,
      embedApiKey: raw.embedApiKey ? 'set' : '',
      embedModel: raw.embedModel,
      agentBaseUrl: raw.agentBaseUrl,
      agentApiKey: raw.agentApiKey ? 'set' : ''
    });
    return {
      nutstoreUrl: raw.nutstoreUrl || 'https://dav.jianguoyun.com/dav/',
      nutstoreUser: raw.nutstoreUser || '',
      hasNutstorePassword: !!raw.nutstorePassword,
      nutstoreFolder: normalizeWebDavFolder(raw.nutstoreFolder, 'LitBoard'),
      zoteroWebDavFolder: raw.zoteroWebDavFolder || 'zotero',
      zoteroDataDir: raw.zoteroDataDir || '',
      translatorProvider: translators[raw.translatorProvider] ? raw.translatorProvider : DEFAULT_TRANSLATOR,
      translatorModel: String(raw.translatorModel || ''),
      translatorTarget: raw.translatorTarget === 'en' ? 'en' : 'zh',
      hasTranslatorApiKey: !!raw.translatorApiKey,
      rankProvider: 'easyscholar' === raw.rankProvider ? 'easyscholar' : 'scigreat',
      hasScigreatApiKey: !!raw.scigreatApiKey,
      hasEasyscholarApiKey: !!raw.easyscholarApiKey,
      pdfCacheDir: String(raw.pdfCacheDir || '').trim(),
      pdfDownloadDir: String(raw.pdfDownloadDir || '').trim(),
      renameTemplate: String(raw.renameTemplate || ''),
      proxyPrefix: String(raw.proxyPrefix || ''),
      trashRetentionDays: raw.trashRetentionDays == null ? null : Number(raw.trashRetentionDays),
      autoWriteBack: raw.autoWriteBack == null ? null : raw.autoWriteBack === true,
      bibExportPath: String(raw.bibExportPath || '').trim(),
      agentBaseUrl: String(raw.agentBaseUrl || '').trim(),
      agentModel: String(raw.agentModel || '').trim(),
      // 接口协议：'' = 自动（按 URL 尾段/域名判定），chat | responses | messages 为显式指定
      agentApiDialect: AGENT_DIALECTS.indexOf(raw.agentApiDialect) >= 0 ? raw.agentApiDialect : '',
      // 上下文 / 单轮输出预算（token）：0 = 留空，用渲染层默认值（256000 / 12800）
      agentContextTokens: agentTokenBudget(raw.agentContextTokens, AGENT_CONTEXT_TOKENS_MAX),
      agentMaxOutputTokens: agentTokenBudget(raw.agentMaxOutputTokens, AGENT_MAX_OUTPUT_TOKENS_MAX),
      hasAgentApiKey: !!raw.agentApiKey,
      // 向量模型（调研库向量专用）：独立 provider / Base URL / API Key / 模型名
      embedProvider: String(raw.embedProvider || '').trim(),
      embedBaseUrl: String(raw.embedBaseUrl || '').trim(),
      embedModel: String(raw.embedModel || '').trim(),
      hasEmbedApiKey: !!raw.embedApiKey,
      embedReady: embedTarget.ok === true,
      embedSource: embedTarget.source,
      openalexEmail: String(raw.openalexEmail || '').trim(),
      hasOpenalexApiKey: !!raw.openalexApiKey,
      hasElsevierApiKey: !!raw.elsevierApiKey,
      hasTinyfishApiKey: !!raw.tinyfishApiKey,
      hasSemanticscholarApiKey: !!raw.semanticscholarApiKey
    };
  }
  async function saveConfig(input) {
    const current = await loadRawConfig();
    const next = {
      nutstoreUrl: String(input.nutstoreUrl != null ? input.nutstoreUrl : current.nutstoreUrl || 'https://dav.jianguoyun.com/dav/').trim(),
      nutstoreUser: String(input.nutstoreUser != null ? input.nutstoreUser : current.nutstoreUser || '').trim(),
      nutstorePassword: input.nutstorePassword ? encrypt(String(input.nutstorePassword)) : current.nutstorePassword || '',
      nutstoreFolder: normalizeWebDavFolder(input.nutstoreFolder != null ? input.nutstoreFolder : current.nutstoreFolder, 'LitBoard'),
      zoteroWebDavFolder: String(input.zoteroWebDavFolder != null ? input.zoteroWebDavFolder : current.zoteroWebDavFolder || 'zotero')
        .trim().replace(/^\/+|\/+$/g, '') || 'zotero',
      zoteroDataDir: String(input.zoteroDataDir != null ? input.zoteroDataDir : current.zoteroDataDir || '').trim(),
      translatorProvider: translators[input.translatorProvider] ? input.translatorProvider : (translators[current.translatorProvider] ? current.translatorProvider : DEFAULT_TRANSLATOR),
      translatorModel: String(input.translatorModel != null ? input.translatorModel : current.translatorModel || '').trim(),
      translatorTarget: input.translatorTarget != null
        ? (input.translatorTarget === 'en' ? 'en' : 'zh')
        : (current.translatorTarget === 'en' ? 'en' : 'zh'),
      translatorApiKey: input.translatorApiKey ? encrypt(String(input.translatorApiKey)) : current.translatorApiKey || '',
      rankProvider: input.rankProvider === 'easyscholar' ? 'easyscholar' : (current.rankProvider === 'easyscholar' ? 'easyscholar' : 'scigreat'),
      scigreatApiKey: input.scigreatApiKey ? encrypt(String(input.scigreatApiKey)) : current.scigreatApiKey || '',
      easyscholarApiKey: input.easyscholarApiKey ? encrypt(String(input.easyscholarApiKey)) : current.easyscholarApiKey || '',
      configSyncPassword: input.configSyncPassword ? encrypt(String(input.configSyncPassword)) : current.configSyncPassword || '',
      pdfCacheDir: String(input.pdfCacheDir != null ? input.pdfCacheDir : current.pdfCacheDir || '').trim(),
      pdfDownloadDir: String(input.pdfDownloadDir != null ? input.pdfDownloadDir : current.pdfDownloadDir || '').trim(),
      renameTemplate: String(input.renameTemplate != null ? input.renameTemplate : current.renameTemplate || '').trim(),
      proxyPrefix: String(input.proxyPrefix != null ? input.proxyPrefix : current.proxyPrefix || '').trim(),
      trashRetentionDays: input.trashRetentionDays != null ? Math.max(0, Math.min(3650, Number(input.trashRetentionDays) || 0)) : current.trashRetentionDays,
      autoWriteBack: input.autoWriteBack != null ? input.autoWriteBack === true : current.autoWriteBack,
      bibExportPath: String(input.bibExportPath != null ? input.bibExportPath : current.bibExportPath || '').trim(),
      agentBaseUrl: String(input.agentBaseUrl != null ? input.agentBaseUrl : current.agentBaseUrl || '').trim(),
      agentModel: String(input.agentModel != null ? input.agentModel : current.agentModel || '').trim(),
      agentApiDialect: AGENT_DIALECTS.indexOf(input.agentApiDialect != null ? input.agentApiDialect : current.agentApiDialect) >= 0
        ? (input.agentApiDialect != null ? input.agentApiDialect : current.agentApiDialect)
        : '',
      agentContextTokens: input.agentContextTokens != null
        ? agentTokenBudget(input.agentContextTokens, AGENT_CONTEXT_TOKENS_MAX)
        : agentTokenBudget(current.agentContextTokens, AGENT_CONTEXT_TOKENS_MAX),
      agentMaxOutputTokens: input.agentMaxOutputTokens != null
        ? agentTokenBudget(input.agentMaxOutputTokens, AGENT_MAX_OUTPUT_TOKENS_MAX)
        : agentTokenBudget(current.agentMaxOutputTokens, AGENT_MAX_OUTPUT_TOKENS_MAX),
      agentApiKey: input.agentApiKey ? encrypt(String(input.agentApiKey)) : current.agentApiKey || '',
      // 向量模型（专用 Key 一旦填过就保留；留空 = 不改动，与其余 Key 同约定）
      embedProvider: String(input.embedProvider != null ? input.embedProvider : current.embedProvider || '').trim(),
      embedBaseUrl: String(input.embedBaseUrl != null ? input.embedBaseUrl : current.embedBaseUrl || '').trim(),
      embedModel: String(input.embedModel != null ? input.embedModel : current.embedModel || '').trim(),
      embedApiKey: input.embedApiKey ? encrypt(String(input.embedApiKey)) : current.embedApiKey || '',
      openalexEmail: String(input.openalexEmail != null ? input.openalexEmail : current.openalexEmail || '').trim(),
      openalexApiKey: input.openalexApiKey ? encrypt(String(input.openalexApiKey)) : current.openalexApiKey || '',
      elsevierApiKey: input.elsevierApiKey ? encrypt(String(input.elsevierApiKey)) : current.elsevierApiKey || '',
      tinyfishApiKey: input.tinyfishApiKey ? encrypt(String(input.tinyfishApiKey)) : current.tinyfishApiKey || '',
      semanticscholarApiKey: input.semanticscholarApiKey ? encrypt(String(input.semanticscholarApiKey)) : current.semanticscholarApiKey || '',
      configUpdatedAt: Number(current.configUpdatedAt) || 0
    };
    const currentSynced = syncedConfigPayload(current);
    const nextSynced = syncedConfigPayload(next);
    delete currentSynced.updatedAt;
    delete nextSynced.updatedAt;
    if (JSON.stringify(currentSynced) !== JSON.stringify(nextSynced)) {
      next.configUpdatedAt = Math.max(Date.now(), (Number(current.configUpdatedAt) || 0) + 1);
    }
    await writeRawConfig(next);
    return getConfig();
  }
  function basicAuth(user, password) {
    return 'Basic ' + Buffer.from(user + ':' + password, 'utf8').toString('base64');
  }
  function joinUrl(base, suffix) {
    return String(base || '').replace(/\/+$/, '') + '/' + suffix.replace(/^\/+/, '');
  }

  function normalizeWebDavFolder(value, fallback) {
    const folder = String(value == null ? '' : value).trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!folder) return fallback;
    if (folder.length > 200 || /[?#\u0000-\u001f]/.test(folder) || folder.split('/').some(function (part) {
      return !part || part === '.' || part === '..';
    })) throw new Error('坚果云同步目录格式无效');
    return folder;
  }

  function validateWebDavUrl(value) {
    let parsed;
    try { parsed = new URL(String(value || '')); } catch (error) { throw new Error('坚果云 WebDAV 地址无效'); }
    const localHttp = parsed.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname);
    if (parsed.protocol !== 'https:' && !localHttp) throw new Error('坚果云 WebDAV 必须使用 HTTPS');
    return parsed.href;
  }

  async function ensureWebDavFolder(baseUrl, folder, headers) {
    let current = String(baseUrl || '').replace(/\/+$/, '');
    let finalStatus = 0;
    for (const part of folder.split('/')) {
      current = joinUrl(current, part);
      const response = await request(current, { method: 'MKCOL', headers: headers });
      throwIfWebDavRateLimited(response);
      finalStatus = response.status;
      if (!response.ok && response.status !== 405) {
        throw new Error('无法在坚果云创建“' + folder + '”目录（' + response.status + '）');
      }
    }
    return finalStatus;
  }

  function deriveConfigKey(password, salt) {
    return new Promise(function (resolve, reject) {
      crypto.scrypt(password, salt, 32, function (error, key) { if (error) reject(error); else resolve(key); });
    });
  }
  async function encryptSyncedConfig(value, password, envelopeVersion) {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = await deriveConfigKey(password, salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify({ version: envelopeVersion === 2 ? 2 : 1, kdf: 'scrypt', salt: salt.toString('base64'), iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
  }
  async function decryptSyncedConfig(value, password) {
    let envelope;
    try { envelope = JSON.parse(value); } catch (error) { throw new Error('配置同步文件不是有效 JSON'); }
    if (!envelope || (envelope.version !== 1 && envelope.version !== 2) || !envelope.salt || !envelope.iv || !envelope.tag || !envelope.data) {
      throw new Error('配置同步文件格式不受支持');
    }
    try {
      const key = await deriveConfigKey(password, Buffer.from(envelope.salt, 'base64'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const decoded = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('配置同步内容无效');
      return decoded;
    } catch (error) { throw new Error('无法解密配置同步文件，请确认配置加密密码一致'); }
  }
  function syncedPortableSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {};
    if (source.trashRetentionDays != null) {
      const days = Number(source.trashRetentionDays);
      if (Number.isFinite(days) && days >= 0) result.trashRetentionDays = Math.min(3650, Math.trunc(days));
    }
    if (source.autoWriteBack != null) result.autoWriteBack = source.autoWriteBack === true;
    return result;
  }
  function syncedConfigPayload(raw, portableSettings) {
    const settings = syncedPortableSettings(portableSettings || raw);
    return {
      // payload version 2 adds portable behaviour settings.  The outer
      // envelope remains v1 by default for compatibility with existing files.
      version: 2,
      updatedAt: Number(raw.configUpdatedAt) || 0,
      translatorProvider: translators[raw.translatorProvider] ? raw.translatorProvider : DEFAULT_TRANSLATOR,
      translatorModel: String(raw.translatorModel || ''),
      translatorTarget: raw.translatorTarget === 'en' ? 'en' : 'zh',
      translatorApiKey: decrypt(raw.translatorApiKey),
      scigreatApiKey: decrypt(raw.scigreatApiKey),
      easyscholarApiKey: decrypt(raw.easyscholarApiKey),
      rankProvider: 'easyscholar' === raw.rankProvider ? 'easyscholar' : 'scigreat',
      zoteroWebDavFolder: String(raw.zoteroWebDavFolder || 'zotero'),
      renameTemplate: String(raw.renameTemplate || ''),
      proxyPrefix: String(raw.proxyPrefix || ''),
      trashRetentionDays: settings.trashRetentionDays,
      autoWriteBack: settings.autoWriteBack
    };
  }
  function syncedConfigContent(value) {
    return JSON.stringify({
      version: 2,
      translatorProvider: translators[value.translatorProvider] ? value.translatorProvider : DEFAULT_TRANSLATOR,
      translatorModel: String(value.translatorModel || ''),
      translatorTarget: value.translatorTarget === 'en' ? 'en' : 'zh',
      translatorApiKey: String(value.translatorApiKey || ''),
      scigreatApiKey: String(value.scigreatApiKey || ''),
      easyscholarApiKey: String(value.easyscholarApiKey || ''),
      rankProvider: value.rankProvider === 'easyscholar' ? 'easyscholar' : 'scigreat',
      zoteroWebDavFolder: String(value.zoteroWebDavFolder || 'zotero'),
      renameTemplate: String(value.renameTemplate || ''),
      proxyPrefix: String(value.proxyPrefix || ''),
      trashRetentionDays: value.trashRetentionDays == null ? undefined : Number(value.trashRetentionDays),
      autoWriteBack: value.autoWriteBack == null ? undefined : value.autoWriteBack === true
    });
  }
  async function applySyncedConfig(raw, remote, options) {
    // 密钥字段采用“远端非空才覆盖”的合并策略：某台设备没填 Key 时，
    // 同步绝不能把另一台设备已配置的 Key 抹掉（这是多设备同步的安全底线）。
    if (remote && remote.translatorProvider && !translators[remote.translatorProvider]) {
      // 旧版本设备可能同步来已移除的服务商：回退默认并丢弃其凭据。
      remote = Object.assign({}, remote, { translatorProvider: DEFAULT_TRANSLATOR, translatorApiKey: '' });
    }
    const local = syncedConfigPayload(raw, options && options.portableSettings);
    const merged = Object.assign({}, remote, {
      translatorApiKey: remote.translatorApiKey || local.translatorApiKey,
      scigreatApiKey: remote.scigreatApiKey || local.scigreatApiKey,
      easyscholarApiKey: remote.easyscholarApiKey || local.easyscholarApiKey,
      // v1 payloads predate these settings; absent values must not reset a
      // device's existing behaviour configuration.
      renameTemplate: remote.renameTemplate != null ? remote.renameTemplate : local.renameTemplate,
      proxyPrefix: remote.proxyPrefix != null ? remote.proxyPrefix : local.proxyPrefix,
      trashRetentionDays: remote.trashRetentionDays != null ? Number(remote.trashRetentionDays) : local.trashRetentionDays,
      autoWriteBack: remote.autoWriteBack != null ? remote.autoWriteBack === true : local.autoWriteBack
    });
    const matchesRemote = syncedConfigContent(merged) === syncedConfigContent(remote);
    const storedKey = function (value, current) {
      const plain = String(value || '');
      if (!plain) return '';
      return decrypt(current) === plain ? current : encrypt(plain);
    };
    const next = Object.assign({}, raw, {
      translatorProvider: translators[merged.translatorProvider] ? merged.translatorProvider : DEFAULT_TRANSLATOR,
      translatorModel: String(merged.translatorModel || ''),
      translatorTarget: merged.translatorTarget === 'en' ? 'en' : 'zh',
      translatorApiKey: storedKey(merged.translatorApiKey, raw.translatorApiKey || ''),
      scigreatApiKey: storedKey(merged.scigreatApiKey, raw.scigreatApiKey || ''),
      easyscholarApiKey: storedKey(merged.easyscholarApiKey, raw.easyscholarApiKey || ''),
      rankProvider: merged.rankProvider === 'easyscholar' ? 'easyscholar' : 'scigreat',
      zoteroWebDavFolder: String(merged.zoteroWebDavFolder || raw.zoteroWebDavFolder || 'zotero'),
      renameTemplate: String(merged.renameTemplate != null ? merged.renameTemplate : raw.renameTemplate || '').trim(),
      proxyPrefix: String(merged.proxyPrefix != null ? merged.proxyPrefix : raw.proxyPrefix || '').trim(),
      trashRetentionDays: merged.trashRetentionDays == null ? raw.trashRetentionDays : Math.max(0, Math.min(3650, Number(merged.trashRetentionDays) || 0)),
      autoWriteBack: merged.autoWriteBack != null ? merged.autoWriteBack === true : raw.autoWriteBack,
      configUpdatedAt: matchesRemote
        ? Number(remote.updatedAt) || 0
        : Math.max(Number(remote.updatedAt) || 0, Number(raw.configUpdatedAt) || 0) + 1
    });
    if (JSON.stringify(next) !== JSON.stringify(raw)) await writeRawConfig(next);
    return next;
  }
  function responseEtag(response) {
    if (!response || !response.headers) return '';
    try {
      if (typeof response.headers.get === 'function') return String(response.headers.get('etag') || response.headers.get('ETag') || '').trim();
    } catch (error) {}
    return String(response.headers.etag || response.headers.ETag || '').trim();
  }

  class RemoteChangedError extends Error {
    constructor(message, url) {
      super(message || '远端文件在同步期间发生变化，请重新读取后重试');
      this.name = 'RemoteChangedError';
      this.code = 'REMOTE_CHANGED';
      this.url = url || '';
    }
  }

  class WebDavRateLimitError extends Error {
    constructor(response) {
      const retryAfter = response && response.headers && response.headers.get
        ? String(response.headers.get('retry-after') || '').trim() : '';
      super('坚果云 WebDAV 已触发访问频率限制，请暂停同步并在 30 分钟额度窗口恢复后重试' +
        (retryAfter ? '（服务器建议等待 ' + retryAfter + ' 秒）' : ''));
      this.name = 'WebDavRateLimitError';
      this.code = 'WEBDAV_RATE_LIMITED';
      this.retryAfter = retryAfter;
    }
  }

  function throwIfWebDavRateLimited(response) {
    if (response && response.status === 429) throw new WebDavRateLimitError(response);
  }

  async function conditionalPut(url, body, headers, etag, options) {
    const settings = options || {};
    const putHeaders = Object.assign({ 'Content-Type': settings.contentType || 'application/octet-stream' }, headers || {});
    if (etag) putHeaders['If-Match'] = etag;
    else if (settings.createOnly) putHeaders['If-None-Match'] = '*';
    const response = await request(url, { method: 'PUT', headers: putHeaders, body: body });
    throwIfWebDavRateLimited(response);
    if (response.status === 412 || (response.status === 409 && settings.conditional)) {
      throw new RemoteChangedError('远端文件已被其他设备修改，请重新生成同步计划', url);
    }
    if (!response.ok) throw new Error((settings.label || '坚果云写入') + '失败（' + response.status + '）');
    return response;
  }

  function portableConfigView(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      version: Number(value.version) || 1,
      updatedAt: Number(value.updatedAt) || 0,
      translatorProvider: translators[value.translatorProvider] ? value.translatorProvider : DEFAULT_TRANSLATOR,
      translatorModel: String(value.translatorModel || ''),
      translatorTarget: value.translatorTarget === 'en' ? 'en' : 'zh',
      hasTranslatorApiKey: !!String(value.translatorApiKey || ''),
      hasScigreatApiKey: !!String(value.scigreatApiKey || ''),
      hasEasyscholarApiKey: !!String(value.easyscholarApiKey || ''),
      rankProvider: value.rankProvider === 'easyscholar' ? 'easyscholar' : 'scigreat',
      zoteroWebDavFolder: String(value.zoteroWebDavFolder || 'zotero'),
      renameTemplate: String(value.renameTemplate || ''),
      proxyPrefix: String(value.proxyPrefix || ''),
      trashRetentionDays: value.trashRetentionDays == null ? null : Number(value.trashRetentionDays),
      autoWriteBack: value.autoWriteBack == null ? null : value.autoWriteBack === true
    };
  }

  async function readRemoteConfig(folderUrl, headers, password, options) {
    const settings = options || {};
    const configFolderUrl = joinUrl(folderUrl, 'config');
    const configFileUrl = joinUrl(configFolderUrl, 'litboard-config.enc');
    const response = await request(configFileUrl, { method: 'GET', headers: headers });
    const result = { exists: false, etag: responseEtag(response), status: response.status, value: null, locked: false,
      folderUrl: configFolderUrl, fileUrl: configFileUrl };
    if (response.status === 404) return result;
    if (response.status === 409) {
      result.pathConflict = true;
      return result;
    }
    if (!response.ok) throw new Error('坚果云配置读取失败（' + response.status + '）');
    result.exists = true;
    const text = await response.text();
    if (!password) {
      result.locked = true;
      return result;
    }
    result.value = await decryptSyncedConfig(text, password);
    if (!settings.publicOnly) result.rawText = text;
    return result;
  }

  async function syncEncryptedConfig(folderUrl, headers, rawConfig, options) {
    const settings = options || {};
    const password = settings.passwordOverride || decrypt(rawConfig.configSyncPassword);
    if (!password) return rawConfig;
    const configFolderUrl = joinUrl(folderUrl, 'config');
    const configFileUrl = joinUrl(configFolderUrl, 'litboard-config.enc');
    let current = rawConfig;
    let remote = null;
    let remoteEtag = '';
    let remoteText = '';
    let remoteApplied = false;
    const response = await request(configFileUrl, { method: 'GET', headers: headers });
    remoteEtag = responseEtag(response);
    if (response.status === 404 || response.status === 409) {
      if (settings.readOnly) return current;
      const mkcol = await request(configFolderUrl, { method: 'MKCOL', headers: headers });
      if (!mkcol.ok && mkcol.status !== 405) throw new Error('无法在坚果云创建 config 目录（' + mkcol.status + '）');
      if (response.status === 409 && mkcol.status === 405) throw new Error('坚果云 config 路径冲突，请确认同步目录下的 config 是文件夹');
    } else if (!response.ok) {
      throw new Error('坚果云配置读取失败（' + response.status + '）');
    } else {
      remoteText = await response.text();
      remote = await decryptSyncedConfig(remoteText, password);
      if (Number(remote.updatedAt) > Number(current.configUpdatedAt || 0)) {
        current = await applySyncedConfig(current, remote, settings);
        remoteApplied = true;
      }
    }
    if (settings.readOnly) return current;
    // 远端版本更新并已落盘时，后续写入必须以合并后的 raw 为准，
    // 不能再用本机同步开始时的旧 settings 把远端值写回去。
    const local = syncedConfigPayload(current, remoteApplied ? current : settings.portableSettings);
    const shouldWrite = !remote || Number(local.updatedAt) > Number(remote.updatedAt || 0) ||
      (Number(local.updatedAt) === Number(remote.updatedAt || 0) && syncedConfigContent(local) !== syncedConfigContent(remote));
    if (shouldWrite) {
      if (remote && !remoteEtag) {
        const latest = await request(configFileUrl, { method: 'GET', headers: headers });
        if (!latest.ok) throw new Error('坚果云配置复核失败（' + latest.status + '）');
        const latestText = await latest.text();
        if (latestText !== remoteText) throw new RemoteChangedError('远端配置已被其他设备修改，请重新同步', configFileUrl);
      }
      const encrypted = await encryptSyncedConfig(local, password, settings.envelopeVersion);
      await conditionalPut(configFileUrl, encrypted, headers, remoteEtag, {
        contentType: 'application/json; charset=utf-8', label: '坚果云配置写入', conditional: !!remoteEtag || !!settings.requireEtag,
        createOnly: !remote
      });
    }
    return current;
  }

  function aliyunPercentEncode(value) {
    return encodeURIComponent(String(value)).replace(/[!'()*]/g, function (character) {
      return '%' + character.charCodeAt(0).toString(16).toUpperCase();
    });
  }

  function aliyunTranslationRequest(provider, credential, text, target) {
    const separator = credential.indexOf('@');
    const accessKeyId = separator > 0 ? credential.slice(0, separator).trim() : '';
    const accessKeySecret = separator > 0 ? credential.slice(separator + 1).trim() : '';
    if (!accessKeyId || !accessKeySecret) {
      throw new Error('阿里云机器翻译凭据格式应为 AccessKey ID@AccessKey Secret');
    }
    const parameters = {
      AccessKeyId: accessKeyId,
      Action: 'TranslateGeneral',
      Format: 'JSON',
      FormatType: 'text',
      Scene: 'general',
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
      SignatureVersion: '1.0',
      SourceLanguage: 'auto',
      SourceText: text,
      TargetLanguage: target,
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      Version: '2018-10-12'
    };
    const canonical = Object.keys(parameters).sort().map(function (key) {
      return aliyunPercentEncode(key) + '=' + aliyunPercentEncode(parameters[key]);
    }).join('&');
    const stringToSign = 'POST&%2F&' + aliyunPercentEncode(canonical);
    parameters.Signature = crypto.createHmac('sha1', accessKeySecret + '&').update(stringToSign).digest('base64');
    return request(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: Object.keys(parameters).sort().map(function (key) {
        return aliyunPercentEncode(key) + '=' + aliyunPercentEncode(parameters[key]);
      }).join('&')
    });
  }

  // ============ 免费翻译接口（无需凭据，请求构建/解析在 js/translate.js） ============

  async function readTranslationBody(response, label) {
    const body = await response.text();
    let data = {};
    try { data = body ? JSON.parse(body) : {}; } catch (error) { throw new Error(label + '返回了无效 JSON'); }
    if (!response.ok) {
      const detail = (data && data.error && data.error.message) || (data && (data.message || data.Message)) || '';
      throw new Error(label + '请求失败（' + response.status + '）' + (detail ? '：' + detail : ''));
    }
    return data;
  }

  let cnkiTokenCache = { value: '', t: 0 };
  async function getCnkiToken() {
    // 令牌复用 4 分钟（zotero-pdf-translate 缓存 5 分钟，留安全余量）
    if (cnkiTokenCache.value && Date.now() - cnkiTokenCache.t < 4 * 60 * 1000) return cnkiTokenCache.value;
    const tokenRequest = LitTranslate.buildCnkiTokenRequest();
    const response = await request(tokenRequest.url, tokenRequest.init);
    const token = LitTranslate.parseCnkiToken(await readTranslationBody(response, 'CNKI 学术翻译'));
    cnkiTokenCache = { value: token, t: Date.now() };
    return token;
  }

  function cnkiWords(text) {
    const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from('4e87183cfd3a45fe', 'utf8'), null);
    return LitTranslate.toUrlSafeBase64(cipher.update(String(text), 'utf8', 'base64') + cipher.final('base64'));
  }

  async function translateFreeChunk(providerName, chunk, targetCode) {
    const label = FREE_PROVIDER_LABELS[providerName] || providerName;
    let parsed = null;
    if (providerName === 'google') {
      parsed = LitTranslate.parseGoogleText(await readTranslationBody(await request(LitTranslate.buildGoogleUrl(chunk, targetCode), { method: 'GET' }), label));
    } else if (providerName === 'tencent') {
      const req = LitTranslate.buildTencentRequest(chunk, targetCode);
      parsed = LitTranslate.parseTencentText(await readTranslationBody(await request(req.url, req.init), label));
    } else if (providerName === 'volc') {
      const req = LitTranslate.buildVolcRequest(chunk, targetCode);
      parsed = LitTranslate.parseVolcText(await readTranslationBody(await request(req.url, req.init), label));
    } else if (providerName === 'cnki') {
      const token = await getCnkiToken();
      const req = LitTranslate.buildCnkiRequest(cnkiWords(chunk), token);
      parsed = LitTranslate.parseCnkiText(await readTranslationBody(await request(req.url, req.init), label));
    } else if (providerName === 'mymemory') {
      parsed = LitTranslate.parseMyMemoryText(await readTranslationBody(await request(LitTranslate.buildMyMemoryUrl(chunk, targetCode), { method: 'GET' }), label));
    } else {
      throw new Error('未知免费翻译服务商：' + providerName);
    }
    if (!parsed || !String(parsed).trim()) throw new Error(label + '未返回结果');
    return String(parsed);
  }

  async function translateFreeText(providerName, text, config) {
    const spec = LitTranslate.FREE_SERVICES[providerName];
    const label = FREE_PROVIDER_LABELS[providerName] || providerName;
    if (text.length > spec.max) throw new Error(label + '单次不能超过 ' + spec.max + ' 个字符');
    const targetCode = LitTranslate.freeTargetCode(providerName, config.translatorTarget === 'en' ? 'en' : 'zh');
    const chunks = LitTranslate.splitChunks(text, spec.chunk);
    const outputs = [];
    for (let i = 0; i < chunks.length; i++) {
      // 免费接口礼貌限速：多块顺序翻译，块间稍作停顿
      if (i) await new Promise(function (resolve) { setTimeout(resolve, 200); });
      outputs.push(await translateFreeChunk(providerName, chunks[i], targetCode));
    }
    return outputs.join('').trim();
  }

  async function requestTranslation(text, config, apiKey) {
    const providerName = translators[config.translatorProvider] ? config.translatorProvider : DEFAULT_TRANSLATOR;
    const provider = translators[providerName];
    if (provider.free) {
      return { provider: providerName, translation: await translateFreeText(providerName, text, config) };
    }
    if (!apiKey) throw new Error('请先在同步设置中填写翻译凭据');
    if (providerName === 'aliyun' && text.length > 5000) throw new Error('阿里云机器翻译单次不能超过 5000 个字符');
    if (providerName !== 'aliyun' && text.length > 12000) throw new Error('单次翻译不能超过 12000 个字符');
    if (providerName === 'aliyun') {
      const response = await aliyunTranslationRequest(provider, apiKey, text, config.translatorTarget === 'en' ? 'en' : 'zh');
      const body = await response.text();
      let data = {};
      try { data = body ? JSON.parse(body) : {}; } catch (error) { throw new Error('翻译服务返回了无效 JSON'); }
      if (!response.ok || (data.Code && String(data.Code) !== '200')) {
        throw new Error(data.Message || data.message || ('翻译服务请求失败（' + response.status + '）'));
      }
      const translated = data.Data && (data.Data.Translated || data.Data.translated);
      if (!translated || !String(translated).trim()) throw new Error('翻译服务未返回结果');
      return { provider: providerName, translation: String(translated).trim() };
    }
    const target = config.translatorTarget === 'en' ? 'English' : 'Simplified Chinese';
    const model = String(config.translatorModel || provider.model).trim() || provider.model;
    const response = await request(provider.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'Translate the user text into ' + target + '. Preserve academic terminology, citations, formulas, and paragraph breaks. Return only the translation.' },
          { role: 'user', content: text }
        ]
      })
    });
    const body = await response.text();
    let data = {};
    try { data = body ? JSON.parse(body) : {}; } catch (error) { throw new Error('翻译服务返回了无效 JSON'); }
    if (!response.ok) throw new Error((data.error && data.error.message) || ('翻译服务请求失败（' + response.status + '）'));
    const translated = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!translated || !String(translated).trim()) throw new Error('翻译服务未返回结果');
    return { provider: providerName, translation: String(translated).trim() };
  }

  async function translateText(input) {
    const text = String(input && input.text || '').trim();
    if (!text) throw new Error('请选择需要翻译的文字');
    const config = await loadRawConfig();
    return requestTranslation(text, config, decrypt(config.translatorApiKey));
  }

  async function testTranslationConnection(input) {
    const current = await loadRawConfig();
    const providerName = translators[input && input.translatorProvider]
      ? input.translatorProvider
      : (translators[current.translatorProvider] ? current.translatorProvider : DEFAULT_TRANSLATOR);
    const config = {
      translatorProvider: providerName,
      translatorModel: String(input && input.translatorModel || '').trim(),
      translatorTarget: input && input.translatorTarget === 'en' ? 'en' : 'zh'
    };
    const supplied = String(input && input.translatorApiKey || '');
    const credential = supplied || decrypt(current.translatorApiKey);
    const sample = config.translatorTarget === 'en' ? '这是一次翻译连接测试。' : 'This is a translation connection test.';
    const result = await requestTranslation(sample, config, credential);
    return { ok: true, provider: result.provider, translation: result.translation };
  }

  async function requestScigreat(apiKey, input) {
    const query = {};
    const issn = Array.isArray(input && input.issn) ? input.issn : [];
    const journal = String(input && input.journal || '').trim();
    if (issn.length) query.issn = issn.map(function (value) { return String(value).trim(); }).filter(Boolean);
    if (journal) query.journal = [journal];
    if (!query.issn && !query.journal) throw new Error('请提供期刊名称或 ISSN');
    const response = await request('https://api.scigreat.com/info/getrank', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify([query])
    });
    const body = await response.text();
    let data = {};
    try { data = body ? JSON.parse(body) : {}; } catch (error) { throw new Error('SciGreat 返回了无效 JSON'); }
    if (!response.ok || (data.code != null && Number(data.code) !== 200)) {
      throw new Error(data.message || data.status || ('SciGreat 请求失败（' + response.status + '）'));
    }
    return data;
  }

  async function getScigreatRank(input) {
    const config = await loadRawConfig();
    const apiKey = decrypt(config.scigreatApiKey);
    if (!apiKey) throw new Error('请先在同步设置中填写 SciGreat API Key');
    return requestScigreat(apiKey, input || {});
  }

  async function testScigreatConnection(input) {
    const config = await loadRawConfig();
    const apiKey = input && input.scigreatApiKey ? String(input.scigreatApiKey) : decrypt(config.scigreatApiKey);
    if (!apiKey) throw new Error('请填写 SciGreat API Key');
    return requestScigreat(apiKey, { journal: String(input && input.journal || 'Nature') });
  }

  // ---- EasyScholar 期刊等级查询（https://www.easyscholar.cc/open/getPublicationRank）----
  // 官方限制：GET、免登录、免费开放、每秒最多 2 次请求；期刊名需 encodeURIComponent 编码。
  let easyscholarPace = Promise.resolve();
  function pacedEasyscholar(url) {
    const run = easyscholarPace.then(function () {
      return new Promise(function (resolve) { setTimeout(resolve, 500); })
        .then(function () { return request(url); });
    });
    easyscholarPace = run.catch(function () {});  // 单次失败不中断后续节奏
    return run;
  }
  function easyscholarUrl(apiKey, journal) {
    return 'https://www.easyscholar.cc/open/getPublicationRank?secretKey=' +
      encodeURIComponent(apiKey) + '&publicationName=' + encodeURIComponent(String(journal || '').trim());
  }
  async function requestEasyscholar(apiKey, journal) {
    if (!apiKey) throw new Error('请填写 EasyScholar SecretKey');
    if (!String(journal || '').trim()) throw new Error('请提供期刊名称');
    const response = await pacedEasyscholar(easyscholarUrl(apiKey, journal));
    const body = await response.text();
    let data = null;
    try { data = body ? JSON.parse(body) : null; } catch (error) { throw new Error('EasyScholar 返回了无效 JSON'); }
    if (data && Number(data.code) === 200 && data.data && typeof data.data === 'object') return data;
    throw new Error((data && data.msg) || ('EasyScholar 请求失败（' + response.status + '）'));
  }

  function resolveRankProvider(raw, input) {
    const requested = String(input && input.rankProvider || '');
    if (requested === 'easyscholar' || requested === 'scigreat') return requested;
    return raw && raw.rankProvider === 'easyscholar' ? 'easyscholar' : 'scigreat';
  }

  // 统一入口：按配置/入参的 provider 路由到 SciGreat 或 EasyScholar
  async function getJournalRank(input) {
    const config = await loadRawConfig();
    const provider = resolveRankProvider(config, input);
    if (provider === 'easyscholar') {
      const apiKey = input && input.easyscholarApiKey
        ? String(input.easyscholarApiKey) : decrypt(config.easyscholarApiKey);
      if (!apiKey) throw new Error('请先在设置中填写 EasyScholar SecretKey');
      return requestEasyscholar(apiKey, String(input && input.journal || ''));
    }
    return getScigreatRank(input);
  }

  async function testJournalRankConnection(input) {
    const config = await loadRawConfig();
    const provider = resolveRankProvider(config, input);
    const journal = String(input && input.journal || 'Nature');
    if (provider === 'easyscholar') {
      const apiKey = input && input.easyscholarApiKey
        ? String(input.easyscholarApiKey) : decrypt(config.easyscholarApiKey);
      if (!apiKey) throw new Error('请填写 EasyScholar SecretKey');
      const response = await requestEasyscholar(apiKey, journal);
      return { provider: 'easyscholar', code: response.code, data: response.data };
    }
    const response = await testScigreatConnection(input);
    return { provider: 'scigreat', results: response.results || [] };
  }

  const pendingSyncPlans = new Map();
  const SYNC_BASE_FILE = path.join(options.baseDir, 'sync-base.json');
  /** 对照弹窗里「本机为空疑似重置」总体决议的键（渲染层同名常量保持一致） */
  const LOCAL_EMPTY_RESET_KEY = 'plan:local-empty-reset';

  /** 同步进度上报（渲染层经 integrations:sync-progress 接收） */
  function emitSyncProgress(payload) {
    try { notifyProgress('integrations:sync-progress', payload); } catch (error) {}
  }

  /** 登记集合的资产同步跳过集：papers:<id> / notes:<id> */
  function pinSkipSet(pins) {
    const skip = new Set();
    Object.keys(pins || {}).forEach(function (key) { if (pins[key]) skip.add(key); });
    return skip;
  }

  function remoteAssetNames(workspace) {
    const names = new Set();
    const add = function (asset) {
      const name = safeCloudName(asset && asset.cloudName);
      if (name) names.add(name);
    };
    (workspace && workspace.papers || []).forEach(function (paper) {
      (paper && paper.attachments || []).forEach(add);
      (paper && paper.pdfAnnotations || []).forEach(function (annotation) {
        if (annotation && annotation.type === 'snapshot') add(annotation);
      });
    });
    (workspace && workspace.notes || []).forEach(function (note) {
      (note && note.assets || []).forEach(add);
    });
    return names;
  }

  function xmlText(value) {
    return String(value || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }

  async function listRemoteAssetNames(remoteOptions) {
    const response = await request(remoteOptions.attachmentsUrl, {
      method: 'PROPFIND',
      headers: Object.assign({ Depth: 'infinity', 'Content-Type': 'application/xml; charset=utf-8' }, remoteOptions.headers),
      body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
    });
    throwIfWebDavRateLimited(response);
    if (response.status === 404 || response.status === 409) return new Set();
    // 部分 WebDAV 服务不支持 Depth: infinity；此时回退到正常逐文件上传。
    if (response.status === 403 || response.status === 405 || response.status === 501) return null;
    if (!response.ok) throw new Error('坚果云附件清单读取失败（' + response.status + '）');
    const body = await response.text();
    const baseUrl = new URL(remoteOptions.attachmentsUrl.replace(/\/+$/, '') + '/');
    const basePath = baseUrl.pathname;
    const names = new Set();
    const hrefPattern = /<(?:[A-Za-z_][\w.-]*:)?href\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?href>/gi;
    let match;
    while ((match = hrefPattern.exec(body))) {
      let target;
      try { target = new URL(xmlText(match[1]).trim(), baseUrl); } catch (error) { continue; }
      if (target.origin !== baseUrl.origin || target.pathname.indexOf(basePath) !== 0) continue;
      let relative = target.pathname.slice(basePath.length);
      try { relative = decodeURIComponent(relative); } catch (error) { continue; }
      if (!relative || relative.endsWith('/')) continue;
      const name = safeCloudName(relative);
      if (name) names.add(name);
    }
    return names;
  }

  async function resolveRemoteAssetNames(remoteWorkspace, localWorkspace, remoteOptions, onScan) {
    const names = remoteAssetNames(remoteWorkspace);
    if (names.size || !remoteAssetNames(localWorkspace).size) return names;
    if (onScan) onScan();
    const listed = await listRemoteAssetNames(remoteOptions);
    return listed || names;
  }

  function cloneJson(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function inputConfig(input) {
    const value = input && typeof input === 'object' ? input : {};
    const nested = value.config && typeof value.config === 'object' ? value.config : {};
    return Object.assign({}, nested, value);
  }

  async function resolveNutstoreOptions(input) {
    const supplied = inputConfig(input);
    const raw = await loadRawConfig();
    const url = validateWebDavUrl(String(supplied.nutstoreUrl != null ? supplied.nutstoreUrl : raw.nutstoreUrl || 'https://dav.jianguoyun.com/dav/').trim());
    const folderName = normalizeWebDavFolder(supplied.nutstoreFolder != null ? supplied.nutstoreFolder : raw.nutstoreFolder, 'LitBoard');
    const user = String(supplied.nutstoreUser != null ? supplied.nutstoreUser : raw.nutstoreUser || '').trim();
    const password = supplied.nutstorePassword ? String(supplied.nutstorePassword) : decrypt(raw.nutstorePassword);
    const configSyncPassword = supplied.configSyncPassword ? String(supplied.configSyncPassword) : decrypt(raw.configSyncPassword);
    if (!user || !password) throw new Error('请先配置坚果云账号和应用密码');
    const folderUrl = joinUrl(url, folderName);
    return {
      raw: raw,
      url: url,
      folderName: folderName,
      user: user,
      password: password,
      configSyncPassword: configSyncPassword,
      headers: { Authorization: basicAuth(user, password) },
      folderUrl: folderUrl,
      fileUrl: joinUrl(folderUrl, 'litboard-library.json'),
      attachmentsUrl: joinUrl(folderUrl, 'attachments')
    };
  }

  async function readRemoteLibrary(remoteOptions) {
    const response = await request(remoteOptions.fileUrl, { method: 'GET', headers: remoteOptions.headers });
    throwIfWebDavRateLimited(response);
    const result = { exists: false, remote: { papers: [], folders: [] }, etag: responseEtag(response), status: response.status };
    if (response.status === 404 || response.status === 409) {
      if (response.status === 409) result.pathConflict = true;
      return result;
    }
    if (!response.ok) throw new Error('坚果云读取失败（' + response.status + '）');
    let remote;
    try { remote = JSON.parse(await response.text()); } catch (error) { throw new Error('坚果云同步文件不是有效 JSON'); }
    if (!remote || typeof remote !== 'object' || Array.isArray(remote)) throw new Error('坚果云同步文件内容无效');
    if (!LitSync.isSupportedSyncVersion(remote.syncVersion)) {
      throw new Error('不支持的 LitBoard 同步版本：' + remote.syncVersion);
    }
    result.exists = true;
    result.remote = remote;
    return result;
  }

  async function verifyRemoteLibraryWrite(remoteOptions, expectedWorkspace) {
    const verifyOptions = Object.assign({}, remoteOptions, {
      headers: Object.assign({}, remoteOptions.headers, { 'Cache-Control': 'no-cache' })
    });
    let actual = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise(function (resolve) { setTimeout(resolve, attempt * 150); });
      actual = await readRemoteLibrary(verifyOptions);
      if (actual.exists && Number(actual.remote && actual.remote.syncVersion) >= LitSync.SYNC_VERSION &&
          hashWorkspace(actual.remote) === hashWorkspace(expectedWorkspace)) {
        return actual;
      }
    }
    const error = new Error('远端写入后校验失败：坚果云未返回刚刚写入的文献库，请检查远端目录或稍后重试');
    error.code = 'REMOTE_WRITE_VERIFY_FAILED';
    error.remote = actual;
    throw error;
  }

  async function hashBuffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  function safeCloudName(value) {
    const name = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name || name.length > 200 || /[?#\u0000-\u001f]/.test(name)) return '';
    const parts = name.split('/');
    if (parts.some(function (part) { return !part || part === '.' || part === '..'; })) return '';
    return name;
  }

  function assetExtension(fileName, fallback) {
    const ext = path.extname(String(fileName || '')).toLowerCase();
    return /^[.][a-z0-9]{1,12}$/.test(ext) ? ext : fallback;
  }

  function assetTarget(downloadDir, paper, asset, snapshot) {
    const paperId = String(paper && paper.id || 'paper').replace(/[^A-Za-z0-9_-]/g, '_');
    const assetId = String(asset && (asset.id || asset.cloudName) || 'asset').replace(/[^A-Za-z0-9_-]/g, '_');
    const ext = assetExtension(asset && (asset.fileName || asset.cloudName), snapshot ? '.png' : '.pdf');
    return path.join(downloadDir, snapshot ? paperId + '.snapshot.' + assetId + ext :
      (asset && asset.kind === 'pdf' && asset.id === (paper && paper.attachments || []).find(function (a) { return a.kind === 'pdf'; })?.id
        ? paperId + ext : paperId + '.' + assetId + ext));
  }

  async function ensureAssetFolders(attachmentsUrl, cloudName, headers, made) {
    if (!made[attachmentsUrl]) {
      const rootResponse = await request(attachmentsUrl, { method: 'MKCOL', headers: headers });
      throwIfWebDavRateLimited(rootResponse);
      if (!rootResponse.ok && rootResponse.status !== 405) {
        throw new Error('无法在坚果云创建附件根目录（' + rootResponse.status + '）');
      }
      made[attachmentsUrl] = true;
    }
    const parts = String(cloudName || '').split('/');
    parts.pop();
    let current = attachmentsUrl;
    for (const part of parts) {
      current = joinUrl(current, part);
      if (made[current]) continue;
      const response = await request(current, { method: 'MKCOL', headers: headers });
      throwIfWebDavRateLimited(response);
      if (!response.ok && response.status !== 405) throw new Error('无法在坚果云创建附件目录（' + response.status + '）');
      made[current] = true;
    }
  }

  function assetError(message, item, cause) {
    const error = new Error(message);
    error.item = item;
    if (cause) error.cause = cause;
    return error;
  }

  class AssetSyncError extends Error {
    constructor(failures) {
      super('附件同步失败：' + failures.map(function (item) { return item.message; }).join('；'));
      this.name = 'AssetSyncError';
      this.code = 'ASSET_SYNC_FAILED';
      this.failures = failures;
    }
  }

  async function downloadAsset(url, target, expectedHash, expectedSize, headers, item) {
    const response = await request(url, { method: 'GET', headers: headers });
    throwIfWebDavRateLimited(response);
    if (!response.ok) throw assetError('附件下载失败（' + response.status + '）', item);
    const body = Buffer.from(await response.arrayBuffer());
    const actualHash = await hashBuffer(body);
    const actualSize = body.length;
    if (expectedHash && actualHash !== expectedHash) {
      throw assetError('附件校验失败（SHA-256 不匹配）', item);
    }
    if (expectedSize != null && actualSize !== Number(expectedSize)) {
      throw assetError('附件校验失败（文件大小不匹配）', item);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    const part = target + '.part-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    const previous = target + '.previous-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    let previousMoved = false;
    let targetInstalled = false;
    try {
      await fs.writeFile(part, body, { flag: 'wx' });
      // On Windows rename cannot replace an existing file.  Move the old
      // target aside first so a failed install can put it back.
      try { await fs.rename(target, previous); previousMoved = true; } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
      }
      await fs.rename(part, target);
      targetInstalled = true;
      if (previousMoved) await fs.rm(previous, { force: true });
    } catch (error) {
      await fs.rm(part, { force: true }).catch(function () {});
      if (!targetInstalled && previousMoved) {
        try { await fs.rename(previous, target); } catch (rollbackError) {
          error.rollbackError = String(rollbackError && rollbackError.message || rollbackError);
        }
      } else {
        await fs.rm(previous, { force: true }).catch(function () {});
      }
      throw assetError('附件落盘失败', item, error);
    }
    return { hash: actualHash, size: actualSize };
  }

  async function syncWorkspaceAssets(workspace, remoteOptions, settings) {
    const config = settings || {};
    const failures = [];
    const made = {};
    const downloadDir = path.join(options.baseDir, 'synced-attachments');
    const knownRemoteAssets = config.remoteAssets instanceof Set ? config.remoteAssets : null;
    const missingRemotely = function (cloudName) {
      return !!knownRemoteAssets && !knownRemoteAssets.has(cloudName);
    };
    await fs.mkdir(downloadDir, { recursive: true });
    // 附件上传台账：记住哪些云端对象已成功 PUT 过，同步中断后下一轮续传
    const assetLedger = await loadAssetLedger(remoteOptions);
    const noteLedger = async function (cloudName, hash, size) {
      recordAssetLedger(assetLedger, cloudName, hash, size);
      try { await saveAssetLedger(assetLedger); } catch (error) {}
    };
    let uploaded = 0, downloaded = 0, verified = 0;
    // body/hash 由调用方传入（processAsset 已读过并算过哈希），避免大附件双倍读盘
    const uploadAsset = async function (asset, body, actualHash, cloudName, item) {
      try {
        await ensureAssetFolders(remoteOptions.attachmentsUrl, cloudName, remoteOptions.headers, made);
        const response = await request(joinUrl(remoteOptions.attachmentsUrl, cloudName), {
          method: 'PUT', headers: Object.assign({ 'Content-Type': item.snapshot ? 'image/png' : 'application/octet-stream' }, remoteOptions.headers), body: body
        });
        throwIfWebDavRateLimited(response);
        if (!response.ok) throw new Error('HTTP ' + response.status);
      } catch (error) {
        if (error && error.code === 'WEBDAV_RATE_LIMITED') throw error;
        throw assetError('附件上传失败：' + (error && error.message || error), item, error);
      }
      asset.cloudHash = actualHash;
      asset.cloudSize = body.length;
      await noteLedger(cloudName, actualHash, body.length);
      uploaded++;
      return { hash: actualHash, size: body.length };
    };
    const processAsset = async function (paper, asset, isSnapshot, primaryId) {
      const item = { paperId: paper.id, id: asset.id, snapshot: !!isSnapshot, message: '' };
      let localPath = isSnapshot ? String(asset.imagePath || '') : String(asset.path || '');
      let cloudName = safeCloudName(asset.cloudName);
      if (localPath) {
        try {
          const stat = await fs.stat(localPath);
          if (!stat.isFile()) throw new Error('不是文件');
          // 稳态快捷路径：cloudName 已定且 cloudHash+size+mtime 与上次核对一致 → 免读盘重哈希
          if (!isSnapshot && cloudName &&
              assetSignatureUnchanged(asset, assetLocalSignature(stat, asset.cloudHash), cloudName, knownRemoteAssets, stat.size)) {
            verified++;
            return;
          }
          const body = await fs.readFile(localPath);
          const actualHash = await hashBuffer(body);
          cloudName = cloudName || (isSnapshot ? 'snapshots/' + paper.id + '/' + asset.id + '.png' :
            (asset.id === primaryId ? paper.id + '.pdf' : paper.id + '/' + asset.id + assetExtension(asset.fileName, '.pdf')));
          if (!cloudName) throw new Error('云端文件名无效');
          asset.cloudName = cloudName;
          const expectedHash = String(asset.cloudHash || '').toLowerCase();
          const expectedSize = asset.cloudSize == null ? null : Number(asset.cloudSize);
          if ((missingRemotely(cloudName) || !expectedHash || expectedHash !== actualHash || expectedSize != null && expectedSize !== body.length) &&
              !assetLedgerProof(assetLedger, cloudName, actualHash, body.length, knownRemoteAssets)) {
            await uploadAsset(asset, body, actualHash, cloudName, item);
          } else {
            asset.cloudHash = actualHash;
            asset.cloudSize = body.length;
            verified++;
          }
          if (!isSnapshot) asset.syncSignature = assetLocalSignature(stat, asset.cloudHash);
          return;
        } catch (error) {
          if (error && error.code === 'WEBDAV_RATE_LIMITED') throw error;
          if (error && error.item) {
            failures.push(error);
            return;
          }
          // A stale local path is equivalent to a missing local file; if a
          // cloudName exists we can still restore it below.
          if (!cloudName && !asset.cloudName) {
            // 本机独有但已失效的外部路径没有远端对象可恢复；保留元数据，
            // 不把它误报成远端恢复失败。只对明确存在 cloudName 的对象严格失败。
            return;
          }
        }
      }
      cloudName = cloudName || safeCloudName(asset.cloudName);
      if (!cloudName) return;
      asset.cloudName = cloudName;
      const target = assetTarget(downloadDir, paper, asset, isSnapshot);
      const expectedHash = String(asset.cloudHash || '').toLowerCase();
      const expectedSize = asset.cloudSize == null ? null : Number(asset.cloudSize);
      try {
        const stat = await fs.stat(target);
        if (!stat.isFile()) throw new Error('不是文件');
        const body = await fs.readFile(target);
        const actualHash = await hashBuffer(body);
        if (!expectedHash || actualHash !== expectedHash || expectedSize != null && body.length !== expectedSize) {
          throw new Error('本地缓存完整性不匹配');
        }
        if (isSnapshot) asset.imagePath = target;
        else { asset.path = target; asset.syncSignature = assetLocalSignature(stat, asset.cloudHash); }
        if (!asset.fileName && !isSnapshot) asset.fileName = path.posix.basename(cloudName);
        verified++;
        return;
      } catch (error) {
        // Download below.  A missing hash is intentionally not trusted: old
        // v3 records are verified by downloading once and receive metadata.
      }
      try {
        const result = await downloadAsset(joinUrl(remoteOptions.attachmentsUrl, cloudName), target, expectedHash, expectedSize,
          remoteOptions.headers, item);
        if (isSnapshot) asset.imagePath = target;
        else {
          asset.path = target;
          // 记真实 stat 签名（而非下载时刻），下一轮同步即可凭签名免读盘
          try {
            const downloaded = await fs.stat(target);
            asset.syncSignature = assetLocalSignature(downloaded, result.hash);
          } catch (error) {
            asset.syncSignature = assetLocalSignature({ size: result.size, mtimeMs: Date.now() }, result.hash);
          }
        }
        asset.cloudHash = result.hash;
        asset.cloudSize = result.size;
        await noteLedger(cloudName, result.hash, result.size);
        if (!asset.fileName && !isSnapshot) asset.fileName = path.posix.basename(cloudName);
        downloaded++;
      } catch (error) {
        if (error && error.code === 'WEBDAV_RATE_LIMITED') throw error;
        failures.push(error && error.item ? error : assetError(error.message || '附件下载失败', item, error));
      }
    };
    /** 递归枚举目录文件（同步资产用）：[{rel, abs, size, mtimeMs}]，超限额抛错 */
    async function walkDirFiles(dir) {
      const MAX_FILES = 2000, MAX_BYTES = 500 * 1024 * 1024;
      const out = [];
      let totalBytes = 0;
      async function walk(current, prefix) {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          const abs = path.join(current, entry.name);
          const rel = prefix ? prefix + '/' + entry.name : entry.name;
          if (entry.isDirectory()) { await walk(abs, rel); continue; }
          if (!entry.isFile()) continue;
          const stat = await fs.stat(abs);
          totalBytes += stat.size;
          out.push({ rel: rel, abs: abs, size: stat.size, mtimeMs: stat.mtimeMs });
          if (out.length > MAX_FILES || totalBytes > MAX_BYTES) throw new Error('快照目录过大');
        }
      }
      await walk(dir, '');
      return out;
    }

    function dirSignature(files) {
      const listing = files.map(function (f) { return f.rel + ':' + f.size + ':' + Math.trunc(f.mtimeMs); }).sort().join('\n');
      return crypto.createHash('sha256').update(listing).digest('hex');
    }

    async function uploadBuffer(asset, body, cloudName, item) {
      const actualHash = await hashBuffer(body);
      try {
        await ensureAssetFolders(remoteOptions.attachmentsUrl, cloudName, remoteOptions.headers, made);
        const response = await request(joinUrl(remoteOptions.attachmentsUrl, cloudName), {
          method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, remoteOptions.headers), body: body
        });
        throwIfWebDavRateLimited(response);
        if (!response.ok) throw new Error('HTTP ' + response.status);
      } catch (error) {
        if (error && error.code === 'WEBDAV_RATE_LIMITED') throw error;
        throw assetError('附件上传失败：' + (error && error.message || error), item, error);
      }
      asset.cloudHash = actualHash;
      asset.cloudSize = body.length;
      await noteLedger(cloudName, actualHash, body.length);
      uploaded++;
    }

    /** 快照目录（attachment.kind='snapshot'，path=目录）：整树打成确定性 stored-ZIP 上传/下载 */
    async function processSnapshotDir(paper, asset) {
      const item = { paperId: paper.id, id: asset.id, snapshot: true, message: '' };
      const localDir = String(asset.path || '');
      let cloudName = safeCloudName(asset.cloudName) || (paper.id + '/' + asset.id + '.zip');
      if (localDir) {
        try {
          const stat = await fs.stat(localDir);
          if (!stat.isDirectory()) throw new Error('不是目录');
          const files = await walkDirFiles(localDir);
          const listingSig = dirSignature(files);
          // 清单（路径+大小+mtime）+ 记录时 cloudHash 与上次核对一致 → 免重读全部文件重新打 ZIP 哈希
          if (assetSignatureUnchanged(asset, listingSig + ':' + String(asset.cloudHash || '').toLowerCase(), cloudName, knownRemoteAssets, null)) {
            verified++;
            return;
          }
          // 独立文件读，8 路并发读入（zip 本就要持有全部缓冲，峰值内存不变，只重叠 I/O 等待）
          const entries = new Array(files.length);
          let readCursor = 0;
          const readWorker = async function () {
            while (readCursor < files.length) {
              const i = readCursor++;
              entries[i] = { name: files[i].rel, data: await fs.readFile(files[i].abs) };
            }
          };
          await Promise.all([readWorker(), readWorker(), readWorker(), readWorker(),
            readWorker(), readWorker(), readWorker(), readWorker()]);
          const zip = zipStoreEntries(entries);
          const actualHash = await hashBuffer(zip);
          asset.cloudName = cloudName;
          if ((missingRemotely(cloudName) || String(asset.cloudHash || '').toLowerCase() !== actualHash ||
              (asset.cloudSize != null && Number(asset.cloudSize) !== zip.length)) &&
              !assetLedgerProof(assetLedger, cloudName, actualHash, zip.length, knownRemoteAssets)) {
            await uploadBuffer(asset, zip, cloudName, item);
          } else {
            asset.cloudHash = actualHash;
            asset.cloudSize = zip.length;
            verified++;
          }
          asset.syncSignature = listingSig + ':' + String(asset.cloudHash || '').toLowerCase();
          return;
        } catch (error) {
          if (error && error.code === 'WEBDAV_RATE_LIMITED') throw error;
          if (error && error.item) {
            failures.push(error);
            return;
          }
          if (!asset.cloudName) return; // 本机路径失效且无云端对象：保留元数据不误报
        }
      }
      cloudName = cloudName || safeCloudName(asset.cloudName);
      if (!cloudName) return;
      asset.cloudName = cloudName;
      const paperId = String(paper.id || 'paper').replace(/[^A-Za-z0-9_-]/g, '_');
      const assetId = String(asset.id || 'asset').replace(/[^A-Za-z0-9_-]/g, '_');
      const targetDir = path.join(downloadDir, paperId + '.' + assetId + '.snapshot');
      try {
        const stat = await fs.stat(targetDir);
        if (stat.isDirectory() && asset.cloudHash) { asset.path = targetDir; verified++; return; }
      } catch (error) {}
      try {
        const response = await request(joinUrl(remoteOptions.attachmentsUrl, cloudName), { method: 'GET', headers: remoteOptions.headers });
        throwIfWebDavRateLimited(response);
        if (!response.ok) throw assetError('快照下载失败（' + response.status + '）', item);
        const body = Buffer.from(await response.arrayBuffer());
        const snapshotHash = await hashBuffer(body);
        const expectedHash = String(asset.cloudHash || '').toLowerCase();
        if (expectedHash && snapshotHash !== expectedHash) throw assetError('快照校验失败（SHA-256 不匹配）', item);
        const files = extractZipAll(body);
        const tempDir = targetDir + '.part-' + process.pid + '-' + Date.now();
        const previousDir = targetDir + '.previous-' + process.pid + '-' + Date.now();
        let previousMoved = false, installed = false;
        try {
          await fs.mkdir(tempDir, { recursive: true });
          for (const file of files) {
            const target = path.join(tempDir, file.name);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, file.data);
          }
          try { await fs.rename(targetDir, previousDir); previousMoved = true; } catch (error) {
            if (!error || error.code !== 'ENOENT') throw error;
          }
          await fs.rename(tempDir, targetDir);
          installed = true;
          if (previousMoved) await fs.rm(previousDir, { recursive: true, force: true });
        } catch (error) {
          await fs.rm(tempDir, { recursive: true, force: true }).catch(function () {});
          if (!installed && previousMoved) {
            try { await fs.rename(previousDir, targetDir); } catch (rollbackError) {}
          } else {
            await fs.rm(previousDir, { recursive: true, force: true }).catch(function () {});
          }
          throw assetError('快照落盘失败', item, error);
        }
        asset.path = targetDir;
        asset.cloudHash = snapshotHash;
        asset.cloudSize = body.length;
        asset.syncSignature = '';
        await noteLedger(cloudName, snapshotHash, body.length);
        downloaded++;
      } catch (error) {
        if (error && error.code === 'WEBDAV_RATE_LIMITED') throw error;
        failures.push(error && error.item ? error : assetError(error.message || '快照下载失败', item, error));
      }
    }

    /** 笔记资产（单文件）：上传 / 校验 / 下载到 note-assets/<noteId>/<fileName> */
    async function processNoteAsset(note, asset, noteAssetsDir) {
      const item = { paperId: note.paperId || '', id: note.id, snapshot: false, message: '' };
      const safeName = String(asset.fileName || 'file').replace(/[?#\\:*"<>\u0000-\u001f-]/g, '_');
      const localPath = String(asset.path || '');
      let cloudName = safeCloudName(asset.cloudName) || ('notes/' + note.id + '/' + safeName);
      if (localPath) {
        try {
          const stat = await fs.stat(localPath);
          if (!stat.isFile()) throw new Error('不是文件');
          const body = await fs.readFile(localPath);
          const actualHash = await hashBuffer(body);
          asset.cloudName = cloudName;
          if ((missingRemotely(cloudName) || String(asset.cloudHash || '').toLowerCase() !== actualHash ||
              (asset.cloudSize != null && Number(asset.cloudSize) !== body.length)) &&
              !assetLedgerProof(assetLedger, cloudName, actualHash, body.length, knownRemoteAssets)) {
            await uploadBuffer(asset, body, cloudName, item);
          } else {
            asset.cloudHash = actualHash;
            asset.cloudSize = body.length;
            verified++;
          }
          return;
        } catch (error) {
          if (error && error.code === 'WEBDAV_RATE_LIMITED') throw error;
          if (error && error.item) {
            failures.push(error);
            return;
          }
          if (!asset.cloudName) return;
        }
      }
      cloudName = cloudName || safeCloudName(asset.cloudName);
      if (!cloudName) return;
      asset.cloudName = cloudName;
      const target = path.join(noteAssetsDir, note.id, safeName);
      const expectedHash = String(asset.cloudHash || '').toLowerCase();
      const expectedSize = asset.cloudSize == null ? null : Number(asset.cloudSize);
      try {
        const body = await fs.readFile(target);
        if (expectedHash && (await hashBuffer(body)) === expectedHash &&
            (expectedSize == null || body.length === expectedSize)) {
          asset.path = target;
          verified++;
          return;
        }
      } catch (error) {}
      try {
        const result = await downloadAsset(joinUrl(remoteOptions.attachmentsUrl, cloudName), target,
          expectedHash, expectedSize, remoteOptions.headers, item);
        asset.path = target;
        asset.cloudHash = result.hash;
        asset.cloudSize = result.size;
        await noteLedger(cloudName, result.hash, result.size);
        downloaded++;
      } catch (error) {
        if (error && error.code === 'WEBDAV_RATE_LIMITED') throw error;
        failures.push(error && error.item ? error : assetError(error.message || '笔记资产下载失败', item, error));
      }
    }

    const papersList = Array.isArray(workspace && workspace.papers) ? workspace.papers : [];
    const notesList = Array.isArray(workspace && workspace.notes) ? workspace.notes : [];
    const skip = config.skip instanceof Set ? config.skip : null;
    const skipped = function (kind, id) { return !!skip && skip.has(kind + ':' + id); };
    // 进度：先数一遍待处理资产，再逐个上报 done/total
    let assetTotal = 0;
    const countPaper = function (paper) {
      if (!paper || paper.deletedAt || skipped('papers', paper.id)) return;
      assetTotal += (Array.isArray(paper.attachments) ? paper.attachments : []).length;
      assetTotal += (Array.isArray(paper.pdfAnnotations) ? paper.pdfAnnotations : []).filter(function (a) {
        return a && a.type === 'snapshot';
      }).length;
    };
    const countNote = function (note) {
      if (!note || note.deletedAt || skipped('notes', note.id)) return;
      assetTotal += (Array.isArray(note.assets) ? note.assets : []).length;
    };
    papersList.forEach(countPaper);
    notesList.forEach(countNote);
    let assetDone = 0;
    const reportAssets = config.onProgress || null;
    const progressName = function (asset) {
      return String(asset && (asset.fileName || asset.cloudName || asset.id) || '附件').slice(0, 120);
    };
    const beginAsset = function (asset) {
      if (reportAssets) reportAssets({ done: assetDone, total: assetTotal, current: progressName(asset) });
    };
    const tickAsset = function (asset) {
      assetDone++;
      if (reportAssets) reportAssets({ done: assetDone, total: assetTotal, current: progressName(asset) });
    };
    if (reportAssets) reportAssets({ done: 0, total: assetTotal });

    for (const paper of papersList) {
      if (paper && paper.deletedAt) continue;
      if (skipped('papers', paper.id)) continue;
      const attachments = Array.isArray(paper.attachments) ? paper.attachments : [];
      const primary = attachments.find(function (asset) { return asset.kind === 'pdf'; });
      for (const asset of attachments) {
        beginAsset(asset);
        if (asset && asset.kind === 'snapshot') await processSnapshotDir(paper, asset);
        else await processAsset(paper, asset, false, primary && primary.id);
        tickAsset(asset);
      }
      const annotations = Array.isArray(paper.pdfAnnotations) ? paper.pdfAnnotations : [];
      for (const annotation of annotations) {
        if (annotation && annotation.type === 'snapshot') {
          beginAsset(annotation);
          await processAsset(paper, annotation, true, '');
          tickAsset(annotation);
        }
      }
    }
    // 笔记资产（单文件，如导入的笔记图片）：云端名为 notes/<noteId>/<fileName>
    const noteAssetsDir = path.join(options.baseDir, 'note-assets');
    for (const note of notesList) {
      if (!note || note.deletedAt) continue;
      if (skipped('notes', note.id)) continue;
      for (const noteAsset of Array.isArray(note.assets) ? note.assets : []) {
        beginAsset(noteAsset);
        await processNoteAsset(note, noteAsset, noteAssetsDir);
        tickAsset(noteAsset);
      }
    }
    if (!failures.length) {
      // 全部成功才裁剪：失败时保留台账条目，下一轮据此续传
      pruneAssetLedger(assetLedger, remoteAssetNames(workspace));
      try { await saveAssetLedger(assetLedger); } catch (error) {}
    }
    if (failures.length && config.strict !== false) throw new AssetSyncError(failures);
    return { uploaded: uploaded, downloaded: downloaded, verified: verified, failures: failures };
  }

  async function writeSyncBase(value) {
    await fs.mkdir(options.baseDir, { recursive: true });
    const temp = SYNC_BASE_FILE + '.part-' + process.pid + '-' + Date.now();
    await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
    try {
      await fs.rename(temp, SYNC_BASE_FILE);
    } catch (error) {
      try { await fs.copyFile(temp, SYNC_BASE_FILE); }
      finally { await fs.rm(temp, { force: true }).catch(function () {}); }
    }
  }

  async function readSyncBase() {
    try { return JSON.parse(await fs.readFile(SYNC_BASE_FILE, 'utf8')); } catch (error) { return null; }
  }

  const ASSET_LEDGER_FILE = path.join(options.baseDir, 'sync-asset-ledger.json');

  async function loadAssetLedger(remoteOptions) {
    let value = null;
    try { value = JSON.parse(await fs.readFile(ASSET_LEDGER_FILE, 'utf8')); } catch (error) {}
    return loadAssetLedgerValue(value, assetLedgerRemoteKey(remoteOptions));
  }

  async function saveAssetLedger(ledger) {
    const temp = ASSET_LEDGER_FILE + '.part-' + process.pid + '-' + Date.now();
    await fs.writeFile(temp, JSON.stringify(ledger), 'utf8');
    try {
      await fs.rename(temp, ASSET_LEDGER_FILE);
    } catch (error) {
      try { await fs.copyFile(temp, ASSET_LEDGER_FILE); }
      finally { await fs.rm(temp, { force: true }).catch(function () {}); }
    }
  }

  async function inspectNutstoreRemote(input) {
    const remoteOptions = await resolveNutstoreOptions(input);
    const library = input && input._library ? input._library : await readRemoteLibrary(remoteOptions);
    const configPassword = remoteOptions.configSyncPassword;
    const remoteConfig = configPassword
      ? await readRemoteConfig(remoteOptions.folderUrl, remoteOptions.headers, configPassword, { publicOnly: true })
      : { exists: false, locked: false, etag: '', value: null, pathConflict: false };
    const remote = library.remote || { papers: [], folders: [] };
    const papers = Array.isArray(remote.papers) ? remote.papers : [];
    const assets = [];
    papers.forEach(function (paper) {
      (Array.isArray(paper.attachments) ? paper.attachments : []).forEach(function (asset) {
        if (asset && asset.cloudName) assets.push({ type: 'attachment', paperId: paper.id, id: asset.id, cloudName: asset.cloudName,
          hash: asset.cloudHash || '', size: asset.cloudSize == null ? null : Number(asset.cloudSize) });
      });
      (Array.isArray(paper.pdfAnnotations) ? paper.pdfAnnotations : []).forEach(function (annotation) {
        if (annotation && annotation.type === 'snapshot' && annotation.cloudName) assets.push({ type: 'snapshot', paperId: paper.id,
          id: annotation.id, cloudName: annotation.cloudName, hash: annotation.cloudHash || '', size: annotation.cloudSize == null ? null : Number(annotation.cloudSize) });
      });
    });
    return {
      ok: true,
      exists: library.exists,
      status: library.status,
      folder: remoteOptions.folderName,
      folderUrl: remoteOptions.folderUrl,
      fileUrl: remoteOptions.fileUrl,
      libraryEtag: library.etag || '',
      remote: remote,
      config: { exists: remoteConfig.exists, locked: remoteConfig.locked, etag: remoteConfig.etag || '',
        value: portableConfigView(remoteConfig.value), pathConflict: !!remoteConfig.pathConflict },
      counts: {
        papers: papers.length,
        folders: Array.isArray(remote.folders) ? remote.folders.length : 0,
        savedSearches: Array.isArray(remote.savedSearches) ? remote.savedSearches.length : 0,
        attachments: assets.filter(function (item) { return item.type === 'attachment'; }).length,
        snapshots: assets.filter(function (item) { return item.type === 'snapshot'; }).length
      },
      assets: assets,
      syncVersion: Number(remote.syncVersion) || 0,
      configVersion: remoteConfig.value ? Number(remoteConfig.value.version) || 1 : null
    };
  }

  function planConflictId(conflict, index) {
    return String(conflict && conflict.conflictId || (conflict && conflict.field ? conflict.id + ':' + conflict.field : conflict && conflict.id || 'conflict-' + index));
  }

  async function createNutstoreSyncPlan(input) {
    const value = input && typeof input === 'object' ? input : {};
    const remoteOptions = await resolveNutstoreOptions(value);
    const inspected = await inspectNutstoreRemote(value);
    const localValue = value.workspace || value.localValue || (value.papers ? value : { papers: [], folders: [] });
    const mode = value.mode === 'restore' || value.mode === 'pull' || value.mode === 'remote' ? 'restore' : 'merge';
    if (mode === 'restore' && !inspected.exists) {
      throw new Error('未找到远端库文件：' + inspected.fileUrl + '（HTTP ' + inspected.status + '）。' +
        '“远端恢复”不会再把缺失文件当作空库；如需从本机新建远端，请使用“同步对照”或“保存并同步”。');
    }
    let base = await readSyncBase();
    const baseKey = remoteOptions.user + '\n' + remoteOptions.fileUrl;
    if (base && base.remoteKey && base.remoteKey !== baseKey) base = null;
    const basePaperCount = base && base.workspace && Array.isArray(base.workspace.papers) ? base.workspace.papers.length : 0;
    const localPaperCount = Array.isArray(localValue && localValue.papers) ? localValue.papers.length : 0;
    const remotePaperCount = inspected.counts && inspected.counts.papers || 0;
    // 正常删除走墓碑，不会表现为整库消失。整库「凭空变空」只有两种来源：
    // 远端被清空（本机仍有数据），或本机突然读不到数据（读取失败/数据目录被
    // 切换）。两种都按疑似重置暂停自动写入，人工确认后才写远端——否则
    // 「读不到」会被三方合并当成「本地已删除」传播，把云端清空。
    const baseRecoveryAvailable = mode === 'merge' && inspected.exists && basePaperCount > 0 &&
      localPaperCount === 0 && remotePaperCount === 0;
    const remoteResetSuspected = mode === 'merge' && inspected.exists && basePaperCount > 0 &&
      ((remotePaperCount === 0 && localPaperCount > 0) || (localPaperCount === 0 && remotePaperCount > 0) ||
       baseRecoveryAvailable);
    const localEmptyReset = remoteResetSuspected && localPaperCount === 0;
    const planInput = {
      localWorkspace: localValue,
      remoteWorkspace: inspected.remote || { papers: [], folders: [] },
      mode: mode === 'restore' ? 'restore' : 'sync',
      remoteEtag: inspected.libraryEtag || ''
    };
    // 没有基线时保持“未提供 base”语义：空白新机可直接接收远端，
    // 双方都有同 ID 修改则列为待选择冲突，而不是猜测时间戳胜负。
    if (base && base.workspace) planInput.baseWorkspace = base.workspace;
    const corePlan = LitSync.createSyncPlan(planInput);
    const conflicts = (corePlan.conflicts || []).map(function (conflict) {
      return Object.assign({}, conflict, { choice: null });
    });
    const entryByKey = new Map();
    if (corePlan.byCollection) {
      for (const colName of Object.keys(corePlan.byCollection)) {
        const colList = corePlan.byCollection[colName];
        if (Array.isArray(colList)) {
          for (let i = 0; i < colList.length; i++) {
            const item = colList[i];
            if (item && item.id) entryByKey.set(colName + ':' + item.id, item);
          }
        }
      }
    }
    const localOnly = (corePlan.localOnly || []).map(function (marker) {
      const entry = entryByKey.get(marker.collection + ':' + marker.id);
      const conflict = entry && entry.conflicts && entry.conflicts[0];
      if (conflict) conflict.direction = 'local-only';
      return Object.assign({}, marker, { conflictId: conflict && conflict.conflictId || 'local-only:' + marker.collection + ':' + marker.id });
    });
    const localOnlyConflictIds = new Set();
    localOnly.forEach(function (marker) { localOnlyConflictIds.add(marker.conflictId); });
    conflicts.forEach(function (conflict) {
      if (localOnlyConflictIds.has(conflict.conflictId)) conflict.direction = 'local-only';
    });
    const remoteOnly = corePlan.remoteOnly || [];
    // 基线里的「本机保留登记」：两侧未变则继续维持分叉，任一侧变了即解除
    const survivingPins = LitSync.evaluateSyncPins(base && base.pins, corePlan);
    const planId = crypto.randomUUID ? crypto.randomUUID() : 'plan-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const plan = {
      planId: planId,
      syncVersion: LitSync.SYNC_VERSION,
      planVersion: 1,
      mode: mode,
      createdAt: Date.now(),
      remoteExists: inspected.exists,
      remoteEtag: inspected.libraryEtag || '',
      remote: inspected.remote || { papers: [], folders: [] },
      local: localValue,
      base: base && base.workspace ? base.workspace : null,
      workspace: corePlan.preview.workspace,
      conflicts: conflicts,
      localOnly: localOnly,
      remoteOnly: remoteOnly,
      pins: survivingPins,
      remoteCount: inspected.counts && inspected.counts.papers || 0,
      remoteResetSuspected: remoteResetSuspected,
      localEmptyReset: localEmptyReset,
      baseRecoveryAvailable: baseRecoveryAvailable,
      baseRecoveryCount: baseRecoveryAvailable ? basePaperCount : 0,
      corePlan: corePlan,
      config: inspected.config,
      assets: inspected.assets,
      remoteKey: baseKey,
      portableSettings: cloneJson(value.portableSettings || {}),
      requiresConfirmation: mode === 'restore' || conflicts.length > 0 || remoteResetSuspected,
      _options: remoteOptions,
      _remoteConfig: inspected.config && inspected.config.value ? null : null
    };
    // Keep the decrypted config only in the main-process plan state.  The
    // public object above deliberately contains booleans instead of secrets.
    try {
      const privateConfig = await readRemoteConfig(remoteOptions.folderUrl, remoteOptions.headers, remoteOptions.configSyncPassword, {});
      plan._remoteConfig = privateConfig.value || null;
    } catch (error) {
      if (remoteOptions.configSyncPassword) throw error;
    }
    pendingSyncPlans.set(planId, plan);
    return Object.assign({}, plan, { _options: undefined, _remoteConfig: undefined, corePlan: undefined });
  }

  /** 「本机为空疑似重置」的总体决议：对照弹窗以 plan:local-empty-reset 为键
   * 提交 'remote'（把远端拉回本机）或 'local'（确认清空远端）；未选择返回 ''。 */
  function localEmptyResetChoice(resolutions) {
    let value = Array.isArray(resolutions)
      ? (resolutions.find(function (item) { return item && (item.conflictId === LOCAL_EMPTY_RESET_KEY || item.key === LOCAL_EMPTY_RESET_KEY); }) || {}).choice
      : resolutions && resolutions[LOCAL_EMPTY_RESET_KEY];
    if (value && typeof value === 'object') value = value.choice || value.resolution || value.value;
    value = String(value || '').toLowerCase();
    return value === 'remote' ? 'remote' : (value === 'local' ? 'local' : '');
  }

  function resolutionValue(resolutions, conflict) {
    if (!resolutions) return conflict.choice || (conflict.direction === 'local-only' ? 'keep' : null);
    const id = conflict.conflictId || planConflictId(conflict, 0);
    let value = Array.isArray(resolutions)
      ? resolutions.find(function (entry) { return entry && (entry.conflictId === id || entry.id === id); })
      : resolutions[id];
    if (value && typeof value === 'object') value = value.choice || value.resolution || value.side;
    value = String(value || '').toLowerCase();
    if (value === 'local' || value === 'keep-local' || value === 'keep') return 'local';
    if (value === 'remote' || value === 'keep-remote') return 'remote';
    if (value === 'discard' || value === 'drop' || value === 'none') return 'discard';
    return conflict.choice === 'keep' ? 'local' : '';
  }

  function applyPlanResolutions(plan, resolutions) {
    let workspace = cloneJson(plan.workspace);
    const lists = ['papers', 'notes', 'folders', 'savedSearches', 'tagColorRecords'];
    const indexMaps = {};
    const localMaps = {};
    const remoteMaps = {};
    lists.forEach(function (listName) {
      const idxMap = new Map();
      const list = workspace[listName] || [];
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (item) idxMap.set(listName === 'tagColorRecords' ? item.tag : item.id, i);
      }
      indexMaps[listName] = idxMap;

      const locMap = new Map();
      const localList = plan.local && plan.local[listName] || [];
      for (let i = 0; i < localList.length; i++) {
        const item = localList[i];
        if (item) locMap.set(listName === 'tagColorRecords' ? item.tag : item.id, item);
      }
      localMaps[listName] = locMap;

      const remMap = new Map();
      const remoteList = plan.remote && plan.remote[listName] || [];
      for (let i = 0; i < remoteList.length; i++) {
        const item = remoteList[i];
        if (item) remMap.set(listName === 'tagColorRecords' ? item.tag : item.id, item);
      }
      remoteMaps[listName] = remMap;
    });

    (plan.conflicts || []).forEach(function (conflict) {
      const choice = resolutionValue(resolutions, conflict);
      if (!choice || conflict.direction === 'local-only' && choice === 'local') return;
      const field = conflict.field;
      let listName = conflict.entityType === 'folder' ? 'folders' : 'papers';
      if (conflict.entityType === 'savedSearch') listName = 'savedSearches';
      if (conflict.entityType === 'tagColor') listName = 'tagColorRecords';
      if (conflict.collection === 'notes' || conflict.entityType === 'note') listName = 'notes';
      if (!lists.includes(listName)) listName = 'papers';
      const list = workspace[listName] || [];
      const sourceMap = choice === 'remote' ? remoteMaps[listName] : localMaps[listName];
      const sourceItem = sourceMap ? sourceMap.get(conflict.id) : null;
      const idxMap = indexMaps[listName];
      const index = idxMap && idxMap.has(conflict.id) ? idxMap.get(conflict.id) : -1;
      if (choice === 'discard') {
        if (index >= 0) {
          list.splice(index, 1);
          idxMap.clear();
          for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (item) idxMap.set(listName === 'tagColorRecords' ? item.tag : item.id, i);
          }
        }
        return;
      }
      if (!sourceItem) {
        if (index >= 0) {
          list.splice(index, 1);
          idxMap.clear();
          for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (item) idxMap.set(listName === 'tagColorRecords' ? item.tag : item.id, i);
          }
        }
        return;
      }
      if (field && index >= 0) list[index][field] = cloneJson(sourceItem[field]);
      else if (index >= 0) list[index] = cloneJson(sourceItem);
      else {
        list.push(cloneJson(sourceItem));
        if (idxMap) idxMap.set(conflict.id, list.length - 1);
      }
      workspace[listName] = list;
    });
    return LitModel.normalizeWorkspace(workspace);
  }

  // “仅本机”行不是字段冲突，核心三方合并因此不会读取 UI 为它生成的
  // local-only:* 选择。这里把对照弹窗的显式选择落到最终工作区：保留本机
  // 就恢复本机实体，采用远端（远端为空）就从本机结果中移除。
  function applyLocalOnlyResolutions(workspace, plan, resolutions) {
    const output = cloneJson(workspace);
    const allowed = new Set(['papers', 'notes', 'folders', 'savedSearches', 'tagColorRecords']);
    // 先按列表归组，再每列表一次线性应用：原实现对每个标记 findIndex 全量扫 O(标记×实体)，
    // 恢复场景（整库 local-only）会退化成平方级。语义与串行版一致：
    // local+命中=原位替换、local+未命中=按标记顺序补到末尾、discard/remote=移除、其余不动。
    const ops = new Map();
    (plan.localOnly || []).forEach(function (marker) {
      const listName = marker && marker.collection;
      if (!allowed.has(listName)) return;
      const choice = resolutionValue(resolutions, {
        conflictId: marker.conflictId,
        direction: 'local-only',
        choice: 'keep'
      });
      if (choice !== 'local' && choice !== 'remote' && choice !== 'discard') return;
      if (!ops.has(listName)) ops.set(listName, []);
      ops.get(listName).push({ choice: choice, id: marker.id, entity: marker.entity || marker.value });
    });
    ops.forEach(function (listOps, listName) {
      const idKey = listName === 'tagColorRecords' ? 'tag' : 'id';
      const list = Array.isArray(output[listName]) ? output[listName] : [];
      const opById = new Map();
      listOps.forEach(function (op) { opById.set(String(op.id), op); });
      const existed = new Set();
      const kept = [];
      list.forEach(function (item) {
        if (!item) { kept.push(item); return; }
        existed.add(String(item[idKey]));
        const op = opById.get(String(item[idKey]));
        if (!op) { kept.push(item); return; }
        if (op.choice === 'local') kept.push(op.entity ? cloneJson(op.entity) : item);
        // discard / remote：移除该实体
      });
      listOps.forEach(function (op) {
        if (op.choice === 'local' && op.entity && !existed.has(String(op.id))) kept.push(cloneJson(op.entity));
      });
      output[listName] = kept;
    });
    return LitModel.normalizeWorkspace(output);
  }

  async function applyNutstoreSyncPlan(input) {
    const value = input && typeof input === 'object' ? input : {};
    const plan = pendingSyncPlans.get(String(value.planId || ''));
    if (!plan) throw new Error('同步计划不存在或已过期，请重新检查远端');
    const reportProgress = function (phase, extra) {
      emitSyncProgress(Object.assign({ scope: 'apply-plan', planId: plan.planId, phase: phase }, extra || {}));
    };
    reportProgress('verify', { message: '正在校验远端版本…' });
    const current = await readRemoteLibrary(plan._options);
    if (current.exists !== plan.remoteExists || current.etag !== plan.remoteEtag ||
        (!current.etag && current.exists && hashWorkspace(current.remote) !== hashWorkspace(plan.remote))) {
      pendingSyncPlans.delete(plan.planId);
      const error = new RemoteChangedError('远端内容已变化，旧同步计划已失效，请重新生成', plan._options.fileUrl);
      error.code = 'SYNC_PLAN_STALE';
      throw error;
    }
    const resolved = plan.corePlan
      ? LitSync.applySyncPlan(plan.corePlan, value.resolutions || {}, { now: plan.corePlan.now })
      : { ok: true, workspace: applyPlanResolutions(plan, value.resolutions || {}) };
    if (!resolved.ok || resolved.requiresResolution) {
      const count = resolved.unresolved ? resolved.unresolved.length : 0;
      throw new Error('仍有 ' + count + ' 项同步冲突未选择');
    }
    let workspace = resolved.workspace;
    // 本机为空的疑似重置：默认合并结果会把远端整库当「已删除」清空，应用前
    // 必须显式二选一——把远端拉回本机，或确认本机就是空库。
    if (plan.localEmptyReset) {
      const emptyChoice = localEmptyResetChoice(value.resolutions);
      if (emptyChoice === 'remote') {
        workspace = LitSync.adoptRemoteEntities(workspace, plan.baseRecoveryAvailable ? plan.base : plan.remote);
      }
      else if (emptyChoice !== 'local') {
        throw new Error('本机工作区为空而同步基线仍有内容：请先在对照中选择「采用远端版本」（把远端拉回本机）或「采用本机版本」（确认清空远端）');
      }
    }
    // 云端保留结果：普通同步里用户选「采用本机版本」的实体在云端保持远端
    // 值（本机只保留自己的，不上传覆盖远端），两侧快照登记进 sync base；
    // 任一侧之后发生变化即解除登记、回到正常合并。恢复模式远端权威，不登记。
    let cloudWorkspace = workspace;
    let pins = {};
    if (plan.corePlan && plan.mode !== 'restore') {
      const cloudResolved = LitSync.applySyncPlan(plan.corePlan, LitSync.invertLocalChoices(value.resolutions || {}),
        { now: plan.corePlan.now });
      pins = LitSync.mergePinMaps(plan.pins, LitSync.extractWorkspacePins(workspace, cloudResolved.workspace, plan.corePlan.now));
    }
    workspace = applyLocalOnlyResolutions(workspace, plan, value.resolutions || {});
    cloudWorkspace = LitSync.applyPinsToWorkspace(workspace, pins);
    if (!current.exists) {
      const folderStatus = await ensureWebDavFolder(plan._options.url, plan._options.folderName, plan._options.headers);
      if (current.pathConflict && folderStatus === 405) {
        throw new Error('坚果云路径冲突：请确认“' + plan._options.folderName + '”是文件夹而非普通文件');
      }
    }
    const knownRemoteAssets = await resolveRemoteAssetNames(current.remote, workspace, plan._options, function () {
      reportProgress('scan-assets', { message: '正在读取远端附件清单，避免重复上传…' });
    });
    const assetResult = await syncWorkspaceAssets(workspace, plan._options, {
      // 附件失败不阻断文献库 JSON 写入：附件靠台账续传，先把文献元数据救回来
      strict: false,
      skip: pinSkipSet(pins),
      remoteAssets: knownRemoteAssets,
      onProgress: function (progress) {
        const current = progress.current ? ' · ' + progress.current : '';
        reportProgress('assets', { done: progress.done, total: progress.total, current: progress.current || '',
          message: progress.total > 0 ? '正在同步附件与快照（' + progress.done + '/' + progress.total + '）' + current + '…' : '正在核对附件…' });
      }
    });
    const remoteHash = hashWorkspace(current.remote);
    const remoteHadCurrentVersion = Number(current.remote && current.remote.syncVersion) >= LitSync.SYNC_VERSION;
    let uploaded = false, response = null, verifiedLibrary = null;
    if (hashWorkspace(cloudWorkspace) !== remoteHash || !remoteHadCurrentVersion || !current.exists) {
      reportProgress('upload', { message: '正在写入远端库…' });
      const payload = LitSync.createSyncEnvelope(cloudWorkspace);
      response = await conditionalPut(plan._options.fileUrl, JSON.stringify(payload, null, 2), plan._options.headers,
        current.etag, { contentType: 'application/json; charset=utf-8', label: '坚果云写入', conditional: current.exists, createOnly: !current.exists });
      reportProgress('verify-write', { message: '正在确认远端写入结果…' });
      verifiedLibrary = await verifyRemoteLibraryWrite(plan._options, cloudWorkspace);
      uploaded = true;
    }
    reportProgress('config', { message: '正在同步配置…' });
    if (plan.mode === 'restore' && plan._remoteConfig) await applySyncedConfig(await loadRawConfig(), plan._remoteConfig, { portableSettings: plan.portableSettings });
    else await syncEncryptedConfig(plan._options.folderUrl, plan._options.headers, await loadRawConfig(), {
      passwordOverride: plan._options.configSyncPassword, portableSettings: plan.portableSettings
    });
    const etag = responseEtag(response) || verifiedLibrary && verifiedLibrary.etag || current.etag || '';
    await writeSyncBase({ version: 1, savedAt: Date.now(), remoteKey: plan.remoteKey, etag: etag,
      workspace: LitSync.syncWorkspace(cloudWorkspace), pins: pins });
    pendingSyncPlans.delete(plan.planId);
    reportProgress('done', { message: '同步完成', uploaded: uploaded, pinned: Object.keys(pins).length });
    return { workspace: workspace, conflicts: plan.conflicts || [], uploaded: uploaded, assets: assetResult,
      pinned: Object.keys(pins).length, config: await getConfig() };
  }

  async function nutstoreSyncOnce(localValue, remoteOptions) {
    const library = await readRemoteLibrary(remoteOptions);
    const plan = await createNutstoreSyncPlan({
      workspace: localValue, mode: 'merge', _library: library,
      portableSettings: localValue && localValue.portableSettings
    });
    if (plan.conflicts && plan.conflicts.length || plan.remoteResetSuspected) {
      return { pendingPlan: plan, workspace: plan.workspace, conflicts: plan.conflicts, uploaded: false };
    }
    pendingSyncPlans.delete(plan.planId);
    if (!library.exists) {
      const folderStatus = await ensureWebDavFolder(remoteOptions.url, remoteOptions.folderName, remoteOptions.headers);
      if (library.pathConflict && folderStatus === 405) {
        throw new Error('坚果云路径冲突：请确认“' + remoteOptions.folderName + '”是文件夹而非普通文件');
      }
    }
    const remote = library.remote || { papers: [], folders: [] };
    const merged = plan.workspace;
    const conflicts = [];
    const pins = plan.pins || {};
    const cloudWorkspace = LitSync.applyPinsToWorkspace(merged, pins);
    const remoteHash = hashWorkspace(remote);
    const knownRemoteAssets = await resolveRemoteAssetNames(remote, merged, remoteOptions, function () {
      emitSyncProgress({ scope: 'sync', phase: 'scan-assets', message: '正在读取远端附件清单，避免重复上传…' });
    });
    const assetResult = await syncWorkspaceAssets(merged, remoteOptions, {
      // 附件失败不阻断文献库 JSON 写入：附件靠台账续传，先把文献元数据救回来
      strict: false,
      skip: pinSkipSet(pins),
      remoteAssets: knownRemoteAssets,
      onProgress: function (progress) {
        const current = progress.current ? ' · ' + progress.current : '';
        emitSyncProgress({ scope: 'sync', phase: 'assets', done: progress.done, total: progress.total, current: progress.current || '',
          message: progress.total > 0 ? '正在同步附件与快照（' + progress.done + '/' + progress.total + '）' + current + '…' : '正在核对附件…' });
      }
    });
    emitSyncProgress({ scope: 'sync', phase: 'config', message: '正在同步配置…' });
    await syncEncryptedConfig(remoteOptions.folderUrl, remoteOptions.headers, remoteOptions.raw, {
      portableSettings: localValue && localValue.portableSettings
    });
    // v5 起写入当前协议版本（旧 nutstoreSync() 的 v3 写入兼容到此结束）：
    // 旧端读到更高 syncVersion 会拒绝读写，避免把含 Note 实体的新格式改坏后写回。
    const remoteHadCurrentVersion = Number(remote && remote.syncVersion) >= LitSync.SYNC_VERSION;
    let uploaded = false, response = null, verifiedLibrary = null;
    if (hashWorkspace(cloudWorkspace) !== remoteHash || !remoteHadCurrentVersion || !library.exists) {
      if (library.exists && !library.etag) {
        const latest = await readRemoteLibrary(remoteOptions);
        if (latest.exists !== library.exists || hashWorkspace(latest.remote) !== remoteHash) {
          throw new RemoteChangedError('远端内容已变化，请重新生成同步计划', remoteOptions.fileUrl);
        }
      }
      emitSyncProgress({ scope: 'sync', phase: 'upload', message: '正在写入远端库…' });
      const payload = LitSync.createSyncEnvelope(cloudWorkspace);
      response = await conditionalPut(remoteOptions.fileUrl, JSON.stringify(payload, null, 2), remoteOptions.headers, library.etag, {
        contentType: 'application/json; charset=utf-8', label: '坚果云写入', conditional: !!library.etag, createOnly: !library.exists
      });
      emitSyncProgress({ scope: 'sync', phase: 'verify-write', message: '正在确认远端写入结果…' });
      verifiedLibrary = await verifyRemoteLibraryWrite(remoteOptions, cloudWorkspace);
      uploaded = true;
    }
    if (conflicts.length) {
      const lines = conflicts.map(function (c) {
        return JSON.stringify({ at: new Date().toISOString(), id: c.id, title: c.title, direction: c.direction, overwritten: c.overwritten });
      }).join('\n') + '\n';
      await fs.appendFile(path.join(options.baseDir, 'sync-conflicts.jsonl'), lines, 'utf8').catch(function () {});
    }
    await writeSyncBase({ version: 1, savedAt: Date.now(), remoteKey: remoteOptions.user + '\n' + remoteOptions.fileUrl,
      etag: responseEtag(response) || verifiedLibrary && verifiedLibrary.etag || library.etag || '',
      workspace: LitSync.syncWorkspace(cloudWorkspace), pins: pins });
    emitSyncProgress({ scope: 'sync', phase: 'done', message: '同步完成', uploaded: uploaded, pinned: Object.keys(pins).length });
    return { workspace: merged, conflicts: conflicts, uploaded: uploaded, assets: assetResult,
      pinned: Object.keys(pins).length, config: await getConfig() };
  }

  async function nutstoreSync(localValue) {
    const remoteOptions = await resolveNutstoreOptions({});
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // nutstoreSyncOnce 在同一次 library GET 后先生成只读计划；有歧义时
        // 直接暂停远端写入，避免预检与实际写入之间再产生一次竞态读取。
        return await nutstoreSyncOnce(localValue, remoteOptions);
      }
      catch (error) {
        lastError = error;
        if (!error || error.code !== 'REMOTE_CHANGED' || attempt >= 2) throw error;
      }
    }
    throw lastError;
  }

  async function pullPortableConfig(input) {
    const remoteOptions = await resolveNutstoreOptions(input);
    const password = remoteOptions.configSyncPassword;
    if (!password) throw new Error('请先提供配置同步密码');
    const remoteConfig = await readRemoteConfig(remoteOptions.folderUrl, remoteOptions.headers, password, { publicOnly: false });
    if (!remoteConfig.exists) return { ok: true, found: false, config: await getConfig(), etag: '', value: null };
    if (!remoteConfig.value) throw new Error('远端配置无法读取');
    const raw = await loadRawConfig();
    await applySyncedConfig(raw, remoteConfig.value);
    return { ok: true, found: true, config: await getConfig(), etag: remoteConfig.etag || '', value: portableConfigView(remoteConfig.value) };
  }

  async function inspectRemote(input) { return inspectNutstoreRemote(input); }
  async function createSyncPlan(input) { return createNutstoreSyncPlan(input); }
  async function applySyncPlan(input) { return applyNutstoreSyncPlan(input); }

  function hashWorkspace(value) {
    const ws = LitSync.syncWorkspace(value);
    const signatures = LitModel.workspaceSignatures(ws);
    return crypto.createHash('sha1')
      // 内容哈希排除由 normalize 生成的 addedAt/updatedAt，避免同一
      // 旧格式远端在两次读取之间因补默认时间而被误判为发生变化。
      .update(JSON.stringify([signatures.papers, signatures.notes, signatures.folders, signatures.savedSearches, signatures.tagColorRecords]))
      .digest('hex');
  }

  async function testNutstoreConnection(input) {
    const current = await loadRawConfig();
    const baseUrl = validateWebDavUrl(String(input && input.nutstoreUrl || current.nutstoreUrl || 'https://dav.jianguoyun.com/dav/').trim());
    const folder = normalizeWebDavFolder(input && input.nutstoreFolder != null ? input.nutstoreFolder : current.nutstoreFolder, 'LitBoard');
    const url = joinUrl(baseUrl, folder);
    const user = String(input && input.nutstoreUser || current.nutstoreUser || '').trim();
    const password = input && input.nutstorePassword ? String(input.nutstorePassword) : decrypt(current.nutstorePassword);
    if (!user || !password) throw new Error('请输入坚果云账号和应用密码');
    const response = await request(url, {
      method: 'PROPFIND',
      headers: { Authorization: basicAuth(user, password), Depth: '0' }
    });
    if (response.status === 401 || response.status === 403) throw new Error('坚果云账号或应用密码不正确');
    if (!response.ok && response.status !== 207 && response.status !== 404) throw new Error('坚果云 WebDAV 连接失败（' + response.status + '）');
    return { ok: true, status: response.status, folder: folder, folderExists: response.status !== 404 };
  }

  async function detectZoteroDataDir() {
    const candidates = [path.join(options.homeDir, 'Zotero'), path.join(options.homeDir, 'Documents', 'Zotero')];
    const config = await loadRawConfig();
    if (config.zoteroDataDir) candidates.unshift(config.zoteroDataDir);
    if (options.appDataDir) {
      const profilesDir = path.join(options.appDataDir, 'Zotero', 'Zotero', 'Profiles');
      try {
        const profiles = await fs.readdir(profilesDir, { withFileTypes: true });
        for (const profile of profiles) {
          if (!profile.isDirectory()) continue;
          try {
            const prefs = await fs.readFile(path.join(profilesDir, profile.name, 'prefs.js'), 'utf8');
            const match = prefs.match(/extensions\.zotero\.dataDir",\s*"((?:\\.|[^"])*)"/);
            if (match) candidates.unshift(JSON.parse('"' + match[1] + '"'));
          } catch (error) {}
        }
      } catch (error) {}
    }
    for (const dir of candidates) {
      try { await fs.access(path.join(dir, 'zotero.sqlite')); await saveConfig({ zoteroDataDir: dir }); return dir; } catch (error) {}
    }
    return '';
  }
  async function setZoteroDataDir(dir) {
    await fs.access(path.join(dir, 'zotero.sqlite'));
    await saveConfig({ zoteroDataDir: dir });
    return dir;
  }

  function parseExtra(extra, paper) {
    const text = String(extra || '');
    const status = text.match(/^LitBoard Status:\s*(unread|reading|read)$/mi);
    const rating = text.match(/^LitBoard Rating:\s*([0-5])$/mi);
    const notes = text.match(/^LitBoard Markdown:\s*([A-Za-z0-9+/=]+)$/mi);
    if (status) paper.status = status[1];
    if (rating) paper.rating = Number(rating[1]);
    if (notes) { try { paper.notes = Buffer.from(notes[1], 'base64').toString('utf8'); } catch (error) {} }
  }

  /** 只读打开 zotero.sqlite；被占用/锁定时复制快照再读（含 WAL） */
  async function openZoteroDb(dir) {
    const { DatabaseSync } = require('node:sqlite');
    const source = path.join(dir, 'zotero.sqlite');
    let db = null, snapshot = '';
    try {
      db = new DatabaseSync(source, { readOnly: true });
      db.prepare('SELECT 1').get();
    } catch (error) {
      if (db) { try { db.close(); } catch (closeError) {} db = null; }
      await fs.mkdir(options.baseDir, { recursive: true });
      snapshot = path.join(options.baseDir, 'zotero-read-snapshot-' + process.pid + '-' + Date.now() + '.sqlite');
      await fs.copyFile(source, snapshot);
      try { await fs.copyFile(source + '-wal', snapshot + '-wal'); } catch (walError) {}
      db = new DatabaseSync(snapshot, { readOnly: true });
    }
    return { db: db, snapshot: snapshot };
  }

  async function closeZoteroDb(handle) {
    if (handle && handle.db) { try { handle.db.close(); } catch (error) {} }
    if (handle && handle.snapshot) {
      await fs.rm(handle.snapshot, { force: true }).catch(function () {});
      await fs.rm(handle.snapshot + '-wal', { force: true }).catch(function () {});
      await fs.rm(handle.snapshot + '-shm', { force: true }).catch(function () {});
    }
  }

  async function importZoteroLocal() {
    const dir = await detectZoteroDataDir();
    if (!dir) throw new Error('未找到 Zotero 数据目录');
    let handle = null;
    try {
      handle = await openZoteroDb(dir);
      const db = handle.db;
      const items = db.prepare(`
        SELECT i.itemID, i.key, it.typeName
        FROM items i JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
        WHERE it.typeName NOT IN ('attachment','note','annotation') AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
      `).all();
      const byItemId = {};
      const papers = items.map(function (item) {
        const paper = { id: 'z' + item.key, zoteroKey: item.key, entryType: ({ conferencePaper: 'inproceedings',
          book: 'book', bookSection: 'incollection', thesis: 'phdthesis' })[item.typeName] || 'article',
          title: '(无标题)', authors: [], tags: [], folderIds: [], status: 'unread', rating: 0, notes: '', addedAt: Date.now() };
        byItemId[item.itemID] = paper; return paper;
      });
      db.prepare(`
        SELECT d.itemID, f.fieldName, v.value
        FROM itemData d JOIN fields f ON f.fieldID = d.fieldID JOIN itemDataValues v ON v.valueID = d.valueID
      `).all().forEach(function (row) {
        const paper = byItemId[row.itemID]; if (!paper) return;
        const map = { title: 'title', abstractNote: 'abstract', DOI: 'doi', url: 'url', volume: 'volume', pages: 'pages' };
        if (map[row.fieldName]) paper[map[row.fieldName]] = row.value;
        else if (['publicationTitle', 'proceedingsTitle', 'conferenceName', 'bookTitle', 'publisher', 'university'].includes(row.fieldName) && !paper.venue) paper.venue = row.value;
        else if (row.fieldName === 'date') paper.year = Number(String(row.value).match(/\d{4}/)?.[0]) || null;
        else if (row.fieldName === 'extra') parseExtra(row.value, paper);
      });
      try {
        db.prepare(`SELECT ic.itemID, c.firstName, c.lastName FROM itemCreators ic
          JOIN creators c ON c.creatorID = ic.creatorID ORDER BY ic.itemID, ic.orderIndex`).all().forEach(function (row) {
          if (byItemId[row.itemID]) byItemId[row.itemID].authors.push([row.firstName, row.lastName].filter(Boolean).join(' '));
        });
      } catch (error) {}
      try {
        db.prepare('SELECT it.itemID, t.name FROM itemTags it JOIN tags t ON t.tagID = it.tagID').all().forEach(function (row) {
          if (byItemId[row.itemID]) byItemId[row.itemID].tags.push(row.name);
        });
      } catch (error) {}
      const folders = [];
      try {
        const folderByCollection = {};
        const collectionRows = db.prepare('SELECT collectionID, key, collectionName, parentCollectionID FROM collections').all();
        collectionRows.forEach(function (row) {
          const folder = { id: 'fzc' + row.key, name: row.collectionName, parentId: '' };
          folderByCollection[row.collectionID] = folder; folders.push(folder);
        });
        collectionRows.forEach(function (row) {
          if (row.parentCollectionID && folderByCollection[row.parentCollectionID]) {
            folderByCollection[row.collectionID].parentId = folderByCollection[row.parentCollectionID].id;
          }
        });
        db.prepare('SELECT collectionID, itemID FROM collectionItems').all().forEach(function (row) {
          const paper = byItemId[row.itemID], folder = folderByCollection[row.collectionID];
          if (paper && folder) paper.folderIds.push(folder.id);
        });
      } catch (error) {}
      try {
        db.prepare(`SELECT ia.parentItemID, ai.key, ia.path, ia.contentType FROM itemAttachments ia
          JOIN items ai ON ai.itemID = ia.itemID WHERE ia.parentItemID IS NOT NULL AND ia.contentType = 'application/pdf'`).all().forEach(function (row) {
          const paper = byItemId[row.parentItemID]; if (!paper) return;
          const filename = String(row.path || '').replace(/^storage:/, '');
          paper.pdfFileName = filename || 'PDF';
          paper.zoteroAttachmentKey = row.key;
          if (filename) {
            const candidate = path.join(dir, 'storage', row.key, filename);
            try { require('node:fs').accessSync(candidate); paper.pdfPath = candidate; } catch (error) {}
          }
        });
      } catch (error) {}
      return LitModel.normalizeWorkspace({ papers: papers, folders: folders });
    } catch (error) {
      throw new Error('无法读取 Zotero 数据库，请确认目录正确并关闭 Zotero 后重试');
    } finally {
      await closeZoteroDb(handle);
    }
  }

  // ============ Zotero 导入向导：抽取 → 映射（js/zotero.js）→ 资产复制 ============

  const notifyProgress = typeof options.notify === 'function' ? options.notify : function () {};

  function zoteroQuery(db, sql, failures, label) {
    try { return db.prepare(sql).all(); } catch (error) {
      if (Array.isArray(failures)) failures.push({ kind: 'query', query: label || sql, message: String(error && error.message || error) });
      return [];
    }
  }
  function zoteroTableColumns(db, table) {
    try { return db.prepare('PRAGMA table_info(' + table + ')').all().map(function (row) { return row.name; }); }
    catch (error) { return []; }
  }
  function zoteroKeyFromUri(value) {
    const match = /\/items\/([A-Za-z0-9_-]+)\/?$/.exec(String(value || ''));
    return match ? match[1] : '';
  }

  /** 从 zotero.sqlite 抽取纯 JSON 快照（所有新查询各自容错，旧库缺表不致命） */
  function extractZoteroRaw(db) {
    const raw = { queryFailures: [] };
    const failures = raw.queryFailures;
    const libraries = zoteroQuery(db, 'SELECT libraryID, libraryType FROM libraries', failures, 'libraries');
    raw.personalLibraryIds = libraries.filter(function (row) { return row.libraryType === 'user' || Number(row.libraryID) === 1; })
      .map(function (row) { return row.libraryID; });
    raw.libraryId = raw.personalLibraryIds.length ? String(raw.personalLibraryIds[0]) : '1';
    raw.allItems = zoteroQuery(db,
      'SELECT i.itemID, i.key, i.libraryID, it.typeName FROM items i JOIN itemTypes it ON it.itemTypeID = i.itemTypeID', failures, 'items');
    if (!raw.allItems.length) {
      var failedItemsQuery = failures.some(function (failure) { return failure.query === 'items'; });
      var legacyItems = zoteroQuery(db,
        'SELECT i.itemID, i.key, it.typeName FROM items i JOIN itemTypes it ON it.itemTypeID = i.itemTypeID', failures, 'items-legacy');
      if (legacyItems.length) {
        raw.allItems = legacyItems;
        if (failedItemsQuery) raw.queryFailures = failures.filter(function (failure) { return failure.query !== 'items'; });
      }
    }
    raw.deletedItemIDs = zoteroQuery(db, 'SELECT itemID FROM deletedItems', failures, 'deletedItems').map(function (row) { return row.itemID; });
    raw.itemData = zoteroQuery(db,
      'SELECT d.itemID, f.fieldName, v.value FROM itemData d ' +
      'JOIN fields f ON f.fieldID = d.fieldID JOIN itemDataValues v ON v.valueID = d.valueID', failures, 'itemData');
    raw.creators = zoteroQuery(db,
      'SELECT ic.itemID, ct.creatorType, c.firstName, c.lastName, c.fieldMode, ic.orderIndex ' +
      'FROM itemCreators ic JOIN creators c ON c.creatorID = ic.creatorID ' +
      'LEFT JOIN creatorTypes ct ON ct.creatorTypeID = ic.creatorTypeID ORDER BY ic.itemID, ic.orderIndex', failures, 'creators');
    if (!raw.creators.length) {
      raw.creators = zoteroQuery(db,
        'SELECT ic.itemID, \'author\' AS creatorType, c.firstName, c.lastName, 0 AS fieldMode, ic.orderIndex ' +
        'FROM itemCreators ic JOIN creators c ON c.creatorID = ic.creatorID ORDER BY ic.itemID, ic.orderIndex', failures, 'creators-legacy');
    }
    raw.tags = zoteroQuery(db, 'SELECT it.itemID, t.name FROM itemTags it JOIN tags t ON t.tagID = it.tagID', failures, 'tags');
    raw.collections = zoteroQuery(db,
      'SELECT collectionID, key, collectionName, parentCollectionID FROM collections', failures, 'collections')
      .map(function (row) {
        return { collectionID: row.collectionID, key: row.key, name: row.collectionName, parentCollectionID: row.parentCollectionID };
      });
    raw.collectionItems = zoteroQuery(db, 'SELECT collectionID, itemID FROM collectionItems', failures, 'collectionItems');
    raw.notes = zoteroQuery(db,
      'SELECT n.itemID, n.parentItemID, i.key, n.title, n.note FROM itemNotes n JOIN items i ON i.itemID = n.itemID', failures, 'itemNotes');

    // 批注（Zotero 7+ itemAnnotations；列集合随版本变化，防御式探测）
    const annotationColumns = zoteroTableColumns(db, 'itemAnnotations');
    raw.annotations = [];
    if (annotationColumns.length) {
      const wanted = ['type', 'text', 'comment', 'color', 'pageLabel', 'position', 'sortOrder']
        .filter(function (col) { return annotationColumns.indexOf(col) !== -1; });
      const hasImageRelPath = annotationColumns.indexOf('imageRelPath') !== -1;
      raw.annotations = zoteroQuery(db,
        'SELECT a.itemID, a.parentItemID, i.key' +
        (wanted.length ? ', ' + wanted.map(function (col) { return 'a.' + col; }).join(', ') : '') +
        (hasImageRelPath ? ', a.imageRelPath' : '') +
        ' FROM itemAnnotations a JOIN items i ON i.itemID = a.itemID', failures, 'itemAnnotations')
        .map(function (row) {
          // 区域批注的渲染图：Zotero 7 存放在 cache/library/<批注 key>.png
          row.imagePath = row.imageRelPath || (row.type === 'image' ? 'cache/library/' + row.key + '.png' : '');
          delete row.imageRelPath;
          return row;
        });
    }

    raw.attachments = zoteroQuery(db,
      'SELECT ia.itemID, ia.parentItemID, i.key, ia.linkMode, ia.contentType, ia.path ' +
      'FROM itemAttachments ia JOIN items i ON i.itemID = ia.itemID', failures, 'itemAttachments');
    const urlByItemId = {};
    raw.itemData.forEach(function (row) {
      if (row.fieldName === 'url') urlByItemId[row.itemID] = row.value;
    });
    raw.attachments.forEach(function (row) { row.url = urlByItemId[row.itemID] || ''; });

    // 关联条目（relations 表结构随版本变化：itemID 对或 URI 对，两者都识别）
    raw.relations = [];
    if (zoteroTableColumns(db, 'relations').length) {
      const keyToItemId = {};
      raw.allItems.forEach(function (item) { keyToItemId[item.key] = item.itemID; });
      zoteroQuery(db, 'SELECT * FROM relations', failures, 'relations').forEach(function (row) {
        const subjectRaw = row.subjectItemID != null ? row.subjectItemID : row.subject;
        const objectRaw = row.objectItemID != null ? row.objectItemID : row.object;
        const subjectKey = typeof subjectRaw === 'string' ? zoteroKeyFromUri(subjectRaw) : '';
        const subjectItemID = typeof subjectRaw === 'number' ? subjectRaw : keyToItemId[subjectKey];
        const objectKey = typeof objectRaw === 'number' ? '' : (zoteroKeyFromUri(objectRaw) || String(objectRaw || ''));
        if (subjectItemID != null && objectKey) {
          raw.relations.push({ subjectItemID: subjectItemID, objectKey: objectKey });
        }
      });
    }

    // 标签颜色（Zotero 7 存在 settings.tagColors JSON）
    raw.tagColors = [];
    zoteroQuery(db, "SELECT value FROM settings WHERE key = 'tagColors'", failures, 'tagColors').forEach(function (row) {
      try {
        JSON.parse(row.value).forEach(function (entry) {
          if (entry && entry.name) raw.tagColors.push({ name: entry.name, color: entry.color });
        });
      } catch (error) {}
    });
    return raw;
  }

  async function resolveZoteroDir(input) {
    const dir = String(input && input.dir || '').trim();
    if (dir) { await fs.access(path.join(dir, 'zotero.sqlite')); return dir; }
    const detected = await detectZoteroDataDir();
    if (!detected) throw new Error('未找到 Zotero 数据目录');
    return detected;
  }

  function zoteroFileExists() {
    const fsSync = require('node:fs');
    return function (target) {
      try { fsSync.accessSync(target); return true; } catch (error) { return false; }
    };
  }

  /** 扫描预览：只读抽取 + 映射，不复制任何文件 */
  async function scanZoteroLibrary(input) {
    const dir = await resolveZoteroDir(input);
    const handle = await openZoteroDb(dir);
    try {
      const raw = extractZoteroRaw(handle.db);
      const mapped = LitZotero.mapLibrary(raw, { dataDir: dir, fileExists: zoteroFileExists(),
        sourceLibraryId: raw.libraryId, noteFormat: 'richtext', sanitizeHtml: LitNoteMl.sanitizeHtml });
      return {
        dir: dir,
        stats: {
          source: mapped.report.source,
          imported: mapped.report.imported,
          missing: mapped.report.missing.length,
          failures: mapped.report.failures.length,
          unconverted: mapped.report.unconverted.length,
          queryFailures: mapped.report.queryFailures ? mapped.report.queryFailures.length : 0
        },
        report: mapped.report
      };
    } catch (error) {
      throw new Error('无法读取 Zotero 数据库，请确认目录正确并关闭 Zotero 后重试');
    } finally {
      await closeZoteroDb(handle);
    }
  }

  /** 执行导入：抽取 + 映射 + （可选）资产复制进受管目录，逐项失败不丢整批 */
  async function importZoteroLibrary(input) {
    const dir = await resolveZoteroDir(input);
    const copyFiles = !input || input.copyFiles !== false;
    const handle = await openZoteroDb(dir);
    let mapped;
    try {
      const raw = extractZoteroRaw(handle.db);
      mapped = LitZotero.mapLibrary(raw, { dataDir: dir, fileExists: zoteroFileExists(),
        sourceLibraryId: raw.libraryId, noteFormat: 'richtext', sanitizeHtml: LitNoteMl.sanitizeHtml });
    } catch (error) {
      throw new Error('无法读取 Zotero 数据库，请确认目录正确并关闭 Zotero 后重试');
    } finally {
      await closeZoteroDb(handle);
    }
    const report = mapped.report;
    report.imported.assetsCopied = 0;
    report.imported.assetsSkipped = 0;
    // 重复导入：本地已有同 zoteroKey 的附件/笔记/条目不再复制文件（合并层也会判重）
    const existing = input && input.existing && typeof input.existing === 'object' ? input.existing : {};
    const skipKeys = function (list) {
      const out = {};
      (Array.isArray(list) ? list : []).forEach(function (key) { out[String(key)] = true; });
      return out;
    };
    const skipAttachments = skipKeys(existing.attachmentKeys);
    const skipNotes = skipKeys(existing.noteKeys);
    const skipPapers = skipKeys(existing.paperKeys);
    if (copyFiles) {
      const attachmentsDir = path.join(options.baseDir, 'synced-attachments');
      const noteAssetsRoot = path.join(options.baseDir, 'note-assets');
      const annotationImagesDir = path.join(options.baseDir, 'annotation-images');
      await fs.mkdir(attachmentsDir, { recursive: true });
      const assetMapPath = path.join(attachmentsDir, '.zotero-assets.json');
      let assetMap = {};
      try {
        assetMap = JSON.parse(await fs.readFile(assetMapPath, 'utf8'));
      } catch (e) {
        assetMap = {};
      }
      const paperById = {};
      mapped.workspace.papers.forEach(function (paper) { paperById[paper.id] = paper; });
      const noteById = {};
      (mapped.workspace.notes || []).forEach(function (note) { noteById[note.id] = note; });
      const jobs = [];
      for (const job of mapped.assets) {
        if (!job.sourcePath && !job.dataUri) continue;
        if (job.kind === 'file' || job.kind === 'snapshot-dir') {
          if (skipAttachments[job.zoteroKey]) {
            const storedPath = assetMap[job.zoteroKey];
            let fileValid = false;
            if (storedPath) {
              try { await fs.access(storedPath); fileValid = true; } catch (e) {}
            }
            if (fileValid) {
              const paper = paperById[job.paperId];
              const attachment = paper && paper.attachments.find(function (att) { return att.id === job.attachmentId; });
              if (attachment) attachment.path = storedPath;
              report.imported.assetsSkipped++;
              continue;
            }
          }
        }
        if (job.kind === 'note-image' && skipNotes[job.zoteroKey]) {
          report.imported.assetsSkipped++; continue;
        }
        if (job.kind === 'annotation-image' && skipPapers[String(job.paperId || '').slice(1)]) {
          report.imported.assetsSkipped++; continue;
        }
        jobs.push(job);
      }
      let done = 0;
      notifyProgress('integrations:zotero-progress', { phase: 'copy', done: 0, total: jobs.length });
      for (const job of jobs) {
        try {
          if (job.kind === 'file') {
            const paper = paperById[job.paperId];
            const attachment = paper && paper.attachments.find(function (att) { return att.id === job.attachmentId; });
            if (!attachment) throw new Error('附件记录不存在');
            const stored = await storeFileInto(attachmentsDir, job.sourcePath, path.extname(job.fileName));
            attachment.path = stored.path;
            if (job.zoteroKey) assetMap[job.zoteroKey] = stored.path;
          } else if (job.kind === 'snapshot-dir') {
            const paper = paperById[job.paperId];
            const attachment = paper && paper.attachments.find(function (att) { return att.id === job.attachmentId; });
            if (!attachment) throw new Error('快照附件记录不存在');
            const stored = await storeDirInto(attachmentsDir, job.sourcePath);
            attachment.path = stored.path;
            if (job.zoteroKey) assetMap[job.zoteroKey] = stored.path;
          } else if (job.kind === 'note-image') {
            const note = noteById[job.noteId];
            if (!note) throw new Error('笔记记录不存在');
            const targetDir = path.join(noteAssetsRoot, note.id);
            await fs.mkdir(targetDir, { recursive: true });
            const target = path.join(targetDir, path.basename(job.fileName));
            if (job.dataUri) {
              const base64 = job.dataUri.replace(/^data:image\/[a-z0-9+.-]+\s*;base64,/i, '');
              await fs.writeFile(target, Buffer.from(base64, 'base64'));
            } else {
              await fs.copyFile(job.sourcePath, target);
            }
            const entry = (note.assets || []).find(function (asset) { return asset.fileName === job.fileName && !asset.path.startsWith(noteAssetsRoot); });
            if (entry) entry.path = target;
          } else if (job.kind === 'annotation-image') {
            const paper = paperById[job.paperId];
            const annotation = paper && (paper.pdfAnnotations || []).find(function (ann) { return ann.id === job.annotationId; });
            if (!annotation) throw new Error('批注记录不存在');
            await fs.mkdir(annotationImagesDir, { recursive: true });
            const ext = path.extname(job.fileName).toLowerCase() || '.png';
            let target = path.join(annotationImagesDir, job.annotationId + ext);
            let suffix = 0;
            while (true) {
              try { await fs.access(target); suffix++; target = path.join(annotationImagesDir, job.annotationId + '-' + suffix + ext); }
              catch (error) { break; }
            }
            await fs.copyFile(job.sourcePath, target);
            annotation.imagePath = target;
          } else {
            continue;
          }
          report.imported.assetsCopied++;
        } catch (error) {
          report.failures.push({ kind: 'asset', key: job.zoteroKey, message: String(error && error.message || error) });
        }
        done++;
        notifyProgress('integrations:zotero-progress', { phase: 'copy', done: done, total: jobs.length });
      }
      try {
        await fs.writeFile(assetMapPath, JSON.stringify(assetMap, null, 2), 'utf8');
      } catch (e) {}
    }
    return { dir: dir, workspace: mapped.workspace, report: report };
  }

  async function migrateZoteroCloudAttachments(value) {
    const config = await loadRawConfig();
    const password = decrypt(config.nutstorePassword);
    if (!config.nutstoreUser || !password) throw new Error('请先配置坚果云账号和应用密码');
    const headers = { Authorization: basicAuth(config.nutstoreUser, password) };
    const cloudFolder = joinUrl(config.nutstoreUrl || 'https://dav.jianguoyun.com/dav/', config.zoteroWebDavFolder || 'zotero');
    const workspace = LitModel.normalizeWorkspace(value);
    const targetDir = path.join(options.baseDir, 'zotero-migrated-attachments');
    await fs.mkdir(targetDir, { recursive: true });
    const candidates = workspace.papers.filter(function (paper) { return !!paper.zoteroAttachmentKey; });
    let cursor = 0, downloaded = 0, existing = 0, missing = 0, failed = 0;
    async function worker() {
      while (cursor < candidates.length) {
        const paper = candidates[cursor++];
        if (paper.pdfPath) {
          try { await fs.access(paper.pdfPath); existing++; continue; } catch (error) { paper.pdfPath = ''; }
        }
        const response = await request(joinUrl(cloudFolder, paper.zoteroAttachmentKey + '.zip'), { method: 'GET', headers: headers });
        if (response.status === 404) { missing++; continue; }
        if (!response.ok) { failed++; continue; }
        try {
          const archive = Buffer.from(await response.arrayBuffer());
          const pdf = extractFirstPdfFromZip(archive);
          const target = path.join(targetDir, paper.id + '.pdf');
          await fs.writeFile(target, pdf.data);
          paper.pdfPath = target;
          paper.pdfFileName = pdf.name || paper.pdfFileName || 'PDF';
          downloaded++;
        } catch (error) { failed++; }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { workspace: workspace, downloaded: downloaded, existing: existing, missing: missing, failed: failed };
  }

  /* 调研助手运行时配置：主进程内部使用（含解密后的 Key），不回渲染层。
   * 与划词翻译凭据完全独立——AI 助手 / OpenAlex 检索各有各的 Key。 */
  async function getResearchRuntimeConfig() {
    const raw = await loadRawConfig();
    return {
      agentBaseUrl: String(raw.agentBaseUrl || '').trim(),
      agentModel: String(raw.agentModel || '').trim(),
      agentApiDialect: AGENT_DIALECTS.indexOf(raw.agentApiDialect) >= 0 ? raw.agentApiDialect : '',
      agentApiKey: decrypt(raw.agentApiKey),
      // 向量模型（调研库向量专用；未配置时由 js/embedcfg.js 回退到上面的 AI 助手端点）
      embedProvider: String(raw.embedProvider || '').trim(),
      embedBaseUrl: String(raw.embedBaseUrl || '').trim(),
      embedModel: String(raw.embedModel || '').trim(),
      embedApiKey: decrypt(raw.embedApiKey),
      openalexEmail: String(raw.openalexEmail || '').trim(),
      openalexApiKey: decrypt(raw.openalexApiKey),
      elsevierApiKey: decrypt(raw.elsevierApiKey),
      tinyfishApiKey: decrypt(raw.tinyfishApiKey),
      semanticscholarApiKey: decrypt(raw.semanticscholarApiKey)
    };
  }

  return { getConfig, saveConfig, getResearchRuntimeConfig, nutstoreSync,
    inspectNutstoreRemote, createNutstoreSyncPlan, applyNutstoreSyncPlan,
    pullPortableConfig, pullNutstoreConfig: pullPortableConfig, inspectRemote, createSyncPlan, applySyncPlan,
    testNutstoreConnection, translateText, testTranslationConnection, getScigreatRank, testScigreatConnection, getJournalRank, testJournalRankConnection, detectZoteroDataDir, setZoteroDataDir,
    importZoteroLocal, scanZoteroLibrary, importZoteroLibrary, migrateZoteroCloudAttachments };
}

/* ----------------------------------------------------------------------
 * 附件上传台账（sync-asset-ledger.json，纯函数部分）
 *
 * 云端 hash 元数据（cloudHash/cloudSize）平时存于文献库 blob 与远端 JSON，
 * 但只有一次同步完整走完（渲染层 applySyncedWorkspace → save）才会落库；
 * 同步在中途被限流/断网打断时进度全丢，下一轮会把所有 PDF 从头上传一遍。
 * 台账在附件每次成功 PUT/下载后立即落盘「cloudName → 字节流 SHA-256 + 大小」，
 * 使下一轮同步能证明该对象已在远端、跳过重传，从断点续传。台账按
 * remoteKey（账号 + 远端库 URL）失效；成功收尾后按当前工作区裁剪。
 * -------------------------------------------------------------------- */

/** 按请求负载大小放宽超时（仅上传类请求携带 body）：无负载用基准值；有负载按
 * 256KB/s 悲观上行速率 + 15s 余量，封顶 10 分钟防止连接真挂死。这只是「放弃等
 * 待的最后期限」，不影响实际传输速度——客户端不做任何限速。 */
function requestTimeoutMs(bodySize, baseMs) {
  const base = Number.isFinite(Number(baseMs)) && Number(baseMs) > 0 ? Number(baseMs) : 30000;
  const size = Number(bodySize);
  if (!Number.isFinite(size) || size <= 0) return base;
  return Math.min(600000, Math.max(base, Math.ceil(size / 262144) * 1000 + 15000));
}

function assetLedgerRemoteKey(remoteOptions) {
  return String(remoteOptions && remoteOptions.user || '') + '\n' + String(remoteOptions && remoteOptions.fileUrl || '');
}

/** 解析台账文件内容；结构无效或 remoteKey 不符（换账号/换远端目录）时返回空台账 */
function loadAssetLedgerValue(value, remoteKey) {
  const fresh = { version: 1, remoteKey: remoteKey, assets: {} };
  if (!value || typeof value !== 'object' || !value.assets || typeof value.assets !== 'object') return fresh;
  if (value.remoteKey !== remoteKey) return fresh;
  const assets = {};
  Object.keys(value.assets).forEach(function (cloudName) {
    const entry = value.assets[cloudName];
    if (!entry || typeof entry !== 'object' || !/^[a-f0-9]{64}$/.test(String(entry.hash || ''))) return;
    const size = entry.size == null ? null : Number(entry.size);
    if (size != null && (!isFinite(size) || size < 0)) return;
    assets[String(cloudName)] = { hash: String(entry.hash).toLowerCase(), size: size == null ? null : Math.trunc(size) };
  });
  return { version: 1, remoteKey: remoteKey, assets: assets };
}

/** 台账能否证明该对象已在远端（同一字节流成功 PUT 过）。远端清单非空且
 * 明确不含该对象时不采信台账，照常上传。 */
function assetLedgerProof(ledger, cloudName, hash, size, knownRemoteAssets) {
  const entry = ledger && ledger.assets && ledger.assets[String(cloudName || '')];
  if (!entry || entry.hash !== String(hash || '').toLowerCase()) return false;
  if (entry.size != null && size != null && entry.size !== size) return false;
  if (knownRemoteAssets && knownRemoteAssets.size > 0 && !knownRemoteAssets.has(cloudName)) return false;
  return true;
}

function recordAssetLedger(ledger, cloudName, hash, size) {
  ledger.assets[String(cloudName)] = { hash: String(hash).toLowerCase(), size: size, at: Date.now() };
}

/** 按当前工作区裁剪台账，只保留仍被引用的云端对象，避免无限增长 */
function pruneAssetLedger(ledger, keepNames) {
  const assets = {};
  Object.keys(ledger.assets).forEach(function (cloudName) {
    if (keepNames.has(cloudName)) assets[cloudName] = ledger.assets[cloudName];
  });
  ledger.assets = assets;
  return ledger;
}

/** 附件本机签名：记录时对应的 cloudHash + size + mtimeMs 截断，即
 * attachments.syncSignature 的格式。cloudHash 编进签名：另一台设备改了
 * 同一附件（合并采纳远端 cloudHash 而本机签名沿用）时旧签名自动失效，
 * 退回逐字节核对，避免漏掉本该重传的差异。 */
function assetLocalSignature(stat, cloudHash) {
  return String(cloudHash || '').toLowerCase() + ':' + stat.size + ':' + Math.trunc(stat.mtimeMs);
}

/** 签名缓存判定：本机签名（含记录时的 cloudHash）与上次核对记录一致、
 * 云端哈希在册、大小相容、远端清单不缺该对象时，可免读盘重哈希直接按
 * 「已核对」处理（判定口径与逐字节核对的上传分支严格互补）。localSize
 * 传 null 表示目录签名（快照确定性 ZIP：清单一致 ⇒ 字节一致），不做
 * 大小比对。 */
function assetSignatureUnchanged(asset, signature, cloudName, knownRemoteAssets, localSize) {
  if (!asset || !cloudName || !asset.syncSignature || asset.syncSignature !== signature) return false;
  if (!String(asset.cloudHash || '').toLowerCase()) return false;
  if (asset.cloudSize != null && localSize != null && Number(asset.cloudSize) !== localSize) return false;
  if (knownRemoteAssets instanceof Set && !knownRemoteAssets.has(cloudName)) return false;
  return true;
}

module.exports = {
  createIntegrations, extractFirstPdfFromZip, zipStoreEntries, extractZipAll, storeFileInto, storeDirInto, resolveSnapshotEntry,
  assetLedgerRemoteKey, loadAssetLedgerValue, assetLedgerProof, recordAssetLedger, pruneAssetLedger,
  assetLocalSignature, assetSignatureUnchanged, requestTimeoutMs
};
