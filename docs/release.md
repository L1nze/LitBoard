# 下载 LitBoard

从 [GitHub Releases](https://github.com/L1nze/LitBoard/releases) 选择正式版本，下载同一 Release 的程序与 `SHA256SUMS.txt`。

| 文件 | 用途 |
|---|---|
| `LitBoard-Setup-<版本>-x64.exe` | Windows x64 安装版 |
| `LitBoard-Portable-<版本>-x64.exe` | Windows x64 免安装版 |
| `LitBoard-Extension-<版本>.zip`（如提供） | Chrome / Edge 扩展，需连接桌面应用 |

PowerShell 校验（替换为实际文件名）：

```powershell
Get-FileHash -LiteralPath '.\LitBoard-Setup-<版本>-x64.exe' -Algorithm SHA256
```

将 Hash 与同版本校验文件对应项比较。当前构建未签名，Windows 可能提示未知发布者。

两种版本都无需另装 Node.js。数据默认在 `%APPDATA%\LitBoard`，可另选目录；Portable 不自动把数据放到 exe 旁。

应用支持检查正式版本、后台下载和校验；安装版点击「立即更新」启动安装，便携版定位下载文件供替换。升级前可在「数据与备份」创建快照。

操作示例见[功能导览](feature-tour.md)，源码构建见[发布流程](releasing.md)。
