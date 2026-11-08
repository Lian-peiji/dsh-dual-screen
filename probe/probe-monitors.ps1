# probe-monitors.ps1 -- how many real monitors does Windows report right now?
# A disconnected secondary would put the pet off-screen, which looks exactly like
# "clicks do not reach it". ASCII only.
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class MON {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfoW(IntPtr h, ref MONINFO mi);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONINFO { public int cbSize; public RECT mon; public RECT work; public uint flags; }
  public delegate bool MonProc(IntPtr h, IntPtr hdc, ref RECT r, IntPtr p);
}
"@
[void][MON]::SetProcessDpiAwarenessContext([IntPtr](-4))
Write-Output ("SM_CMONITORS: " + [MON]::GetSystemMetrics(80))
Write-Output ("virtual screen with DPI aware: x={0} y={1} w={2} h={3}" -f [MON]::GetSystemMetrics(76), [MON]::GetSystemMetrics(77), [MON]::GetSystemMetrics(78), [MON]::GetSystemMetrics(79))
$id = 0
$cb = [MON+MonProc]{
  param($h, $hdc, $r, $p)
  $mi = New-Object MON+MONINFO
  $mi.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][MON+MONINFO])
  [void][MON]::GetMonitorInfoW($h, [ref]$mi)
  $script:id++
  Write-Output ("monitor {0}: 0x{1} rect={2},{3}-{4},{5} work={6},{7}-{8},{9} primary={10}" -f `
    $script:id, ([int64]$h).ToString('X'), $mi.mon.L, $mi.mon.T, $mi.mon.R, $mi.mon.B,
    $mi.work.L, $mi.work.T, $mi.work.R, $mi.work.B, ($mi.flags -band 1))
  return $true
}
[void][MON]::EnumDisplayMonitors([IntPtr]::Zero, [IntPtr]::Zero, $cb, [IntPtr]::Zero)
# Also list the display adapters Windows knows about (including disconnected ones).
Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Output ("wmi monitor: InstanceName=" + $_.InstanceName + " active=" + $_.Active) }