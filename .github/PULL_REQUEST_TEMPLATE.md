## 这个 PR 做了什么

<!-- 一句话说明改了什么、为什么 -->

## 类型

- [ ] Bug 修复
- [ ] 新功能
- [ ] 重构 / 性能（行为不变）
- [ ] 文档
- [ ] 构建 / 工程配置

## 自查清单

- [ ] `npm test` 全绿（新增可测逻辑已附测试）
- [ ] `npm run lint` 无 error
- [ ] 没有引入 `node_modules` 依赖（新库已 vendor 到 `vendor/` 并在 README 许可一节登记）
- [ ] 新网络出口已加入 `electron/main.js` 的 `ALLOWED_API_HOSTS` 白名单，并同步 `index.html` 的 CSP `connect-src`
- [ ] 改动 UI 结构后已同步更新 `electron/main.js` 的 smoke 断言
- [ ] 弹窗统一走 `dlgConfirm / dlgPrompt / dlgPick`，未使用原生 `alert/confirm/prompt`
- [ ] 文件为 LF 行尾（`.gitattributes` 会自动处理，勿手动改回 CRLF）
- [ ] 未读写真实用户数据目录 `%APPDATA%\LitBoard`

## 怎么验证

<!-- 复现步骤 / 截图 / 测试输出。评审者需要能自己跑一遍 -->

## 关联 issue

Closes #
