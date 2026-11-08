# probe/flash-test.ps1 -- measure whether a scheduled-task launcher flashes a
# console window, and whether a wscript shim removes it.
#
# Reproduces exactly what dsh-restart-guard registers today:
#   action = powershell.exe -WindowStyle Hidden -File <script>
#   principal = current user, LogonType Interactive, RunLevel Limited
# then compares it with the same work launched through a VBS shim
# (WshShell.Run with window style 0 => no console is ever created).
#
# Each variant is wrapped in its own scheduled task, started with
# Start-ScheduledTask, and observed by probe/flash-watch.ps1.
# ASCII-only.
param(
  [int]$WatchSeconds = 9,
  [string]$WorkDir = 'J:\大肥鱼游乐场\dsh-dual-screen\probe'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

$outDir = Join-Path $WorkDir 'out'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$sleepScript = Join-Path $WorkDir '_flash-sleep.ps1'
$vbs = Join-Path $WorkDir '_flash-shim.vbs'
$watch = Join-Path $WorkDir 'flash-watch.ps1'

[IO.File]::WriteAllText($sleepScript, 'Start-Sleep -Seconds 5`r`n', (New-Object Text.UTF8Encoding($false)))
$vbsBody = @"
' launched by Task Scheduler; style 0 = hidden, False = do not wait
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$sleepScript""", 0, False
"@
[IO.File]::WriteAllText($vbs, $vbsBody, (New-Object Text.UTF8Encoding($false)))

$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$results = @()

function Run-Variant([string]$label, [string]$exe, [string]$argLine) {
  $taskName = 'DSH-FlashTest-' + ($label -replace '[^A-Za-z0-9]', '')
  try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}
  $action = New-ScheduledTaskAction -Execute $exe -Argument $argLine -WorkingDirectory $WorkDir
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddYears(10))
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

  Remove-Item -LiteralPath $script:watchLog -ErrorAction SilentlyContinue
  $watcher = Start-Process -FilePath $ps -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $watch, '-Seconds', "$WatchSeconds") `
    -RedirectStandardOutput $script:watchLog -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 1500
  Start-ScheduledTask -TaskName $taskName
  Start-Sleep -Milliseconds ($WatchSeconds * 1000 - 500)
  Start-Sleep -Milliseconds 800
  try { Stop-Process -Id $watcher.Id -Force -ErrorAction SilentlyContinue } catch {}
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

  $log = ''
  try { $log = [IO.File]::ReadAllText($script:watchLog) } catch {}
  $hits = @($log -split "`r?`n" | Where-Object { $_ -match '^SHOW ' })
  $consoleHits = @($hits | Where-Object { $_ -match 'cls=(ConsoleWindowClass|CASCADIA_HOSTING_WINDOW_CLASS)' -or $_ -match 'proc=(powershell|conhost|wscript|cmd)' })
  "--- variant $label"
  "    all shown windows: $($hits.Count)   console-ish: $($consoleHits.Count)"
  if ($hits.Count -gt 0) { $hits | ForEach-Object { "      " + $_ } }
  return [pscustomobject]@{ label = $label; consoleHits = $consoleHits.Count; all = $hits.Count; lines = $hits }
}

$script:watchLog = Join-Path $outDir 'flash-watch.log'

$results += Run-Variant 'A-powershell-hidden' $ps ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $sleepScript + '"')
$results += Run-Variant 'B-wscript-shim' $wscript ('//nologo "' + $vbs + '"')

Remove-Item -LiteralPath $sleepScript, $vbs -ErrorAction SilentlyContinue
''
'=== summary ==='
foreach ($r in $results) { "  {0,-22} console-ish windows: {1}" -f $r.label, $r.consoleHits }
''
if (($results | Where-Object { $_.label -like 'B-*' }).consoleHits -eq 0) { 'VERDICT: wscript shim shows no console window' } else { 'VERDICT: wscript shim also flashes - need another route' }