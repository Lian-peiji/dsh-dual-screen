# probe/verify-guard-silent.ps1 -- end-to-end check of the real scheduled task.
#
# Fires the REAL "DSH-Restart-Guard" task while an in-process WinEvent hook
# watches for any window that appears, then reports. With no request.json the
# runner exits immediately, so this is a harmless smoke test of the launcher.
#
# Expected after the wscript-shim fix: 0 console-ish windows.
# ASCII-only.
param(
  [string]$TaskName = 'DSH-Restart-Guard',
  [int]$WatchSeconds = 8
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
public static class Vg {
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
  public static void Begin() {
    _run = true;
    _thread = new Thread(delegate() {
      _del = new WinEventDelegate(OnEvent);
      _hook = SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, _del, 0, 0, 0x0000 | 0x0002);
      var sw = Stopwatch.StartNew();
      while (_run) {
        MSG m;
        if (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref m); DispatchMessage(ref m); }
        else Thread.Sleep(5);
      }
      if (_hook != IntPtr.Zero) { UnhookWinEvent(_hook); _hook = IntPtr.Zero; }
    });
    _thread.IsBackground = true;
    _thread.Start();
  }
  public static void End() { _run = false; if (_thread != null) { try { _thread.Join(2500); } catch {} } }
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

$xml = [xml](schtasks /query /tn $TaskName /xml 2>$null)
"task action: " + $xml.Task.Actions.Exec.Command + ' ' + $xml.Task.Actions.Exec.Arguments

[Vg]::Begin()
Start-Sleep -Milliseconds 700
$ready = [Vg]::Ready()
"hook ready: $ready"
schtasks /run /tn $TaskName | Out-Null

$lines = @()
$deadline = [Vg]::NowMs() + $WatchSeconds * 1000
while ([Vg]::NowMs() -lt $deadline) {
  $raw = 0L
  while ([Vg]::Hits.TryDequeue([ref]$raw)) {
    $h = [IntPtr]$raw
    if (-not [Vg]::IsWindowVisible($h)) { continue }
    $r = [Vg]::Rect($h)
    $w = $r.R - $r.L; $hh = $r.B - $r.T
    if (($w * $hh) -lt 400) { continue }
    $pidw = 0; [void][Vg]::GetWindowThreadProcessId($h, [ref]$pidw)
    $pname = ''
    try { $pname = [string](Get-Process -Id $pidw -ErrorAction Stop).ProcessName } catch {}
    $lines += ("SHOW cls=" + [Vg]::Cls($h) + " proc=" + $pname + "#" + $pidw + " rect=" + $r.L + "," + $r.T + " " + $w + "x" + $hh + " title=" + [Vg]::Text($h))
  }
  Start-Sleep -Milliseconds 80
}
[Vg]::End()

"windows shown while the real task ran: $($lines.Count)"
foreach ($l in $lines) { "  " + $l }
$consoleish = @($lines | Where-Object { $_ -match 'cls=(ConsoleWindowClass|CASCADIA_HOSTING_WINDOW_CLASS)' -or $_ -match 'proc=(powershell|conhost|wscript|cmd|OpenConsole)' })
"console-ish: $($consoleish.Count)"
''
'--- runner.log tail:'
Get-Content 'E:\dsh\restart-guard\runner.log' -Tail 4
''
if ($consoleish.Count -eq 0) { 'RESULT: PASS - the real task flashed no console window' } else { 'RESULT: FAIL - still flashing' }