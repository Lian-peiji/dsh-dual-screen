# inject.ps1 -- real mouse input that ACTUALLY lands (dot-source this).
#
# Why not SetCursorPos/mouse_event (what the earlier probes used):
#   Measured 2026-11-06 in this host: SetCursorPos returns False for every point
#   (lastError 203) while SendInput succeeds. mouse_event shares that broken path and
#   fails silently (it returns void). Every "the click never reached the page" test in
#   this repo was therefore clicking at whatever stale position the cursor had --
#   the harness, not the pet, was the problem.
#
# So: SendInput with MOUSEEVENTF_ABSOLUTE|MOUSEEVENTF_MOVE, normalised to the virtual
# desktop. This is the same path a human mouse takes.
#
# ASCII only. Usage:
#   . .\probe\inject.ps1
#   Inject-MoveTo 3960 1672
#   Inject-Click 'right'
#   Inject-Click 'left'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class INJ {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }
}
"@

# Per-monitor DPI aware: SendInput absolute coordinates are then physical pixels.
try { [void][INJ]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { }

$script:INJ_SIZE = [System.Runtime.InteropServices.Marshal]::SizeOf([type][INJ+INPUT])

function script:Invoke-MouseInput([uint32[]]$flags) {
  $n = $flags.Count
  $arr = New-Object 'INJ+INPUT[]' $n
  for ($i = 0; $i -lt $n; $i++) {
    $arr[$i].type = 0            # INPUT_MOUSE
    $arr[$i].mi.dwFlags = $flags[$i]
  }
  $sent = [INJ]::SendInput([uint32]$n, $arr, $script:INJ_SIZE)
  if ($sent -ne $n) { throw ("SendInput sent {0}/{1}" -f $sent, $n) }
}

function Inject-MoveTo([int]$x, [int]$y) {
  # Closed-loop RELATIVE moves.
  #
  # Absolute normalisation was tried first and landed at 1026,306 for a requested
  # 3960,1672: on this 2-monitor layout (1600x2560 portrait at 1.5x next to a
  # 2560x1440 at 1.0x) the normalised coordinates do not survive DPI virtualisation,
  # whatever awareness context is set. Relative moves plus a GetCursorPos feedback
  # loop cannot be wrong by construction, so that is what this does.
  $maxSteps = 40
  $p = New-Object INJ+POINT
  for ($step = 0; $step -lt $maxSteps; $step++) {
    [void][INJ]::GetCursorPos([ref]$p)
    $dx = $x - $p.X
    $dy = $y - $p.Y
    if ([math]::Abs($dx) -le 1 -and [math]::Abs($dy) -le 1) { break }
    # Feed a fraction of the remaining distance so pointer acceleration cannot
    # overshoot; the loop closes the gap anyway.
    $mx = [int][math]::Round($dx / 2.0)
    $my = [int][math]::Round($dy / 2.0)
    if ($mx -eq 0) { $mx = [int][math]::Sign($dx) }
    if ($my -eq 0) { $my = [int][math]::Sign($dy) }
    $arr = New-Object 'INJ+INPUT[]' 1
    $arr[0].type = 0
    $arr[0].mi.dx = $mx
    $arr[0].mi.dy = $my
    $arr[0].mi.dwFlags = 0x0001     # MOUSEEVENTF_MOVE (relative)
    $sent = [INJ]::SendInput(1, $arr, $script:INJ_SIZE)
    if ($sent -ne 1) { throw 'SendInput move failed' }
    Start-Sleep -Milliseconds 12
  }
  [void][INJ]::GetCursorPos([ref]$p)
  return $p
}

function Inject-Button([string]$button, [string]$phase) {
  # phase: down | up
  $map = @{
    'left'  = @{ down = 0x0002; up = 0x0004 }
    'right' = @{ down = 0x0008; up = 0x0010 }
    'mid'   = @{ down = 0x0020; up = 0x0040 }
  }
  $f = $map[$button][$phase]
  if (-not $f) { throw "unknown button/phase $button/$phase" }
  Invoke-MouseInput @([uint32]$f)
}

function Inject-Click([string]$button = 'left', [int]$holdMs = 90) {
  Inject-Button $button 'down'
  Start-Sleep -Milliseconds $holdMs
  Inject-Button $button 'up'
}

function Inject-Point([int]$x, [int]$y) {
  $p = Inject-MoveTo $x $y
  return $p
}