/* LitBoard AI 助手「服务商 + 模型」配置（浏览器 / Node 共用，纯函数）
 *
 * 背景：对话框底部的模型徽标过去只是「当前 Base URL + 单一模型名」的展示，换模型必须进
 * 设置改 Base URL / Key / 模型名——想在同一天里在 DashScope 的 qwen 与 DeepSeek 的
 * deepseek-flash 之间切换，得反复重填凭据。本模块把配置升级成**服务商清单**：
 * 每个服务商自带 Base URL / 接口格式 / API Key / 模型清单，选中的那一组即当前生效值。
 *
 * 兼容（关键）：
 * - 旧版扁平字段（agentBaseUrl / agentApiKey / agentApiDialect / agentModel）仍被主进程
 *   agent-net、向量嵌入回退（js/embedcfg 的 legacy-chat）与渲染层的就绪判定消费。因此
 *   **扁平字段降级为「当前生效服务商」的镜像**：integrations.saveConfig 在写盘前按本模块
 *   的 mirror() 重算，其余模块一行都不用改。
 * - 老配置文件没有 agentProviders：normalizeConfig 用扁平字段合成 id='default' 的服务商
 *   （即旧配置本身），并在缺省服务商时自动补位——读取路径永远拿到「至少一个服务商」。
 *
 * 本模块不解释 apiKey 的含义：主进程存密文、渲染层只带 hasApiKey 布尔占位，normalizeProvider
 * 原样搬运这两个字段，规则因此对两侧一致（同 js/embedcfg 的 'set' 占位约定）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitAgentCfg = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /** 内置服务商（旧版扁平字段的落点）：永远存在、不可删除，其他服务商都以它为基座 */
  var DEFAULT_PROVIDER_ID = 'default';
  var DIALECT_VALUES = ['chat', 'responses', 'messages'];
  var MAX_PROVIDERS = 24;
  var MAX_MODELS = 200;

  function str(value) { return String(value == null ? '' : value); }
  function trim(value) { return str(value).trim(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function normalizeDialect(value) {
    var dialect = trim(value).toLowerCase();
    return DIALECT_VALUES.indexOf(dialect) >= 0 ? dialect : '';
  }

  /** 模型清单：去空、去重、限长（顺序即界面顺序；同一模型重复添加不产生两行） */
  function normalizeModels(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (item) {
      var id = trim(typeof item === 'string' ? item : (item && (item.id || item.model))).slice(0, 200);
      if (!id || out.indexOf(id) !== -1) return;
      if (out.length >= MAX_MODELS) return;
      out.push(id);
    });
    return out;
  }

  /**
   * 单个服务商归一化。id 缺失时用 fallbackId；apiKey / hasApiKey 原样搬运（密文或占位），
   * 其余字段只取白名单——渲染层的表单草稿与主进程的配置文件走同一条规则。
   */
  function normalizeProvider(raw, fallbackId) {
    var item = raw || {};
    var models = normalizeModels(item.models);
    var activeModel = trim(item.activeModel).slice(0, 200);
    // 选中的模型被删掉时回落到清单首项；清单为空则保留用户刚填的名字（还没点「添加」）
    if (activeModel && models.length && models.indexOf(activeModel) === -1) activeModel = models[0];
    if (!activeModel && models.length) activeModel = models[0];
    var provider = {
      id: trim(item.id) || trim(fallbackId),
      name: trim(item.name).slice(0, 60),
      baseUrl: trim(item.baseUrl),
      dialect: normalizeDialect(item.dialect),
      models: models,
      activeModel: activeModel
    };
    if (item.apiKey != null || item.hasApiKey != null) {
      if (item.apiKey != null) provider.apiKey = str(item.apiKey);
      if (item.hasApiKey != null) provider.hasApiKey = item.hasApiKey === true;
    }
    if (item.apiKeyHint != null) provider.apiKeyHint = str(item.apiKeyHint);
    return provider;
  }

  /**
   * 配置归一化：产出 {providers, activeId}，保证列表非空且 activeId 一定指向存在的服务商。
   * raw 可以是主进程的原始配置文件（agentProviders / agentActiveProviderId），也可以是
   * 渲染层拿到的 getConfig() 结果，或本模块增删改函数返回的紧凑形态（providers / activeId）。
   */
  function normalizeConfig(raw) {
    var cfg = raw || {};
    var rawList = Array.isArray(cfg.agentProviders) ? cfg.agentProviders : (Array.isArray(cfg.providers) ? cfg.providers : []);
    var providers = [];
    var seen = {};
    rawList.forEach(function (item, index) {
      var provider = normalizeProvider(item, index === 0 ? DEFAULT_PROVIDER_ID : '');
      if (!provider.id || seen[provider.id]) return;
      if (providers.length >= MAX_PROVIDERS) return;
      seen[provider.id] = true;
      providers.push(provider);
    });
    if (!seen[DEFAULT_PROVIDER_ID]) {
      providers.unshift(normalizeProvider({
        id: DEFAULT_PROVIDER_ID,
        name: '',
        baseUrl: cfg.agentBaseUrl,
        dialect: cfg.agentApiDialect,
        apiKey: cfg.agentApiKey,
        apiKeyHint: cfg.agentApiKeyHint,
        hasApiKey: cfg.hasAgentApiKey === true,
        models: cfg.agentModel ? [cfg.agentModel] : [],
        activeModel: cfg.agentModel
      }, DEFAULT_PROVIDER_ID));
    }
    var activeId = trim(cfg.agentActiveProviderId) || trim(cfg.activeId);
    if (!activeId || !providers.some(function (p) { return p.id === activeId; })) activeId = DEFAULT_PROVIDER_ID;
    return { providers: providers, activeId: activeId };
  }

  function providerById(config, id) {
    var cfg = normalizeConfig(config);
    var wanted = trim(id) || cfg.activeId;
    for (var i = 0; i < cfg.providers.length; i++) {
      if (cfg.providers[i].id === wanted) return cfg.providers[i];
    }
    return cfg.providers[0];
  }

  /** 当前生效的服务商（永不返回 null：至少存在内置服务商） */
  function activeProvider(config) { return providerById(config, ''); }

  /** 当前生效的模型名（服务商未选模型时为空串） */
  function activeModel(config) { return activeProvider(config).activeModel; }

  /** 扁平字段镜像：写盘前由主进程重算，老消费方（agent-net / embedcfg 回退 / 就绪判定）零改动 */
  function mirror(config) {
    var provider = activeProvider(config);
    return {
      agentBaseUrl: provider.baseUrl,
      agentApiDialect: provider.dialect,
      agentModel: provider.activeModel
    };
  }

  /** 界面选择：{providerId, model}（对话面板底部徽标与设置页选中行都由它驱动） */
  function selectionOf(config) {
    var provider = activeProvider(config);
    return { providerId: provider.id, model: provider.activeModel };
  }

  /** 切换当前服务商 / 模型（纯函数：返回新的 {providers, activeId}） */
  function selectModel(config, providerId, model) {
    var cfg = normalizeConfig(config);
    var wanted = trim(providerId) || cfg.activeId;
    if (!cfg.providers.some(function (p) { return p.id === wanted; })) wanted = DEFAULT_PROVIDER_ID;
    var providers = cfg.providers.map(function (p) {
      if (p.id !== wanted) return p;
      var next = clone(p);
      var picked = trim(model);
      if (picked) next.activeModel = picked;
      else if (!next.activeModel && next.models.length) next.activeModel = next.models[0];
      return next;
    });
    return { providers: providers, activeId: wanted };
  }

  /** 新增或替换一个服务商（同 id 覆盖，否则追加）；activeId 不变 */
  function upsertProvider(config, provider) {
    var cfg = normalizeConfig(config);
    var next = normalizeProvider(provider, '');
    if (!next.id) return cfg;
    var found = false;
    var providers = cfg.providers.map(function (p) {
      if (p.id !== next.id) return p;
      found = true;
      return next;
    });
    if (!found) {
      if (providers.length >= MAX_PROVIDERS) return cfg;
      providers = providers.concat([next]);
    }
    return { providers: providers, activeId: cfg.activeId };
  }

  /** 删除服务商（内置服务商删不掉）；删掉的正是当前选中项时回落内置服务商 */
  function removeProvider(config, id) {
    var cfg = normalizeConfig(config);
    var wanted = trim(id);
    if (!wanted || wanted === DEFAULT_PROVIDER_ID) return cfg;
    var providers = cfg.providers.filter(function (p) { return p.id !== wanted; });
    if (providers.length === cfg.providers.length) return cfg;
    return { providers: providers, activeId: cfg.activeId === wanted ? DEFAULT_PROVIDER_ID : cfg.activeId };
  }

  /** 新服务商 id（确定性：传入 now 便于测试；重名自动加后缀） */
  function newProviderId(providers, now) {
    var base = 'p' + String(now == null ? Date.now() : now).toString(36);
    var taken = {};
    (Array.isArray(providers) ? providers : []).forEach(function (p) { taken[trim(p && p.id)] = true; });
    var id = base;
    var index = 2;
    while (taken[id]) id = base + '-' + (index++);
    return id;
  }

  /** 展示名：自定义名称 → 协议层服务商名（OpenCode Go / DeepSeek…）→ 主机名 → 空串 */
  function providerLabel(provider, proto) {
    var item = provider || {};
    var name = trim(item.name);
    if (name) return name;
    var baseUrl = trim(item.baseUrl);
    if (!baseUrl) return '';
    if (proto && typeof proto.providerLabel === 'function') {
      var label = proto.providerLabel(baseUrl);
      if (label) return label;
    }
    try { return new URL(baseUrl).hostname; } catch (error) { return ''; }
  }

  /** 配置完整度（设置页服务商行的状态点）：ready 可对话 / partial 缺项 / empty 未填端点。
   *  只判「有没有」，不判有效性——有效性由「测试连接」回答。 */
  function providerStatus(provider) {
    var item = provider || {};
    var hasKey = item.hasApiKey === true || !!trim(item.apiKey);
    if (!trim(item.baseUrl)) return 'empty';
    if (!hasKey) return 'partial';
    if (!trim(item.activeModel) && !(item.models || []).length) return 'partial';
    return 'ready';
  }

  /**
   * 对话面板底部模型菜单的数据（分组：一个服务商一组，组内是它勾选的模型）。
   * 只列「有模型可选」的服务商，外加当前选中的那个（即便清单为空，也要能看到当前模型）。
   */
  function menuGroups(config, proto) {
    var cfg = normalizeConfig(config);
    return cfg.providers.map(function (p) {
      return {
        id: p.id,
        label: providerLabel(p, proto) || trim(p.baseUrl),
        active: p.id === cfg.activeId,
        current: p.activeModel,
        models: (p.models.length ? p.models : (p.activeModel ? [p.activeModel] : [])).map(function (m) {
          return { id: m, active: p.id === cfg.activeId && m === p.activeModel };
        })
      };
    }).filter(function (group) { return group.models.length > 0; });
  }

  return {
    DEFAULT_PROVIDER_ID: DEFAULT_PROVIDER_ID,
    DIALECT_VALUES: DIALECT_VALUES,
    MAX_PROVIDERS: MAX_PROVIDERS,
    MAX_MODELS: MAX_MODELS,
    normalizeModels: normalizeModels,
    normalizeProvider: normalizeProvider,
    normalizeConfig: normalizeConfig,
    providerById: providerById,
    activeProvider: activeProvider,
    activeModel: activeModel,
    mirror: mirror,
    selectionOf: selectionOf,
    selectModel: selectModel,
    upsertProvider: upsertProvider,
    removeProvider: removeProvider,
    newProviderId: newProviderId,
    providerLabel: providerLabel,
    providerStatus: providerStatus,
    menuGroups: menuGroups
  };
});
