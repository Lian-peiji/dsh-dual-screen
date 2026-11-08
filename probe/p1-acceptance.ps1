# probe/p1-acceptance.ps1 -- P1 acceptance harness (PLAN section 9 / P1).
#
# Runs the whole scenario inside ONE process tree so the spawned windows stay
# alive while the bridge works on them:
#   1. bridge -> long-running loop mode, stdout captured to a log
#   2. new browser with an ego profile marker   -> must land on the secondary
#   3. console via conhost.exe                  -> must land on the secondary
#   4. plain cmd (Windows Terminal singleton)   -> must be skipped, NOT moved
#   5. owner windows + foreground               -> must be unchanged
#
# Prints PASS/FAIL per assertion and exits 0 only if every assertion passed.
# ASCII-only.
param(
  [string]$DataDir = 'E:\dsh\dual-screen',
  [int]$MoveTimeoutMs = 20000
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

$root = Split-Path -Parent $PSScriptRoot
$bridge = Join-Path $root 'bin\window-bridge.ps1'
$logDir = Join-Path $DataDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'bridge.log'
$errLog = Join-Path $logDir 'bridge.err.log'
Remove-Item -LiteralPath $log, $errLog -ErrorAction SilentlyContinue

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Acc {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetWindowTextW")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetClassNameW")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static List<IntPtr> All() { var l = new List<IntPtr>(); EnumWindows(delegate(IntPtr h, IntPtr x) { l.Add(h); return true; }, IntPtr.Zero); return l; }
  public static string T(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  public static string C(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  public static RECT R(IntPtr h) { RECT r; GetWindowRect(h, out r); return r; }
}
'@
[void][Acc]::SetProcessDpiAwarenessContext([IntPtr](-4))

$script:pass = 0
$script:fail = 0
function Check([string]$name, [bool]$ok, [string]$detail) {
  if ($ok) { $script:pass++; "PASS  $name   $detail" } else { $script:fail++; "FAIL  $name   $detail" }
}
function Read-Log([string]$path) {
  try {
    $fs = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $sr = New-Object IO.StreamReader($fs)
    $txt = $sr.ReadToEnd(); $sr.Close(); $fs.Close(); return $txt
  } catch { return '' }
}
function Wait-LogMatch([string]$pattern, [int]$timeoutMs) {
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  while ((Get-Date) -lt $deadline) {
    $t = Read-Log $log
    if ($t -match $pattern) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}
function Snapshot {
  $rows = @()
  foreach ($h in [Acc]::All()) {
    if (-not [Acc]::IsWindowVisible($h)) { continue }
    $pidw = 0; [void][Acc]::GetWindowThreadProcessId($h, [ref]$pidw)
    $r = [Acc]::R($h)
    $rows += [pscustomobject]@{
      hwnd = ('0x{0:X}' -f $h.ToInt64()); pid = [int]$pidw; title = [Acc]::T($h); cls = [Acc]::C($h)
      x = $r.L; y = $r.T; w = ($r.R - $r.L); h = ($r.B - $r.T)
    }
  }
  return $rows
}
function Proc-Name([int]$procId) {
  try { return [string](Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue).Name } catch { return '' }
}

# secondary work area
$mons = @()
foreach ($h in [Acc]::All()) { }
Add-Type -AssemblyName System.Windows.Forms 2>$null
$sec = $null
$mon = $null
try {
  # physical work area via the plugin's own probe (single source of truth)
  $j = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'bin\display-info.ps1') 2>$null
  $mon = ($j | Out-String) | ConvertFrom-Json
  $sec = $mon.monitors | Where-Object { -not $_.primary } | Select-Object -First 1
} catch {}
if (-not $sec) { 'FATAL: no secondary monitor / probe failed'; exit 2 }
$secL = [int]$sec.workX; $secT = [int]$sec.workY; $secR = $secL + [int]$sec.workW; $secB = $secT + [int]$sec.workH
"secondary work area: $secL,$secT $($sec.workW)x$($sec.workH)"
function OnSecondary([int]$x, [int]$y, [int]$w, [int]$h) {
  $cx = $x + [int]($w / 2); $cy = $y + [int]($h / 2)
  return ($cx -ge $secL -and $cx -lt $secR -and $cy -ge $secT -and $cy -lt $secB)
}

# ---------------------------------------------------------------- baseline ---
$before = Snapshot
$fgBefore = [Acc]::GetForegroundWindow()
$fgPidBefore = 0; [void][Acc]::GetWindowThreadProcessId($fgBefore, [ref]$fgPidBefore)
$fgProcBefore = Proc-Name $fgPidBefore
"baseline: $($before.Count) windows, foreground=$fgProcBefore#$fgPidBefore"

# ------------------------------------------------------------------ bridge ---
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$bridgeProc = Start-Process -FilePath $ps -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $bridge, '-DataDir', $DataDir) `
  -RedirectStandardOutput $log -RedirectStandardError $errLog -PassThru -WindowStyle Hidden
"bridge pid: $($bridgeProc.Id)"
$hello = Wait-LogMatch '"type":"hello"' 15000
Check 'bridge starts and emits hello' $hello ("hookOk seen: " + ((Read-Log $log) -match '"hookOk":true'))
$helloLine = (Read-Log $log) -split "`n" | Where-Object { $_ -match '"type":"hello"' } | Select-Object -First 1
"hello: $helloLine"

$spawned = @()
try {
  # ------------------------------------------------------------- test 1: browser
  $probeProfile = Join-Path $env:LOCALAPPDATA 'ego-lite-linux\p1-probe'
  $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  if (-not (Test-Path -LiteralPath $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }
  $bp = Start-Process -FilePath $edge -ArgumentList @(
    "--user-data-dir=$probeProfile", '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', '--window-size=1000,700', '--window-position=40,40',
    'about:blank'
  ) -PassThru
  $spawned += $bp.Id
  'test1: spawned probe browser pid ' + $bp.Id
  $t1 = Wait-LogMatch '"type":"moved".*"kind":"ego-browser"' $MoveTimeoutMs
  $t1line = (Read-Log $log) -split "`n" | Where-Object { $_ -match '"type":"moved".*"kind":"ego-browser"' } | Select-Object -Last 1
  Check 'browser with ego marker gets moved' $t1 $t1line
  $pageWin = $null
  foreach ($w in Snapshot) { if ($w.pid -eq $bp.Id -and $w.w -ge 800) { $pageWin = $w } }
  if (-not $pageWin) {
    $edgePids = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$probeProfile*" } | ForEach-Object { [int]$_.ProcessId })
    foreach ($w in Snapshot) { if ($edgePids -contains $w.pid -and $w.w -ge 800) { $pageWin = $w } }
  }
  if ($pageWin) {
    Check 'browser window really on secondary' (OnSecondary $pageWin.x $pageWin.y $pageWin.w $pageWin.h) ("rect=" + $pageWin.x + ',' + $pageWin.y + ' ' + $pageWin.w + 'x' + $pageWin.h)
  } else {
    Check 'browser window really on secondary' $false 'window not found in snapshot'
  }

  # ------------------------------------------------------------- test 2: console
  $cp = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\conhost.exe') -ArgumentList @('cmd.exe', '/k', 'title P1-CONSOLE') -PassThru
  $spawned += $cp.Id
  'test2: spawned conhost console pid ' + $cp.Id
  $t2 = Wait-LogMatch '"type":"moved".*"kind":"console"' $MoveTimeoutMs
  $t2line = (Read-Log $log) -split "`n" | Where-Object { $_ -match '"type":"moved".*"kind":"console"' } | Select-Object -Last 1
  Check 'console in DSH tree gets moved' $t2 $t2line
  $conWin = $null
  foreach ($w in Snapshot) { if ($w.cls -eq 'ConsoleWindowClass' -and $w.title -like '*P1-CONSOLE*') { $conWin = $w } }
  if ($conWin) {
    Check 'console window really on secondary' (OnSecondary $conWin.x $conWin.y $conWin.w $conWin.h) ("rect=" + $conWin.x + ',' + $conWin.y + ' ' + $conWin.w + 'x' + $conWin.h)
  } else {
    Check 'console window really on secondary' $false 'window not found in snapshot'
  }

  # ------------------------------------------------------------- test 3: wt skip
  $wp = Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'title P1-WT' -PassThru
  $spawned += $wp.Id
  'test3: spawned plain cmd (Windows Terminal host) pid ' + $wp.Id
  Start-Sleep -Milliseconds 2500
  $wtSkip = (Read-Log $log) -match '"reason":"windows-terminal-singleton"'
  Check 'Windows Terminal window is skipped, not moved' $wtSkip ((Read-Log $log) -split "`n" | Where-Object { $_ -match 'windows-terminal-singleton' } | Select-Object -Last 1)
  $wtWin = $null
  foreach ($w in Snapshot) { if ($w.title -like '*P1-WT*') { $wtWin = $w } }
  if ($wtWin) {
    Check 'Windows Terminal window still on primary' (-not (OnSecondary $wtWin.x $wtWin.y $wtWin.w $wtWin.h)) ("rect=" + $wtWin.x + ',' + $wtWin.y + ' ' + $wtWin.w + 'x' + $wtWin.h + ' cls=' + $wtWin.cls)
  } else {
    Check 'Windows Terminal window still on primary' $false 'window not found in snapshot'
  }

  # -------------------------------------------------- test 4: owner untouched
  $after = Snapshot
  $changed = @()
  foreach ($b in $before) {
    if ($b.cls -match 'CoreWindow|ApplicationFrameWindow|Progman|CEF-OSC') { continue }
    $a = $after | Where-Object { $_.hwnd -eq $b.hwnd } | Select-Object -First 1
    if (-not $a) { continue }
    if ($a.x -ne $b.x -or $a.y -ne $b.y -or $a.w -ne $b.w -or $a.h -ne $b.h) {
      $changed += ($b.title + ' [' + $b.cls + '] ' + $b.x + ',' + $b.y + ' ' + $b.w + 'x' + $b.h + ' -> ' + $a.x + ',' + $a.y + ' ' + $a.w + 'x' + $a.h)
    }
  }
  $movedByUs = (Read-Log $log) -split "`n" | Where-Object { $_ -match '"type":"moved"' }
  $unexpected = @()
  foreach ($c in $changed) {
    $hwnd = ($after | Where-Object { $c -like ("*" + $_.title + "*") } | Select-Object -First 1).hwnd
    $isOurs = $false
    foreach ($m in $movedByUs) { if ($hwnd -and $m -match [regex]::Escape($hwnd)) { $isOurs = $true } }
    if (-not $isOurs) { $unexpected += $c }
  }
  $detail = if ($unexpected.Count -gt 0) { $unexpected -join ' | ' } else { "0 unexpected changes of $($before.Count) baseline windows" }
  Check 'no pre-existing window was moved' ($unexpected.Count -eq 0) $detail

  # ---------------------------------------------------- test 5: focus intact
  # The spawn itself legitimately takes focus (Start-Process), so we judge the
  # mover by its own before/after telemetry around each SetWindowPos instead.
  $movedLines = (Read-Log $log) -split "`n" | Where-Object { $_ -match '"type":"moved"' }
  $stole = @()
  foreach ($line in $movedLines) {
    $o = $null
    try { $o = $line | ConvertFrom-Json } catch { continue }
    if (-not $o.focus) { $stole += 'missing focus telemetry'; continue }
    if (-not $o.focus.kept) { $stole += ("kind=" + $o.kind + " " + $o.focus.before.proc + '#' + $o.focus.before.pid + ' -> ' + $o.focus.after.proc + '#' + $o.focus.after.pid) }
  }
  Check 'mover never steals focus' (($movedLines.Count -gt 0) -and ($stole.Count -eq 0)) ("$($movedLines.Count) moves checked; " + $(if ($stole.Count) { $stole -join ' | ' } else { 'focus unchanged around every SetWindowPos' }))
}
finally {
  # ------------------------------------------------------------- cleanup -----
  foreach ($procId in $spawned) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
  Get-Process cmd, conhost -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*P1-*' } | Stop-Process -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*p1-probe*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $bridgeProc.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 400
  if ((Read-Log $errLog).Trim()) { '--- bridge stderr:'; (Read-Log $errLog) | Select-Object -First 5 }
  '--- bridge log:'
  (Read-Log $log)
}

""
"RESULT: pass=$script:pass fail=$script:fail"
if ($script:fail -gt 0) { exit 1 } else { exit 0 }