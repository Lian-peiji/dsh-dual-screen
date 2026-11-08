# probe/frameless-test.ps1 -- can we keep the Edge --app title bar off?
#
# Chromium owns its window and re-applies WS_CAPTION on some events, so a single
# SetWindowLong may get undone. This probe strips the caption, then re-checks
# the style a few times over ~2s and reports whether it stays off.
# ASCII-only.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Fr {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  public delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EP cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int idx, IntPtr v);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetWindowTextW")] public static extern int Text(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public static List<IntPtr> All() { var l = new List<IntPtr>(); EnumWindows(delegate(IntPtr h, IntPtr x) { l.Add(h); return true; }, IntPtr.Zero); return l; }
  public static string T(IntPtr h) { var sb = new StringBuilder(300); Text(h, sb, 300); return sb.ToString(); }
}
'@
[void][Fr]::SetProcessDpiAwarenessContext([IntPtr](-4))

 $script:candPids = @()
foreach ($q in Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue) { if ($q.CommandLine -and $q.CommandLine.Contains('--user-data-dir=E:\dsh\dual-screen\edge-profile')) { $script:candPids += [int]$q.ProcessId } }
'panel candidate pids: ' + ($script:candPids -join ',')
$target = [IntPtr]::Zero
foreach ($h in [Fr]::All()) {
  if (-not [Fr]::IsWindowVisible($h)) { continue }
  # match by process, not by title: this file must stay ASCII-only (PS 5.1 reads a
  # BOM-less .ps1 as ANSI, so a CJK literal here would be mangled and never match).
  $pw = 0; [void][Fr]::GetWindowThreadProcessId($h, [ref]$pw)
  if ($script:candPids -notcontains [int]$pw) { continue }
  $r = New-Object Fr+RECT; [void][Fr]::GetWindowRect($h, [ref]$r)
  if (($r.R - $r.L) -gt 400) { $target = $h; break }
}
if ($target -eq [IntPtr]::Zero) { 'no panel window found'; exit 1 }
'panel hwnd: 0x' + $target.ToString('X')

$GWL_STYLE = -16
$WS_CAPTION = 0x00C00000
$WS_THICKFRAME = 0x00040000
$WS_SYSMENU = 0x00080000
$WS_MINIMIZEBOX = 0x00020000
$WS_MAXIMIZEBOX = 0x00010000
$STRIP = [int64]($WS_CAPTION -bor $WS_THICKFRAME -bor $WS_SYSMENU -bor $WS_MINIMIZEBOX -bor $WS_MAXIMIZEBOX)

function Get-Style { return [int64][Fr]::GetWindowLongPtr($target, $GWL_STYLE) }
function Has-Caption([int64]$s) { return (($s -band $WS_CAPTION) -ne 0) }

$before = Get-Style
'style before : 0x{0:X}  hasCaption={1}' -f $before, (Has-Caption $before)

for ($i = 1; $i -le 6; $i++) {
  $s = Get-Style
  $s2 = $s -band (-bnot $STRIP)
  [void][Fr]::SetWindowLongPtr($target, $GWL_STYLE, [IntPtr]$s2)
  # SWP_FRAMECHANGED|SWP_NOMOVE|SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE
  [void][Fr]::SetWindowPos($target, [IntPtr]::Zero, 0, 0, 0, 0, 0x0020 -bor 0x0002 -bor 0x0001 -bor 0x0004 -bor 0x0010)
  Start-Sleep -Milliseconds 300
  $now = Get-Style
  'try {0}: hasCaption={1}  style=0x{2:X}' -f $i, (Has-Caption $now), $now
}
$r2 = New-Object Fr+RECT; [void][Fr]::GetWindowRect($target, [ref]$r2)
'final rect: {0},{1} {2}x{3}' -f $r2.L, $r2.T, ($r2.R - $r2.L), ($r2.B - $r2.T)