# premove-check.ps1 -- does a new console ever become visible on the PRIMARY?
# ASCII-only on purpose: PS 5.1 reads BOM-less .ps1 as ANSI.
#
# Method: spawn an attributable console, snapshot the primary monitor at 200 /
# 400 / 2200 ms, and save all three. If the pre-move (EVENT_OBJECT_CREATE) hook
# works, the console must not appear in the early frames.
param(
  [string]$Title = 'ds-premove',
  [int]$HoldSec = 8,
  [string]$OutDir = 'E:/dsh/dual-screen/shots'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PreDpi {
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
}
'@
[void][PreDpi]::SetProcessDpiAwarenessContext([IntPtr](-4))

function Grab([string]$name) {
  $bmp = New-Object System.Drawing.Bitmap(1024, 576)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size(1024, 576)), 'SourceCopy')
  $g.Dispose()
  $full = New-Object System.Drawing.Bitmap(2560, 1440)
  $gf = [System.Drawing.Graphics]::FromImage($full)
  $gf.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size(2560, 1440)), 'SourceCopy')
  $gf.Dispose()
  $out = New-Object System.Drawing.Bitmap(1024, 576)
  $go = [System.Drawing.Graphics]::FromImage($out)
  $go.InterpolationMode = 'HighQualityBicubic'
  $go.DrawImage($full, (New-Object System.Drawing.Rectangle(0, 0, 1024, 576)))
  $go.Dispose()
  $path = Join-Path $OutDir $name
  if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $full.Dispose(); $bmp.Dispose(); $out.Dispose()
  return $path
}

$p = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\conhost.exe') `
  -ArgumentList @('cmd.exe', '/k', ('title ' + $Title)) -PassThru
[ordered]@{ target = $p.Id; t0 = (Get-Date).ToString('HH:mm:ss.fff') } | ConvertTo-Json -Compress

Start-Sleep -Milliseconds 200
$f200 = Grab 'premove-t200.png'
Start-Sleep -Milliseconds 200
$f400 = Grab 'premove-t400.png'
Start-Sleep -Milliseconds 1800
$f2200 = Grab 'premove-t2200.png'

[ordered]@{ f200 = $f200; f400 = $f400; f2200 = $f2200; holdSec = $HoldSec } | ConvertTo-Json -Compress
Start-Sleep -Seconds $HoldSec
'hold done'