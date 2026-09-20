# 任务台账（task ledger）

> M0–M8 每个任务的执行状态。状态取值：`未开始` / `进行中` / `完成（已验收）` / `完成（部分，见备注）` / `阻塞`。
> 「验收」列写明验收方式与结果；未通过验收不得标完成。

| 任务 | 内容 | 状态 | 验收 / 备注 |
|---|---|---|---|
| M0-1 | 建立 docs/roadmap.md、audit-baseline.md、task-ledger.md | 完成（已验收） | 三文件就位；问题 15 项入册，标注三态 |
| M0-2 | 修复 `.git`（空目录 → 可用仓库），历史扫描 | 完成（部分，见备注） | `git init -b main` 完成；**无历史可扫**（空仓库），首次 commit 由维护者复核后创建；不自动 commit |
| M0-3 | 根目录调试残留清理 | 完成（已验收） | `repro-*` 5 个文件移入 `.tmp/repro-artifacts/`（.tmp 已 gitignore） |
| M0-4 | 确定性测试数据生成器（1k/10k/50k + 样本 PDF/EPUB） | 未开始 | 计划：脚本生成隔离 SQLite + 资产目录；样本需许可明确来源 |
| M1-1 | 弹窗栈：Esc 只关最顶层 | 完成（已验收） | `js/modal.js`（UMD+node:test 4 例）；app.js 移除一次性全隐列表，改 `LitModal.closeTop()`；19 个 mask + 2 阅读器 + 2 悬浮层经 MutationObserver 自动进栈 |
| M1-2 | 笔记编辑器 dirty 守卫 + 本机草稿持久化 + 草稿不进同步正文 | 完成（已验收） | noteeditor.js：input→dirty+localStorage 草稿（防抖 400ms，pagehide 兜底）；save 写克隆不改实体（markdown 迁移 sourceMarkdown 移至克隆）；保存失败回滚 dirty 保留草稿；requestClose 脏守卫 + confirmDiscard 确认；冒烟断言 `#note-edit-status` |
| M1-3 | 关闭收尾握手（关闭请求→等保存确认→放行），保存失败保留窗口 | 完成（已验收） | main.js close 拦截 + `app:close-request`/`app:close-ack`/`app:close-force`（8s 超时放行）；渲染层 `waitForLocalSave()` 保存链（save() 全部经 trackSave）；失败弹 dlgConfirm 由用户决定强退；内部 relaunch 置 forceQuitNext；退出时不再发起网络同步（改由定时+防抖覆盖，理由见 roadmap M1） |
| M1-4 | 端到端关闭→重启一致性验证 | 完成（已验收） | `npm run smoke:lifecycle` 两阶段真实冒烟：写入→真实窗口关闭（收尾 ack=true）→重启→paperCount=1 标题一致。`npm run smoke` 标准断言 44 项全过（含 closeRequestAckWorks） |
| M2-1 | ensure-tools.ps1 版本核对（空缓存/不符/半安装/离线） | 完成（已验收） | installed-versions.json（无 BOM）比对 package.json；实测三路径：全新安装落记录 / 版本不符自动重装修复（0.0.0→39.2.7）/ 已最新 0.3s 跳过；保持 UTF-8 BOM |
| M2-2 | IPC 受信窗口 + 顶层 frame 校验 | 完成（已验收） | registerIpc 统一 `handle()` 包装（77 通道）：sender 必须=主窗口 webContents 且为顶层 frame；smoke 通过 |
| M2-3 | 桥接 Origin 策略（保留 token） | 完成（已验收） | 仅反射 `chrome-extension://` 来源的 Origin（不再 `*`）；token 鉴权不变；bridge.test.js 新增 4 项断言（扩展/网页/无 Origin/无 token 401） |
| M2-4 | 第三方台账（版本/来源/哈希/许可证） | 完成（已验收） | docs/THIRD-PARTY.md + `npm run vendor-hashes`（vendor/SHA256SUMS，30 文件，--check 可校验）；README 许可节同步指向台账 |
| M2-5 | SECURITY.md 去占位 | 完成（已验收） | 移除 TODO 邮箱占位；唯一渠道=GitHub 私密漏洞报告 |
| M2-6 | 信任边界核查（快照/富文本/EPUB/ZIP/外链/重定向/日志） | 完成（部分，见备注） | CSP 收紧（移除未使用的 cdnjs script-src；pdfimport 的 CDN 兜底一并移除，pdf.js 全走本地 vendor，真实 PDF smoke 通过）；will-navigate/setWindowOpenHandler 原有；快照/EPUB/ZIP 的深度负向测试留待后续批次 |
| M3-1 | 窄窗 PDF 搜索可唤出入口 | 完成（已验收） | ≤1220px：`.pdf-search-toggle` 按钮 + 浮层搜索框；Ctrl+F 自动唤出；Esc 先收浮层再走弹窗栈；smoke 断言 pdfSearchTogglePresent |
| M3-2 | 实体结果分页（100/页）+ ID 索引 | 完成（已验收） | renderEntityHits：paperById 索引替代逐项 find；100 条/页 + 上一/下一页；切查询/视图回第一页；DOM 有界 |
| M3-3 | 通知中心（失败可找回） | 完成（已验收） | `⚠` 失败 toast 自动入册（localStorage 20 条，不上传）；topbar 收件箱入口+未读徽标+复制详情；smoke 断言 issuesCenterPresent |
| M3-4 | 首次使用清单（可跳过、离线可用） | 完成（已验收） | 空库四步引导（导入/扩展/阅读/备份，全部离线可完成）；跳过后保留一行简版空态；smoke 断言 onboardPresent |
| M3-5 | 空态区分（空库/空文件夹/无结果/加载失败/离线） | 完成（部分，见备注） | 空库（引导/简版）、实体结果无匹配（明确提示）已区分；加载失败/离线的专门视图未做（主进程完整性检查与错误弹窗已覆盖致命路径） |
| M3-6 | 键盘可达性核查（核心工作流） | 完成（部分，见备注） | 弹窗 Esc/焦点、阅读器快捷键、Ctrl+F 窄窗可达；完整纯键盘工作流走查（含 NVDA）留待 M3 收尾批次 |
| M3-7 | 文档与实际能力对齐 | 完成（部分，见备注） | README：修正 CDN 描述（已不实）、schema v11→v13、补英文简介/快速开始/文档索引；界面内描述走查未完成 |
| M4-1 | 分段计时（启动/完整性/加载/保存/检索/PDF 首屏/关闭） | 完成（部分，见备注） | smoke 内置 mainBootMs/libraryLoadMs/loadLibraryMs/saveLibraryMs + 生命周期 closeAckMs；`npm run perf`（P50/P95）；检索与 PDF 首屏分段待数据集 |
| M4-2 | PDF 首屏优先 / PDFium Worker 化 | 未开始（有意） | 现有证据无阻塞性问题；正式预算验收前不盲目动渲染管线（roadmap M4 约束） |
| M4-3 | 局部保存实体变更批次 | 未开始（有意） | 需兼容 baseSignatures 冲突裁决，随 M4 数据集基准一起做 |
| M5-1 | CI Windows 打包 + 隔离 smoke | 完成（部分，见备注） | package-smoke job：工具安装→构建（保留 win-unpacked）→打包产物 smoke+生命周期冒烟→官方 dist 脚本→产物上传；**job 首次真实运行需 push 后观察**（本地无法验证 GitHub runner 行为） |
| M5-2 | 安装/升级/Portable/卸载保留/迁移验证 | 完成（部分，见备注） | 本机 `npm run dist` 真实构建成功；**打包版 win-unpacked/LitBoard.exe 通过全部标准 smoke**；lifecycle 冒烟通过；SHA256SUMS.txt 生成。虚拟机级全新安装/覆盖升级/卸载保留验收待维护者环境 |
| M5-3 | 发布材料 | 完成（已验收） | docs/releasing.md（门槛/构建/人工验收/渠道/不做清单）+ scripts/release-checksums.js |
| M5-4 | README 发布面 | 完成（部分，见备注） | 英文简介、快速开始、数据位置、离线能力、文档索引、辅助脚本说明；产品截图待 M6 视觉批次（不放假图） |
| M5-5 | 脱敏诊断包 | 未开始 | 可与「帮助 → 诊断导出」一起做；未阻塞首版 |
| M6–M8 | 视觉精修 / 工作流补强 / 阅读深度 | 未开始 | 发布后启动 |
| M9-1 | AI 调研助手一期：调研库 + 检索 + 只读 Agent + 会话 + 抽屉 UI | 完成（部分，见备注） | 新增 8 模块（research/agentcore/agentloop/agenttools/agentui/agent-net/research-net/sessions）+ 66 项 node:test；2026-09-20 对话层审查（docs/agent-dialog-audit-2026-09-20.md，A01–A17）修复完成：工具循环（A01）、thinking 全链路（A02）、取消贯穿（A03）、窗口裁剪协议（A04）、EOF/超时/partial 分级（A05）、流式 checkpoint（A06）、assistant-ui 对话层替换手写渲染（A07/A08/A15/A16）、竞态/改名/冻结上下文/按轮重试（A09–A13）、用量估算（A14）、mock IPC 编排测试（A17）；对话 UI = vendor/assistant-ui（React 18 + assistant-ui 0.11.58，经 scripts/agent-ui-bundle 外置 esbuild 构建为单文件 IIFE，仓库保持零 node_modules）。`npm test` 581/581、lint 0、smoke PASS。**待实机验证**：assistant-ui 真实交互（编辑重发/重新生成/思考折叠/工具卡）、DeepSeek 真实会话全链路（流式/停止/多会话）、导入 1.1 万篇 harness 库、会话目录改名/回收站/重启续聊 |
| M9-2 | 二期：收藏桥 + B-1 向量扶正 + 回填链 + PDF 两步 + 补登记 + 身份核快照 | 完成（部分，见备注） | schema v14（`paper.researchIds`，normalize/merge setFields 并集，local: 前缀放行）；收藏桥 collect_papers（确认门→addPapers 去重→indexMap 回写 researchIds）；`electron/research-build.js` 向量构建器（content-hash 增量/空闲调度/失败停批不自动重试计费/用量持久化 settings `embedUsageTotals`/检索结果自动嵌入）；回填链 Crossref→Elsevier abstract（每主机节流政策 Elsevier 单并发 ~1.1s、JATS/xml2js 防御解析、429 记账停批续跑、字段级 provenance+改摘要必失效向量）；PDF 两步 download_pdfs（oaUrl→会话附件+魔数校验）/ add_pdfs_to_folder（storeFileInto 受管目录+建并条目挂附件+增量全文索引）；补登记 research:register（DOI 直查+local: 身份创建，提案式由渲染层应用）；身份核快照（backup.js `getResearchIdentity` 钩子→research-identity.json，`importIdentityCore` 恢复有测试）；agenttools 写类三工具+语义工具（WRITE_TOOLS 门+会话 ctx），手动模式加语义检索与收藏按钮。新增 ~40 项测试；smoke 加 `agentPhase2Present` 断言；`npm test` 624/624、lint 0、smoke PASS。**待实机验证**：真实嵌入端点构建 1 万篇耗时/费用、Elsevier 配额行为、PDF 两步真实下载入库、收藏桥真实库去重 |
| M9-3 | 三期：引文网络（vis-network 9.1.9 UMD + 快照导出 + 双入口） | 完成（部分，见备注） | `vendor/vis-network/`（9.1.9 standalone UMD，与上游 harness 同源同版本，673KB，Apache-2.0/MIT 以 MIT 登记，台账三件套齐全）；`js/graphgen.js`（BFS 扩边按被引频次截取、诱导子图两端在集合内才成边、度统计+PageRank 幂迭代、`escapeForInlineScript` 全量 `<`→`\u003c` 杜绝 `</script`/`<!--` 注入——上游 harness 的导出模板此处未防护，我们做了负向测试）；`js/graphview.js` 面板（#graph-mask：深度/上限参数、应用内渲染、导出离线自包含 HTML、关闭只销毁视图）；双入口=文献/文件夹右键「构建引文网络」（researchIds 种子，无身份提示补登记）+ agent `build_graph` 工具（快照存会话附件+面板即时展示）；缺邻居由 research:graph handler 自动补库（fetchWorksByIds 批量+upsert）。7 项测试；smoke 加 `agentGraphPresent` 断言；`npm test` 639/639、lint 0、smoke PASS。**待实机验证**：真实 58/115 节点量级图与 harness 产物对照、导出 HTML 断网双击可用、扩邻居补库的网络表现 |
| M9-4 | 四期：科研网页检索（TinyFish Search + Fetch，学术域限定） | 完成（部分，见备注） | `js/webfetch.js` 纯函数层（学术域固定后缀白名单+边界精确匹配、Search 响应防御式规范化、`parseFetchResponse` 处理 200+errors[] 部分失败、**final_url 越域丢弃**、标题规范化）+ `electron/webfetch-net.js`（TinyFish 适配器收敛全部 provider 特定形状：X-API-Key、`domain_type=research_paper`、`pub_year_min/max`、Fetch urls[]+format=markdown；复用节流队列 2 并发+500ms；按可替换 provider 设计）；入库走 DOI 直查→规范化标题匹配→`local:` 身份+URL ext_id（research-db 新增 `addExtIds`/`findIdByNormalizedTitle`）；`fetch_page` 双路：paperId→snapshot 目录附件（index.html+page.md，LitMarkdown 渲染）+ pdfTextPut 入 pdf_fts（**网页快照全文检索已打通**），未收藏→会话附件 .md；门控三重（设置开关 `webSearchEnabled`+出境告知 `webSearchEgressAcknowledged` 首次开启 dlgConfirm、渲染层工具不注册、主进程 handler 再校验）；设置区「检索与元数据服务」新增开关+TinyFish Key。7 项新测试；smoke `agentWebSearchPresent` 断言含「默认关时工具不注册」的门控验证；`npm test` 649/649、lint 0、smoke PASS。**待实机验证**：TinyFish 真实检索/抓取质量与免费额度条款复核（接入前台账要求）、研究论文增广字段的实际上游字段名（防御式解析已兜底）、快照附件经同步往返的完整性 |
| M9-5 | PDF 阅读助手（期一：agent 原生阅读理解） | 完成（部分，见备注） | 能力长在 agent 工具集上：新增 read_pdf_pages（按页区间读正文，单次 ≤8 页成本护栏、每页截断）与 list_pdf_annotations（读用户批注，含页码/类型/文本/评论）两工具；存储层 pdfTextGetRange + IPC pdfsearch:get-page-range（只解压一次、按 [from,to] 切片返回，避免整篇过 IPC）；阅读器选区弹层新增「AI 解释」按钮 → explainSelection：选区（文本+页码+附件）冻结进本轮上下文（A11 框架），系统提示注入阅读指导（先读同页±邻页再解释、公式纯文本失真须声明局限）。**2026-09-20：该按钮与 explainSelection 全链路已移除（用户反馈无实际作用），按页理解走 read_pdf_pages / render_pdf_pages 工具组合。**「整篇问答」由工具组合自然覆盖（fulltext_search 定位 + read_pdf_pages 分段读）。`npm test` 627/627、lint 0、smoke PASS（agentReaderPresent）。**二期项**：公式/图表区域截图 + 多模态消息通道 + MathJax（tex-svg 单文件）渲染 LaTeX。**待实机验证**：真实模型对阅读指导的遵循度、长文档分页读取的实际 token 表现 |
| M9-6 | Scopus 检索（Elsevier Search API 互补发现源） | 完成（部分，见备注） | 事实纠偏：OpenAlex 已收录几乎所有 Scopus 索引期刊（Elsevier 向 Crossref 存缴元数据），不做「分工检索」而是互补源。`research-net.js` 新增 searchScopus（STANDARD view、TITLE-ABS-KEY 查询、PUBYEAR AFT/BEF、节流队列复用 api.elsevier.com 单并发 1.1s 政策、401/403 明确报权限不足）+ fetchWorksByDois（DOI 批量反查 OpenAlex，25/批）；主进程 research:search-scopus 三级归并：DOI 查 ext_ids 已存在→标注 / OpenAlex 反查到 W-id→以 OpenAlex 元数据入库 / 均无→local: 身份兜底（标题+来源+Scopus 引用数）；agent 工具 search_scopus（配置 Elsevier Key 才注册，返回 Scopus 引用数与 alreadyInLibrary，注明无摘要）。免费 Key 即可 STANDARD 检索（COMPLETE view/摘要需机构订阅，已如实写进工具描述与设置文案）。`npm test` 632/632、lint 0、smoke PASS。**追加（同日）**：自动摘要回填上线——`scheduleAutoBackfill`（main.js）在 search-openalex / search-scopus 入库后与本库导入完成后，对本批缺摘要且有 DOI 的条目后台跑 Crossref→Elsevier（同节流队列与配额记账，单批 ≤25，fire-and-forget 不阻塞返回）；手动「回填缺失摘要」按钮按用户要求**保留**（存量清扫入口）。**待实机验证**：用户 Key 的 Scopus Search 实际权限与配额行为；自动回填的真实配额消耗 |
| B-1 | 语义检索扶正：独立向量嵌入接入 + 增量索引 + 成本护栏 | 未开始（有意缓后） | 现状为权宜实现：嵌入模型写死（Qwen/OpenAI）、凭据复用划词翻译、构建全量重嵌、默认关闭；费用已评估（1 万篇全量约数元人民币，风险在重复构建而非规模）；规格见 roadmap backlog B-1。**2026-09-19 起并入 M9-2 执行**（调研库向量是 B-1 接入层的第一个消费者，正式库语义检索随后迁移） |

