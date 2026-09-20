# agent-ui-bundle（vendor/assistant-ui 的外置构建）

`vendor/assistant-ui/agent-chat.js` 是自包含 IIFE（React 18 + @assistant-ui/react + 本入口），
为 AI 助手抽屉提供对话 UI（assistant-ui ExternalStore runtime）。仓库保持零 node_modules：
依赖安装在外置工具目录，产物以哈希登记进 `vendor/SHA256SUMS`。

## 复现构建

```powershell
node scripts/agent-ui-bundle/build.js
# 依赖安装到 %LOCALAPPDATA%\LitBoardAuiTools（可用 LITBOARD_AUI_TOOLS 覆盖）
npm run vendor-hashes      # 更新 vendor/SHA256SUMS
```

- 版本唯一真源：本目录 `package.json`（精确版本，无 `^`）。
- 改动 `main.jsx` 或升级依赖后必须重新构建并更新 `docs/THIRD-PARTY.md`（含许可证：MIT）。
- 升级 @assistant-ui/react 时需复核 `useExternalStoreRuntime` 适配面与
  `MessagePrimitive.Parts` 的 components 键名（以安装包 .d.ts 为准）。
