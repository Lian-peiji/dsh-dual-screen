# window-bridge.ps1 -- dsh-dual-screen P1 window mover (long running, ASCII only)
#
# Reads nothing from stdin. Writes ONE JSON object per line to stdout, then
# flushes, so lib/windows.js can parse it with a line reader.
#
# Rules (P0-measured, owner-approved plan amendments):
#   ego-browser : msedge/chrome/brave/... whose command line carries the ego
#                 profile marker (--user-data-dir=...ego-lite-linux or
#                 --class=ego-lite-linux). Parent chain is NOT usable: the ego
#                 browser process is orphaned (its parent is already gone).
#   console     : window class ConsoleWindowClass AND the window's own process
#                 is in the DSH process tree AND it started after this bridge
#                 started. `conhost.exe cmd.exe /k ...` produces exactly this.
#   NOT console : class CASCADIA_HOSTING_WINDOW_CLASS. Windows Terminal is a
#                 singleton reparented to svchost, so a window cannot be
#                 attributed; moving it would drag the owner's own tabs along.
#                 Logged as skipped, never moved.
#
# Never touched: DSH main window, parked windows (-32000,-32000 / off every
# monitor), cloaked windows (DWM), tiny windows, anything already on the
# secondary screen, and anything moved once before (manual drag wins).
#
# Cross-DPI: a single SetWindowPos across a 100%->150% boundary lands the
# position but returns a size scaled by the DPI ratio (Chromium re-applies its
# own rect on WM_DPICHANGED). So every move is done twice, dpiSettleMs apart.
#
# ASCII-only on purpose: PowerShell 5.1 decodes a BOM-less .ps1 as ANSI and a
# GBK mis-decode eats the ASCII char after a CJK char, breaking the parse.
param(
  [string]$DataDir = 'E:\dsh\dual-screen',
  [int]$DpiSettleMs = 250,
  [string]$EgoMarker = 'ego-lite-linux',
  [int]$MinWidth = 300,
  [int]$MinHeight = 180,
  [int]$MinBrowserWidth = 600,
  [int]$MinBrowserHeight = 400,
  [int]$ProcCacheMs = 2000,
  [switch]$DryRun,
  [switch]$SelfTest,
  [int]$SelfTestWaitMs = 0
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$inv = [System.Globalization.CultureInfo]::InvariantCulture

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class WBridge {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] public struct MSG {
    public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam;
    public uint time; public POINT pt;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFOEX {
    public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
  }
  public delegate void WinEventDelegate(IntPtr hHook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  public delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, ref RECT rc, IntPtr data);

  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr hmod, WinEventDelegate cb, uint pid, uint tid, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr hwnd, uint min, uint max, uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetWindowTextW")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetClassNameW")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfoW(IntPtr hMon, ref MONITORINFOEX mi);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int val, int size);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);

  static WinEventDelegate _del;
  static IntPtr _hook = IntPtr.Zero;
  static WinEventDelegate _delCreate;
  static IntPtr _hookCreate = IntPtr.Zero;
  public static ConcurrentQueue<long> Hits = new ConcurrentQueue<long>();
  // CREATE fires before the window is ever painted. Moving the window HERE is
  // what makes the delivery invisible: by the time Windows shows it, it is
  // already sitting on the second screen.
  public static ConcurrentQueue<long> Creates = new ConcurrentQueue<long>();

  public static bool StartHook() {
    _del = new WinEventDelegate(OnEvent);
    // EVENT_OBJECT_SHOW = 0x8002 ; WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
    _hook = SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, _del, 0, 0, 0x0000 | 0x0002);
    _delCreate = new WinEventDelegate(OnCreate);
    // EVENT_OBJECT_CREATE = 0x8000
    _hookCreate = SetWinEventHook(0x8000, 0x8000, IntPtr.Zero, _delCreate, 0, 0, 0x0000 | 0x0002);
    return _hook != IntPtr.Zero;
  }
  public static void StopHook() {
    if (_hook != IntPtr.Zero) { UnhookWinEvent(_hook); _hook = IntPtr.Zero; }
    if (_hookCreate != IntPtr.Zero) { UnhookWinEvent(_hookCreate); _hookCreate = IntPtr.Zero; }
  }
  static void OnEvent(IntPtr hHook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time) {
    if (hwnd == IntPtr.Zero) return;
    if (idObject != 0 || idChild != 0) return;   // OBJID_WINDOW only
    Hits.Enqueue(hwnd.ToInt64());
  }
  static void OnCreate(IntPtr hHook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time) {
    if (hwnd == IntPtr.Zero) return;
    if (idObject != 0 || idChild != 0) return;
    Creates.Enqueue(hwnd.ToInt64());
  }
  public static int Pump(int ms) {
    var sw = Stopwatch.StartNew(); int n = 0;
    while (sw.ElapsedMilliseconds < ms) {
      MSG m;
      if (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref m); DispatchMessage(ref m); n++; }
      else System.Threading.Thread.Sleep(5);
    }
    return n;
  }
  public static void SetDpiAware() { try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch {} }
  public static string Text(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, sb.Capacity); return sb.ToString(); }
  public static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, sb.Capacity); return sb.ToString(); }
  // DWMWA_CLOAK (13): the window stops being composited while remaining a
  // normal window -- no ShowWindow games, so a window that was going to stay
  // hidden stays hidden and never flashes on the primary.
  public static void Cloak(IntPtr h, bool on) { int v = on ? 1 : 0; try { DwmSetWindowAttribute(h, 13, ref v, 4); } catch {} }
  // WS_EX_NOACTIVATE: the new window must never take the keyboard away from the
  // owner's DSH window. Cleared later so the console can still be typed into.
  public static void NoActivate(IntPtr h, bool on) {
    int ex = GetWindowLong(h, -20);
    if (on) ex |= 0x08000000; else ex &= ~0x08000000;
    SetWindowLong(h, -20, ex);
  }
  public static int Cloaked(IntPtr h) { int v = 0; int hr = DwmGetWindowAttribute(h, 14, out v, 4); return (hr == 0) ? v : -1; }
  public static RECT Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return r; }
  public static IntPtr Foreground() { return GetForegroundWindow(); }
  public static List<IntPtr> Windows() { var l = new List<IntPtr>(); EnumWindows(delegate(IntPtr h, IntPtr x) { l.Add(h); return true; }, IntPtr.Zero); return l; }
  public static List<MONITORINFOEX> Monitors() {
    var l = new List<MONITORINFOEX>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr h, IntPtr hdc, ref RECT rc, IntPtr d) {
      var mi = new MONITORINFOEX(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
      GetMonitorInfoW(h, ref mi); l.Add(mi); return true;
    }, IntPtr.Zero);
    return l;
  }
  public static bool IsMinimized(IntPtr h) { return IsIconic(h); }
  public static bool Move(IntPtr h, int x, int y, int cx, int cy) {
    // SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOZORDER : never steal focus, never re-order
    return SetWindowPos(h, IntPtr.Zero, x, y, cx, cy, 0x0010 | 0x0040 | 0x0004);
  }
  // Position only (SWP_NOSIZE): used at EVENT_OBJECT_CREATE, where the window
  // has not been sized/arranged yet -- resizing there would fight conhost.
  public static bool MovePos(IntPtr h, int x, int y) {
    return SetWindowPos(h, IntPtr.Zero, x, y, 0, 0, 0x0001 | 0x0010 | 0x0004);
  }
  public static long NowMs() { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }
}
'@

