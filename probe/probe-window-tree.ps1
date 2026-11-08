# probe-window-tree.ps1 -- what is really under the cursor over the pet?
# Walks the window chain at the pet centre and prints class/title/style so a
# click that "does not reach the page" can be attributed to a concrete HWND.
# ASCII only.
param(
  [string]$ReadyFile = 'E:\dsh\dual-screen\pet-ready.json'
)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WT {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr ChildWindowFromPointEx(IntPtr h, POINT p, uint f);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@
[void][WT]::SetProcessDpiAwarenessContext([IntPtr](-4))

function Show($h, $depth) {
  if ($h -eq [IntPtr]::Zero) { return }
  $cls = New-Object System.Text.StringBuilder 256
  [void][WT]::GetClassNameW($h, $cls, 256)
  $txt = New-Object System.Text.StringBuilder 256
  [void][WT]::GetWindowTextW($h, $txt, 256)
  $r = New-Object WT+RECT
  [void][WT]::GetWindowRect($h, [ref]$r)
  $ex = [WT]::GetWindowLong($h, -20)
  $st = [WT]::GetWindowLong($h, -16)
  $vis = [WT]::IsWindowVisible($h)
  Write-Output ("{0}0x{1} class='{2}' title='{3}' rect={4},{5},{6},{7} ex=0x{8} style=0x{9} vis={10}" -f `
    (' ' * ($depth * 2)), ([int64]$h).ToString('X'), $cls.ToString(), $txt.ToString(),
    $r.L, $r.T, $r.R, $r.B, ([int64]$ex).ToString('X8'), ([int64]$st).ToString('X8'), $vis)
}

$ready = Get-Content -LiteralPath $ReadyFile -Raw | ConvertFrom-Json
$hwnd = [IntPtr][int64]$ready.hwnd
$box = New-Object WT+RECT
[void][WT]::GetWindowRect($hwnd, [ref]$box)
$wide = $box.R - $box.L; $tall = $box.B - $box.T

Write-Output '--- the pet window (from pet-ready.json) ---'
Show $hwnd 0

$pt = New-Object WT+POINT
$pt.X = $box.L + [int]($wide / 2); $pt.Y = $box.T + [int]($tall * 0.55)
Write-Output ("--- probe point {0},{1} ---" -f $pt.X, $pt.Y)
$w = [WT]::WindowFromPoint($pt)
Write-Output '--- WindowFromPoint ---'
Show $w 0
$p = $w
while ($p -ne [IntPtr]::Zero) { $p = [WT]::GetAncestor($p, 1); if ($p -ne [IntPtr]::Zero) { Write-Output 'ancestor:'; Show $p 0 } }

Write-Output '--- children of the pet window ---'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WC {
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  public static IntPtr first = IntPtr.Zero;
}
"@
$found = @()
$cb = [WC+EnumProc]{ param($h, $p) $script:found += $h; return $true }
[void][WC]::EnumChildWindows($hwnd, $cb, [IntPtr]::Zero)
foreach ($c in $script:found) { Show $c 1 }
Write-Output ("children: " + $script:found.Count)