$ErrorActionPreference = 'Stop'
# 打包浏览器扩展为 zip（Chrome/Edge 开发者模式可直接解压加载）
# 共享 translator 层：把项目根 js/translators.js 复制进 extension/js/（开发期未打包加载同样生效）
$projectDir = $PSScriptRoot
if (-not $projectDir) { $projectDir = (Get-Location).Path }          # npm 从项目根目录调用
if ($projectDir -match '[\\/]scripts$') { $projectDir = Split-Path -Parent $projectDir }
$extensionDir = Join-Path $projectDir 'extension'
if (!(Test-Path $extensionDir)) { throw "extension 目录不存在：$extensionDir" }
$translatorsSrc = Join-Path $projectDir 'js\translators.js'
if (!(Test-Path $translatorsSrc)) { throw "共享 translator 不存在：$translatorsSrc" }
$translatorsDstDir = Join-Path $extensionDir 'js'
if (!(Test-Path $translatorsDstDir)) { New-Item -ItemType Directory -Path $translatorsDstDir | Out-Null }
Copy-Item -Path $translatorsSrc -Destination (Join-Path $translatorsDstDir 'translators.js') -Force
$distDir = Join-Path $projectDir 'dist'
if (!(Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }
$target = Join-Path $distDir 'LitBoard-Extension.zip'
if (Test-Path $target) { Remove-Item $target -Force }
Compress-Archive -Path (Join-Path $extensionDir '*') -DestinationPath $target -Force
Write-Host "Extension packed -> $target"
