# p5-selfrect.ps1 -- report this console window's own rect, proving where it was born.
# ASCII only (PS 5.1 reads BOM-less .ps1 as ANSI).
param([string]$Out = 'E:\dsh\dual-screen\p5-selfrect.json')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SelfRect {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
}
'@
$h = [SelfRect]::GetConsoleWindow()
Start-Sleep -Milliseconds 1200
$r = New-Object SelfRect+RECT
$ok = [SelfRect]::GetWindowRect($h, [ref]$r)
$obj = '{"pid":' + $PID + ',"hwnd":' + $h.ToInt64() + ',"ok":' + ($ok.ToString().ToLower()) + ',"x":' + $r.L + ',"y":' + $r.T + ',"w":' + ($r.R - $r.L) + ',"h2":' + ($r.B - $r.T) + '}'
Set-Content -Path $Out -Value $obj -Encoding ASCII
