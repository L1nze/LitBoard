# Agent 对话层审查与复用建议

日期：2026-09-20。范围：agentui / agentcore / agent-net / agenttools / sessions、HTML、接线与相关测试。只审查，不改产品代码。

## 结论

当前实现是自制对话原型：原生 DOM 抽屉 + 自制消息状态机 + Chat Completions SSE 解析 + 六个检索工具 + JSON 会话存储。已具备基础聊天外观，但工具闭环、运行生命周期、推理消息契约都不完整。

建议停止逐个手写通用聊天交互，优先复用成熟对话组件及其 runtime。保留 LitBoard 文献检索、调研库、Electron 凭据边界与本地会话能力，增加适配层。底层已确认的缺陷仍需修正或由新 runtime 替换。

以下“复现”指本地 Node 最小脚本；“代码确认”指路径明确但未做真实 Electron 点击测试；“缺项”是产品能力缺失，不代表原一期承诺全部违约。

## 问题清单

### A01 · P1 · 工具执行后直接结束，无法生成基于结果的回答【复现】

- 位置：js/agentui.js runLoop（appendToolResults 后调用 shouldContinue）；js/agentcore.js:179。
- 根因：shouldContinue 通过 pendingToolCalls 判断是否继续，而后者只看最后一条消息。工具落账后最后一条是 tool，必然返回 done。
- 表现：用户“找文献并总结”，完成首批工具后就停止，无法再请求模型总结或进一步查询。该路径也提前绕过 maxSteps / stuck 检查。
- 验收：一次提问连续经过模型→工具→模型→工具→最终回答；完成工具结果后必须继续请求模型。

### A02 · P1 · thinking 返回内容在全链路丢失【复现】

- 位置：electron/agent-net.js:18、40、65；js/agentcore.js:68；js/agentui.js handleEvent / renderAssistant。
- 累积器只接 content / tool_calls，不接 reasoning_content；核心消息也不保存推理部分；UI 没有推理面板。
- 表现：服务商持续返回推理内容时，用户只看见“…”；会话恢复也无推理内容。对要求推理字段回传的端点，还需单独验证工具续轮兼容性。
- 验收：服务商公开返回的 reasoning 或 reasoning summary 可流式展示、折叠、保存与恢复；不支持的模型明确显示能力边界，不伪造 thinking。

### A03 · P1 · 停止按钮只取消 LLM 请求，无法停止完整任务【代码确认】

- 位置：js/agentui.js stopCurrent / runLoop；electron/agent-net.js:202。
- 工具执行期间主进程已经删除 LLM controller，cancel 返回 false；工具不接取消信号，循环也没有取消标记。
- 表现：搜索期间点击停止仍会继续工具调用；删除运行中会话也没有取消 runLoop，后续仍可能联网并向已删除会话尝试写入。
- 验收：停止、删除覆盖网络等待、工具执行与后续步骤；取消后不再发起下一次请求；区分 stopped / failed / completed。

### A04 · P1 · 历史窗口可能产生孤立 tool 消息【复现】

- 位置：js/agentcore.js:199–217。
- 直接 slice 最后 N 条消息，只修剪 assistant 中缺结果的调用，不删除缺 assistant 的 tool 消息。
- 表现：长会话窗口从 tool 开始，发送不合法工具上下文，端点可能拒绝请求。
- 验收：按完整对话轮或工具调用组裁剪；任何 tool 都有窗口内先行调用；增加上下文 token 预算与压缩策略。

### A05 · P1 · 异常结束被当成功；网络错误丢弃已显示内容【部分复现】

- 位置：electron/agent-net.js:159–184；js/agentui.js runLoop catch / finally。
- SSE EOF 没有结束标记也返回成功；finish_reason 未交给核心判定 length / content_filter；尾部无换行 buffer 未处理；普通网络异常不返回已累积消息。也没有显式请求/流空闲超时。
- 表现：截断回答被当完整回答；流中断后已看到的文字消失，只剩错误卡；服务卡住时长期停留生成中。
- 验收：正常结束、截断、异常 EOF、超时、用户取消分别处理，保留部分内容并允许用户手动重试，保持失败不自动重试计费。

### A06 · P1 · 流式输出没有持久化，崩溃可丢整段回复【代码确认】

- 位置：js/agentui.js handleEvent / persist；electron/sessions.js 文件头及 setData。
- delta 仅存 run.streamText，persist 只同步 core.messages；存储层的 1s 防抖不等于流式进度每秒落盘。
- 表现：长回复生成中退出/崩溃会丢该次请求的全部未完成输出，不是注释宣称的“最多 1 秒”。保存异常还被 catch 吞掉。
- 验收：流式 checkpoint、运行状态恢复、保存失败提示；重启后显示 interrupted，不自动恢复计费请求。

### A07 · P2 · 每次流式刷新重建整个消息列表【代码确认】

