# AI 调研助手契约

调研库与正式文献库分开；`LitAgentUi` 是界面对外门面。计划、参考文件与续接细节见[执行与参考文件](agent-zcode-upgrade.md)，用户侧边界见[已知限制](limitations.md)。

## 模块入口

| 职责 | 模块 |
|---|---|
| 状态、工具、编排 | `js/agentcore.js / agenttools.js / agentloop.js` |
| 界面、会话、快照、富文本 | `js/agentui.js / agentsessions.js / agentsnapshot.js / agentchatrich.js` |
| 协议、服务商、向量配置 | `js/agentproto.js / agentcfg.js / embedcfg.js` |
| 出网、调研存储、向量构建 | `electron/agent-net.js / research-db.js / research-build.js` |
| 会话持久化 | `electron/sessions.js` |
| 对话 UI 构建 | `scripts/agent-ui-bundle/` |

## 数据与配置

- 调研身份为稳定代理键；解析顺序：既有 id → DOI → S2 → URL → 规范化标题 → 新建 local:。外部 ID 单独索引。
- 修改 title/abstract 必使旧向量失效；检索按当前 model+recipe 判断覆盖并过滤，缺索引明确降级关键词。
- 正式库收藏状态与调研库已有状态分开返回；收藏经既有去重入口。
- 多服务商以 `agentcfg` 为唯一权威；扁平字段仅为镜像，saveConfig 后用 `agentMirror()` 重算；每轮冻结服务商、模型、工具与阅读上下文。
- 向量配置独立，半填报错，不静默换账号计费；未填专用端点时保留既有 AI 端点兼容路径。失败批次持久标记，后台巡检不重复提交。
- 三种模型协议集中于 `agentproto`；OpenCode 端点带 `x-opencode-session`，推理参数与回放按协议适配。

## 执行与持久化

- 工具由 REGISTRY 统一登记 schema、when、write、parallel、stepBudget 与 run。
- 正式库写操作经确认；每个异步边界、确认返回后及提交前复核 `cancelRequested`。
- 流式增量留内存；轮开始、执行工具前、每条工具结果、轮收尾均等待 checkpoint 提交。保存失败停轮；退出等待 flush。
- 会话附件由主进程登记，渲染层旧快照不能覆盖；`session.json` 是事实源，Markdown 是导出物。
- 真人提问、摘要与合成图片使用独立消息身份；编辑、重试与分支按真实轮次定位，保留可恢复历史。
- 停止阻断后续调度；已提交或状态未知的操作如实保留，不自动重放写操作。

## 阅读与网络

- 阅读对象按可见阅读器冻结 paperId、attachmentId 与位置；显式附件查询不得回退成另一附件。
- 文本返回结构完整、带覆盖范围与续读位置；批注保留身份和分页。截图为 1 基物理页。
- 网页抓取受开关、告知和学术域限制；解析 HTTP 200 中的 errors，落点越域丢弃正文。
- OA 下载走 safe-fetch；外部检索按主机节流。已收到文本、推理或工具片段的模型请求不自动重发。
- 网络重试限明确的 HTTP 429/502/503/504、DNS/连接拒绝，最多退避两次；Retry-After 超过 10 秒交由用户稍后续接。输出上限被明确拒绝时另有一次按报错上限降额重试。
- 证据须保留来源与原句；词面相关不能判定支持结论。计划完成校验只证明执行依据存在。

## 回归入口

重点覆盖 `test/agent-session-checkpoint.test.js`、`test/agent-tool-cancel.test.js`、`test/agent-reference.test.js`、`test/agent-context-ui.test.js`、`test/research-semantic-search.test.js`。真实服务商、复杂文档与长任务质量另做任务级验收。
