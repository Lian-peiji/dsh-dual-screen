# screengrab.ps1 -- capture a rectangle of the physical desktop to a PNG.
# ASCII-only on purpose: PS 5.1 reads BOM-less .ps1 as ANSI.
# Physical pixels require Per-Monitor V2 awareness, otherwise Windows returns a
# virtualized (DPI-scaled) desktop and the capture lands on the wrong monitor.
# NOTE: Graphics.CopyFromScreen() does NOT scale -- it blits 1:1 and clips to the
# destination bitmap. So capture full size first, then draw a scaled copy.
param(
  [Alias('X')][int]$PosX = 2560,
  [Alias('Y')][int]$PosY = -588,
  [Alias('W')][int]$Width = 1600,
  [Alias('H')][int]$Height = 2560,
  [double]$Zoom = 0.5,
  [string]$Out = 'E:/dsh/dual-screen/shots/shot.png'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShotDpi {
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
}
'@
[void][ShotDpi]::SetProcessDpiAwarenessContext([IntPtr](-4))

$full = New-Object System.Drawing.Bitmap($Width, $Height)
$g0 = [System.Drawing.Graphics]::FromImage($full)
$g0.CopyFromScreen($PosX, $PosY, 0, 0, (New-Object System.Drawing.Size($Width, $Height)), 'SourceCopy')
$g0.Dispose()

$tw = [int]([math]::Max(1, $Width * $Zoom))
$th = [int]([math]::Max(1, $Height * $Zoom))
if ($Zoom -ne 1) {
  $img = New-Object System.Drawing.Bitmap($tw, $th)
  $g1 = [System.Drawing.Graphics]::FromImage($img)
  $g1.InterpolationMode = 'HighQualityBicubic'
  $g1.DrawImage($full, (New-Object System.Drawing.Rectangle(0, 0, $tw, $th)))
  $g1.Dispose()
} else {
  $img = $full
}

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$img.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
if ($Zoom -ne 1) { $full.Dispose() }
$img.Dispose()
'{ "ok": true, "path": "' + $Out + '", "src": [' + $PosX + ',' + $PosY + ',' + $Width + ',' + $Height + '], "zoom": ' + $Zoom + ', "px": [' + $tw + ',' + $th + '] }'