- 位置：js/agentui.js scheduleStreamRender / renderBody（body.innerHTML = ''）。
- 最短约 100ms 重建全部历史消息，Markdown 也全部重算；工具展开状态仅存在 DOM。
- 表现：工具面板被重新折叠，选中文本与焦点可能丢失，长会话渲染开销不断增长；后台会话流也触发当前会话刷新。
- 验收：按稳定 message/part ID 增量更新；展开状态独立保存；向上阅读时保持位置并提供“回到底部”。

### A08 · P2 · 中文输入法 Enter 可能误发送【代码确认】

- 位置：js/agentui.js:130 附近输入框 keydown。
- 仅判断 Enter / Shift，未排除 event.isComposing / composition 状态。
- 验收：中文候选确认不发送，组合结束后的 Enter 才发送；手动检索框同查。

### A09 · P2 · 会话切换与草稿存在异步竞争【代码确认】

- 位置：js/agentui.js openSession / send / 输入草稿定时器。
- openSession 没有请求序号校验，慢返回会覆盖后一次选择；已有运行会话也被 sessionRead 的返回重新 deserialize；草稿延迟回调读取执行时的 current 与 input.value，而非输入时快照。
- 表现：快速切换可能落到错误会话，A 的待保存草稿可能丢失；读取与运行推进竞争存在状态回退风险，需延迟 IPC 用例验证。
- 验收：最新选择生效、运行态不被旧快照覆盖、草稿按输入时 sessionId 保存。

### A10 · P2 · 重命名后下一次聊天可能恢复旧标题【代码确认】

- 位置：js/agentui.js:705 renameSession / persist。
- 重命名仅更新主进程存储与页面标题，没有更新 runs 中的 run.doc.title；之后整文档 setData 会再写旧标题。
- 验收：重命名→续聊→刷新→重启，标题与目录保持一致。

### A11 · P2 · 运行上下文没有按轮冻结【代码确认】

- 位置：js/agentui.js systemPrompt / runLoop / renderChips / thinking；js/app.js initAgentUi 接线。
- 每个模型步骤读取当时选中的文献/文件夹、全局 thinking 和模型配置；chips 仅在配置刷新或自身点击时更新。
- 表现：生成中切换文献或另一个会话改变设置，可能改变后续步骤语境；界面 chip 不一定对应实际传入内容。doc.model 初始为空，UI 发送路径也未记录所用模型。
- 验收：发送时冻结并持久化模型、参数、文献引用与上下文快照；视图变化不污染正在执行的轮次。

### A12 · P2 · 推理选择器缺模型能力适配【代码确认】

- 位置：js/agentui.js runLoop 的 thinking 参数分支。
- 非默认值大多直接发 reasoning_effort；仅 DashScope 的 off 特判 enable_thinking=false。注释提到的 DeepSeek medium→high 映射在代码里没有实现。
- 验收：按 provider/model 能力映射支持的参数；UI 只展示有效选项；真实 API 合同测试另做，不能用“连接测试成功”代表 thinking / tools 可用。

### A13 · P2 · 重试没有绑定出错轮次；预算跨轮累积【代码确认】

- 位置：js/agentui.js retryLast / renderConversation；js/agentcore.js appendUser / shouldContinue。
- 每个历史错误卡的重试按钮都调用 retryLast，永远截断到最新 user；steps / recentToolSignatures 不在新一轮或重试时清零。
- 表现：点击旧错误卡可能重跑新问题；修复 A01 后，历史工具调用还会污染单轮上限和重复检测。
- 验收：稳定 turnId 绑定重试，分开单轮预算与会话累计用量；重跑范围与费用触发明确。

### A14 · P2 · token 用量估算明显错误【复现】

- 位置：electron/agent-net.js:190–199。
- estimateTokens(String(inChars)) 估算的是字符数这个数字的字符串，而非输入文本。
- 复现：10000 个 ASCII 字符的用户输入被估算为 2 个 input tokens；工具 schema 与 reasoning 用量也未完整计入。
- 验收：有真实 usage 用真实数据，缺失才估算并明确标注；对整段文本估算，纳入工具定义等请求开销。

### A15 · P2 · 基础对话交互缺项【能力盘点】

- 当前正文操作主要只有 assistant 复制、错误重试；缺用户消息编辑重发、重新生成、分支切换、消息级删除、明确的停止后继续入口。
- 等待、推理、工具执行、首字等待都复用 streaming，状态提示无法表达阶段，也没有耗时。
- 缺输入附件/拖放/粘贴图片入口；renderAttachments 只是展示接口，不是完整附件输入链。
- 缺消息流 role=log / aria-live 与可键盘操作的工具折叠、上下文 chips。
- 这些适合复用成熟组件，按产品需求启用，勿全部变成手写功能任务。

### A16 · P2 · 文献工具结果没有产品化呈现【能力盘点】

