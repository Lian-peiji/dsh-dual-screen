# resize-check.ps1 -- prove the panel answers WM_NCHITTEST with resize edges.
#
# WHY: the owner asked for mouse-resizable edges. We cannot drag with a mouse
# from a script, but we CAN ask the window itself: send WM_NCHITTEST at the four
# edges plus the center and read the returned hit-test code. HTRIGHT=11,
# HTBOTTOM=15, HTBOTTOMRIGHT=17, HTCLIENT=1 means "not on an edge".
#
# ASCII-only. Usage: powershell -File resize-check.ps1 -WaitSec:20
param(
  [string]$Repo = 'J:\大肥鱼游乐场\dsh-dual-screen',
  [int]$WaitSec = 20,
  [string]$DataUrl = 'http://127.0.0.1:7335/dsh-dual-screen/panel.json'
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class RZ {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
'@

$readyFile = 'E:\dsh\dual-screen\resize-check-ready.json'
if (Test-Path $readyFile) { Remove-Item -LiteralPath $readyFile -Force }
$log = 'E:\dsh\dual-screen\resize-check.log'
if (Test-Path $log) { Remove-Item -LiteralPath $log -Force }

$host1 = Join-Path $Repo 'bin\panel-host.ps1'
$args1 = @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $host1,
  '-X:3536', '-Y:-564', '-W:600', '-H:1350', '-UiScale:1.5',
  '-ReadyFile:' + $readyFile, '-DataUrl:' + $DataUrl,
  '-AvatarFile:' + (Join-Path $Repo 'panel\avatar.png'), '-Topmost',
  '-ExitAfterMs:' + ($WaitSec * 1000),
  '-StageLog:E:\dsh\dual-screen\resize-check-panel.log')
$p = Start-Process -FilePath 'powershell.exe' -ArgumentList $args1 -PassThru -WindowStyle Hidden

$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Milliseconds 250
  if (-not (Test-Path $readyFile)) { continue }
  try {
    $j = Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json
    $hwnd = [IntPtr][int64]$j.hwnd
    break
  } catch { }
}

if ($hwnd -eq [IntPtr]::Zero) {
  Write-Output 'RESULT: FAIL (panel never reported ready)'
  if (-not $p.HasExited) { $p.Kill() }
  exit 1
}

Start-Sleep -Milliseconds 1200
$r = New-Object RZ+RECT
[void][RZ]::GetWindowRect($hwnd, [ref]$r)
Write-Output ("window rect: {0},{1} {2}x{3}" -f $r.L, $r.T, ($r.R - $r.L), ($r.B - $r.T))

function Test-Point([int]$x, [int]$y) {
  $lp = (($y -band 0xFFFF) -shl 16) -bor ($x -band 0xFFFF)
  return [int][RZ]::SendMessage($hwnd, 0x0084, [IntPtr]::Zero, [IntPtr]$lp)
}

$cases = @(
  @{ n = 'left edge';    x = $r.L + 3;  y = [int](($r.T + $r.B) / 2); want = 10 },
  @{ n = 'right edge';   x = $r.R - 4;  y = [int](($r.T + $r.B) / 2); want = 11 },
  @{ n = 'top edge';     x = [int](($r.L + $r.R) / 2); y = $r.T + 3;  want = 12 },
  @{ n = 'bottom edge';  x = [int](($r.L + $r.R) / 2); y = $r.B - 4;  want = 15 },
  @{ n = 'bottom-right'; x = $r.R - 4;  y = $r.B - 4;                 want = 17 },
  @{ n = 'top-left';     x = $r.L + 3;  y = $r.T + 3;                 want = 13 },
  @{ n = 'center';       x = [int](($r.L + $r.R) / 2); y = [int](($r.T + $r.B) / 2); want = 1 }
)

$fail = 0
foreach ($c in $cases) {
  $got = Test-Point $c.x $c.y
  $ok = ($got -eq $c.want)
  if (-not $ok) { $fail++ }
  Write-Output ("{0,-14} ({1},{2}) -> {3} want {4} {5}" -f $c.n, $c.x, $c.y, $got, $c.want, $(if ($ok) { 'OK' } else { 'BAD' }))
}

if (-not $p.HasExited) { $p.Kill() }
if ($fail -eq 0) { Write-Output 'RESULT: PASS (all edges answer resize codes)' } else { Write-Output ("RESULT: FAIL ({0} bad)" -f $fail) }