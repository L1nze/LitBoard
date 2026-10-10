'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const LitModel = require('../js/model.js');
const LitSync = require('../js/sync.js');
const LitZotero = require('../js/zotero.js');
const LitNoteMl = require('../js/noteml.js');
const LitTranslate = require('../js/translate.js');
const { createCloudMirror } = require('./cloud-mirror.js');
const LitEmbedCfg = require('../js/embedcfg.js');
const LitAgentCfg = require('../js/agentcfg.js');
const { itemAttachmentDir } = require('./item-storage.js');
const { availablePdfPath } = require('./pdfdownload.js');
const { createRequestPacer, loadPacingValue } = require('./webdav-pacer.js');

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

/* ---------- stored-ZIP（不压缩）写入/全量解压：网页快照目录的云端载体（vendored JSZip） ---------- */
const JSZip = require('../vendor/jszip/jszip.min.js');
const ZIP_FIXED_DATE = new Date(1980, 0, 1, 0, 0, 0); // DOS 时间原点

/**
 * 生成确定性的 stored-ZIP：条目按文件名排序、固定 DOS 日期（1980-01-01）、无压缩、不落目录条目。
 * 同样的文件集合在同一 JSZip 版本内永远得到同样的字节，因此 cloudHash（zip 的 sha256）可直接当
 * 目录内容指纹。注意：字节布局与 2026-09 之前的自写实现不同——旧快照内容不变时靠
 * syncSignature 快捷路径免重打包，一旦真的重打包即得新哈希并伴随一次上传（内容等价，仅容器字节变）。
 */
async function zipStoreEntries(entries) {
  const sorted = (entries || []).slice().sort(function (a, b) {
    return String(a.name) < String(b.name) ? -1 : (String(a.name) > String(b.name) ? 1 : 0);
  });
  const zip = new JSZip();
  for (const entry of sorted) {
    const name = String(entry.name).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name || name.split('/').indexOf('..') !== -1) {
      throw new Error('非法 ZIP 条目名：' + String(entry.name));
    }
    zip.file(name, Buffer.from(entry.data), { date: ZIP_FIXED_DATE, createFolders: false });
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE', createFolders: false });
}