- 位置：js/agentui.js renderToolStep / renderAssistant；js/agenttools.js tools。
- 工具输出只是折叠 JSON；回答中的 paperId/workId 没有结构化来源卡、核验或跳转映射。
- “当前文件夹”仅提示词背景，search_library schema 没有 folderId 过滤。详情/全文工具能力有限，不能据此承诺整篇 PDF 精读。
- 验收：来源卡可打开对应文献、摘要、全文命中；真实文件夹作用域以工具参数实现；完整 PDF、收藏、写入确认属于后续能力，不混同现有 bug。

### A17 · P1 · 测试没有覆盖真实对话编排【已核对】

- 执行 node --test test/agentcore.test.js test/agent-net.test.js test/agenttools.test.js test/sessions.test.js：30/30 通过。
- 名为 full loop 的测试直接手动 append 最终回答，没有覆盖 UI 在工具完成后应自动发起下一次模型调用；窗口测试未覆盖孤立 tool；无 agentui 交互测试。
- 验收：mock IPC/provider 驱动真实 runLoop，覆盖工具续轮、停止、thinking、切会话、输入法、草稿、流中断和 checkpoint。现有 smoke 的节点存在断言不足以证明功能可用。

## 本地最小复现结果

```text
appendUser → appendAssistant(tool_calls) → appendToolResults → shouldContinue
实际：{ continue: false, reason: 'done' }
预期：继续请求模型消费工具结果

向 createStreamAccumulator 喂 reasoning_content
实际：events=[]，message={ role:'assistant', content:'' }

historyMessageCap=6：assistant(tool) + tool + 5 条 user
实际：请求第一条消息为 tool，缺对应 assistant

模拟流含 content:'partial' 后 EOF，无结束标记
实际：返回成功 message:'partial'；10000 字符输入 usage.prompt_tokens=2
```

验证未调用真实付费 API，未打开真实用户数据库，未操作真实会话。UI 竞争与输入法问题属于代码路径确认，仍需真实 Electron 或交互 harness 验证。

## 复用方案比较

| 方案 | 适合复用什么 | 适配代价与判断 |
| --- | --- | --- |
| assistant-ui | 对话 UI、消息 parts、交互 runtime、编辑/分支/重新生成、工具 UI、推理展示组件 | 首选评估。TypeScript/React；需要给 Agent 面板引入隔离构建与 React 区域，不能按当前 classic script 方式直接贴源码。 |
| Deep Chat | 无框架聊天 Web Component、输入/消息渲染与自定义连接 | 若坚持现有架构，优先验证。官方提供 bundle，可本地 vendor；Agent 循环、推理协议、文献工具与会话持久化仍需适配，不能称为完整 Agent 替换。 |
| Cherry Studio | 完整 Electron 聊天产品的交互与模型适配参考 | 适合对照行为或选择性移植；整套产品工程与 LitBoard 重叠很大，不建议作为可直接嵌入的单一组件。 |

assistant-ui 提供 LocalRuntime（由组件 runtime 管对话状态）和 ExternalStoreRuntime（接既有状态）。为了减少自研，优先验证前者 + Electron ChatModelAdapter + 本地 history/thread adapter；如果选 ExternalStore 却继续保留现有全部自制状态机，关键缺陷仍由自己承担。工具执行位置、推理回传与 runtime 的责任须在验证中明确。

项目当前要求“无框架、零项目 node_modules、vendor classic script”，roadmap 还明确不做 agent 框架/打包器。完整采用 assistant-ui 需要明确调整 Agent 子模块的工程约定。可设计外置依赖和构建工具、生成本地静态 bundle，在 Agent 面板内挂载 React；这是一项待验证的集成方案，不是已经可用的即插即用替换。

建议下一步只做一个复用验证：选定版本、接 mock IPC，跑通 thinking→tool→answer、停止、编辑重发、本地恢复五条链路，再决定替换范围。暂不继续为旧 agentui 添加零散按钮。正式迁移保留 session.json 原始备份并提供版本化转换，不覆盖旧会话。

## 官方来源（2026-09-20 查阅）

- assistant-ui 项目、功能与 MIT 许可：https://github.com/assistant-ui/assistant-ui
- runtime 与持久化职责：https://www.assistant-ui.com/docs/architecture
- 自定义后端路径：https://www.assistant-ui.com/docs/runtimes/custom
- 工具 UI：https://www.assistant-ui.com/docs/tools
- 推理展示产品示例：https://www.assistant-ui.com/
- Deep Chat 源码与 MIT 许可：https://github.com/OvidijusParsiunas/deep-chat
- bundle 安装：https://deepchat.dev/docs/installation/
- 自定义连接：https://deepchat.dev/docs/connect/
- Cherry Studio 完整产品与 AGPL-3.0 许可：https://github.com/CherryHQ/cherry-studio

复用能力依据官方文档初筛；尚未安装依赖、构建候选或验证其与 Electron CSP、现有 i18n、样式和会话协议的兼容性。
