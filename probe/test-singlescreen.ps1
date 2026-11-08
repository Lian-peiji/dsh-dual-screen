# test-singlescreen.ps1 -- single-screen silence, exercised through the real code path.
#
# Why not DisplaySwitch: /internal silently did nothing on this machine (monitors
# stayed 2), so a hardware unplug cannot be simulated here. But the plugin's decision
# is `state.active = enabled && hasSecondary` -- the SAME false branch a missing
# secondary produces. Disabling the plugin therefore exercises the identical guards:
#   - panel must close
#   - pet must stop
#   - POST /pet must answer skipped='no-secondary' (not an error)
# Then re-enabling must bring both back.
#
# ASCII only.
param([string]$Base = 'http://127.0.0.1:9968')

$ErrorActionPreference = 'Stop'

function Post-Json([string]$path, [string]$body) {
  try {
    return Invoke-RestMethod -Uri ($Base + $path) -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 10
  } catch { return $null }
}
function Get-Json([string]$path) {
  try { return Invoke-RestMethod -Uri ($Base + $path) -TimeoutSec 8 } catch { return $null }
}

$pass = 0; $fail = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { $script:pass++ } else { $script:fail++ }
  Write-Output ("[{0}] {1} {2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $detail)
}

$h = Get-Json '/dsh-dual-screen/health.json'
if (-not $h -or -not $h.ok) { Write-Output 'RESULT: ABORT (plugin not answering)'; exit 2 }

Write-Output '=== step 1: disable plugin (drives state.active -> false) ==='
[void](Post-Json '/dsh-dual-screen/config' '{"enabled":false}')
Start-Sleep -Milliseconds 9000

$p = Get-Json '/dsh-dual-screen/pet.json'
$w = Get-Json '/dsh-dual-screen/panel-window.json'
$h2 = Get-Json '/dsh-dual-screen/health.json'
Check 'active went false' ($h2 -and $h2.active -eq $false) ("active=" + $(if ($h2) { $h2.active } else { '?' }))
Check 'panel closed itself' ($w -and $w.panel.status -ne 'open') ("panel=" + $(if ($w) { $w.panel.status } else { '?' }))
Check 'pet stopped itself' ($p -and $p.pet.status -ne 'running') ("pet=" + $(if ($p) { $p.pet.status } else { '?' }))

Write-Output '=== step 2: a manual start must be refused, not faked ==='
$r = Post-Json '/dsh-dual-screen/pet' '{"action":"start"}'
Check 'start refused with skipped=no-secondary' ($r -and $r.skipped -eq 'no-secondary') ("skipped=" + $(if ($r) { $r.skipped } else { '?' }) + " ok=" + $(if ($r) { $r.ok } else { '?' }))

Write-Output '=== step 3: re-enable, everything must come back by itself ==='
[void](Post-Json '/dsh-dual-screen/config' '{"enabled":true}')
Start-Sleep -Milliseconds 12000
$p2 = Get-Json '/dsh-dual-screen/pet.json'
$w2 = Get-Json '/dsh-dual-screen/panel-window.json'
$h3 = Get-Json '/dsh-dual-screen/health.json'
Check 'active true again' ($h3 -and $h3.active -eq $true) ("active=" + $(if ($h3) { $h3.active } else { '?' }))
Check 'panel reopened by autoOpen' ($w2 -and $w2.panel.status -eq 'open') ("panel=" + $(if ($w2) { $w2.panel.status } else { '?' }))
Check 'pet restarted by autoStart' ($p2 -and $p2.pet.status -eq 'running') ("pet=" + $(if ($p2) { $p2.pet.status } else { '?' }))

Write-Output ("RESULT: " + $pass + " passed, " + $fail + " failed")
if ($fail -gt 0) { exit 1 }
