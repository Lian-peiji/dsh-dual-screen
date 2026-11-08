# test-unplug.ps1 -- single-screen silence: does the plugin really stand down?
#
# Uses DisplaySwitch.exe /internal to make Windows report ONE monitor, which is the
# same state a physically unplugged secondary produces. /extend restores.
#
# WARNING: this changes the owner's live display layout for a few seconds.
# ASCII only.
param(
  [string]$Base = 'http://127.0.0.1:9968',
  [int]$SettleMs = 9000
)
$ErrorActionPreference = 'Stop'

function Get-Json([string]$path) {
  try { return Invoke-RestMethod -Uri ($Base + $path) -TimeoutSec 8 } catch { return $null }
}

function Show-State([string]$label) {
  $h = Get-Json '/dsh-dual-screen/health.json'
  $p = Get-Json '/dsh-dual-screen/pet.json'
  $w = Get-Json '/dsh-dual-screen/panel-window.json'
  $mon = if ($h) { [string]$h.monitors } else { '?' }
  $sec = if ($h) { [string]$h.hasSecondary } else { '?' }
  $act = if ($h) { [string]$h.active } else { '?' }
  $pet = if ($p) { [string]$p.pet.status } else { '?' }
  $pan = if ($w) { [string]$w.panel.status } else { '?' }
  Write-Output ("{0,-10} monitors={1} hasSecondary={2} active={3} pet={4} panel={5}" -f $label, $mon, $sec, $act, $pet, $pan)
}

Write-Output '=== before ==='
Show-State 'before'

Write-Output '=== DisplaySwitch /internal (single screen) ==='
Start-Process -FilePath 'DisplaySwitch.exe' -ArgumentList '/internal' -WindowStyle Hidden
Start-Sleep -Milliseconds $SettleMs
Show-State 'unplugged'

Write-Output '=== DisplaySwitch /extend (restore) ==='
Start-Process -FilePath 'DisplaySwitch.exe' -ArgumentList '/extend' -WindowStyle Hidden
Start-Sleep -Milliseconds $SettleMs
Show-State 'restored'

Write-Output '=== settle extra 6s for auto-restore of panel/pet ==='
Start-Sleep -Milliseconds 6000
Show-State 'after'
