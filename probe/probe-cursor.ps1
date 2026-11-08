# probe-cursor.ps1 -- is the cursor really where we put it, and what is under it?
# ASCII only.
param([string]$ReadyFile = 'E:\dsh\dual-screen\pet-ready.json')
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PC2 {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@
[void][PC2]::SetProcessDpiAwarenessContext([IntPtr](-4))
$ready = Get-Content -LiteralPath $ReadyFile -Raw | ConvertFrom-Json
$hwnd = [IntPtr][int64]$ready.hwnd
$r = New-Object PC2+RECT
[void][PC2]::GetWindowRect($hwnd, [ref]$r)
Write-Output ("pet rect now: {0},{1},{2},{3}" -f $r.L, $r.T, $r.R, $r.B)
Write-Output ("virtual screen: {0}x{1} at {2},{3}" -f [PC2]::GetSystemMetrics(78), [PC2]::GetSystemMetrics(79), [PC2]::GetSystemMetrics(76), [PC2]::GetSystemMetrics(77))
$p0 = New-Object PC2+POINT
[void][PC2]::GetCursorPos([ref]$p0)
Write-Output ("cursor before: {0},{1}" -f $p0.X, $p0.Y)
$ok = [PC2]::SetCursorPos(3960, 1672)
Start-Sleep -Milliseconds 200
$p1 = New-Object PC2+POINT
[void][PC2]::GetCursorPos([ref]$p1)
Write-Output ("SetCursorPos ok={0} cursor after: {1},{2}" -f $ok, $p1.X, $p1.Y)
$u = [PC2]::WindowFromPoint($p1)
Write-Output ("under cursor: 0x{0}" -f ([int64]$u).ToString('X'))
Write-Output ("foreground: 0x{0}" -f ([int64][PC2]::GetForegroundWindow()).ToString('X'))