## 会话落盘节奏重做（2026-09-20 追加轮）

起因：用户问「疯狂写盘是否伤 SSD」。实测数据量级可忽略（最大会话 68KB、每秒约 69KB、一年约 45GB，
相对 600TBW 是万年量级），但发现真实工程问题：每次落盘全量重写会话文档（O(对话长度)），
且 index.json 跟着每条消息重写。

调研 9 个开源项目（Cherry Studio / Jan / Lobe Chat / Cline / Roo Code / Continue / LibreChat /
Open WebUI / AnythingLLM）后的结论：**没有一个在流式期间按定时器全量重写会话文件**，
共识是「partial 不进存储，只在事件点落盘」。据此重做：
- 流式增量只进内存；落盘只在四个事件点（轮开始 / **执行工具前** / 工具结果 / 轮收尾）；
- index.json 改 2s 防抖写，结构变更（新建/改名/删除）与 flushAll 强制立即写；
- 硬崩溃丢半截（业界一致取舍），运行标记留真时按「unfinished 行」恢复为已中断 + 手动重试；
- `restoreInterrupted` 判定改由运行标记驱动（缓冲非空不再作为依据），并保留重复内容防御。

过程中测试抓到一处实现缺陷：`upsertIndexEntry` 同时服务结构变更与消息落盘，若在内部强制写索引
会让防抖完全失效——已拆出 `immediate` 参数，结构变更才传真。

