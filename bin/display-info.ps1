# display-info.ps1 -- display enumeration with Per-Monitor V2 physical coordinates.
#
# Called by lib/display.js: stdout must contain ONLY one JSON object (no chatter),
# exit code 0 = success. Optional -OutFile also dumps a copy for human debugging.
#
# Why SetProcessDpiAwarenessContext(-4) is mandatory:
#   A process is DPI-unaware by default, so AllScreens/GetSystemMetrics return
#   virtualized LOGICAL coordinates (divided by 1.5 at 150%). Feeding those to
#   SetWindowPos puts windows in the wrong place. P0 measured on this machine:
#   before the call DISPLAY1 reports 1067x1707, after it the true 1600x2560@150%.
#
# ASCII-ONLY ON PURPOSE. PowerShell 5.1 decodes a BOM-less .ps1 as ANSI, and a
# GBK mis-decode eats the ASCII character that follows a CJK char (parity shift),
# which silently breaks the parse. Keep every .ps1 in this plugin ASCII-only.
param(
  [string]$OutFile = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class DshDisplay {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFOEX {
    public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
  }
  public delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, ref RECT rc, IntPtr data);

  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfoW(IntPtr hMon, ref MONITORINFOEX mi);
  [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr hMon, int dpiType, out uint dpiX, out uint dpiY);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int idx);

  public static List<IntPtr> Monitors() {
    var l = new List<IntPtr>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr h, IntPtr hdc, ref RECT rc, IntPtr d) {
      l.Add(h); return true;
    }, IntPtr.Zero);
    return l;
  }
  public static MONITORINFOEX Info(IntPtr h) {
    var mi = new MONITORINFOEX();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
    GetMonitorInfoW(h, ref mi);
    return mi;
  }
  public static uint[] EffectiveDpi(IntPtr h) {   // 0 = MDT_EFFECTIVE_DPI
    uint x = 0, y = 0;
    int hr = GetDpiForMonitor(h, 0, out x, out y);
    return new uint[] { x, y, (uint)hr };
  }
  public static int Awareness() { return GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()); }
}
'@

$awareBefore = [DshDisplay]::Awareness()
# DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 == -4
$setOk = $false
try { $setOk = [DshDisplay]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { $setOk = $false }
$awareAfter = [DshDisplay]::Awareness()

$mons = @()
$i = 0
foreach ($h in [DshDisplay]::Monitors()) {
  $i++
  $mi = [DshDisplay]::Info($h)
  $dpi = [DshDisplay]::EffectiveDpi($h)
  $mons += [ordered]@{
    index     = $i
    device    = $mi.szDevice
    primary   = (($mi.dwFlags -band 1) -ne 0)
    x         = $mi.rcMonitor.L
    y         = $mi.rcMonitor.T
    w         = ($mi.rcMonitor.R - $mi.rcMonitor.L)
    h         = ($mi.rcMonitor.B - $mi.rcMonitor.T)
    workX     = $mi.rcWork.L
    workY     = $mi.rcWork.T
    workW     = ($mi.rcWork.R - $mi.rcWork.L)
    workH     = ($mi.rcWork.B - $mi.rcWork.T)
    dpi       = [int]$dpi[0]
    scale     = [Math]::Round(($dpi[0] / 96.0), 2)
    portrait  = (($mi.rcMonitor.B - $mi.rcMonitor.T) -gt ($mi.rcMonitor.R - $mi.rcMonitor.L))
  }
}

$result = [ordered]@{
  ts            = (Get-Date).ToString('s')
  dpiBefore     = $awareBefore   # 0=unaware 1=system 2=per-monitor
  dpiAfter      = $awareAfter
  setDpiOk      = $setOk
  count         = $mons.Count
  virtualScreen = [ordered]@{
    x = [DshDisplay]::GetSystemMetrics(76)
    y = [DshDisplay]::GetSystemMetrics(77)
    w = [DshDisplay]::GetSystemMetrics(78)
    h = [DshDisplay]::GetSystemMetrics(79)
  }
  monitors      = $mons
}

$json = $result | ConvertTo-Json -Depth 6
if ($OutFile) {
  try { [IO.File]::WriteAllText($OutFile, $json, (New-Object Text.UTF8Encoding($false))) } catch {}
}
$json