# panel-host.ps1 -- native frameless panel window (WPF). Replaces Edge --app.
#
# WHY: Edge --app draws its own toolbar inside the client area; stripping
# WS_CAPTION cannot remove it and pushing it off-screen breaks on drag (owner
# rejected both). A native WPF window has no browser chrome at all: real
# frameless, real drag, and later real per-pixel transparency for the v2 pet.
#
# ASCII-ONLY on purpose. UI strings live in panel/ui.json (UTF-8) and are read
# with an explicit UTF8 decoder, so no CJK literal ever appears in this file.
#
# Parameters: -X -Y -W -H place the CONTENT rect; -Topmost; -SelfTest closes
# itself after -ExitAfterMs (used by the acceptance probe).
param(
  [Alias('X')][int]$PosX = 3536,
  [Alias('Y')][int]$PosY = -588,
  [Alias('W')][int]$Width = 600,
  [Alias('H')][int]$Height = 1350,
  [switch]$Topmost,
  # The owner already dragged this panel to a size of their own: keep it,
  # do not auto-shrink to content on the next open.
  [switch]$NoFit,
  # DPI compensation. The window is sized in PHYSICAL pixels, so a font size
  # that looks right on the 100% primary monitor shrinks to 2/3 on the 150%
  # secondary one. The controller passes the target monitor scale here and
  # every size below is multiplied by it.
  [double]$UiScale = 1.0,
  # Ready handshake over a FILE, not stdout: when the host is spawned by node
  # with piped stdio, the ready line never reached the controller (it works
  # from an interactive console). A file survives console/pipe/encoding
  # differences and leaves an audit trail.
  [string]$ReadyFile = 'E:\dsh\dual-screen\panel-ready.json',
  [string]$StageLog = 'E:\dsh\dual-screen\panel-host.log',
  # P3: URL of panel.json (carries the live web port, which changes on every
  # restart, so the controller computes it and passes it in -- never hardcode).
  # Empty = render static text only (used by the -ExitAfterMs self test).
  [string]$DataUrl = '',
  [int]$ExitAfterMs = 0,
  [string]$UiJson = 'E:\dsh\profiles\desktop\node_modules\dsh-dual-screen\panel\ui.json',
  # Q whale avatar (DSniang1.png, same character as the whale widget). Optional:
  # when missing the header falls back to a filled disc + one character.
  [string]$AvatarFile = '',
  # Form at open time: 'collapsed' shows ONLY the avatar (a 56 DIP bubble, PLAN
  # 7.7.1 form C), 'expanded' the full card. The window rect already carries the
  # size, so this only swaps the visual tree. The poll follows panel.json's form,
  # so collapsing from any client (curl, sidebar, the header button) takes effect.
  [string]$Form = 'expanded',
  # Dev-only: start with the settings strip already open, so a screenshot can prove
  # the strip renders without needing a real click on the secondary screen.
  [switch]$ShowSettings
)
$ErrorActionPreference = 'Stop'
# Fallback avatar location so an older controller (one that does not pass
# -AvatarFile yet) still gets the Q whale: <plugin>/panel/avatar.png.
if ($AvatarFile -eq '') {
  try {
    $guess = Join-Path (Split-Path -Parent $PSScriptRoot) 'panel\avatar.png'
    if (Test-Path -LiteralPath $guess) { $AvatarFile = $guess }
  } catch { }
}

# (removed CJK comment: PS 5.1 reads BOM-less .ps1 as ANSI and would eat a character)
# (removed CJK comment: PS 5.1 reads BOM-less .ps1 as ANSI and would eat a character)
function Write-Stage([string]$msg) {
  try {
    $line = (Get-Date).ToString("HH:mm:ss.fff") + " [" + $PID + "] " + $msg
    Add-Content -LiteralPath $StageLog -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
  } catch { }
}
Write-Stage ("start args X=" + $PosX + " Y=" + $PosY + " W=" + $Width + " H=" + $Height + " uiScale=" + $UiScale)
# Early liveness line: lets the supervisor tell "WPF still loading" from "crashed
# before printing anything". WPF cold start here can take >10s on first run.
[Console]::Out.WriteLine('{"panel":"starting"}'); [Console]::Out.Flush()

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PNative {
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  // Per-monitor DPI for the window's monitor: WPF works in DIPs, our config in physical px.
  [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr hMon, int type, out uint x, out uint y);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECTX { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECTX r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECTX r);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool PtInRect(ref RECTX r, POINT p);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SetCapture(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ReleaseCapture();
  [DllImport("user32.dll")] public static extern short GetKeyState(int key);
  // Owner request 2026-11-08: the pet must pop up UNDER THE CURSOR when the panel is
  // folded away, so the fold button reports the live pointer position instead of
  // letting the server guess a corner.
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  // Form C: clip the whole window to a circle. SetWindowRgn is the only way to get
  // rounded corners WITHOUT AllowsTransparency, which would make the window
  // click-through (the exact WPF trap this project already lost a day to).
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int w, int h);
  [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr h, IntPtr rgn, bool redraw);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr o);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
  public static void SetAware() { try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch {} }
  public static double ScaleFor(int x, int y) {
    var pt = new POINT(); pt.x = x; pt.y = y;
    IntPtr m = MonitorFromPoint(pt, 2);
    uint dx = 96, dy = 96;
    try { GetDpiForMonitor(m, 0, out dx, out dy); } catch {}
    return dx / 96.0;
  }
}
'@
[void][PNative]::SetAware()
Write-Stage "dpi aware set"

$ui = [IO.File]::ReadAllText($UiJson, [Text.Encoding]::UTF8) | ConvertFrom-Json
Write-Stage ("ui.json loaded from " + $UiJson)

# Physical px -> WPF DIPs for the monitor the panel lives on.
$scale = [PNative]::ScaleFor($PosX, ($PosY + 10))
# Measured on this machine: a PerMonitorV2 WPF window on the 150% secondary
# monitor maps DIP -> physical 1:1 (scale reported 1.5 but Left/Top/Width/Height
# behaved as physical pixels). So pass the physical rect straight through; do
# NOT divide by scale (that put the panel at 2357,-392 400x900 instead of
# 3536,-588 600x1350). Re-verify with -ExitAfterMs if the panel is ever resized.
$dipW = $Width
$dipH = $Height
$dipX = $PosX
$dipY = $PosY

$bg = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#0d1b2a')
$panelBg = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#16304a')
$lineBrush = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#2a4a66')
$textBrush = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#e8f1f8')
$dimBrush = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#9fb4c7')
$accent = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#4fb3ff')
$errorBrush = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#ff6b6b')

Write-Stage "creating window"
$win = New-Object System.Windows.Window
$win.WindowStyle = 'None'
$win.ResizeMode = 'NoResize'
$win.ShowInTaskbar = $false
$win.ShowActivated = $false           # never steal focus
$win.Background = $bg
$win.Width = $dipW
$win.Height = $dipH
$win.Left = $dipX
$win.Top = $dipY
if ($Topmost) { $win.Topmost = $true }

$root = New-Object System.Windows.Controls.Grid
$root.Margin = New-Object System.Windows.Thickness(0)
$win.Content = $root
Write-Stage "content attached"

# ---- layout ----
# A real Grid with rows, not absolute margins: the first pass placed every block
# with a hardcoded Y (16/62/96/124) and at 150% they collided with the header and
# floated. Rows: header / status / body / bottom bar.
$root.RowDefinitions.Clear()
foreach ($rowH in @('Auto', 'Auto', '*', 'Auto')) {
  $rd = New-Object System.Windows.Controls.RowDefinition
  $rd.Height = $rowH
  [void]$root.RowDefinitions.Add($rd)
}

# ---- row 0: header (drag handle) ----
$head = New-Object System.Windows.Controls.Border
$head.Background = $panelBg
$head.Height = 54 * $UiScale
$head.Cursor = 'SizeAll'
$head.Add_MouseLeftButtonDown({ try { $win.DragMove() } catch {} })
[System.Windows.Controls.Grid]::SetRow($head, 0)