验收：`npm test` 601/601 · lint 0 问题 · smoke PASS；新增/改写 6 项针对性测试
（流式不落盘、事件点落盘次数有界、索引防抖与结构变更立即写、中断恢复三种分支）。

## 阻塞与外部依赖

- 无外部凭据类阻塞。CI 打包 job（M5-1）首次真实运行需 push 到 GitHub 后观察，本地只能做结构验证。

## 仍未验证事项（滚动更新）

- CI `package-smoke` job 的首次真实运行（需 push 到 GitHub 观察；结构已按本地等价流程验证）
- 虚拟机级全新安装 / 覆盖升级 / 卸载后数据保留（维护者环境，见 docs/releasing.md 清单）
- 1 万 / 5 万篇正式性能验收（待 M0-4 确定性数据集生成器落地后重测，替换 audit-baseline.md 空库基准）
- 快照 / EPUB / ZIP 的深度负向安全测试（M2-6 余项）
- 完整纯键盘 + NVDA 工作流走查（M3-6 余项）
- 产品截图（M5-4 余项，待 M6 视觉批次出真实界面图）
- **M9-1 AI 调研助手实机验证**：真实 LLM Key 的对话全链路（流式/停止/重试/多会话并行不中断）、
  从 `~/.AI-CACHE/openalex/library.db` 一次性导入 10,922 篇的耗时与 FTS 表现、
  会话目录在真实磁盘的改名/回收站/重启续聊、手动检索模式（无 Key）可用性

