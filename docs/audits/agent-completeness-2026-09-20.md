# Agent 三块完整性审计（2026-09-20）

范围：文献检索与领域研究现状、论文阅读、共用 Agent UI / harness。检查 LitBoard 当前工作区，并对照相邻 `literature-mcp` 仓库。子代理仅使用 gpt-5.6-luna，主代理复核关键调用链和复现结果。本轮不修改产品代码。

## 判断

基础组件已具备，不能据此认定两条用户任务链已经完整。当前优先事项是修复跨模块接线和证据可靠性，不需要先换 Agent 框架。

| 部分 | 已实现 | 完整性判断 |
| --- | --- | --- |
| 检索 | OpenAlex keyword/semantic、Semantic Scholar、Scopus、网页检索、本地 FTS/向量、身份归并、摘要回填、引文网络、收藏 | 发现文献的基础较完整；证据判定、时间约束和本地多词召回存在实际错误 |
| 阅读 | 正式库元数据/全文搜索、按页文本读取、批注读取、视觉模型 PDF 截图工具 | PDF 工具链存在，但当前阅读对象、截图页码、截图消息展示有断点；EPUB 正文未接入 Agent |
| UI / harness | assistant-ui、流式推理/工具卡、状态机循环、会话持久化、取消/重试、上下文压缩、多协议适配 | 组件齐全；编辑入口与视觉消息会失败，压缩并发控制不完整 |

P1 表示应优先修复的核心行为错误，P2 表示影响部分场景的正确性或可靠性问题。以下行号对应本次审计快照。

## 一、文献检索

### S1 · P1：词面相似被当成论文支持，反向结论可误标 supports

位置：`js/litsearch.js:139-207`。

`assessEvidence` 以关键词覆盖率和简单否定词检测决定支持关系。词面分数达标、否定词标记一致就会返回 `supports`，没有判断作用方向、实体关系和比较条件。

主代理直接运行纯函数，结果：

```js
assessEvidence(
  'Drug A increases survival in patients with lung cancer.',
  { abstract: 'Drug A decreases survival in patients with lung cancer.' }
)
// verdict: 'supports', score: 0.833, polarityMismatch: false
```

这是与论点相反的句子。`agentui.js:545` 又要求模型以此工具判定为依据，容易将错误标签传入答案。修复方向：将词面命中限定为相关候选，支持关系另做语义核验，并保留原句、出处和不确定性；不能只继续补充否定词表。

### S2 · P2：find_literature 接收年份条件，但执行时丢失

位置：`js/agenttools.js:353-361`；`electron/main.js:2105-2249`。

工具转交 `yearFrom/yearTo`，主进程 `recallForClaim` 的本地、向量、OpenAlex、S2、网页召回均未应用这些参数，合并归因也未补筛选。指定 2020–2022 年的请求仍可能返回区间外文献。应贯穿每条召回路线，并对最终候选执行统一年份约束；未知年份需明确处理。

### S3 · P2：本地多词检索与工具声明不一致

位置：`js/agenttools.js:36`；`electron/research-db.js:324-349`。

工具声明空格分词 AND，数据库却将整个查询包装成 FTS 连续短语。隔离 SQLite 复现：文献标题为 `deep neural architectures for modern learning`，单独查 `deep`、`learning` 均返回 1 条，查 `deep learning` 返回 0 条。整句论点进入同一路本地召回时，漏召回更明显。

应实现声明的分词 AND 语义，并单独设计显式短语检索。

### 与 literature-mcp 的关系

当前是 JavaScript / Electron 主进程重实现，加上上游调研库导入桥，并非直接启动 Python MCP server 或动态复用其工具注册表。参见 `electron/research-db.js:505` 及 `electron/research-net.js`、`js/agenttools.js`。