/** 全量解压（method 0/8，JSZip 内置 inflate），跳过目录条目；非法条目名（.. / 绝对路径）直接拒绝 */
async function extractZipAll(value) {
  const zip = await JSZip.loadAsync(Buffer.from(value));
  const out = [];
  for (const key of Object.keys(zip.files)) {
    const file = zip.files[key];
    if (file.dir) continue;
    const name = String(file.name || '').replace(/\\/g, '/');
    if (!name || path.isAbsolute(name) || name.split('/').indexOf('..') !== -1) {
      throw new Error('ZIP 包含非法条目名：' + name);
    }
    // 解压前的大小上限（JSZip 内部字段，钉版 3.10.1 可用；缺字段时由解压后检查兜底）
    const preSize = file._data && Number(file._data.uncompressedSize);
    if (preSize > 500 * 1024 * 1024) throw new Error('ZIP 条目过大');
    const data = await file.async('nodebuffer');
    if (data.length > 500 * 1024 * 1024) throw new Error('ZIP 条目过大');
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
  const syncContext = new AsyncLocalStorage();
  let activeSync = null;
  function syncCancelled() {
    const error = new Error('同步已停止');
    error.code = 'SYNC_CANCELLED';
    return error;
  }
  function throwIfSyncCancelled() {
    if (syncContext.getStore() && syncContext.getStore().signal.aborted) throw syncCancelled();
  }
  async function runSyncTask(task) {
    if (activeSync) throw new Error('已有同步任务正在进行');
    const controller = new AbortController();
    activeSync = controller;
    try { return await syncContext.run(controller, task); }
    finally { if (activeSync === controller) activeSync = null; }
  }
  function cancelNutstoreSync() {
    if (!activeSync) return false;
    activeSync.abort();
    return true;
  }
  const configuredTimeout = Number(options.requestTimeoutMs);
  const REQUEST_TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 30000;
  // 同步会话期间非空的节流器：所有 WebDAV 请求经它排队（坚果云 30 分钟窗口预算），
  // 并在响应 429 时记下暂停时刻。仅在 runSyncTask 串行保护的同步会话内赋值。
  let activePacer = null;
  const dispatchRequest = async function (url, init) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const sync = syncContext.getStore();
    const requestInit = Object.assign({}, init || {});
    if (controller) requestInit.signal = controller.signal;
    const startedAt = Date.now();
    const reqBody = requestInit.body;
    const bodySize = reqBody == null ? 0 : (typeof reqBody === 'string' ? Buffer.byteLength(reqBody) :
      (typeof reqBody.length === 'number' ? reqBody.length : (typeof reqBody.byteLength === 'number' ? reqBody.byteLength : 0)));
    const timeoutMs = requestTimeoutMs(bodySize, REQUEST_TIMEOUT_MS);
    function timed(operation, remainingMs, deadlineMs) {
      return new Promise(function (resolve, reject) {
        let settled = false;
        if (sync && sync.signal.aborted) {
          if (controller) controller.abort();
          reject(syncCancelled());
          return;
        }
        function finish() { clearTimeout(timer); if (sync) sync.signal.removeEventListener('abort', onAbort); }
        function onAbort() {
          if (settled) return;
          settled = true;
          if (controller) controller.abort();
          finish();
          reject(syncCancelled());
        }
        const timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          if (controller) controller.abort();
          finish();
          reject(new Error('网络请求超时（' + Math.round(deadlineMs / 1000) + 's）：' + String(url)));
        }, Math.max(1, remainingMs));
        if (sync) sync.signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve().then(function () {
          if (sync && sync.signal.aborted) throw syncCancelled();
          return operation();
        }).then(function (value) {
          if (settled) return;
          settled = true; finish(); resolve(value);
        }, function (error) {
          if (settled) return;
          settled = true; finish(); reject(error);
        });
      });
    }
    const response = await timed(function () { return rawRequest(url, requestInit); }, timeoutMs, timeoutMs);
    // fetch 在响应头到达时即返回；读完整响应体仍需受截止时间和停止信号约束。
    const responseSize = response.headers && response.headers.get ? Number(response.headers.get('content-length')) || 0 : 0;
    const readTimeoutMs = requestTimeoutMs(Math.max(bodySize, responseSize), REQUEST_TIMEOUT_MS);
    for (const method of ['text', 'arrayBuffer']) {
      if (typeof response[method] !== 'function') continue;
      const read = response[method];
      response[method] = function () {
        return timed(function () { return read.call(response); }, readTimeoutMs - (Date.now() - startedAt), readTimeoutMs);
      };
    }
    return response;
  };
  const request = async function (url, init) {
    if (activePacer) await activePacer.acquire();
    const response = await dispatchRequest(url, init);
    if (activePacer && response && response.status === 429) {
      // 交由节流器记账（消费 Retry-After、持久化恢复时刻）并转为暂停；
      // 未启用节流的调用方仍由各请求点的 throwIfWebDavRateLimited 兜底。
      const retryAfter = response.headers && response.headers.get ? String(response.headers.get('retry-after') || '').trim() : '';
      throw activePacer.noteRateLimited(retryAfter);
    }
    return response;
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

  /** 给设置页的安全回显：仅暴露短前缀/后缀，完整凭据仍只在用户点「查看」后按需读取。 */
  function secretHint(value) {
    const secret = decrypt(value);
    if (!secret) return '';
    if (secret.length <= 4) return '****';
    return secret.slice(0, Math.min(3, secret.length - 4)) + '****' + secret.slice(-4);
  }
  /** AI 助手的上下文 / 输出预算（token）：0 或非法值 = 「留空」，由渲染层用
   *  js/agentcore DEFAULTS（256000 / 12800）。上限只挡手输的离谱值（1000 万 token 上下文 /
   *  100 万 token 输出已远超任何真实模型），不猜各模型自己的上限——那类边界由端点在 400 里说。 */
  function agentTokenBudget(value, max) {
    const n = Math.floor(Number(value));
    if (!isFinite(n) || n <= 0) return 0;
    return Math.min(n, max);
  }

  /* ---------- AI 助手「服务商 + 模型」清单 ----------
   * 语义（迁移/镜像/选择/增删）全在 js/agentcfg.js 的纯函数里，这里只管**凭据落盘**：
   * 每个服务商一把自己的 Key（密文进配置文件，明文只在主进程内存里短暂出现）。
   * 扁平字段 agentBaseUrl / agentApiDialect / agentModel / agentApiKey 降级为「当前生效
   * 服务商」的镜像，写盘前由 agentMirror() 重算——agent-net、js/embedcfg 的 legacy-chat
   * 回退、渲染层的就绪判定都还在读它们，因此这些老消费方一行都不用改。 */
  const AGENT_PROVIDER_FIELDS = ['id', 'name', 'baseUrl', 'dialect', 'models', 'activeModel'];

  /** 落盘形态的服务商（只留已知字段 + 密文 apiKey；缺 Key 时空串）。
   *  hasApiKey 是给渲染层的占位，绝不写进配置文件——否则「密文存在但 hasApiKey=false」
   * 这类自相矛盾的行会被后来的读者当成真话。 */
  function storedShape(provider) {
    const out = {};
    AGENT_PROVIDER_FIELDS.forEach(function (key) { out[key] = provider[key]; });
    out.apiKey = String(provider.apiKey || '');
    return out;
  }

  /** 当前配置文件里的服务商清单（旧配置的扁平字段由 normalizeConfig 合成为内置服务商） */
  function storedAgentProviders(raw) {
    return LitAgentCfg.normalizeConfig(raw).providers.map(storedShape);
  }

  /** 提交给渲染层的服务商（带 hasApiKey 与脱敏提示，密文不出主进程） */
  function publicAgentProviders(providers) {
    return (providers || []).map(function (p) {
      return {
        id: p.id, name: p.name, baseUrl: p.baseUrl, dialect: p.dialect,
        models: p.models, activeModel: p.activeModel, hasApiKey: !!p.apiKey, apiKeyHint: secretHint(p.apiKey)
      };
    });
  }

  /**
   * 合并渲染层提交的服务商清单与当前配置。
   * apiKey 语义与其余凭据一致：非空 = 更新为该值；缺省 / 空串 = 保持原值；
   * clearApiKey:true = 清空。未提交的服务商（按 id 匹配）保留原样，被删掉的自然消失。
   */
  function mergeAgentProviders(currentList, inputList) {
    const currentById = {};
    (currentList || []).forEach(function (p) { if (p && p.id) currentById[String(p.id)] = p; });
    const out = [];
    (Array.isArray(inputList) ? inputList : []).forEach(function (item) {
      const incoming = LitAgentCfg.normalizeProvider(item, '');
      if (!incoming.id || out.length >= LitAgentCfg.MAX_PROVIDERS) return;
      if (out.some(function (p) { return p.id === incoming.id; })) return;
      const previous = currentById[incoming.id] || {};
      let apiKey = String(previous.apiKey || '');
      const submitted = item && item.apiKey != null ? String(item.apiKey) : '';
      if (item && item.clearApiKey === true) apiKey = '';
      else if (submitted) apiKey = encrypt(submitted);
      out.push(storedShape(Object.assign({}, incoming, { apiKey: apiKey })));
    });
    if (!out.length) {
      out.push(storedShape({ id: LitAgentCfg.DEFAULT_PROVIDER_ID }));
    }
    return out;
  }

  /** 扁平字段镜像（当前生效服务商）：必须在 providers / activeId 定稿之后调用 */
  function agentMirror(providers, activeId) {
    const cfg = LitAgentCfg.normalizeConfig({ agentProviders: providers, agentActiveProviderId: activeId });
    const active = LitAgentCfg.activeProvider(cfg);
    const flat = LitAgentCfg.mirror(cfg);
    return {
      agentActiveProviderId: cfg.activeId,
      agentBaseUrl: flat.agentBaseUrl,
      agentApiDialect: flat.agentApiDialect,
      agentModel: flat.agentModel,
      agentApiKey: String(active.apiKey || '')
    };
  }

  /** 旧契约兼容：直接提交扁平 AI 助手字段（老渲染层 / 测试）→ 落到当前生效服务商上 */
  function applyLegacyAgentFields(cfg, input) {
    const touched = ['agentBaseUrl', 'agentModel', 'agentApiDialect', 'agentApiKey'].some(function (key) {
      return input[key] != null;
    });
    if (!touched) return cfg;
    const active = LitAgentCfg.activeProvider(cfg);
    const patched = {
      id: active.id, name: active.name,
      baseUrl: input.agentBaseUrl != null ? String(input.agentBaseUrl).trim() : active.baseUrl,
      dialect: input.agentApiDialect != null ? input.agentApiDialect : active.dialect,
      models: active.models.slice(), activeModel: active.activeModel, apiKey: active.apiKey
    };
    if (input.agentModel != null) {
      const model = String(input.agentModel).trim();
      patched.activeModel = model;
      if (model && patched.models.indexOf(model) === -1) patched.models = patched.models.concat([model]);
    }
    if (input.agentApiKey) patched.apiKey = encrypt(String(input.agentApiKey));
    return LitAgentCfg.upsertProvider(cfg, patched);
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
    // AI 助手当前生效的服务商（旧配置读取时由扁平字段合成内置服务商，见 js/agentcfg.js）
    const agentCfg = LitAgentCfg.normalizeConfig(raw);
    const agentActive = LitAgentCfg.activeProvider(agentCfg);
    // 向量模型目标解析（唯一权威规则在 js/embedcfg.js）：设置页据此显示「当前用谁的 Key」
    // 与调研库向量是否可用——Key 只判有无，密文不出主进程。AI 助手端点取当前生效服务商。
    const embedTarget = LitEmbedCfg.resolveTarget({
      embedProvider: raw.embedProvider,
      embedBaseUrl: raw.embedBaseUrl,
      embedApiKey: raw.embedApiKey ? 'set' : '',
      embedModel: raw.embedModel,
      agentBaseUrl: agentActive.baseUrl,
      agentApiKey: agentActive.apiKey ? 'set' : ''
    });
    return {
      nutstoreUrl: raw.nutstoreUrl || 'https://dav.jianguoyun.com/dav/',
      nutstoreUser: raw.nutstoreUser || '',
      hasNutstorePassword: !!raw.nutstorePassword,
      nutstoreFolder: normalizeWebDavFolder(raw.nutstoreFolder, 'LitBoard'),
      // 坚果云限流档位：免费版 600 次/30 分钟（默认，按最差情况），专业版 1500
      nutstorePacing: raw.nutstorePacing === 'pro' ? 'pro' : 'free',
      zoteroWebDavFolder: raw.zoteroWebDavFolder || 'zotero',
      zoteroDataDir: raw.zoteroDataDir || '',
      translatorProvider: translators[raw.translatorProvider] ? raw.translatorProvider : DEFAULT_TRANSLATOR,
      translatorModel: String(raw.translatorModel || ''),
      translatorTarget: raw.translatorTarget === 'en' ? 'en' : 'zh',
      hasTranslatorApiKey: !!raw.translatorApiKey,
      translatorApiKeyHint: secretHint(raw.translatorApiKey),
      rankProvider: 'easyscholar' === raw.rankProvider ? 'easyscholar' : 'scigreat',
      hasScigreatApiKey: !!raw.scigreatApiKey,
      scigreatApiKeyHint: secretHint(raw.scigreatApiKey),
      hasEasyscholarApiKey: !!raw.easyscholarApiKey,
      easyscholarApiKeyHint: secretHint(raw.easyscholarApiKey),
      pdfCacheDir: String(raw.pdfCacheDir || '').trim(),
      pdfDownloadDir: String(raw.pdfDownloadDir || '').trim(),
      renameTemplate: String(raw.renameTemplate || ''),
      proxyPrefix: String(raw.proxyPrefix || ''),
      trashRetentionDays: raw.trashRetentionDays == null ? null : Number(raw.trashRetentionDays),
      autoWriteBack: raw.autoWriteBack == null ? null : raw.autoWriteBack === true,
      bibExportPath: String(raw.bibExportPath || '').trim(),
      agentBaseUrl: String(agentActive.baseUrl || '').trim(),
      agentModel: String(agentActive.activeModel || '').trim(),
      // 接口协议：'' = 自动（按 URL 尾段/域名判定），chat | responses | messages 为显式指定
      agentApiDialect: AGENT_DIALECTS.indexOf(agentActive.dialect) >= 0 ? agentActive.dialect : '',
      // 上下文 / 单轮输出预算（token）：0 = 留空，用渲染层默认值（256000 / 12800）
      agentContextTokens: agentTokenBudget(raw.agentContextTokens, AGENT_CONTEXT_TOKENS_MAX),
      agentMaxOutputTokens: agentTokenBudget(raw.agentMaxOutputTokens, AGENT_MAX_OUTPUT_TOKENS_MAX),
      hasAgentApiKey: !!agentActive.apiKey,
      agentApiKeyHint: secretHint(agentActive.apiKey),
      // 「服务商 + 模型」清单（对话面板底部切换用；每项只报 hasApiKey，密文不出主进程）
      agentProviders: publicAgentProviders(agentCfg.providers),
      agentActiveProviderId: agentCfg.activeId,
      // 向量模型（调研库向量专用）：独立 provider / Base URL / API Key / 模型名
      embedProvider: String(raw.embedProvider || '').trim(),
      embedBaseUrl: String(raw.embedBaseUrl || '').trim(),
      embedModel: String(raw.embedModel || '').trim(),
      hasEmbedApiKey: !!raw.embedApiKey,
      embedApiKeyHint: secretHint(raw.embedApiKey),
      embedReady: embedTarget.ok === true,
      embedSource: embedTarget.source,
      openalexEmail: String(raw.openalexEmail || '').trim(),
      hasOpenalexApiKey: !!raw.openalexApiKey,
      openalexApiKeyHint: secretHint(raw.openalexApiKey),
      hasElsevierApiKey: !!raw.elsevierApiKey,
      elsevierApiKeyHint: secretHint(raw.elsevierApiKey),
      hasTinyfishApiKey: !!raw.tinyfishApiKey,
      tinyfishApiKeyHint: secretHint(raw.tinyfishApiKey),
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
      nutstorePacing: input.nutstorePacing === 'pro' || input.nutstorePacing === 'free'
        ? input.nutstorePacing
        : (current.nutstorePacing === 'pro' ? 'pro' : 'free'),
      zoteroWebDavFolder: String(input.zoteroWebDavFolder != null ? input.zoteroWebDavFolder : current.zoteroWebDavFolder || 'zotero')
        .trim().replace(/^\/+|\/+$/g, '') || 'zotero',
      zoteroDataDir: String(input.zoteroDataDir != null ? input.zoteroDataDir : current.zoteroDataDir || '').trim(),
      translatorProvider: translators[input.translatorProvider] ? input.translatorProvider : (translators[current.translatorProvider] ? current.translatorProvider : DEFAULT_TRANSLATOR),
      translatorModel: String(input.translatorModel != null ? input.translatorModel : current.translatorModel || '').trim(),
      translatorTarget: input.translatorTarget != null
        ? (input.translatorTarget === 'en' ? 'en' : 'zh')
        : (current.translatorTarget === 'en' ? 'en' : 'zh'),
      translatorApiKey: input.translatorApiKey ? encrypt(String(input.translatorApiKey)) : current.translatorApiKey || '',
      // 显式提交的合法服务商优先，只有未提交（老渲染层）才沿用现值：
      // 反过来写会让「切回 SciGreat」被静默丢弃（存的一直是 easyscholar，回显也跟着错）
      rankProvider: resolveRankProvider(current, input),
      scigreatApiKey: input.scigreatApiKey ? encrypt(String(input.scigreatApiKey)) : current.scigreatApiKey || '',
      easyscholarApiKey: input.easyscholarApiKey ? encrypt(String(input.easyscholarApiKey)) : current.easyscholarApiKey || '',
      pdfCacheDir: String(input.pdfCacheDir != null ? input.pdfCacheDir : current.pdfCacheDir || '').trim(),
      pdfDownloadDir: String(input.pdfDownloadDir != null ? input.pdfDownloadDir : current.pdfDownloadDir || '').trim(),
      renameTemplate: String(input.renameTemplate != null ? input.renameTemplate : current.renameTemplate || '').trim(),
      proxyPrefix: String(input.proxyPrefix != null ? input.proxyPrefix : current.proxyPrefix || '').trim(),
      trashRetentionDays: input.trashRetentionDays != null ? Math.max(0, Math.min(3650, Number(input.trashRetentionDays) || 0)) : current.trashRetentionDays,
      autoWriteBack: input.autoWriteBack != null ? input.autoWriteBack === true : current.autoWriteBack,
      bibExportPath: String(input.bibExportPath != null ? input.bibExportPath : current.bibExportPath || '').trim(),
      // AI 助手凭据由下面的服务商清单统一承载（扁平字段是它的镜像，不直接接收输入）
      agentContextTokens: input.agentContextTokens != null
        ? agentTokenBudget(input.agentContextTokens, AGENT_CONTEXT_TOKENS_MAX)
        : agentTokenBudget(current.agentContextTokens, AGENT_CONTEXT_TOKENS_MAX),
      agentMaxOutputTokens: input.agentMaxOutputTokens != null
        ? agentTokenBudget(input.agentMaxOutputTokens, AGENT_MAX_OUTPUT_TOKENS_MAX)
        : agentTokenBudget(current.agentMaxOutputTokens, AGENT_MAX_OUTPUT_TOKENS_MAX),
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
    /* AI 助手服务商清单：提交则按 id 合并（Key 语义见 mergeAgentProviders），未提交则保持原样；
       旧契约的扁平字段（老渲染层 / 测试直接提交 agentBaseUrl 等）落到当前生效服务商上。
       最后重算扁平镜像——顺序不能变：镜像必须看到定稿后的 providers 与 activeId。 */
    let agentCfg = LitAgentCfg.normalizeConfig(current);
    if (Array.isArray(input.agentProviders)) {
      agentCfg = { providers: mergeAgentProviders(storedAgentProviders(current), input.agentProviders), activeId: agentCfg.activeId };
    } else {
      agentCfg = applyLegacyAgentFields(agentCfg, input);
    }
    const nextActiveId = input.agentActiveProviderId != null ? String(input.agentActiveProviderId) : agentCfg.activeId;
    next.agentProviders = agentCfg.providers.map(storedShape);
    Object.assign(next, agentMirror(agentCfg.providers, nextActiveId));
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
    } catch (error) { throw new Error('无法解密云端设置，请确认坚果云应用密码与加密时一致'); }
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
      agentProviders: storedAgentProviders(raw).map(function (provider) {
        return Object.assign({}, provider, { apiKey: decrypt(provider.apiKey) });
      }),
      agentActiveProviderId: LitAgentCfg.normalizeConfig(raw).activeId,
      embedProvider: String(raw.embedProvider || ''),
      embedBaseUrl: String(raw.embedBaseUrl || ''),
      embedModel: String(raw.embedModel || ''),
      embedApiKey: decrypt(raw.embedApiKey),
      openalexEmail: String(raw.openalexEmail || ''),
      openalexApiKey: decrypt(raw.openalexApiKey),
      elsevierApiKey: decrypt(raw.elsevierApiKey),
      tinyfishApiKey: decrypt(raw.tinyfishApiKey),
      semanticscholarApiKey: decrypt(raw.semanticscholarApiKey),
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
      agentProviders: Array.isArray(value.agentProviders) ? value.agentProviders : undefined,
      agentActiveProviderId: value.agentActiveProviderId,
      embedProvider: value.embedProvider,
      embedBaseUrl: value.embedBaseUrl,
      embedModel: value.embedModel,
      embedApiKey: value.embedApiKey,
      openalexEmail: value.openalexEmail,
      openalexApiKey: value.openalexApiKey,
      elsevierApiKey: value.elsevierApiKey,
      tinyfishApiKey: value.tinyfishApiKey,
      semanticscholarApiKey: value.semanticscholarApiKey,
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
    const localProviders = new Map(local.agentProviders.map(function (provider) { return [provider.id, provider]; }));
    const remoteProviders = Array.isArray(remote.agentProviders) ? remote.agentProviders : local.agentProviders;
    const mergedProviders = remoteProviders.map(function (provider) {
      const previous = localProviders.get(provider.id);
      return Object.assign({}, provider, { apiKey: provider.apiKey || previous && previous.apiKey || '' });
    });
    const merged = Object.assign({}, remote, {
      translatorApiKey: remote.translatorApiKey || local.translatorApiKey,
      scigreatApiKey: remote.scigreatApiKey || local.scigreatApiKey,
      easyscholarApiKey: remote.easyscholarApiKey || local.easyscholarApiKey,
      agentProviders: mergedProviders,
      agentActiveProviderId: remote.agentActiveProviderId || local.agentActiveProviderId,
      embedProvider: remote.embedProvider != null ? remote.embedProvider : local.embedProvider,
      embedBaseUrl: remote.embedBaseUrl != null ? remote.embedBaseUrl : local.embedBaseUrl,
      embedModel: remote.embedModel != null ? remote.embedModel : local.embedModel,
      embedApiKey: remote.embedApiKey || local.embedApiKey,
      openalexEmail: remote.openalexEmail != null ? remote.openalexEmail : local.openalexEmail,
      openalexApiKey: remote.openalexApiKey || local.openalexApiKey,
      elsevierApiKey: remote.elsevierApiKey || local.elsevierApiKey,
      tinyfishApiKey: remote.tinyfishApiKey || local.tinyfishApiKey,
      semanticscholarApiKey: remote.semanticscholarApiKey || local.semanticscholarApiKey,
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
      embedProvider: String(merged.embedProvider || ''),
      embedBaseUrl: String(merged.embedBaseUrl || ''),
      embedModel: String(merged.embedModel || ''),
      embedApiKey: storedKey(merged.embedApiKey, raw.embedApiKey || ''),
      openalexEmail: String(merged.openalexEmail || ''),
      openalexApiKey: storedKey(merged.openalexApiKey, raw.openalexApiKey || ''),
      elsevierApiKey: storedKey(merged.elsevierApiKey, raw.elsevierApiKey || ''),
      tinyfishApiKey: storedKey(merged.tinyfishApiKey, raw.tinyfishApiKey || ''),
      semanticscholarApiKey: storedKey(merged.semanticscholarApiKey, raw.semanticscholarApiKey || ''),
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
    next.agentProviders = merged.agentProviders.map(function (provider) {
      const current = storedAgentProviders(raw).find(function (item) { return item.id === provider.id; });
      return storedShape(Object.assign({}, provider, { apiKey: storedKey(provider.apiKey, current && current.apiKey) }));
    });
    Object.assign(next, agentMirror(next.agentProviders, merged.agentActiveProviderId));
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
      super(message || '云端文件在同步期间发生变化，请重新读取后重试');
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
      throw new RemoteChangedError('云端文件已被其他设备修改，请重新生成同步计划', url);
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
    const password = settings.passwordOverride || decrypt(rawConfig.nutstorePassword);
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
        if (latestText !== remoteText) throw new RemoteChangedError('云端配置已被其他设备修改，请重新同步', configFileUrl);
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
    if (!apiKey) throw new Error('请先在 设置 → 集成与服务 中填写划词翻译凭据');
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
    if (!apiKey) throw new Error('请先在 设置 → 集成与服务 中填写 SciGreat API Key');
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
  const SYNC_HISTORY_DIR = path.join(options.baseDir, 'sync-history');
  /** 对照弹窗里「本机为空疑似重置」总体决议的键（渲染层同名常量保持一致） */
  const LOCAL_EMPTY_RESET_KEY = 'plan:local-empty-reset';
  /** 「合并会大批移除云端词条」与「云端无库将首次上传」两个强制确认项的键 */
  const MASS_DROP_RESET_KEY = 'plan:mass-drop-reset';
  const FIRST_UPLOAD_KEY = 'plan:first-upload';

  /** 一次同步会话的全部状态：附件台账（含限流 pacing 持久化）、本会话已核实
   *  的云端对象名集合、云端备份链的会话级去重。nutstoreSyncOnce 与
   *  applyNutstoreSyncPlan 各建一个，贯穿库写入与附件同步。 */
  async function createSyncSession(remoteOptions) {
    const ledger = await loadAssetLedger(remoteOptions);
    const session = {
      ledger: ledger,
      verifiedNames: new Set(),
      backupsDone: new Set(),
      madeBackupDirs: new Set(),
      pacer: null
    };
    if (options.pacing) {
      const inject = typeof options.pacing === 'object' ? options.pacing : {};
      session.pacer = createRequestPacer(Object.assign({
        profile: remoteOptions.pacing,
        loadState: async function () { return ledger.pacing; },
        saveState: async function (value) {
          ledger.pacing = value;
          try { await saveAssetLedger(ledger); } catch (error) {}
        }
      }, inject));
    }
    return session;
  }

  /** 限流暂停 → 软结果：不当作同步失败抛给渲染层，而是带上恢复时刻与说明，
   *  由渲染层展示状态并调度自动续传。 */
  function pausedSyncResult(error, workspace) {
    const retryAfter = Number(error && error.retryAfter) || 0;
    const resumeAt = Number(error && error.resumeAt) ||
      Date.now() + (retryAfter > 0 ? retryAfter * 1000 : 30 * 60 * 1000);
    return { paused: true, resumeAt: resumeAt, message: error && error.message || '同步已因限流暂停',
      workspace: workspace || null, uploaded: false };
  }

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

  const PROPFIND_BODY = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/></d:prop></d:propfind>';
  const PROPFIND_PAGE_SIZE = 750; // 坚果云单次列目录上限，超出需按 Range: rows=a-b 翻页

  function parsePropfindNames(body, attachmentsUrl, verifyListing) {
    const entries = parsePropfindEntries(body, attachmentsUrl, verifyListing);
    return entries === null ? null : new Set(entries.keys());
  }

  /** 按 <response> 块解析 href→getetag 映射。返回 null 表示清单含失败条目或
   *  无法解析（verifyListing 语义与 parsePropfindNames 一致）；getetag 缺失的
   *  条目记为空串（部分服务端不给集合/文件返回 ETag）。 */
  function parsePropfindEntries(body, attachmentsUrl, verifyListing) {
    if (verifyListing) {
      // A DAV href alone is not proof of existence: a multistatus can contain failed entries.
      const blocks = body.match(/<(?:[A-Za-z_][\w.-]*:)?response\b[^>]*>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?response>/gi);
      if (!blocks) return null;
      const confirmed = [];
      for (const entry of blocks) {
        const statuses = Array.from(entry.matchAll(/<(?:[A-Za-z_][\w.-]*:)?status\b[^>]*>\s*HTTP\/[^ ]+\s+(\d{3})/gi), function (match) { return Number(match[1]); });
        if (statuses.some(function (status) { return status >= 200 && status < 300; })) confirmed.push(entry);
        else if (!statuses.length || statuses.some(function (status) { return status !== 404; })) return null;
      }
      body = confirmed.join('');
    }

    const baseUrl = new URL(attachmentsUrl.replace(/\/+$/, '') + '/');
    const basePath = baseUrl.pathname;
    const entriesMap = new Map();
    const responsePattern = /<(?:[A-Za-z_][\w.-]*:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?response>/gi;
    const hrefPattern = /<(?:[A-Za-z_][\w.-]*:)?href\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?href>/i;
    const etagPattern = /<(?:[A-Za-z_][\w.-]*:)?getetag\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?getetag>/i;
    let block;
    while ((block = responsePattern.exec(body))) {
      const href = hrefPattern.exec(block[1]);
      if (!href) continue;
      let target;
      try { target = new URL(xmlText(href[1]).trim(), baseUrl); } catch (error) { continue; }
      if (target.origin !== baseUrl.origin || target.pathname.indexOf(basePath) !== 0) continue;
      let relative = target.pathname.slice(basePath.length);
      try { relative = decodeURIComponent(relative); } catch (error) { continue; }
      if (!relative || relative.endsWith('/')) continue;
      const name = safeCloudName(relative);
      if (!name) continue;
      const etagMatch = etagPattern.exec(block[1]);
      entriesMap.set(name, etagMatch ? xmlText(etagMatch[1]).trim() : '');
    }
    return entriesMap;
  }

  /** 真实列出云端 attachments/ 下的对象名（分页）。返回：
   *  Set —— 实际清单；null —— 服务器不支持该 PROPFIND（403/405/501）。 */
  async function listRemoteAssetNames(remoteOptions, verifyListing) {
    const names = new Set();
    for (let page = 0; page < 40; page++) {
      const start = page * PROPFIND_PAGE_SIZE;
      const response = await request(remoteOptions.attachmentsUrl, {
        method: 'PROPFIND',
        headers: Object.assign({
          Depth: 'infinity', 'Content-Type': 'application/xml; charset=utf-8',
          Range: 'rows=' + start + '-' + (start + PROPFIND_PAGE_SIZE - 1)
        }, remoteOptions.headers),
        body: PROPFIND_BODY
      });
      throwIfWebDavRateLimited(response);
      if (response.status === 404 || response.status === 409) return verifyListing && page > 0 ? null : names;
      // 部分 WebDAV 服务不支持 Depth:infinity；此时回退到库 JSON 登记名（见调用方）。
      if (response.status === 403 || response.status === 405 || response.status === 501) return null;
      if (!response.ok) throw new Error('坚果云附件清单读取失败（' + response.status + '）');
      const pageBody = await response.text();
      const pageNames = parsePropfindNames(pageBody, remoteOptions.attachmentsUrl, verifyListing);
      if (pageNames === null) return null;
      let fresh = 0;
      pageNames.forEach(function (name) { if (!names.has(name)) { names.add(name); fresh++; } });
      // 不足一页 = 最后一页；fresh=0 = 服务器忽略 Range 一次性给全（或分页停滞）
      const entries = verifyListing ? (pageBody.match(/<(?:[A-Za-z_][\w.-]*:)?response\b/gi) || []).length : pageNames.size;
      if (entries < PROPFIND_PAGE_SIZE) return names;
      if (fresh === 0) return verifyListing ? null : names;
    }
    return verifyListing ? null : names;
  }

  /** 与 listRemoteAssetNames 同一遍分页 PROPFIND，但收集 name→getetag 映射。
   *  坚果云 HEAD 不返回 ETag，归档前的文件版本核对只能靠清单属性（或回退逐文件
   *  GET/HEAD，见调用方）。返回 null 语义同上。 */
  async function listRemoteAssetEtags(remoteOptions, verifyListing) {
    const entriesMap = new Map();
    for (let page = 0; page < 40; page++) {
      const start = page * PROPFIND_PAGE_SIZE;
      const response = await request(remoteOptions.attachmentsUrl, {
        method: 'PROPFIND',
        headers: Object.assign({
          Depth: 'infinity', 'Content-Type': 'application/xml; charset=utf-8',
          Range: 'rows=' + start + '-' + (start + PROPFIND_PAGE_SIZE - 1)
        }, remoteOptions.headers),
        body: PROPFIND_BODY
      });
      throwIfWebDavRateLimited(response);
      if (response.status === 404 || response.status === 409) return verifyListing && page > 0 ? null : entriesMap;
      if (response.status === 403 || response.status === 405 || response.status === 501) return null;
      if (!response.ok) throw new Error('坚果云附件清单读取失败（' + response.status + '）');
      const pageBody = await response.text();
      const pageEntries = parsePropfindEntries(pageBody, remoteOptions.attachmentsUrl, verifyListing);
      if (pageEntries === null) return null;
      let fresh = 0;
      pageEntries.forEach(function (etag, name) { if (!entriesMap.has(name)) { entriesMap.set(name, etag); fresh++; } });
      const entries = verifyListing ? (pageBody.match(/<(?:[A-Za-z_][\w.-]*:)?response\b/gi) || []).length : pageEntries.size;
      if (entries < PROPFIND_PAGE_SIZE) return entriesMap;
      if (fresh === 0) return verifyListing ? null : entriesMap;
    }
    return verifyListing ? null : entriesMap;
  }

  /** 本会话的云端对象存在性证据。库 JSON 里的 cloudName 登记绝不能当存在性
   *  证明使用（正是「假元数据自证已上传、永不重传」事故的根源）：只要两侧
   *  出现任何登记名就做一次真实 PROPFIND。服务器不支持清单时退回登记名集合
   *  （此时不做写前净化，见 sanitizeCloudAssets）。 */
  async function resolveRemoteAssetNames(remoteWorkspace, localWorkspace, remoteOptions, onScan) {
    const names = remoteAssetNames(remoteWorkspace);
    if (!names.size && !remoteAssetNames(localWorkspace).size) return new Set();
    if (onScan) onScan();
    const listed = await listRemoteAssetNames(remoteOptions);
    return listed === null ? names : listed;
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
    if (!user || !password) throw new Error('请先配置坚果云账号和应用密码');
    const folderUrl = joinUrl(url, folderName);
    return {
      raw: raw,
      url: url,
      folderName: folderName,
      user: user,
      password: password,
      configPassword: password,
      headers: { Authorization: basicAuth(user, password) },
      folderUrl: folderUrl,
      fileUrl: joinUrl(folderUrl, 'litboard-library.json'),
      attachmentsUrl: joinUrl(folderUrl, 'attachments'),
      pacing: (supplied.nutstorePacing != null ? supplied.nutstorePacing : raw.nutstorePacing) === 'pro' ? 'pro' : 'free'
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
    await archiveLocalLibrary(remote);
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
    const error = new Error('云端写入后校验失败：坚果云未返回刚刚写入的文献库，请检查云端目录或稍后重试');
    error.code = 'REMOTE_WRITE_VERIFY_FAILED';
    error.remote = actual;
    throw error;
  }

  /** 本地留档：每次读到的云端库内容按内容寻址存进 sync-history/（同内容只存
   *  一份，写后校验的重复读取零成本），保留最近 20 份。覆盖云端前的最后一道
   *  保险——事故后可从数据目录直接取回任意历史版本的库 JSON。 */
  async function archiveLocalLibrary(remoteValue) {
    if (!remoteValue || typeof remoteValue !== 'object') return true;
    try {
      await fs.mkdir(SYNC_HISTORY_DIR, { recursive: true });
      const digest = crypto.createHash('sha256').update(JSON.stringify(remoteValue)).digest('hex').slice(0, 16);
      const file = path.join(SYNC_HISTORY_DIR, 'library-' + digest + '.json');
      try { await fs.access(file); } catch (error) {
        await fs.writeFile(file, JSON.stringify(remoteValue, null, 2), 'utf8');
      }
      const entries = await fs.readdir(SYNC_HISTORY_DIR);
      const archives = [];
      for (const name of entries) {
        if (!/^library-[0-9a-f]{16}\.json$/.test(name)) continue;
        try { archives.push({ name: name, mtimeMs: (await fs.stat(path.join(SYNC_HISTORY_DIR, name))).mtimeMs }); } catch (error) {}
      }
      archives.sort(function (a, b) { return b.mtimeMs - a.mtimeMs; });
      for (let i = 20; i < archives.length; i++) {
        await fs.rm(path.join(SYNC_HISTORY_DIR, archives[i].name), { force: true }).catch(function () {});
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  const REMOTE_BACKUP_KEEP = 5;
  const REMOTE_BACKUP_PRUNE_AT = 8;

  /** 云端备份链：覆盖 litboard-library.json 之前，把现有内容 COPY 到
   *  backups/library-{时间戳}.json（WebDAV COPY 不可用时 GET+PUT 兜底），保留
   *  最近 5 份、超过 8 份才清理（DELETE 也消耗请求配额，不必每次都删）。
   *  云端备份尽力而为（失败不阻断同步），但本地 sync-history 留档必须成功。 */
  async function backupCloudLibrary(remoteOptions, baseline, session) {
    if (!(await archiveLocalLibrary(baseline.remote))) {
      throw new Error('无法在本地留存云端库备份（sync-history 写入失败），已中止覆盖写入');
    }
    const backupsUrl = joinUrl(remoteOptions.folderUrl, 'backups');
    try {
      if (!session.madeBackupDirs.has(backupsUrl)) {
        const mkcol = await request(backupsUrl, { method: 'MKCOL', headers: remoteOptions.headers });
        throwIfWebDavRateLimited(mkcol);
        if (!mkcol.ok && mkcol.status !== 405) throw new Error('HTTP ' + mkcol.status);
        session.madeBackupDirs.add(backupsUrl);
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = 'library-' + stamp + '.json';
      const destination = new URL(joinUrl(backupsUrl, backupName));
      const copy = await request(remoteOptions.fileUrl, {
        method: 'COPY',
        headers: Object.assign({ Destination: destination.href, Overwrite: 'T' }, remoteOptions.headers)
      });
      throwIfWebDavRateLimited(copy);
      if (!copy.ok && copy.status !== 404) {
        // 服务器不支持 COPY：GET+PUT 兜底复制一份
        const current = await readRemoteLibrary(remoteOptions);
        if (current.exists) {
          const put = await request(joinUrl(backupsUrl, backupName), {
            method: 'PUT',
            headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, remoteOptions.headers),
            body: JSON.stringify(current.remote, null, 2)
          });
          throwIfWebDavRateLimited(put);
          if (!put.ok) throw new Error('HTTP ' + put.status);
        }
      }
      await pruneRemoteBackups(remoteOptions, backupsUrl);
    } catch (error) {
      if (error && (error.code === 'WEBDAV_RATE_LIMITED' || error.code === 'SYNC_CANCELLED' || error.code === 'SYNC_RATE_PAUSED')) throw error;
      // 云端备份失败不阻断同步：本地 sync-history 已有同一份内容的留档。
    }
  }

  async function pruneRemoteBackups(remoteOptions, backupsUrl) {
    const response = await request(backupsUrl, {
      method: 'PROPFIND',
      headers: Object.assign({ Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, remoteOptions.headers),
      body: PROPFIND_BODY
    });
    throwIfWebDavRateLimited(response);
    if (!response.ok) return; // 看不见清单就不删，宁可多留
    const body = await response.text();
    const baseUrl = new URL(backupsUrl.replace(/\/+$/, '') + '/');
    const names = [];
    const hrefPattern = /<(?:[A-Za-z_][\w.-]*:)?href\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?href>/gi;
    let match;
    while ((match = hrefPattern.exec(body))) {
      let target;
      try { target = new URL(xmlText(match[1]).trim(), baseUrl); } catch (error) { continue; }
      const name = decodeURIComponent(target.pathname.slice(baseUrl.pathname.length));
      if (/^library-\d{4}-\d{2}-\d{2}T[\w-]+\.json$/.test(name)) names.push(name);
    }
    if (names.length <= REMOTE_BACKUP_PRUNE_AT) return;
    names.sort().reverse(); // 时间戳命名：字典序倒序 = 新在前
    for (let i = REMOTE_BACKUP_KEEP; i < names.length; i++) {
      const del = await request(joinUrl(backupsUrl, names[i]), { method: 'DELETE', headers: remoteOptions.headers });
      throwIfWebDavRateLimited(del);
      if (!del.ok && del.status !== 404) return; // 删除异常就停，下次再清
    }
  }

  async function writeCloudLibrary(remoteOptions, workspace, baseline, reportProgress, session) {
    const sameContent = hashWorkspace(workspace) === hashWorkspace(baseline.remote);
    const currentVersion = Number(baseline.remote && baseline.remote.syncVersion) >= LitSync.SYNC_VERSION;
    if (baseline.exists && sameContent && currentVersion) return { current: baseline, uploaded: false };
    if (baseline.exists && !baseline.etag) {
      const latest = await readRemoteLibrary(remoteOptions);
      if (!latest.exists || hashWorkspace(latest.remote) !== hashWorkspace(baseline.remote)) {
        throw new RemoteChangedError('云端内容已变化，请重新生成同步计划', remoteOptions.fileUrl);
      }
    }
    throwIfSyncCancelled();
    // 覆盖已有云端库之前先留档（同一会话同一份内容只备份一次）：
    if (baseline.exists && session) {
      const contentKey = hashWorkspace(baseline.remote);
      if (!session.backupsDone.has(contentKey)) {
        await backupCloudLibrary(remoteOptions, baseline, session);
        session.backupsDone.add(contentKey);
      }
    }
    reportProgress('upload', '正在写入云端库…');
    const payload = LitSync.createSyncEnvelope(workspace);
    await conditionalPut(remoteOptions.fileUrl, JSON.stringify(payload, null, 2), remoteOptions.headers,
      baseline.etag, { contentType: 'application/json; charset=utf-8', label: '坚果云写入',
        conditional: baseline.exists, createOnly: !baseline.exists });
    reportProgress('verify-write', '正在确认云端写入结果…');
    const verified = await verifyRemoteLibraryWrite(remoteOptions, workspace);
    return { current: verified, uploaded: true };
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

  function assetTarget(paper, asset, snapshot) {
    const paperId = String(paper && paper.id || 'paper').replace(/[^A-Za-z0-9_-]/g, '_');
    const assetId = String(asset && (asset.id || asset.cloudName) || 'asset').replace(/[^A-Za-z0-9_-]/g, '_');
    const ext = assetExtension(asset && (asset.fileName || asset.cloudName), snapshot ? '.png' : '.pdf');
    return path.join(itemAttachmentDir(options.baseDir, paperId),
      snapshot ? 'snapshot.' + assetId + ext : assetId + ext);
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
    // 本会话「上传成功 / 下载核实 / 签名免读核实」的云端对象名：写云端库 JSON 时
    // 只有这些（或真实清单确认存在）的附件元数据才允许保留（sanitizeCloudAssets）。
    const verifiedNames = config.verifiedNames instanceof Set ? config.verifiedNames : new Set();
    const missingRemotely = function (cloudName) {
      return !!knownRemoteAssets && !knownRemoteAssets.has(cloudName);
    };
    await fs.mkdir(downloadDir, { recursive: true });
    // 附件上传台账：记住哪些云端对象已成功 PUT 过，同步中断后下一轮续传。
    // 会话已带台账（限流 pacing 状态也在里面）时直接复用，避免重复读盘。
    const assetLedger = config.ledger || await loadAssetLedger(remoteOptions);
    const noteLedger = async function (cloudName, hash, size) {
      recordAssetLedger(assetLedger, cloudName, hash, size);
      try { await saveAssetLedger(assetLedger); } catch (error) {}
    };
    let uploaded = 0, downloaded = 0, verified = 0;
    let pendingUpload = 0, missingOnCloud = 0;
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
        if (error && (error.code === 'WEBDAV_RATE_LIMITED' || error.code === 'SYNC_CANCELLED' || error.code === 'SYNC_RATE_PAUSED')) throw error;
        throw assetError('附件上传失败：' + (error && error.message || error), item, error);
      }
      // 对象先行不变式：PUT 返回 2xx 之后才把 cloudName/hash/size 写进词条。
      // 失败时云端库 JSON 不留下任何「已上传」的假元数据（旧实现先写名字，
      // 失败后悬空，其他设备只能 404）。
      asset.cloudName = cloudName;
      asset.cloudHash = actualHash;
      asset.cloudSize = body.length;
      verifiedNames.add(cloudName);
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
            verifiedNames.add(cloudName);
            verified++;
            return;
          }
          const body = await fs.readFile(localPath);
          const actualHash = await hashBuffer(body);
          cloudName = cloudName || (isSnapshot ? 'snapshots/' + paper.id + '/' + asset.id + '.png' :
            (asset.id === primaryId ? paper.id + '.pdf' : paper.id + '/' + asset.id + assetExtension(asset.fileName, '.pdf')));
          if (!cloudName) throw new Error('云端文件名无效');
          const expectedHash = String(asset.cloudHash || '').toLowerCase();
          const expectedSize = asset.cloudSize == null ? null : Number(asset.cloudSize);
          if ((missingRemotely(cloudName) || !expectedHash || expectedHash !== actualHash || expectedSize != null && expectedSize !== body.length) &&
              !assetLedgerProof(assetLedger, cloudName, actualHash, body.length, knownRemoteAssets)) {
            await uploadAsset(asset, body, actualHash, cloudName, item);
          } else {
            asset.cloudName = cloudName;
            asset.cloudHash = actualHash;
            asset.cloudSize = body.length;
            verifiedNames.add(cloudName);
            verified++;
          }
          if (!isSnapshot) asset.syncSignature = assetLocalSignature(stat, asset.cloudHash);
          return;
        } catch (error) {
          if (error && (error.code === 'WEBDAV_RATE_LIMITED' || error.code === 'SYNC_CANCELLED' || error.code === 'SYNC_RATE_PAUSED')) throw error;
          if (error && error.item) {
            failures.push(error);
            pendingUpload++;
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
      if (!cloudName) {
        // 本机没有文件、云端也没有登记：源设备的上传还没成功过，计入「云端缺失」
        // 报告而不是静默跳过——这正是「词条在、PDF 不在」假象的可见化。
        missingOnCloud++;
        return;
      }
      asset.cloudName = cloudName;
      const target = assetTarget(paper, asset, isSnapshot);
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
        verifiedNames.add(cloudName);
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
        verifiedNames.add(cloudName);
        await noteLedger(cloudName, result.hash, result.size);
        if (!asset.fileName && !isSnapshot) asset.fileName = path.posix.basename(cloudName);
        downloaded++;
      } catch (error) {
        if (error && (error.code === 'WEBDAV_RATE_LIMITED' || error.code === 'SYNC_CANCELLED' || error.code === 'SYNC_RATE_PAUSED')) throw error;
        failures.push(error && error.item ? error : assetError(error.message || '附件下载失败', item, error));
        missingOnCloud++;
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
        if (error && (error.code === 'WEBDAV_RATE_LIMITED' || error.code === 'SYNC_CANCELLED' || error.code === 'SYNC_RATE_PAUSED')) throw error;
        throw assetError('附件上传失败：' + (error && error.message || error), item, error);
      }
      // 对象先行：PUT 2xx 之后才写 cloudName/hash/size（与 uploadAsset 同款不变式）
      asset.cloudName = cloudName;
      asset.cloudHash = actualHash;
      asset.cloudSize = body.length;
      verifiedNames.add(cloudName);
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
            verifiedNames.add(cloudName);
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
          const zip = await zipStoreEntries(entries);
          const actualHash = await hashBuffer(zip);
          if ((missingRemotely(cloudName) || String(asset.cloudHash || '').toLowerCase() !== actualHash ||
              (asset.cloudSize != null && Number(asset.cloudSize) !== zip.length)) &&
              !assetLedgerProof(assetLedger, cloudName, actualHash, zip.length, knownRemoteAssets)) {
            await uploadBuffer(asset, zip, cloudName, item);
          } else {
            asset.cloudName = cloudName;
            asset.cloudHash = actualHash;
            asset.cloudSize = zip.length;
            verifiedNames.add(cloudName);
            verified++;
          }
          asset.syncSignature = listingSig + ':' + String(asset.cloudHash || '').toLowerCase();
          return;
        } catch (error) {
          if (error && (error.code === 'WEBDAV_RATE_LIMITED' || error.code === 'SYNC_CANCELLED' || error.code === 'SYNC_RATE_PAUSED')) throw error;
          if (error && error.item) {
            failures.push(error);
            pendingUpload++;
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
      const targetDir = path.join(itemAttachmentDir(options.baseDir, paperId), assetId + '.snapshot');
      try {
        const stat = await fs.stat(targetDir);
        if (stat.isDirectory() && asset.cloudHash) { asset.path = targetDir; verifiedNames.add(cloudName); verified++; return; }
      } catch (error) {}
      try {
        const response = await request(joinUrl(remoteOptions.attachmentsUrl, cloudName), { method: 'GET', headers: remoteOptions.headers });
        throwIfWebDavRateLimited(response);
        if (!response.ok) throw assetError('快照下载失败（' + response.status + '）', item);
        const body = Buffer.from(await response.arrayBuffer());
        const snapshotHash = await hashBuffer(body);
        const expectedHash = String(asset.cloudHash || '').toLowerCase();
        if (expectedHash && snapshotHash !== expectedHash) throw assetError('快照校验失败（SHA-256 不匹配）', item);
        const files = await extractZipAll(body);
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
        verifiedNames.add(cloudName);
        await noteLedger(cloudName, snapshotHash, body.length);
        downloaded++;
      } catch (error) {
        if (error && (error.code === 'WEBDAV_RATE_LIMITED' || error.code === 'SYNC_CANCELLED' || error.code === 'SYNC_RATE_PAUSED')) throw error;
        failures.push(error && error.item ? error : assetError(error.message || '快照下载失败', item, error));
        missingOnCloud++;
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
          if ((missingRemotely(cloudName) || String(asset.cloudHash || '').toLowerCase() !== actualHash ||
              (asset.cloudSize != null && Number(asset.cloudSize) !== body.length)) &&
              !assetLedgerProof(assetLedger, cloudName, actualHash, body.length, knownRemoteAssets)) {
            await uploadBuffer(asset, body, cloudName, item);
          } else {
            asset.cloudName = cloudName;
            asset.cloudHash = actualHash;
            asset.cloudSize = body.length;
            verifiedNames.add(cloudName);
            verified++;
          }
          return;
        } catch (error) {
          if (error && (error.code === 'WEBDAV_RATE_LIMITED' || error.code === 'SYNC_CANCELLED' || error.code === 'SYNC_RATE_PAUSED')) throw error;
          if (error && error.item) {
            failures.push(error);
            pendingUpload++;
            return;
          }
          if (!asset.cloudName) return;
        }
      }
      cloudName = cloudName || safeCloudName(asset.cloudName);
      if (!cloudName) {
        missingOnCloud++;
        return;
      }
      asset.cloudName = cloudName;
      const target = path.join(noteAssetsDir, note.id, safeName);
      const expectedHash = String(asset.cloudHash || '').toLowerCase();
      const expectedSize = asset.cloudSize == null ? null : Number(asset.cloudSize);
      try {
        const body = await fs.readFile(target);
        if (expectedHash && (await hashBuffer(body)) === expectedHash &&
            (expectedSize == null || body.length === expectedSize)) {
          asset.path = target;
          verifiedNames.add(cloudName);
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
        verifiedNames.add(cloudName);
        await noteLedger(cloudName, result.hash, result.size);
        downloaded++;
      } catch (error) {
        if (error && (error.code === 'WEBDAV_RATE_LIMITED' || error.code === 'SYNC_CANCELLED' || error.code === 'SYNC_RATE_PAUSED')) throw error;
        failures.push(error && error.item ? error : assetError(error.message || '笔记资产下载失败', item, error));
        missingOnCloud++;
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
      throwIfSyncCancelled();
      if (paper && paper.deletedAt) continue;
      if (skipped('papers', paper.id)) continue;
      const attachments = Array.isArray(paper.attachments) ? paper.attachments : [];
      const primary = attachments.find(function (asset) { return asset.kind === 'pdf'; });
      for (const asset of attachments) {
        throwIfSyncCancelled();
        beginAsset(asset);
        if (asset && asset.kind === 'snapshot') await processSnapshotDir(paper, asset);
        else await processAsset(paper, asset, false, primary && primary.id);
        tickAsset(asset);
      }
      const annotations = Array.isArray(paper.pdfAnnotations) ? paper.pdfAnnotations : [];
      for (const annotation of annotations) {
        throwIfSyncCancelled();
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
      throwIfSyncCancelled();
      if (!note || note.deletedAt) continue;
      if (skipped('notes', note.id)) continue;
      for (const noteAsset of Array.isArray(note.assets) ? note.assets : []) {
        throwIfSyncCancelled();
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
    return {
      uploaded: uploaded, downloaded: downloaded, verified: verified, failures: failures,
      // 面向 UI 的诚实状态：待上传（本机有文件但没传上去，续传队列）与
      // 云端缺失（登记悬空或源设备尚未传成，本机无从下载）分开计数。
      pendingUpload: pendingUpload, missingOnCloud: missingOnCloud, verifiedNames: verifiedNames
    };
  }

  /** 云端写入前的附件元数据净化（对象先行不变式的写侧执行）：
   *  verifiedNames（本会话上传/核实成功）∪ 真实远端清单之外的 cloudName 一律
   *  剥离，云端库 JSON 不留下「词条声称有附件但对象不存在」的悬空登记。
   *  返回净化后的深拷贝（绝不原地改动合并结果）；knownRemoteAssets 为 null
   *  （服务器不支持清单）时不净化，维持旧语义。 */
  function sanitizeCloudAssets(workspace, verifiedNames, knownRemoteAssets) {
    if (!knownRemoteAssets) return { workspace: workspace, stripped: 0 };
    const out = cloneJson(workspace);
    const verified = verifiedNames instanceof Set ? verifiedNames : new Set();
    let stripped = 0;
    const visit = function (asset) {
      if (!asset) return;
      const name = safeCloudName(asset.cloudName);
      if (name && !verified.has(name) && !knownRemoteAssets.has(name)) {
        delete asset.cloudName;
        delete asset.cloudHash;
        delete asset.cloudSize;
        stripped++;
      }
    };
    (Array.isArray(out.papers) ? out.papers : []).forEach(function (paper) {
      if (!paper) return;
      (Array.isArray(paper.attachments) ? paper.attachments : []).forEach(visit);
      (Array.isArray(paper.pdfAnnotations) ? paper.pdfAnnotations : []).forEach(function (annotation) {
        if (annotation && annotation.type === 'snapshot') visit(annotation);
      });
    });
    (Array.isArray(out.notes) ? out.notes : []).forEach(function (note) {
      if (note) (Array.isArray(note.assets) ? note.assets : []).forEach(visit);
    });
    return { workspace: out, stripped: stripped };
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
    if (input && input.verifyAssets) remoteOptions.headers['Cache-Control'] = 'no-cache';
    const library = input && input._library ? input._library : await readRemoteLibrary(remoteOptions);
    const configPassword = remoteOptions.configPassword;
    const remoteConfig = configPassword
      ? await readRemoteConfig(remoteOptions.folderUrl, remoteOptions.headers, configPassword, { publicOnly: true })
      : { exists: false, locked: false, etag: '', value: null, pathConflict: false };
    const remote = library.remote || { papers: [], folders: [] };
    const papers = (Array.isArray(remote.papers) ? remote.papers : []).filter(function (paper) { return paper && !paper.deletedAt; });
    const attachments = papers.flatMap(function (paper) { return (Array.isArray(paper.attachments) ? paper.attachments : []).filter(Boolean); });
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
    (Array.isArray(remote.notes) ? remote.notes : []).forEach(function (note) {
      if (!note || note.deletedAt || (note.paperId && !papers.some(function (paper) { return paper.id === note.paperId; }))) return;
      (Array.isArray(note.assets) ? note.assets : []).forEach(function (asset) {
        if (asset && asset.cloudName) assets.push({ type: 'noteAsset', paperId: note.paperId || '', id: note.id,
          cloudName: asset.cloudName, hash: asset.cloudHash || '', size: asset.cloudSize == null ? null : Number(asset.cloudSize) });
      });
    });
    // 对账（_skipAudit 的调用方——同步计划流程——稍后会自行列清单，跳过以免重复）：
    // 真实 PROPFIND 云端对象 vs 库 JSON 登记。「词条声称有附件但云端没有对象」
    // 正是历史事故里 210 篇 PDF「看起来已同步、实际从未上传」的缺口，必须可见。
    const names = new Set(assets.filter(function (asset) { return asset.type === 'attachment'; }).map(function (asset) { return asset.cloudName; }));
    const assetCheck = { registered: names.size, existing: null, missing: null,
      unregistered: attachments.filter(function (asset) { return !asset.cloudName; }).length };
    let audit = null;
    if (!input || !input._skipAudit) {
      const claimed = new Set(assets.map(function (item) { return item.cloudName; }));
      let actual = null;
      try { actual = await listRemoteAssetNames(remoteOptions, !!(input && input.verifyAssets)); } catch (error) {}
      if (actual) {
        assetCheck.existing = Array.from(names).filter(function (name) { return actual.has(name); }).length;
        assetCheck.missing = names.size - assetCheck.existing;
        const missing = [];
        const orphans = [];
        claimed.forEach(function (name) { if (!actual.has(name)) missing.push(name); });
        actual.forEach(function (name) { if (!claimed.has(name)) orphans.push(name); });
        audit = {
          supported: true,
          claimedCount: claimed.size,
          actualCount: actual.size,
          missingCount: missing.length,
          orphanCount: orphans.length,
          missing: missing.slice(0, 50),
          orphans: orphans.slice(0, 50)
        };
      } else {
        audit = { supported: false };
      }
    }
    return {
      ok: true,
      checkedAt: Date.now(),
      assetCheck: assetCheck,
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
        folders: (Array.isArray(remote.folders) ? remote.folders : []).filter(function (item) { return item && !item.deletedAt; }).length,
        savedSearches: (Array.isArray(remote.savedSearches) ? remote.savedSearches : []).filter(function (item) { return item && !item.deletedAt; }).length,
        attachments: attachments.length,
        pdfs: attachments.filter(function (item) { return item.kind === 'pdf'; }).length,
        webSnapshots: attachments.filter(function (item) { return item.kind === 'snapshot'; }).length,
        snapshots: assets.filter(function (item) { return item.type === 'snapshot'; }).length
      },
      assets: assets,
      audit: audit,
      syncVersion: Number(remote.syncVersion) || 0,
      configVersion: remoteConfig.value ? Number(remoteConfig.value.version) || 1 : null
    };
  }

  function planConflictId(conflict, index) {
    return String(conflict && conflict.conflictId || (conflict && conflict.field ? conflict.id + ':' + conflict.field : conflict && conflict.id || 'conflict-' + index));
  }

  async function createNutstoreSyncPlan(input) {
    const value = input && typeof input === 'object' ? input : {};
    if (value.mode === 'mirror') return runSyncTask(function () { return cloudMirror.create(value); });
    const remoteOptions = await resolveNutstoreOptions(value);
    // 计划流程随后会自行做真实 PROPFIND（resolveRemoteAssetNames），这里跳过
    // inspect 的对账扫描，避免一次会话列两遍附件清单。
    const inspected = await inspectNutstoreRemote(Object.assign({}, value, { _skipAudit: true }));
    const localValue = value.workspace || value.localValue || (value.papers ? value : { papers: [], folders: [] });
    const mode = value.mode === 'restore' || value.mode === 'pull' || value.mode === 'remote' ? 'restore' : 'merge';
    if (mode === 'restore' && !inspected.exists) {
      throw new Error('未找到云端库文件：' + inspected.fileUrl + '（HTTP ' + inspected.status + '）。' +
        '“云端恢复”不会再把缺失文件当作空库；如需从本机新建云端库，请使用“对比本机与云端”或“立即同步”。');
    }
    let base = await readSyncBase();
    const baseKey = remoteOptions.user + '\n' + remoteOptions.fileUrl;
    if (base && base.remoteKey && base.remoteKey !== baseKey) base = null;
    const basePaperCount = base && base.workspace && Array.isArray(base.workspace.papers) ? base.workspace.papers.length : 0;
    const localPaperCount = Array.isArray(localValue && localValue.papers) ? localValue.papers.length : 0;
    // Reset protection compares raw sync records, including tombstones, on all three sides.
    const remotePaperCount = inspected.remote && Array.isArray(inspected.remote.papers) ? inspected.remote.papers.length : 0;
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
    // 防覆盖断路器（比例版，不依赖基线）：三方合并会把远端「有效词条」大批移除。
    // 正常的单篇删除不会触发；触发的是「本机整批实体缺失」被当成删除传播——
    // 数据目录切换/部分读取失败，或用户真删了一批。无论哪种，达到阈值就暂停
    // 自动写入、强制人工确认，杜绝「本地 4 篇覆盖云端 210 篇」这类静默事故。
    const remoteActiveIds = new Set();
    ((inspected.remote && inspected.remote.papers) || []).forEach(function (paper) {
      if (paper && !paper.deletedAt) remoteActiveIds.add(String(paper.id));
    });
    const mergedActiveIds = new Set();
    ((((corePlan.preview || {}).workspace || {}).papers) || []).forEach(function (paper) {
      if (paper && !paper.deletedAt) mergedActiveIds.add(String(paper.id));
    });
    let droppedRemoteCount = 0;
    remoteActiveIds.forEach(function (id) {
      if (!mergedActiveIds.has(id)) droppedRemoteCount++;
    });
    const massDropSuspected = mode === 'merge' && inspected.exists && remoteActiveIds.size > 0 &&
      droppedRemoteCount >= Math.max(3, Math.ceil(remoteActiveIds.size * 0.1));
    // 首传确认：云端没有库文件而本机非空。多数是正常的新库初始化，但也可能是
    // 账号/同步目录名填错（大小写不同即另一个目录）。写之前让用户看一眼。
    const firstUploadSuspected = mode === 'merge' && !inspected.exists && !base && localPaperCount > 0;
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
      massDropSuspected: massDropSuspected,
      massDropCount: massDropSuspected ? droppedRemoteCount : 0,
      remoteActiveCount: remoteActiveIds.size,
      firstUploadSuspected: firstUploadSuspected,
      localPaperCount: localPaperCount,
      corePlan: corePlan,
      config: inspected.config,
      assets: inspected.assets,
      remoteKey: baseKey,
      portableSettings: cloneJson(value.portableSettings || {}),
      requiresConfirmation: mode === 'restore' || conflicts.length > 0 || remoteResetSuspected ||
        massDropSuspected || firstUploadSuspected,
      _options: remoteOptions,
      _remoteConfig: inspected.config && inspected.config.value ? null : null
    };
    // Keep the decrypted config only in the main-process plan state.  The
    // public object above deliberately contains booleans instead of secrets.
    try {
      const privateConfig = await readRemoteConfig(remoteOptions.folderUrl, remoteOptions.headers, remoteOptions.configPassword, {});
      plan._remoteConfig = privateConfig.value || null;
    } catch (error) {
      if (remoteOptions.configPassword) throw error;
    }
    pendingSyncPlans.set(planId, plan);
    return Object.assign({}, plan, { _options: undefined, _remoteConfig: undefined, corePlan: undefined });
  }

  /** 「本机为空疑似重置」的总体决议：对照弹窗以 plan:local-empty-reset 为键
   * 提交 'remote'（把远端拉回本机）或 'local'（确认清空远端）；未选择返回 ''。 */
  function planKeyChoice(resolutions, key) {
    let value = Array.isArray(resolutions)
      ? (resolutions.find(function (item) { return item && (item.conflictId === key || item.key === key || item.id === key); }) || {}).choice
      : resolutions && resolutions[key];
    if (value && typeof value === 'object') value = value.choice || value.resolution || value.value;
    value = String(value || '').toLowerCase();
    return value === 'remote' ? 'remote' : (value === 'local' ? 'local' : '');
  }

  function localEmptyResetChoice(resolutions) {
    return planKeyChoice(resolutions, LOCAL_EMPTY_RESET_KEY);
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
    if (cloudMirror.has(value.planId)) return cloudMirror.apply(value);
    const plan = pendingSyncPlans.get(String(value.planId || ''));
    if (!plan) throw new Error('同步计划不存在或已过期，请重新检查云端');
    const reportProgress = function (phase, extra) {
      emitSyncProgress(Object.assign({ scope: 'apply-plan', planId: plan.planId, phase: phase }, extra || {}));
    };
    reportProgress('verify', { message: '正在校验云端版本…' });
    const current = await readRemoteLibrary(plan._options);
    if (current.exists !== plan.remoteExists || current.etag !== plan.remoteEtag ||
        (!current.etag && current.exists && hashWorkspace(current.remote) !== hashWorkspace(plan.remote))) {
      pendingSyncPlans.delete(plan.planId);
      const error = new RemoteChangedError('云端内容已变化，旧同步计划已失效，请重新生成', plan._options.fileUrl);
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
        throw new Error('本机工作区为空而同步基线仍有内容：请先在对照中选择「采用云端版本」（把云端拉回本机）或「采用本机版本」（确认清空云端）');
      }
    }
    // 断路器决议：合并会大批移除云端词条时，'local'=确认删除照常应用，
    // 'remote'=放弃删除、把云端被移除的词条恢复回来；未选择不得应用。
    if (plan.massDropSuspected) {
      const dropChoice = planKeyChoice(value.resolutions, MASS_DROP_RESET_KEY);
      if (dropChoice === 'remote') {
        workspace = LitSync.adoptRemoteEntities(workspace, plan.remote);
      }
      else if (dropChoice !== 'local') {
        throw new Error('本次同步会把云端 ' + plan.massDropCount + ' 篇文献从合并结果中移除：请先在对照顶部选择「确认删除」或「放弃删除」');
      }
    }
    // 首传确认：云端没有库文件时，必须显式选择「确认上传」才新建云端库。
    if (plan.firstUploadSuspected) {
      if (planKeyChoice(value.resolutions, FIRST_UPLOAD_KEY) !== 'local') {
        throw new Error('云端还没有文献库文件：如确认以本机内容新建云端库，请在对照顶部选择「确认上传」；否则请检查账号与同步目录名是否正确');
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
    const session = await createSyncSession(plan._options);
    const previousPacer = activePacer;
    activePacer = session.pacer;
    // 暂停恢复语义与 nutstoreSyncOnce 一致：firstWrite 已完成则落基线，避免
    // 恢复同步因缺基线产生伪冲突；已决议工作区随暂停结果带回渲染层落库。
    let pausedBaseWorkspace = workspace;
    let firstWriteForPause = null;
    try {
      if (!current.exists) {
        const folderStatus = await ensureWebDavFolder(plan._options.url, plan._options.folderName, plan._options.headers);
        if (current.pathConflict && folderStatus === 405) {
          throw new Error('坚果云路径冲突：请确认“' + plan._options.folderName + '”是文件夹而非普通文件');
        }
      }
      const knownRemoteAssets = await resolveRemoteAssetNames(current.remote, workspace, plan._options, function () {
        reportProgress('scan-assets', { message: '正在读取云端附件清单，避免重复上传…' });
      });
      const firstPass = sanitizeCloudAssets(cloudWorkspace, null, knownRemoteAssets);
      const firstWrite = await writeCloudLibrary(plan._options, firstPass.workspace, current, function (phase, message) {
        reportProgress(phase, { message: message });
      }, session);
      firstWriteForPause = firstWrite;
      const assetResult = await syncWorkspaceAssets(workspace, plan._options, {
        // 附件失败不阻断文献库 JSON 写入：附件靠台账续传，先把文献元数据救回来
        strict: false,
        skip: pinSkipSet(pins),
        remoteAssets: knownRemoteAssets,
        ledger: session.ledger,
        verifiedNames: session.verifiedNames,
        onProgress: function (progress) {
          const current = progress.current ? ' · ' + progress.current : '';
          reportProgress('assets', { done: progress.done, total: progress.total, current: progress.current || '',
            message: progress.total > 0 ? '正在同步附件与快照（' + progress.done + '/' + progress.total + '）' + current + '…' : '正在核对附件…' });
        }
      });
      throwIfSyncCancelled();
      const finalPass = sanitizeCloudAssets(cloudWorkspace, session.verifiedNames, knownRemoteAssets);
      const finalLocal = sanitizeCloudAssets(workspace, session.verifiedNames, knownRemoteAssets);
      const finalWrite = await writeCloudLibrary(plan._options, finalPass.workspace, firstWrite.current, function (phase, message) {
        reportProgress(phase, { message: message });
      }, session);
      const uploaded = firstWrite.uploaded || finalWrite.uploaded;
      reportProgress('config', { message: '正在同步配置…' });
      if (plan.mode === 'restore' && plan._remoteConfig) {
        await applySyncedConfig(await loadRawConfig(), plan._remoteConfig, { portableSettings: plan.portableSettings });
      }
      await syncEncryptedConfig(plan._options.folderUrl, plan._options.headers, await loadRawConfig(), {
        passwordOverride: plan._options.configPassword,
        portableSettings: plan.portableSettings
      });
      const etag = finalWrite.current.etag || '';
      throwIfSyncCancelled();
      await writeSyncBase({ version: 1, savedAt: Date.now(), remoteKey: plan.remoteKey, etag: etag,
        workspace: LitSync.syncWorkspace(finalPass.workspace), pins: pins });
      pendingSyncPlans.delete(plan.planId);
      reportProgress('done', { message: '同步完成', uploaded: uploaded, pinned: Object.keys(pins).length });
      return { workspace: finalLocal.workspace, conflicts: plan.conflicts || [], uploaded: uploaded, assets: assetResult,
        pinned: Object.keys(pins).length, config: await getConfig() };
    } catch (error) {
      // 限流软暂停：已决议的工作区照常带回渲染层落库（决议不丢），附件在台账
      // 里，恢复续传由「立即同步」按普通合并完成。
      if (error && (error.code === 'WEBDAV_RATE_LIMITED' || error.code === 'SYNC_RATE_PAUSED')) {
        if (session.pacer && session.pacer.flush) await session.pacer.flush();
        if (firstWriteForPause) {
          try {
            await writeSyncBase({ version: 1, savedAt: Date.now(), remoteKey: plan.remoteKey, etag: firstWriteForPause.current.etag || '',
              workspace: LitSync.syncWorkspace(pausedBaseWorkspace), pins: pins });
          } catch (baseError) {}
        }
        return pausedSyncResult(error, workspace);
      }
      throw error;
    } finally {
      if (activePacer === session.pacer) activePacer = previousPacer;
    }
  }

  async function nutstoreSyncOnce(localValue, remoteOptions) {
    const session = await createSyncSession(remoteOptions);
    const previousPacer = activePacer;
    activePacer = session.pacer;
    // 暂停时需要知道「云端已写到哪一步」：firstWrite 已完成则把合并结果落成
    // 基线（云端已是这份内容），恢复同步不会因缺基线把 normalize 时间戳差异
    // 当成冲突。
    let mergedForPause = null;
    let firstWriteForPause = null;
    let pinsForPause = {};
    try {
      const library = await readRemoteLibrary(remoteOptions);
      const plan = await createNutstoreSyncPlan({
        workspace: localValue, mode: 'merge', _library: library,
        portableSettings: localValue && localValue.portableSettings
      });
      if (plan.conflicts && plan.conflicts.length || plan.remoteResetSuspected ||
          plan.massDropSuspected || plan.firstUploadSuspected) {
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
      mergedForPause = merged;
      pinsForPause = pins;
      const cloudWorkspace = LitSync.applyPinsToWorkspace(merged, pins);
      // 真实清单先行：firstWrite 之前就知道哪些登记是悬空的，写入云端的词条
      // 从第一笔起就不带假元数据。
      const knownRemoteAssets = await resolveRemoteAssetNames(remote, merged, remoteOptions, function () {
        emitSyncProgress({ scope: 'sync', phase: 'scan-assets', message: '正在读取云端附件清单，避免重复上传…' });
      });
      const firstPass = sanitizeCloudAssets(cloudWorkspace, null, knownRemoteAssets);
      const firstWrite = await writeCloudLibrary(remoteOptions, firstPass.workspace, library, function (phase, message) {
        emitSyncProgress({ scope: 'sync', phase: phase, message: message });
      }, session);
      firstWriteForPause = firstWrite;
      const assetResult = await syncWorkspaceAssets(merged, remoteOptions, {
        // 附件失败不阻断文献库 JSON 写入：附件靠台账续传，先把文献元数据救回来
        strict: false,
        skip: pinSkipSet(pins),
        remoteAssets: knownRemoteAssets,
        ledger: session.ledger,
        verifiedNames: session.verifiedNames,
        onProgress: function (progress) {
          const current = progress.current ? ' · ' + progress.current : '';
          emitSyncProgress({ scope: 'sync', phase: 'assets', done: progress.done, total: progress.total, current: progress.current || '',
            message: progress.total > 0 ? '正在同步附件与快照（' + progress.done + '/' + progress.total + '）' + current + '…' : '正在核对附件…' });
        }
      });
      throwIfSyncCancelled();
      emitSyncProgress({ scope: 'sync', phase: 'config', message: '正在同步配置…' });
      await syncEncryptedConfig(remoteOptions.folderUrl, remoteOptions.headers, remoteOptions.raw, {
        portableSettings: localValue && localValue.portableSettings
      });
      // 终写净化：只有本会话核实（上传/下载/签名）或真实清单确认存在的附件
      // 元数据才进云端 JSON；悬空登记剥离。云端写/基线用净化后的 cloud 形态，
      // 本地应用用净化后的合并结果（保持 pins 的两侧分叉语义）。
      const finalPass = sanitizeCloudAssets(cloudWorkspace, session.verifiedNames, knownRemoteAssets);
      const finalLocal = sanitizeCloudAssets(merged, session.verifiedNames, knownRemoteAssets);
      const finalWrite = await writeCloudLibrary(remoteOptions, finalPass.workspace, firstWrite.current, function (phase, message) {
        emitSyncProgress({ scope: 'sync', phase: phase, message: message });
      }, session);
      const uploaded = firstWrite.uploaded || finalWrite.uploaded;
      if (conflicts.length) {
        const lines = conflicts.map(function (c) {
          return JSON.stringify({ at: new Date().toISOString(), id: c.id, title: c.title, direction: c.direction, overwritten: c.overwritten });
        }).join('\n') + '\n';
        await fs.appendFile(path.join(options.baseDir, 'sync-conflicts.jsonl'), lines, 'utf8').catch(function () {});
      }
      throwIfSyncCancelled();
      await writeSyncBase({ version: 1, savedAt: Date.now(), remoteKey: remoteOptions.user + '\n' + remoteOptions.fileUrl,
        etag: finalWrite.current.etag || '',
        workspace: LitSync.syncWorkspace(finalPass.workspace), pins: pins });
      emitSyncProgress({ scope: 'sync', phase: 'done', message: '同步完成', uploaded: uploaded, pinned: Object.keys(pins).length });
      return { workspace: finalLocal.workspace, conflicts: conflicts, uploaded: uploaded, assets: assetResult,
        pinned: Object.keys(pins).length, config: await getConfig() };
    } catch (error) {
      // 限流不是失败：软暂停 + 恢复时刻。已上传的附件在台账里，下一轮免重传。
      // firstWrite 已完成时，云端已是合并结果——把它同时落成基线并随结果带回
      // 本地落库，两侧从同一份内容继续，恢复同步不会产生伪冲突。
      if (error && (error.code === 'WEBDAV_RATE_LIMITED' || error.code === 'SYNC_RATE_PAUSED')) {
        if (session.pacer && session.pacer.flush) await session.pacer.flush();
        if (mergedForPause && firstWriteForPause) {
          try {
            await writeSyncBase({ version: 1, savedAt: Date.now(), remoteKey: remoteOptions.user + '\n' + remoteOptions.fileUrl,
              etag: firstWriteForPause.current.etag || '',
              workspace: LitSync.syncWorkspace(mergedForPause), pins: pinsForPause });
          } catch (baseError) {}
          return pausedSyncResult(error, mergedForPause);
        }
        return pausedSyncResult(error, localValue);
      }
      throw error;
    } finally {
      if (activePacer === session.pacer) activePacer = previousPacer;
    }
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
    const libraryColumns = zoteroTableColumns(db, 'libraries');
    const libraries = libraryColumns.length ? zoteroQuery(db,
      'SELECT libraryID' + (libraryColumns.includes('libraryType') ? ', libraryType' : '') + ' FROM libraries', failures, 'libraries') : [];
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
            const stored = await storeFileInto(itemAttachmentDir(options.baseDir, job.paperId),
              job.sourcePath, path.extname(job.fileName));
            attachment.path = stored.path;
            if (job.zoteroKey) assetMap[job.zoteroKey] = stored.path;
          } else if (job.kind === 'snapshot-dir') {
            const paper = paperById[job.paperId];
            const attachment = paper && paper.attachments.find(function (att) { return att.id === job.attachmentId; });
            if (!attachment) throw new Error('快照附件记录不存在');
            const stored = await storeDirInto(itemAttachmentDir(options.baseDir, job.paperId), job.sourcePath);
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
          const targetDir = itemAttachmentDir(options.baseDir, paper.id);
          await fs.mkdir(targetDir, { recursive: true });
          const target = await availablePdfPath(targetDir, paper.id + '.pdf');
          await fs.writeFile(target, pdf.data);
          const primary = (paper.attachments || []).find(function (att) { return att && att.kind === 'pdf'; });
          if (primary) {
            primary.path = target;
            primary.fileName = pdf.name || primary.fileName || 'PDF';
          } else {
            paper.attachments = [LitModel.normalizeAttachment({
              id: 'at' + crypto.randomBytes(8).toString('hex'), kind: 'pdf',
              path: target, fileName: pdf.name || 'PDF'
            })].concat(paper.attachments || []);
          }
          const normalized = LitModel.normalizePaper(paper);
          workspace.papers[workspace.papers.indexOf(paper)] = normalized;
          downloaded++;
        } catch (error) { failed++; }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { workspace: workspace, downloaded: downloaded, existing: existing, missing: missing, failed: failed };
  }

  /* 调研助手运行时配置：主进程内部使用（含解密后的 Key），不回渲染层。
   * 与划词翻译凭据完全独立——AI 助手 / OpenAlex 检索各有各的 Key。
   * AI 助手三项取「当前生效服务商」（配置文件里的扁平字段即它的镜像，这里直接从清单解，
   * 免得读到配置文件被外部工具改坏后的残留值）。 */
  async function getResearchRuntimeConfig() {
    const raw = await loadRawConfig();
    const agentActive = LitAgentCfg.activeProvider(LitAgentCfg.normalizeConfig(raw));
    return {
      agentBaseUrl: String(agentActive.baseUrl || '').trim(),
      agentModel: String(agentActive.activeModel || '').trim(),
      agentApiDialect: AGENT_DIALECTS.indexOf(agentActive.dialect) >= 0 ? agentActive.dialect : '',
      agentApiKey: agentActive.apiKey ? decrypt(agentActive.apiKey) : '',
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

  /** 按 id 取某个服务商的运行期凭据（设置页「测试连接 / 拉取模型」用；用户没重填 Key 时
   *  也要能测，故由主进程解自己存的那把）。返回 null 表示 id 不存在。 */
  async function getAgentProviderRuntime(id) {
    const wanted = String(id == null ? '' : id).trim();
    if (!wanted) return null;
    const raw = await loadRawConfig();
    const cfg = LitAgentCfg.normalizeConfig(raw);
    const found = cfg.providers.filter(function (p) { return p.id === wanted; })[0];
    if (!found) return null;
    return {
      id: found.id,
      name: found.name,
      baseUrl: found.baseUrl,
      dialect: found.dialect,
      model: found.activeModel,
      models: found.models.slice(),
      apiKey: found.apiKey ? decrypt(found.apiKey) : ''
    };
  }

  /** 仅供用户显式「查看 / 复制」的按需解密入口；常规 getConfig 永不返回完整凭据。 */
  async function revealSecret(input) {
    const request = input || {};
    const kind = String(request.kind || '').trim();
    const raw = await loadRawConfig();
    const fields = {
      translator: 'translatorApiKey', scigreat: 'scigreatApiKey', easyscholar: 'easyscholarApiKey',
      openalex: 'openalexApiKey', elsevier: 'elsevierApiKey', tinyfish: 'tinyfishApiKey', embed: 'embedApiKey'
    };
    if (kind === 'agent') {
      const providerId = String(request.providerId || '').trim();
      const provider = LitAgentCfg.normalizeConfig(raw).providers.filter(function (item) { return item.id === providerId; })[0];
      return provider && provider.apiKey ? decrypt(provider.apiKey) : '';
    }
    return fields[kind] ? decrypt(raw[fields[kind]]) : '';
  }

  /** 对话面板底部切换服务商 / 模型（不打开设置即生效）：只改选中项，凭据原样保留 */
  async function setAgentSelection(input) {
    const req = input || {};
    const raw = await loadRawConfig();
    const cfg = LitAgentCfg.normalizeConfig(raw);
    const picked = LitAgentCfg.selectModel(cfg, req.providerId, req.model);
    return saveConfig({
      // 不带 apiKey：合并按 id 沿用已存的密文，避免把密文当明文二次加密
      agentProviders: picked.providers.map(function (p) {
        return {
          id: p.id, name: p.name, baseUrl: p.baseUrl, dialect: p.dialect,
          models: p.models, activeModel: p.activeModel
        };
      }),
      agentActiveProviderId: picked.activeId
    });
  }

  const cloudMirror = createCloudMirror({
    resolveOptions: resolveNutstoreOptions, readWorkspace: options.readWorkspace,
    readLibrary: readRemoteLibrary, listAssets: listRemoteAssetNames, listAssetEtags: listRemoteAssetEtags,
    request: request,
    hash: hashWorkspace, safeName: safeCloudName, join: joinUrl,
    checkCancelled: throwIfSyncCancelled, rateLimit: throwIfWebDavRateLimited,
    ensureFolder: ensureWebDavFolder, syncAssets: syncWorkspaceAssets,
    writeLibrary: writeCloudLibrary, writeBase: writeSyncBase, syncWorkspace: LitSync.syncWorkspace,
    progress: emitSyncProgress,
    withSession: async function (remoteOptions, task) {
      const session = await createSyncSession(remoteOptions);
      const previous = activePacer;
      activePacer = session.pacer;
      try { return await task(session); }
      finally { if (activePacer === session.pacer) activePacer = previous; }
    }
  });

  return { getConfig, saveConfig, getResearchRuntimeConfig, getAgentProviderRuntime, revealSecret, setAgentSelection,
    nutstoreSync: function (value) { return runSyncTask(function () { return nutstoreSync(value); }); }, cancelNutstoreSync,
    inspectNutstoreRemote, createNutstoreSyncPlan,
    applyNutstoreSyncPlan: function (value) { return runSyncTask(function () { return applyNutstoreSyncPlan(value); }); },
    inspectRemote, createSyncPlan,
    applySyncPlan: function (value) { return runSyncTask(function () { return applySyncPlan(value); }); },
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

/** 按传输大小放宽超时：请求体或响应 Content-Length 无大小时用基准值；有大小按
 * 256KB/s 悲观速率 + 15s 余量，封顶 10 分钟防止连接真挂死。这只是「放弃等
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
  const fresh = { version: 1, remoteKey: remoteKey, assets: {}, pacing: loadPacingValue(value && value.pacing) };
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
  return { version: 1, remoteKey: remoteKey, assets: assets, pacing: loadPacingValue(value.pacing) };
}

/** 台账能否证明该对象已在远端（同一字节流成功 PUT 过）。只要有真实/派生的
 * 远端清单且其中没有该对象，一律不采信台账、照常上传——包括清单为空的
 * 情况（对象确实都不在了）。只有拿不到清单（null）时才退回台账断点续传。 */
function assetLedgerProof(ledger, cloudName, hash, size, knownRemoteAssets) {
  const entry = ledger && ledger.assets && ledger.assets[String(cloudName || '')];
  if (!entry || entry.hash !== String(hash || '').toLowerCase()) return false;
  if (entry.size != null && size != null && entry.size !== size) return false;
  if (knownRemoteAssets && !knownRemoteAssets.has(cloudName)) return false;
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
