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

# 校验和不是可选发布材料：应用内自动更新下载安装包后要按它核对 SHA-256（electron/update-check.js），
# 缺了后台更新永远不就绪。紧跟构建生成，产物缺失（说明打包异常）就直接中止，不再做清理。
& node (Join-Path $PSScriptRoot 'release-checksums.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 清理 electron-builder 中间产物，dist/ 最终只剩发布物：Setup/Portable exe 与 SHA256SUMS.txt
# （外加单独命令 pack-extension 产出的扩展 zip）。latest.yml 无消费方——更新检查走 GitHub API，不走它。
$distDir = [System.IO.Path]::GetFullPath((Join-Path $projectDir 'dist'))
$unpackedDir = [System.IO.Path]::GetFullPath((Join-Path $distDir 'win-unpacked'))
if ($unpackedDir.StartsWith($distDir + [System.IO.Path]::DirectorySeparatorChar) -and (Test-Path -LiteralPath $unpackedDir)) {
  Remove-Item -LiteralPath $unpackedDir -Recurse -Force
}
foreach ($name in @('builder-debug.yml', 'builder-effective-config.yaml', 'latest.yml')) {
  $file = Join-Path $distDir $name
  if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
}
Get-ChildItem -LiteralPath $distDir -Filter '*.blockmap' -File | Remove-Item -Force
exit 0
