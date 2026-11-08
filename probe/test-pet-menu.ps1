# test-pet-menu.ps1 -- right-click the pet and check the menu appears / acts.
#
# The menu lives in the page, so only a real pointer event proves it. This sends a
# genuine right-click at the pet body and then reads the host log for the action.
#
# ASCII only.
param(
  [string]$ReadyFile = 'E:\dsh\dual-screen\pet-ready.json',
  [string]$LogFile   = 'E:\dsh\dual-screen\pet-host.log',
  [ValidateSet('reset','close','none')][string]$Expect = 'reset'
)

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PM {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint w, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
[void][PM]::SetProcessDpiAwarenessContext([IntPtr](-4))

$ready = Get-Content -LiteralPath $ReadyFile -Raw | ConvertFrom-Json
$hwnd = [IntPtr][int64]$ready.hwnd
$box = New-Object PM+RECT
[void][PM]::GetWindowRect($hwnd, [ref]$box)
$wide = $box.R - $box.L; $tall = $box.B - $box.T
Write-Output ("pet window: {0},{1} {2}x{3}" -f $box.L, $box.T, $wide, $tall)

$before = (Get-Item $LogFile).Length

# Right-click near the middle of the body.
$cx = $box.L + [int]($wide / 2)
$cy = $box.T + [int]($tall * 0.55)
[void][PM]::SetCursorPos($cx, $cy)
Start-Sleep -Milliseconds 400
[PM]::mouse_event(0x0008, 0, 0, 0, [IntPtr]::Zero)   # RIGHTDOWN
Start-Sleep -Milliseconds 120
[PM]::mouse_event(0x0010, 0, 0, 0, [IntPtr]::Zero)   # RIGHTUP
Start-Sleep -Milliseconds 900
Write-Output ("right-clicked at {0},{1}" -f $cx, $cy)

if ($Expect -eq 'none') {
  Write-Output 'RESULT: INFO (menu shown, no action requested)'
  exit 0
}

# Click the menu item. The menu appears at the click point; its two buttons stack
# vertically, so the target is slightly below the click for item #1 (reset) or #2.
$itemY = if ($Expect -eq 'reset') { $cy + 16 } else { $cy + 42 }
$itemX = $cx + 10
[void][PM]::SetCursorPos($itemX, $itemY)
Start-Sleep -Milliseconds 250
[PM]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)   # LEFTDOWN
Start-Sleep -Milliseconds 90
[PM]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)   # LEFTUP
Start-Sleep -Milliseconds 1200

$lines = @()
if (Test-Path $LogFile) {
  $lines = Get-Content $LogFile | Select-Object -Skip ([int]$before) 2>$null |
    Where-Object { $_ -match 'menu action|menu failed|\[el\]' }
}
Write-Output '--- host log since right-click ---'
$lines | Select-Object -Last 6 | ForEach-Object { Write-Output $_ }

$hit = $lines | Where-Object { $_ -match ('menu action: ' + $Expect) }
if ($hit) { Write-Output ('RESULT: PASS (menu action ' + $Expect + ' reached the host)') }
else { Write-Output ('RESULT: FAIL (no "menu action: ' + $Expect + '" in the log)') }