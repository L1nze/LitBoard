# 坚果云同步

入口：`js/sync.js` 生成实体级 LWW、墓碑与三方合并计划；`electron/integrations.js` 执行网络与附件同步；`electron/webdav-pacer.js` 控制节流。协议版本以 `SYNC_VERSION` 为准。

## 文件与集合

| 位置 | 内容 |
|---|---|
| 云端 `litboard-library.json / litboard-config.enc` | 文献库与加密便携配置 |
| 云端 `attachments/` | 主 PDF、其他附件、快照 ZIP、笔记资产 |
| 云端 `backups/` | 覆盖前库快照及 cleanup 归档 |
| 本地 `sync-base.json` | 三方基线与 pins |
| 本地 `sync-asset-ledger.json` | 上传台账与限流恢复时刻 |
| 本地 `sync-history/ / synced-attachments/` | 云端库历史与下载缓存 |

新增同步集合时同步登记 `COLLECTIONS`、`workspaceParts / partsWorkspace / cloudWorkspaceParts`、`applySyncPlan` 输出及 integrations 的 `hashWorkspace`。

## 核心契约

- 对象先行：PUT 成功后才登记 cloudName/cloudHash/cloudSize；写云端前由 `sanitizeCloudAssets` 剥离未核实登记。
- 远端存在性以 HEAD/PROPFIND 响应为准，库 JSON 不能自证；真实空清单不能被旧台账覆盖。
- 普通同步按附件差异与本机签名漂移核验。少量对象走 HEAD，批量走相关目录清单；HEAD 403/405/501 回退 PROPFIND。无基线、恢复或计划缺失时完整核验。
- 范围外登记保留；对账和整理始终完整列举。PROPFIND 逐层 Depth:1，支持分页；目录按 resourcetype 识别，不能靠 href 尾斜杠。
- 覆盖云端前本地历史写入必须成功；云端备份尽力 COPY，失败可 GET+PUT。现有策略为本地 20 份，云端超过 8 份裁到 5 份；不重复备份本次同步自己的中间态。
- 远端有效词条减少 ≥max(3,10%) 时暂停确认；首传非空库、一侧突然清空、加载失败均保留保护。
- `lastReadAt` 同步传播但不参与内容签名。批量应用本地结果遵守[保存基线契约](architecture.md)。

## 流程与节流

1. 读取并留档云端库，生成只读计划；冲突或保护命中时返回 pendingPlan。
2. 核验差异附件，净化后 firstWrite。
3. 上传、下载与核实附件；失败进入台账。
4. 同步配置，净化后 finalWrite；保存云端基线并应用本地合并结果。
5. 限流暂停也保存已达成的基线与工作区，返回恢复时刻，避免续传时制造冲突。

应用内 free/pro 档位当前按约 3.1s/1.25s 请求间隔和 30 分钟预算节流，预留终写配额；服务端限流响应与 Retry-After 写入台账。到点自动续传，15 分钟周期同步兜底。

## 以本机为准整理云端

- 只读预览本机保留、云端移除、附件补齐及多余文件；清单无法完整核验时不生成计划。
- 用户单独确认；归档默认关闭，无可靠文件 ETag 时不可启用。生成和应用均占用前后端同步槽位，自动同步让路。
- 执行前复核本机签名、云端版本和 ETag；先写入并回读 `backups/cleanup-<planId>/manifest.json`。
- 不归档时允许部分附件待补，净化悬空登记后条件写库，返回 pendingAttachments；启用归档则须先补齐全部活动附件。
- 仅移动预览中列出且仍未引用的文件；MOVE 带 If-Match、Overwrite:F，每步复核云端库。检测并发引用时尝试移回且不覆盖新对象。
- 限流、中断、并发修改或归档失败后废弃旧计划，重新预览；不自动重放清理。清单已更新则保存基线，本机有新修改时不回灌旧工作区。
- 进度带 scope/planId；弹窗可收起后台运行，停止入口仍可用，失败在当前弹窗和后台状态中可见。
- 对照打开期间暂停自动同步；刷新保留同键决议，安全确认须对新计划重做。

2026-10 真机记录：坚果云 MOVE 曾忽略 If-Match，应用层复核不可省；带请求体操作曾出现瞬时 400，保留错误供排查。整理前暂停其他设备同步；恢复按 manifest 的 source/archived 映射移回，归档不释放备份空间。

## 排障与验证

| 现象 | 处理 |
|---|---|
| 有词条无 PDF | 对账看 missing；在有原文件设备执行完整整理补传 |
| 限流暂停 | 等恢复时刻；不要把长等待当完成 |
| 提示批量移除 | 核对数据目录，再确认删除或恢复云端条目 |
| 两机内容不一致 | 核对账号及大小写敏感的同步目录 |
| 需要找回覆盖内容 | 查云端 backups 或本地 sync-history |

界面只统计有效文献及其引用附件；`audit` 另含 claimedCount、actualCount、missing、orphans。不可核验时显示未知。

回归：`test/sync.test.js`、`sync-refactor.test.js`、`webdav-pacer.test.js`、`asset-ledger.test.js`、`asset-signature.test.js`、`remote-plan.test.js`、`cloud-mirror.test.js`（均位于 test/）。