一个已核实的能力差异：上游 `openalex_mcp/remote/backfill.py:184-199` 在 Elsevier DOI 摘要获取失败后还尝试 Scopus fallback；本项目 `electron/research-net.js:300-340` 的摘要回填只有 Crossref → Elsevier。这是能力差异，不是当前测试失败，也不意味着必须照搬上游所有工具。

对“了解领域现状”的验收，应检查能否覆盖主要研究路线、经典与近期文献、相反结论和检索限制，而不能仅验证工具成功返回文献列表。

## 二、论文阅读

### 当前实现方式

Agent 从正式库取得 paperId 和附件信息；`read_pdf_pages` 通过 IPC 从已建立的 PDF 全文索引读取指定页；需要公式、图表或扫描页时，视觉模型可调用 `render_pdf_pages`，由 PDF.js 离屏生成 PNG，保存为会话附件，再作为图像消息发送给模型。它不是另一套独立阅读 Agent，也没有将整个 PDF 自动送入模型。

### R1 · P1：截图页码固定偏移一页

位置：`js/agenttools.js:551-569` → `js/app.js:8800-8803` → `js/pdfimport.js:116-125`。

工具接受 1 基页码，将其作为 `pageIndex` 传出；app 适配器再次加 1，而底层本来就接受 1 基页码。请求第 1 页实际渲染第 2 页，图像标签仍称第 1 页；请求末页会超界。调用链已逐层核对。现有渲染工具单测 mock 了适配器，仅检查路径与图片返回，没有核对实际页码。

### R2 · P1：当前阅读标签与 Agent 当前文献不一致

位置：`js/app.js:8771-8775`、`5419-5460`、`2112-2179`；`js/agentui.js:522-534`。

Agent 的 `getCurrentPaper()` 读取列表 `state.focusId`；PDF/EPUB 标签切换更新的是 `pdfState.paper` / `epubState.paper`，不更新该列表焦点。先从列表打开 A、再打开 B，随后在阅读标签切回 A，提问“解释这篇论文”时可能冻结的是 B。

应从当前可见阅读器取得 paperId、attachmentId、页码或 CFI，并将这份上下文按轮冻结；列表场景再使用列表焦点。

### R3 · P2：批注失去附件身份，且只能取得前 50 条

位置：`js/agenttools.js:593-605`。

`list_pdf_annotations` 合并整个 paper 的批注，仅返回页码、文本等字段，没有 attachmentId / annotationId / CFI，也没有分页。主 PDF、补充材料、EPUB 的批注可能混在一起；同一页码无法追溯到具体附件。超过 50 条时，count 也是截取后的长度，调用者看不到真实总数。

### R4 · P2：高密度页面的文本尾部没有续读入口

位置：`electron/db.js:1015-1029`；`js/agenttools.js:486-545`。

数据库默认每页只返回 3500 字符。工具的 nextFrom 解决多页结果预算问题，但没有页内 offset，也不透传 capChars。重读同一页仍只能拿到相同前缀。输出确实说明了截断，因此不是完全静默丢失；但“按页读过”不等于已读完该页文字。需要页内续读，或明确使用视觉兜底并保留覆盖限制。

### 产品能力缺口（与实现错误分开）

- PDF 选区的 AI 解释入口目前不存在。`electron/main.js:363-365` 明确记载该按钮因用户反馈已主动移除；不能把它描述为意外回归。`agentui.js:558-561` 的 selection 提示分支尚存，但 freezeContext 没有提供 selection。当前用户必须在聊天中描述或粘贴选文。
- EPUB 阅读器存在，但当前章节/选区/CFI 没有接入 Agent 正文工具。若论文阅读目标只要求 PDF，此项可延后；若承诺多格式阅读，则仍是缺口。
- 来源定位尚未形成稳定的结构化回答契约。现有提示要求给 id 和页码，但本轮不将“模型可能生成可点击链接”等同于已实现可验证的逐证据跳转。

## 三、共用 Agent UI / harness

### H1 · P1：视觉截图注入后，会话组件因重复消息 ID 报错