$headGrid = New-Object System.Windows.Controls.Grid
$headGrid.Margin = New-Object System.Windows.Thickness(14, 0, 10, 0)
$head.Child = $headGrid
$c1 = New-Object System.Windows.Controls.ColumnDefinition; $c1.Width = 'Auto'; [void]$headGrid.ColumnDefinitions.Add($c1)
$c2 = New-Object System.Windows.Controls.ColumnDefinition; $c2.Width = '*'; [void]$headGrid.ColumnDefinitions.Add($c2)
$c3 = New-Object System.Windows.Controls.ColumnDefinition; $c3.Width = 'Auto'; [void]$headGrid.ColumnDefinitions.Add($c3)

# avatar: filled disc + one character from ui.json so this file stays ASCII
$avatarBox = New-Object System.Windows.Controls.Grid
$avatarBox.Width = 40 * $UiScale
$avatarBox.Height = 40 * $UiScale
$avatarBox.VerticalAlignment = 'Center'
$avatarBox.Margin = New-Object System.Windows.Thickness(0, 0, 0, 0)
$disc = New-Object System.Windows.Shapes.Ellipse
$disc.Width = 40 * $UiScale
$disc.Height = 40 * $UiScale
$disc.Fill = $accent
# Q whale avatar: an ellipse filled with an ImageBrush is already a circular
# crop, no clip geometry needed. Stretch UniformToFill keeps the face centred.
$avatarShown = $false
if ($AvatarFile -ne '' -and (Test-Path -LiteralPath $AvatarFile)) {
  try {
    $bi = New-Object System.Windows.Media.Imaging.BitmapImage
    $bi.BeginInit()
    $bi.CacheOption = 'OnLoad'
    $bi.UriSource = New-Object Uri($AvatarFile, [System.UriKind]::Absolute)
    $bi.EndInit()
    $brush = New-Object System.Windows.Media.ImageBrush
    $brush.ImageSource = $bi
    $brush.Stretch = 'UniformToFill'
    $disc.Fill = $brush
    $avatarShown = $true
    Write-Stage ('avatar loaded: ' + $AvatarFile)
  } catch {
    Write-Stage ('avatar load failed, falling back to glyph: ' + $_.Exception.Message)
  }
} else {
  Write-Stage 'avatar file not provided or missing: using glyph'
}
[void]$avatarBox.Children.Add($disc)
$glyph = New-Object System.Windows.Controls.TextBlock
$glyph.Text = [string]$ui.avatarText
$glyph.Foreground = $bg
$glyph.FontSize = 14 * $UiScale
$glyph.FontWeight = 'SemiBold'
$glyph.HorizontalAlignment = 'Center'
$glyph.VerticalAlignment = 'Center'
if ($avatarShown) { $glyph.Visibility = 'Collapsed' }
[void]$avatarBox.Children.Add($glyph)
[System.Windows.Controls.Grid]::SetColumn($avatarBox, 0)
[void]$headGrid.Children.Add($avatarBox)

$titles = New-Object System.Windows.Controls.StackPanel
$titles.VerticalAlignment = 'Center'
$titles.Margin = New-Object System.Windows.Thickness(10, 0, 0, 0)
[System.Windows.Controls.Grid]::SetColumn($titles, 1)
[void]$headGrid.Children.Add($titles)

$t1 = New-Object System.Windows.Controls.TextBlock
$t1.Text = $ui.title
$t1.Foreground = $textBrush
$t1.FontSize = 15 * $UiScale
$t1.FontWeight = 'SemiBold'
[void]$titles.Children.Add($t1)

$t2 = New-Object System.Windows.Controls.TextBlock
$t2.Text = $ui.subtitle
$t2.Foreground = $dimBrush
$t2.FontSize = 11.5 * $UiScale
[void]$titles.Children.Add($t2)

$close = New-Object System.Windows.Controls.Button
$close.Content = [char]0x2715     # cross
$close.Width = 26 * $UiScale
$close.Height = 26 * $UiScale
$close.FontSize = 12
$close.Foreground = $dimBrush
$close.Background = [System.Windows.Media.Brushes]::Transparent
$close.BorderThickness = 0
$close.VerticalAlignment = 'Center'
$close.Cursor = 'Hand'
$close.Add_Click({ $win.Close() })

# Collapse chip: folds the panel away. Since 2026-11-06 the collapsed state IS the
# pet (the round bubble was janky and ugly), so this button must NOT resize itself --
# it only tells the server, and the server closes this host and brings the pet up.
# Doing a local Apply-Form here first would flash the old bubble for a few hundred ms.
$collapse = New-Object System.Windows.Controls.Button
$collapse.Content = [char]0x25BE     # down triangle = fold away
$collapse.Width = 26 * $UiScale
$collapse.Height = 26 * $UiScale
$collapse.FontSize = 12
$collapse.Foreground = $dimBrush
$collapse.Background = [System.Windows.Media.Brushes]::Transparent
$collapse.BorderThickness = 0
$collapse.VerticalAlignment = 'Center'
$collapse.Cursor = 'Hand'
$collapse.ToolTip = 'fold into the pet'
$collapse.Add_Click({ Send-PanelForm 'collapsed' })

$headBtns = New-Object System.Windows.Controls.StackPanel
$headBtns.Orientation = 'Horizontal'
$headBtns.VerticalAlignment = 'Center'
[void]$headBtns.Children.Add($collapse)
[void]$headBtns.Children.Add($close)
[System.Windows.Controls.Grid]::SetColumn($headBtns, 2)
[void]$headGrid.Children.Add($headBtns)

[void]$root.Children.Add($head)

# ---- row 1: status row (screen geometry, refreshed from panel.json) ----
$statusBar = New-Object System.Windows.Controls.Border
$statusBar.BorderBrush = $lineBrush
$statusBar.BorderThickness = New-Object System.Windows.Thickness(0, 0, 0, 1)
$statusBar.Padding = New-Object System.Windows.Thickness(16, 8, 16, 8)
[System.Windows.Controls.Grid]::SetRow($statusBar, 1)
$status = New-Object System.Windows.Controls.TextBlock
$status.Text = $ui.status
$status.Foreground = $dimBrush
$status.FontSize = 11.5 * $UiScale
$status.TextTrimming = 'CharacterEllipsis'
$statusBar.Child = $status
[void]$root.Children.Add($statusBar)

# ---- row 2: body (timeline + P3 live rows) ----
$body = New-Object System.Windows.Controls.ScrollViewer
$body.VerticalScrollBarVisibility = 'Auto'
$body.HorizontalScrollBarVisibility = 'Disabled'
$body.Padding = New-Object System.Windows.Thickness(16, 12, 16, 12)
[System.Windows.Controls.Grid]::SetRow($body, 2)

$bodyStack = New-Object System.Windows.Controls.StackPanel
$bodyStack.Margin = New-Object System.Windows.Thickness(0)

$tlHead = New-Object System.Windows.Controls.TextBlock
$tlHead.Text = $ui.timelineHead
$tlHead.Foreground = $dimBrush
$tlHead.FontSize = 11.5 * $UiScale
$tlHead.Margin = New-Object System.Windows.Thickness(0, 0, 0, 10)
# ---- pending-answer area (P4): the host pushes questions here; a click answers ----
$askBox = New-Object System.Windows.Controls.StackPanel
$askBox.Margin = New-Object System.Windows.Thickness(0, 0, 0, 10)
[void]$bodyStack.Children.Add($askBox)
$script:askKey = ''
$script:askBase = ''

[void]$bodyStack.Children.Add($tlHead)

$empty = New-Object System.Windows.Controls.TextBlock
$empty.Text = $ui.empty
$empty.Foreground = $dimBrush
$empty.FontSize = 12.5 * $UiScale
$empty.TextWrapping = 'Wrap'
$empty.Margin = New-Object System.Windows.Thickness(0, 4, 0, 0)
[void]$bodyStack.Children.Add($empty)

$timelineBox = New-Object System.Windows.Controls.StackPanel
$timelineBox.Margin = New-Object System.Windows.Thickness(0)
[void]$bodyStack.Children.Add($timelineBox)

$body.Content = $bodyStack
[void]$root.Children.Add($body)

# ---- row 3: bottom bar ----
$bar = New-Object System.Windows.Controls.Border
$bar.Background = $panelBg
$bar.BorderBrush = $lineBrush
$bar.BorderThickness = New-Object System.Windows.Thickness(0, 1, 0, 0)
$bar.Height = 48 * $UiScale
[System.Windows.Controls.Grid]::SetRow($bar, 3)
$barGrid = New-Object System.Windows.Controls.StackPanel
$barGrid.Orientation = 'Horizontal'
$barGrid.Margin = New-Object System.Windows.Thickness(12, 6, 12, 6)
$bar.Child = $barGrid

