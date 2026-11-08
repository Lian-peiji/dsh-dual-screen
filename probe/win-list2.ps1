# probe/win-list2.ps1 -- dump visible top-level windows (class | pid | rect | title). ASCII only.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class WinDump {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static string Dump() {
    var sb = new StringBuilder();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var t = new StringBuilder(512); GetWindowTextW(h, t, 512);
      if (t.Length == 0) return true;
      var c = new StringBuilder(256); GetClassNameW(h, c, 256);
      RECT r; GetWindowRect(h, out r);
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (r.R - r.L <= 0) return true;
      sb.Append(c.ToString()).Append("|pid=").Append(pid).Append("|")
        .Append(r.L).Append(",").Append(r.T).Append(" ").Append(r.R - r.L).Append("x").Append(r.B - r.T)
        .Append("|").Append(t.ToString()).Append("\n");
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
}
'@
[WinDump]::Dump()
