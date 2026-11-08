# panel-move.ps1 -- move/resize the native panel window by HWND.
#
# The WPF panel (bin/panel-host.ps1) is a plain Win32 window, so geometry changes
# (collapse <-> expand, drag persistence, height recalc) are a SetWindowPos away
# -- no need to restart the window and lose its state.
#
# ASCII-only (PS 5.1 reads BOM-less .ps1 as ANSI; CJK here would eat characters).
# Negative coordinates MUST be passed in colon form by the caller: -Y:-588.
param(
  [Parameter(Mandatory = $true)][string]$Hwnd,
  [Alias('X')][int]$PosX = 0,
  [Alias('Y')][int]$PosY = 0,
  [Alias('W')][int]$Width = 600,
  [Alias('H')][int]$Height = 1350,
  [switch]$Topmost
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Pm {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
}
'@
[void][Pm]::SetProcessDpiAwarenessContext([IntPtr](-4))

$h = [IntPtr][Convert]::ToInt64(($Hwnd -replace '^0x', ''), 16)
if (-not [Pm]::IsWindow($h)) {
  '{"ok":false,"error":"window not found","hwnd":"' + $Hwnd + '"}'
  exit 1
}

$SWP_NOACTIVATE = 0x0010
$SWP_NOZORDER = 0x0004
$after = if ($Topmost) { [IntPtr](-1) } else { [IntPtr]::Zero }
$flags = $SWP_NOACTIVATE
if (-not $Topmost) { $flags = $flags -bor $SWP_NOZORDER }

[void][Pm]::SetWindowPos($h, $after, $PosX, $PosY, $Width, $Height, $flags)
Start-Sleep -Milliseconds 120
[void][Pm]::SetWindowPos($h, $after, $PosX, $PosY, $Width, $Height, $flags)
Start-Sleep -Milliseconds 120
$r = New-Object Pm+RECT
[void][Pm]::GetWindowRect($h, [ref]$r)
$got = @($r.L, $r.T, ($r.R - $r.L), ($r.B - $r.T))
$exact = ($got[0] -eq $PosX) -and ($got[1] -eq $PosY) -and ($got[2] -eq $Width) -and ($got[3] -eq $Height)
'{"ok":' + $exact.ToString().ToLower() + ',"hwnd":"' + $Hwnd + '","want":[' + $PosX + ',' + $PosY + ',' + $Width + ',' + $Height + '],"got":[' + ($got -join ',') + ']}'
if (-not $exact) { exit 1 }