# P0 probe: display enumeration (Per-Monitor V2 physical coordinates)
# ASCII-only on purpose: PS 5.1 reads BOM-less .ps1 as ANSI.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class DpiProbe {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFOEX {
    public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
  }
  public delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, ref RECT rc, IntPtr data);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")]
  public static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")]
  public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool GetMonitorInfoW(IntPtr hMon, ref MONITORINFOEX mi);
  [DllImport("user32.dll")]
  public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
  [DllImport("shcore.dll")]
  public static extern int GetDpiForMonitor(IntPtr hMon, int dpiType, out uint dpiX, out uint dpiY);
  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int idx);

  public static List<IntPtr> Monitors() {
    var list = new List<IntPtr>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr h, IntPtr hdc, ref RECT rc, IntPtr d) {
      list.Add(h); return true;
    }, IntPtr.Zero);
    return list;
  }
  public static MONITORINFOEX Info(IntPtr h) {
    var mi = new MONITORINFOEX();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
    GetMonitorInfoW(h, ref mi);
    return mi;
  }
  // 0 = MDT_EFFECTIVE_DPI
  public static uint[] EffectiveDpi(IntPtr h) {
    uint x = 0, y = 0;
    int hr = GetDpiForMonitor(h, 0, out x, out y);
    return new uint[] { x, y, (uint)hr };
  }
}
'@

# DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 == -4
$ctxBefore = [DpiProbe]::GetThreadDpiAwarenessContext()
$awareBefore = [DpiProbe]::GetAwarenessFromDpiAwarenessContext($ctxBefore)
$awareAfter = $null
$setOk = [DpiProbe]::SetProcessDpiAwarenessContext([IntPtr](-4))
if ($setOk) {
  $awareAfter = [DpiProbe]::GetAwarenessFromDpiAwarenessContext([DpiProbe]::GetThreadDpiAwarenessContext())
}

$monitors = @()
$i = 0
foreach ($h in [DpiProbe]::Monitors()) {
  $i++
  $mi = [DpiProbe]::Info($h)
  $dpi = [DpiProbe]::EffectiveDpi($h)
  $monitors += [ordered]@{
    index      = $i
    hmon       = ('0x{0:X}' -f $h.ToInt64())
    device     = $mi.szDevice
    primary    = (($mi.dwFlags -band 1) -ne 0)
    x          = $mi.rcMonitor.L
    y          = $mi.rcMonitor.T
    w          = ($mi.rcMonitor.R - $mi.rcMonitor.L)
    h          = ($mi.rcMonitor.B - $mi.rcMonitor.T)
    workX      = $mi.rcWork.L
    workY      = $mi.rcWork.T
    workW      = ($mi.rcWork.R - $mi.rcWork.L)
    workH      = ($mi.rcWork.B - $mi.rcWork.T)
    dpiX       = $dpi[0]
    dpiY       = $dpi[1]
    dpiHr      = $dpi[2]
    scalePct   = [math]::Round(($dpi[0] / 96.0) * 100)
  }
}

# Cross-check with the GDI system metrics (physical after PerMonitorV2)
$metrics = [ordered]@{
  SM_CMONITORS = [DpiProbe]::GetSystemMetrics(80)
  SM_CXSCREEN  = [DpiProbe]::GetSystemMetrics(0)
  SM_CYSCREEN  = [DpiProbe]::GetSystemMetrics(1)
  SM_XVIRTUAL  = [DpiProbe]::GetSystemMetrics(76)
  SM_YVIRTUAL  = [DpiProbe]::GetSystemMetrics(77)
  SM_CXVIRTUAL = [DpiProbe]::GetSystemMetrics(78)
  SM_CYVIRTUAL = [DpiProbe]::GetSystemMetrics(79)
}

$result = [ordered]@{
  ts                = (Get-Date).ToString('s')
  dpiAwareBefore    = $awareBefore            # 0=unaware 1=system 2=permonitor
  dpiAwareAfter     = $awareAfter
  setDpiOk          = $setOk
  monitorCount      = $monitors.Count
  monitors          = $monitors
  systemMetrics     = $metrics
}

New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'out') | Out-Null
$json = $result | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'out\screens.json'), $json, (New-Object Text.UTF8Encoding($false)))
$json