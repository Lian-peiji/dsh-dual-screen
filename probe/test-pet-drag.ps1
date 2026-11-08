# test-pet-drag.ps1 -- prove the pet window actually follows the mouse.
#
# The gesture lives in the page, so this has to be a REAL pointer drag, not
# SendMessage: the page listens to DOM mousedown/mousemove, which only fire for
# genuine input routed through Chromium.
#
# 2026-11-06: switched to inject.ps1 (SendInput + closed loop). The old
# SetCursorPos/mouse_event version silently did nothing in this host -- SetCursorPos
# returns False and mouse_event returns void -- so its "PASS" was not trustworthy.
# The script now refuses to report a result when the cursor cannot reach the pet.
#
# ASCII only.
param(
  [string]$ReadyFile = 'E:\dsh\dual-screen\pet-ready.json',
  [int]$Dx = -200,
  [int]$Dy = -120
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'inject.ps1')

$ready = Get-Content -LiteralPath $ReadyFile -Raw | ConvertFrom-Json
$hwnd = [IntPtr][int64]$ready.hwnd
$box = New-Object INJ+RECT
[void][INJ]::GetWindowRect($hwnd, [ref]$box)
$wide = $box.R - $box.L; $tall = $box.B - $box.T
Write-Output ("before: L={0} T={1} ({2}x{3})" -f $box.L, $box.T, $wide, $tall)

# Start near the middle-bottom of the pet body (avoid the very top bubble area).
$startX = $box.L + [int]($wide / 2)
$startY = $box.T + [int]($tall * 0.6)

$p = Inject-MoveTo $startX $startY
if ([math]::Abs($p.X - $startX) -gt 2 -or [math]::Abs($p.Y - $startY) -gt 2) {
  Write-Output ("RESULT: BLOCKED -- cursor stopped at {0},{1}, wanted {2},{3}; input injection unavailable" -f $p.X, $p.Y, $startX, $startY)
  exit 2
}
Start-Sleep -Milliseconds 400

Inject-Button 'left' 'down'
Start-Sleep -Milliseconds 300
$steps = 12
for ($i = 1; $i -le $steps; $i++) {
  $null = Inject-MoveTo ($startX + [int]($Dx * $i / $steps)) ($startY + [int]($Dy * $i / $steps))
  Start-Sleep -Milliseconds 70
}
Start-Sleep -Milliseconds 300
Inject-Button 'left' 'up'
Start-Sleep -Milliseconds 1200

$after = New-Object INJ+RECT
[void][INJ]::GetWindowRect($hwnd, [ref]$after)
Write-Output ("after:  L={0} T={1}" -f $after.L, $after.T)
Write-Output ("moved:  dX={0} dY={1} (wanted {2},{3})" -f ($after.L - $box.L), ($after.T - $box.T), $Dx, $Dy)

$okX = [math]::Abs(($after.L - $box.L) - $Dx) -le 12
$okY = [math]::Abs(($after.T - $box.T) - $Dy) -le 12
if ($okX -and $okY) { Write-Output 'RESULT: PASS'; exit 0 }
Write-Output 'RESULT: FAIL'
exit 1