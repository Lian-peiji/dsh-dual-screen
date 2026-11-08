# probe/hide-toolbar.ps1 -- hide Chromium's own app-window toolbar by pushing it
# above the physical top edge of the secondary monitor.
#
# Background: stripping WS_CAPTION removes the SYSTEM frame, but Edge/Chrome
# --app draws its own toolbar (doc title + min/max/close) INSIDE the client area,
# so it survives. The toolbar sits at the window's top edge; the secondary
# monitor's top edge is at y=-588, therefore placing the window at
# y = -588 - toolbarH clips the toolbar entirely off-screen and the page content
# starts exactly at the monitor's top edge.
#
# Usage: frameless-hide-toolbar.ps1 -ProfileDir ... -ContentX -ContentY -ContentW -ContentH -ToolbarH
# ASCII-only.
param(
  [string]$ProfileDir = 'E:\dsh\dual-screen\edge-profile',
  [Alias('X')][int]$PosX = 3536,
  [Alias('Y')][int]$PosY = -588,
  [Alias('W')][int]$Width = 600,
  [Alias('H')][int]$Height = 1350,
  [int]$ToolbarH = 48,
  [switch]$Topmost,
  [switch]$MeasureOnly
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Hb {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  public delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EP cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int idx, IntPtr v);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  public static List<IntPtr> All() { var l = new List<IntPtr>(); EnumWindows(delegate(IntPtr h, IntPtr x) { l.Add(h); return true; }, IntPtr.Zero); return l; }
}
'@
[void][Hb]::SetProcessDpiAwarenessContext([IntPtr](-4))

$cand = @()
foreach ($q in Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue) {
  if ($q.CommandLine -and $q.CommandLine.Contains('--user-data-dir=' + $ProfileDir)) { $cand += [int]$q.ProcessId }
}
'candidate pids: ' + ($cand -join ',')

$best = [IntPtr]::Zero; $bestArea = 0
foreach ($h in [Hb]::All()) {
  if (-not [Hb]::IsWindowVisible($h)) { continue }
  $pw = 0; [void][Hb]::GetWindowThreadProcessId($h, [ref]$pw)
  if ($cand -notcontains [int]$pw) { continue }
  $r = New-Object Hb+RECT; [void][Hb]::GetWindowRect($h, [ref]$r)
  $a = ($r.R - $r.L) * ($r.B - $r.T)
  if ($a -gt $bestArea) { $bestArea = $a; $best = $h }
}
if ($best -eq [IntPtr]::Zero) { 'no panel window'; exit 1 }

$cr = New-Object Hb+RECT; [void][Hb]::GetClientRect($best, [ref]$cr)
$wr = New-Object Hb+RECT; [void][Hb]::GetWindowRect($best, [ref]$wr)

# strip the system frame first (otherwise we would be hiding the system caption,
# not Chromium's toolbar)
$GWL_STYLE = -16
$STRIP = [int64](0x00C00000 -bor 0x00040000 -bor 0x00080000 -bor 0x00020000 -bor 0x00010000)
$s = [int64][Hb]::GetWindowLongPtr($best, $GWL_STYLE)
[void][Hb]::SetWindowLongPtr($best, $GWL_STYLE, [IntPtr]($s -band (-bnot $STRIP)))
[void][Hb]::SetWindowPos($best, [IntPtr]::Zero, 0, 0, 0, 0, 0x0020 -bor 0x0002 -bor 0x0001 -bor 0x0004 -bor 0x0010)
Start-Sleep -Milliseconds 200

# window Y so that (Y + toolbarH) == content top
$winY = $PosY - $ToolbarH
$winH = $Height + $ToolbarH
$after = if ($Topmost) { [IntPtr](-1) } else { [IntPtr]::Zero }
$flags = 0x0010 -bor 0x0040   # NOACTIVATE | SHOWWINDOW
if (-not $Topmost) { $flags = $flags -bor 0x0004 }
[void][Hb]::SetWindowPos($best, $after, $PosX, $winY, $Width, $winH, $flags)
Start-Sleep -Milliseconds 250
[void][Hb]::SetWindowPos($best, $after, $PosX, $winY, $Width, $winH, $flags)
Start-Sleep -Milliseconds 200

$fin = New-Object Hb+RECT; [void][Hb]::GetWindowRect($best, [ref]$fin)
'hwnd          : 0x{0:X}' -f (( [long]$best ))
'client rect   : {0}x{1}' -f ($cr.R - $cr.L), ($cr.B - $cr.T)
'window placed : {0},{1} {2}x{3}' -f $fin.L, $fin.T, ($fin.R - $fin.L), ($fin.B - $fin.T)
'content top   : {0}  (wanted {1})' -f ($fin.T + $ToolbarH), $PosY
'content bottom: {0}  (wanted {1})' -f ($fin.B), ($PosY + $Height)