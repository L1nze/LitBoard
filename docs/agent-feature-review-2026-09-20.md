# Agent 扩展功能落实复审与修补清单

日期：2026-09-20。审查对象是当前工作区，不是上次报告的旧实现。未修改产品代码。

## 总体判断

大部分功能已有实际模块与接线，上一轮的工具续轮、推理展示、输入组件等问题有实质改善。但“具备入口/模块”与“完整用户流程可靠”仍有差距。当前最需要修的是跨模块契约：模型协议、附件身份、主进程与渲染层状态归属、落盘完成边界。

| 用户关心的能力 | 当前落实程度 | 判断依据 |
| --- | --- | --- |
| Agent 基本对话 | 已落地，存在关键交互和协议问题 | assistant-ui 0.11.58 + React 18.3.1 的 vendor bundle；agentloop 已能模型→工具→模型；thinking 可显示；编辑定位、模型冻结/重试仍有问题 |
| 检索、收藏库与调研库分离 | 分库已落地，收藏桥已接入 | library DB 与 research.db 分开，collect_papers 经确认；但 PDF 收入失败、FTS 更新错误、收藏状态标签混淆 |
| TinyFish search / fetch | 接口已落地，部分入库链路有损 | 固定 URL、Key、开关/告知、学术域限制、errors[] 处理已有；快照全文索引被随后清掉，PDF 地址等元数据未正确保留 |
| PDF 辅助阅读 | 文本阅读已落地；图像理解尚未实现 | PDF.js 全文索引、read_pdf_pages、批注读取、AI 解释入口存在；无图像消息输入通道，台账 M9-5 也明确列为二期 |
| 减少写盘的会话存储 | 策略已采用，持久性保证没有落到底 | 流增量仅内存、关键事件 setData、session JSON 1s 防抖、index 2s 防抖；不是直接使用某个 GitHub 通用存储库，仍是本项目自制实现 |
| 语义检索与段落找文献 | 本地 embedding 检索已实现；段落证据检索未形成独立流程 | research-build / vec.db / cosineSearch 已接；Agent 可以自行组合关键词搜索，但没有 claim→query→evidence 的稳定输出契约 |

## 验证边界

- `npm test`：649/649 通过。
- `npm run lint`：通过，退出码 0。
- `npm run smoke`：隔离 userData 下 PASS。
- 另用 Node 最小脚本验证实际模块，临时库位于系统 TEMP 下 `litboard-audit-*` / `litboard-audit2-*`；未读写真实用户库，未使用用户 API Key，未触发真实付费请求。
- 标记“已复现”的项目经过 mock 或临时文件/数据库验证；“代码确认”表示调用链明确，但没有执行真实端点或完整 UI 操作。
- smoke 的 Agent 检查主要证明节点、接口与 bundle 可用，不能替代模型/provider、编辑重发、附件生命周期的完整集成测试。

## 修补清单

### R01 · P1 · DeepSeek thinking 工具续轮缺少必须的 reasoning_content

**证据**：`js/agentcore.js:85` 保存 reasoning，但 `buildRequestBody`（约 228 行）统一剥离该字段。最小脚本确认：存档中有 reasoning，实际回放 assistant 消息中没有。