# ---- pet toggle: the one chip that does something ----
# The other chips are placeholders; this one calls POST /dsh-dual-screen/pet so the
# owner can summon the little fish from the panel itself instead of curl.
$petBtn = New-Object System.Windows.Controls.Button
$petBtn.Content = ($ui.pet.label + ': ' + $ui.pet.off)
$script:petRunning = $false
$petBtn.Foreground = $dimBrush
$petBtn.Background = [System.Windows.Media.Brushes]::Transparent
$petBtn.BorderBrush = $lineBrush
$petBtn.BorderThickness = 1
$petBtn.Padding = New-Object System.Windows.Thickness(12, 4, 12, 4)
$petBtn.Margin = New-Object System.Windows.Thickness(0, 0, 8, 0)
$petBtn.FontSize = 12 * $UiScale
$petBtn.Cursor = 'Hand'
$petBtn.ToolTip = $ui.pet.startHint
$petBtn.Add_Click({
  try {
    if (-not $script:askBase) { return }
    $script:petBusy = $true
    $petBtn.Content = ($ui.pet.label + ': ' + $ui.pet.starting)
    $wantStop = $script:petRunning
    $body = if ($wantStop) { '{"action":"stop"}' } else { '{"action":"start"}' }
    $req = [System.Net.HttpWebRequest]::Create($script:askBase + '/dsh-dual-screen/pet')
    $req.Method = 'POST'
    $req.Proxy = $null
    $req.Timeout = 8000
    $req.ContentType = 'application/json; charset=utf-8'
    $bytes = [Text.Encoding]::UTF8.GetBytes($body)
    $req.ContentLength = $bytes.Length
    $s = $req.GetRequestStream()
    $s.Write($bytes, 0, $bytes.Length)
    $s.Close()
    $resp = $req.GetResponse()
    $reader = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
    $reader.Close(); $resp.Close()
    $script:petRunning = -not $wantStop
    Write-Stage ('pet toggled: ' + $text)
  } catch {
    Write-Stage ('pet toggle failed: ' + $_.Exception.Message)
  } finally {
    $script:petBusy = $false
  }
})
[void]$barGrid.Children.Add($petBtn)

function Update-PetButton([bool]$running, [bool]$failed) {
  try {
    if ($script:petBusy) { return }
    $script:petRunning = $running
    if ($failed) {
      $petBtn.Content = ($ui.pet.label + ': ' + $ui.pet.failed)
      $petBtn.Foreground = $errorBrush
    } elseif ($running) {
      $petBtn.Content = ($ui.pet.label + ': ' + $ui.pet.on)
      $petBtn.Foreground = $accent
    } else {
      $petBtn.Content = ($ui.pet.label + ': ' + $ui.pet.off)
      $petBtn.Foreground = $dimBrush
    }
  } catch { }
}

# ---- bottom chips: REAL controls (PLAN 7.6) ----
# v0.6 shipped these as disabled decoration ("keep them visually honest"). The owner
# clicked them and reported "nothing happens" -- which is exactly what dead buttons
# do. Now:
#   STOP   -> POST /action {action:'stop'}     emergency brake on the running turn
#   RESUME -> POST /action {action:'continue'} preset quick command into the session
#   SETTINGS -> shows the three config switches (move windows / panel auto-open / pet auto)
$script:flashUntil = $null

function Set-Flash([string]$text) {
  try {
    $script:flashUntil = (Get-Date).AddSeconds(5)
    $status.Text = $text
  } catch { }
}

function Send-PanelPost([string]$path, [string]$json) {
  if ($script:askBase -eq '') { Write-Stage ('post skipped (no base): ' + $path); return $null }
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $req = [System.Net.HttpWebRequest]::Create($script:askBase + $path)
    $req.Method = 'POST'
    $req.Proxy = $null
    $req.Timeout = 6000
    $req.ContentType = 'application/json; charset=utf-8'
    $req.ContentLength = $bytes.Length
    $s = $req.GetRequestStream()
    $s.Write($bytes, 0, $bytes.Length)
    $s.Close()
    $resp = $req.GetResponse()
    $reader = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
    $reader.Close(); $resp.Close()
    Write-Stage ('post ' + $path + ' -> ' + $text)
    $script:lastPost = $text
    try { return ($text | ConvertFrom-Json) } catch { return $null }
  } catch {
    Write-Stage ('post failed ' + $path + ': ' + $_.Exception.Message)
    return $null
  }
}

function Send-PanelAction([string]$verb) {
  $j = Send-PanelPost '/dsh-dual-screen/action' ('{"action":"' + $verb + '"}')
  # Short outcome labels come from ui.json -- this file must stay pure ASCII
  # (PS 5.1 reads a BOM-less .ps1 as ANSI, and a stray multi-byte char inside a
  # string literal eats the closing quote; that is exactly what broke the parse
  # on the first attempt at this patch).
  if ($null -eq $j) { Set-Flash ([string]$ui.settings.failed); return [string]$ui.settings.chipOffline }
  if ($j.ok) {
    $short = ''
    try {
      if ($j.session) {
        $s = [string]$j.session
        if ($s.StartsWith('session-')) { $s = $s.Substring(8) }
        if ($s.Length -gt 8) { $s = $s.Substring(0, 8) }
        $short = ' ' + $s
      }
    } catch { }
    if ($verb -eq 'stop') { Set-Flash ([string]$ui.settings.stopped); return ([string]$ui.settings.chipStopOk + $short) }
    if ($verb -eq 'continue') { Set-Flash ([string]$ui.settings.continued + $short); return ([string]$ui.settings.chipContinueOk + $short) }
    Set-Flash ('ok: ' + $verb)
    return 'ok'
  }
  # The long reason goes to the status row; the button only carries a short signal.
  Set-Flash ([string]$j.error)
  return [string]$ui.settings.chipFail
}

# ---- settings strip: three switches, hidden until the chip is pressed ----
$script:settingsState = $null
$settingsBox = New-Object System.Windows.Controls.Border
$settingsBox.Background = $panelBg
$settingsBox.BorderBrush = $lineBrush
$settingsBox.BorderThickness = New-Object System.Windows.Thickness(1)
$settingsBox.CornerRadius = New-Object System.Windows.CornerRadius(10)
$settingsBox.Padding = New-Object System.Windows.Thickness(10)
$settingsBox.Margin = New-Object System.Windows.Thickness(0, 0, 0, 10)
$settingsBox.Visibility = 'Collapsed'
$settingsInner = New-Object System.Windows.Controls.StackPanel
$settingsTitle = New-Object System.Windows.Controls.TextBlock
$settingsTitle.Text = [string]$ui.settings.title
$settingsTitle.Foreground = $dimBrush
$settingsTitle.FontSize = 11 * $UiScale
$settingsTitle.Margin = New-Object System.Windows.Thickness(0, 0, 0, 6)
[void]$settingsInner.Children.Add($settingsTitle)

$switchMove = New-Object System.Windows.Controls.Button
$switchPanel = New-Object System.Windows.Controls.Button
$switchPet = New-Object System.Windows.Controls.Button
foreach ($sw in @($switchMove, $switchPanel, $switchPet)) {
  $sw.HorizontalAlignment = 'Stretch'
  $sw.HorizontalContentAlignment = 'Left'
  $sw.Foreground = $textBrush
  $sw.Background = [System.Windows.Media.Brushes]::Transparent
  $sw.BorderBrush = $lineBrush
  $sw.BorderThickness = New-Object System.Windows.Thickness(1)
  $sw.Padding = New-Object System.Windows.Thickness(10, 5, 10, 5)
  $sw.Margin = New-Object System.Windows.Thickness(0, 0, 0, 4)
  $sw.FontSize = 12 * $UiScale
  $sw.Cursor = 'Hand'
  [void]$settingsInner.Children.Add($sw)
}
$switchMove.Add_Click({
  $on = $true
  if ($script:settingsState) { $on = [bool]$script:settingsState.moveWindows }
  $json = '{"moveWindows":{"enabled":' + (('true','false')[$on]) + '}}'
  if ($null -ne (Send-PanelPost '/dsh-dual-screen/config' $json)) { Set-Flash ([string]$ui.settings.saved) } else { Set-Flash ([string]$ui.settings.failed) }
})
$switchPanel.Add_Click({
  $on = $true
  if ($script:settingsState) { $on = [bool]$script:settingsState.panelAutoOpen }
  $json = '{"panel":{"autoOpen":' + (('true','false')[$on]) + '}}'
  if ($null -ne (Send-PanelPost '/dsh-dual-screen/config' $json)) { Set-Flash ([string]$ui.settings.saved) } else { Set-Flash ([string]$ui.settings.failed) }
})
$switchPet.Add_Click({
  $on = $true
  if ($script:settingsState) { $on = [bool]$script:settingsState.petAutoStart }
  $json = '{"pet":{"autoStart":' + (('true','false')[$on]) + '}}'
  if ($null -ne (Send-PanelPost '/dsh-dual-screen/config' $json)) { Set-Flash ([string]$ui.settings.saved) } else { Set-Flash ([string]$ui.settings.failed) }
})

