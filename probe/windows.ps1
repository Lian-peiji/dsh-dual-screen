# P0 probe: top-level window enumeration + ownership classification
# Answers: which visible windows exist, who owns them, and which ones are
# "opened by this whale" (ego browser / DSH child console) vs the master's own.
# ASCII-only on purpose: PS 5.1 reads BOM-less .ps1 as ANSI.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class WinProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetWindowTextW")]
  public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetWindowTextLengthW")]
  public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetClassNameW")]
  public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
  public static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
  // DWMWA_CLOAKED = 14 : UWP/Edge hidden windows report cloaked=1 and keep a
  // stale rect (often -32000,-32000 or off-screen). Never move those.
  public static int Cloaked(IntPtr h) {
    int v = 0;
    int hr = DwmGetWindowAttribute(h, 14, out v, 4);
    return (hr == 0) ? v : -1;
  }

  public static List<IntPtr> All() {
    var l = new List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr x) { l.Add(h); return true; }, IntPtr.Zero);
    return l;
  }
  public static string Text(IntPtr h) {
    int n = GetWindowTextLength(h);
    if (n <= 0) return "";
    var sb = new StringBuilder(n + 2);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }
  public static string Cls(IntPtr h) {
    var sb = new StringBuilder(256);
    GetClassName(h, sb, sb.Capacity);
    return sb.ToString();
  }
}
'@

[void][WinProbe]::SetProcessDpiAwarenessContext([IntPtr](-4))
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

# ---- 1. snapshot processes once (cheap, used for name/cmdline/parent) ----
$procs = @{}
foreach ($p in Get-CimInstance Win32_Process) { $procs[[int]$p.ProcessId] = $p }

# Identify the DSH host process(es): the ELECTRON_RUN_AS_NODE child running dsh-desktop-host
$dshPids = @()
foreach ($p in $procs.Values) {
  $cl = [string]$p.CommandLine
  if ($cl -and ($cl -match 'dsh-desktop-host' -or $cl -match 'resources\\app\.asar\\dsh\\')) { $dshPids += [int]$p.ProcessId }
}
# Also any process literally named DeepSeek Harness (electron shell)
$dshShellPids = @()
foreach ($p in $procs.Values) { if ($p.Name -eq 'DeepSeek Harness.exe') { $dshShellPids += [int]$p.ProcessId } }

$egoMarker = 'ego-lite-linux'
$consoleNames = @('cmd.exe','conhost.exe','powershell.exe','pwsh.exe','wt.exe','WindowsTerminal.exe','OpenConsole.exe')
$browserNames = @('msedge.exe','chrome.exe','brave.exe','firefox.exe','opera.exe','vivaldi.exe')

function Get-Chain([int]$pid0, [int]$depth = 6) {
  $chain = @()
  $cur = $pid0
  for ($i = 0; $i -lt $depth -and $cur -gt 0 -and $procs.ContainsKey($cur); $i++) {
    $p = $procs[$cur]
    $chain += "$($p.Name)#$cur"
    $cur = [int]$p.ParentProcessId
  }
  return ,$chain
}
function Test-ReachesDsh([int]$pid0) {
  $cur = $pid0
  for ($i = 0; $i -lt 8 -and $cur -gt 0; $i++) {
    if ($dshPids -contains $cur -or $dshShellPids -contains $cur) { return $true }
    if (-not $procs.ContainsKey($cur)) { return $false }
    $cur = [int]$procs[$cur].ParentProcessId
  }
  return $false
}