位置：`js/agentloop.js:340-351`；`js/agentui.js:760-770`。

截图工具追加 `role:user, synthetic:true` 消息，并沿用本轮 turnId。UI 将所有 user 消息的 ID 都生成成 `turnId + ':u'`，因此与原提问重复。

主代理在隔离 Electron 实例中加载真实 `vendor/assistant-ui/agent-chat.js`，输入与该转换结果相同的消息序列，得到：

```text
MessageRepository(performOp/link): A message with the same id already exists in the parent tree.
```

界面进入“对话渲染出错”错误边界。这条必须与 R1 一起修：只修正截图页码，仍无法完成视觉阅读。消息需要独立稳定 ID，合成图像消息还应与真人提问区分编辑/重试语义。

### H2 · P1：编辑按钮存在，但没有编辑输入界面

位置：`scripts/agent-ui-bundle/main.jsx:91-112`、`216-219`。

消息列表仅注册 UserMessage / AssistantMessage，没有 EditComposer / UserEditComposer；UserMessage 内也没有编辑态输入组件。真实 bundle 的隔离 Electron 复现：点击“编辑”，原文仍是只读，按钮变为 disabled，没有出现填写原文的 textarea，无法完成编辑重发。

应接入编辑态组件，验收按钮 → 修改 → 提交 → 正确轮次重跑全链路，不能只单测 rerunTurn。

### H3 · P2：手动压缩与正常发送可并发，停止控制会失效

位置：`js/agentui.js:465-520`；`electron/agent-net.js:120`、`227`。

手动压缩只检查当前是否 streaming，没有将自身登记为忙碌；压缩期间仍能再次压缩或发送。网络层按 sessionId 保存唯一 controller，新请求覆盖旧请求，旧请求结束又无条件删除该项。

主代理用无网络 mock 运行两条同 session 请求，先让第一条结束，再 cancel，得到 `cancelResult:false, secondAborted:false`。第二条仍在途却无法停止。应对同会话压缩与对话串行化，或为每个请求登记独立身份并验证 controller 所有权。

### H4 · P2：端点真实输入 token 数未经过实际 UI 保存链

位置：`js/agentcore.js:407-434`；`js/agentui.js:647-656`。

core 的 serialize/deserialize 已支持 lastInputTokens，但 UI 手工组装 doc 时漏写它。重新加载会话后真实输入 token 地板丢失，相关预算/工具结果掩码判定退回估算。应统一使用序列化契约，而非继续维护两套字段清单。这一项不等于所有自动压缩都失效。

## 验证范围与限制

- `npm test`：765/765 通过，无跳过。
- `npm run lint`：通过。
- `npm run smoke`：通过，使用脚本创建的隔离 userData。
- 额外复现：真实 Electron bundle 的编辑失败和重复消息 ID；隔离 SQLite 的多词漏召回；证据反向句误判；mock 网络的同会话取消失效。
- 页码错位、阅读上下文、年份丢失等来自跨模块静态调用链复核。
- 未使用真实用户数据库、真实 API Key 或付费外呼；未进行真实模型质量和远端供应商连通性验收。
- 现有 smoke 主要验证对话内容能渲染，不覆盖编辑提交、截图合成消息、阅读标签上下文和跨层过滤条件。测试全绿不能证明这两条产品任务链已闭环。

## 建议实施顺序

1. 修 H1/H2/R1/R2：保证用户能编辑提问，模型读到正确论文与页面，视觉结果能展示。
2. 修 S1/S2/S3：防止错误支持关系、忽略年份和本地漏召回进入领域综述。
3. 修 H3/H4/R3/R4：补齐会话并发、状态保存、批注与长页阅读。
4. 再按产品范围决定选区入口与 EPUB 接入，不先扩大框架。
5. 增加两组任务级验收：领域综述（年份、经典文献、反向证据、查无结果）；论文阅读（多标签、补充附件、长页、公式截图、来源定位、停止与恢复）。
