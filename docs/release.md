# LitBoard 发布与下载

LitBoard 面向 Windows x64，提供安装版和便携版。可下载的版本及文件以[仓库 Releases 页面](https://github.com/L1nze/LitBoard/releases)实际列出的内容为准。若该页面尚无正式发布或无法访问，就没有可从该入口下载的安装包；本说明不代表已有可用版本。

## 下载文件

打开对应版本的 Releases 页面，在 **Assets** 中选择文件。请从同一次发布下载所需程序及 `SHA256SUMS.txt`，不要混用不同版本的文件。

| 文件名格式 | 用途 |
| --- | --- |
| `LitBoard-Setup-<版本>-x64.exe` | Windows 安装版，适合常规安装 |
| `LitBoard-Portable-<版本>-x64.exe` | 便携版，无需运行安装程序 |
| `LitBoard-Extension-<版本>.zip` | 可选的 Chrome / Edge 浏览器扩展，需解压后加载 |
| `SHA256SUMS.txt` | 同次发布文件的 SHA-256 校验值 |

扩展包仅在该版本随应用一同发布时提供。浏览器扩展需要连接运行中的 LitBoard 桌面应用。

## 校验下载文件

下载后在 PowerShell 中运行下列命令，将 `<版本>` 替换为实际文件名中的版本号：

```powershell
Get-FileHash -LiteralPath '.\LitBoard-Setup-<版本>-x64.exe' -Algorithm SHA256
```

将输出的 `Hash` 与**同一次发布**的 `SHA256SUMS.txt` 中对应文件的哈希值逐字比较。便携版和扩展包可使用相同方法校验，并将命令中的文件名换成已下载文件的名称。

## 安装与首次使用

1. 运行安装程序，或将便携版放在所需位置后启动。
2. 导入 PDF、BibTeX、RIS、CSL-JSON 或 PDF 文件夹；已有 Zotero 文献库可通过应用内向导导入。
3. 在“设置 → 数据与备份”选择快照保存位置，再开始积累重要资料。

安装版和便携版均无需另行安装 Node.js。直接向 Microsoft Word 插入引文时，需要本机安装 Word。浏览器扩展需在浏览器的扩展管理页面启用开发者模式，加载解压后的扩展目录，并在扩展选项中填写 LitBoard 显示的端口和令牌。

## 数据与更新

主文献库、笔记和受管附件默认保存在 `%APPDATA%\LitBoard`，也可使用用户指定的数据目录。便携版不会自动把文献数据放在程序所在目录。

LitBoard 目前不提供自动更新。安装新版本前，建议先在“设置 → 数据与备份”创建快照，再覆盖安装。构建产物尚未进行代码签名，Windows SmartScreen 可能显示“未知应用”提示；运行前请核对下载文件的 SHA-256。

功能演示见[功能导览](feature-tour.md)。
