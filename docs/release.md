# 下载 LitBoard

LitBoard 提供 Windows x64 安装版和便携版。仓库目前保持私有，仅有权限的协作者可访问[正式发布页](https://github.com/L1nze/LitBoard/releases)和下方的直接下载链接。

## 直接下载

以下直接下载 1.0.1 正式版的发布附件。

| 版本 | 直接下载 | 适合 |
| --- | --- | --- |
| Windows 安装版 | [下载 LitBoard-Setup-1.0.1-x64.exe](https://github.com/L1nze/LitBoard/releases/download/v1.0.1/LitBoard-Setup-1.0.1-x64.exe) | 常规安装，可选择安装目录 |
| Windows 便携版 | [下载 LitBoard-Portable-1.0.1-x64.exe](https://github.com/L1nze/LitBoard/releases/download/v1.0.1/LitBoard-Portable-1.0.1-x64.exe) | 免安装运行，适合放在自选位置 |

[查看 1.0.1 发布说明](https://github.com/L1nze/LitBoard/releases/tag/v1.0.1) · [下载 SHA256SUMS.txt](https://github.com/L1nze/LitBoard/releases/download/v1.0.1/SHA256SUMS.txt)

浏览器扩展可[下载 LitBoard-Extension-1.0.1.zip](https://github.com/L1nze/LitBoard/releases/download/v1.0.1/LitBoard-Extension-1.0.1.zip)。它需要连接正在运行的 LitBoard 桌面应用。

## 校验下载文件

从同一次 Release 下载 exe 与 `SHA256SUMS.txt`。在 PowerShell 中计算文件哈希：

```powershell
Get-FileHash -LiteralPath '.\LitBoard-Setup-1.0.1-x64.exe' -Algorithm SHA256
```

便携版将命令中的文件名换为 `LitBoard-Portable-1.0.1-x64.exe`。把输出的 `Hash` 与校验文件中相应文件的 SHA-256 值逐字比较。

## 安装与数据

运行安装包即可安装；便携版可放在自选位置直接启动。两种版本都不需要另行安装 Node.js。主文献库、笔记和受管附件默认保存在 `%APPDATA%\LitBoard`，也可选择其他数据目录；便携版不会自动把数据保存在 exe 所在目录。

应用会检查 GitHub Releases 是否有更高版本的正式发布包，并提示下载；也可在设置中手动检查。下载后仍需自行完成升级。升级前建议在「设置 → 数据与备份」创建快照。当前构建未进行代码签名，Windows SmartScreen 可能显示未知发布者提示；运行前请核对下载文件的 SHA-256。

功能演示见[功能导览](feature-tour.md)。
