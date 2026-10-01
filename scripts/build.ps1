param(
  # 版本迭代级别：每次打包默认把 patch 号 +1（安装包名、SHA256SUMS 与包内版本都跟着变）。
  # 想手动定版本就先跑 node scripts/bump-version.js --level=minor，再用 -Level none 打包。
  [ValidateSet('major', 'minor', 'patch', 'none')][string]$Level = 'patch',
  # 不迭代版本（CI 用：产物版本必须与仓库里的一致）
  [switch]$NoBump,
  # 只打印将要使用的版本，不写 package.json
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $env:LOCALAPPDATA 'LitBoardBuildTools'
$builderCli = Join-Path $toolsDir 'node_modules\electron-builder\out\cli\cli.js'
$electronDist = Join-Path $toolsDir 'node_modules\electron\dist'
& (Join-Path $PSScriptRoot 'ensure-tools.ps1')

if ($NoBump) { $Level = 'none' }
$bumpArgs = @((Join-Path $PSScriptRoot 'bump-version.js'), "--level=$Level")
if ($DryRun) { $bumpArgs += '--dry-run' }
& node @bumpArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& node $builderCli --projectDir $projectDir "--config.electronDist=$electronDist" --win nsis portable --x64 --publish never
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$distDir = [System.IO.Path]::GetFullPath((Join-Path $projectDir 'dist'))
$unpackedDir = [System.IO.Path]::GetFullPath((Join-Path $distDir 'win-unpacked'))
if ($unpackedDir.StartsWith($distDir + [System.IO.Path]::DirectorySeparatorChar) -and (Test-Path -LiteralPath $unpackedDir)) {
  Remove-Item -LiteralPath $unpackedDir -Recurse -Force
}
$debugFile = Join-Path $distDir 'builder-debug.yml'
if (Test-Path -LiteralPath $debugFile) { Remove-Item -LiteralPath $debugFile -Force }
Get-ChildItem -LiteralPath $distDir -Filter '*.blockmap' -File | Remove-Item -Force
exit 0
