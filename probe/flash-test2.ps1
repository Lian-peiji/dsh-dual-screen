# probe/flash-test2.ps1 -- measure console-window flashes from scheduled-task
# launchers, entirely in ONE process (hook runs on its own thread with its own
# message pump, so no child process path/encoding pitfalls).
#
# Variant A = what dsh-restart-guard registers today:
#               powershell.exe -NoProfile ... -WindowStyle Hidden -File <x.ps1>
# Variant B = same work behind a wscript shim:
#               wscript.exe //nologo <shim.vbs>  -> WshShell.Run(..., 0, False)
#
# ASCII-only.
param(
  [int]$WatchSeconds = 8,
  [string]$WorkDir = 'J:\大肥鱼游乐场\dsh-dual-screen\probe'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Threading;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class Fw {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
  public delegate void WinEventDelegate(IntPtr hHook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr hmod, WinEventDelegate cb, uint pid, uint tid, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr hwnd, uint min, uint max, uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetWindowTextW")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetClassNameW")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);

  static WinEventDelegate _del;
  static IntPtr _hook = IntPtr.Zero;
  static Thread _thread;
  static volatile bool _run;
  public static ConcurrentQueue<long> Hits = new ConcurrentQueue<long>();
  public static string LastError = "";

  public static void Begin() {
    _run = true;
    _thread = new Thread(delegate() {
      try {
        _del = new WinEventDelegate(OnEvent);
        _hook = SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, _del, 0, 0, 0x0000 | 0x0002);
        if (_hook == IntPtr.Zero) { LastError = "SetWinEventHook returned 0"; return; }
        var sw = Stopwatch.StartNew();
        while (_run) {
          MSG m;
          if (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref m); DispatchMessage(ref m); }
          else Thread.Sleep(5);
        }
      } catch (Exception ex) { LastError = ex.Message; }
      finally { if (_hook != IntPtr.Zero) { UnhookWinEvent(_hook); _hook = IntPtr.Zero; } }
    });
    _thread.IsBackground = true;
    _thread.Start();
  }
  public static void End() {
    _run = false;
    if (_thread != null) { try { _thread.Join(2500); } catch {} }
  }
  public static bool Ready() { return _hook != IntPtr.Zero; }
  static void OnEvent(IntPtr hHook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time) {
    if (hwnd == IntPtr.Zero || idObject != 0 || idChild != 0) return;
    Hits.Enqueue(hwnd.ToInt64());
  }
  public static string Text(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, sb.Capacity); return sb.ToString(); }
  public static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, sb.Capacity); return sb.ToString(); }
  public static RECT Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return r; }
  public static long NowMs() { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }
}
'@

# --- fixture -----------------------------------------------------------------
$sleepScript = Join-Path $WorkDir '_flash-sleep.ps1'
$vbs = Join-Path $WorkDir '_flash-shim.vbs'
[IO.File]::WriteAllText($sleepScript, "Start-Sleep -Seconds 4`r`n", (New-Object Text.UTF8Encoding($false)))
$vbsBody = "Set sh = CreateObject(""WScript.Shell"")`r`nsh.Run ""powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """"$sleepScript"""""", 0, False`r`n"
[IO.File]::WriteAllText($vbs, $vbsBody, (New-Object Text.UTF8Encoding($false)))

$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function Run-Variant([string]$label, [string]$exe, [string]$argLine) {
  $taskName = 'DSH-FlashTest-' + ($label -replace '[^A-Za-z0-9]', '')
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  $action = New-ScheduledTaskAction -Execute $exe -Argument $argLine -WorkingDirectory $WorkDir
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddYears(10))
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

  [Fw]::Begin()
  Start-Sleep -Milliseconds 700
  $ready = [Fw]::Ready()
  Start-ScheduledTask -TaskName $taskName

  $lines = @()
  $deadline = [Fw]::NowMs() + $WatchSeconds * 1000
  while ([Fw]::NowMs() -lt $deadline) {
    $raw = 0L
    while ([Fw]::Hits.TryDequeue([ref]$raw)) {
      $h = [IntPtr]$raw
      if (-not [Fw]::IsWindowVisible($h)) { continue }
      $r = [Fw]::Rect($h)
      $w = $r.R - $r.L; $hh = $r.B - $r.T
      if (($w * $hh) -lt 400) { continue }
      $pidw = 0; [void][Fw]::GetWindowThreadProcessId($h, [ref]$pidw)
      $pname = ''
      try { $pname = [string](Get-Process -Id $pidw -ErrorAction Stop).ProcessName } catch {}
      $lines += ("SHOW cls=" + [Fw]::Cls($h) + " proc=" + $pname + "#" + $pidw + " rect=" + $r.L + "," + $r.T + " " + $w + "x" + $hh + " title=" + [Fw]::Text($h))
    }
    Start-Sleep -Milliseconds 80
  }
  [Fw]::End()
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

  $consoleish = @($lines | Where-Object { $_ -match 'cls=(ConsoleWindowClass|CASCADIA_HOSTING_WINDOW_CLASS)' -or $_ -match 'proc=(powershell|conhost|wscript|cmd|OpenConsole)' })
  "--- variant $label   (hook ready: $ready)"
  "    windows shown during run: $($lines.Count)   console-ish: $($consoleish.Count)"
  foreach ($l in $lines) { "      " + $l }
  return [pscustomobject]@{ label = $label; consoleish = $consoleish.Count; all = $lines.Count; hookReady = $ready }
}

$results = @()
$results += Run-Variant 'A-powershell-hidden' $ps ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $sleepScript + '"')
$results += Run-Variant 'B-wscript-shim' $wscript ('//nologo "' + $vbs + '"')
Remove-Item -LiteralPath $sleepScript, $vbs -ErrorAction SilentlyContinue

''
'=== summary ==='
foreach ($r in $results) { "  {0,-22} hookReady={1} console-ish windows={2}" -f $r.label, $r.hookReady, $r.consoleish }
$b = $results | Where-Object { $_.label -like 'B-*' } | Select-Object -First 1
$a = $results | Where-Object { $_.label -like 'A-*' } | Select-Object -First 1
''
if ($a.consoleish -gt 0) { "A flashes $($a.consoleish) console window(s) - reproduces the owner report" } else { "A showed no console window in this run" }
if ($b.consoleish -eq 0) { 'B shows no console window -> wscript shim is the fix' } else { "B also flashes ($($b.consoleish)) -> need another route" }