## 最终验证记录（2026-09-17 本轮收尾）

`npm test` 392/392 · `npm run lint` 退出码 0 · `npm run smoke` PASS ·
`npm run smoke:lifecycle` PASS · `npm run vendor-hashes` 一致 · `npm run dist` 构建成功且
打包版二进制通过 smoke · SHA256SUMS.txt 已生成 · 全部新文件 LF、ensure-tools.ps1 带 BOM ·
git 仓库已初始化（27 个顶层路径 untracked，**未做任何 commit/push**，按约定留给维护者）。

## Word 联动真机诊断与修复（2026-09-17 追加轮）

- **用户报告「Word 联动总报错」→ 根因定位（运行已复现）**：v2 协议在 cscript/WSH 宿主依赖原生
  `JSON` 对象，实测本机（Win10 26100）`JSON` 未定义；`//B` 模式下解析与响应构造双双静默崩溃 →
  渲染层所有命令 30s 超时。`updateBibliography` 内第二处 `JSON.stringify`（参考文献域载荷）同病。
- **修复（完成，已验收）**：v3 协议（纯 b64 字段、JScript 零 JSON、命令行组装移至 Node 侧）；
  真机验证 PING/INFO 即时返回（Word 16.0）；`npm run diag:word` 诊断工具转正；
  静态契约测试新增「桥源码禁 JSON」断言；顺带删除 word-bridge.js 被覆盖导出的死代码 legacy 实现。