$settingsBox.Child = $settingsInner
[void]$bodyStack.Children.Insert(0, $settingsBox)

# ---- recent sessions: pick one, and the "continue" chip sends to exactly that one ----
# Owner ask (2026-11-06): send continue to the conversation that is actually open,
# or let the panel pick one of the recently used ones.
# The chip alone picks the best target automatically; this list is the explicit override.
$sessionsTitleBlock = New-Object System.Windows.Controls.TextBlock
$sessionsTitleBlock.Text = [string]$ui.settings.sessionsTitle
$sessionsTitleBlock.Foreground = $dimBrush
$sessionsTitleBlock.FontSize = 11 * $UiScale
$sessionsTitleBlock.TextWrapping = 'Wrap'
$sessionsTitleBlock.Margin = New-Object System.Windows.Thickness(0, 6, 0, 4)
[void]$settingsInner.Children.Add($sessionsTitleBlock)
$sessionsBox = New-Object System.Windows.Controls.StackPanel
[void]$settingsInner.Children.Add($sessionsBox)
$script:sessionsSig = ''

function Update-Sessions($list) {
  try {
    $arr = @($list)
    $sig = ($arr | ForEach-Object { [string]$_.id + ':' + [string]$_.at + ':' + [string]$_.running }) -join '|'
    if ($sig -eq $script:sessionsSig) { return }
    $script:sessionsSig = $sig
    $sessionsBox.Children.Clear()
    if ($arr.Count -eq 0) {
      $none = New-Object System.Windows.Controls.TextBlock
      $none.Text = [string]$ui.settings.sessionsEmpty
      $none.Foreground = $dimBrush
      $none.FontSize = 11 * $UiScale
      [void]$sessionsBox.Children.Add($none)
      return
    }
    foreach ($s in $arr) {
      $sid = [string]$s.id
      $when = ''
      try {
        if ([double]$s.at -gt 0) {
          $when = ([DateTimeOffset]::FromUnixTimeMilliseconds([long]$s.at)).LocalDateTime.ToString('HH:mm')
        }
      } catch { }
      $state = [string]$ui.settings.sessionIdle
      if ($s.running) { $state = [string]$ui.settings.sessionRunning }
      $text = [string]$s.short
      if ($when -ne '') { $text = $text + '  ' + $when }
      $text = $text + '  ' + $state
      $b = New-Object System.Windows.Controls.Button
      $b.Content = $text
      $b.HorizontalAlignment = 'Stretch'
      $b.HorizontalContentAlignment = 'Left'
      $b.Foreground = $textBrush
      $b.Background = [System.Windows.Media.Brushes]::Transparent
      $b.BorderBrush = $lineBrush
      $b.BorderThickness = 1
      $b.Padding = New-Object System.Windows.Thickness(10, 4, 10, 4)
      $b.Margin = New-Object System.Windows.Thickness(0, 0, 0, 3)
      $b.FontSize = 11.5 * $UiScale
      $b.Cursor = 'Hand'
      $b.Add_Click({
        $outcome = Send-PanelActionTo $sid
        if ($outcome) { Set-Flash ($outcome + ' -> ' + $sid) }
      }.GetNewClosure())
      [void]$sessionsBox.Children.Add($b)
    }
  } catch { }
}

function Send-PanelActionTo([string]$sessionId) {
  $body = '{"action":"continue","session":"' + $sessionId + '"}'
  $j = Send-PanelPost '/dsh-dual-screen/action' $body
  if ($null -eq $j) { return [string]$ui.settings.chipOffline }
  if ($j.ok) { return [string]$ui.settings.chipContinueOk }
  return [string]$ui.settings.chipFail
}
if ($ShowSettings) { $settingsBox.Visibility = 'Visible'; Write-Stage 'settings strip forced visible (-ShowSettings)' }

function Format-Switch([string]$label, $value) {
  $state = [string]$ui.settings.off
  if ($value) { $state = [string]$ui.settings.on }
  return ($label + ': ' + $state)
}

function Update-Settings($s) {
  try {
    if (-not $s) { return }
    $script:settingsState = $s
    $switchMove.Content = Format-Switch ([string]$ui.settings.moveWindows) $s.moveWindows
    $switchPanel.Content = Format-Switch ([string]$ui.settings.panelAutoOpen) $s.panelAutoOpen
    $switchPet.Content = Format-Switch ([string]$ui.settings.petAutoStart) $s.petAutoStart
  } catch { }
}

$chipContinue = New-Object System.Windows.Controls.Button
$chipStop = New-Object System.Windows.Controls.Button
$chipSettings = New-Object System.Windows.Controls.Button
$chipDefs = @(
  @{ B = $chipContinue; Label = [string]$ui.chips[0]; Act = 'continue' },
  @{ B = $chipStop; Label = [string]$ui.chips[1]; Act = 'stop' },
  @{ B = $chipSettings; Label = [string]$ui.chips[2]; Act = 'settings' }
)
foreach ($def in $chipDefs) {
  $b = $def.B
  $b.Content = $def.Label
  $b.Foreground = $dimBrush
  $b.Background = [System.Windows.Media.Brushes]::Transparent
  $b.BorderBrush = $lineBrush
  $b.BorderThickness = 1
  $b.Padding = New-Object System.Windows.Thickness(12, 4, 12, 4)
  $b.Margin = New-Object System.Windows.Thickness(0, 0, 8, 0)
  $b.FontSize = 12 * $UiScale
  $b.Cursor = 'Hand'
  $chipLabel = [string]$def.Label
  $chipVerb = $def.Act
  $btn = $b
  # ONE handler per chip. (An earlier patch added a second Add_Click for the label
  # feedback while the first one still posted, which would have fired the action
  # TWICE per click -- merged here before it ever shipped.)
  $b.Add_Click({
    if ($chipVerb -eq 'settings') {
      if ($settingsBox.Visibility -eq 'Visible') { $settingsBox.Visibility = 'Collapsed' } else { $settingsBox.Visibility = 'Visible' }
      Write-Stage ('settings strip ' + $settingsBox.Visibility)
      # The strip adds height; without this the window keeps the old height and the
      # new rows are clipped (the body row is '*').
      Fit-Height
      return
    }
    $outcome = Send-PanelAction $chipVerb
    if (-not $outcome) { return }
    # If the server could not decide a target, open the session list so the owner can
    # point at one instead of guessing why nothing happened.
    if ($chipVerb -eq 'continue' -and $outcome -eq [string]$ui.settings.chipFail) {
      $settingsBox.Visibility = 'Visible'
      Fit-Height
      Write-Stage 'continue needs an explicit session -> session list opened'
    }
    # The chip answers for itself: the outcome sits ON the button for 2.5s, then the
    # label comes back. Writing only to the status row was not enough -- the owner
    # pressed the continue chip four times and reported "nothing happens" (2026-11-06 21:14),
    # because that row is small and far away from the cursor.
    $btn.Content = $outcome
    $timer = New-Object System.Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromSeconds(2.5)
    $timer.Add_Tick({ $timer.Stop(); $btn.Content = $chipLabel }.GetNewClosure())
    $timer.Start()
  }.GetNewClosure())
  [void]$barGrid.Children.Add($b)
}
[void]$root.Children.Add($bar)

