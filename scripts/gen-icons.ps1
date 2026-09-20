$ErrorActionPreference = 'Stop'
# LitBoard 品牌图标生成：由 icon/Logo.png 生成全套多分辨率图标
# 输入 icon/Logo.png
# 输出 build/icon-master.png、build/icon-{16,32,48,64,128,256}.png、build/icon.ico、extension/icons/icon-{16,48,128}.png

Add-Type -AssemblyName System.Drawing

$projectDir = $PSScriptRoot
if ($projectDir -match '[\\/]scripts$') { $projectDir = Split-Path -Parent $projectDir }
$buildDir = Join-Path $projectDir 'build'
$extIconDir = Join-Path $projectDir 'extension\icons'
$sourceIconPath = Join-Path $projectDir 'icon\Logo.png'
$masterPngPath = Join-Path $buildDir 'icon-master.png'

if (!(Test-Path $buildDir)) { New-Item -ItemType Directory -Path $buildDir | Out-Null }
if (!(Test-Path $extIconDir)) { New-Item -ItemType Directory -Path $extIconDir | Out-Null }
if (!(Test-Path $sourceIconPath)) {
  throw "Source icon not found: $sourceIconPath"
}

function Save-PngScaled($bmp, $size, $path) {
  $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($bmp, 0, 0, $size, $size)
  $g.Dispose()
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
}

function New-IcoFromPngs($pngPaths, $icoPath) {
  $blobs = @()
  $offsets = New-Object System.Collections.Generic.List[object]
  $headerSize = 6
  $entrySize = 16
  $cursor = $headerSize + ($pngPaths.Count * $entrySize)
  foreach ($p in $pngPaths) {
    $bytes = [System.IO.File]::ReadAllBytes($p)
    $blobs += ,$bytes
    $offsets.Add($cursor)
    $cursor += $bytes.Length
  }
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$pngPaths.Count)
  for ($i = 0; $i -lt $pngPaths.Count; $i++) {
    $bytes = $blobs[$i]
    $w = ($bytes[18] -shl 8) -bor $bytes[19]
    $h = ($bytes[22] -shl 8) -bor $bytes[23]
    $bwByte = if ($w -ge 256) { [byte]0 } else { [byte]$w }
    $bhByte = if ($h -ge 256) { [byte]0 } else { [byte]$h }
    $bw.Write($bwByte)
    $bw.Write($bhByte)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$bytes.Length)
    $bw.Write([UInt32]$offsets[$i])
  }
  foreach ($bytes in $blobs) { $bw.Write($bytes) }
  $bw.Flush()
  [System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
  $bw.Dispose(); $ms.Dispose()
}

# 1. 加载用户提供的源图像，保存母版图
$srcImg = [System.Drawing.Bitmap]::FromFile($sourceIconPath)
Copy-Item $sourceIconPath $masterPngPath -Force
Write-Host "Loaded source: $sourceIconPath ($($srcImg.Width) x $($srcImg.Height))"

# 2. 生成多分辨率 PNG
foreach ($sz in @(16, 32, 48, 64, 128, 256)) {
  Save-PngScaled $srcImg $sz (Join-Path $buildDir "icon-$sz.png")
}
Save-PngScaled $srcImg 16 (Join-Path $extIconDir 'icon-16.png')
Save-PngScaled $srcImg 48 (Join-Path $extIconDir 'icon-48.png')
Save-PngScaled $srcImg 128 (Join-Path $extIconDir 'icon-128.png')

# 3. 打包生成多分辨率 Windows icon.ico
New-IcoFromPngs @(
  (Join-Path $buildDir 'icon-16.png'),
  (Join-Path $buildDir 'icon-32.png'),
  (Join-Path $buildDir 'icon-48.png'),
  (Join-Path $buildDir 'icon-64.png'),
  (Join-Path $buildDir 'icon-128.png'),
  (Join-Path $buildDir 'icon-256.png')
) (Join-Path $buildDir 'icon.ico')

$srcImg.Dispose()
Write-Host "All icons generated from icon/Logo.png successfully."
