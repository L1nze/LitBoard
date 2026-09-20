# 更新日志

本文件格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增（AI 对话 LaTeX 公式渲染：MathJax tex-svg）

- **`vendor/mathjax/`（3.2.2 tex-svg 单文件，Apache-2.0，SVG 输出无字体依赖）**：
  聊天气泡正文经 LitMarkdown 渲染出的 `.lb-math` / `.lb-math-block`（原始 LaTeX 源码）
  现在真正排版成公式。
- **懒加载 + 观察器驱动**（`js/agentui.js`）：首次出现公式才注入 MathJax（无公式的
  会话零开销）；聊天挂载后 MutationObserver（250ms 防抖）驱动——流式增量和切换
  会话的 DOM 重建都会自动补排版。只对 lb-math 节点做 `tex2svgPromise`（textContent
  即 TeX 源），不扫全文定界符、不会误伤普通文本里的 `$`；单条公式失败保留原文，
  MathJax 加载失败下次自动重试。
- 笔记/预览保持源码保真展示（lb-math 的既有语义不变）；类型化后的样式切换在
  `css/style.css`（`.lb-math[data-math-typeset]`）。
- smoke 新增端到端断言 `chatMathRendered`（LitMarkdown 出节点 → typesetMath →
  mjx-container 生成，隔离环境全程离线）；vendor/SHA256SUMS、README 双语许可、
  docs/THIRD-PARTY.md 已登记。

### 变更（公式：系统提示要求用 LaTeX，渲染器保证公式不被斜体规则改坏）

- **系统提示加约束**（`js/agentui.js` 的 `systemPrompt`）：公式一律用 LaTeX 写——行内 `$...$`、
  独立成行 `$$...$$`；不要用图片、Unicode 上下标（x₁、α）或纯文字描述代替公式。同时写明
  「公式内不要留空行」（空行会切断段落，公式随之断开）。
- **现状核查结论**：对话界面**没有 LaTeX 排版引擎**（`vendor/` 下无 KaTeX/MathJax/Temml，
  `js/markdown.js` 是手写的最小子集渲染器）。所以在加约束之前先修了更要紧的一件事——
  **公式会被斜体规则改坏**：`$x_1 + y_2 = z_3$` 曾渲染成 `x<em>1 + y</em>2 = z_3`，
  `$a * b * c$` 会变成 `a <em> b </em> c`。公式里的 `_` 是下标语法，不是强调标记。
- **渲染器保护**（`js/markdown.js`）：在斜体/加粗规则之前把 `$...$` / `$$...$$` 摘成占位 token，
  内容按文本转义后包进 `<span class="lb-math">`（块级为 `lb-math-block`）。边界判定沿用
  KaTeX auto-render 的保守规则（开括号后无空格、闭括号前无空格、闭括号后不接数字、
  开括号前不是词字符），因此 `$5-$10`、`US$5 and US$10` 这类金额不会被误判成公式；
  行内代码 `` `$x_1$` `` 仍是代码。样式（`css/style.css` 的 `.lb-math`）等宽 + 浅底 +
  `font-style: normal`，长公式横向滚动——**只保证源码原样可见、边界清楚，不做排版**。
- 段落内的换行会先合并成一行再解析，所以跨行的 `$$` 块照样识别（测试已固定这一行为）。
- 测试：`test/markdown.test.js` 新增两条（源码保住 / 金额与代码不误伤、块级样式与跨行）；
  790/790、lint、smoke 全绿。

### 修复（备份对象仓发布竞态：偶发「有引用资源无法读取，未发布备份」）

- **现象**：`test/backup.test.js` 的「两个文献引用同一个 PDF」偶发失败（隔离跑 3 次挂 2 次），
  `createSnapshot()` 返回 `ok:false, missing:[{ reason: 'EPERM: operation not permitted, rename …' }]`
  ——即**整份备份不发布**。这不是测试问题：生产上「同一 PDF 挂在两篇文献下」很常见。
- **根因**：两个资产同内容 → 同一对象路径 → 4 路并发暂存同时走到发布步。旧实现直接
  `fs.rename(temp, target)`；Windows 上 rename 覆盖「刚被另一路写入」或「被杀毒扫描占着句柄」
  的目标会抛 EPERM/EBUSY。此时对象**其实已经就位**，却被当成资源读取失败。
  （临时名唯一性此前已修过一次，这是同一路径上的第二个竞态。）
- **修复**：新增 `publishObject(temp, target, hash)`（`electron/backup.js`，已导出可测）——
  rename 抛 EPERM/EBUSY/EEXIST 时先复核 target 哈希，一致即视为成功并丢弃临时文件；
  不一致则短暂退避重试（5 次），重试用尽才如实报错。绝不静默覆盖，也不因为「另一路先写完了」
  把整份备份判失败。
- 测试：新增 `publishObject tolerates a target that is already published`（含只读目标这一
  Windows 上必然 EPERM 的形态）；修复后该文件连续 8 次全过。

### 重构（IPC 域拆分：main.js 瘦身 3091 → ~1260 行）

- **全部 116 个 ipcMain.handle 注册按域拆进 `electron/ipc/`**（12 个域模块 + `context.js` + `index.js`）：
  window / word / library+settings / backup+data-paths+app:relaunch / bridge / integrations /
  files+clipboard+csl / ocr / pdfsearch / research+embed / agent+session / api+pdf。
  通道名、handler 逻辑、受信校验与错误文案逐字不变；`registerAll()` 保持在
  `createWindow()` 之前、bridgeServer 创建之前调用（与原 `registerIpc()` 同位）。
- **共享可变状态收进 `ipc/context.js` 单例**（main.js 启动装配写入、域模块调用时读取）：
  解决 bridgeServer 注册后才创建、researchDb/agentSessions 可为 null、dataPathState
  多处重赋值、mainWindow 可重建的晚绑定约束；跨域标志 forceQuitNext/syncInFlight/
  lastLibraryWriteAt 一并归位；startupLog（整文件重写式，必须全进程唯一）随迁。
- **新增 `test/ipc-parity.test.js` 长期护栏**：preload invoke ↔ 主进程注册双向对等、
  handle 通道无重复注册、渲染层 send 的生命周期通道有监听、ipc 域模块相对 require
  路径存在性——此前对等只是约定，没有测试。
- `test/i18n.test.js` 的 `WRAPPED_FILES` 改为自动枚举 `electron/ipc/*.js`：
  新增 IPC 域文件自动进 T() 键覆盖门禁。
- AGENTS.md 架构要点补 IPC 域拆分条目；`ALLOWED_API_HOSTS` 位置说明同步为
  `electron/ipc/api.js`（唯一消费方，随通道一起迁移）。
- 验证：777+5 测试全绿、lint 0 问题、Electron 39 冒烟 97/97 断言、生命周期冒烟
  （写入 → 真实关闭 → 重启 → 数据一致）通过。

### 性能与稳定（全库审计：冗余 / 串行 / 热点三线优化）

- **渲染层**：侧栏计数（头部四项 + 每文件夹 + 智能文件夹命中）从 O(文件夹×文献)
  的逐文件夹全量扫描改为单遍统计 + 签名缓存（内容性修改必抬 updatedAt，签名不变则
  计数不变）；`folderDescendantSet` 先建父→子索引（消 O(文件夹²)）；排序 Collator
  实例复用（localeCompare 每次调用重解析 locale）；haystack 缓存容量 5000→20000、
  「超限整表清空」改逐条最旧先出（万篇库此前每搜一次必抖动一半）；搜索防抖 150→250ms。
- **串行 → 并行（全部有界并发 4-8，结果按输入序落位）**：PDF 全文抽取按页 6 路并发、
  备份资产暂存/发布前校验/恢复复制（4/4/6 路，暂存临时文件名加序号修并发互截 bug）、
  OA PDF 批量下载（4 路下载 + 落盘单链串行防同名竞态）、PDF 暂存复制、OpenAlex
  批量分块并发递交（主机节流队列本就限并发 3）、会话列表存在性检查、导入 PDF 受管
  拷贝、快照目录 ZIP 读取。
- **主进程**：db.js 子表写语句 WeakMap 缓存（批量标记万篇时省 ~10 万次 prepare）；
  sync.js sameEntityContent 直调 entitySignature；applyLocalOnlyResolutions 从
  O(标记×实体) 线性化（恢复整库场景原先平方级）。
- **死代码清理**：sync.js 五个历史别名导出与 resolveSyncPlan、docx FIELD_ADDIN、
  preload/main 的 research:graph-progress 死事件路径、约 120 行孤儿 CSS
  （旧版 agent 消息渲染块 / 旧状态药丸 / mini-tag / col-check）；**修复 model.js
  `tagColorsFromRecords` 被调用但从未导出的真 bug**（标签颜色合并后静默不重算）。

### 整理（文件组织）

- 两份 2026-09-20 审查报告归位 `docs/audits/`；README 双语文档索引补 task-ledger 与
  audits/；audit-baseline 版本号 1.2.0 → 1.2.14（标注复核日期）。
- i18n 一次性迁移脚本入 `scripts/one-off/`（修 __dirname 层级）；gen-icons /
  release-checksums 注册进 package.json scripts，文档同步 npm run 形式。
- 删 `build/icon-master.png`（gen-icons 可再生中间产物，此前被 `build/icon-*.png`
  通配误打进每个安装包，1.4MB）与零引用的 `icon/LitboardLogo.png`。
- 仓库建立 git 基线（此前零提交）。

### 新增（设置页「检索与元数据服务」一个按钮测完四个源）

- **一个按钮、四个源、逐行回报**（设置 → 集成与服务 → 检索与元数据服务 → 「测试全部服务」）：
  OpenAlex / Semantic Scholar / Elsevier / TinyFish 各打一发最小真实请求，结果逐行列出
  「服务名 · 状态 · 细节」。只报一句成功/失败等于没说——**哪个源能用、为什么不能用**必须一眼看清。
- **通道如实回报**（`electron/research-net.js` 的探针）：OpenAlex 无 Key 时报「polite pool（邮箱）」、
  既无邮箱也无 Key 时报「未填邮箱」，带 Key 才报「带 API Key」——不让用户以为填的 Key 生效了；
  Semantic Scholar 区分「共享池（可能限流）」与「带 API Key」。
- **失败分类可区分**：`missing_key` 未配置 / `unauthorized` 凭据无效或无权限 / `rate_limited` 上游限流 /
  `not_found` 端点通了但无该记录 / `network` 不可达 / `error` 其余。分类是模块作用域的
  `classifyTestError`（research-net 导出，webfetch-net 复用同一份），渲染层按 code 出文案——
  主进程不产出面向用户的句子。探针**只读、不写库、不抛异常**，并与业务路径共用同一个节流队列，
  测试同样受主机限流约束。
- **Elsevier 两种能力分开回报**：摘要回填端点（只需 Key）与 Scopus 检索（另需机构订阅）分别探测。
  「摘要通、Scopus 无权限」是最常见的组合，含混成一句「失败」会让用户以为 Key 坏了。
  顺带修正：`searchScopus`/`searchSemanticScholar` 重抛 401/403 时丢掉了 `error.status`，
  只剩一句「权限不足」——现在保留状态码，连接测试才能把它与 429 区分开。
- **TinyFish 守门**：受「开关 + 出境告知」双重门控，未启用时如实回报 `skipped` 且**不发请求**
  （未经同意的出境不能靠一个测试按钮绕过）；已配置则验证 Key 是否真的发得出去（`X-API-Key`）。
- 新增 IPC `integrations:test-sources`（`electron/main.js`）/ preload `testSources`；
  冒烟加 `sourcesTestPresent`（按钮 + 状态行 + 结果区三件套同时在位）。
- 测试：research-net 三条（通道如实 / 失败分类 / Elsevier 两能力组合）、webfetch 一条
  （跳过 / 可用 / 401 / 断网），共 782/782 通过；lint、smoke 全绿。i18n 补 20 条词典条目。

### 变更（AI 助手面板：发送/停止合并为一个箭头按钮、输入区钉底、显示服务商）

- **发送与停止合并成一个图标按钮**（`scripts/agent-ui-bundle/main.jsx` 的 ComposerArea）：
  未运行 = 向上箭头（发送），运行中 = 方块（停止），不再出现「发送」文字。原先两个文字按钮
  同时挂在行尾，用户要先判断「现在能点哪个」；合并后按钮形态与当前可做的动作一一对应，
  文案走 `title`/`aria-label`（沿用词典既有的「发送」/「停止」，无障碍不丢）。
  编辑态 composer（保存并重发/取消）保持文字按钮不变。
- **输入区钉在面板底部**（`css/style.css`）：`.agent-body` 从「自身滚动 + padding」改为
  纵向 flex 容器（`min-height:0` + `overflow:hidden`），滚动交给 `.aui-viewport`。
  此前 `.agent-chat-root` 的 `flex:1` 因父级不是 flex 而失效、高度按内容收缩——输入框
  浮在半空、下面留一大片空白。`.agent-not-ready` 补回 14px 内边距（原 padding 来自
  `.agent-body`）。
- **底部显示当前服务商**：`js/agentproto.js` 新增纯函数 `providerLabel(baseUrl)`
  （已知主机 → 展示名；OpenCode 按 `/zen/go` 与 `/zen` 区分 Go / Zen 两种套餐；未收录的
  主机回落为真实主机名，不猜服务商；未配置端点返回空串由调用方隐藏徽标），
  `js/agentui.js` 的 `renderModelLabel` 顺带渲染 `#agent-provider`（tooltip = 完整 Base URL），
  `index.html` 加徽标元素、`css/style.css` 加样式——「哪个模型、经谁的端点」在面板里可见。
- 冒烟新增两条断言：`chatBodyIsFlexColumn`（对话体必须是纵向 flex 容器，防回退成自滚动）
  与 `agentChatRendered` 内的**几何检查**（探针挂真实 `.agent-chat-root` 样式链 + 固定高度，
  输入区底边须与容器底边齐平 ≤3px——输入框若回到滚动视口内会立刻失败）。
- 重建 `vendor/assistant-ui/agent-chat.js`（266 KB）并更新 `vendor/SHA256SUMS`；
  依赖版本未变，`docs/THIRD-PARTY.md` 条目仍准确。
- `npm test` 778/778（新增 providerLabel 一条）、lint、smoke 全绿。

### 变更（设置页瘦身：去掉冗余说明与两个「静默失效」的勾选项）

- **动机**：设置页 18 个小节里有 22 条帮助文本、2321 字，最长一条 255 字；其中相当一部分是
  把同一件事说两遍、把内部实现写给用户看，或者已经有一条实时提示在显示同样的结论。勾选项里
  还有两个是「第二道静默门」——用户按提示配好了却不生效，且没有任何报错。
- **删掉「启用 AI 对话助手」勾选项**：运行时本就要求「开关 + 端点 + Key」三者齐备
  （`agentui.js` 的 `agentReady`），而 AI 栏位在未配置时自己会给引导——这个开关没有独立语义，
  却让「填好 Base URL + Key 但忘了勾」的用户静默退回手动模式。改为**端点与 Key 齐备即就绪**，
  小节顶部留一句说明（`fillSyncForm`/保存路径的 `#sync-agent-enabled` 读写与 settings 表写入
  一并移除；表里遗留的 `agentEnabled` 行成为孤儿数据，无害）。
