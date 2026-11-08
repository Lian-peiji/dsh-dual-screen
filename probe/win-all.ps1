# probe/win-all.ps1 -- dump every visible top-level window with class/pid/rect/title.
# ASCII only. Used to see what the console actually is on this machine.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class WinAll {
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
    var t = new StringBuilder(256); GetWindowTextW(h, t, 256);
    RECT r; GetWindowRect(h, out r);
    if (r.R - r.L < 40 || r.B - r.T < 40) return true;
    uint pid; GetWindowThreadProcessId(h, out pid);
    string title = t.ToString();
    if (title.Length > 80) title = title.Substring(0, 80);
    Rows.Add(cls.ToString() + " | pid=" + pid + " | " + r.L + "," + r.T + " " + (r.R-r.L) + "x" + (r.B-r.T) + " | " + title);
    return true;
  }

  public static List<string> All() {
    Rows.Clear();
    EnumWindows(new EnumProc(Cb), IntPtr.Zero);
    return new List<string>(Rows);
  }
}
'@
[WinAll]::All() | ForEach-Object { $_ }