# ---- 2. enumerate top-level windows ----
$rows = @()
foreach ($h in [WinProbe]::All()) {
  if (-not [WinProbe]::IsWindowVisible($h)) { continue }
  $pidw = 0
  [void][WinProbe]::GetWindowThreadProcessId($h, [ref]$pidw)
  $pidKey = [int]$pidw
  $title = [WinProbe]::Text($h)
  $cls = [WinProbe]::Cls($h)
  $r = New-Object WinProbe+RECT
  [void][WinProbe]::GetWindowRect($h, [ref]$r)
  $owner = [WinProbe]::GetWindow($h, 4)   # GW_OWNER
  $ex = [int64][WinProbe]::GetWindowLongPtr($h, -20)  # GWL_EXSTYLE
  $p = $null; if ($procs.ContainsKey($pidKey)) { $p = $procs[$pidKey] }
  $name = if ($p) { [string]$p.Name } else { '' }
  $cl = if ($p) { [string]$p.CommandLine } else { '' }

  $kind = 'other'
  $why = ''
  if ($browserNames -contains $name) {
    if ($cl -match [regex]::Escape($egoMarker) -or $cl -match '--class=ego-lite-linux') { $kind = 'ego-browser'; $why = 'cmdline has ego profile/class' }
    else { $kind = 'owner-browser'; $why = 'browser without ego marker' }
  }
  elseif ($name -eq 'DeepSeek Harness.exe') { $kind = 'dsh-main'; $why = 'electron shell' }
  elseif ($consoleNames -contains $name) {
    if (Test-ReachesDsh $pidKey) { $kind = "whale-console"; $why = 'console in DSH process tree' }
    else { $kind = 'owner-console'; $why = 'console not in DSH tree' }
  }
  if ($title -eq '' -and $kind -eq 'other') { $kind = 'untitled' }

  $rows += [pscustomobject][ordered]@{
    hwnd    = ('0x{0:X}' -f $h.ToInt64())
    pid     = $pidKey
    proc    = $name
    kind    = $kind
    why     = $why
    class   = $cls
    title   = $title
    x       = $r.L; y = $r.T; w = ($r.R - $r.L); h = ($r.B - $r.T)
    cloaked = ([WinProbe]::Cloaked($h))
    iconic  = ([WinProbe]::IsIconic($h))
    topmost = (($ex -band 0x8) -ne 0)
    toolwin = (($ex -band 0x80) -ne 0)
    hasOwner= ($owner -ne [IntPtr]::Zero)
    inDshTree = (Test-ReachesDsh $pidKey)
    chain   = (Get-Chain $pidKey 5) -join ' <- '
  }
}

$fg = [WinProbe]::GetForegroundWindow()
$fgPid = 0
[void][WinProbe]::GetWindowThreadProcessId($fg, [ref]$fgPid)
$fgProc = if ($procs.ContainsKey([int]$fgPid)) { [string]$procs[[int]$fgPid].Name } else { '' }

$result = [ordered]@{
  ts          = (Get-Date).ToString('s')
  dshHostPids = $dshPids
  dshShellPids= $dshShellPids
  foreground  = [ordered]@{ hwnd = ('0x{0:X}' -f $fg.ToInt64()); pid = $fgPid; proc = $fgProc; title = [WinProbe]::Text($fg) }
  windowCount = $rows.Count
  byKind      = ($rows | Group-Object kind | ForEach-Object { [ordered]@{ kind = $_.Name; n = $_.Count } })
  windows     = $rows
}

New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'out') | Out-Null
$json = $result | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'out\windows.json'), $json, (New-Object Text.UTF8Encoding($false)))

# console summary (compact)
"DSH host pids: $($dshPids -join ',')  shell pids: $($dshShellPids -join ',')"
"foreground: $fgProc  [$(($result.foreground).title)]"
"windows: $($rows.Count)"
$rows | Group-Object kind | Sort-Object Count -Descending | ForEach-Object { "  {0,-14} {1}" -f $_.Name, $_.Count }
$rows | Where-Object { $_.kind -ne 'untitled' } | Sort-Object kind, proc |
  Format-Table -AutoSize @{n='kind';e={$_.kind}}, @{n='proc';e={$_.proc}}, @{n='pid';e={$_.pid}}, @{n='rect';e={"$($_.x),$($_.y) $($_.w)x$($_.h)"}}, @{n='class';e={$_.class}}, @{n='top';e={$_.topmost}}, @{n='cloak';e={$_.cloaked}}, @{n='dshTree';e={$_.inDshTree}}, @{n='title';e={ if ($_.title.Length -gt 42) { $_.title.Substring(0,42) } else { $_.title } }} |
  Out-String -Width 250