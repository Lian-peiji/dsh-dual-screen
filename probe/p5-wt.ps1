# probe/p5-wt.ps1 -- does Windows Terminal honour --pos? Spawn, measure, kill. ASCII only.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class WtProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static List<string> Rows = new List<string>();
  static bool Cb(IntPtr h, IntPtr p) {
    if (!IsWindowVisible(h)) return true;
    var cls = new StringBuilder(256); GetClassNameW(h, cls, 256);
    string c = cls.ToString();
    if (c != "ConsoleWindowClass" && c != "CASCADIA_HOSTING_WINDOW_CLASS") return true;
    var t = new StringBuilder(512); GetWindowTextW(h, t, 512);
    RECT r; GetWindowRect(h, out r);
    uint pid; GetWindowThreadProcessId(h, out pid);
    Rows.Add(c + " | pid=" + pid + " | " + r.L + "," + r.T + " " + (r.R-r.L) + "x" + (r.B-r.T) + " | " + t.ToString());
    return true;
  }
  public static List<string> All() { Rows.Clear(); EnumWindows(new EnumProc(Cb), IntPtr.Zero); return new List<string>(Rows); }
}
'@
$wt = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\wt.exe'
$p = Start-Process -FilePath $wt -ArgumentList '-w','-1','--pos','2584,-564','cmd.exe','/c','ping -n 8 127.0.0.1' -PassThru -WindowStyle Normal
Start-Sleep -Milliseconds 2500
'wt pid: ' + $p.Id
[WtProbe]::All() | ForEach-Object { $_ }
Start-Sleep -Milliseconds 300
taskkill /PID $p.Id /T /F 2>&1 | Out-Null
