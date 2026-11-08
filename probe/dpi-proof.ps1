# probe/dpi-proof.ps1 -- prove the DPI awareness argument with measurements.
# Prints monitor rects BEFORE and AFTER SetProcessDpiAwarenessContext(-4).
# ASCII-only.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class DpiProof {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  public delegate bool ME(IntPtr h, IntPtr hdc, ref RECT rc, IntPtr d);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr c, ME cb, IntPtr d);
  public static string Dump() {
    var sb = new StringBuilder();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr h, IntPtr hdc, ref RECT rc, IntPtr d) {
      sb.AppendLine("  [" + rc.L + "," + rc.T + "] " + (rc.R - rc.L) + "x" + (rc.B - rc.T));
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
  public static int Awareness() { return GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()); }
}
'@

"awareness before = $([DpiProof]::Awareness())   (0=unaware 1=system 2=per-monitor)"
"--- monitor rects BEFORE:"
[DpiProof]::Dump()
$ok = [DpiProof]::SetProcessDpiAwarenessContext([IntPtr](-4))
"SetProcessDpiAwarenessContext(-4) = $ok"
"awareness after  = $([DpiProof]::Awareness())"
"--- monitor rects AFTER:"
[DpiProof]::Dump()