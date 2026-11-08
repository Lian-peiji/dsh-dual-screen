# panel-place.ps1 -- put the panel window where the plugin wants it.
#
# -app windows are created by Edge with its own idea of size/position, and
# --window-position is interpreted in DIPs of whatever monitor Edge picks.
# So we place the window ourselves, with the same two-pass technique the bridge
# uses for cross-DPI moves (position lands first try, size needs a second pass
# because Chromium re-applies its own rect on WM_DPICHANGED).
#
# Also sets WS_EX_TOOLWINDOW (out of Alt+Tab, no taskbar entry - PLAN 7.5 #8)
# and optionally HWND_TOPMOST (topmost but never activated, PLAN 7.5 / 12.5).
#
# Prints one JSON line. ASCII-only.
param(
  # NOTE: do not name this parameter $Pid. PowerShell's automatic variable $PID is
  # read-only, so binding -Pid fails with cannot overwrite variable Pid. The
  # alias keeps the old -Pid call sites working.
  [Alias('Pid')][int]$ProcessId = 0,
  # Preferred: identify the browser by its profile instead of by launch pid.
  # Edge re-execs: the pid we spawn is not the pid that owns the window
  # (measured 2026-11-05: launcher 23828, window owner 23356).
  [string]$ProfileDir = '',
  [Alias('X')][int]$PosX = 0,
  [Alias('Y')][int]$PosY = 0,
  [Alias('W')][int]$Width = 600,
  [Alias('H')][int]$Height = 1350,
  [switch]$Topmost,
  [switch]$ToolWindow,
  # Remove Edge --app's own title bar. Owner requirement 2026-11-05: the panel
  # must not show the browser's white strip / system X at all.
  #
  # Just stripping WS_CAPTION is NOT enough: Edge draws its own toolbar INSIDE
  # the client area (doc title + min/max/close), so the white strip survives.
  # What actually works (measured): strip the system frame, then place the window
  # ToolbarH pixels ABOVE the target content top, so Chromium's toolbar is
  # clipped off the top edge of the monitor and the page fills the visible area.
  # The caller therefore passes the CONTENT rect; we translate it here.
  [switch]$Frameless,
  [int]$ToolbarH = 48,
  [int]$TimeoutMs = 12000,
  [int]$MinArea = 50000
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PPlace {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int idx, IntPtr val);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetClassNameW")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetWindowTextW")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static List<IntPtr> All() { var l = new List<IntPtr>(); EnumWindows(delegate(IntPtr h, IntPtr x) { l.Add(h); return true; }, IntPtr.Zero); return l; }
  public static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, sb.Capacity); return sb.ToString(); }
  public static string Text(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, sb.Capacity); return sb.ToString(); }
  public static RECT Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return r; }
}
'@
[void][PPlace]::SetProcessDpiAwarenessContext([IntPtr](-4))

function Emit([hashtable]$o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush() }

# --- resolve candidate pids (profile wins over the launch pid) --------------
$candidatePids = New-Object System.Collections.Generic.HashSet[int]
if ($ProfileDir) {
  $needle = '--user-data-dir=' + $ProfileDir
  foreach ($q in Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue) {
    if ($q.CommandLine -and $q.CommandLine.Contains($needle)) { [void]$candidatePids.Add([int]$q.ProcessId) }
  }
}
if ($ProcessId -gt 0) { [void]$candidatePids.Add($ProcessId) }
if ($candidatePids.Count -eq 0) { Emit @{ ok = $false; error = 'no candidate browser process'; profile = $ProfileDir; pid = $ProcessId }; exit 1 }

