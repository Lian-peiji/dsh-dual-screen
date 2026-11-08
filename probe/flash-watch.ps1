# probe/flash-watch.ps1 -- log every window that gets SHOWN while we watch.
#
# Used to prove (not guess) whether a scheduled-task launcher puts a console
# window on the screen for a moment. One line per EVENT_OBJECT_SHOW:
#   SHOW cls=... proc=... pid=... title=... rect=...
# ASCII-only.
param(
  [int]$Seconds = 10,
  [int]$MinArea = 1
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class FlashWatch {
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
  public static ConcurrentQueue<long> Hits = new ConcurrentQueue<long>();
  public static bool Start() {
    _del = new WinEventDelegate(OnEvent);
    _hook = SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, _del, 0, 0, 0x0000 | 0x0002);
    return _hook != IntPtr.Zero;
  }
  public static void Stop() { if (_hook != IntPtr.Zero) { UnhookWinEvent(_hook); _hook = IntPtr.Zero; } }
  static void OnEvent(IntPtr hHook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time) {
    if (hwnd == IntPtr.Zero || idObject != 0 || idChild != 0) return;
    Hits.Enqueue(hwnd.ToInt64());
  }
  public static void Pump(int ms) {
    var sw = Stopwatch.StartNew();
    while (sw.ElapsedMilliseconds < ms) {
      MSG m;
      if (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref m); DispatchMessage(ref m); }
      else System.Threading.Thread.Sleep(5);
    }
  }
  public static string Text(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, sb.Capacity); return sb.ToString(); }
  public static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, sb.Capacity); return sb.ToString(); }
  public static RECT Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return r; }
  public static long NowMs() { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }
}
'@

[void][FlashWatch]::Start()
$deadline = [FlashWatch]::NowMs() + $Seconds * 1000
while ([FlashWatch]::NowMs() -lt $deadline) {
  [void][FlashWatch]::Pump(150)
  while ($true) {
    $raw = 0L
    if (-not [FlashWatch]::Hits.TryDequeue([ref]$raw)) { break }
    $h = [IntPtr]$raw
    if (-not [FlashWatch]::IsWindowVisible($h)) { continue }
    $r = [FlashWatch]::Rect($h)
    $w = $r.R - $r.L; $hh = $r.B - $r.T
    if (($w * $hh) -lt $MinArea) { continue }
    $pidw = 0; [void][FlashWatch]::GetWindowThreadProcessId($h, [ref]$pidw)
    $name = ''
    try { $name = [string](Get-Process -Id $pidw -ErrorAction Stop).ProcessName } catch {}
    $line = "SHOW cls=" + [FlashWatch]::Cls($h) + " proc=" + $name + "#" + $pidw + " rect=" + $r.L + "," + $r.T + " " + $w + "x" + $hh + " title=" + [FlashWatch]::Text($h)
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
  }
}
[FlashWatch]::Stop()
[Console]::Out.WriteLine('WATCH-DONE')