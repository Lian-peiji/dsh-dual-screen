# drag-resize.ps1 -- REAL mouse drag on the panel's right edge.
#
# WHY: WM_NCHITTEST answers can be checked with SendMessage, but that only proves
# the numbers. The only honest proof that the owner can resize with the mouse is
# to actually move the cursor, press, drag and release, then read the result.
# Coordinates are PHYSICAL screen pixels (SetCursorPos), so all values here come
# from the panel's own physical rect.
#
# ASCII-only. Usage: powershell -File drag-resize.ps1 -EdgeX:4132 -MidY:-324 -Dx:120
param(
  [int]$EdgeX = 4132,
  [int]$MidY = -324,
  [int]$Dx = 120,
  [int]$Dy = 0,
  [switch]$Restore
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MS {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
'@

$LefDown = 0x0002
$LeftUp = 0x0004

$old = New-Object MS+POINT
[void][MS]::GetCursorPos([ref]$old)
Write-Output ("cursor before: {0},{1}" -f $old.X, $old.Y)

# park on the edge, press, drag in small steps, release
[void][MS]::SetCursorPos($EdgeX, $MidY)
Start-Sleep -Milliseconds 350
[MS]::mouse_event($LefDown, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 250
$steps = 12
for ($i = 1; $i -le $steps; $i++) {
  $x = $EdgeX + [int]($Dx * $i / $steps)
  $y = $MidY + [int]($Dy * $i / $steps)
  [void][MS]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 40
}
Start-Sleep -Milliseconds 250
[MS]::mouse_event($LeftUp, 0, 0, 0, [IntPtr]::Zero)
Write-Output ("dragged edge {0},{1} by {2},{3}" -f $EdgeX, $MidY, $Dx, $Dy)

# give the 700ms debounce room to POST the new size
Start-Sleep -Milliseconds 1600
if ($Restore) { [void][MS]::SetCursorPos($old.X, $old.Y) }