[void][WBridge]::SetDpiAware()

# ------------------------------------------------------------------ config ---
function Read-Config {
  $cfg = $null
  try {
    $p = Join-Path $DataDir 'config.json'
    if (Test-Path -LiteralPath $p) { $cfg = Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json }
  } catch {}
  $d = [ordered]@{
    enabled       = $true
    browser       = $true
    console       = $true
    respectDrag   = $true
    onlyAfter     = $true
    marginPx      = 24
    extraProcs    = @()
    dpiSettleMs   = $DpiSettleMs
    # E mode: after delivering, keep the window minimised on the second screen so
    # it neither covers the panel nor takes the owner's attention. 0 = disabled.
    minimizeAfterMove = $true
    # Width reserved on the right for the avatar panel, in PHYSICAL px. 0 = no reserve.
    reserveRightPx = 624
  }
  if ($cfg) {
    if ($null -ne $cfg.enabled) { $d.enabled = [bool]$cfg.enabled }
    if ($cfg.moveWindows) {
      if ($null -ne $cfg.moveWindows.enabled) { $d.enabled = [bool]$cfg.moveWindows.enabled }
      if ($null -ne $cfg.moveWindows.respectManualDrag) { $d.respectDrag = [bool]$cfg.moveWindows.respectManualDrag }
      if ($null -ne $cfg.moveWindows.onlyAfterStart) { $d.onlyAfter = [bool]$cfg.moveWindows.onlyAfterStart }
      if ($null -ne $cfg.moveWindows.dpiSettleMs) { $d.dpiSettleMs = [int]$cfg.moveWindows.dpiSettleMs }
      if ($null -ne $cfg.moveWindows.reserveRightPx) { $d.reserveRightPx = [int]$cfg.moveWindows.reserveRightPx }
      if ($null -ne $cfg.moveWindows.minimizeAfterMove) { $d.minimizeAfterMove = [bool]$cfg.moveWindows.minimizeAfterMove }
    }
    if ($cfg.rules) {
      if ($null -ne $cfg.rules.browser) { $d.browser = [bool]$cfg.rules.browser }
      if ($null -ne $cfg.rules.console) { $d.console = [bool]$cfg.rules.console }
      if ($cfg.rules.extraProcesses) { $d.extraProcs = @($cfg.rules.extraProcesses) }
    }
    if ($cfg.panel -and $null -ne $cfg.panel.marginPx) { $d.marginPx = [int]$cfg.panel.marginPx }
  }
  return [pscustomobject]$d
}

