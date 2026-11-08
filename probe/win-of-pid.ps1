# probe/win-of-pid.ps1 -- dump all top-level windows of a pid (visible or not) with rect.
# Usage: powershell -File probe/win-of-pid.ps1 -TargetPid 1234
param([int]$TargetPid)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WinOfPid {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static string Dump(uint want) {
    var sb = new StringBuilder();
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != want) return true;
      RECT r; GetWindowRect(h, out r);
      if (r.R - r.L <= 1) return true;
      var c = new StringBuilder(256); GetClassNameW(h, c, 256);
      var t = new StringBuilder(512); GetWindowTextW(h, t, 512);
      sb.Append("vis=").Append(IsWindowVisible(h) ? "1" : "0").Append(" pid=").Append(pid)
        .Append(" [").Append(r.L).Append(",").Append(r.T).Append(" ").Append(r.R - r.L).Append("x").Append(r.B - r.T).Append("] ")
        .Append(c.ToString()).Append(" :: ").Append(t.ToString()).Append("\n");
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
}
'@
[WinOfPid]::Dump([uint32]$TargetPid)