DeepSeek 当前官方文档要求带 tools 的请求在后续请求回传完整 reasoning_content，否则可能返回 400。当前 Agent 默认带工具，因而“thinking 能显示”不代表“thinking + 工具链能跑”。这是协议与当前官方要求冲突，未用真实 Key 实测 HTTP 400。[官方 thinking 文档](https://api-docs.deepseek.com/guides/thinking_mode/)

**修补**：增加 provider 的消息回放适配；按端点契约保留 reasoning_content 等必需字段，不能全局一律删除，也不能全局盲目发送。DeepSeek 的关闭思考参数也应按当前 Chat Completions 文档核对：目前 `agentreason.js` 使用 reasoning_effort=none，而文档区分 thinking.type 开关与 effort 档位，不应把不同协议格式混用。

**验收**：mock 契约校验 + 真实服务商人工触发一次“思考→工具→思考→最终回答”；跨用户轮次继续工作；失败不自动重试。

### R02 · P1 · 编辑消息用错 parentId，可能改掉上一轮并截断后续历史【映射复现】

**证据**：`scripts/agent-ui-bundle/main.jsx:182` 从 appendMessage.parentId 拆 turnId。parentId 是被编辑消息的前驱，不是被编辑消息本身。首条用户消息的 parentId 为空；第二轮用户消息的 parent 是上一轮 assistant。

把当前映射规则接到真实 `rerunTurn` 后复现：编辑第二轮时，结果从 `[first, answer1, second, answer2]` 变为 `[edited second, new answer]`，第一轮也被删掉。UI 点击全过程未单独实测。[assistant-ui 编辑契约](https://www.assistant-ui.com/docs/runtimes/custom/external-store)

**修补**：依据当前固定版本的 sourceId 或消息编辑上下文定位原消息 id；显式 messageId→turnId 映射，勿从 parentId 猜目标。编辑器组件挂载也要做点击验收。重跑前保留历史分支或可恢复副本，避免错误定位扩大为历史丢失。

**验收**：编辑第一条、第二条、中间条分别命中正确用户消息；取消编辑不改历史；旧内容可恢复。

### R03 · P2 · 模型“按轮冻结”只冻结了展示元数据，重试也不恢复原上下文【代码确认】

**证据**：`js/agentui.js:60` buildBody 没传 frozen.model；`electron/agent-net.js:162` 每次重新取当前配置并使用 cfg.agentModel / cfg.agentBaseUrl。`makeRun` 的 frozen=null，`bridge` 中重试直接进入 rerunTurn，后者不读取 doc.turnMeta，也不为新 turnId 登记上下文。

**影响**：生成中改配置，下一工具续轮可能切换模型/端点；重启后重试 PDF 选区问题丢页码、附件、选区上下文；同会话重试旧轮可能使用最近一轮的 frozen。

**修补**：冻结并传递 provider 配置引用、model、thinking、工具集合与阅读上下文；主进程解析配置引用，Key 保持主进程私有。重试从目标 turnMeta 派生新轮，编辑重发明确选择沿用/更新上下文。

**验收**：A 模型运行时改 B，A 轮仍用 A；重启重试原 PDF 问题仍带原附件与页码。

### R04 · P1 · 关键事件没有等待真正落盘，退出收尾也没有等待会话 flush【已复现/代码确认】

**证据**：`js/agentloop.js:130,170,197,223` 的 persist 都不 await；`js/agentui.js:460` persistRun 不返回保存 Promise；`electron/sessions.js:224` setData 只安排 1s 后写盘。`electron/main.js:1981` 关闭时 fire-and-forget flushAll，will-quit 的完成链不等待它。

**复现**：setData 返回成功时，磁盘仍是零消息、无 streaming 标志；注入一个尚未 resolve 的 persist Promise，chat 依然已执行。因此“工具执行前 assistant 一定已落盘”“已完成内容一定在盘上”的注释/文档承诺不成立。

**修补**：保留“delta 只存内存”的低写入策略。将关键事件改为 `await saveCheckpoint`，明确区分内存接收与磁盘提交；session 写入按会话串行、以 revision 防止在途 flush 把新修改误标 clean。退出阶段等待收尾队列与 flushAll，超时如实报告。

**验收**：工具开始时磁盘已有对应 assistant；故障注入写盘延迟/失败不虚报完成；正常退出后最后一轮完整恢复；硬崩溃只丢约定的未完成流增量。

### R05 · P1 · 下载/网页/图谱附件登记被旧会话快照覆盖【已复现】

**证据**：主进程 `sessions.saveAttachment` 在 entry.data.attachments 添加记录；渲染层 run.doc 不同步该字段；下一次 `sessionSetData` 在 `sessions.js:227` 整体替换 entry.data。

**复现**：主进程保存附件后 attachments=1；模拟 Electron IPC 深拷贝提交渲染层旧文档，再 flushAll，attachments=0，文件留在目录里但会话登记丢失。当前 `agentui.js` 转换消息也没有把 doc.attachments 接到新 UI。

**修补**：明确字段所有权：附件由主进程管理，消息 checkpoint 只能 patch 消息/运行字段，不覆盖附件集合；或者 revision 合并并将附件增量回传 UI。加可打开的附件卡和恢复/导出显示。

**验收**：同一轮下载 PDF、fetch 网页、保存图谱后继续聊天，附件登记、打开、导出、重启均保留。

### R06 · P1 · PDF 收入正式库少 await，必定把 Promise 当文件路径【已复现】

**位置**：`electron/main.js:1672`：`const abs = agentSessions.attachmentPath(...)`；该方法在 `electron/sessions.js:338` 是 async。

**复现**：按现有调用方式调用真实 storeFileInto，报 `The "paths[0]" argument must be of type string. Received an instance of Promise`。

**修补**：await attachmentPath，再执行复制；错误显式返回，不生成成功卡。顺带将 app.js importStagedPdfs 的 workId 映射保留到每份 draft，勿通过标题重新找 work（同标题研究可能错误关联）。

**验收**：下载→暂存→确认收入→重复收入去重→全文索引全链；同标题不同 workId 不串联。

### R07 · P1 · 网页快照挂载后清掉该文献全部全文索引【已复现】

**证据**：`electron/main.js:1758` 调用异步 pdfTextPut 却不 await；`js/app.js:8753` 随后调用 `pdfSearchInvalidate({paperId})`，最终 `db.pdfTextInvalidate` 删除该 paper 的全部附件索引。PDF 的旧索引也受影响。

**复现**：临时 DB 先写一个 PDF 和一个 snapshot，调用挂载路径的 invalidate 后索引从两项变为零。原流程另有未 await 的时序竞争，不能保证哪个落地动作最后完成。`LitPdfSearch.reindex` 只处理 PDF，不能自动补回网页快照。

**修补**：await snapshot 的索引写入；挂载后只刷新渲染层 metaCache，不删除已经写好的索引。附件记录与索引写入设计为一个可重试的完成流程。

**验收**：抓网页后新网页和原 PDF 都能检索；重启仍在；任一步失败不显示“已入全文索引”。

### R08 · P1 · fetch_page 修改正式库绕过确认门；取消后确认操作仍可能执行【代码确认】

**证据**：`js/agenttools.js:39` WRITE_TOOLS 只有三项，fetch_page 不在其中；传 paperId 就会写 snapshot、全文索引并 attachSnapshot/save。`js/agentui.js:141` 的确认门在 Promise 返回后不检查 run.cancelRequested；取消只阻止后续循环，不能阻止已在确认链中的操作。

**修补**：将 fetch 的读取和“保存到正式库”拆开，或按参数动态声明写权限；确认通过后及实际提交前再次检查取消状态。下载/fetch/搜索使用 run 级 AbortSignal，删除会话等待活动操作收尾。收藏/收入当前有两层确认，也应统一为一份具体提案的一次确认。

**验收**：未确认不能给正式库加附件；取消后再点旧确认框不会执行；多会话确认明确显示来源会话、文献与目标文件夹。

### R09 · P1 · 调研库重复 upsert 保留原摘要，却用空摘要重建 FTS【已复现】

**位置**：`electron/research-db.js:183`。works 的 UPSERT 使用非空补齐；ftsInsert 却使用输入 c.title/c.abstract，而非数据库实际保留后的值。

**复现**：原摘要 retainedkeyword 能搜到；同 ID 再写空摘要，getWorks 仍返回 retainedkeyword，但 queryWorks 命中变为 0。

**修补**：UPSERT 后读取权威合并行更新 FTS；所有写入口统一更新检索派生数据。

**验收**：重复搜索/不完整元数据入库不减少既有检索命中；标题空值、摘要空值、非空替换均覆盖。

### R10 · P1 · PDF 阅读的附件身份在工具链中丢失【已复现】

**证据**：read_pdf_pages 的 attachmentId 可省略；get_paper 不返回附件清单，fulltext_search 不返回命中的 attachmentId；`db.pdfTextGet` 在 attachmentId 为空时仅查旧的空 ID 行。当前索引按真实附件 ID 存储。

**复现**：p/pdf-a 已有正文，pdfTextGetRange('p','',1,1) 返回 null。除 PDF 选区明确给出附件的路径外，普通问答很容易被错误提示“没有全文索引”。

**修补**：get_paper 返回可读附件及索引状态；全文命中保留 attachmentId；省略时在主进程解析主 PDF；多附件时明确选择。缺索引时提供按需提取/构建，而不是由模型猜附件。

**验收**：只有 paperId 能读主 PDF；补充材料能精确读取；从全文命中跳到正文保持同一附件。

### R11 · 能力缺口（高优先）· 当前并不能理解 PDF 图片

**证据**：read_pdf_pages 只返回文本。没有 image_url/input_image 接线、图表/区域截图工具、图像附件输入；`Core.appendUser` 把内容强制 String，传 content parts 数组会变成 `[object Object],[object Object]`；`sanitizeSessionForDisk` 也把非字符串 content 清空。台账 M9-5 明写截图、多模态和公式渲染为二期。

这不取决于把模型名换成 DS V4.1。DeepSeek 当前 Vision 文档给出 `deepseek-flash` 的图像输入方式，需要 content parts 真正带图像。[官方 Vision 文档](https://api-docs.deepseek.com/guides/vision/)

**修补顺序**：

1. 消息 schema 升级为 text/image parts，存储图片引用，不在每次 JSON 中重复写 base64；为旧 string 会话保留迁移兼容。
2. 复用 PDFium 渲染指定页/区域，保留 paperId/attachmentId/页码/区域坐标；模型能力识别为 vision 后按需发送。
3. 文本优先；图表、公式、扫描页才调用图像路径；空文本页识别并提供 OCR/视觉兜底。
4. 正文分段索引/章节摘要，记录阅读覆盖范围。未读全篇时不能把局部答复宣称为完整全文理解。

**验收**：双栏论文、图表题、公式页、扫描 PDF 四类样例；答案能指回对应页/图，重启后图像上下文可恢复。

### R12 · P2 · PDF 与网页内容被截断后没有可靠的继续读取通道【已复现/代码确认】

**证据**：PDF 每页最多 3500 字、一次 8 页，但 core 工具结果总上限 12000 字符，会在 JSON 中部直接截断；8×3500 的实测结果不是合法 JSON，后面页内容丢失。fetch_page 先在主进程截 6000，又在工具层只给 1500 字符，模型没有会话附件正文读取工具。

**修补**：按结构预算返回完整页/块，带 truncated、nextCursor 与实际覆盖页；允许按页内 offset/章节继续读；网页保存完整文本后提供分页读取。不要要求模型从被截断的 JSON 猜剩余内容。

**验收**：8 页和长网页都能逐段读完，尾部关键结论可被找到，输出明确区分“读取了部分”与“全文”。

### R13 · P1 · 向量检索可混用不同模型、过期文本的向量【已复现】

**证据**：`research-db.js:624` cosineSearch 只取 id/vec，不筛 model、recipe、hash；main 的查询也不传结果 model。`upsertWorks` 改 title/abstract 不删除 vec，只有 updateWorkText 做了失效。

**复现**：给 W1 写 modelA 向量，修改正文后传 modelB 的查询选项，仍返回 W1 且 score=1。相同维度不代表相同向量空间。

**修补**：查询携带 provider/model/revision/dimension/recipe；只检索匹配索引；内容更新在所有入口使旧向量立即失效，后台补建完成后再使用。并发嵌入返回时用内容 hash 校验，拒绝覆盖更新后的文本版本。

**验收**：切换等维模型不混检；改摘要后旧向量立即退出结果；构建中改摘要不会重新写入过期向量。

### R14 · P1 · embedding 失败会被下一次空闲巡检自动重发；计费配置也未独立【已复现/代码确认】

**证据**：research-build 一次失败停批，但 main 每 60s 再 maybeAutoBuild；搜索结果入库也触发 runBuild。两次模拟巡检对同一失败批次实际调用两次 embedTexts，违反“失败不自动重试计费”的用户预期。关闭 semanticEnabled 不会取消已经在跑的 while 循环。

另：新调研库 embedding 与聊天共用 Base URL/Key，仅模型名独立；正式库旧 semantic:* 仍调用 integrations.embedTexts，是另一条配置路径。设置一个开关并不代表两套向量服务已经统一。

**修补**：失败批次进入持久 failed 状态，需明确手动恢复；区分新内容、明确失败、结果不确定三种任务。关闭开关传播 abort；限制请求速率/用量预算。embedding 独立 provider/Base URL/Key/model，统一正式库与调研库的服务层，分别保留索引范围。

**验收**：失败后重复巡检零新增请求；关闭开关后不再发下一批；聊天用 DeepSeek、embedding 用另一个服务可正常并存。

### R15 · P2 · TinyFish 接口基本正确，但结果映射与实际“科研网页检索”范围不完整

**已有**：Search/Fetch 的固定端点、X-API-Key、research_paper 年份参数、Fetch errors[] 与域名校验。官方当前说明 Search 和 Fetch 免费，但 Search 仍需账户访问权限；不能将所有鉴权/权限错误当成没有结果。[Search](https://docs.tinyfish.ai/search-api/reference)、[Fetch](https://docs.tinyfish.ai/fetch-api/reference)

**问题**：

- 官方结果的 pdf_url 没被保存，workFromSearchResult 把网页 url 当 oaUrl；复现输入含 PDF 直链，输出却指向 /abs/ 页面，后续 PDF 下载失败。
- venue 虽解析但丢弃，sourceName 用 siteName；所有 research_paper 结果 type='web'，snippet 当 abstract，混淆出版信息、网页片段与真实摘要。
- search 固定 research_paper，无法覆盖工具描述承诺的一般科研会议网页/项目页/数据集网页；只有 fetch 指定学术 URL 的补充能力。
- web_search 的 collected=!isNew 实际表示“调研库已有”，不代表“正式库已收藏”；Scopus 的 alreadyInLibrary 也应核对语义。
- Search 本地策略 500ms 一次约 120 次/分钟，高于官方默认 30 次/分钟；当前查询 num 不在官方参数表中，不能依赖它做上限，需本地截断/正式分页。

**修补**：保留 pageUrl/pdfUrl/venue/snippet/abstract provenance；缺少条目类型时标未知来源而非统一网页；返回明确 inResearch/inLibrary；增加 academic web 模式并配置域过滤；Search 按账户配额节流，Fetch 使用独立策略。

**验收**：用官方真实响应 fixture 回放，PDF 地址、期刊、来源类型不丢失；重复检索不误报已收藏；paper/web 模式各有契约测试。

### R16 · 产品能力缺口 · “给一段话找文献”尚未成为可验收的流程

**现状**：semantic_search 是“query embedding→本地 vec.db 余弦检索”；OpenAlex 目前使用普通 search；没有独立的段落分解、查询计划、候选精筛、证据归因、检索覆盖审计。Agent 自主搜索可以偶尔达到目的，但不等于已有稳定功能。

**建议采用两条明确入口**：

| 入口 | 推荐流程 | 用途 |
| --- | --- | --- |
| 库内相似文献 | 关键词/FTS + embedding 混合召回 → 去重/重排 | 找已收藏/已调研文献；要明确库范围、模型和索引覆盖率 |
| 为这段话找文献 | 拆成可检索论点 → 中英文同义词/主题/方法查询 → OpenAlex/Scopus/TinyFish 多路召回 → DOI 去重 → 摘要/全文证据筛选 → 逐论点输出文献及支撑片段 | 找新文献或补证据，不要求用户先建本地向量库 |

第二条可以在应用侧不用 embedding：LLM 负责查询改写和证据判别，检索服务负责召回。也可接外部语义检索，作为额外召回路；但不能据“一段话输入”判断底层没有 embedding。OpenAlex 当前 `search.semantic` 接受段落，官方明确基于标题/摘要向量与余弦相似度。[OpenAlex 官方说明](https://help.openalex.org/api/semantic-search/)

**最小落地方案**：新增 `find_literature_for_text` 的受预算控制工作流，先用已有三个外部检索源；输出 claimId→workId/DOI→evidenceText→evidenceSource(abstract/fulltext)→支持/部分支持/不支持。无证据就显示未找到，禁止把“主题相近”标成“支撑论点”。用户确认才收藏正式库。

**验收**：用固定小型评测集覆盖多论点段落、中英文改写、否定结论、矛盾证据、查无依据；考查已核验文献与论点的对应关系，不只看返回篇数。

## 修复安排建议

1. **先恢复可靠闭环**：R01 模型协议、R02 编辑定位、R06 PDF 入库、R07 快照索引、R09 FTS；这些会直接导致主功能失败或结果丢失。
2. **再稳定成果与权限**：R04 checkpoint/退出、R05 附件所有权、R08 写门与取消、R03 冻结/重试。
3. **修语义检索正确性与费用边界**：R13、R14，然后统一服务配置与覆盖状态。
4. **补齐阅读体验**：R10 附件解析、R12 可继续读取、R11 多模态；不要先只改模型选择器。
5. **扩展发现能力**：R15 元数据与网页模式、R16 段落证据检索。

## 测试补强与文档同步

新增的用例应跨实际模块边界，不能只 mock 掉恰好出问题的连接点：

- JSX bridge→真实 runner 的编辑/重试定位；运行中切模型、重启后恢复上下文。
- sessionSaveAttachment→renderer checkpoint→flush→重启读回。
- research:stage-pdfs→实际 attachmentPath/storeFileInto（隔离目录）。
- fetch_page→attachSnapshot→查询原 PDF 与新 snapshot。
- research upsert→FTS/vec 查询，覆盖非空保留与相同维度模型切换。
- 假时钟多次巡检，证明失败批次不自动重新计费；关闭开关停止后续批次。
- DeepSeek 消息回放和 TinyFish 响应 fixture 契约测试，再做用户控制的真实端点验收。

同时更新 AGENTS.md / limitations / task-ledger 的矛盾描述：目前仍同时存在“流式 checkpoint 节流落盘”与“partial 不进存储”，以及“关键事件一定已在盘上”等尚未兑现表述。多模态应继续标为未落地，直至图像请求与恢复链通过验收。

## 修复记录（2026-09-20，当日落实）

本节由修补方追加。以下条目已按上文方案落地并配回归测试（`npm test` 662/662、`npm run lint`、`npm run smoke` 均通过）：

| 编号 | 落实情况 |
| --- | --- |
| R01 | `agentcore.buildRequestBody` 新增 `replayReasoning`：assistant 重放带 `reasoning_content`，由 agentui 按 `agentreason.detect` 仅对 DeepSeek + 带 tools 开启；`agentreason` DeepSeek 关思考改走 `thinking:{type:'disabled'}`（官方 thinking 文档核对）。 |
| R02 | bundle 的 onEdit 前缀在 agentui `turnIdAfterParent` 解析为「前驱之后第一条 user 消息」的真实 turnId，解析不到不动；`rerunTurn` 截断前把被移除历史存 `doc.editHistory`（≤20 份可恢复副本，不进模型上下文）。 |
| R04 | 四个事件点一律 `await persist`；渲染层走新 IPC `session:commit`（sessions.commit：立即写盘、按会话串行、revision 防在途写误标 clean）；关闭收尾的 flushAll 进 will-quit 清理链等待。 |
| R05 | attachments 归主进程所有：setData/commit 不覆盖主进程登记，commit 回传登记同步渲染层副本；run_end 再 sessionRead 同步一次；新增 `#agent-attachments` 附件条（可打开）。 |
| R06 | `research:stage-pdfs` 对 `sessions.attachmentPath` 补 await；`importStagedPdfs` 的 draft↔workId 对应在构建时固定，不再按标题反查。 |
| R07 | `research:fetch-page` 的 `pdfTextPut` 补 await；渲染层挂载只刷 metaCache，删除了 `pdfSearchInvalidate({paperId})`。 |
| R09 | `upsertWorks` FTS 用 UPSERT 后读回的合并权威行重建。 |
| R10 | `get_paper` 返回附件清单；`fulltext_search` 命中带 attachmentId；`read_pdf_pages` 省略 attachmentId 时解析主 PDF（第一个 kind='pdf' 附件）。 |
| R12 | `read_pdf_pages` 按 10000 字符预算裁页 + `truncated/nextFrom` 续读；`fetch_page` 主进程正文缓存（LRU 8）+ `offset/nextOffset` 分块续读，工具层不再截 1500。 |
| R11 | 消息链已铺底：`appendUser {text,images}` 引用式图像（data: URL 拒收、会话 JSON 不落 base64）、`sendImages`（vision 判定保守）才发 parts、主进程 `agent:chat` 出网前把 `session:/config:` 引用解析成 image_url。**图像生产端（PDFium 页面渲染成图进消息）仍为二期未落地**，与 M9-5 台账一致。 |
| R13 | `cosineSearch` 按 model+recipe 过滤候选（调用方传嵌入模型）；`upsertWorks` 嵌入 hash 变化时立即删 vec 行。 |
| R14 | 失败批次写持久 settings 标记 `embedFailedBatch`：maybeAutoBuild 见标记跳过（巡检/入库触发零新增请求），手动「构建」清除标记续跑（确认框明示）；关闭 semanticEnabled 经 `settings:set` 调 `abort()` 停进行中循环。 |

未在本轮处理（保持原判断）：R03（模型按轮冻结传递）、R08（fetch_page 写门与取消复核）、R15（TinyFish 元数据保真）、R16（段落找文献工作流）。

## 修复记录 · 第二批（2026-09-20 追加）

R08 / R03 / R11 已落实（R16 由并行工作线落地，见 `js/litsearch.js`）：

| 编号 | 落实情况 |
| --- | --- |
| R08 | `LitAgent.isWriteTool(name, args)` 动态写权限：fetch_page 带 paperId 即写正式库、必须先确认；确认描述带来源会话与目标文献/文件夹；确认通过后复核 `run.cancelRequested`、工具内正式库提交前经 `ctx.cancelRequested` 再核（取消后晚到的确认不再写入）；删除会话（单个/批量）先 cancel 再 `waitIdle(3s)` 等当前轮收尾。 |
| R03 | 模型随冻结上下文下发（body.model 优先于当前配置）；主进程 chatStream 按 `sessionId\|turnId` 固定本轮 Base URL+Key（turnPins，Key 不出主进程），同轮续请求不随配置中途漂移；rerunTurn 从 `doc.turnMeta[旧轮]` 恢复 frozen 并按新 turnId 重新登记——重启后重试 PDF 选区问题仍带原附件/页码/模型；本轮工具集快照 `run.toolSnapshot`；makeRun 重开时恢复上一轮 frozen。 |
| UI | 阅读页右栏消失（用户实测反馈）：PDF/EPUB 全屏层（fixed z-150）盖住布局流右栏，「AI 解释」把 AI 面板开在了遮挡物后面。修复：`body.reading-open`（app.js `watchReadingRail`，MutationObserver 同步 hidden/class 与 `--reading-rail-w`）下轨栏+侧栏改 fixed 浮到层上（z-171/172）、阅读层右侧让位；轨栏再点当前面板或 AI 关闭钮 = `rail-collapsed` 收起。阅读中详情 / AI 对话 / 手动检索均可达，AI 交互回归对话面板本身。 |
| R11 | 图像生产端落地：① 阅读助手「AI 解释」在 vision 模型下自动渲染当前页截图（`LitPdf.renderPageToPng`，PDF.js 离屏 ×1.6）落会话附件随问题入消息；② agent 工具 `render_pdf_pages`（≤3 页/次）渲染→存会话附件→以 `{text, images}` 返回，agentloop 以 synthetic user 消息注入本轮（`shouldContinue` 按 tool 阶段续跑）；图像只发**尾部轮**（后续轮引用退回纯文本控 token，重跑该轮可再发）；系统提示要求如实声明阅读覆盖范围、公式/图表/扫描页走视觉兜底。**待实机验收**：双栏论文/图表题/公式页/扫描 PDF 四类样例的真实 vision 模型端到端（本批为契约测试 + smoke）。 |

## 修复记录 · R15 / R16（同批完成）

`npm test` 699/699、`npm run lint` 干净、`npm run smoke` PASS（新增 smoke 断言 `agentFindLiteraturePresent`）。

### R15 · TinyFish 元数据保真与配额

- **pageUrl / pdfUrl 分开**：`normalizeSearchResponse` 提取 `pdf_url`（兼容 S2 `openAccessPdf.url` 对象形态），`workFromSearchResult` 只把 PDF 直链写进 `oaUrl`——旧实现把网页 url 当 oaUrl，于是「有 OA 直链却去下载 /abs/ 页面」。
- **venue 与 siteName 分开**：`sourceName` 优先 venue（真实期刊/会议名），没有才退回站点名。
- **snippet 与 abstract 分开**：调研库新增 `snippet` / `page_url` 两列（`RESEARCH_DB_VERSION` 1→2 分步迁移，`works_fts` 重建为 title+abstract+snippet 四列并回填历史行）——网页片段仍在检索索引内，但不再冒充摘要。`upsert` 的非空补齐语义对新列同样成立。
- **entryType 推断**：有 DOI / PDF 直链 / venue → `article`，认识的上游类型名归一，否则如实标 `web`（不再一律 web）。
- **已收藏语义修正**：`inResearch`（调研库已有）与 `inLibrary`（正式库已收藏，researchId + DOI 两路反查）分开回报；旧实现一个 `collected=!isNew` 把前者冒充后者，模型据此误报「已在你库里」。
- **配额**：TinyFish 两端点策略由「2 并发 / 500ms」改为「1 并发 / 2000ms」——官方默认 30 次/分钟，旧值约 120 次/分钟（四倍超限）。
- **检索模式**：`mode='paper'`（默认，research_paper 域）/ `mode='web'`（不限定域，覆盖工具描述承诺的会议主页、项目页、数据集页）。

### R16 · 段落找文献（大模型 tool）

新工具 `find_literature`：把一段论述换成「多路召回 → 合并去重 → 逐论点证据归因」的稳定输出契约，用户不用自己去检索。

- **纯函数层** `js/litsearch.js`（UMD，Node 直测）：`splitClaims`（模型没拆句时按句切分并合并高重叠句）、`termsOf`（拉丁词 + CJK bigram，剔除单字虚字以免稀释覆盖度）、`mergeCandidates`（DOI → workId → 规范化标题三级去重，字段级择优并记全 sources）、`assessEvidence`/`assessVariants`（摘要句子级命中 → `supports`/`partial`/`none`）、`buildFindings`（排序 + summary 状态）。
- **三条硬判据**：① 没有命中论点的证据句就报 `not_found`，绝不把主题相近当依据；② 证据来源如实标注（`abstract` 最可信 / `snippet` 网页片段或上游 TLDR / `title` 仅标题）——**标题命中一律降级 partial**，因为标题不可能承载证据；③ 否定极性相反时标 `polarityMismatch` + `partial`，把矛盾证据交出来而不是藏起来。
- **召回源与降级**：本地调研库关键词（永远可用）+ 本地向量（配了嵌入模型且有向量）+ OpenAlex 语义（`search.semantic`，端点级 1 req/s 闸门 `createEndpointGate`）+ OpenAlex 关键词 + Semantic Scholar 相关度 + 学术网页（开关 + 出境告知）。任一线路失败只影响该线路，逐路回报 `routes` / `routeFailures`；远端召回有预算（默认前 4 条论点），被跳过的透明列入 `notes`。
- **用户没配 embedding**：本地召回自动走关键词、不走向量；`semantic_search` 工具与手动面板「语义检索」按钮同样降级为关键词并在结果里注明（不再是「点了没反应」）。
- **跨语言**：证据匹配是词面匹配，中文论点匹配不了英文摘要。工具新增 `claimsEn`（与 `claims` 一一对应的英文版），召回与证据判定都用两版并取最好（`assessVariants`）；未提供英文版时 `none` 会附「论点与文献语言不同，这是未判定而非不存在」的提示——不让模型误以为「查过了、确实没有」。
- **Semantic Scholar 的事实边界**：S2 公开 API **没有** 文本→向量端点，`/paper/search` 是 S2 自身的相关度排序。代码注释、工具描述与设置页文案都如实这么写，不冒充语义检索；补充工具 `search_semanticscholar`（`includeSemanticscholar` 注册，Key 可选只影响配额：无 Key 共享池 ≈100 次/5 分钟，有 Key 1 次/秒）；`search_openalex` 新增 `mode: keyword|semantic`。
- **配置（设置页新增「语义检索服务商（段落找文献）」分区）**：`integrations.json` 增 `semanticscholarApiKey`（safeStorage）、`openalexSearchEnabled`、`semanticscholarEnabled`（默认全开）；含两个供应商开关、S2 Key 输入与「测试各路线连通性」按钮（真实跑一遍召回链，逐路报通/不通与条数，本地向量状态一并显示。）

**本批未做**：R16 验收清单里的固定评测集（多论点段落 / 中英改写 / 否定结论 / 矛盾证据 / 查无依据）目前是单元级覆盖（`test/litsearch.test.js` 14 例），尚未落成一套端到端评测脚本。
