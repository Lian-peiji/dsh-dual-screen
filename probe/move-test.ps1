# P0 probe: prove Per-Monitor V2 physical coordinates for SetWindowPos.
# Moves OUR OWN ego window to the secondary screen, measures the result, restores.
# Never touches the master's windows: target is picked by the ego cmdline marker.
# ASCII-only.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class Mover {
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
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetWindowTextW")]
  public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfoW(IntPtr hMon, ref MONITORINFOEX mi);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);

  public static List<IntPtr> Windows() { var l = new List<IntPtr>(); EnumWindows(delegate(IntPtr h, IntPtr x) { l.Add(h); return true; }, IntPtr.Zero); return l; }
  public static string Text(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, sb.Capacity); return sb.ToString(); }
  public static List<IntPtr> Monitors() { var l = new List<IntPtr>(); EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr h, IntPtr hdc, ref RECT rc, IntPtr d) { l.Add(h); return true; }, IntPtr.Zero); return l; }
  public static MONITORINFOEX Info(IntPtr h) { var mi = new MONITORINFOEX(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX)); GetMonitorInfoW(h, ref mi); return mi; }
}
'@

[void][Mover]::SetProcessDpiAwarenessContext([IntPtr](-4))

# --- monitors ---
$mons = @()
foreach ($h in [Mover]::Monitors()) { $mi = [Mover]::Info($h); $mons += [pscustomobject]@{ h = $h; dev = $mi.szDevice; primary = (($mi.dwFlags -band 1) -ne 0); work = $mi.rcWork } }
$target = $mons | Where-Object { -not $_.primary } | Select-Object -First 1
if (-not $target) { 'NO SECONDARY MONITOR - probe aborted'; return }

# --- find our ego main window (largest ego window) ---
$egoPids = @()
foreach ($p in Get-CimInstance Win32_Process) {
  $cl = [string]$p.CommandLine
  if ($cl -and ($cl -match 'ego-lite-linux' -or $cl -match '--class=ego-lite-linux')) { $egoPids += [int]$p.ProcessId }
}
if ($egoPids.Count -eq 0) { 'NO EGO BROWSER RUNNING - probe aborted'; return }
$cands = @()
foreach ($h in [Mover]::Windows()) {
  if (-not [Mover]::IsWindowVisible($h)) { continue }
  $pidw = 0; [void][Mover]::GetWindowThreadProcessId($h, [ref]$pidw)
  if ($egoPids -notcontains [int]$pidw) { continue }
  $r = New-Object Mover+RECT; [void][Mover]::GetWindowRect($h, [ref]$r)
  $area = ($r.R - $r.L) * ($r.B - $r.T)
  if ($area -lt 200000) { continue }   # skip transient bubbles
  $cands += [pscustomobject]@{ hwnd = $h; w = ($r.R - $r.L); h = ($r.B - $r.T); area = $area; title = [Mover]::Text($h); rect = $r }
}
$win = $cands | Sort-Object area -Descending | Select-Object -First 1
if (-not $win) { 'NO EGO WINDOW FOUND - probe aborted'; return }

"ego browser pids : $($egoPids -join ',')"
"primary monitor  : $($mons | Where-Object primary | ForEach-Object { $_.dev + ' ' + $_.work.L + ',' + $_.work.T + ' ' + ($_.work.R-$_.work.L) + 'x' + ($_.work.B-$_.work.T) })"
"secondary monitor: $($target.dev) work=($($target.work.L),$($target.work.T)) $(($target.work.R-$target.work.L))x$(($target.work.B-$target.work.T))"
"target window    : [$($win.title)] $($win.rect.L),$($win.rect.T) $($win.w)x$($win.h)"
'saved original rect: (' + $win.rect.L + ',' + $win.rect.T + ',' + $win.w + ',' + $win.h + ')'

# --- move to secondary top-right with 24px margin, clamp size to work area ---
$margin = 24
$w = [Math]::Min($win.w, ($target.work.R - $target.work.L) - 2 * $margin)
$hh = [Math]::Min($win.h, ($target.work.B - $target.work.T) - 2 * $margin)
$x = $target.work.R - $margin - $w
$y = $target.work.T + $margin
$SWP_NOACTIVATE = 0x0010; $SWP_SHOWWINDOW = 0x0040; $SWP_NOZORDER = 0x0004
$ok = [Mover]::SetWindowPos($win.hwnd, [IntPtr]::Zero, $x, $y, $w, $hh, ($SWP_NOACTIVATE -bor $SWP_SHOWWINDOW -bor $SWP_NOZORDER))
Start-Sleep -Milliseconds 400
$after = New-Object Mover+RECT; [void][Mover]::GetWindowRect($win.hwnd, [ref]$after)
'SetWindowPos ok  : ' + $ok
"requested rect   : $x,$y $($w)x$($hh)"
"measured rect    : $($after.L),$($after.T) $($after.R-$after.L)x$($after.B-$after.T)"
"delta            : dx=$($after.L-$x) dy=$($after.T-$y) dw=$(($after.R-$after.L)-$w) dh=$(($after.B-$after.T)-$hh)"
"on secondary?    : " + (($after.L -ge $target.work.L) -and ($after.L -lt $target.work.R))

# --- restore ---
[void][Mover]::SetWindowPos($win.hwnd, [IntPtr]::Zero, $win.rect.L, $win.rect.T, $win.w, $win.h, ($SWP_NOACTIVATE -bor $SWP_NOZORDER))
Start-Sleep -Milliseconds 300
$back = New-Object Mover+RECT; [void][Mover]::GetWindowRect($win.hwnd, [ref]$back)
"restored rect    : $($back.L),$($back.T) $($back.R-$back.L)x$($back.B-$back.T)"