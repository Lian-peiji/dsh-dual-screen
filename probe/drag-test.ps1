# drag-test.ps1 -- real mouse drag on a panel edge. ASCII only.
#
# Two traps this file exists to avoid (both measured 2026-11-06):
#   1. The panel host is per-monitor-DPI aware, so its reported rect is PHYSICAL.
#      A DPI-unaware script would feed those numbers to SetCursorPos as virtual
#      coordinates and park the cursor outside the window. We declare awareness first.
#   2. PowerShell is case-insensitive: `$R = $rr.R` overwrites `$rr` when the
#      variable is spelled the same. NEVER reuse r/R, b/B, t/T, l/L, w/W, h/H as
#      both a struct and a number here. Every name below is distinct on purpose.
param(
  [ValidateSet('left', 'right', 'top', 'bottom')][string]$Edge = 'bottom',
  [int]$Delta = 80
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DR {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint w, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

try { [void][DR]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { }

$ready = Get-Content 'E:\dsh\dual-screen\panel-ready.json' -Raw | ConvertFrom-Json
$winHwnd = [IntPtr][int64]$ready.hwnd
$box = New-Object DR+RECT
if (-not [DR]::GetWindowRect($winHwnd, [ref]$box)) { Write-Output 'FAIL: GetWindowRect'; exit 1 }

$left = $box.L; $top = $box.T; $right = $box.R; $bottom = $box.B
$wide = $right - $left; $tall = $bottom - $top
$midX = $left + [int]($wide / 2); $midY = $top + [int]($tall / 2)
Write-Output ("before L=$left T=$top R=$right B=$bottom  ({0}x{1})" -f $wide, $tall)

$dragX = 0; $dragY = 0; $atX = 0; $atY = 0
switch ($Edge) {
  'left'   { $atX = $left + 3;  $atY = $midY;    $dragX = $Delta; $dragY = 0 }
  'right'  { $atX = $right - 4; $atY = $midY;    $dragX = $Delta; $dragY = 0 }
  'top'    { $atX = $midX;      $atY = $top + 3; $dragX = 0;      $dragY = $Delta }
  'bottom' { $atX = $midX;      $atY = $bottom - 4; $dragX = 0;   $dragY = $Delta }
}

$LDOWN = 0x0002; $LUP = 0x0004
[void][DR]::SetCursorPos($atX, $atY)
Start-Sleep -Milliseconds 700
[DR]::mouse_event($LDOWN, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 500
$steps = 10
for ($step = 1; $step -le $steps; $step++) {
  $nx = $atX + [int]($dragX * $step / $steps)
  $ny = $atY + [int]($dragY * $step / $steps)
  [void][DR]::SetCursorPos($nx, $ny)
  Start-Sleep -Milliseconds 90
}
Start-Sleep -Milliseconds 600
[DR]::mouse_event($LUP, 0, 0, 0, [IntPtr]::Zero)
Write-Output ("dragged {0} at ({1},{2}) by ({3},{4})" -f $Edge, $atX, $atY, $dragX, $dragY)

$after = New-Object DR+RECT
[void][DR]::GetWindowRect($winHwnd, [ref]$after)
Write-Output ("after  L=$($after.L) T=$($after.T) R=$($after.R) B=$($after.B)  ({0}x{1})" -f ($after.R - $after.L), ($after.B - $after.T))
Start-Sleep -Milliseconds 2500