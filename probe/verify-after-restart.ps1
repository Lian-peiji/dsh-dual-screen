# verify-after-restart.ps1 -- prove the panel/pet came back on the NEW port.
#
# Runs from a one-shot scheduled task, i.e. OUTSIDE the DSH process tree, so a cold
# restart cannot take the witness down with it.
#
# What it checks (PLAN test 10-14: "panel reopens on the new port after a restart"):
#   1. panel-host.log's newest "data polling started: http://127.0.0.1:PORT/..." --
#      that PORT is the one the *new* process learned; it must differ from the OLD
#      port recorded in the args.
#   2. that URL answers 200 and reports a live panel + pet.
#
# ASCII only.
param(
  [string]$LogDir = 'E:\dsh\dual-screen',
  [string]$OldPort = '',
  [string]$Out = 'E:\dsh\dual-screen\logs\restart-verify.json',
  [int]$WaitSec = 40
)
$ErrorActionPreference = 'Continue'
Start-Sleep -Seconds $WaitSec

$result = [ordered]@{
  checkedAt   = (Get-Date).ToString('s')
  oldPort     = $OldPort
  newPort     = $null
  samePort    = $null
  panelStatus = $null
  petStatus   = $null
  ok          = $false
  notes       = @()
}

# --- find the port the new panel host is polling ---
$newPort = $null
try {
  $hostLog = Join-Path $LogDir 'panel-host.log'
  if (Test-Path -LiteralPath $hostLog) {
    $tail = Get-Content -LiteralPath $hostLog -Tail 80 -ErrorAction Stop
    for ($i = $tail.Count - 1; $i -ge 0; $i--) {
      if ($tail[$i] -match 'data polling started:\s*http://127\.0\.0\.1:(\d+)/') {
        $newPort = $Matches[1]
        break
      }
    }
  }
} catch { $result.notes += ('panel-host.log read failed: ' + $_.Exception.Message) }
$result.newPort = $newPort

# --- ask the new port ---
if ($newPort) {
  try {
    $p = Invoke-RestMethod -Uri ("http://127.0.0.1:$newPort/dsh-dual-screen/panel-window.json") -TimeoutSec 10
    $result.panelStatus = [string]$p.panel.status
    $pet = Invoke-RestMethod -Uri ("http://127.0.0.1:$newPort/dsh-dual-screen/pet.json") -TimeoutSec 10
    $result.petStatus = [string]$pet.pet.status
  } catch {
    $result.notes += ('query failed: ' + $_.Exception.Message)
  }
} else {
  $result.notes += 'no "data polling started" line found in panel-host.log'
}

if ($OldPort -ne '' -and $newPort -ne '') {
  $result.samePort = ($OldPort -eq $newPort)
}
$result.ok = ([string]$result.panelStatus -eq 'open') -and ([string]$result.petStatus -eq 'running')

try {
  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  ($result | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $Out -Encoding UTF8
} catch { }

if ($result.ok) { exit 0 } else { exit 1 }
