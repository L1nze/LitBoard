$ErrorActionPreference = 'Stop'

# 安装 LitBoard 的外置构建工具到 %LOCALAPPDATA%\LitBoardBuildTools。
# 版本号统一来自 package.json 的 devDependencies，避免脚本内重复硬编码。
# M2 可信构建：除「文件存在」外还核对 installed-versions.json 中的版本记录，
# 与 package.json 不符（升级配置 / 半安装 / 缺记录）时重新安装，杜绝长期沿用旧 Electron。
$projectDir = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content -LiteralPath (Join-Path $projectDir 'package.json') -Raw | ConvertFrom-Json
$electronVersion = $pkg.devDependencies.electron
$builderVersion = $pkg.devDependencies.'electron-builder'

$toolsDir = Join-Path $env:LOCALAPPDATA 'LitBoardBuildTools'
$electronExe = Join-Path $toolsDir 'node_modules\electron\dist\electron.exe'
$builderCli = Join-Path $toolsDir 'node_modules\electron-builder\out\cli\cli.js'
$versionsFile = Join-Path $toolsDir 'installed-versions.json'

function Test-ToolsUpToDate {
  if (-not ((Test-Path -LiteralPath $electronExe) -and (Test-Path -LiteralPath $builderCli))) { return $false }
  if (-not (Test-Path -LiteralPath $versionsFile)) { return $false }
  try {
    $installed = Get-Content -LiteralPath $versionsFile -Raw | ConvertFrom-Json
  } catch {
    return $false
  }
  return ("$($installed.electron)" -eq "$electronVersion") -and ("$($installed.electronBuilder)" -eq "$builderVersion")
}

if (Test-ToolsUpToDate) {
  exit 0
}

New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null

# 镜像默认不设置：需要国内加速时由使用者自行导出环境变量，例如
#   $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
if ($env:ELECTRON_MIRROR) {
  Write-Host "LitBoard: using ELECTRON_MIRROR = $env:ELECTRON_MIRROR"
}

if (Test-Path -LiteralPath $versionsFile) {
  Write-Host "LitBoard: installed tools version mismatch (want electron@$electronVersion electron-builder@$builderVersion), reinstalling"
} else {
  Write-Host "LitBoard: installing build tools (electron@$electronVersion electron-builder@$builderVersion) into $toolsDir"
}
& npm.cmd install --prefix $toolsDir --no-save "electron@$electronVersion" "electron-builder@$builderVersion"
if ($LASTEXITCODE -ne 0) { throw 'Failed to install external LitBoard build tools' }

# 安装成功后才落版本记录：半安装/中断不会留下与 package.json 恰好一致的假记录。
# 用 .NET API 写 UTF-8 **无 BOM**（PS 5.1 的 -Encoding utf8 会带 BOM，影响跨工具读取）。
$versionsPayload = @{ electron = $electronVersion; electronBuilder = $builderVersion; installedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json
[System.IO.File]::WriteAllText($versionsFile, $versionsPayload, (New-Object System.Text.UTF8Encoding($false)))