# ---- form C: collapsed avatar bubble (PLAN 7.7.1) ----
# The window rect is already the small square by the time this is visible; this
# layer is just what's drawn then. It sits as a SIBLING of $root inside a new
# outer Grid, so switching forms is a Visibility flip: no visual tree rebuild,
# no flicker, and the drag/resize hooks stay attached to the same window.
$compactInner = New-Object System.Windows.Controls.Grid
$compactDisc = New-Object System.Windows.Shapes.Ellipse
$compactDisc.Margin = New-Object System.Windows.Thickness(2)
if ($avatarShown) { $compactDisc.Fill = $brush } else { $compactDisc.Fill = $accent }
[void]$compactInner.Children.Add($compactDisc)
if (-not $avatarShown) {
  $compactGlyph = New-Object System.Windows.Controls.TextBlock
  $compactGlyph.Text = [string]$ui.avatarText
  $compactGlyph.Foreground = $bg
  $compactGlyph.FontSize = 20 * $UiScale
  $compactGlyph.FontWeight = 'SemiBold'
  $compactGlyph.HorizontalAlignment = 'Center'
  $compactGlyph.VerticalAlignment = 'Center'
  [void]$compactInner.Children.Add($compactGlyph)
}
$compact = New-Object System.Windows.Controls.Border
$compact.Background = $panelBg
$compact.CornerRadius = New-Object System.Windows.CornerRadius(999)
$compact.BorderBrush = $accent
$compact.BorderThickness = 1
$compact.Cursor = 'Hand'
$compact.Visibility = 'Collapsed'
$compact.Child = $compactInner
$compact.Add_MouseLeftButtonUp({ Send-PanelForm 'expanded' })

# Reparent: the window used to hold $root directly. Adding a control that still
# has a parent throws, so detach first.
$win.Content = $null
$outer = New-Object System.Windows.Controls.Grid
[void]$outer.Children.Add($root)
[void]$outer.Children.Add($compact)
$win.Content = $outer

$script:panelForm = ''
# Clip the window to a circle while collapsed (and only then). Without this the
# bubble is a circle drawn on a square -- the window background still fills the
# corners and it reads as a bug. AllowsTransparency would fix the corners and
# break clicking, so the region is the right tool.
function Set-BubbleRegion([bool]$on) {
  try {
    $h = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
    if ($h -eq [IntPtr]::Zero) { return }
    if (-not $on) {
      [void][PNative]::SetWindowRgn($h, [IntPtr]::Zero, $true)
      return
    }
    # Use the FULL window rect, not the client rect: this process talks physical
    # pixels while GetClientRect answers in DIP-ish space, which made the circle
    # 1/1.5 the size of the window (measured: 57 px ring inside an 84 px window).
    $r = New-Object PNative+RECTX
    if (-not [PNative]::GetWindowRect($h, [ref]$r)) { return }
    $rw = $r.R - $r.L
    $rh = $r.B - $r.T
    if ($rw -le 0 -or $rh -le 0) { return }
    # Corner radius = full side length turns the round-rect into an ellipse.
    $rgn = [PNative]::CreateRoundRectRgn(0, 0, $rw + 1, $rh + 1, $rw, $rh)
    [void][PNative]::SetWindowRgn($h, $rgn, $true)
    Write-Stage ('bubble region ' + $rw + 'x' + $rh)
  } catch {
    Write-Stage ('bubble region failed: ' + $_.Exception.Message)
  }
}
function Apply-Form([string]$f) {
  $want = 'collapsed'
  if ($f -ne 'collapsed') { $want = 'expanded' }
  if ($script:panelForm -eq $want) { return }
  $script:panelForm = $want
  # Geometry belongs to the server (panel-move.ps1); this only swaps what is drawn.
  # Doing it the other way round -- resizing here -- fought the server and left the
  # window at a stale size.
  if ($want -eq 'collapsed') {
    $root.Visibility = 'Collapsed'
    $compact.Visibility = 'Visible'
    $compact.ToolTip = [string]$ui.title
  } else {
    $root.Visibility = 'Visible'
    $compact.Visibility = 'Collapsed'
  }
  Set-BubbleRegion ($want -eq 'collapsed')
  Write-Stage ('form -> ' + $want)
}

# Ask the server to change form. Geometry is the server's job (panel-move.ps1
# owns the rect); this only flips the look optimistically so the click feels
# instant, then the poll confirms.
function Send-PanelForm([string]$form) {
  try {
    if ($script:askBase -eq '') { Write-Stage 'form change skipped: askBase unknown'; return }
    # 'collapsed' == "hand over to the pet": the server closes this host, so applying
    # the old bubble geometry locally would only produce a visible, janky flash.
    if ($form -ne 'collapsed') { Apply-Form $form }
    # Report the pointer position so the pet can pop up exactly under the cursor
    # (owner 2026-11-08). Physical pixels, same space as our window rects.
    $extra = ''
    if ($form -eq 'collapsed') {
      $cur = New-Object PNative+POINT
      if ([PNative]::GetCursorPos([ref]$cur)) {
        $extra = ',"cursor":[' + $cur.x + ',' + $cur.y + ']'
      }
    }
    $body = '{"form":"' + $form + '"' + $extra + '}'
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $req = [System.Net.HttpWebRequest]::Create($script:askBase + '/dsh-dual-screen/panel/form')
    $req.Method = 'POST'
    $req.Proxy = $null
    $req.Timeout = 5000
    $req.ContentType = 'application/json; charset=utf-8'
    $req.ContentLength = $bytes.Length
    $s = $req.GetRequestStream()
    $s.Write($bytes, 0, $bytes.Length)
    $s.Close()
    $resp = $req.GetResponse()
    $reader = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
    $reader.Close(); $resp.Close()
    Write-Stage ('panel form -> ' + $form + ': ' + $text)
  } catch {
    Write-Stage ('panel form change failed: ' + $_.Exception.Message)
  }
}

# (the initial Apply-Form call lives further down, after the MinWidth assignments)