# --- wait for a usable top-level window of that pid -------------------------
$deadline = (Get-Date).AddMilliseconds($TimeoutMs)
$best = [IntPtr]::Zero
$bestArea = 0
while ((Get-Date) -lt $deadline) {
  $best = [IntPtr]::Zero; $bestArea = 0
  foreach ($h in [PPlace]::All()) {
    if (-not [PPlace]::IsWindowVisible($h)) { continue }
    $pidw = 0; [void][PPlace]::GetWindowThreadProcessId($h, [ref]$pidw)
    if (-not $candidatePids.Contains([int]$pidw)) { continue }
    $r = [PPlace]::Rect($h)
    $area = ($r.R - $r.L) * ($r.B - $r.T)
    if ($area -gt $bestArea) { $bestArea = $area; $best = $h }
  }
  if ($best -ne [IntPtr]::Zero -and $bestArea -ge $MinArea) { break }
  Start-Sleep -Milliseconds 200
}
if ($best -eq [IntPtr]::Zero) { Emit @{ ok = $false; error = 'no visible window for pid'; pid = $ProcessId }; exit 1 }

# --- styles ---------------------------------------------------------------
# Strip the title bar BEFORE SetWindowPos: once WS_CAPTION is gone the client
# area fills the whole window, so the rect we position below is the real
# content rect (not a frame rect with a white bar on top).
if ($Frameless) {
  $GWL_STYLE = -16
  $WS_CAPTION = 0x00C00000
  $WS_THICKFRAME = 0x00040000
  $WS_SYSMENU = 0x00080000
  $WS_MINIMIZEBOX = 0x00020000
  $WS_MAXIMIZEBOX = 0x00010000
  $st = [int64][PPlace]::GetWindowLongPtr($best, $GWL_STYLE)
  $st = $st -band (-bnot ([int64]($WS_CAPTION -bor $WS_THICKFRAME -bor $WS_SYSMENU -bor $WS_MINIMIZEBOX -bor $WS_MAXIMIZEBOX)))
  [void][PPlace]::SetWindowLongPtr($best, $GWL_STYLE, [IntPtr]$st)
  # SWP_FRAMECHANGED|SWP_NOMOVE|SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE
  [void][PPlace]::SetWindowPos($best, [IntPtr]::Zero, 0, 0, 0, 0, (0x0020 -bor 0x0002 -bor 0x0001 -bor 0x0004 -bor 0x0010))
  Start-Sleep -Milliseconds 80
}

$GWL_EXSTYLE = -20
$WS_EX_TOOLWINDOW = 0x00000080
$WS_EX_APPWINDOW = 0x00040000
$ex = [int64][PPlace]::GetWindowLongPtr($best, $GWL_EXSTYLE)
if ($ToolWindow) { $ex = ($ex -bor $WS_EX_TOOLWINDOW) -band (-bnot $WS_EX_APPWINDOW) }
[void][PPlace]::SetWindowLongPtr($best, $GWL_EXSTYLE, [IntPtr]$ex)

$SWP_NOACTIVATE = 0x0010
$SWP_SHOWWINDOW = 0x0040
$SWP_NOZORDER = 0x0004
$after = if ($Topmost) { [IntPtr](-1) } else { [IntPtr]::Zero }   # HWND_TOPMOST = -1
$flags = $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW
if (-not $Topmost) { $flags = $flags -bor $SWP_NOZORDER }

if ([PPlace]::IsZoomed($best)) { [void][PPlace]::ShowWindow($best, 9); Start-Sleep -Milliseconds 150 }
[void][PPlace]::SetWindowPos($best, $after, $PosX, $PosY, $Width, $Height, $flags)
Start-Sleep -Milliseconds 250
[void][PPlace]::SetWindowPos($best, $after, $PosX, $PosY, $Width, $Height, $flags)   # cross-DPI settle pass
Start-Sleep -Milliseconds 150
$got = [PPlace]::Rect($best)
$gw = $got.R - $got.L; $gh = $got.B - $got.T
$exact = ([Math]::Abs($got.L - $PosX) -le 2) -and ([Math]::Abs($got.T - $PosY) -le 2) -and ([Math]::Abs($gw - $Width) -le 2) -and ([Math]::Abs($gh - $Height) -le 2)
Emit @{
  ok = $exact
  hwnd = ('0x{0:X}' -f ([long]$best))
  cls = [PPlace]::Cls($best)
  title = [PPlace]::Text($best)
  want = @($PosX, $PosY, $Width, $Height)
  got = @($got.L, $got.T, $gw, $gh)
  topmost = [bool]$Topmost
  toolWindow = $ToolWindow.IsPresent
}
if (-not $exact) { exit 1 }