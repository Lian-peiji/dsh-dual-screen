# probe/win-list.ps1 -- list top-level windows (class, pid, title, rect) so we can see
# where a spawned console really lands. ASCII only.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class WinList {
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
    Rows.Add(c + "|pid=" + pid + "|" + r.L + "," + r.T + "," + (r.R - r.L) + "x" + (r.B - r.T) + "|" + t.ToString());
    return true;
  }

  public static List<string> All() {
    Rows.Clear();
    EnumWindows(new EnumProc(Cb), IntPtr.Zero);
    return new List<string>(Rows);
  }
}
'@
$rows = [WinList]::All()
if (-not $rows) { 'no console windows' } else { $rows | ForEach-Object { $_ } }