- 全量回归：395/395 测试 · lint 0 · smoke PASS。
- **待维护者实机复核**：INSERT/刷新引文/参考文献表/解除关联需要在真实文档会话里走一遍
  （诊断工具不触碰用户打开中的文档）；另注意 Word 弹模态对话框（保护视图/激活）期间 COM 会挂起超时。

## 死代码清理（2026-09-17 追加轮）

方法：全库引用扫描（函数声明/UMD 导出/CSS 选择器/preload API/IPC 通道/SVG symbol/DOM id）+ 逐项人工核实
（动态拼接类名 `'status-'+x`、`svgUse('lb-i-note')`、`sectionId+'-section'` 等逐一排除误报；`js/cite.js` 按约定未动）。

已删除：
- 文件：`scripts/legacy/`（旧图标方案 2 文件，README/eslint ignores 同步更新）、根目录 `sample.bib`（零引用）、
  `test/smoke-embedded-font-result.json`（测试残留）、`.tmp/` 36MB 历史审查与冒烟产物。
- index.html：静态 `#pdf-loading` / `#epub-loading` 占位元素（打开路径总是先写 innerHTML，已核验两条打开链路）。
- css/style.css：`.pdf-text-layer .endOfContent` 与 `.selecting` 规则（pdf.js 5.x 不再注入该元素）。
- preload/main/data-paths：零调用链 `clearBackupDir`（preload→`backup:clear-dir`→data-paths 三层）、
  `readBytes` 重复别名、`isSmokeTest`。

核实后**保留**（非死代码）：`status-*`/`ctx-dot-*`/`pdf-annotation-*` CSS（表格行/右键菜单/批注层动态拼接）、
所有 `lb-i-*` 图标、model.js/sync.js/query.js 的内部调用导出（测试契约面）。
删除后验证：392/392 测试 · lint 0 · 标准 smoke PASS · lifecycle smoke PASS。
