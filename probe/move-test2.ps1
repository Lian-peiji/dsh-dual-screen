# P0 probe 2: cross-DPI move needs a settle pass.
# Single SetWindowPos across a 100% -> 150% boundary returns a size scaled by
# the DPI ratio (Chromium re-applies its own rect on WM_DPICHANGED).
# This probe proves a second pass ~250ms later lands the exact physical rect.
# ASCII-only.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class M2 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFOEX { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  public delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, ref RECT rc, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetWindowTextW")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfoW(IntPtr hMon, ref MONITORINFOEX mi);
  public static List<IntPtr> Windows() { var l = new List<IntPtr>(); EnumWindows(delegate(IntPtr h, IntPtr x) { l.Add(h); return true; }, IntPtr.Zero); return l; }
  public static string Text(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, sb.Capacity); return sb.ToString(); }
  public static List<IntPtr> Monitors() { var l = new List<IntPtr>(); EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr h, IntPtr hdc, ref RECT rc, IntPtr d) { l.Add(h); return true; }, IntPtr.Zero); return l; }
  public static MONITORINFOEX Info(IntPtr h) { var mi = new MONITORINFOEX(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX)); GetMonitorInfoW(h, ref mi); return mi; }
}
'@

$dpiOk = [M2]::SetProcessDpiAwarenessContext([IntPtr](-4))
"SetProcessDpiAwarenessContext(-4) : $dpiOk"

$mons = @(); foreach ($h in [M2]::Monitors()) { $mi = [M2]::Info($h); $mons += [pscustomobject]@{ dev = $mi.szDevice; primary = (($mi.dwFlags -band 1) -ne 0); work = $mi.rcWork } }
$sec = $mons | Where-Object { -not $_.primary } | Select-Object -First 1
$pri = $mons | Where-Object { $_.primary } | Select-Object -First 1
if (-not $sec) { 'NO SECONDARY MONITOR'; return }

$ego = @()
foreach ($p in Get-CimInstance Win32_Process) { $cl = [string]$p.CommandLine; if ($cl -and ($cl -match 'ego-lite-linux')) { $ego += [int]$p.ProcessId } }
$best = $null
foreach ($h in [M2]::Windows()) {
  if (-not [M2]::IsWindowVisible($h)) { continue }
  $pidw = 0; [void][M2]::GetWindowThreadProcessId($h, [ref]$pidw)
  if ($ego -notcontains [int]$pidw) { continue }
  $r = New-Object M2+RECT; [void][M2]::GetWindowRect($h, [ref]$r)
  $area = ($r.R - $r.L) * ($r.B - $r.T)
  if ($area -lt 400000) { continue }
  if (-not $best -or $area -gt $best.area) { $best = [pscustomobject]@{ hwnd = $h; r = $r; area = $area; title = [M2]::Text($h) } }
}
if (-not $best) { 'NO EGO WINDOW'; return }
"target: [$($best.title)] $($best.r.L),$($best.r.T) $($best.r.R-$best.r.L)x$($best.r.B-$best.r.T)  (dpi conclusively: $($pri.dev) -> $($sec.dev))"

$FLAGS = 0x0010 -bor 0x0040 -bor 0x0004   # NOACTIVATE | SHOWWINDOW | NOZORDER
$margin = 24
$wantW = 1280; $wantH = 900
$wantW = [Math]::Min($wantW, ($sec.work.R - $sec.work.L) - 2 * $margin)
$wantH = [Math]::Min($wantH, ($sec.work.B - $sec.work.T) - 2 * $margin)
$wantX = $sec.work.R - $margin - $wantW
$wantY = $sec.work.T + $margin

function Measure-Rect($hwnd) { $r = New-Object M2+RECT; [void][M2]::GetWindowRect($hwnd, [ref]$r); return "$($r.L),$($r.T) $($r.R-$r.L)x$($r.B-$r.T)" }

"want: $wantX,$wantY ${wantW}x${wantH}"
[void][M2]::SetWindowPos($best.hwnd, [IntPtr]::Zero, $wantX, $wantY, $wantW, $wantH, $FLAGS)
Start-Sleep -Milliseconds 250
"pass1 (250ms later) : $(Measure-Rect $best.hwnd)"
[void][M2]::SetWindowPos($best.hwnd, [IntPtr]::Zero, $wantX, $wantY, $wantW, $wantH, $FLAGS)
Start-Sleep -Milliseconds 250
"pass2 (settle)      : $(Measure-Rect $best.hwnd)"
[void][M2]::SetWindowPos($best.hwnd, [IntPtr]::Zero, $wantX, $wantY, $wantW, $wantH, $FLAGS)
Start-Sleep -Milliseconds 400
"pass3 (verify)      : $(Measure-Rect $best.hwnd)"

# restore exactly to the original physical rect, same two-pass technique
[void][M2]::SetWindowPos($best.hwnd, [IntPtr]::Zero, $best.r.L, $best.r.T, ($best.r.R - $best.r.L), ($best.r.B - $best.r.T), $FLAGS)
Start-Sleep -Milliseconds 250
[void][M2]::SetWindowPos($best.hwnd, [IntPtr]::Zero, $best.r.L, $best.r.T, ($best.r.R - $best.r.L), ($best.r.B - $best.r.T), $FLAGS)
Start-Sleep -Milliseconds 400
"restored            : $(Measure-Rect $best.hwnd)   (original $($best.r.L),$($best.r.T) $($best.r.R-$best.r.L)x$($best.r.B-$best.r.T))"