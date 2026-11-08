# test-p3-live.ps1 -- end-to-end check of the P3 session-event feed against the LIVE plugin.
#
# It injects nothing: it reads the same panel.json/pet.json the panel reads, so we
# can tell these three states apart:
#   PASS    a turn already ended (or a tool failed) -> rows exist
#   LIVE    no row yet, but the pet mood followed a session event (think/work/happy)
#           -> the hook IS receiving events, the timeline is just still empty
#   PENDING nothing at all -> hook may not be wired
#
# The LIVE tier exists because of a real false alarm (2026-11-06): mid-turn the
# timeline is legitimately empty (tool/call is not a row), so the old version kept
# reporting "no session event has arrived" while mood had already switched to work.
# ASCII only.
param([string]$Base = 'http://127.0.0.1:9968')

$ErrorActionPreference = 'Stop'
try {
  $j = Invoke-RestMethod -Uri ($Base + '/dsh-dual-screen/panel.json') -TimeoutSec 10
} catch {
  Write-Output ('RESULT: FAIL (panel.json unreachable: ' + $_.Exception.Message + ')')
  exit 1
}

$ev = @($j.events)
Write-Output ('events returned: ' + $ev.Count)
foreach ($e in $ev) {
  Write-Output ('  ' + $e.type.PadRight(14) + ' ' + [string]$e.proc + ' ' + [string]$e.reason)
}

$p3 = @($ev | Where-Object { $_.type -like 'turn-*' -or $_.type -eq 'tool-failed' })
if ($p3.Count -gt 0) {
  Write-Output ('RESULT: PASS (P3 rows present: ' + $p3.Count + ')')
  exit 0
}

# No rows yet: ask the pet. think/work/happy can ONLY come from session/event
# (idle/sleep/wait come from time and pendingAsks), so a non-idle mood is proof
# the feed is alive.
try {
  $p = Invoke-RestMethod -Uri ($Base + '/dsh-dual-screen/pet.json') -TimeoutSec 10
  $mood = [string]$p.pet.mood
} catch {
  $mood = ''
}
Write-Output ('pet mood: ' + $mood)
if ($mood -eq 'think' -or $mood -eq 'work' -or $mood -eq 'happy') {
  Write-Output ('RESULT: LIVE (session events are flowing; mood=' + $mood + ', no turn has ended yet)')
  exit 0
}
Write-Output 'RESULT: PENDING (no session event observed yet)'
exit 2
