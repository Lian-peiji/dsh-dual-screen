# probe-menu-title.ps1 -- right-click the pet and read what the PAGE saw (window title).
#
# The page writes "menu@x,y" into document.title when the menu opens, so reading
# GetWindowText separates:
#   title like "<theme name>"  -> the event never reached the page
#   title like "menu@118,132" -> the page saw it
#
# IMPORTANT (2026-11-06): this probe needs REAL injected mouse input. Use inject.ps1 --
# SetCursorPos/mouse_event silently fail in this host (SetCursorPos returns False,
# relative moves stop short) and the old version of this file therefore reported
# "event never reached the page" while the cursor was somewhere else entirely.
# For a test that does not depend on the OS input path at all, use the pet's own
# --selftest=full hook (see HANDOFF.md).
#
# ASCII only.
param(
  [string]$ReadyFile = 'E:\dsh\dual-screen\pet-ready.json',
  [string]$LogFile   = 'E:\dsh\dual-screen\pet-host.log',
  [int]$WaitMs = 900
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'inject.ps1')

$ready = Get-Content -LiteralPath $ReadyFile -Raw | ConvertFrom-Json
$hwnd = [IntPtr][int64]$ready.hwnd
$box = New-Object INJ+RECT
[void][INJ]::GetWindowRect($hwnd, [ref]$box)
$wide = $box.R - $box.L; $tall = $box.B - $box.T
Write-Output ("pet window: L={0} T={1} {2}x{3}" -f $box.L, $box.T, $wide, $tall)

$cx = $box.L + [int]($wide / 2)
$cy = $box.T + [int]($tall * 0.55)
$before = 0
if (Test-Path $LogFile) { $before = (Get-Item $LogFile).Length }

$p = Inject-MoveTo $cx $cy
if ([math]::Abs($p.X - $cx) -gt 2 -or [math]::Abs($p.Y - $cy) -gt 2) {
  Write-Output ("RESULT: BLOCKED -- cursor stopped at {0},{1}, wanted {2},{3}; input injection is unavailable, this probe proves nothing" -f $p.X, $p.Y, $cx, $cy)
  exit 2
}
Start-Sleep -Milliseconds 250
Inject-Click 'right'
Start-Sleep -Milliseconds $WaitMs
Write-Output ("right-clicked at {0},{1}" -f $cx, $cy)

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class GWT2 {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
}
"@
$sb = New-Object System.Text.StringBuilder 512
[void][GWT2]::GetWindowTextW($hwnd, $sb, 512)
Write-Output ("title after: " + $sb.ToString())

if (Test-Path $LogFile) {
  $new = Get-Content $LogFile | Select-Object -Skip ([int]$before) 2>$null
  if ($new) { Write-Output '--- log since right-click ---'; $new | Select-Object -Last 8 | ForEach-Object { Write-Output $_ } }
  else { Write-Output '--- log since right-click: (empty) ---' }
}

# Leave the menu closed: click somewhere neutral inside the pet.
$null = Inject-MoveTo ($box.L + 12) ($box.T + 12)
Inject-Click 'left'