# report the geometry we actually got, for the acceptance probe
$onShow = {
  $h = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
  $r = New-Object PNative+RECTX
  [void][PNative]::GetWindowRect($h, [ref]$r)
  $line = '{"panel":"ready","pid":' + $PID + ',"hwnd":"0x' + ([long]$h).ToString('X') + '","rect":[' + $r.L + ',' + $r.T + ',' + ($r.R - $r.L) + ',' + ($r.B - $r.T) + '],"scale":' + $scale + ',"uiScale":' + $UiScale + '}'
  try {
    $dir = Split-Path -Parent $ReadyFile
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $tmp = $ReadyFile + ".tmp"
    [IO.File]::WriteAllText($tmp, $line, (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $ReadyFile -Force
  } catch { }
  [Console]::Out.WriteLine($line); [Console]::Out.Flush()
  # The region can only be set once the HWND exists; Apply-Form ran earlier.
  Set-BubbleRegion ($script:panelForm -eq 'collapsed')
  Fit-Height
}
$win.Add_SourceInitialized($onShow)
Write-Stage "SourceInitialized handler attached"

# ---- resize by dragging the border (owner 2026-11-06: mouse-resizable panel) ----
# A WindowStyle=None window has no chrome, so Windows never offers resize edges by
# itself. We answer WM_NCHITTEST in the window procedure: when the cursor sits in
# an edge band we return HTLEFT/HTTOP/... and the OS runs its own resize loop.
# No custom drag code, no flicker, and it keeps working while the window is topmost.
# $Width/$Height here are PHYSICAL pixels (the process is DPI-unaware on purpose),
# while config stores DIP -> divide by $scale before saving.
# NoResize on purpose: with CanResize WPF installs its OWN hit-test and claims
# WM_NCHITTEST before our AddHook sees it (measured 2026-11-06 - the window did
# resize but every line after the NCHITTEST branch was dead code). Our hook is the
# only thing that knows a drag started, so WPF must stay out of the way.
$win.ResizeMode = 'NoResize'
# Deliberately tiny: this is the ONLY thing WPF clamps, and the collapsed bubble is
# 56 DIP. The 320x300 usability floor is enforced by the drag-resize code below
# (it clamps $minW/$minH itself), so leaving WPF's minimum at 40 costs nothing and
# lets the server shrink the window to the bubble (measured: with MinWidth=480 the
# collapse resize silently came back as 480x450).
$win.MinWidth = 40
$win.MinHeight = 40

# Apply the requested form LAST: these two MinWidth/MinHeight lines clamp the
# window to 480x450 the moment they run, so a collapse applied before them was
# silently undone (measured 2026-11-06). Order matters here, not cleverness.
Apply-Form $Form

# ---- mouse resize: self-driven (no OS modal loop) ----
# ResizeMode is NoResize, so WPF leaves WM_NCHITTEST alone and we own the whole
# gesture: HITTEST decides the edge, LBUTTONDOWN captures the mouse, MOUSEMOVE
# resizes with SetWindowPos, LBUTTONUP saves.
$script:dragEdge = 0          # 0 = no drag; otherwise HTLEFT/HTRIGHT/HTTOP/...
# Below this width the window is the collapsed bubble, above it the card. Collapsed
# is 56 DIP (~84 px here) and expanded never goes below 320 DIP, so 160 is a safe
# dividing line that no legitimate size lands on.
$script:bubbleCutoff = 160
$script:dragOrigin = $null    # cursor position when the drag started (screen px)
$script:dragFrame = $null     # window rect when the drag started (physical px)
$script:userResized = [bool]$NoFit

function Save-PanelSize {
  if (-not $DataUrl) { return }
  if ($DataUrl -notmatch '^(https?://[^/]+)') { return }
  $base = $Matches[1]
  try {
    $rr = New-Object PNative+RECTX
    $hh = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
    if (-not [PNative]::GetWindowRect($hh, [ref]$rr)) { Write-Stage 'save: GetWindowRect FAILED'; return }
    $wDip = [int][math]::Round(($rr.R - $rr.L) / $scale)
    $hDip = [int][math]::Round(($rr.B - $rr.T) / $scale)
    if ($script:userResized) {
      $body = '{"panel":{"width":' + $wDip + ',"height":' + $hDip + ',"resizedByUser":true}}'
    } else {
      $body = '{"panel":{"width":' + $wDip + '}}'
    }
    $req = [System.Net.HttpWebRequest]::Create($base + '/dsh-dual-screen/config')
    $req.Method = 'POST'
    $req.Proxy = $null
    $req.Timeout = 4000
    $req.ContentType = 'application/json; charset=utf-8'
    $bytes = [Text.Encoding]::UTF8.GetBytes($body)
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    $req.GetResponse().Close()
    Write-Stage ('size saved ' + $body)
  } catch {
    Write-Stage 'size save failed'
  }
}

$script:hitHook = {
  param($hh, $msg, $wParam, $lParam, [ref]$handled)

  # ---- start a drag: remember where we are, then capture the mouse ----
  if ($msg -eq 0x0201) {                       # WM_LBUTTONDOWN
    if ($script:dragEdge -eq 0) { return [IntPtr]::Zero }
    $pt = New-Object PNative+POINT
    $pt.x = $lParam.ToInt32() -band 0xFFFF
    $pt.y = ($lParam.ToInt32() -shr 16) -band 0xFFFF
    if ($pt.x -gt 32767) { $pt.x = $pt.x - 65536 }
    if ($pt.y -gt 32767) { $pt.y = $pt.y - 65536 }
    $script:dragOrigin = @($pt.x, $pt.y)
    $fr = New-Object PNative+RECTX
    [void][PNative]::GetWindowRect($hh, [ref]$fr)
    $script:dragFrame = @($fr.L, $fr.T, $fr.R, $fr.B)
    [void][PNative]::SetCapture($hh)
    Write-Stage ('drag start edge=' + $script:dragEdge)
    $handled.Value = $true
    return [IntPtr]::Zero
  }

  # ---- drag: move the edges that were grabbed ----
  if ($msg -eq 0x0200) {                       # WM_MOUSEMOVE
    if ($script:dragEdge -eq 0 -or $null -eq $script:dragOrigin) { return [IntPtr]::Zero }
    $pt = New-Object PNative+POINT
    $pt.x = $lParam.ToInt32() -band 0xFFFF
    $pt.y = ($lParam.ToInt32() -shr 16) -band 0xFFFF
    if ($pt.x -gt 32767) { $pt.x = $pt.x - 65536 }
    if ($pt.y -gt 32767) { $pt.y = $pt.y - 65536 }
    $dx = $pt.x - $script:dragOrigin[0]
    $dy = $pt.y - $script:dragOrigin[1]
    $nl = $script:dragFrame[0]; $nt = $script:dragFrame[1]
    $nr = $script:dragFrame[2]; $nb = $script:dragFrame[3]
    $edge = $script:dragEdge
    # 10=left 11=right 12=top 15=bottom 13=TL 14=TR 16=BL 17=BR
    if ($edge -eq 10 -or $edge -eq 13 -or $edge -eq 16) { $nl = $nl + $dx }
    if ($edge -eq 11 -or $edge -eq 14 -or $edge -eq 17) { $nr = $nr + $dx }
    if ($edge -eq 12 -or $edge -eq 13 -or $edge -eq 14) { $nt = $nt + $dy }
    if ($edge -eq 15 -or $edge -eq 16 -or $edge -eq 17) { $nb = $nb + $dy }
    $minW = [int](320 * $scale); $minH = [int](300 * $scale)
    if (($nr - $nl) -lt $minW) {
      if ($edge -eq 10 -or $edge -eq 13 -or $edge -eq 16) { $nl = $nr - $minW } else { $nr = $nl + $minW }
    }
    if (($nb - $nt) -lt $minH) {
      if ($edge -eq 12 -or $edge -eq 13 -or $edge -eq 14) { $nt = $nb - $minH } else { $nb = $nt + $minH }
    }
    # SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10): stay topmost and never grab focus
    [void][PNative]::SetWindowPos($hh, [IntPtr]::Zero, $nl, $nt, ($nr - $nl), ($nb - $nt), 0x0014)
    $handled.Value = $true
    return [IntPtr]::Zero
  }

  # ---- drop: keep the size, release capture ----
  if ($msg -eq 0x0202) {                       # WM_LBUTTONUP
    if ($script:dragEdge -eq 0) { return [IntPtr]::Zero }
    [void][PNative]::ReleaseCapture()
    $wasVertical = ($script:dragEdge -eq 12 -or $script:dragEdge -eq 15 -or $script:dragEdge -eq 13 -or $script:dragEdge -eq 14 -or $script:dragEdge -eq 16 -or $script:dragEdge -eq 17)
    if ($wasVertical) { $script:userResized = $true }
    $script:dragEdge = 0
    $script:dragOrigin = $null
    $script:dragFrame = $null
    Save-PanelSize
    $handled.Value = $true
    return [IntPtr]::Zero
  }

  # ---- which edge is under the cursor ----
  if ($msg -eq 0x0005) {                       # WM_SIZE
    # Size IS the form signal: the server shrinks the window to the bubble and grows
    # it back, so following it here makes both collapse/expand instant -- no waiting
    # for the 2s poll, and no stretched card in the meantime.
    try {
      $rc = New-Object PNative+RECTX
      $hhs = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
      if ([PNative]::GetWindowRect($hhs, [ref]$rc)) {
        if (($rc.R - $rc.L) -le ($script:bubbleCutoff)) { Apply-Form 'collapsed' }
        else { Apply-Form 'expanded' }
      }
    } catch { }
    return [IntPtr]::Zero
  }
  if ($msg -ne 0x0084) { return [IntPtr]::Zero }        # WM_NCHITTEST
  if ($ExitAfterMs -gt 0) { return [IntPtr]::Zero }
  # Collapsed bubble: no resize edges (56 DIP by design, and the circle has no
  # straight border to grab). Leave the hit test to WPF so it still clicks.
  if ($script:panelForm -eq 'collapsed') { $script:dragEdge = 0; return [IntPtr]::Zero }
  if ($script:dragEdge -ne 0 -and $script:dragOrigin -ne $null) { $handled.Value = $true; return [IntPtr]$script:dragEdge }

  $band = [int]([math]::Round(7 * $scale))
  $pt = New-Object PNative+POINT
  $pt.x = $lParam.ToInt32() -band 0xFFFF
  $pt.y = ($lParam.ToInt32() -shr 16) -band 0xFFFF
  if ($pt.x -gt 32767) { $pt.x = $pt.x - 65536 }
  if ($pt.y -gt 32767) { $pt.y = $pt.y - 65536 }
  if (-not [PNative]::ScreenToClient($hh, [ref]$pt)) { return [IntPtr]::Zero }
  $c = New-Object PNative+RECTX
  if (-not [PNative]::GetClientRect($hh, [ref]$c)) { return [IntPtr]::Zero }

  $onL = ($pt.x -ge $c.L) -and ($pt.x -lt ($c.L + $band))
  $onR = ($pt.x -le $c.R) -and ($pt.x -gt ($c.R - $band))
  $onT = ($pt.y -ge $c.T) -and ($pt.y -lt ($c.T + $band))
  $onB = ($pt.y -le $c.B) -and ($pt.y -gt ($c.B - $band))

  $code = 0
  if ($onT -and $onL) { $code = 13 } elseif ($onT -and $onR) { $code = 14 }
  elseif ($onB -and $onL) { $code = 16 } elseif ($onB -and $onR) { $code = 17 }
  elseif ($onL) { $code = 10 } elseif ($onR) { $code = 11 }
  elseif ($onT) { $code = 12 } elseif ($onB) { $code = 15 }
  if ($code -eq 0) { $script:dragEdge = 0; return [IntPtr]::Zero }
  $script:dragEdge = $code
  $handled.Value = $true
  return [IntPtr]$code
}

$win.Add_SourceInitialized({
  try {
    $hh2 = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
    $src = [System.Windows.Interop.HwndSource]::FromHwnd($hh2)
    if ($src) { [void]$src.AddHook($script:hitHook) }
  } catch { Write-Stage 'hit-test hook failed' }
})
Write-Stage "resize edges enabled"

Write-Stage "about to ShowDialog"
if ($ExitAfterMs -gt 0) {
  $timer = New-Object System.Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds($ExitAfterMs)
  $timer.Add_Tick({ $timer.Stop(); $win.Close() })
  $timer.Start()
}

# ---- P3 live data ----
# ASCII-only on purpose: every visible string comes from panel/ui.json, which is
# read with an explicit UTF8 decoder. Never put a CJK literal in this file.
function Get-PanelData([string]$url) {
  $req = [System.Net.HttpWebRequest]::Create($url)
  $req.Proxy = $null                 # localhost: never route through a proxy
  $req.Timeout = 2000
  $req.ReadWriteTimeout = 2000
  $resp = $req.GetResponse()
  try {
    $sr = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $text = $sr.ReadToEnd()
    $sr.Dispose()
  } finally {
    $resp.Close()
  }
  return ($text | ConvertFrom-Json)
}

# One timeline row:  [HH:mm] [dot] [verb] [who / why, ellipsised]
# Built as a Grid so time / verb / detail can carry different colours without
# rich-text markup, and the detail column trims instead of wrapping.
function New-EventRow($e) {
  $g = New-Object System.Windows.Controls.Grid
  $g.Margin = New-Object System.Windows.Thickness(0, 5, 0, 5)
  foreach ($colW in @('Auto', 'Auto', 'Auto', '*')) {
    $cd = New-Object System.Windows.Controls.ColumnDefinition
    $cd.Width = $colW
    [void]$g.ColumnDefinitions.Add($cd)
  }

  $ts = ''
  try { $ts = ([DateTimeOffset]::FromUnixTimeMilliseconds([long]$e.ts)).LocalDateTime.ToString('HH:mm') } catch { }
  $time = New-Object System.Windows.Controls.TextBlock
  $time.Text = $ts
  $time.Foreground = $dimBrush
  $time.FontSize = 11 * $UiScale
  $time.MinWidth = 42 * $UiScale
  $time.VerticalAlignment = 'Center'
  [System.Windows.Controls.Grid]::SetColumn($time, 0)
  [void]$g.Children.Add($time)

  $kind = [string]$e.type
  $dotBrush = $dimBrush
  if ($kind -eq 'moved') { $dotBrush = $accent }
  if ($kind -eq 'move-failed') { $dotBrush = $errorBrush }
  if ($kind -eq 'turn-done') { $dotBrush = $accent }
  if ($kind -eq 'turn-error' -or $kind -eq 'tool-failed') { $dotBrush = $errorBrush }
  if ($kind -eq 'turn-aborted') { $dotBrush = $dimBrush }
  $dot = New-Object System.Windows.Shapes.Ellipse
  $dot.Width = 6 * $UiScale
  $dot.Height = 6 * $UiScale
  $dot.Margin = New-Object System.Windows.Thickness(4, 0, 10, 0)
  $dot.Fill = $dotBrush
  $dot.VerticalAlignment = 'Center'
  [System.Windows.Controls.Grid]::SetColumn($dot, 1)
  [void]$g.Children.Add($dot)

  $verbText = $kind
  $verbBrush = $textBrush
  switch ($kind) {
    'moved'       { $verbText = [string]$ui.timeline.moved; $verbBrush = $accent }
    'skip'        { $verbText = [string]$ui.timeline.skip; $verbBrush = $dimBrush }
    'move-failed' { $verbText = [string]$ui.timeline.failed; $verbBrush = $errorBrush }
    'turn-done'   { $verbText = [string]$ui.timeline.turnDone; $verbBrush = $accent }
    'turn-error'  { $verbText = [string]$ui.timeline.turnError; $verbBrush = $errorBrush }
    'turn-aborted' { $verbText = [string]$ui.timeline.turnAborted; $verbBrush = $dimBrush }
    'turn-end'    { $verbText = [string]$ui.timeline.turnEnd; $verbBrush = $dimBrush }
    'tool-failed' { $verbText = [string]$ui.timeline.toolFailed; $verbBrush = $errorBrush }
  }
  $verb = New-Object System.Windows.Controls.TextBlock
  $verb.Text = $verbText
  $verb.Foreground = $verbBrush
  $verb.FontSize = 12 * $UiScale
  $verb.FontWeight = 'SemiBold'
  $verb.VerticalAlignment = 'Center'
  $verb.Margin = New-Object System.Windows.Thickness(0, 0, 8, 0)
  [System.Windows.Controls.Grid]::SetColumn($verb, 2)
  [void]$g.Children.Add($verb)

  $detailText = ''
  if ($e.proc) { $detailText = [string]$e.proc }
  if ($e.title) { $detailText = $detailText + ' - ' + [string]$e.title }
  if ($e.reason) { $detailText = $detailText + ' (' + [string]$e.reason + ')' }
  $detail = New-Object System.Windows.Controls.TextBlock
  $detail.Text = $detailText
  $detail.Foreground = $textBrush
  $detail.FontSize = 12 * $UiScale
  $detail.TextTrimming = 'CharacterEllipsis'
  $detail.VerticalAlignment = 'Center'
  [System.Windows.Controls.Grid]::SetColumn($detail, 3)
  [void]$g.Children.Add($detail)

  return $g
}

function Update-Timeline($events) {
  $empty.Text = [string]$ui.timeline.empty
  $timelineBox.Children.Clear()
  $list = @($events)
  if ($list.Count -eq 0) {
    $empty.Visibility = 'Visible'
    return
  }
  $empty.Visibility = 'Collapsed'
  foreach ($e in $list) {
    [void]$timelineBox.Children.Add((New-EventRow $e))
  }
  Fit-Height
}

# Auto height: the service hands us the MAX rect (400x900 DIP). With three events
# that leaves a tall empty slab that reads as "broken", so shrink to the content.
# Never grow past what we were given; never go below a usable minimum.
# Synchronous on purpose: the poll tick runs on the UI thread, so UpdateLayout()
# gives a real measurement right here (a deferred timer kept getting lost).
function Fit-Height {
  try {
    # Collapsed: the square is decided by the server, never by content height.
    if ($script:panelForm -eq 'collapsed') { return }
    # The owner dragged the edges: that size wins, stop auto-shrinking under them.
    if ($script:userResized) { return }
    if ([System.Windows.Input.Mouse]::LeftButton -eq [System.Windows.Input.MouseButtonState]::Pressed) { return }
    # Measure the CONTENT, not the body container: the body row is '*' and
    # therefore always reports the full window height (that is how the first
    # attempt computed need == max and never shrank).
    $infinite = New-Object System.Windows.Size([double]::PositiveInfinity, [double]::PositiveInfinity)
    $contentH = 0.0
    foreach ($child in $bodyStack.Children) {
      if ($child.Visibility -eq 'Collapsed') { continue }
      $child.Measure($infinite)
      $contentH += $child.DesiredSize.Height + $child.Margin.Top + $child.Margin.Bottom
    }
    $statusBar.Measure($infinite)
    $need = (54 * $UiScale) + $statusBar.DesiredSize.Height + 24 + $contentH + (48 * $UiScale) + 2
    $minH = 320 * $UiScale
    if ($need -lt $minH) { $need = $minH }
    $need = [double][math]::Round($need)
    Write-Stage ('fit-height need=' + $need + ' content=' + [math]::Round($contentH) + ' max=' + $Height + ' current=' + $win.Height)
    if ($need -lt ($Height - 1)) {
      $win.Height = $need
    }
  } catch {
    Write-Stage ('fit-height failed: ' + $_.Exception.Message)
  }
}

# P4: answer one question option back to the host (localhost, short timeout).
# Runs inside the click handler; a 2s stall on a dead port is acceptable and is
# logged rather than swallowed (rule: catch {} must leave a line).
function Send-Answer([string]$askKey, [string]$questionId, [string]$label) {
  try {
    if ($script:askBase -eq '') {
      Write-Stage 'answer skipped: askBase unknown'
      return
    }
    $url = $script:askBase + '/dsh-dual-screen/ask/answer'
    $escaped = $label.Replace('\\', '\\\\').Replace('"', '\\"')
    $body = '{"key":"' + $askKey + '","answers":[{"id":"' + $questionId + '","selected":["' + $escaped + '"]}]}'
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = 'POST'
    $req.Proxy = $null
    $req.Timeout = 2000
    $req.ReadWriteTimeout = 2000
    $req.ContentType = 'application/json; charset=utf-8'
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    $resp = $req.GetResponse()
    $resp.Close()
    Write-Stage ('answer sent: ' + $askKey + ' -> ' + $label)
  } catch {
    Write-Stage ('answer send failed: ' + $_.Exception.Message)
  }
}

# Rebuild the pending-answer card only when the ask key changes, otherwise every
# 2s poll would replace the buttons under the owner's cursor.
function Update-AskBox($asks) {
  try {
    $list = @($asks)
    if ($list.Count -eq 0) {
      if ($script:askKey -ne '') {
        $askBox.Children.Clear()
        $script:askKey = ''
      }
      return
    }
    $head = $list[0]
    $key = [string]$head.key
    if ($key -eq $script:askKey) { return }
    $script:askKey = $key
    $askBox.Children.Clear()

    foreach ($q in @($head.questions)) {
      $card = New-Object System.Windows.Controls.Border
      $card.Background = $panelBg
      $card.BorderBrush = $accent
      $card.BorderThickness = New-Object System.Windows.Thickness(1)
      $card.CornerRadius = New-Object System.Windows.CornerRadius(10)
      $card.Padding = New-Object System.Windows.Thickness(12)
      $card.Margin = New-Object System.Windows.Thickness(0, 0, 0, 8)
      $inner = New-Object System.Windows.Controls.StackPanel

      $qt = New-Object System.Windows.Controls.TextBlock
      $qt.Text = [string]$q.question
      $qt.Foreground = $textBrush
      $qt.FontSize = 13 * $UiScale
      $qt.TextWrapping = 'Wrap'
      $qt.Margin = New-Object System.Windows.Thickness(0, 0, 0, 8)
      [void]$inner.Children.Add($qt)

      $btns = New-Object System.Windows.Controls.WrapPanel
      foreach ($o in @($q.options)) {
        $label = [string]$o.label
        if ($label -eq '') { continue }
        $qid = [string]$q.id
        $b = New-Object System.Windows.Controls.Button
        $b.Content = $label
        $b.Foreground = $textBrush
        $b.Background = [System.Windows.Media.Brushes]::Transparent
        $b.BorderBrush = $accent
        $b.BorderThickness = 1
        $b.Padding = New-Object System.Windows.Thickness(12, 4, 12, 4)
        $b.Margin = New-Object System.Windows.Thickness(0, 0, 8, 8)
        $b.FontSize = 12 * $UiScale
        $b.Cursor = 'Hand'
        $b.Add_Click({ Send-Answer $key $qid $label }.GetNewClosure())
        [void]$btns.Children.Add($b)
      }
      [void]$inner.Children.Add($btns)
      $card.Child = $inner
      [void]$askBox.Children.Add($card)
    }
    Write-Stage ('ask card rendered: ' + $key + ' (' + @($head.questions).Count + ' question(s))')
    Fit-Height
  } catch {
    Write-Stage ('ask card failed: ' + $_.Exception.Message)
  }
}

# Derive the host base from DataUrl so answer POSTs go to the right port.
  try { if ($DataUrl -match '^(https?://[^/]+)') { $script:askBase = $Matches[1] } } catch { }
  $script:pollState = 'init'
if ($DataUrl -ne '') {
  $pollTimer = New-Object System.Windows.Threading.DispatcherTimer
  $pollTimer.Interval = [TimeSpan]::FromSeconds(2)
  $pollTimer.Add_Tick({
    try {
      $j = Get-PanelData $DataUrl
      if ($null -eq $j) { return }
      # Follow the server's form: collapsing/expanding from any client (the header
      # chip, curl, the sidebar) must show up here too. The server also resized the
      # window, so this only keeps the drawing in sync with it.
      try { if ($j.form) { Apply-Form ([string]$j.form) } } catch { }
      if ($j.bridge) {
        $bridgeRaw = [string]$j.bridge.status
        $bridgeText = $bridgeRaw
        if ($bridgeRaw -eq 'running') { $bridgeText = [string]$ui.bridgeRunning }
        elseif ($bridgeRaw -eq 'stopped') { $bridgeText = [string]$ui.bridgeStopped }
        elseif ($bridgeRaw -eq 'starting') { $bridgeText = [string]$ui.bridgeStarting }
        $t2.Text = [string]$ui.bridgeLabel + ' ' + $bridgeText + '  |  ' + [string]$ui.movedLabel + ' ' + [string]$j.bridge.moved
      }
      if ($j.display -and $j.display.secondary) {
        $sec = $j.display.secondary
        $secText = [string]$sec.w + 'x' + [string]$sec.h
        if ($sec.portrait) { $secText = [string]$ui.portrait + ' ' + $secText }
        # A chip click writes its result to this line; do not let the 2s poll
        # immediately wipe it (owner would never see what happened).
        $flashing = ($script:flashUntil -and (Get-Date) -lt $script:flashUntil)
        if (-not $flashing) {
          try {
            $status.Text = [string]$ui.statusRow -f [string]$j.display.primary.w, [string]$j.display.primary.h, $secText, [string]([int]([double]$sec.scale * 100))
          } catch { }
        }
      }
      # Bottom-chip settings strip mirrors the real config.
      try { if ($j.settings) { Update-Settings $j.settings } } catch { }
      # Recent sessions (the explicit "continue" target picker).
      try { if ($j.sessions) { Update-Sessions $j.sessions } } catch { }
      $ev = @($j.events) | Where-Object { [string]$_.type -ne 'hello' -and [string]$_.type -ne 'pre-move' } | Select-Object -Last 6
      Update-Timeline $ev
      # P4: pending questions from the host; rebuild only when the ask key changes.
      try {
        if ($j.asks) { Update-AskBox $j.asks } else { Update-AskBox @() }
      } catch {
        Write-Stage ('ask box update failed: ' + $_.Exception.Message)
      }
      if ($script:pollState -ne 'ok') { Write-Stage 'panel data: connected'; $script:pollState = 'ok' }
      # Pet button mirrors the host's real state, so a pet started by curl or by the
      # sidebar also shows up here -- the panel is not the source of truth.
      try {
        if ($j.pet) {
          $petState = [string]$j.pet.status
          Update-PetButton ($petState -eq 'running') ($petState -eq 'failed')
        }
      } catch { }
    } catch {
      # A dead data URL must never kill the panel: keep the window, say offline.
      # Log once per transition, not every 2s.
      if ($script:pollState -ne 'fail') {
        Write-Stage ('panel data fetch failed: ' + $_.Exception.Message)
        $script:pollState = 'fail'
      }
      $t2.Text = [string]$ui.timeline.offline
      $empty.Text = [string]$ui.timeline.offline
      $empty.Visibility = 'Visible'
    }
  })
  $pollTimer.Start()
  Write-Stage ('data polling started: ' + $DataUrl)
} else {
  Write-Stage 'no DataUrl: static panel only'
}

# Clear the previous ready file (the controller also checks pid; this is belt and braces)
try { if (Test-Path -LiteralPath $ReadyFile) { Remove-Item -LiteralPath $ReadyFile -Force } } catch { }
[void]$win.ShowDialog()
Write-Stage "ShowDialog returned"