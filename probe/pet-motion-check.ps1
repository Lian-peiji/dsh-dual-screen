# pet-motion-check.ps1 -- prove the pet is actually ANIMATING, not a still frame.
#
# Captures the pet window twice ~700ms apart and compares the pixels. A looping
# webm must differ between the two frames; identical bitmaps mean the video failed
# to autoplay (the most common WebView2 failure) and the user would just see a
# frozen sprite.
#
# ASCII only. Usage: powershell -File pet-motion-check.ps1
param(
  [string]$ReadyFile = 'E:\dsh\dual-screen\pet-ready.json',
  [string]$OutDir = 'E:\dsh\dual-screen\shots',
  [int]$GapMs = 700
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PM {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RC r);
  [StructLayout(LayoutKind.Sequential)] public struct RC { public int L, T, R, B; }
}
"@
[void][PM]::SetProcessDpiAwarenessContext([IntPtr](-4))

if (-not (Test-Path -LiteralPath $ReadyFile)) { Write-Output 'FAIL: no ready file'; exit 1 }
$ready = Get-Content -LiteralPath $ReadyFile -Raw | ConvertFrom-Json
$box = New-Object PM+RC
[void][PM]::GetWindowRect([IntPtr][int64]$ready.hwnd, [ref]$box)
$wide = $box.R - $box.L; $tall = $box.B - $box.T
if ($wide -le 0 -or $tall -le 0) { Write-Output 'FAIL: window has no area'; exit 1 }

if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

function Grab([string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $wide, $tall
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($box.L, $box.T, 0, 0, (New-Object System.Drawing.Size $wide, $tall))
  $g.Dispose()
  $path = Join-Path $OutDir $name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  return $bmp
}

$a = Grab 'pet-frame-a.png'
Start-Sleep -Milliseconds $GapMs
$b = Grab 'pet-frame-b.png'

# Count differing pixels; a handful can be antialiasing noise, thousands is motion.
$diff = 0
$stepX = [math]::Max(1, [int]($wide / 120))
$stepY = [math]::Max(1, [int]($tall / 120))
for ($y = 0; $y -lt $tall; $y += $stepY) {
  for ($x = 0; $x -lt $wide; $x += $stepX) {
    $pa = $a.GetPixel($x, $y); $pb = $b.GetPixel($x, $y)
    if ([math]::Abs($pa.R - $pb.R) -gt 6 -or [math]::Abs($pa.G - $pb.G) -gt 6 -or [math]::Abs($pa.B - $pb.B) -gt 6) {
      $diff++
    }
  }
}
$total = [math]::Ceiling($wide / $stepX) * [math]::Ceiling($tall / $stepY)
$a.Dispose(); $b.Dispose()

Write-Output ("window {0}x{1}, sampled {2} points, {3} changed ({4:P1})" -f $wide, $tall, $total, $diff, ($diff / $total))
if ($diff -gt ($total * 0.01)) {
  Write-Output 'RESULT: PASS (animating)'
} else {
  Write-Output 'RESULT: FAIL (static - video likely did not autoplay)'
}