- **删掉「每次保存后自动导出 BibTeX」勾选项**：导出条件原本是
  `!config.bibExportEnabled || !config.bibExportPath` 两者同时成立（`main.js`），用户选了 .bib
  路径却没勾框就不导出。改为**设置路径即启用**，并补一个「清除」按钮（原路径框只读、没有清除
  入口，去掉勾选框后必须有）；`integrations.js` 里随之失效的 `bibExportEnabled` 读写共 7 处
  （含加密配置载荷 `syncedConfigPayload`/`syncedConfigContent`/`applySyncedConfig`/`portableConfigView`
  与 `getConfig`/`saveConfig`）全部移除，远端遗留该字段时读端直接忽略。
- **删掉 EasyScholar 的接口技术说明**（175 字，含 `open/getPublicationRank` URL、限速与
  `xr/xrTop`/`pku`/`sciif` 字段代号）：属于集成开发文档，功能建议（中文刊优先选 EasyScholar）
  与「SecretKey 生成后不可更改」警告合并进申请入口那段。
- **删掉看不到的死文本**：`#pdf-index-stats` 的静态句（JS 会用统计结果整段覆盖它），连带
  `refreshPdfIndexStats` 的两句文案去掉「索引存储在本地 SQLite 数据库中」前缀。
- **同一事实不再说两遍**：备份去重（并入份数那段）、摘要回填链（只留在调研库小节）、
  上下文/输出默认值（placeholder 已写）、阿里云 `AccessKey ID@AccessKey Secret` 格式
  （选中该服务商时字段标签本身就会变成它）、「即时生效」（语言那句已声明）。
- **长说明改为让实时提示说话**：端点协议那段 255 字 → 一句「按 Base URL 自动识别，上方实时
  显示判定结果」；向量嵌入去掉「填空则沿用 AI 助手端点」与「向量空间」「超预算条目不重嵌」等
  实现细节（`#sync-embed-source` 已用与主进程同一份规则实时显示实际端点）。
- **去掉写给自己的实现名与营销语**：`data-paths.json`、`SQLite`、每主机节流细节、主题的
  「GitHub 生态最受推崇 Top 5」。底部提示改为回答用户真正的两个疑问：
  「改动即时保存，关闭窗口也会保存；『保存并同步』立即写入坚果云」。
- **保留**（看着像废话、实为约束，删了会变成踩坑后才明白）：「目录仅保存在本机，不随配置同步」、
  `.litbak` 备份、「设为 0 表示永不自动清理」、「其他位置的 PDF 不会移动」、「恢复后需重新配置
  扩展」、「调小份数不会立刻删文件」、「留空则保持原 Key」（9 处 placeholder，是写不完字段的
  唯一提示）；勾选项保留 `sync-auto-sync`/`sync-web-search-enabled`（出境告知载体）/
  `sync-auto-writeback`（会改用户文件）/`sync-translator-auto`/`sync-agent-autocompact`。
- 结果：帮助文本 2321 → 1740 字（-25%），>80 字的从 13 条降到 9 条，最长 255 → 144 字；
  勾选项 7 → 5。`npm test` 777/777、lint、smoke 全绿（i18n 词典同步增删 16 条）。

### 移除（设置页「加密配置同步」入口）

- 设置 → 云同步 下的「加密配置同步」小节（配置加密密码输入框与说明）整体去掉：该小节只有一个
  密码框，且**未设密码时整条链是空转的**（`syncEncryptedConfig` 取不到密码直接早退），属于
  低收益高困惑的配置项。
- 影响面：远端读取在无密码时本就跳过加密配置（`inspectNutstoreRemote` 的 `configPassword ? … :
  { exists:false }` 分支），**库与附件的远端恢复不受影响**；已存过的密码仍留在 `integrations.json`
  里（无 UI 可改，也不再作为产品入口）。渲染层 `syncFormValue` 不再提交该字段——主进程
  `saveConfig` 是「非空才覆盖」语义，缺字段不会抹掉既有值。
- 同步清理：`electron/main.js` 冒烟断言去掉 `configSyncPasswordPresent`（PROBE 与汇总两处）、
  `js/i18n-en.js` 删掉 4 条只属于该小节的词典条目（标题 / 标签 / 说明 / placeholder）。
- 主进程后端与 `test/sync.test.js` 的配置加密测试**保持不动**（能力仍在，只是没有用户面入口）。

### 新增（R19 临时全文链：agent 按需拉 OA 全文做参考，PDF 即删）

- **动机**：问「具体实验细节/方法学方案」时，旧链路两头都不合适——`read_pdf_pages` 只能读正式库
  已建索引的 PDF；`download_pdfs` 是写类工具（两次确认）且 PDF 永久留在会话附件目录。「仅作参考」
  的全文不需要留文件。对照 literature-mcp 的 `fetch_fulltext`（下载→docling 抽文本→临时 PDF 即删）
  落了同款纪律的 JS 版。
- **新工具 `read_work_fulltext(workId, fromChar)`**（无确认门，与检索入库同级；工具结果如实标注
  本次是联网拉取还是缓存命中）：缓存命中直接回文本窗口；未缓存则主进程下载 OA PDF（≤80MB、
  魔数 0x25 校验）到 `configDir/tmp-fulltext` → 渲染层 `LitPdf.extractText` 抽文本（与全文索引同一条
  PDF.js 管线，正文带【第 N 页】标记供引用页码）→ 文本存调研库 → **临时 PDF 立即删除**（抽取失败
  也删；启动时清扫崩溃残留）。窗口按 `fromChar/length` 续读（`nextFromChar` 游标），大文本不整段过
  IPC。要 PDF 本体仍走 `download_pdfs`（确认门不变）。