# ------------------------------------------------------------- output lines ---
$script:outLock = New-Object object
function Emit([hashtable]$obj) {
  $obj.ts = [WBridge]::NowMs()
  $line = ($obj | ConvertTo-Json -Compress -Depth 6)
  [System.Threading.Monitor]::Enter($script:outLock)
  try { [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
  finally { [System.Threading.Monitor]::Exit($script:outLock) }
}

# ------------------------------------------------------------- process info ---
$script:procCache = @{}
function Get-Proc([int]$procId) {
  $now = [WBridge]::NowMs()
  $c = $script:procCache[$procId]
  if ($c -and ($now - $c.at) -lt $ProcCacheMs) { return $c }
  $p = $null
  try { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue } catch {}
  if (-not $p) {
    $c = [pscustomobject]@{ name = ''; cmd = ''; parent = 0; startMs = 0; at = $now }
  } else {
    $startMs = 0
    try { $startMs = ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() } catch {}
    $c = [pscustomobject]@{ name = [string]$p.Name; cmd = [string]$p.CommandLine; parent = [int]$p.ParentProcessId; startMs = $startMs; at = $now }
  }
  $script:procCache[$procId] = $c
  return $c
}

$script:dshPids = New-Object System.Collections.Generic.HashSet[int]
function Refresh-DshPids {
  $script:dshPids.Clear()
  try {
    foreach ($p in Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='DeepSeek Harness.exe'" -ErrorAction SilentlyContinue) {
      $cl = [string]$p.CommandLine
      if (-not $cl) { continue }
      if ($cl -match 'dsh-desktop-host' -or $cl -match 'resources\\app\.asar\\dsh\\' -or $p.Name -eq 'DeepSeek Harness.exe') {
        [void]$script:dshPids.Add([int]$p.ProcessId)
      }
    }
  } catch {}
}

function Test-InDshTree([int]$procId) {
  $cur = $procId
  for ($i = 0; $i -lt 8 -and $cur -gt 0; $i++) {
    if ($script:dshPids.Contains($cur)) { return $true }
    $p = Get-Proc $cur
    if (-not $p.name) { return $false }
    if ($p.name -eq 'DeepSeek Harness.exe') { return $true }
    $cur = $p.parent
  }
  return $false
}

# ------------------------------------------------------------- monitors ------
$script:secondary = $null
function Refresh-Monitors {
  $mons = [WBridge]::Monitors()
  $sec = $null
  foreach ($m in $mons) {
    if (($m.dwFlags -band 1) -eq 0) { $sec = $m; break }
  }
  $script:secondary = $sec
  return $mons
}
function Get-WorkRect {
  $m = $script:secondary
  if (-not $m) { return $null }
  return [pscustomobject]@{ x = $m.rcWork.L; y = $m.rcWork.T; w = ($m.rcWork.R - $m.rcWork.L); h = ($m.rcWork.B - $m.rcWork.T) }
}
function Test-OnSecondary([int]$x, [int]$y, [int]$w, [int]$h) {
  $wr = Get-WorkRect
  if (-not $wr) { return $false }
  $cx = $x + [int]($w / 2); $cy = $y + [int]($h / 2)
  return ($cx -ge $wr.x -and $cx -lt ($wr.x + $wr.w) -and $cy -ge $wr.y -and $cy -lt ($wr.y + $wr.h))
}

# ------------------------------------------------------------- classify ------
$script:browserNames = @('msedge.exe', 'chrome.exe', 'brave.exe', 'vivaldi.exe', 'opera.exe', 'firefox.exe')
$script:consoleNames = @('cmd.exe', 'powershell.exe', 'pwsh.exe', 'conhost.exe', 'OpenConsole.exe', 'bash.exe', 'wsl.exe', 'python.exe')
$script:excludedClasses = @('Progman', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'WorkerW', 'Windows.UI.Core.CoreWindow',
  'ApplicationFrameWindow', 'CEF-OSC-WIDGET', 'Qt51514QWindowIcon', 'TaskListThumbnailWnd')
$script:skipOnce = @{}    # hwnd -> reason, avoids log spam for the same window

# Windows belonging to the restart guard itself. Even after the 2026-11-05 fix
# (wscript shim => the task no longer allocates a console at all) this stays as
# a guard: dragging the guard's own transient console to the second screen
# would look like a bug, and moving it could disturb the restart choreography.
# Owner's rule: restarting DSH must be invisible.
$script:guardMarkers = @('dsh-restart-guard', 'hidden-launch.vbs', 'DSH-Restart-Guard')

function Get-Verdict([IntPtr]$hwnd) {
  $cls = [WBridge]::Cls($hwnd)
  $title = [WBridge]::Text($hwnd)
  $procId = 0
  [void][WBridge]::GetWindowThreadProcessId($hwnd, [ref]$procId)
  $r = [WBridge]::Rect($hwnd)
  $w = $r.R - $r.L; $h = $r.B - $r.T

  $info = [pscustomobject]@{
    hwnd = ('0x{0:X}' -f $hwnd.ToInt64()); pid = [int]$procId; proc = ''; class = $cls; title = $title
    rect = @($r.L, $r.T, $w, $h); kind = 'none'; reason = ''; cloaked = 0
  }
  if (-not [WBridge]::IsWindowVisible($hwnd)) { $info.reason = 'not-visible'; return $info }
  $info.cloaked = [WBridge]::Cloaked($hwnd)
  if ($info.cloaked -ne 0) { $info.reason = 'cloaked'; return $info }
  if ($script:excludedClasses -contains $cls) { $info.reason = 'excluded-class'; return $info }
  if ($w -lt $MinWidth -or $h -lt $MinHeight) { $info.reason = 'too-small'; return $info }
  if ($r.L -le -30000 -or $r.T -le -30000) { $info.reason = 'parked'; return $info }
  if ($title -eq '') { $info.reason = 'untitled'; return $info }

  $p = Get-Proc $procId
  $info.proc = $p.name
  if ($p.name -eq 'DeepSeek Harness.exe') { $info.reason = 'dsh-main-window'; return $info }
  if ($p.cmd) {
    foreach ($marker in $script:guardMarkers) {
      if ($p.cmd.Contains($marker)) { $info.reason = 'restart-guard-window'; return $info }
    }
  }
  # A window we already nudged at CREATE time is expected to sit on the second
  # screen by now -- that is success, not "already there". Still run the full
  # move+resize (the CREATE nudge was position-only) and report it.
  if ((-not $script:preMoved.Contains([string]$info.hwnd)) -and (Test-OnSecondary $r.L $r.T $w $h)) { $info.reason = 'already-on-secondary'; return $info }

  $cfg = $script:cfg
  $egoOk = $p.cmd -and ($p.cmd.Contains($EgoMarker) -or $p.cmd -match '--class=ego-lite-linux')
  if ($cfg.browser -and ($script:browserNames -contains $p.name) -and $egoOk) {
    # A browser "window" smaller than this is a helper bubble (Edge translate /
    # lens / OCR popup) that belongs to the page, not a window worth moving.
    if ($w -lt $MinBrowserWidth -or $h -lt $MinBrowserHeight) { $info.reason = 'browser-helper-popup'; return $info }
    $info.kind = 'ego-browser'; return $info
  }
  if ($cfg.console -and $cls -eq 'ConsoleWindowClass' -and (Test-InDshTree $procId)) {
    if ((-not $cfg.onlyAfter) -or $p.startMs -ge $script:startedAtMs) { $info.kind = 'console'; return $info }
    $info.reason = 'started-before-bridge'; return $info
  }
  if ($cls -eq 'CASCADIA_HOSTING_WINDOW_CLASS') { $info.reason = 'windows-terminal-singleton'; return $info }
  if ($cfg.extraProcs -contains $p.name -and (Test-InDshTree $procId)) { $info.kind = 'extra'; return $info }
  $info.reason = 'no-rule'
  return $info
}

# ------------------------------------------------- pre-move (invisible) ------
# Runs on EVENT_OBJECT_CREATE: the window exists but has NOT been painted yet, so
# nudging it here is what makes delivery feel invisible. Only console
# windows inside the DSH tree are touched, and only their POSITION (the window is
# not sized yet -- resizing now would fight conhost). The later SHOW handler does
# the full move+resize and emits the row the panel timeline shows.
function Pre-MoveWindow([IntPtr]$hwnd) {
  try {
    $cls = [WBridge]::Cls($hwnd)
    $isConsole = ($cls -eq 'ConsoleWindowClass')
    $isBrowser = ($cls -eq 'Chrome_WidgetWin_1' -or $cls -eq 'MozillaWindowClass')
    if (-not ($isConsole -or $isBrowser)) { return }
    $procId = 0
    [void][WBridge]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    $p = Get-Proc ([int]$procId)
    if (-not $p) { return }
    $inTree = Test-InDshTree $procId
    if ($isBrowser) {
      # Browser rule: the ego marker is the proof. Do NOT require the DSH process
      # tree here -- the ego runtime exits right after handing the browser off
      # (or after a plugin reload), leaving msedge orphaned, and requiring the tree
      # silently skipped every agent-browser window (2026-11-06: window flashed on
      # the primary and was never pre-moved). The marker is also exactly what keeps
      # the owner's own Edge/Chrome untouched.
      if (-not $script:cfg.browser) { return }
      $egoOk = $p.cmd -and ($p.cmd.Contains($EgoMarker) -or $p.cmd -match '--class=ego-lite-linux')
      if (-not $egoOk) { return }
    } else {
      if (-not $inTree) { return }
      if (-not $script:cfg.console) { return }
      if ($script:cfg.onlyAfter -and $p.startMs -lt $script:startedAtMs) { return }
    }
    $wr = Get-WorkRect
    if (-not $wr) { return }
    $margin = $script:cfg.marginPx
    $tx = $wr.x + $margin
    $ty = $wr.y + $margin
    $key = ('0x{0:X}' -f $hwnd.ToInt64())
    # Cloak first (nothing painted yet), then move, then block activation. Order matters.
    [WBridge]::Cloak($hwnd, $true)
    [void][WBridge]::MovePos($hwnd, $tx, $ty)
    [WBridge]::NoActivate($hwnd, $true)
    $script:stealth[$key] = @{ at = [WBridge]::NowMs(); hwnd = $hwnd }
    [void]$script:preMoved.Add(('0x{0:X}' -f $hwnd.ToInt64()))
    Emit @{ type = 'pre-move'; stage = 'create'; proc = (Get-Proc ([int]$procId)).name; pid = [int]$procId
      hwnd = ('0x{0:X}' -f $hwnd.ToInt64()); to = @($tx, $ty) }
  } catch {
    Emit @{ type = 'error'; where = 'pre-move'; message = "$($_.Exception.Message)" }
  }
}

# ------------------------------------------------------------- move ----------
function Invoke-Move([IntPtr]$hwnd, [array]$rect) {
  $wr = Get-WorkRect
  if (-not $wr) { return [pscustomobject]@{ ok = $false; why = 'no-secondary' } }
  $margin = $script:cfg.marginPx
  # Reserve the right side for the panel: a 1490-wide console covered it whole (shot 2026-11-06).
  $reserve = [int]$script:cfg.reserveRightPx
  $availW = $wr.w - 2 * $margin - $reserve
  if ($reserve -le 0 -or $availW -lt 400) { $availW = $wr.w - 2 * $margin }
  $wantW = [Math]::Min($rect[2], $availW)
  $wantH = [Math]::Min($rect[3], $wr.h - 2 * $margin)
  if ($wantW -lt 200) { $wantW = [Math]::Min(900, $wr.w - 2 * $margin) }
  if ($wantH -lt 150) { $wantH = [Math]::Min(700, $wr.h - 2 * $margin) }
  $wantX = $wr.x + $margin
  $wantY = $wr.y + $margin
  if ($DryRun) { return [pscustomobject]@{ ok = $true; dry = $true; why = 'dry-run'; from = $rect; want = @($wantX, $wantY, $wantW, $wantH); got = $null } }

  $restored = $false
  if ([WBridge]::IsZoomed($hwnd)) { [void][WBridge]::ShowWindow($hwnd, 9); Start-Sleep -Milliseconds 120; $restored = $true }
  $ok1 = [WBridge]::Move($hwnd, $wantX, $wantY, $wantW, $wantH)
  Start-Sleep -Milliseconds $script:cfg.dpiSettleMs
  $ok2 = [WBridge]::Move($hwnd, $wantX, $wantY, $wantW, $wantH)
  Start-Sleep -Milliseconds 120
  $got = [WBridge]::Rect($hwnd)
  $gw = $got.R - $got.L; $gh = $got.B - $got.T
  $exact = ([Math]::Abs($got.L - $wantX) -le 2) -and ([Math]::Abs($got.T - $wantY) -le 2) -and ([Math]::Abs($gw - $wantW) -le 2) -and ([Math]::Abs($gh - $wantH) -le 2)
  if ($script:cfg.minimizeAfterMove -and -not [WBridge]::IsMinimized($hwnd)) {
    # SW_MINIMIZE (6): it stays on the second screen, so restoring it later
    # puts it right there -- and it never covers the panel.
    [void][WBridge]::ShowWindow($hwnd, 6)
  }
  return [pscustomobject]@{
    ok = ($ok1 -or $ok2) -and $exact
    why = if ($exact) { 'moved' } else { 'size-or-pos-mismatch' }
    from = $rect
    want = @($wantX, $wantY, $wantW, $wantH)
    got = @($got.L, $got.T, $gw, $gh)
    unmaximized = $restored
  }
}

# ------------------------------------------------------------------ setup ----
$script:cfg = Read-Config
$script:startedAtMs = [WBridge]::NowMs()
$script:moved = New-Object System.Collections.Generic.HashSet[string]
# Windows already nudged towards the second screen at EVENT_OBJECT_CREATE.
$script:preMoved = New-Object System.Collections.Generic.HashSet[string]
# Cloaked windows: key -> { at, hwnd }. Uncloak at 180ms (position is final), allow activation at 1.5s.
$script:stealth = @{}
Refresh-DshPids
[void](Refresh-Monitors)

$hookOk = [WBridge]::StartHook()

Emit @{
  type = 'hello'
  version = '0.1.0-p1'
  pid = $PID
  startedAtMs = $script:startedAtMs
  hookOk = $hookOk
  dryRun = [bool]$DryRun
  rules = @{
    browser = $script:cfg.browser; console = $script:cfg.console
    respectDrag = $script:cfg.respectDrag; onlyAfter = $script:cfg.onlyAfter
    extraProcs = $script:cfg.extraProcs; dpiSettleMs = $script:cfg.dpiSettleMs
  }
  secondary = Get-WorkRect
  monitors = @([WBridge]::Monitors() | ForEach-Object {
    [ordered]@{ device = $_.szDevice; primary = (($_.dwFlags -band 1) -ne 0);
      x = $_.rcWork.L; y = $_.rcWork.T; w = ($_.rcWork.R - $_.rcWork.L); h = ($_.rcWork.B - $_.rcWork.T) }
  })
  dshPids = @($script:dshPids)
}

if (-not (Get-WorkRect)) {
  Emit @{ type = 'idle'; reason = 'no-secondary-monitor' }
  exit 0
}

function Handle-Window([IntPtr]$hwnd) {
  $v = Get-Verdict $hwnd
  $key = [string]$v.hwnd
  if ($v.kind -eq 'none') {
    # only report skips that matter (attributable-ish classes), and only once each
    if ($v.reason -in @('windows-terminal-singleton', 'dsh-main-window')) {
      if (-not $script:skipOnce.ContainsKey($key)) {
        $script:skipOnce[$key] = $true
        Emit @{ type = 'skip'; kind = 'guard'; reason = $v.reason; proc = $v.proc; pid = $v.pid; title = $v.title }
      }
    }
    return
  }
  if ($script:cfg.respectDrag -and $script:moved.Contains($key)) { return }
  # Focus telemetry: the mover must never steal focus (SWP_NOACTIVATE). Measure
  # it here, right around our own call, so the harness can tell "the mover stole
  # focus" apart from "the tool that spawned this window stole focus".
  $fgB = [WBridge]::Foreground()
  $fgBpid = 0; [void][WBridge]::GetWindowThreadProcessId($fgB, [ref]$fgBpid)
  $res = Invoke-Move $hwnd $v.rect
  $fgA = [WBridge]::Foreground()
  $fgApid = 0; [void][WBridge]::GetWindowThreadProcessId($fgA, [ref]$fgApid)
  $fgBproc = (Get-Proc ([int]$fgBpid)).name
  $fgAproc = (Get-Proc ([int]$fgApid)).name
  if ($res.ok) { [void]$script:moved.Add($key) } else { [void]$script:moved.Add($key) }  # never retry-loop
  Emit @{
    type = $(if ($res.ok) { 'moved' } else { 'move-failed' })
    kind = $v.kind; reason = $res.why; proc = $v.proc; pid = $v.pid
    title = $v.title; class = $v.class; hwnd = $v.hwnd
    from = $res.from; want = $res.want; got = $res.got
    unmaximized = [bool]$res.unmaximized
    premoved = $script:preMoved.Contains($key)
    focus = @{
      kept = ($fgBpid -eq $fgApid)
      before = @{ pid = [int]$fgBpid; proc = $fgBproc }
      after = @{ pid = [int]$fgApid; proc = $fgAproc }
    }
  }
}

# SelfTest: one-shot scan of what already exists (acceptance harness helper)
if ($SelfTest) {
  Emit @{ type = 'scan-begin' }
  foreach ($h in [WBridge]::Windows()) {
    try { Handle-Window $h } catch {}
  }
  Emit @{ type = 'scan-end' }
  if ($SelfTestWaitMs -gt 0) {
    $deadline = [WBridge]::NowMs() + $SelfTestWaitMs
    while ([WBridge]::NowMs() -lt $deadline) {
      [void][WBridge]::Pump(20)
      while ($true) { $h0 = 0L; if (-not [WBridge]::Creates.TryDequeue([ref]$h0)) { break }; Pre-MoveWindow ([IntPtr]$h0) }
      while ($true) { $h2 = 0L; if (-not [WBridge]::Hits.TryDequeue([ref]$h2)) { break }; Handle-Window ([IntPtr]$h2) }
    }
  }
  [WBridge]::StopHook()
  exit 0
}

# ------------------------------------------------ cloak settle (stealth) -----
# Small list (one per delivery): uncloak when due, restore normal activation later.
function Settle-Stealth {
  if ($script:stealth.Count -eq 0) { return }
  $now = [WBridge]::NowMs()
  foreach ($k in @($script:stealth.Keys)) {
    $e = $script:stealth[$k]
    if ($null -eq $e) { $script:stealth.Remove($k); continue }
    $age = $now - [double]$e.at
    if ($age -ge 180) {
      [WBridge]::Cloak($e.hwnd, $false)
      if ($age -ge 1500) {
        [WBridge]::NoActivate($e.hwnd, $false)
        $script:stealth.Remove($k)
      }
    }
  }
}

# ------------------------------------------------------------ main loop ------
$lastRefresh = [WBridge]::NowMs()
try {
  while ($true) {
    # 20ms pump: the old 100ms tick was the visible "flash on the primary" --
    # the window was painted long before we got around to moving it.
    [void][WBridge]::Pump(20)
    while ($true) {
      $rw = 0L
      if (-not [WBridge]::Creates.TryDequeue([ref]$rw)) { break }
      Pre-MoveWindow ([IntPtr]$rw)
    }
    Settle-Stealth
    while ($true) {
      $rawn = 0L
      if (-not [WBridge]::Hits.TryDequeue([ref]$rawn)) { break }
      try { Handle-Window ([IntPtr]$rawn) } catch { Emit @{ type = 'error'; where = 'handle-window'; message = "$($_.Exception.Message)" } }
    }
    $now = [WBridge]::NowMs()
    if ($now - $lastRefresh -ge 15000) {
      $lastRefresh = $now
      Refresh-DshPids
      $wasSecondary = [bool]$script:secondary
      [void](Refresh-Monitors)
      $isSecondary = [bool]$script:secondary
      if ($wasSecondary -ne $isSecondary) { Emit @{ type = 'display.changed'; hasSecondary = $isSecondary } }
      if (-not $isSecondary) { Emit @{ type = 'idle'; reason = 'secondary-lost' }; break }
    }
  }
} finally {
  [WBridge]::StopHook()
  Emit @{ type = 'bye'; movedCount = $script:moved.Count }
}