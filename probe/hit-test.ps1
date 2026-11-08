# hit-test.ps1 -- ask the live panel what each edge answers for WM_NCHITTEST.
# ASCII only. Reads the panel geometry from the ready file, then SendMessage()s
# WM_NCHITTEST at the four edges, four corners and the centre.
#
# Yes, SendMessage bypasses the real mouse path, but it proves the hook is
# installed and the codes are right; drag-test.ps1 proves the OS takes them.
param()

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class HT {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

try { [void][HT]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { }

$ready = Get-Content 'E:\dsh\dual-screen\panel-ready.json' -Raw | ConvertFrom-Json
$winHwnd = [IntPtr][int64]$ready.hwnd
if (-not [HT]::IsWindow($winHwnd)) { Write-Output 'FAIL: window is gone'; exit 1 }

$box = New-Object HT+RECT
[void][HT]::GetWindowRect($winHwnd, [ref]$box)
$left = $box.L; $top = $box.T; $right = $box.R; $bottom = $box.B
$midX = $left + [int](($right - $left) / 2)
$midY = $top + [int](($bottom - $top) / 2)
Write-Output ("window {0},{1} {2}x{3}" -f $left, $top, ($right - $left), ($bottom - $top))

function Query-Hit([int]$sx, [int]$sy) {
  $lp = (($sy -band 0xFFFF) -shl 16) -bor ($sx -band 0xFFFF)
  return [int][HT]::SendMessage($winHwnd, 0x0084, [IntPtr]::Zero, [IntPtr]$lp)
}

$checks = @(
  @('left',    ($left + 3),   $midY,                10),
  @('right',   ($right - 4),  $midY,                11),
  @('top',     $midX,         ($top + 3),           12),
  @('bottom',  $midX,         ($bottom - 4),        15),
  @('top-left',     ($left + 3),  ($top + 3),       13),
  @('top-right',    ($right - 4), ($top + 3),       14),
  @('bot-left',     ($left + 3),  ($bottom - 4),    16),
  @('bot-right',    ($right - 4), ($bottom - 4),    17),
  @('centre',       $midX,        $midY,             1)
)

$bad = 0
foreach ($ck in $checks) {
  $name = $ck[0]; $px = $ck[1]; $py = $ck[2]; $want = $ck[3]
  $got = Query-Hit $px $py
  $ok = ($got -eq $want)
  if (-not $ok) { $bad++ }
  Write-Output ("{0,-10} ({1},{2}) -> {3,3}  want {4,3}  {5}" -f $name, $px, $py, $got, $want, $(if ($ok) { 'OK' } else { 'BAD' }))
}
if ($bad -eq 0) { Write-Output 'RESULT: PASS' } else { Write-Output ("RESULT: FAIL ({0})" -f $bad) }