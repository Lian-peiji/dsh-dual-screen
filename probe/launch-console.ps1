# launch-console.ps1 -- open a real console window that stays attributable to DSH.
# ASCII-only on purpose: PS 5.1 reads BOM-less .ps1 as ANSI.
#
# WHY THE HOLD: the mover classifies a window by walking its parent chain up to
# the DSH host. `start`-style launching lets the intermediate process exit before
# the window is shown, which orphans conhost and the chain breaks (observed:
# conhost's parent pid was already gone => verdict "no-rule", no move). So this
# script stays alive for the whole attribution window.
param(
  [string]$Title = 'ds-p3-check',
  [int]$HoldSec = 25
)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $env:SystemRoot 'System32\conhost.exe'
$p = Start-Process -FilePath $exe -ArgumentList @('cmd.exe', '/k', ('title ' + $Title)) -PassThru
'target pid ' + $p.Id
Start-Sleep -Seconds $HoldSec
'hold done'