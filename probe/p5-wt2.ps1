# probe/p5-wt2.ps1 -- run Windows Terminal with --pos, capture its own stderr, measure the window.
$ErrorActionPreference = 'Continue'
$wt = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\wt.exe'
$log = Join-Path $env:TEMP 'p5-wt2.log'
$p = Start-Process -FilePath $wt -ArgumentList '--pos','2584,-564','cmd.exe','/c','ping -n 8 127.0.0.1' -PassThru -RedirectStandardError $log -RedirectStandardOutput "$log.out"
Start-Sleep -Milliseconds 3000
'wt pid: ' + $p.Id + ' exited: ' + $p.HasExited
'stderr: ' + (Get-Content $log -Raw -EA 0)
'stdout: ' + (Get-Content "$log.out" -Raw -EA 0)
. (Join-Path $PSScriptRoot 'win-all.ps1')
Get-Process WindowsTerminal -EA 0 | Select-Object Id,MainWindowTitle | Format-Table -Auto | Out-String
Start-Sleep -Milliseconds 200
Get-Process WindowsTerminal -EA 0 | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { 'WT pid ' + $_.Id + ' hwnd ' + $_.MainWindowHandle }
