# click-pet.ps1 -- does a REAL click reach the pet page?
#
# WindowFromPoint returning explorer's desktop does NOT prove clicks are lost:
# Chromium's direct-composition window (WS_EX_NOREDIRECTIONBITMAP) is not owned by the
# redirection surface the way WindowFromPoint expects. The only honest test is to click
# and see whether the page reacted.
#
# The page records every mousedown in window.__lastDragPost, and the Electron main
# process logs "drag start" when the renderer reports one. So: click, then read the log.
#
# ASCII only.
param(
  [string]$ReadyFile = 'E:\dsh\dual-screen\pet-ready.json',
  [string]$LogFile = 'E:\dsh\dual-screen\pet-host.log',
  [int]$Clicks = 3
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CK {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint w, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
[void][CK]::SetProcessDpiAwarenessContext([IntPtr](-4))

$ready = Get-Content -LiteralPath $ReadyFile -Raw | ConvertFrom-Json
$hwnd = [IntPtr][int64]$ready.hwnd
$box = New-Object CK+RECT
[void][CK]::GetWindowRect($hwnd, [ref]$box)
$cx = $box.L + [int](($box.R - $box.L) / 2)
$cy = $box.T + [int](($box.B - $box.T) * 0.55)
Write-Output ("window {0},{1} {2}x{3} -> click at {4},{5}" -f $box.L, $box.T, ($box.R - $box.L), ($box.B - $box.T), $cx, $cy)

$before = 0
if (Test-Path $LogFile) { $before = (Get-Item $LogFile).Length }

[void][CK]::SetCursorPos($cx, $cy)
Start-Sleep -Milliseconds 500
for ($i = 0; $i -lt $Clicks; $i++) {
  [CK]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [CK]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 250
}
Start-Sleep -Milliseconds 1200

$new = @()
if (Test-Path $LogFile) {
  $fs = [System.IO.File]::Open($LogFile, 'Open', 'Read', 'ReadWrite')
  $fs.Seek($before, 'Begin') | Out-Null
  $sr = New-Object System.IO.StreamReader($fs)
  $text = $sr.ReadToEnd()
  $sr.Close(); $fs.Close()
  $new = $text -split "`r?`n" | Where-Object { $_ -match 'drag|click' }
}

Write-Output '--- log lines produced by the clicks ---'
if ($new.Count -eq 0) {
  Write-Output '(none - the page never saw the click)'
} else {
  $new | ForEach-Object { Write-Output $_ }
}
if ($new.Count -gt 0) { Write-Output 'RESULT: PASS (clicks reached the pet)' }
else { Write-Output 'RESULT: FAIL (clicks did not reach the pet)' }