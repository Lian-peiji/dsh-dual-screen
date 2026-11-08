# test-pet-quit.ps1 -- prove the two exit paths are told apart.
#
# An earlier version treated EVERY self-exit as "the owner closed it", so a crash
# left the pet gone forever. Now pet-electron writes pet-quit.json only when the
# right-click menu closes it; the plugin treats a vanished process WITHOUT that
# file as a crash and restarts it.
#
# This test drives the real menu path (IPC 'pet-menu' act=close) on a throwaway
# instance -- NOT the live pet -- then checks the marker file exists.
#
# ASCII only.
param(
  [string]$Page = '',
  [int]$ExitAfterMs = 12000
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot          # plugin dir (src copy)
$electron = 'E:\dsh\dual-screen\electron\electron.exe'
$dir = 'E:\dsh\dual-screen\selftest'
if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$marker = Join-Path $dir 'pet-quit.json'
$log = Join-Path $dir 'pet.log'
if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker -Force }
if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }

if (-not $Page) {
  Write-Output 'RESULT: SKIP (no -Page given; needs a running DSH port)'
  exit 0
}

$env:ELECTRON_RUN_AS_NODE = $null
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:DSH_PET_PAGE = $Page
$env:DSH_PET_READY = (Join-Path $dir 'pet-ready.json')
$env:DSH_PET_POS_FILE = (Join-Path $dir 'pet-pos.json')
$env:DSH_PET_LOG = $log
$env:DSH_PET_X = '200'
$env:DSH_PET_Y = '700'
$env:DSH_PET_SIZE = '160'
$env:DSH_PET_SELFTEST = 'quit'
$env:DSH_PET_EXIT_AFTER = [string]$ExitAfterMs

# Launch detached. `& $electron $root` waits for the GUI process forever under
# PowerShell 5.1 (measured: the probe hung past 120s and wrote no log at all).
Start-Process -FilePath $electron -ArgumentList @($root) -PassThru | Out-Null

# Wait for the marker (or for the process to give up) -- poll, never sleep blindly.
$deadline = (Get-Date).AddSeconds([math]::Max(8, [int]($ExitAfterMs / 1000)))
while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $marker)) {
  Start-Sleep -Milliseconds 300
}
Start-Sleep -Milliseconds 500

$markerOk = Test-Path -LiteralPath $marker
Write-Output ('quit marker exists: ' + $markerOk)
if (Test-Path -LiteralPath $log) {
  Get-Content -LiteralPath $log | Where-Object { $_ -match 'selftest|quit marker' } | ForEach-Object { Write-Output $_ }
}
if ($markerOk) { Write-Output 'RESULT: PASS (menu close left a marker)'; exit 0 }
Write-Output 'RESULT: FAIL (menu close left no marker)'
exit 1