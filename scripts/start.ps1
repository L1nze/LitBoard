$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $env:LOCALAPPDATA 'LitBoardBuildTools'
& (Join-Path $PSScriptRoot 'ensure-tools.ps1')
& (Join-Path $toolsDir 'node_modules\electron\dist\electron.exe') $projectDir
exit $LASTEXITCODE