- **调研库 schema v3**：`works_fulltext` 侧表（正文与 works 行分离——元数据 upsert 不重写几十万字符
  大文本）+ `works_fts` 重建为五列（title/abstract/snippet/**fulltext**）：**全文进 FTS**，
  `search_research` 可命中只存在于正文的词；`getWorks` 带 `fulltextChars`。全文不在嵌入配方
  （title+abstract）内，不触碰向量行。v2→v3 迁移沿用 v1→v2 的分步重建模式（FTS 从 works+侧表回填）。
- **边界如实写明**（docs/limitations.md）：仅 OA 文献可拉（无 oaUrl 报错并建议改道）；扫描件/受保护
  PDF 抽不出文本（如实报错，可转 `render_pdf_pages` 视觉路线）；OpenAlex Content API（$0.01/篇）未接。
- 测试：research-db v3 五条（窗口读写与续读/全文 FTS 命中/元数据 upsert 不丢全文/v2→v3 迁移）、
  agenttools 三条（缓存窗口/首次拉取全链含临时文件回收/无 OA 报错）；冒烟
  `agentLitSearchToolsPresent` 扩入本工具与双 IPC。`npm test` 777/777、lint、smoke 全绿。

### 修复（Agent 三块完整性审计的 11 项问题，docs/audits/agent-completeness-2026-09-20.md）

**P1 四项（编辑提问 / 视觉消息 / 截图页码 / 当前文献）：**
- **H1 视觉截图注入后对话渲染崩**：同轮多条 user 消息共用 `turnId+':u'` 作 ID，
  assistant-ui 的 MessageRepository 因重复 ID 抛错进错误边界。`convertRun` 改为逐条唯一 ID
  （`turnId:u1/u2/…`，与 assistant 消息同款的计数器模式）；合成消息（截图/摘要）在快照
  metadata 里带 `synthetic` 标记，bundle 据此**不提供「编辑」入口**（编辑合成消息语义不成立）。
- **H2 点「编辑」没有输入框**：bundle 只挂了 ActionBar 的编辑按钮、没挂编辑态组件——按钮点了
  原文仍只读。`scripts/agent-ui-bundle/main.jsx` 新增 `UserEditComposer`（官方
  `ThreadPrimitive.Messages` 挂点，同一 ComposerPrimitive 组件族绑定编辑运行时，提交走
  runtime.onEdit → rerunTurn 截断重跑）并重建产物；`build.js` 补 `nodePaths`（外置工具目录里的
  react/@assistant-ui 此前解析不到，重建必失败）。冒烟把「悬停→点编辑→出现输入框→取消」
  全链路断言进去（autohide 的 hover 态挂在 MessagePrimitive.Root 上，enter 类事件不冒泡，
  模拟悬停要发到它本人）。
- **R1 截图页码固定偏移一页**：工具传 1 基页码、`renderPageToPng` 也按 1 基消费，app 适配器
  多加了 1（请求第 1 页渲染第 2 页、末页超界）。去掉 +1，渲染工具测试补「传出页码=请求页码」断言。
- **R2 切阅读标签后 Agent 认错当前文献**：`getCurrentPaper` 只看列表焦点，PDF/EPUB 阅读层
  切换不更新它——先开 A 再开 B 又切回 A 时，提问「这篇」冻结到 B。改为**阅读层可见时以正在读的
  那篇为准**（pdf/epub overlay 可见性 → pdfState/epubState.paper），否则回落列表焦点。

**检索正确性三项：**
- **S1 反向结论误判 supports**（复现：increases 生存率 vs decreases 生存率 → supports 0.833）：
  `litsearch` 增加方向词对核验（中英上升/下降词表），论点与证据句方向相反 → 极性不符 → partial；
  方向性论点遇**无方向词**证据句也降级 partial（「仅词面相关，方向未经证实」，要求模型转述原句）。
  这是词面级方向核验，不是语义级——工具描述与 limitations 如实写明。
- **S2 find_literature 年份条件执行时丢失**：yearFrom/yearTo 现贯穿全部召回路线（本地 FTS 参数、
  向量取回后过滤、OpenAlex keyword/semantic、Semantic Scholar `year=`、网页 `pub_year_min/max`），
  最终候选再按年份统一收口一次；年份未知的候选保留并在 notes 里报数量，剔除了多少也如实回报。
- **S3 本地多词检索实为连续短语**（复现：标题含 deep 与 learning，查 `deep learning` 返回 0）：
  `queryWorks` 改为空格分词 AND（每词各自命中即返回），显式引号仍是短语匹配；<3 字符的短词走
  LIKE 兜底（trigram 匹配不了）。

**可靠性四项：**
- **H3 手动压缩与发送并发导致停止失效**：主进程控制器按会话唯一，并发请求互相顶掉——先结束的
  请求现在只删**自己的**控制器（所有权校验）；渲染层 `compactBusy` 标记让手动压缩与发送互斥。
  回归测试复现审计场景：同会话两个并发请求，先结束者不得带走后者的停止入口。
- **H4 真实输入 token 未进持久化链**：`persistRun` 组装 doc 漏写 `lastInputTokens`——重载会话后
  压缩/掩码判定退回纯估算。已补写（blankDoc 显式置 0）。
- **R3 批注丢附件身份且只能取前 50 条**：`list_pdf_annotations` 每条带 `id`/`attachmentId`
  （主 PDF 与补充材料/EPUB 不再混淆），返回真实 `total`/`truncated`/`nextOffset`，新增 `offset` 续取。
- **R4 高密度页无页内续读**：`read_pdf_pages` 新增 `fromChar`（起始页页内偏移），每页返回
  `charOffset`/`charTotal`，页内截断时 `nextFromChar` 指向「偏移 + 本次取到的长度」——同页码 +
  fromChar 逐段读完整页，不再「从本页重新开始」。db 层 `pdfTextGetRange` 支持偏移透传。

- 测试：+9 条（S1 方向判定 2、S3 多词/短语、R3 分页与附件身份、R4 页内续读、R1 页码断言、
  H3 并发取消失效、litsearch/agent-net 各扩充）；冒烟 `agentChatRendered` 升级为编辑链路端到端
  （悬停→编辑→输入框）+ 同轮双 user 消息（重复 ID 回归防线）。`npm test` 770/770、lint、smoke 全绿；
  bundle 重建后已跑 `vendor-hashes`。

### 新增（Agent 上下文管理补齐：压缩 / 掩码 / 溢出自救，对照主流 harness）

- **背景**：此前唯一的上下文手段是「静默截断」（超预算丢最旧整轮）。2026-09-20 对照 Claude Code /
  Codex / Cline / Roo / Continue / Kilo / OpenHands / minimax-code 与 JetBrains《The Complexity
  Trap》后确认：业界通行的是**两档结构**（确定性削减 + LLM 摘要压缩）加**溢出一次性自救**，我们一档都没有。
- **压缩（compact，新模块 `js/agentcontext.js`，纯函数 Node 可测）**：活历史估算 token ≥ 可用输入的
  80% 时，把较旧整轮交给模型摘要成一条「上下文摘要」消息（结构化提示词：目标 / 已完成 / 涉及文献
  与 id / 待办 / 用户纠正；二次压缩把上一份摘要并入剔除过时内容）。被压缩消息只打 `compacted` 标记、
  **存储不删**（会话存档完整，Roo 非破坏式同路线），请求组装时跳过。切分铁律与 A04 同源：边界必在
  user 起头组、尾部原样保留（2k-20k token，对齐 Cline/minimax-code 的 20k）、最新真人提问永不入摘要。
  摘要调用走 `agent:chat` 新增的 `quiet` 通道——**流式不上屏**，用量照常计入 token 统计；压缩发生时
  会话里出现带「📦 [上下文摘要｜N 条历史已压缩…]」头部的可见消息，压了多少一目了然。
- **降级与自救**：设置关闭自动压缩时改为**旧工具结果掩码**（较旧 tool 消息 content 换占位行，
  `tool_call_id` 保留配对不破坏，请求视图专用不落盘——JetBrains 实测此法性价比不低于摘要）；端点报
  「上下文超长」类错误（多家中英文措辞识别）时**预算减半重建请求体重试一次**，仍失败如实报错，
  绝不无限重试、不依赖另一次成功的模型请求（Cline overflowRecovery 同纪律）。减半预算只在当轮生效。
- **用量回喂**：端点回报的 `prompt_tokens` 落到 `state.lastInputTokens` 并随会话持久化，压缩触发的
  估算以它为地板值——真实值一出，估算偏差自动纠正。
- **入口**：设置 → AI 助手 新增「自动压缩上下文」开关（默认开；关闭走掩码+裁剪）；会话头部新增
  「压缩上下文」手动按钮（生成中不可用，未超阈值如实提示「暂不需要压缩」）。

### 新增（Agent 文献检索能力补齐，对照 literature-mcp）

- 对照本地 literature-mcp（16 工具）盘点后补 4 个工具（应用内注册给模型，非 CLI/MCP）：
  **`get_work`**（DOI / doi.org、openalex.org 链接 / OpenAlex ID / 精确标题 → 解析元数据并入调研库，
  本地优先、OpenAlex 兜底，检索即入库幂等）；**`autocomplete_entity`**（作者/期刊/机构/出版商/资助方
  名称 → OpenAlex ID 联想，走既有主机节流队列）；**`graph_neighbors`**（库内引文邻接：它引用谁 /
  谁引用它，不扩边不联网，与 build_graph 互补；research-db 新增 `getRefsSnapshot` 轻量快照）；
  **`backfill_abstracts`**（把设置页的摘要回填链工具化：Crossref → Elsevier，综述前批量补齐）。
- 辅助阅读：`get_paper` 现在带 `lastReadAt`——回答「这篇讲到哪了」类问题时先对齐用户进度。
- 系统提示的工具清单同步更新；新 IPC（`research:get-work` / `research:autocomplete` /
  `research:graph-neighbors`）与 preload 桥接。

- 测试：`test/agentcontext.test.js` 13 条（阈值/边界/二次压缩/摘要封顶/掩码配对/溢出判定/减半预算）、
  `test/agentloop.test.js` +4（压缩钩子重建请求体、溢出减半重试、重试上限与无 context 降级、用量回喂
  持久化）、`test/agenttools.test.js` +4（四个新工具）与基础工具数修正、`test/research-db.test.js` +1
  （refs 快照）；冒烟新增 `agentContextMgmtPresent`（按钮/开关/纯函数层/压缩真的改写请求体）与
  `agentLitSearchToolsPresent`（四个工具注册 + IPC 面）。

### 新增（对齐上游 literature-mcp 的两处语义检索行为）

- **查询路径按需补嵌一批向量**（`electron/research-build.js` 新增 `topUp()`）：`semantic_search` 检索前
  最多补 50 篇缺向量的文献，解决「刚检索入库、还没轮到空闲增量构建，语义检索先降级成关键词」的窗口
  问题——这正是上游 `library_query` + `semantic_query` 的做法（上游上限 256，这里按「一次查询最多 50 篇」
  收紧）。纪律与自动构建一致：构建器正在跑时跳过（不重复计费）、存在持久失败标记时跳过并如实回报
  「上次构建失败，本次已按关键词检索」、失败即写标记不重试计费。测试：`test/research-build.test.js`
  新增 3 条（预算与增量、失败标记、未配置/在跑时零出网）。
- **联网检索默认偏新文献**（`js/agenttools.js`）：`search_openalex`（关键词 + 语义）、
  `search_semanticscholar`、`search_scopus` 不传 `yearFrom` 时默认只看 2022 年及以后，对齐上游
  `publication_year=">2021"` 的默认；**要早期经典文献显式传 `yearFrom: 0` = 不限年份**（写进工具描述，
  模型能自己判断）。返回里带 `yearFrom` 与一句说明，免得模型把「默认过滤后没检索到」讲成「没有早期
  文献」。本地库检索（`search_library`/`search_research`/`semantic_search`）与段落找文献
  `find_literature` **不加**这个默认——用户自己的库和「论点证据」不该被静默裁掉早期文献。
- 顺带修一处如实性缺口：`semantic_search` 工具此前把主进程返回的 `mode`/`note` 丢掉了，模型看不到
  「已按关键词降级检索」的说明；现在一并返回。测试：`test/agenttools.test.js` 新增 2 条。

### 移除（语义检索不再作为用户面功能，只作 AI 助手的工具）

- **问题**：「语义检索」在界面上散成好几处——设置里「语义搜索（可选）」一个开关 + 构建/清空索引按钮、
  搜索框的 `semantic:` 前缀、设置里「语义检索服务商（段落找文献）」一整块、AI 面板手动模式的「语义检索」
  按钮——而它真正的用途只剩一个：给 AI 助手当工具（本地向量 `semantic_search`、段落找文献
  `find_literature`、OpenAlex `search.semantic`、Semantic Scholar 相关度检索）。用户看到一堆开关，
  却不知道该用哪个，也不知道它们互相影响。
- **现在**：用户面入口全部撤掉，语义检索只由助手按需调用。
  - 设置 → 集成与服务 → 「语义搜索（可选）」整块删除；搜索框 `semantic:` 前缀与其提示文案删除
    （现在输入 `semantic:xxx` 就是普通子串检索，不再有隐藏语义）。
  - 正式库那条链整体删除：`semantic:*` 四个 IPC、preload 的四个方法、`db.js` 的 `vecPut/vecSearch/
    vecStats/vecClear`、`integrations.embedTexts`（借划词翻译凭据的嵌入实现）。**schema v7**：迁移时
    落 `.pre-v7.bak` 后 `DROP TABLE paper_vec`（旧向量行对任何代码都不再有意义，留着只会被压进每份快照）；
    `deletePaper` 相应不再清该表。
  - 设置 → 「语义检索服务商（段落找文献）」整块删除，手动模式的「语义检索」按钮删除。随之
    `openalexSearchEnabled` / `semanticscholarEnabled` 两个供应商开关连同 `cfg` 门控与「已在设置中关闭」
    的 notes 一并移除：**OpenAlex（关键词 + 语义）与 Semantic Scholar 召回常开**（它们本就是元数据补全
    一直在用的公开只读接口）；`semanticscholarApiKey` 仍在 设置 → 检索与元数据服务（仅影响配额）。
    科研网页检索（TinyFish）的开关 + 出境告知**不受影响**，仍是双重门控。
  - 同步配置里的 `semanticEnabled` 一并移除（portable 设置与云端 config payload）；旧远端文件里的该字段
    被忽略，不再写回。
- **AI 助手的语义检索改由向量模型就绪驱动**（不再要求另开一个开关）：`agentui.semanticReady` 直接读主进程
  按 `js/embedcfg.js` 算好的 `config.embedReady`；主进程新增 `scheduleAutoEmbed()`，60s 空闲巡检与
  「检索入库后自动嵌入」都先判向量模型是否配齐，就绪才走 `maybeAutoBuild`（失败批次的持久
  `embedFailedBatch` 标记照旧生效，零新增请求）。**注意**：配置齐备即可能自动发起嵌入请求（此前需要
  再勾一次「启用语义搜索」），设置页「向量嵌入（调研库）」里有用量展示与手动「构建 / 更新向量索引」。
- 测试：`test/db.test.js` 的 v3→v4 迁移用例同时断言 v7 的 `DROP TABLE paper_vec` 与 `.pre-v7.bak`；
  `test/sync.test.js` 的 portable 配置用例改用 `autoWriteBack`；`test/i18n.test.js` 双向覆盖照旧全绿
  （词典中该功能的条目已同步清理）。冒烟断言 `agentFindLiteraturePresent` 改为只断言仍然存在的
  IPC 面、纯函数层与工具注册。
- 文档：`docs/limitations.md`（语义检索只有一条链、联网检索常开）、`docs/roadmap.md` B-1（范围收缩，
  已落地的只有「独立向量嵌入接入」那一半）、AGENTS.md（M9-2 / M9-6 / 存储与 DB_VERSION）同步更新。

### 移除（阅读器「AI 解释」）

- 阅读器划词弹层的「AI 解释」按钮（`#pdf-explain-selection`）连同 `agentui.explainSelection` 全链路移除
  （用户反馈：无实际作用）。撤掉的包括：选区冻结进轮上下文（`pendingSelection` / `frozen.selection`、
  系统提示的「用户选中的内容」段、上下文 chips 的「选中：第 N 页」）、vision 模型下的当前页截图注入
  （`capturePageImage` → `persistImages` 的 dataUrl 落附件路径），以及只为它存在的 `sendText` 的
  `opts.images` 入参。
- **保留**：agent 的 `read_pdf_pages` / `list_pdf_annotations` / `render_pdf_pages` 阅读工具与页面渲染
  生产端（`LitPdf.renderPageToPng`，`includeVisionRender` 门控）——「结合该页理解」仍可由对话里的工具
  组合承担；`appendUser` 的 `{text, images}` 形态保留（agentloop 合成消息在用）。`watchReadingRail`
  （阅读时右栏可达性）与选区弹层其余按钮（高亮 / 下划线 / 批注 / 翻译 / 自动翻译）不受影响。
- smoke 的 `agentReaderPresent` 不再断言该按钮；词典清理 10 条孤儿词条。

### 新增（AI 助手的上下文与输出上限可配置）

- **旧行为**：上下文预算是 `js/agentui.js` 里写死的 24000（估算 token），单轮输出上限只有
  Anthropic 形态被迫下发 8192（`js/agentproto.js` 的兜底），chat / responses 形态根本不发
  `max_tokens`——用多大输出全看端点默认值。用户既看不到、也改不了。
- **现在**：设置 → AI 助手（OpenAI 兼容）新增「模型上下文（tokens）」与「最大输出（tokens）」，
  **留空即用默认值**：上下文 256000、输出 12800（默认值唯一权威在 `js/agentcore.js` 的
  `DEFAULTS`，别处不再写第二份数字）。面板上的模型名 tooltip 会显示本轮实际生效的两个值——
  改了设置没生效能一眼看出来。
- 上下文预算是**整份请求**的上限：先扣掉系统提示与工具 schema 占用的估算 token，再按完整
  对话组（user 起头）从最旧整轮开始丢弃。同时把消息条数窗口从写死的 40 条改为随预算放大
  （`historyCapFor`：≈1 条消息配 1000 token，上限 400 条）——否则 256k 预算会被 40 条上限
  提前截断，等于设置没生效。
- 最大输出落成 `body.max_tokens`，由协议层按形态改写：responses → `max_output_tokens`，
  Anthropic Messages 必填（保留内部兜底值）；chat 形态下 **OpenAI 官方推理系模型（o 系 / gpt-5）
  改发 `max_completion_tokens`**——它们对 `max_tokens` 直接 400，其余模型仍按 `max_tokens` 发
  （第三方兼容网关普遍只认这个字段）。
- 两项预算随对话上下文**按轮冻结**（A11）：生成途中改设置不影响进行中的那一轮，恢复/重跑旧轮
  仍用当时的预算。
- **如实写明的边界**（写进设置页提示）：预算按估算 token（CJK 1 字 ≈ 1 token、西文 4 字符 ≈ 1 token）
  计算，与端点的真实分词器有出入；部分模型对输出上限另有硬要求（Kimi 思考模型做多步工具调用
  要求 ≥ 16000，而默认 12800 低于该值），遇到端点报错请据此调整——不静默抬值。
- 测试：`test/agentcore.test.js` 新增 6 条（默认值 / `max_tokens` 下发与取整 / 系统提示与工具
  schema 计入预算 / 极小预算兜底 / `historyCapFor` 边界 / 按次条数窗口），`test/agentproto.test.js`
  新增 2 条（o 系与 gpt-5 改发 `max_completion_tokens`、三种形态的输出上限字段映射）；冒烟新增
  `agentBudgetSettingsPresent`（两项设置 UI + 默认值 + 预算真的落进请求体）。

### 变更（调研库向量模型有了自己的 provider / API Key）

- **问题**：「向量嵌入（调研库）」这一段只有「嵌入模型名」可填，Base URL 与 Key 借用 **AI 助手**的
  端点与凭据——用户没法换嵌入服务商，也看不出这段实际在用谁的 Key；服务商一换（例如嵌入想走
  OpenAI、聊天继续用别的）就只能改聊天配置。
- **做法**：给它一套独立配置——`js/embedcfg.js` 是唯一权威规则（服务商预设 DashScope / OpenAI /
  本地 ollama + `resolveTarget`），`electron/embed-net.js` 是唯一出网实现（分批请求、按 index 对齐、
  用量记账、连通性测试），消费方三条链都换成它：AI 助手的 `semantic_search` 工具、段落找文献的
  本地向量召回、`research-build.js` 的空闲增量构建（`agent-net.embedTexts` 随之删除，嵌入不再是
  聊天客户端的职责）。设置页新增服务商下拉（选预设自动填 Base URL + 模型名）、Base URL、API Key、
  「测试向量模型」（走表单里尚未保存的值）、以及**实时来源提示**「调研库向量将使用上面这套独立配置：
  …/embeddings」或「未填独立配置：沿用 AI 助手端点 …」。
- **解析链**（如实、不偷偷换账号）：专用配置齐备 → 用专用端点；**只填了一两项 → 直接报「配置不完整」，
  不回退**；完全没填 → 沿用 AI 助手端点 + 嵌入模型名（历史路径，既有向量不失效）。渲染层就绪判定
  改读主进程算好的 `config.embedReady`，设置页提示与实际发包地址出自同一个纯函数。
- **边界**：单批条数按预设 → 主机名（DashScope 系 10 条）→ 默认 16 推断，不提供手填（遇更严限制的
  本地上游需在预设表增补）；换模型即换向量空间，检索按 model + recipe 过滤，重建前不会混检出虚假高分。
- **范围**：正式库搜索框的 `semantic:` 检索**不在本次范围**——它仍走 `integrations.embedTexts`
  （翻译服务商凭据）与 `paper_vec` 索引，两条链的配置与索引范围彼此独立。
- 测试：新增 `test/embedcfg.test.js`（预设 / 批量推断 / 解析链，含「半填不回退」）+ `test/embed-net.test.js`
  （分批与 index 对齐、用量回调、上游错误不重试、表单覆盖值测试；原属 agent-net 的两条嵌入用例随实现迁移）；
  `test/research-build.test.js` 改为注入 `embed` 服务并断言来源字段；smoke 增 `#sync-embed-provider` /
  `#sync-embed-base-url` / `#sync-embed-api-key` / `#sync-embed-test` 与 `embedTest` 桥接断言。

### 修复（AI 助手接不上 OpenCode 套餐 / Anthropic 兼容端点）

- **根因一：缺 `x-opencode-session`**。OpenCode Zen / Go 网关要求每个会话带一个**稳定**的会话 ID
  用于路由与 prompt 缓存，缺了直接 HTTP 400 `MissingSessionID`（实测报错原文：
  「Request is missing x-opencode-session and cannot be routed efficiently」）——用户用 OpenCode Go
  套餐时「测试连接」即失败。现在凡 `opencode.ai` 主机都自动附 `litboard-<会话ID>`（连接测试用固定
  身份），并带上自有 User-Agent（网关明确要求客户端不要用通用 HTTP 库名）。
- **根因二：「OpenAI 兼容」其实有三种协议形态**。同一网关按模型系列分流：`/chat/completions`
  （GLM / Kimi / DeepSeek / MiMo）、`/responses`（Grok / GPT 系）、`/messages`（MiniMax / Qwen 系，
  Anthropic Messages 形态）；`api.anthropic.com` 与 DeepSeek / 智谱 GLM / Z.ai 的 `/anthropic`
  端点同属第三种。旧实现只有 chat 一种形态，这些端点要么 404 要么 400。
- **做法**：新增 `js/agentproto.js`（纯函数适配层，Node 可测）——三种形态的 URL、鉴权头
  （`Bearer` / `x-api-key` + `anthropic-version`）、请求体转换（system 提到顶层、工具结果并进 user
  消息块、工具 schema 用 `input_schema`、`max_tokens` 必填、`image_url` data URL → base64 `source`）
  与 SSE 累积器（`response.*` 事件 / `message_start` + `content_block_delta`）全收一处；
  `electron/agent-net.js` 只按形态分发，chat / responses / messages 都归一成同一份
  `{content, reasoning_content, tool_calls}`——渲染层与 agentloop 不需要知道自己跑在哪种协议上，
  流式、停止、截断判定（`finish_reason` / `stop_reason` 各自映射到同一口径）、工具续轮照旧。
  协议形态与会话一起进 R03 的按轮固定，生成途中改设置不会让同一轮中途换协议。
- 判定顺序：设置里的「接口格式」显式指定 → URL 尾段（`/messages`、`/responses`、`/anthropic`）→
  `api.anthropic.com` → OpenCode 端点按模型系列（Grok/GPT 系 responses、MiniMax/Qwen 系 messages）
  → chat。设置页新增「接口格式」（自动识别 / 三种显式）与**实时提示**：
  「将按 Anthropic Messages 发包：https://…/v1/messages」，Base URL 或模型名一改就更新。
- 预设从 6 个扩到 15 个（OpenCode Go / OpenCode Zen / OpenAI / Anthropic / DeepSeek / DeepSeek
  Anthropic 兼容 / Kimi / 智谱 GLM 及其 Anthropic 兼容 / Z.ai / 通义千问 / OpenRouter / 硅基流动 /
  本地 ollama），每项带模型名提示。
- **如实写明的边界**：Anthropic Messages 形态下，OpenAI 侧的 `reasoning_effort` 与
  `thinking.type=disabled` 一律不下发（发过去只会 400），思考与否跟随端点默认，只透传 Anthropic
  原生 `thinking:{type:'enabled',budget_tokens}`；Responses 形态固定 `store:false` 且不做 reasoning
  回放（`docs/limitations.md` 已登记）。
- 测试：`test/agentproto.test.js`（13 条：判定 / 端点 / 请求头 / 三种请求体转换 / 两种新累积器，
  含坏 JSON 工具参数退化、不支持的图像类型丢弃）+ `test/agent-net.test.js` 新增 5 条端到端
  （含 `x-opencode-session` 缺失即 400 的回归断言、Qwen 模型自动改走 `/v1/messages`、
  显式格式优先、连接测试与模型清单跟随同一判定）。

### 变更（顶栏增设「设置」入口）

- **「设置」从 `···` 溢出菜单提到顶栏明面**（`index.html` + `css/style.css` + 新图标 `lb-i-settings`）：
  界面语言在 设置 → 偏好，而设置本身先前只藏在「更多操作」菜单里——等于双语界面根本没有可见入口，
  与当年 Word/扩展面板被投诉「看不到」是同一个坑。现在右栏工具簇为
  `撤销 · 重做 ·（通知）· 导出`｜`同步状态 · 主题 · 设置`｜`···`，设置用滑杆式图标（两条横线 + 实心旋钮）——
  刻意不用齿轮：齿轮与主题按钮的太阳/月亮在小尺寸下都是「圆 + 放射」，容易看混。`···` 菜单只留
  粘贴 BibTeX / 插入引文（Word）/ 浏览器扩展（那条多余的 `<hr>` 一并去掉）。
- 冒烟新增两条断言守住这次改动：`settingsEntryInTopbar`（设置按钮必须挂在 `.topbar` 里且
  `closest('.menu') === null`，不许再藏回菜单）、`topbarNarrow`（主进程把窗口压到 minWidth 1080
  实测：`.topbar-actions` 的 `flex-wrap` 仍为 `nowrap`、各按钮 top 差 ≤3px（未换行）、
  `scrollWidth - clientWidth <= 1`（不横向溢出））。实测 1082px 档：topSpread 2、overflow 0。

### 变更（点中间条目时右栏切回详情）

- **右栏停在 AI 或手动检索面板时，点中间列表的条目现在会切回详情页**（`js/app.js`）：详情面板
  `#panel-detail` 被 `switchPane()` 整块 `hidden` 后，`openDrawer()` 只是把内容写进隐藏面板——
  用户看到的是「点了没反应」。新增 `openDrawerAndReveal(id)`（先 `LitAgentUi.switchPane('detail')` 再
  `openDrawer`），并接到四个「用户主动打开某条文献」的手势上：表格行单击、附件子行、键盘 Enter、
  右键「打开详情」、相关文献链接。内部那些「刷新当前抽屉」的调用（撤销/重做、补全、编辑保存、
  同步应用、批量编辑——共 7 处，形如 `if (drawerId) openDrawer(drawerId)`）**仍走 `openDrawer`**，
  否则正在对话的用户一按撤销就被拽出 AI 面板。
- 冒烟新增 `railSeedRow` / `railPaneSwitchesToDetail`：冒烟库初始为空，故先用「粘贴 BibTeX」
  （纯离线、确定）造一条数据，切到 `#btn-agent` 面板后点该行，断言 `#agent-drawer` 隐藏、
  `#panel-detail` 与 `#drawer` 可见，且 `#d-title` 就是被点那条（不只是面板翻过来）。

### 变更（README 中英双语分开）

- **README 拆成英文主文档 + 中文全文**：`README.md` 改为英文（GitHub 默认落地页），顶部居中放应用图标、
  一句话定位与语言切换（`English · 简体中文`），正文按「收集 / 阅读 / 批注与摘录 / 笔记 / 整理与检索 /
  引用与写作 / 同步与备份 / AI 调研助手 / 界面语言 / 主题」分组重写，补上此前 README 一直没写的
  EPUB 阅读器、PDF 重排、富文本笔记、Word 写作集成与 M9 四期 AI 调研助手；`README.zh-CN.md` 承接原中文全文
  （快速开始、备份与数据库安全、联网与隐私、API 凭据、扩展安装、开发与构建、文件结构、许可），
  并同步补齐同样的功能分组，两版互相链接。顺带更正两处过期数字：内置 CSL 样式是 **11** 种（原写 8），
  内置主题是「亮暗 + 跟随系统 + 10 套具名主题」。
- 随之修正引用中文小节名的文档指向：`docs/limitations.md` 里「界面语言为中文、国际化在 M8」已过期
  （双语界面早已落地），改为如实描述（扩展弹窗与 Word 桥仍只有中文）；`docs/THIRD-PARTY.md`、
  `docs/releasing.md`、`.github/ISSUE_TEMPLATE/bug_report.yml` 与 CHANGELOG 中指向 README 小节的链接
  一律改指 `README.zh-CN.md`（英文版无同名的中文小节）。

### 变更（PDF 拖选精度）

- **拖选不再「晃一下就带上下一段」**（`js/pdfimport.js`）：文本层行盒（约 1em 高）之间的空隙通常只有几像素，原生拖选端点一旦越过上一行行盒下缘，浏览器就把选区扩展到下一行行首——本想选到段尾，手稍微一晃就选中下一段。现在拖选期间按鼠标位置做**焦点行进入判定**（纯函数 `focusLineTrim`：鼠标必须在焦点方向上真正进入该行行带，越过行带边界约 0.3 倍行高、3–10px 封顶；行距/段间距本身提供额外宽容度），未真正进入的行从高亮、提取文本、批注坐标中整体剔除；竖排/旋转文本行不参与判定。松手时把原生选区一次性收缩到与高亮一致（`applyDragEndCorrection`），保证 Ctrl+C 复制内容、翻译弹层定位与所见高亮一致。拖选中容器滚动（自动滚屏）会使 clientY 与行带坐标错位，判定自动停用、待下次鼠标移动恢复；键盘选区（Shift+方向键）不受影响。

### 变更（顶栏按钮分区布局）

- **顶栏从「中间悬浮一排散按钮」改为左右分区**（`index.html` + `css/style.css`）：此前品牌、主操作、
  `···`/同步/撤销/重做/导出/主题挤在一个 `.topbar-actions` 里靠 `space-between` 悬在顶栏正中，四个小图标
  （···、⇅、↶、↷）连成一排意义不明的「点点」，且 `···` 夹在主操作中间。现在拆成两个 flex 子项：
  - **左**（`.topbar-left`）：品牌 + 主操作（导入文件 / 添加 / 一键补全 + 中断补全）；
  - **右**（`.topbar-right`）：工具簇，按语义分组、以 1px 分隔线（`.topbar-sep`）区隔——
    `撤销 · 重做 ·（通知）· 导出`｜`同步 · 主题`｜`更多 ···`；`···` 移到最右（Windows/浏览器惯例的
    catch-all 位置，其菜单本就 `right:0` 向左展开，贴右缘不出窗）。
  - 1080（minWidth）档用 CDP 强制视口实测：左右两簇 270/386px，中间留白 ~395px，`scrollWidth == clientWidth`
    无溢出无换行；smoke 断言全部通过（元素 ID 未变）。菜单打开/点击外部关闭逻辑不依赖结构顺序，无 JS 改动。

### 变更（界面中英双语）

- **新增界面语言：简体中文 / English**（`js/i18n.js` + `js/i18n-en.js` + 设置 → 偏好 → 界面语言）：
  - **架构**：以 zh-CN 源串为键的轻量翻译层——代码里文案写中文原文、经 `T()` 包裹，英文译文集中
    在 `js/i18n-en.js` 词典（约 1700 条，覆盖主界面/阅读器/同步/备份/导入/Zotero 向导/主进程对话框全部
    用户可见文案）；zh-CN 恒等返回，未命中键也回退中文原文，界面永不出现空洞。`js/i18n.js` 是 UMD 双出口，
    主进程（`electron/main.js`）与渲染层共用同一词典。
  - **静态 HTML 零标记接入**：启动时 `LitI18n.applyStatic(document)` 按词典整串替换文本节点与
    title/placeholder/aria-label（此时文档里只有界面骨架、没有用户数据，精确匹配不会误伤文献标题/笔记；
    节点打 `data-i18n` 标记，语言切回 zh 时按 `data-i18n-orig` 还原）。语言切换即时生效：静态骨架重译 +
    应用层全量重渲染，无需重启；语言偏好存 localStorage（`litboard.lang`，支持「跟随系统」），并镜像进
    settings 表 `uiLang` 供主进程原生对话框取文案（`settings:set` 时主进程即时跟随）。
  - **数据不翻译**：批注值「北核」、导入回退标题「(无标题)/(未识别标题)」、BibTeX 导出占位等存库/出库
    字段保持中文源串，不随界面语言变化；引文渲染（cite.js/CSL 输出）也维持原样——界面语言 ≠ 引文语言。
  - **维护工具**：`scripts/i18n-codemod.js`（`wrap` 包裹新文案 / `keys` 提取键 / `html` 提取静态串）、
    `scripts/i18n-en-merge.js`（分块译文合并成词典）、`scripts/i18n-space-fix.js`（对齐片段键首尾空格）；
    `test/i18n.test.js` 校验 t()/setLang/pick 行为与「全部 T() 键 + index.html 静态文案 ↔ 词典」的双向覆盖，
    漏译会挂 CI。smoke 测试强制 zh-CN（CI 多为英文系统，主进程断言界面中文文本），渲染进程经 preload
    暴露的 `litboardDesktop.isSmokeTest` 生效（沙箱渲染进程拿不到 `process.env`）。
  - 界面语言只影响显示；浏览器扩展弹窗与 Word 桥为独立进程/页面，本期维持中文，待后续统一。

### 变更（同步附件核对凭本机签名免读盘）

- **附件/快照同步新增签名快捷路径**（`electron/integrations.js`）：附件阶段的进度条把「逐个核对」也计入
  done/total，此前每次同步都要把全部附件读盘 + 重算 SHA-256（几百个附件时是同步的主要本地开销），即使内容
  纹丝未动。现在每个附件在核对通过后记录 `syncSignature` = 记录时 cloudHash + size + mtimeMs（截断），下一轮
  同步 stat 一致即直接按 verified 处理，免读盘免哈希；快照目录同理以「文件清单哈希（路径+大小+mtime）+
  cloudHash」为签名，免重读全部文件重新打确定性 ZIP。签名内嵌 cloudHash：多设备合并采纳远端 cloudHash（本机
  签名沿用）时旧签名自动失效、退回逐字节核对，不会漏掉本该重传的差异；远端清单明确缺该对象时同样不跳过。
  下载落盘改记实测 stat 签名（此前记下载时刻，永不匹配），首轮核对后即进入快捷路径。批注快照 PNG 与笔记资产
  不参与（schema 不保留其 syncSignature）。纯函数 `assetLocalSignature`/`assetSignatureUnchanged` 已导出，
  测试 `test/asset-signature.test.js`。

### 修复（顶栏窄窗挤压变形）

- **窗口缩窄后顶栏按钮换行溢出、品牌胶囊压成竖排**（`css/style.css`）：`.topbar-actions` 在定高 52px 顶栏里
  `flex-wrap: wrap`，一窄按钮就换到第二行、溢出条外盖住下方内容；`.brand` 无收缩保护，「文献阅读仪表盘」胶囊被压扁
  成文字逐字竖排的小圆点；`.menu-wrap`（撤销/重做/导出）是 block 容器，作为 flex 子项被压窄后内部按钮也会换行竖排。
  三处现在全部禁止收缩/换行，空间不足改由媒体查询逐级收纳：≤1420px 收起副标题、≤1240px 收起品牌名（仅剩 logo）、
  ≤1150px 压按钮内边距/间距/字号——1080px（窗口 minWidth）最窄档实测带「补全中 N/M」长文案仍单排放得下
  （用外部 Electron 在 12 档宽度下量过 `scrollWidth`/行数/窗口控制按钮间距）。

### 变更（主题体系对比度增强：暗色白字提亮、亮暗三栏纵深）

- **暗色白字提亮**（`css/style.css`）：默认深色/Catppuccin Mocha 主文字 `#cdd6f4 → #e2e8f7`
  （次级 `#a6adc8 → #b0b9cf`），Tokyo Night `#c0caf5 → #d5dcf8`，One Dark `#abb2bf → #d7dae0`
  （次级 `#828997 → #9ba3b1`）；Dracula 与 Nord 主文字本已近白，未动。
- **三栏背景纵深**（`css/style.css`）：新增 `--sidebar-bg` 令牌，左右栏底色统一比中间内容区深一层，
  亮暗两套主题及全部 11 个具名主题各自配置（暗色如 Mocha 侧栏用 crust `#11111b`、页面保持 mantle；
  亮色如 GitHub Light 侧栏 `#eceff3`、页面 `#f6f8fa`），三栏不再一片平色。

### 修复（主题按钮菜单弹出即消失）

- **顶栏主题按钮点击无反应**（`js/app.js`）：`showThemeMenu` 用左键 click 弹出自定义菜单，但同一次
  click 会冒泡到 document 级「点击 ctx 菜单外部即关闭」监听，菜单创建后立刻被销毁——表现为点按钮
  毫无反应。现在按钮处理器 `stopPropagation()`（与 `#btn-export` 同一做法），菜单正常弹出；
  Shift+点击循环切换保留。

### 修复（启动诊断日志；退出清理硬超时，不再留无窗僵尸进程）

- **启动里程碑落盘 `litboard-startup.log`**（`electron/main.js`）：打包版没有控制台，「任务管理器里有
  LitBoard 进程但窗口一直不出来」这类问题发生时无从定位（事件日志与 WER 都没有应用本体的崩溃记录，
  因为进程没有崩溃、只是没建窗或静默退出）。现在把启动各里程碑——单实例锁获取/未获取、数据目录就绪、
  数据库打开耗时、主窗口创建、second-instance 接管、退出清理——按时间戳写入配置目录的
  `litboard-startup.log`（跟随自定义数据目录），整体重写、失败静默，出问题看最后一条即知卡点。
- **退出清理硬超时**（`electron/main.js`）：`will-quit` 的收尾链（渲染层确认 → 桥接停止 → 数据库
  checkpoint）若因文件锁/IO 异常永不结束，会留下「进程活着但没有窗口」的僵尸占着单实例锁，之后每次
  启动都静默退出。现在收尾开始 8 秒后强制 `app.exit(0)`。

### 变更（表格斑马纹；作者列只显示第一作者 + 等）

- **条目深浅色交替**（`css/style.css`）：文献表加 Zotero 式斑马纹，偶数行铺 `--row-alt`
  （亮色 rgba(15,23,42,.028) / 暗色 rgba(205,214,244,.045)，两套主题各自适配），按可见行序统一
  编号——附件子行也参与交替（去掉其不透明底色，靠虚线分隔与缩进区分），展开/折叠后条纹连续不断。
  条纹规则排在 detail-active / :hover / selected 之前，选中、悬停与详情联动高亮始终覆盖条纹。
- **作者列精简**（`js/app.js` `authorsShort`）：多作者条目由「Jia, Yikai 等 7 人」改为
  「Jia 等」——取第一作者姓氏（逗号前），去掉人数；单人条目仍显示全名。

### 变更（暗色主题重调为 Catppuccin Mocha；搜索框醒目化；修复主题切换卡色）

- **暗色主题整体换用 Catppuccin Mocha 官方色板**（`css/style.css`）：之前暗色是自拟的蓝灰中性色，
  层次感弱。现在暗色半边全部取自 [Catppuccin](https://github.com/catppuccin/catppuccin)（GitHub 当前
  最流行的主题项目）Mocha 官方色值：页面 mantle `#181825`、卡片 base `#1e1e2e`、浮层 surface0
  `#313244`，文字 text/subtext0/overlay1 三阶，强调色 blue `#89b4fa` + sapphire `#74c7ec` 渐变，
  语义色换 green/yellow/red 柔和三件套。亮色主题一字未动。实心强调底（主 PDF 徽章、主按钮、危险
  按钮、onboard 序号、通知角标等）文字由写死白色改用 `--on-accent`（暗色下自动变 crust 深字，保证
  浅色强调底上的对比度）。
- **搜索框醒目化**（`index.html` `css/style.css`）：主搜索框原来与背景几乎融为一体。现在包一层
  `.search-wrap` 内嵌放大镜图标（复用 `#lb-i-search` 雪碧图），底色抬升为 surface-2、边框加重为
  border-strong、高度增加，聚焦时亮起 accent 外环；对照弹窗里的紧凑搜索框（`.search` 类复用处）只
  继承新配色，不加图标缩进。
- **修复运行时切换主题整片卡在旧色**（`js/app.js` `css/style.css`）：Chromium 的 light-dark() 在
  「声明文本不变、仅 color-scheme 变化」时，对带 `background-color` 过渡的元素不会重解析——点顶栏
  主题按钮后 body、搜索框等大面积元素停留在切换前的颜色（隐藏元素不受影响，因此此前未被发现）。
  现在 `applyTheme` 切换瞬间给根节点挂 `theme-switching` 类禁用过渡强制重算，双 rAF 后移除；
  实测 亮↔暗↔自动 往返全部正确翻色。

### 变更（表格附件展开箭头与子行树形指示更醒目）

- **展开箭头与标题行垂直居中**（`css/style.css`）：`.t-title-row` 由 `align-items: flex-start` 改为
  `center`，附件展开按钮（`›`）不再顶在标题上缘，而是与标题行的垂直中点对齐；按钮从 18px 加大到 20px、
  图标 14px、默认色由 muted 提到 secondary，展开态整钮染主题蓝（悬停浅蓝底），收起/展开状态一眼可辨；
  `.row-expand-spacer` 与 `.t-sub` 缩进同步到新宽度，无附件行与副行对齐不变。
- **子行 `↳` 树形指示加强**：12px/muted/0.7 透明度改为 14px/secondary/不透明，附件子行与父行的从属
  关系更清楚。

### 修复（index.html 漏加载 js/query.js，检索引擎从未生效）

- **补上 `<script src="js/query.js">`**（`index.html` `electron/main.js`）：`js/query.js`（阶段四检索引擎，
  UMD 双出口、Node 可测）一直存在于仓库、单测也一直在跑，但 index.html 的脚本清单里没有它——浏览器里
  `window.LitQuery` 从未定义，全部 `field:value` / `year>=2020` / `missing:` / `folder:` / `ann(...)` 语法
  与智能文件夹 AST、可视化构建器都在静默退化成普通子串搜索（app.js 各处都有 `window.LitQuery ? … : 降级`
  守卫，所以从未报错，也因此没人发现）。单元测试直接 require 该文件所以 CI 全绿；smoke 只查 DOM 存在性
  同样照过。现在脚本在 app.js 之前加载，并新增 smoke 断言 `queryEnginePresent`（`LitQuery.parseAst/compile`
  必须存在）加入通过门槛，防止再次漏载。

### 变更（统计面板瘦身：去「本周新增」、缺字段可点击筛选、整体可收起）

- **去掉「本周新增」指标块**（`index.html` `js/app.js` `css/style.css`）：该指标只对细水长流式积累有意义，
  批量导入后「近 7 天新增」等于全库总数，看起来像 bug。信息降级为收起态摘要行里的一小段
  （「3514 篇 · 本地 PDF 8% · 近 30 天 +3514」），展开面板时不再单独占一块。三个指标 tile 与年份图
  改为一行四列排开（窄屏两列 + 图占满整行）。
- **元数据完整度：百分比降级、缺字段计数变成筛选入口**：等权平均出的百分比只是辅助信息（改小号灰字），
  「缺 DOI 422」「缺摘要 75」改为可点击，点了直接把 `missing:doi` / `missing:abstract` 填进搜索框执行
  检索（查询引擎本就支持），从展示变成行动入口；对应计数为 0 或库为空时按钮隐藏。
- **统计面板可整体收起**：年份图标题行右侧新增收起按钮（›，与文件夹折叠同一符号语言），收起后整个
  面板只剩一行摘要条（总数 · PDF 覆盖 · 近 30 天新增），点摘要条展开；状态记在
  `localStorage litboard.statsCollapsed.v1`，下次启动保持。

### 变更（PDF 全文索引：统计显示总量、新增「构建索引」按钮）

- **设置页统计改为「已索引 X / Y 篇」**（`js/app.js` `index.html`）：全文索引是惰性构建的（首次全文检索
  或 OCR 时才提取正文入库），从未建过索引时统计恒为 0，「刷新统计」按钮因此看起来像坏了。现在统计
  同时显示库内带本地 PDF 的附件总数与已索引数，未建满时提示「其余 N 篇在首次全文检索时自动构建，
  也可点『构建索引』立即生成」。
- **新增「构建索引」按钮**（`js/pdfsearch.js` `js/app.js` `index.html`）：把检索前「提取缺失/过期正文」
  的逻辑抽成 `indexUnits`/`staleUnits`，新增导出 `reindex(papers, onProgress)`——不带查询、只建索引，
  3 并发、单篇失败不阻塞、按指纹跳过最新条目。点击后立即补齐全库索引，构建期间按钮禁用、内联状态
  显示进度，完成后自动刷新统计。「刷新统计」行为不变，`searchDesktop` 改为复用同一套索引逻辑。

### 变更（参考文献表独立起段；去掉表格选中行的竖向条纹）

- **参考文献域首次创建时独立起段**（`word/wordbridge.js` `updateBibliography`）：插入引文后自动刷新会把
  参考文献域建在文档末段，而刚插入的引文恰好就在这一段里——参考文献条目直接跟在正文引文后面挤成一行
  （表现为「[1][1]Tian J, …」没有换行）。现在创建前检查文末倒数第二个字符，不是段落标记就先补一个
  段落标记再建域；旧版保存的参考文献域若也被挤在引文同段（域所在段落、结果起点之前还有别的内容），
  刷新时检测出来删除并按创建路径重建到文末独立段，引文段保持原样。「参考文献表」按钮（BIB）走同一
  分支，同样受益。注意 `wordbridge.js` 由常驻 cscript 进程加载，改动需重启应用生效。
- **去掉文献表格选中行的竖向条纹**（`css/style.css`）：`tr.focused td` 每个单元格左缘 2px 竖线与
  `tr.detail-active td:first-child` 的 3px 竖线在深浅主题下都显得杂乱，按反馈移除；选中态仍由行底色
  （`--accent-soft`）表达，`focused` 类保留作键盘导航标记。侧边栏文件夹/分组激活项的左缘指示条不属于
  此列，保留。

### 变更（插入引文弹窗：去掉页码框，检索按词优化）

- **去掉逐条「页码」输入框**：locator 只有在 CSL 样式的 citation 布局里声明了 locator 元素才会被渲染
  （APA/IEEE/Chicago/MLA 会输出 `p. 12`，而 GB/T 7714 两个变体、Vancouver、Nature 等编号制样式在
  引文角标里只印序号、静默丢弃 locator），默认场景下填了没有效果反而让人困惑。`csldoc`/`docx` 的
  locator 数据通道原样保留——旧文档域 payload 里的页码照常渲染、照常刷新，只是新插入不再提供输入入口。
- **检索改为分词 AND 匹配**：查询按空白拆词，每个词都命中才显示（如「chen battery」「王小明 2019」）；
  haystack 覆盖标题、年份与作者的多种形态（姓/名分列、姓名倒序、「王, 小明」→「王小明」去分隔形态），
  匹配走 `normalizeForSearch` 折叠大小写/变音符/全半角；haystack 按 paperId 缓存，弹窗打开时重置。

### 变更（Word 写作与浏览器扩展移出设置，顶栏直达）

- **顶栏新增「插入引文」与「扩展」两个按钮**：「Word 写作」面板（`#word-panel-mask`）与「浏览器扩展」
  面板（`#bridge-panel-mask`）从「设置 → 集成与服务」整体搬出，成为顶栏直达的独立弹窗——用户反馈
  埋在设置里根本看不到。元素 ID 全部不变，既有处理器照旧工作；设置 → 集成与服务继续保留 Zotero、
  划词翻译、期刊分区等其余条目。
- **Word 面板打开即自动检测一次 Word**：从外面进来不需要先点「检测 Word」，文档下拉直接就绪；
  未检测到 Word 时状态栏给出明确提示。
- **扩展开关改为立即生效**：开关原来挂在设置的「改动即自动保存」上（600ms 后保存整份集成配置）——
  搬出设置后这条路会出事故：设置从未打开时表单是空的，切换开关会把空配置写回去、抹掉坚果云凭据。
  现在开关独立调用 `bridgeSetEnabled` 即时生效，不碰其余配置（CDP 实测：切换后状态翻转、
  integration config 原值保留）。引导页「安装浏览器扩展」步骤同步指向顶栏「扩展」。
- smoke 断言新增 `integrationPanelsPresent`（顶栏按钮 + 两个弹窗壳存在，且不再位于 `#sync-mask` 内）。
- 端到端（CDP，真实 Electron）：面板开合、状态回填、开关即时生效、Esc 关顶层、设置弹窗照常打开，
  11 项全过。

### 变更（打包自动迭代版本号）

- **`npm run dist` 每次打包前自动把 `package.json` 的 patch +1**（新增 `scripts/bump-version.js`，
  由 `scripts/build.ps1` 在调用 electron-builder 之前执行）：安装包名
  （`LitBoard-Setup-<版本>-x64.exe`）、`dist/SHA256SUMS.txt` 头部与包内版本因此始终一致，不必再
  手动同步。`version` 的唯一真源仍是 `package.json`（`docs/releasing.md`）。
- **连同 `package-lock.json` 一起同步**：只定点替换顶层与 `packages[""]` 两处版本，依赖条目的
  version 一个都不动（有测试逐项比对整份锁文件），也不重新序列化 JSON——文件保持 2 空格缩进、
  LF 行尾与结尾换行。版本对不上或结构缺失时**抛错而不是乱改**。
- 手动抬版本：`npm run bump-version -- --level=minor|major`（`--dry-run` 只看效果不写文件）；
  想用当前版本打包用 `npm run dist:nobump`——CI 改走这条（CI 无法把版本提交回仓库，产物版本
  必须与仓库一致），`scripts/build.ps1` 相应支持 `-Level` / `-NoBump` / `-DryRun`。
- 测试：`test/bump-version.test.js` 新增 10 例（进位规则、非法版本/级别报错、两处同步且锁文件
  只允许这两处变化、格式与行尾保持、`none`/`dry-run` 不写盘、连续两次各推进一个 patch、
  CLI 参数解析与 `--root` 只作用于指定目录）。

### 修复（导出 Word 的 docx 里引文印出 `<sup>` 标签；「解除关联副本」在 Word 2016 上必失败）

- **「导出 Word」的 docx 与 Word 插件同一渲染口径**：侧栏导出（整库导出与笔记导出两处）过去把
  citeproc 的 HTML 经 `stripHtml` 剥成纯文本写进 `<w:t>`，于是文档里照样印出 `<sup>[1]</sup>`，
  参考文献也被剥掉了斜体、编号与正文还粘在一起。现在引文与参考文献统一过
  `cslcite.htmlToRuns`（与 `htmlToRtf` 共用同一套 HTML 词法）转成带格式的 run，`js/docx.js`
  的 run 支持 `bold/italic/smallCaps/sup/sub/tab/br`（`<w:vertAlign>` / `<w:tab/>` / `<w:br/>`），
  段落支持 `indent/firstLineIndent/entrySpacing/lineSpacing/tabStops`（`w:pPr`），数值直接取自
  `getBibliographyFormat()`——GB/T 得 384/−384 悬挂缩进 + 384 制表位，APA 得 720/−720 与 2 倍行距。
  只给 `citation.text` 时仍按纯文本处理，docx 读回与 Zotero 域转换（拿到的就是纯文本）不受影响。
- **顺带修掉一个 HTML 实体隐患**：`htmlToRtf`/`htmlToRuns` 原来先解实体再分词，标题里若含
  `&lt;i&gt;`（字面 `<i>`）会被当成标签吞掉；现在先分词、只在文本片段上解实体，且只解一次。
- **「解除关联副本」在 Word 2016 上必失败**：它内部用 `Document.SaveCopyAs`，而这个调用在
  Word 2016（16.0）上对任何参数形态都报 `0x800A1704「未知的运行时错误」`（新建/已存在的目标、
  同目录/别处、可见与否、打开方式都试过；同一文档的 `SaveAs2` 正常，真机实测）。`SAVECOPY`
  命令有同样的问题。新增 `copyDocumentTo`：文档没有未保存修改时用 `FSO.CopyFile` 做字节复制，
  有未保存修改时用 `SaveAs2` 往返（保证复制到刚插入的引文，并把原路径复位），二者都不再碰
  `SaveCopyAs`。附带修掉一个 JScript 陷阱：特性探测不能写 `if (obj.SaveAs2)`——碰到方法名就抛
  `'SaveAs2' is not a property`，改为 try/catch（`saveDocumentAs`）。
- 测试：`test/cslcite.test.js` 新增 `htmlToRuns` 用例（格式标志/制表位/换行/实体只解一次）；
  `test/docx.test.js` 新增 5 例（富文本 run 落成 `w:vertAlign`/`w:i`/`w:b`/`w:smallCaps`、
  `w:tab`/`w:br`、引文域多 run 结果的读回拼接、只给 text 时的纯文本回退、`w:pPr` 段落格式）。
- 真机验证（Word 2016，走生产桥）：解除关联副本 → 副本无域且文本保留、原文档字节未变、域完好；
  `SAVECOPY` 两条分支（已保存 → 副本与原文件字节一致；插入引文后未保存 → 副本带上 2 个域且
  原路径复位）；导出 docx 交给 Word 打开并保存后，上标（真 `w:vertAlign`）、制表位与
  `w:ind w:left="384" w:hanging="384"` 仍在，引文域仍可读回。

### 修复（Word 插入引文：文档里印出 `<sup>` 标签、参考文献条目间隔巨大）

- **根因**：写进 Word 域结果的是 citeproc 的 **HTML**。GB/T 7714 顺序编码样式的引文层是
  `<layout vertical-align="sup">`，citeproc 于是产出 `<sup>[1–3]</sup>`；而 Word 的 `Result.Text`
  只认纯文本，标签就被原样印进了文档。同样的剥标签写法（`replace(/<[^>]*>/g,'')`）也把 citeproc
  输出里的缩进与换行留在了条目里，再用 `\r\n` 连接，于是每两条之间多出一个空段落——这就是「条目
  间隔很大」。查了 Zotero 的实现（`zotero-word-for-windows-integration` 的 `field.cpp` 与
  `xpcom/integration.js`）后按它的路子改：
- **引文与参考文献改走 RTF**：新增 `cslcite.htmlToRtf`（`<sup>`→`{\super }`、`<i>`→`{\i }`、
  小写大写 →`{\scaps }`、非 ASCII →`\uc0\uNNNN{}`、转义 `\ { }`、second-field-align 的编号与正文
  之间补 `\tab`、丢掉 citeproc 输出的缩进换行），渲染层包成 `{\rtf …}`；桥按 `{\rtf` 前缀识别，
  写临时 `.rtf` 后用 `Range.InsertFile` 读进域结果。**不先清空结果**——实测清空会丢掉域结果绑定、
  内容落到域外（Zotero 在 Word 2013+ 用「两空格 + 复制范围」绕的就是这个，我们改用不复位结果，
  更简单且实测可用）。上标/斜体因此是真正的 Word 格式。
- **参考文献段落按 CSL 样式排版**：新增 `csldoc.getBibliographyFormat()`，照 Zotero
  `getBibliographyFormatParameters` 的公式换算（hanging-indent → 720/-720；否则 second-field-align
  → `alignAt = 24 + maxoffset*120` 的左缩进 + 同位置制表位；段后距 = 240×entryspacing；行距倍数
  仅在 >1 时下发），随 `APPLY`/`BIB` 传格式负载；条目之间用显式 `\par` 分段（RTF 里的 `\r\n` 只是
  排版空白，不分段）；纯文本回退路径的连接符也从 `\r\n` 改成单个 `\r`。
- **落盘与顺序**：域代码先写、内容后写（改域代码会清掉结果里的格式）；临时 RTF 用 ASCII 落盘
  （citeproc 的 RTF 输出全是 ASCII，中文走 `\u` 转义）。
- 测试：`test/cslcite.test.js` 新增 `htmlToRtf` 用例（上标/斜体/小型大写/实体/转义/`\tab`/缩进换行），
  `test/csldoc.test.js` 新增 `getBibliographyFormat` 用例（GB/T 的 384/-384/制表位、APA 的 720/-720
  与 2 倍行距）；`test/word-bridge.test.js` 跟进 `APPLY`/`BIB` 行尾格式负载。
- 真机验证（Word 2016，走生产桥的完整链路：INSERT → APPLY → FIELDS 读回 → 域快照重建会话再 APPLY）：
  引文为真上标 1 处、条目标题号后带制表符 2 处、`w:ind w:left="384" w:hanging="384"` 与
  `w:tab w:pos="384"` 各就位、两条参考文献各占一段（无空段）、`LitBoard.Citation.1` 与
  `LitBoard.Bibliography.1` 域完好，文档文本里**不再出现** `<sup>` 或任何 RTF 控制字。

### 修复（点了没反应：同步对照的版本选择按钮、分区列的开始/暂停）

- **同步对照弹窗的版本选择按钮点了不亮**：`.btn.selected` 在 CSS 里根本没有规则——「采用本机版本/采用远端版本」和「仅本机」行的「保留本机/从本机移除」点完外观毫无变化，用户无法确认自己选没选上。现在补上 `.btn.selected`（accent 描边 + 淡色底 + accent 文字 + 聚焦环）并在选中侧打对勾，选中一侧的整块内容卡片也跟着上色。
- **「未决项采用本机/远端」两个批量按钮点完没有回音**：它们没有按下态，列表又常常滚在别处，点完只能靠读摘要判断有没有生效。现在按下态由未决项的实际选择反推——全部未决项都指向同一侧才亮（逐项改过会自动熄灭，不会留下过期状态），并同步 `aria-pressed`；点完还会 toast 报出「已将 N 项设为…」，本来就是该选择时也会明说。
- **分区列的圆圈按钮改成开始/暂停开关**：原先运行期间按钮被 `disabled`，第二次点击根本不会触发，想拦下来只能等它跑完。现在第一下开始补查、第二下暂停（队列与进度保留，暂停即落盘，避免已查到的结果丢失）、第三下继续；运行中按钮保持可点并用呼吸动画提示、图标切 ⏸，暂停时切 ▶ 且按钮常亮，表头带「已查/总数」进度，`title`/`aria-label` 同步说明当前状态，跑完自动复位为 ↻。
- **顺带修掉表头里那颗按钮的冒泡**：它住在可排序的 `th` 内，点击会冒泡到排序处理器——「开始/暂停」都会连带把表格按分区重排，还会和补查期间的冻结排序互相打架。现在按钮点击已 `stopPropagation`。
- smoke 断言新增 `rankRefreshTogglePresent`（按钮 + ↻/⏸/▶ 三个图标 + 进度元素齐备）。

### 修复（切换数据目录后旧目录留下小尾巴、清理状态一直清不掉）

- **根因是 Chromium 的进程单例锁 `lockfile`**：Windows 上它是 userData 根下的一个 0 字节文件，
  不在 `RUNTIME_CONFIG_ENTRIES` 名单里，于是被当数据复制进新目录；而迁移收尾去删旧目录里那一份时，
  它多半还被正在退出的上一个进程攥着（EBUSY），`pendingCleanup` 因此永远清不掉——设置页长期显示
  「旧数据目录清理未完成…lockfile」，旧目录也一直剩着这个文件。现在 `lockfile` 归入运行时缓存：
  不参与复制，删不掉也不算清理失败。
- **删不掉不等于可以不管**：清理结束时把没删掉的运行时缓存记进 `runtimeSweep`，由新增的
  `dataPathManager.retryCleanup()` 在运行期补删（`main.js` 启动后按 3s/10s/30s/90s/4min 各试一次），
  占用一解除就清干净，不必再靠反复重启碰运气。补删只碰 `RUNTIME_CONFIG_ENTRIES` 里的名字，数据文件
  一律不碰；默认目录里的活动单例锁（本进程自己持有的那个）跳过不删。
- **新目录里没有对应副本的条目不再静默跳过**：`litboard.sqlite-wal` 这类会随新库打开原地自我更新
  的文件过去被无声留在旧目录里（既不搬走也不提示）。现在保留原处并记进 `cleanupPreserved`，
  在设置页如实列出；只有真正的失败（`.bak` 内容不一致、数据条目删不动）才继续保留 `pendingCleanup`
  并拦住下一次改路径。
- **顺带修掉一个会误删库文件的老问题**：只搬配置目录、文献库留在原处时，旧共享目录同时还是当前库
  目录，而清理是按 `currentLibraryDir` 找「副本」的——参照目录就是被清理目录本身，于是它会把仍在使用
  的 `litboard.sqlite` 当副本删（Windows 上通常因句柄占用报 EBUSY，其他平台会真删）。现在参照目录
  等于被清理目录时一律不删。
- **路径可以直接手输**：设置 → 数据与备份的两个路径框不再 `readonly`，Windows 下支持 `%USERPROFILE%`
  这类环境变量写法（`validDirectory` 展开后再校验）；提示文案改为说明旧目录会被清空、只留定位文件
  `data-paths.json`，不再说「原目录会保留」。
- 测试：`test/data-paths.test.js` 新增 7 个用例（运行时缓存不搬走且旧目录清空、删不掉的 lockfile
  不阻塞搬家且事后被补删、默认目录里的活动单例锁保留、迁移后新出现的文件保留并上报、只搬配置目录
  不误删留原处的库、嵌套旧库目录的空壳回收、`%VAR%` 展开）。

### 修复（设置弹窗里打开的子弹窗被压在下面）

- **嵌套弹窗的层叠顺序改按打开时序，不再看 DOM 顺序**：所有 `.modal-mask` 共用 `z-index: 210`，
  同值时由 DOM 顺序决定高低——`#zotero-import-mask` 排在 `#sync-mask` 前面，于是从设置里点
  「从 Zotero 导入」后向导被设置框盖住，不先关掉设置根本看不到新弹窗。`js/modal.js` 的弹窗栈
  本就按显示时序记录（新增 `visibleIds()`），现在按该序给可见的 `.modal-mask` 依次分配
  `210 + n`：后开者必在上层，全部关闭后清掉内联值回到 css 默认（层号不累积，也不会越过
  右键菜单 260 / toast 300）。设置里的「Word 插入引文」弹窗是同一个毛病，一并修好。
  阅读器 overlay 与悬浮层不参与重排——它们有各自的层叠契约（须留在 topbar 之下）。
- 测试：`visibleIds` 显示时序用例；smoke 新增 `nestedModalStacking`（点开设置 → 点开导入向导
  → 断言向导层级更高 → 关向导断言设置框回到最上 → 全关后断言内联 z-index 复位）。

### 修复（国自然引文观感：DOI/URL、「等/et al.」与自定义样式导入）

- **GB/T 7714 两个变体（顺序编码/著者-出版年）不再输出 DOI 与 URL**：国标样式把期刊论文也按
  电子资源处理，每条都挂 `DOI:…` 和获取路径，观感差。定制 vendored 样式的 `access` 宏为空输出，
  并让 `medium-id` 不再因存在 URL/DOI 自动追加联机标志（`[J/OL]` → `[J]`）。
- **西文文献「等」→「et al.」**：citeproc 的术语取自引擎唯一 locale（我们恒用 zh-CN），
  没有按条目切换机制。新增 `cslcite.fixLatinEtAl` 在渲染出口修正：条目中除「等」外不含 CJK
  字符即视为西文条目，把「等」换成 et al.（并处理与样式分隔句点叠用导致的 `et al..` 双句点）；
  中文条目原样保留「等」。csldoc 的 `getCitationText/getBibliography` 与 cslcite 的
  `renderBibliography` 出口统一生效，对任意样式安全。
- **支持导入自定义 CSL 样式**：Word 写作 → 引文格式新增「导入 CSL 样式…」，选择本地 .csl 文件
  （经 `files:choose-files` + `files:read-bytes`）后存入 localStorage（`litboard.customCslStyles`，
  同名重导入覆盖，超限给出明确报错），下拉列表即出现该样式并按目标文档记忆；需要官方完整
  国标输出或期刊特有样式时自行导入即可。
- 测试：`fixLatinEtAl` 单元用例 + GB/T 混合文献渲染集成用例（西文 et al./无 DOI/无 [OL]、
  中文保留「等」）。

### 修复（Word 插入引文真机调通 + 文献多选与引文格式）

- **根因修复：插入引文后 Word 显示域代码原文（JSON 直出）**。`Fields.Add` 直接建 ADDIN 域在
  Word 2016 COM 上是坏的：`wdFieldEmpty(-2)` 报「Value out of range」，`type=-1` 会追加
  `\* MERGEFORMAT` 且 `Result.Text` 赋值**静默丢失**（真机探针实测），域结果为空时 Word 只能
  显示域代码。改用 **Zotero Word 插件同款两步法**（`addLitField`：wdFieldQuote 占位域 → 整体
  重写 `Code.Text` → 写 `Result.Text`），INSERT/APPLY/BIB 统一走此路径；写完调 `showResultView`
  强制关闭「显示域代码」（比照 Zotero document.cpp 对 ShowFieldCodes 的处理）。
- **根因修复：cscript 的 JScript 没有 `Array.prototype.filter`**（真机实测抛「对象不支持"filter"
  属性或方法」），`bibliographyFields` 一调用就失败——「插入参考文献表」在本机从来就没能成功过。
  改为 ES3 for 循环，并把「wordbridge 全文只能 ES3」写进工程守则。
- **插入引文前可从文献列表多选**：新增 `#word-cite-mask` 弹窗（搜索标题/作者/年份 + 勾选 +
  逐条可选页码定位符），勾选顺序即同一处引文的合并顺序，替换原先「单选一篇 + 一律要填定位符」
  的两步对话框；已注册弹窗栈（Esc 只关最顶层）。
- **引文格式可选择**：Word 写作面板新增 `#word-style-select`（清单 = cslcite `BUILTIN_STYLES`），
  按目标文档记忆（`litboard.wordStyles[文档路径]`），未选目标文档时修改全局默认；新插入引文
  立即生效，已有引文点「刷新引文与参考文献表」按新格式重排。补充内置样式：Elsevier（编号含
  标题）、Elsevier Vancouver 编码、Chicago 注释-文献表（CSL 文件来自 citation-style-language，
  CC BY-SA 3.0，已入库 `vendor/citeproc/styles/`），GB/T 7714 顺序编码标注「国自然」。
- 真机验证：隐藏 Word 实例 + 空白文档，经生产桥（`electron/word-bridge.js` → `wordbridge.js`）
  执行 INSERT → FIELDS 回读（域代码无 MERGEFORMAT、结果文本正确）→ BIB 写参考文献表，全链路通过。

### 新增（云同步：自动同步开关）

- 设置 → 云同步 → 坚果云 WebDAV 新增「内容变化时自动同步」勾选框（默认勾选，保持既有行为）。
  勾选＝编辑后约 1.2 秒防抖自动同步 + 每 15 分钟定时核对（原行为）；不勾选＝完全不做后台同步，
  仅在点「保存并同步」或使用远端恢复 / 同步对照功能时联网；改动照常先落本机数据库，不会丢失。
  开关为本机设置（settings 表，不随加密配置同步，各设备可各自决定）；「同步进行中检测到新修改
  的收尾重排队」不受开关影响。

### 新增（云同步对照：应用进度与本机保留权）

- **对照应用过程可视化**：远端同步对照（`#sync-remote-plan-mask`）点「应用选择并同步」后，
  弹窗内切换为进度条视图（`integrations:sync-progress` 主进程事件逐阶段上报：校验远端版本 →
  附件/快照逐个 done/total → 写入远端库 → 配置 → 完成），应用期间取消/关闭（含 Esc、点遮罩）
  一律守卫，不再出现「不知道到底有没有在同步」。后台自动同步同样上报进度，设置弹窗开着时
  透出到同步状态行。
- **选「采用本机版本」不再覆盖云端副本**：应用计划时生成两份结果——本机工作区（含用户选择）
  照常落库；云端工作区把被选「本机」的实体替换回远端值再上传（无差异则完全跳过写入）。
  两侧快照登记进 sync base（`pins`），后续同步在两侧都与登记一致时维持分叉、互不覆盖；
  任一侧发生变化（本机再编辑 / 另一台设备改动远端）即自动解除登记，回到正常三方合并或
  重新弹出对照。附件同步按登记跳过对应文献/笔记，避免本机字节覆盖云端文件。登记逻辑为
  `js/sync.js` 纯函数（`invertLocalChoices/extractWorkspacePins/evaluateSyncPins/applyPinsToWorkspace`），
  Node 侧可测；恢复模式（远端恢复）语义不变，远端仍权威。

### 修复（Word 写作联动真机诊断）

- **根因修复：Word 桥 v2 协议在 cscript 宿主上静默崩溃**。WSH 的 cscript 不保证有原生 `JSON` 对象
  （实测 Windows 10/11 报 `"JSON"未定义`，且 `//B` 模式下无任何输出），而 v2 的请求解析
  （`JSON.parse`）与响应构造（`JSON.stringify`）全依赖它——导致渲染层每条 Word 命令都无响应，
  30 秒超时报错；`updateBibliography` 写参考文献域时还有第二处漏网 `JSON.stringify`。
  现升级为 **v3 协议（纯 base64 字段载荷，JScript 侧零 JSON）**：请求
  `REQ|b64(requestId)|b64(sessionId)|b64(documentId)|b64(line)`（命令行组装移到 Node 侧），
  响应 `RES|ok|requestId|sessionId|result|error`；参考文献域载荷改 ES3 手工序列化（形状不变）。
  真机验证：`PING`/`INFO` 经生产桥即时返回（修复前挂满 30s 超时）。同步把「桥源码零 JSON」
  写进静态契约测试，防止回归。
- 新增 `npm run diag:word`：一条命令诊断 Word 联动（PING/INFO 只读探测，输出常见失败原因解读）。
- **根因修复：残留的隐藏空 Word 实例抢占 ROT，`GetObject` 永远命不中用户窗口**。Windows 的
  `GetObject('', 'Word.Application')` 只返回活动对象表里最老的注册实例；被自动化遗留的
  隐藏空实例（无窗口、0 文档，可存活数日）占住该注册后，无论用户新开几个 Word 文档，
  「检测 Word」始终报「Word 中没有打开的文档」。现在 `connect()` 每条命令都校验缓存实例
  （进程已死则重连），并依次 Quit「隐藏且 0 文档」的幽灵实例（上限 8 次、间隔 250ms）直到
  附加到真实实例；可见 Word（含仅受保护视图/未存盘文档）因 `Visible=true` 永不被误杀。
  渲染层把「已连接 Word ，打开文档 0 个」的空版本号文案改为明确的「未检测到正在运行的
  Microsoft Word」。真机验证：两次注入的幽灵实例被逐个清理，INFO 正确返回。
- 清理 `electron/word-bridge.js` 中被第二处 `module.exports` 覆盖的死代码 legacy 桥实现（约 115 行）。

### 新增（开源前完善 M0–M5，docs/roadmap.md）

- **编辑与关闭可靠性（M1）**：弹窗栈 `js/modal.js`——Esc 只关最顶层（19 个弹窗 + 阅读器/悬浮层自动进栈），
  不再一键隐藏全部弹窗；富文本笔记编辑器 dirty 守卫 + 本机草稿（localStorage，不进同步正文），
  保存失败保留草稿可重试，`save()` 写克隆不再直改实体；**关闭收尾握手**——主进程拦截窗口关闭，
  等渲染层「已持久化」确认再放行（保存失败弹窗由用户决定是否放弃），退出时不再发起大概率被截断的网络同步。
  新增 `npm run smoke:lifecycle` 两阶段冒烟：写入 → 真实关闭 → 重启 → 数据一致。
- **可信构建与安全（M2）**：`ensure-tools.ps1` 核对外置工具版本（版本不符自动重装，杜绝沿用旧 Electron）；
  IPC 统一受信来源校验（主窗口顶层 frame，77 通道）；扩展桥接不再回 `CORS *`（仅反射 chrome-extension 来源），
  token 鉴权不变；CSP 收紧并移除 cdnjs 依赖（pdf.js 一律本地 vendor）；SECURITY.md 移除占位邮箱；
  新增 `docs/THIRD-PARTY.md` 台账 + `npm run vendor-hashes`（vendor/SHA256SUMS）。
- **核心可用性（M3）**：窄窗（≤1220px）PDF 搜索不再被隐藏——切换按钮 + 浮层，Ctrl+F 自动唤出；
  批注/笔记/附件实体结果分页（100 条/页，ID 索引消除逐项全库查找）；**通知中心**——`⚠` 失败提示
  进入可找回列表（topbar 收件箱，保留 20 条，点击复制详情）；空库四步首次使用清单（可跳过）。
- **性能基线（M4）**：smoke 内置启动/加载/保存/关闭收尾分段计时，`npm run perf` 输出 P50/P95；
  空库基准数据回填 docs/audit-baseline.md。
- **发布基础（M5）**：CI 新增 `package-smoke` job（Windows 打包 + 打包产物冒烟 + 生命周期冒烟 + 产物上传）；
  发布材料 docs/releasing.md（手动升级清单）+ scripts/release-checksums.js（SHA256SUMS.txt）+
  docs/limitations.md（已知限制权威清单）；README 补英文简介、快速开始、文档索引，修正 CDN/schema 描述。
  本地实测：打包版二进制通过全部冒烟，NSIS + Portable 构建链路完整可用。
- 工程基线：修复 `.git`（空仓库初始化，首次提交由维护者执行）；根目录调试残留清理；
  `docs/roadmap.md`/`audit-baseline.md`/`task-ledger.md` 三件套交接文档。
- **死代码清理**：移除 `scripts/legacy/`（旧版图标方案）、根目录 `sample.bib`、测试残留 JSON 与
  `.tmp` 36MB 历史产物；index.html 移除两个从未被引用的静态加载占位元素（`#pdf-loading`/`#epub-loading`，
  打开阅读器时总是先重写 innerHTML）；CSS 移除 pdf.js 5.x 已不再注入的 `.endOfContent`/`.selecting` 规则；
  preload 移除零调用的 `clearBackupDir`/`readBytes` 别名/`isSmokeTest` 及对应 `backup:clear-dir` IPC 与
  `data-paths.clearBackupDir`。清理经全库引用扫描 + 逐项人工核实（动态拼接类名/id 逐一排除误报），
  删除后 392 项测试、lint、标准/生命周期冒烟全部通过。

### 修复（六阶段复审 15 项缺陷，AUDIT.md 复现驱动）

- **数据保真**：编辑弹窗改作者/年份同步权威字段 creators/date（不再被旧投影还原）；Zotero 重复导入补回同 key 附件的
  空本地路径、文件夹按 id 合并（本地重命名不丢）、匹配键升级为 sourceLibraryId+zoteroKey（多库不串）；
  阅读器批注渲染层 8 处变更入口统一按附件过滤（不再跨附件串显）。
- **采集链路**：扩展打包/右键注入补上共享 `js/translators.js`（此前右键保存整体失败、popup 静默走旧路径）；
  content.js 完整合并专用解析的 title/authors/doi/venue/date/entryType/publisher/ISBN/tags/多附件；
  `/save` 白名单 + `bridgeUpsertPaper` 落库 entryType/date/publisher/isbn/language 与多附件下载。
- **Word/docx**：`readDocxFields` 拼接多段 instrText（长指令不再截断）；`convertZoteroDocxXml` 域队列按
  Zotero 域过滤（PAGE 等混排不错位）+ 分段指令清空 JSON 碎片；wordbridge 撤销 API 正名
  `StartCustomRecord/EndCustomRecord`（已对真实 Word 2016 验证）；刷新引文回写最新快照（APPLY 回写 Code.Text）；
  插入引文后自动按文档序重算编号。
- **检索/阅读**：实体命中视图 paper 级条件改对 paper 求值（author+ann 混合不再空）、多 ann 组独立 ∃、
  主题笔记查询 has:pdf 不再抛异常；摘录 epubcfi 全链路随行（replaceExcerpt/markExcerptCurrent/htmlToMarkdown/实体命中 target）；
  快照目录型附件读 index.html 入口（`resolveSnapshotEntry`）；重排提取回调 epoch 校验（旧内容不落地）；
  朗读暂停对 EPUB 生效、开读重置按钮态。
- **PDF 划选精度**：选区候选 span 改按「选区行带几何相交 + 纵向中心」判定（原 `Range.intersectsNode` 按文档序，
  内容流夹在起止之间的元素会被整段选中），修复两类误选：选区结束行的下一行因行盒高度略大于行距被整行选中
  （选框拉长到页面右缘、文本混入下一行），以及旋转页边戳（如 arXiv 侧边竖排文字）等内容被卷入选区。
- **笔记**：富文本笔记追加摘录改写 HTML 摘录块（不再被 sanitizeHtml 剥掉 Markdown lbex）；Zotero 笔记
  data-citation 节点转为 `litboard://open/paper/z<key>` 引用链接（markdown/richtext 两路，不可解析才记 unconverted）。
- **工程**：`npm run check-translators` 上游漂移脚本；wordbridge 纯 ASCII/ES3 + API 名静态契约测试；
  AGENTS.md 版本号对齐实现（schema v13 / DB v5 / AST v3）。

### 新增

- **划词翻译免费接口（参考 zotero-pdf-translate）**：新增 5 个无需 API Key 的翻译服务商，开箱即用——
  火山翻译（浏览器扩展接口，**新默认服务商**）、腾讯交互翻译（TranSmart）、谷歌翻译（translate_a 免费接口含 tk 签名）、
  CNKI 学术翻译（令牌 + AES-ECB，学术术语友好、自动中英互译，被限流时提示网页端过验证）、
  MyMemory 翻译记忆库（匿名每日约 5000 字符）。长文本自动按句分块顺序翻译
  （`js/translate.js` 纯函数层：请求构建/响应解析/分块/Google tk，Node 可测；五个端点均已在线实测）。
  设置页服务商下拉按「免费接口 / API Key 服务」分组，免费服务商自动隐藏凭据与模型字段。
  新增「自动翻译」开关（阅读器划词弹层 + 设置页两处勾选，存 DB settings）：勾选后划选 PDF 内容即自动翻译，无需点「翻译」。
- **EPUB 内置阅读器（阶段六）**：EPUB 附件一键在内置阅读器打开（vendor epub.js + JSZip，BSD-2/MIT 已登记），
  并入现有阅读标签系统（与 PDF 共存于标签条，📖 前缀区分）；章节目录侧栏、三档字号、明亮/羊皮纸/暗黑主题、
  阅读位置（CFI）持久化恢复、本章朗读（播完自动翻章）；底部进度条（spine 即时近似 +
  epub.js locations 后台精确化，≤80 章自动启用，点击跳转）；选中文本高亮/批注（CFI 定位，SVG 高亮回显），
  批注列表 / 标签 / 评论 / 多选加入笔记 / 整篇生成笔记全通，摘录出处链接支持 `litboard://…&epubcfi=` 定位跳章；
  附件统一入口 `openAttachment`（抽屉/实体命中/右键分流收敛为一处），手动添加附件自动识别 `.epub`。
- **PDF 重排阅读模式（阶段六）**：PDF 工具栏「重排」开关把版式文档按阅读顺序重建为连续纯文本流
  （`js/reflow.js` 纯函数分析层：行聚簇、跨栏切段、栏检测、通栏行穿插、段落合并，Node 可测）；
  懒提取分页加载、缩放键调字号（10–22pt）、朗读可用、搜索高亮可用（DOM mark 高亮 + 上下匹配导航，
  搜索激活时自动全量提取）；位图管线不动（CSS 隐藏页面，切回即原位）。
- 数据模型升级至 schema v12（配套 SQLite user_version 4、同步协议 v5）：
  - 结构化创作者 `creators`（角色/姓/名/机构名）成为权威来源，`authors` 降级为兼容投影（`Family, Given` 形式）；
    旧字符串作者名自动解析回填（支持 "Family, Given"、"Given Family"、CJK 全名与机构名识别），手写引用引擎输出逐字不变（有测试锁定）。
  - 新增完整出版日期 `date`（`YYYY[-MM[-DD]]`，为权威）、访问日期 `accessDate`、出版地 `place`、系列 `series`、
    缩写刊名 `journalAbbreviation`；`year` 降级为投影。无法映射的条目类型记入 `sourceType`，不再静默归为期刊文章。
  - 新增独立笔记实体 `notes` 顶层集合（稳定 ID、paperId 可挂文献或为空作主题笔记、createdAt/updatedAt/deletedAt 墓碑、
    `format` 预留富文本）；旧 `paper.notes` 纯文本自动迁移为 Note（确定性 ID 保证幂等），`paper.notes` 保留为兼容投影，
    详情抽屉笔记编辑改走 Note 实体。
  - 批注新增 `attachmentId` 附件关联（旧批注自动回填主 PDF 附件，无附件留空保留），`position` 预留 EPUB CFI 与
    网页文本锚点（仅校验放行，阅读器阶段才产生数据）。
  - SQLite 迁移到 v4：新建 `notes` 表、annotations 子表加 `attachment_id` 列；迁移前自动创建 `litboard.sqlite.pre-v4.bak`
    可恢复备份，迁移整体在事务内、失败回滚。硬删除文献连带清理该文献的附属笔记（主题笔记不受影响）。
  - 同步协议升级 v5：`notes` 进入三方合并与云端信封（PLAIN_SPEC 字段级合并、墓碑删除传播）；接受 v3/v4 旧信封读取，
    旧端读到 v5 一律拒读写，不会把新格式改坏后写回。
- **Zotero 导入向导**（设置 → 集成与服务 → 导入本机库）：选择来源 → 扫描预览 → 导入（进度条）→ 核对报告四步；
  只读扫描 zotero.sqlite（锁定自动快照回退），不修改 Zotero 原库。导入条目类型（未识别类型保留 `sourceType`）、
  全量字段（未映射字段进 `bibtexExtra`）、创作者角色（编辑/译者/机构/单字段）、文件夹层级、标签与颜色、关联条目、
  独立及附属笔记（HTML→Markdown，图片提取到 `note-assets/` 受管目录，不可转换结构保留原始表示并入报告）、
  全部附件（多 PDF/EPUB/补充材料/网页快照目录/独立附件，默认复制进 `synced-attachments/` 受管目录）、
  数据库批注（highlight/underline/note/ink/image→snapshot，含 attachmentId 关联与定位）。
  Zotero item/attachment/note key 保存在实体的 `zoteroKey` 字段，重复导入幂等补缺、不覆盖本地笔记/阅读状态/已改字段，
  字段差异在报告中只读逐项列出；缺失/未下载附件明确列出，可稍后用「迁移云附件」补齐。PDF 内嵌批注与库内已有批注
  按内容指纹（页+矩形+文本）自动判重。
- 网页快照与笔记资产进入完整备份与云同步：快照目录打成确定性 stored-ZIP 上传（`p1/a1.zip`），下载端解压落目录；
  笔记图片按 `notes/<noteId>/<file>` 同步；备份 manifest 支持目录型资产（relPath）与笔记资产条目，恢复时统一重写路径。
- **CSL 文档上下文引用（阶段二上半）**：新增 `js/csldoc.js` 引文文档会话——数字制/作者年份制/脚注制、定位符（页码等）/前后缀/省略作者、
  多文献组合、同年消歧（2012a/b）与重复引用（ibid）由 citeproc 统一重算；引文顺序、稳定引文 ID、文献 ID 与 CSL 数据快照随集群持久化
  （CitationCluster 为文档内 JSON，不进工作区同步）；文献暂不在库时靠快照保持可读可刷新，`relink`/`updateLibrary` 提供重新关联。
  `js/cslcite.js` 新增 `paperToCslItemFull`（结构化创作者角色/完整日期/出版地/系列/缩写刊名/来源类型），旧渲染输出逐字不变（测试锁定）。
- 导出菜单新增「导出 Word（带可刷新引文域）」：生成最小 docx（`js/docx.js`，纯 JS stored-ZIP 零依赖），引文以复杂域
  `ADDIN LitBoard.Citation.1 "{json}"` 保存（版本化、独立命名），参考文献表同样式渲染——是下一轮 Word VBA 插件的定位契约。
  `js/docx.js` 的 `convertZoteroFields` 实现 Zotero 引文转换核心：`ADDIN ZOTERO_ITEM` 域 → zoteroKey 映射 → LitBoard 域，
  未匹配项保留嵌入快照，转换向导 UI 随 Word 集成下一轮交付。
- **批注摘录与笔记（阶段三上半）**：批注新增标签（按颜色/标签筛选加入笔记）。新增 `js/excerpt.js` 摘录块契约：
  `<!--lbex {json} --> > 引用快照 … 个人评论 <!--/lbex-->`，元数据含文献/附件/批注 ID、页码与来源时间戳；
  多篇文献的摘录可汇入同一主题笔记（同步/备份走 notes 集合，零新增）。阅读器右栏内置笔记编辑器
  （目标笔记选择/新建、Markdown 编辑+预览）；批注条目「加到笔记」、面板头「多选加入笔记…」与
  「整篇生成笔记」。来源批注修改后笔记提示「来源已更新」（采用更新/保留），删除来源不连带删除摘录；
  出处定位统一走 `litboard://open/paper/<id>?attachment=&annotation=&page=` 协议（应用内点击 + 系统拉起，
  白名单校验）。markdown.js 支持图片（note-assets 相对路径）与 litboard 内部链接。
- **富文本笔记编辑器与笔记→Word（阶段三下半）**：新增 `js/noteml.js`（richtext 白名单 sanitize、
  引用节点 `<span class="lb-citation">`、摘录节点 HTML 形态 `<blockquote class="lb-excerpt" data-lbex>`、
  专用 html↔md 转换——lbex 块还原带出处定位链接）与 `js/noteeditor.js` 宽弹窗 contenteditable 编辑器
  （标题/列表/表格/链接/图片/代码/引用节点；旧 Markdown 单向迁移，原文存 `note.sourceMarkdown`）。
  图片经 `files:store-note-image` 落 `note-assets/<noteId>/` 受管目录（备份/同步自动覆盖）。侧栏
  「导出 Word」把笔记（两种格式统一经 htmlToMarkdown）转为 docx：文本与图片混排、摘录块与引用节点
  成为可刷新 `LitBoard.Citation.1` 引文域并附参考文献表（docx.js 新增图片 run：media 部件 + rels）。
- **高级检索（阶段四上半）**：`js/query.js` 升级为版本化 AST 引擎——跨层级条件组 `ann(...)`/`note(...)`
  （组内条件必须同一批注/笔记满足，多组 = 不同对象各满足，解决「同批注 vs 多批注」区分）；
  新字段 `folder:"名称"`（含子文件夹）、`lastread` 日期比较、`missing:` 空值判断、`has:epub|snapshot|supp`；
  Unicode 规范化匹配（重音/弯引号/全半角/上下标折叠，原文显示不变；正则不规范化）。智能文件夹权威存储
  改为版本化 AST（旧 query 字符串自动迁移）并可编辑。文件夹/智能文件夹 Ctrl+点击多选联合，切换视图保留
  筛选条件；新增 `lastReadAt`（随同步传播但不触发脏写，专用轻量落盘）与「最近阅读」视图；
  检索结果可在文献/批注/笔记/附件四种实体间切换，命中行带上下文并可点击跳转。
- **阶段四余项（查询构建器 / 批量字段编辑）**：可视化构建器 `#query-builder-mask`（条件行 + 且/或连接，
  字段/具备/缺失/关键词/批注组/笔记组六种行型）经 `LitQuery.rowsToText` 生成查询文本填入搜索框——
  **与文本语法共享同一 AST 求值逻辑**（parseAst 即时校验，错误红显）。批量字段编辑 `#bulk-edit-mask`
  （批量栏「编辑字段」入口）：展示选中集不同值分布、支持「明确清空」、实时预览影响条目数；
  status/rating/year 校验、tags 整组替换、authors 走 normalizePaper 重投影。
- **阶段五/六切片（网站采集与阅读）**：`js/translators.js` 为专用 translator 运行层（ctx 最小 DOM 抽象，
  首批 arXiv / PubMed / CNKI / **Google Scholar / 出版商通用层**（ScienceDirect、SpringerLink、Wiley、T&F、ACS、IEEE、ACM、PLOS、Frontiers、Oxford、Cambridge、Nature、Science、bioRxiv、medRxiv，会议条目自动 inproceedings、bioRxiv 标 server；多值 citation_author/citation_keywords 经 ctx.metas 逐条进入 authors/tags）；
  `runTranslators` 命中优先、失败透传 report.failed+reason 走通用兜底（popup 可展示具体原因）；纯静态随版本发布，MV3 合规）；extension content.js 经 `applyTranslator` 接入，background.js 先注入 translators.js。
  **阶段五收尾**：`/save` 白名单补 `sourceType`/`translatorError`（采集溯源与失败诊断入库 `bibtexExtra.translatorError`）；
  popup 红条展示 translator 失败原因、批量保存聚合失败 reason；测试夹具升级（真多值 meta/attr/jsonld）补 4 个用例；
  新增 `npm run check-translators` 上游漂移检查（zotero/translators 最近变动提醒核对，评分匹配防错位；
  实锤 ACS/Science/bioRxiv/medRxiv 上游无专用 translator，与我们的通用层路线一致）；在线冒烟实锤 arXiv/PLOS
  选择器与线上一致，其余出版商站反爬需浏览器内人工复核。
  阶段六切片：PDF **朗读**（`#pdf-tts`，speechSynthesis 本机语音，文本层取句、按页跳转、语速/暂停/停止浮条，
  不调用云端）；**网页快照安全阅读**（`#snapshot-mask`，sandbox 空值禁脚本 + CSP default-src none 禁远端资源，
  入口 = 附件实体视图中 kind=snapshot 行）。EPUB 阅读与重排阅读模式尚未实现（下轮）。
- **会话级撤销/重做（阶段四尾巴）**：快照对（before/after，仅受影响 papers/notes/folders，≤100 条）入栈；
  `applySnapshot` 恢复并整体 normalize 修正兼容投影；`__absent` 标记支持「撤销创建=删除」。覆盖：
  编辑字段（编辑弹窗）、批量标记/加标签/编辑字段、加入文件夹、文件夹拖动移动/排序、软删除与恢复、
  批注新建/删除/加移除标签。**不覆盖**：彻底删除（purge）、外部文件覆盖（PDF 写回/重命名/保存）、远端同步写入。
  入口：topbar ↩/↪ 按钮 + Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z（输入框/富文本内让位原生撤销）。
- **Word 写作与 Zotero 文档转换（阶段二下半）**：COM 自动化路线（零安装零宏）——`word/wordbridge.js`
  JScript 常驻进程经 stdin/stdout 行协议驱动 Word COM（命令：FIELDS/APPLY/INSERT/BIB/UNLINK/SAVECOPY，
  批量写包在单个 UndoRecord 内，只读/受保护文档拒绝）；渲染层设置页「Word 写作」提供检测 Word、
  插入引文、刷新引文与参考文献表（复用 csldoc 会话）、解除关联副本；「转换 Zotero 引文文档」在
  document.xml 级原位替换 `ADDIN ZOTERO_ITEM` 域为 `LitBoard.Citation.1` 域（保留样式与域结果文本，
  未匹配项保留嵌入快照，只生成新副本）。已实测 Word 2016 (16.0) 全链路。

- 工程基建：`.gitignore` / `.gitattributes` / `.editorconfig` / `.nvmrc`，GitHub Actions CI（Node 22.x 与 24.x，
  Windows + Ubuntu）、ESLint 配置与 `npm run lint`、issue/PR 模板、Dependabot。
- 文档：`CONTRIBUTING.md`、`CHANGELOG.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`。
- 「设置与同步 → 完整备份 → 清理遗留文件…」：扫描并清理长期累积的保留件 —— 崩溃残留的 `.staging-*`、
  恢复后保留的 `.previous-*`/`.tmp-*`、库内已不再引用的 `restored-assets/<snapshotId>/`、迁移数据目录留下的
  旧库副本（保留最新一份），以及超过 30 天保留期的隔离数据库副本。扫描只读且先列清单再确认；库不可读时整类跳过；
  当前数据库、全部快照、对象仓与仍在被引用的附件永不在清理范围内。
- `package.json` 补充 `engines`（`node >= 22.13.0`，`node:sqlite` 无 flag 的下限）与 `devDependencies`
  （electron / electron-builder / eslint），CI 与常规 npm 流程不再依赖脚本内的硬编码版本号。
- `.github/workflows/ci.yml`：每次 push / PR 跑 215 个测试 + ESLint。

### 变更

- 完整备份的保留份数改为可配置（1–30，默认 7，设置页「完整备份 → 保留快照份数」）。附件本就跨快照按内容去重，
  真正占空间的是数据库压缩快照，因此份数可按需调小；调小不会立刻删文件，下一次成功备份时才轮换清理。
- 完整备份不再发布「与最近一份内容完全相同」的重复快照：数据库字节与附件集合都一致时直接跳过，轮换位留给
  真正不同的版本（恢复前的紧急快照不受影响，仍强制落盘）。
- 快照列表改为只读 manifest 的轻量路径，深度校验（解压 + 完整性检查 + 逐个附件哈希）只在恢复流程或显式要求时
  进行。此前每列一次快照、每创建一次快照都会把所有快照的全部附件重算一遍。
- `scripts/ensure-tools.ps1` 不再强制 `ELECTRON_MIRROR` 为国内镜像，改为尊重你自行设置的环境变量。
- README 更正为「构建仅支持 Windows」，并补上 Node 版本要求、跨平台测试支持、图标生成脚本的正确入口。

### 修复

- **Windows PowerShell 5.1 静默吞行**：本机默认代码页为 GB2312，PowerShell 5.1 会把无 BOM 的 UTF-8
  `.ps1` 按 ANSI 解码，中文注释的多字节序列会吞掉换行，导致紧随其后的那行代码被并进注释而不报错。
  实测 `scripts/ensure-tools.ps1` 丢 2 行、`scripts/pack-extension.ps1` 丢 1 行
  （`$projectDir = $PSScriptRoot` 失效，此前仅靠调用目录兜底才没出错）。
  已为全部 `.ps1` 补 UTF-8 BOM，并在 `.editorconfig`（`charset = utf-8-bom`）与 AGENTS.md 中固化约定。
- `scripts/ensure-tools.ps1` 的 `$projectDir` 未赋值导致 `npm start` / `npm run dist` 首次准备工具时报
  `Join-Path ... null`（上一条的连带后果，已随 BOM 修复）。
- 文档与实现不一致：`AGENTS.md` 中过期的 schema 版本号（v8 → v11）；README 关于「不依赖 CDN」的措辞
  （桌面版走 `vendor/`，仅浏览器直开 `index.html` 时回退 cdnjs）。
- `scripts/make-icon.ps1` 与 `scripts/gen-icons.ps1` 职责重叠：前者会生成**旧版图标**并覆盖当前品牌图标，
  已移入 `scripts/legacy/`。
- 4 个残留 CRLF 的源文件（`js/pdfium.js`、`test/enrich-pdf.test.js`、`test/model.test.js`、
  `test/pdf-rendering.test.js`）已归一为 LF，与 `.gitattributes` 的 `* text=auto eol=lf` 一致。
- 备份性能：`listSnapshots` 不再对每份快照跑全套校验。实测（1 MiB 附件的库，保留 7 份）打开设置页读取状态
  由 **7.00 MiB 附件读取降到 0.00 MiB**；每创建一份新快照由**随份数线性增长（第 4~8 次 5→9 MiB）降为恒定 约 3 MiB**。
- 「删除 PDF 全文索引」现在真的回收磁盘：FTS5 的 `DELETE` 只标记删除、不释放索引块，实测把 500 篇的索引删空后
  `pdf_fts_data` 仍占 21.76 MB、文件体积几乎不变；改为 `DROP TABLE` 后重建再 `VACUUM`。
- 硬删除文献（例如从 JSON 备份整库恢复）不再在 `pdf_text` / `pdf_fts` / `paper_vec` 留下孤儿行。此前已删除的
  文献仍能被全文检索命中，且这些行会永久占用数据库体积 —— 而数据库会被压缩进每一份完整快照，垃圾按份数翻倍。
- 迁移配置目录时，从完整备份恢复到 `restored-assets/<snapshotId>/` 的附件路径此前不会被重写（它不在受管目录
  白名单 `MANAGED_CONFIG_DIRS` 里），迁移后这些附件链接会断；已补入白名单。
- 兼容性兜底备份 `litboard.sqlite.bak` 的节流时间戳改为写在旁边的 `litboard.sqlite.bak.stamp`，不再写进数据库的
  `settings.lastBackupAt` —— 那次记账写入会让内容相同的快照字节不同，使上面的「无变化跳过」永久失效。旧时间戳仍会被读一次以兼容升级。
- 删除根目录 0 字节误创建文件与空的 `.agents/` 目录。

## [1.2.0] - 2026-09-01

开源准备的基线版本。功能清单见 [README](README.zh-CN.md#功能)；此前的开发无版本历史记录可回溯，
故不在此虚构历史条目。
