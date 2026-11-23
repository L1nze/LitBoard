# AI 对话 UI 构建

`vendor/assistant-ui/agent-chat.js` 是 React + assistant-ui ExternalStore 的自包含 IIFE。依赖放仓库外，版本以本目录 `package.json` 为准。

```powershell
node scripts/agent-ui-bundle/build.js
npm run vendor-hashes
```

默认工具目录：`%LOCALAPPDATA%\LitBoardAuiTools`，可用 `LITBOARD_AUI_TOOLS` 覆盖。

修改入口或升级依赖后重建 bundle，更新[第三方清单](../../docs/THIRD-PARTY.md)；升级时核对 useExternalStoreRuntime、MessagePrimitive.Parts 及编辑组件契约，运行真实 bundle 交互回归。
