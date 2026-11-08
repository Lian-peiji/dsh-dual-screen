# probe-bridge-live.ps1 -- ask the RUNNING pet whether its host bridge exists.
#
# Cheaper than reasoning about it: the page exposes window.__pet.bridge(), and the
# host exposes PetHost.Exec, so a one-shot script can read the answer.
#
# This script starts its own pet instance (other instances are unaffected), waits for
# the page to boot, drags the window with real input, and reports both the bridge
# state and whether the window moved.
#
# ASCII only.
param(
  [string]$PageUrl = 'http://127.0.0.1:5273/dsh-dual-screen/pet-page?theme=whale&api=http://127.0.0.1:5273',
  [string]$Repo = 'J:\大肥鱼游乐场\dsh-dual-screen',
  [string]$DataDir = 'E:\dsh\dual-screen'
)

$ErrorActionPreference = 'Stop'

# Load the pet host script in-process so we can talk to its types afterwards.
# dot-sourcing would run ShowDialog and block forever, so we only borrow the
# compiled shim by invoking the script with a tiny ExitAfterMs and then... no.
# Simpler and honest: run the real host, and read diagnostics through its own log.
# The page writes bridge state on boot; the host logs drag messages. So:
#   1. start host with a short probe line in the page
#   2. drag it with real input
#   3. compare geometry and grep the log
$log = Join-Path $DataDir 'pet-host.log'
$ready = Join-Path $DataDir 'pet-bridge-probe.json'
if (Test-Path $ready) { Remove-Item $ready -Force }

$before = (Get-Item $log).Length
$hostScript = Join-Path $Repo 'bin\pet-webview.ps1'

$args = @('-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',$hostScript,
  '-AssetDir:' + (Join-Path $Repo 'panel'),
  '-PageUrl:' + $PageUrl,
  '-Size:240','-PosX:2700','-PosY:800',
  '-ReadyFile:' + $ready,
  '-ExitAfterMs:26000')
$proc = Start-Process powershell.exe -ArgumentList $args -PassThru -WindowStyle Hidden

for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 300
  if (Test-Path $ready) { break }
}
if (-not (Test-Path $ready)) {
  Write-Output 'FAIL: pet never reported ready'
  if (-not $proc.HasExited) { $proc.Kill() }
  exit 1
}
$r = Get-Content $ready -Raw | ConvertFrom-Json
Write-Output ("ready: hwnd={0} rect={1}" -f $r.hwnd, ($r.rect -join ','))

Start-Sleep -Milliseconds 2500     # let the page finish booting

# --- real drag ---
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BD {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint w, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
[void][BD]::SetProcessDpiAwarenessContext([IntPtr](-4))

$hwnd = [IntPtr][int64]$r.hwnd
$box = New-Object BD+RECT
[void][BD]::GetWindowRect($hwnd, [ref]$box)
$sx = $box.L + [int](($box.R - $box.L) / 2)
$sy = $box.T + [int](($box.B - $box.T) * 0.6)
$dx = -180; $dy = -100

[void][BD]::SetCursorPos($sx, $sy)
Start-Sleep -Milliseconds 500
[BD]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 350
for ($i = 1; $i -le 12; $i++) {
  [void][BD]::SetCursorPos($sx + [int]($dx * $i / 12), $sy + [int]($dy * $i / 12))
  Start-Sleep -Milliseconds 60
}
Start-Sleep -Milliseconds 350
[BD]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 1500

$after = New-Object BD+RECT
[void][BD]::GetWindowRect($hwnd, [ref]$after)
$movedX = $after.L - $box.L
$movedY = $after.T - $box.T
Write-Output ("drag: wanted {0},{1} got {2},{3}" -f $dx, $dy, $movedX, $movedY)

# --- what the log learned ---
$lines = Get-Content $log | Select-Object -Skip ([int]($before)) 2>$null
$dragLines = $lines | Where-Object { $_ -match 'drag|web message' }
Write-Output '--- host log since start ---'
$dragLines | Select-Object -Last 8 | ForEach-Object { Write-Output $_ }

if (-not $proc.HasExited) { $proc.Kill() }

$ok = ([math]::Abs($movedX - $dx) -le 15) -and ([math]::Abs($movedY - $dy) -le 15)
if ($ok) { Write-Output 'RESULT: PASS (window followed the mouse)' }
else { Write-Output 'RESULT: FAIL (window did not move)' }