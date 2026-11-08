# verify-pet-drag.ps1 -- one-shot acceptance for pet dragging.
#
# Runs the real pet host in a child process, waits for its ready file, performs a
# genuine mouse drag over the pet body, and reports whether the window followed.
#
# Two traps this avoids:
#   1. Start-Process -ArgumentList with a URL containing '&' gets re-parsed by the
#      shell, so the query string is lost. We quote each argument ourselves.
#   2. The ready file must be unique per run, otherwise a stale one from a previous
#      attempt is read back and the geometry lies.
#
# ASCII only.
param(
  [string]$Repo = 'J:\大肥鱼游乐场\dsh-dual-screen',
  [string]$ApiBase = 'http://127.0.0.1:5273',
  [int]$Dx = -180,
  [int]$Dy = -100
)

$ErrorActionPreference = 'Stop'
$DataDir = 'E:\dsh\dual-screen'
$tag = 'dragprobe-' + (Get-Date -Format 'HHmmss')
$ready = Join-Path $DataDir ($tag + '.json')
$hostScript = Join-Path $Repo 'bin\pet-webview.ps1'
$pageUrl = $ApiBase + '/dsh-dual-screen/pet-page?theme=whale&api=' + [uri]::EscapeDataString($ApiBase)

# Quote every argument so '&' inside the URL stays inside its own argv element.
$argList = @(
  '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $hostScript + '"'),
  '-AssetDir:' + ('"' + (Join-Path $Repo 'panel') + '"'),
  '-PageUrl:' + ('"' + $pageUrl + '"'),
  '-Size:240', '-PosX:2700', '-PosY:800',
  '-ReadyFile:' + ('"' + $ready + '"'),
  '-ExitAfterMs:30000'
)
$proc = Start-Process powershell.exe -ArgumentList $argList -PassThru -WindowStyle Hidden

for ($i = 0; $i -lt 80; $i++) {
  Start-Sleep -Milliseconds 250
  if (Test-Path -LiteralPath $ready) { break }
}
if (-not (Test-Path -LiteralPath $ready)) {
  Write-Output 'FAIL: pet never reported ready (see pet-host.log)'
  if (-not $proc.HasExited) { $proc.Kill() }
  exit 1
}

$rd = Get-Content -LiteralPath $ready -Raw | ConvertFrom-Json
Write-Output ('ready: ' + $rd.hwnd + ' rect=' + ($rd.rect -join ','))

Start-Sleep -Milliseconds 2500

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VD {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint w, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
[void][VD]::SetProcessDpiAwarenessContext([IntPtr](-4))

$hwnd = [IntPtr][int64]$rd.hwnd
$box = New-Object VD+RECT
[void][VD]::GetWindowRect($hwnd, [ref]$box)
$sx = $box.L + [int](($box.R - $box.L) / 2)
$sy = $box.T + [int](($box.B - $box.T) * 0.6)
Write-Output ('start point: ' + $sx + ',' + $sy)

[void][VD]::SetCursorPos($sx, $sy)
Start-Sleep -Milliseconds 500
[VD]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 350
for ($i = 1; $i -le 12; $i++) {
  [void][VD]::SetCursorPos($sx + [int]($Dx * $i / 12), $sy + [int]($Dy * $i / 12))
  Start-Sleep -Milliseconds 60
}
Start-Sleep -Milliseconds 350
[VD]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 1500

$after = New-Object VD+RECT
[void][VD]::GetWindowRect($hwnd, [ref]$after)
$gotX = $after.L - $box.L
$gotY = $after.T - $box.T
Write-Output ("wanted {0},{1}  got {2},{3}" -f $Dx, $Dy, $gotX, $gotY)

if (-not $proc.HasExited) { $proc.Kill() }
Remove-Item -LiteralPath $ready -Force -ErrorAction SilentlyContinue

$ok = ([math]::Abs($gotX - $Dx) -le 15) -and ([math]::Abs($gotY - $Dy) -le 15)
if ($ok) { Write-Output 'RESULT: PASS (window followed the mouse)' }
else { Write-Output 'RESULT: FAIL (window did not move)' }