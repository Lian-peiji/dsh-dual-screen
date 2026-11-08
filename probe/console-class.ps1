# probe/console-class.ps1 -- which window class does each way of spawning a
# console produce on this machine, and who owns the window?
# A: cmd.exe directly            (goes through the Win11 default terminal)
# B: conhost.exe cmd.exe ...     (classic console host, hopefully own window)
# C: conhost.exe -- cmd.exe ...
# ASCII-only.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class CC {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetWindowTextW")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetClassNameW")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  public static List<IntPtr> All() { var l = new List<IntPtr>(); EnumWindows(delegate(IntPtr h, IntPtr x) { l.Add(h); return true; }, IntPtr.Zero); return l; }
  public static string T(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  public static string C(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
}
'@
[void][CC]::SetProcessDpiAwarenessContext([IntPtr](-4))

function Show-Marker([string]$marker, [string]$label) {
  $found = $false
  foreach ($h in [CC]::All()) {
    if (-not [CC]::IsWindowVisible($h)) { continue }
    $t = [CC]::T($h)
    if ($t -notlike "*$marker*") { continue }
    $found = $true
    $pidw = 0; [void][CC]::GetWindowThreadProcessId($h, [ref]$pidw)
    $r = New-Object CC+RECT; [void][CC]::GetWindowRect($h, [ref]$r)
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$pidw" -ErrorAction SilentlyContinue
    $cls = [CC]::C($h)
    $chain = @()
    $cur = [int]$pidw
    for ($i = 0; $i -lt 4 -and $cur -gt 0; $i++) {
      $q = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
      if (-not $q) { break }
      $chain += "$($q.Name)#$cur"
      $cur = [int]$q.ParentProcessId
    }
    "  [$label] class=$cls  proc=$($p.Name)#$pidw  rect=$($r.L),$($r.T) $(($r.R-$r.L))x$(($r.B-$r.T))"
    "           title='$t'  chain=$($chain -join ' <- ')"
  }
  if (-not $found) { "  [$label] (no window with marker '$marker' found)" }
}

# A: plain cmd (default terminal)
$pa = Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'title WRK-A-PLAIN' -PassThru -WindowStyle Normal
Start-Sleep -Milliseconds 1500
Show-Marker 'WRK-A-PLAIN' 'A plain cmd'
Stop-Process -Id $pa.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

# B: conhost-hosted cmd
$sys = Join-Path $env:SystemRoot 'System32'
$pb = Start-Process -FilePath (Join-Path $sys 'conhost.exe') -ArgumentList 'cmd.exe', '/k', 'title WRK-B-CONHOST' -PassThru -WindowStyle Normal -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 1800
Show-Marker 'WRK-B-CONHOST' 'B conhost cmd'
if ($pb) { Stop-Process -Id $pb.Id -Force -ErrorAction SilentlyContinue }
Get-Process cmd -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*WRK-B*' } | Stop-Process -Force -ErrorAction SilentlyContinue

# report the desktop's terminal window classes for reference
'--- all visible windows with console-ish classes:'
foreach ($h in [CC]::All()) {
  if (-not [CC]::IsWindowVisible($h)) { continue }
  $cls = [CC]::C($h)
  if ($cls -notmatch 'Console|CASCADIA|PseudoConsole') { continue }
  $pidw = 0; [void][CC]::GetWindowThreadProcessId($h, [ref]$pidw)
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$pidw" -ErrorAction SilentlyContinue
  "  class=$cls proc=$($p.Name)#$pidw title='$([CC]::T($h))'"
}