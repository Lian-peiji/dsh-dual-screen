# run-on-secondary.ps1 -- start a program so its window appears on the SECOND screen.
# ASCII-only on purpose: PS 5.1 reads BOM-less .ps1 as ANSI.
#
# WHY (2026-11-06, revised after real-machine test):
#   Attempt #1 used CreateProcess + STARTUPINFO dwX/dwY, assuming the console window is
#   created by the console subsystem at the requested spot. That is wrong on this machine:
#   the default console host is the modern ConPTY one, which has NO per-console window --
#   the window belongs to the terminal app, so dwX/dwY are ignored and every console we
#   started piled up on the PRIMARY screen (owner complaint, 2026-11-06 22:06).
#   Verified: a console spawned with STARTF_USEPOSITION shows no ConsoleWindowClass window
#   at all; the visible window belongs to WindowsTerminal.exe.
#   So for console programs we now ask Windows Terminal itself to open a NEW window at the
#   requested position (`wt -w new --pos x,y`), which places it on the secondary at creation.
#   For plain GUI programs we still try CreateProcess + STARTUPINFO and then verify/correct
#   the window position, because some GUI apps do honour it.
#
# NOTE: the argument parameter must NOT be called $Args -- $Args is a PowerShell automatic
#       variable, and the bind silently loses its value (child got 'cmd.exe' with no args).
param(
  [string]$Command = 'cmd.exe',
  [Alias('args')][string]$CommandArgs = '/k',
  [switch]$Show,
  [switch]$Hide,
  [ValidateSet('', 'auto', 'terminal', 'process')][string]$Via = 'auto'
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class Launch2 {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO {
    public int cb;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpReserved;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpDesktop;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2;
    public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  // lpCommandLine MUST be writable: CreateProcessW modifies it in place.
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CreateProcessW(string app, System.Text.StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit,
    uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  public delegate bool EnumProc(IntPtr h, IntPtr p);

  public static int Spawn(string app, string cmd, int x, int y, int w, int h, short show) {
    var si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    si.dwFlags = 0x0001 | 0x0002 | 0x0004;   // STARTF_USESHOWWINDOW | USESIZE | USEPOSITION
    si.dwX = x; si.dwY = y; si.dwXSize = w; si.dwYSize = h;
    si.wShowWindow = show;
    PROCESS_INFORMATION pi;
    var sb = new System.Text.StringBuilder(cmd);
    bool ok = CreateProcessW(app, sb, IntPtr.Zero, IntPtr.Zero, false, 0x00000010, IntPtr.Zero, null, ref si, out pi);  // CREATE_NEW_CONSOLE
    if (!ok) return -Marshal.GetLastWin32Error();
    return pi.dwProcessId;
  }

  // Visible top-level windows of the given class, newest first is not available; caller filters.
  public static List<string> Windows(string cls) {
    var rows = new List<string>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var c = new StringBuilder(256); GetClassNameW(h, c, 256);
      if (c.ToString() != cls) return true;
      RECT r; GetWindowRect(h, out r);
      uint pid; GetWindowThreadProcessId(h, out pid);
      rows.Add(h.ToInt64() + "," + pid + "," + r.L + "," + r.T + "," + (r.R - r.L) + "," + (r.B - r.T));
      return true;
    }, IntPtr.Zero);
    return rows;
  }
}
'@
[void][Launch2]::SetProcessDpiAwarenessContext([IntPtr](-4))

# ---- target screen -----------------------------------------------------------
$screens = [System.Windows.Forms.Screen]::AllScreens
$target = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1
if (-not $target) { $target = $screens | Where-Object { $_.Primary } | Select-Object -First 1 }
$wa = $target.WorkingArea
$margin = 24
$x = $wa.X + $margin
$y = $wa.Y + $margin
$w = [int](($wa.Width - 2 * $margin) * 0.62)
$h = [int](($wa.Height - 2 * $margin) * 0.5)
if ($w -lt 600) { $w = [Math]::Min(900, $wa.Width - 2 * $margin) }
if ($h -lt 400) { $h = [Math]::Min(700, $wa.Height - 2 * $margin) }
if ($w -gt 1200) { $w = 1200 }
$mode = 'minimized'
if ($Show) { $mode = 'show' }
if ($Hide) { $mode = 'hidden' }

function Emit([string]$json) { Write-Output $json }

# ---- hidden: no window wanted at all, plain CreateProcess ---------------------
if ($mode -eq 'hidden') {
  $exePath = $Command
  if ($Command -notmatch '[\\/]') {
    $c = Get-Command $Command -ErrorAction SilentlyContinue
    if ($c -and $c.Source) { $exePath = $c.Source }
    elseif ($Command -ieq 'cmd.exe') { $exePath = $env:ComSpec }
  }
  $pid2 = [Launch2]::Spawn($exePath, ('"' + $Command + '" ' + $CommandArgs), $x, $y, $w, $h, [int16]0)
  if ($pid2 -lt 0) { Emit ('{"ok":false,"error":"CreateProcess failed: ' + $pid2 + '"}'); exit 1 }
  $devName = $target.DeviceName.Replace('\', '\\')
  Emit ('{ "ok": true, "pid": ' + $pid2 + ', "via": "process", "screen": "' + $devName + '", "rect": [' + $x + ',' + $y + ',' + $w + ',' + $h + '], "show": 0, "mode": "hidden" }')
  exit 0
}

# ---- console programs: let Windows Terminal open a new window at --pos -------
$consoleNames = @('cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe', 'node', 'node.exe', 'npm', 'npm.cmd', 'python', 'python.exe', 'wsl', 'wsl.exe', 'bash', 'bash.exe')
$base = [System.IO.Path]::GetFileName($Command)
$useTerminal = $Via -eq 'terminal' -or ($Via -eq 'auto' -and ($consoleNames -contains $base.ToLower()))
$wt = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\wt.exe'

if ($useTerminal -and (Test-Path $wt)) {
  $before = @{}
  foreach ($row in [Launch2]::Windows('CASCADIA_HOSTING_WINDOW_CLASS')) { $before[$row.Split(',')[0]] = $true }
  $fg = [Launch2]::GetForegroundWindow()

  $wtArgs = @('-w', 'new', '--pos', ("$x,$y"), $Command)
  if ($CommandArgs) { $wtArgs += $CommandArgs }
  $proc = Start-Process -FilePath $wt -ArgumentList ($wtArgs -join ' ') -PassThru
  $hwnd = [IntPtr]::Zero
  $rect = $null
  $deadline = (Get-Date).AddSeconds(4)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 150
    foreach ($row in [Launch2]::Windows('CASCADIA_HOSTING_WINDOW_CLASS')) {
      $f = $row.Split(',')
      if ($before.ContainsKey($f[0])) { continue }
      $hwnd = [IntPtr][int64]$f[0]
      $rect = @([int]$f[2], [int]$f[3], [int]$f[4], [int]$f[5])
      break
    }
    if ($hwnd -ne [IntPtr]::Zero) { break }
  }

  if ($hwnd -ne [IntPtr]::Zero) {
    # never leave it on the primary: if it opened there, slide it to the secondary
    if ($rect[0] -lt $wa.X - 8) {
      [void][Launch2]::SetWindowPos($hwnd, [IntPtr]::Zero, $x, $y, 0, 0, 0x0001 -bor 0x0004)  # NOSIZE|NOZORDER
    }
    # and never let it hang off the right/bottom edge of a portrait secondary
    if ($rect[2] -gt ($wa.Width - 2 * $margin) -or $rect[3] -gt ($wa.Height - 2 * $margin)) {
      [void][Launch2]::SetWindowPos($hwnd, [IntPtr]::Zero, $x, $y, $w, $h, 0x0004)
    }
    Start-Sleep -Milliseconds 120
    $r2 = New-Object Launch2+RECT
    if ([Launch2]::GetWindowRect($hwnd, [ref]$r2)) { $rect = @($r2.L, $r2.T, ($r2.R - $r2.L), ($r2.B - $r2.T)) }
    if ($mode -eq 'minimized') { [void][Launch2]::ShowWindow($hwnd, 6) }   # SW_MINIMIZE
    if ($fg -ne [IntPtr]::Zero) { [void][Launch2]::SetForegroundWindow($fg) }
    $owner = [uint32]0
    [void][Launch2]::GetWindowThreadProcessId($hwnd, [ref]$owner)
    $devName = $target.DeviceName.Replace('\', '\\')
    $showCode = 6
    if ($mode -eq 'show') { $showCode = 4 }
    Emit ('{ "ok": true, "pid": ' + [int64]$owner + ', "hwnd": ' + $hwnd.ToInt64() + ', "via": "terminal", "screen": "' + $devName + '", "rect": [' + ($rect -join ',') + '], "show": ' + $showCode + ', "mode": "' + $mode + '" }')
    exit 0
  }

  # terminal did not produce a window: fall through to the process path
  try { if ($proc -and -not $proc.HasExited) { $proc.Kill() } } catch {}
}

# ---- GUI / fallback: CreateProcess with STARTUPINFO, then verify and correct ---
$exePath2 = $Command
if ($Command -notmatch '[\\/]') {
  $c = Get-Command $Command -ErrorAction SilentlyContinue
  if ($c -and $c.Source) { $exePath2 = $c.Source }
  elseif ($Command -ieq 'cmd.exe') { $exePath2 = $env:ComSpec }
}
$showMode = 7        # SW_SHOWMINNOACTIVE
if ($mode -eq 'show') { $showMode = 4 }
$pid3 = [Launch2]::Spawn($exePath2, ('"' + $Command + '" ' + $CommandArgs), $x, $y, $w, $h, [int16]$showMode)
if ($pid3 -lt 0) { Emit ('{"ok":false,"error":"CreateProcess failed: ' + $pid3 + '"}'); exit 1 }

# wait briefly for a real top-level window of that process, then make sure it is on the secondary
$found = [IntPtr]::Zero
$frect = @($x, $y, $w, $h)
$deadline2 = (Get-Date).AddSeconds(3)
while ((Get-Date) -lt $deadline2) {
  Start-Sleep -Milliseconds 200
  $p = Get-Process -Id $pid3 -ErrorAction SilentlyContinue
  if (-not $p) { break }
  $p.Refresh()
  if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
    $found = $p.MainWindowHandle
    $r3 = New-Object Launch2+RECT
    if ([Launch2]::GetWindowRect($found, [ref]$r3)) { $frect = @($r3.L, $r3.T, ($r3.R - $r3.L), ($r3.B - $r3.T)) }
    break
  }
}
if ($found -ne [IntPtr]::Zero) {
  if ($frect[0] -lt $wa.X - 8) {
    [void][Launch2]::SetWindowPos($found, [IntPtr]::Zero, $x, $y, 0, 0, 0x0001 -bor 0x0004)
    Start-Sleep -Milliseconds 120
    $r4 = New-Object Launch2+RECT
    if ([Launch2]::GetWindowRect($found, [ref]$r4)) { $frect = @($r4.L, $r4.T, ($r4.R - $r4.L), ($r4.B - $r4.T)) }
  }
}
$devName2 = $target.DeviceName.Replace('\', '\\')
$hwndJson = '0'; if ($found -ne [IntPtr]::Zero) { $hwndJson = $found.ToInt64() }
Emit ('{ "ok": true, "pid": ' + $pid3 + ', "hwnd": ' + $hwndJson + ', "via": "process", "screen": "' + $devName2 + '", "rect": [' + ($frect -join ',') + '], "show": ' + $showMode + ', "mode": "' + $mode + '" }')
