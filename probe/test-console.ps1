# P0 probe helper: spawn a console window, classify it while it is still alive,
# then clean it up. Proves the "whale console" rule against a real window.
# ASCII-only.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

$probe = Join-Path $PSScriptRoot 'windows.ps1'
$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'title WHALE-PROBE-CONSOLE' -PassThru -WindowStyle Normal
Start-Sleep -Milliseconds 1800
try {
  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $probe 2>&1
  $hit = $out | Select-String -Pattern 'WHALE-PROBE-CONSOLE'
  $kindLine = $out | Select-String -Pattern '^  (whale-console|owner-console)'
  'spawned pid: ' + $p.Id
  'matches for WHALE-PROBE-CONSOLE:'
  if ($hit) { $hit } else { '  (none)' }
  'console classifications seen:'
  if ($kindLine) { $kindLine } else { '  (none)' }
}
finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Get-Process cmd -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*WHALE-PROBE*' } | Stop-Process -Force -ErrorAction SilentlyContinue
  'cleaned up'
}