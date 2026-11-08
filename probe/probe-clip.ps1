# probe-clip.ps1 -- is something else holding the mouse? (game / fullscreen app)
#
# Symptom that started this: SetCursorPos returns False and injected relative moves
# stop short of the secondary monitor. One classic cause is ClipCursor() from a
# fullscreen game, another is a foreground app that grabs raw input.
# ASCII only.
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class CLP {
  [DllImport("user32.dll")] public static extern bool GetClipCursor(out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@
$r = New-Object CLP+RECT
[void][CLP]::GetClipCursor([ref]$r)
Write-Output ("clip cursor: {0},{1} - {2},{3}" -f $r.L, $r.T, $r.R, $r.B)
Write-Output ("virtual screen: x={0} y={1} w={2} h={3}" -f [CLP]::GetSystemMetrics(76), [CLP]::GetSystemMetrics(77), [CLP]::GetSystemMetrics(78), [CLP]::GetSystemMetrics(79))
$p = New-Object CLP+POINT
[void][CLP]::GetCursorPos([ref]$p)
Write-Output ("cursor: {0},{1}" -f $p.X, $p.Y)
$fg = [CLP]::GetForegroundWindow()
$pid2 = 0
[void][CLP]::GetWindowThreadProcessId($fg, [ref]$pid2)
$cls = New-Object System.Text.StringBuilder 256
[void][CLP]::GetClassNameW($fg, $cls, 256)
$txt = New-Object System.Text.StringBuilder 256
[void][CLP]::GetWindowTextW($fg, $txt, 256)
$proc = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
Write-Output ("foreground: 0x{0} pid={1} proc='{2}' class='{3}' title='{4}'" -f ([int64]$fg).ToString('X'), $pid2, $proc.ProcessName, $cls.ToString(), $txt.ToString())