# pet-host.ps1 -- V2 (P6) transparent whale desktop pet. ASCII-ONLY on purpose.
#
# WHY: PLAN 14.5.5 -- the collapsed state should be a real see-through whale pet,
# not a round avatar bubble. WPF does this in one attribute
# (AllowsTransparency + WindowStyle=None), while an Electron shell would add
# 100MB+ and DSH's own Electron cannot host plugin runtime.
#
# Behaviours in this first slice:
#   - always-on-top, never steals focus (ShowActivated=false)
#   - click        -> POST <BaseUrl>/dsh-dual-screen/toggle (expand the panel)
#   - drag         -> moves the pet; position is remembered in pet-pos.json
#   - double click -> reset to the default corner
#   - idle animation: slow breathing (scale) + blink (opacity pulse)
#
# -ExitAfterMs N is for the acceptance probe (closes itself, writes a ready file).
param(
  [string]$AvatarFile = 'E:\dsh\profiles\desktop\node_modules\dsh-dual-screen\panel\avatar.png',
  [string]$DataDir = 'E:\dsh\dual-screen',
  [string]$BaseUrl = 'http://127.0.0.1:8490',
  [int]$Size = 120,
  [int]$PosX = -2147483648,
  [int]$PosY = -2147483648,
  [int]$ExitAfterMs = 0,
  [string]$ReadyFile = ''
)
$ErrorActionPreference = 'Stop'

function Write-Stage([string]$msg) {
  try {
    $line = (Get-Date).ToString('HH:mm:ss.fff') + ' [pet] ' + $msg
    Add-Content -LiteralPath (Join-Path $DataDir 'pet-host.log') -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
  } catch { }
}

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml, System.Windows.Forms

# --- secondary work area (physical px); fall back to the primary ---
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PetDpi {
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
}
'@
[void][PetDpi]::SetProcessDpiAwarenessContext([IntPtr](-4))
$screens = [System.Windows.Forms.Screen]::AllScreens
$target = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1
if (-not $target) { $target = $screens | Where-Object { $_.Primary } | Select-Object -First 1 }
$wa = $target.WorkingArea
if (-not (Test-Path -LiteralPath $DataDir)) { New-Item -ItemType Directory -Force -Path $DataDir | Out-Null }

# --- remembered position (written on drag end) ---
$posFile = Join-Path $DataDir 'pet-pos.json'
if ($PosX -eq -2147483648 -or $PosY -eq -2147483648) {
  $PosX = $wa.X + 40
  $PosY = $wa.Y + $wa.Height - $Size - 80
  if (Test-Path -LiteralPath $posFile) {
    try {
      $saved = Get-Content -LiteralPath $posFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($null -ne $saved.x -and $null -ne $saved.y) { $PosX = [int]$saved.x; $PosY = [int]$saved.y }
    } catch { Write-Stage ('pos read failed: ' + $_.Exception.Message) }
  }
}

$win = New-Object System.Windows.Window
$win.WindowStyle = 'None'
$win.AllowsTransparency = $true            # <- the whole reason this is WPF and not Edge/Electron
$win.Background = [System.Windows.Media.Brushes]::Transparent
$win.ShowInTaskbar = $false
$win.ShowActivated = $false
$win.Topmost = $true
$win.ResizeMode = 'NoResize'
$win.Width = $Size
$win.Height = $Size
$win.Left = $PosX
$win.Top = $PosY

$root = New-Object System.Windows.Controls.Grid
$root.Background = [System.Windows.Media.Brushes]::Transparent
$win.Content = $root

$img = New-Object System.Windows.Controls.Image
$img.Stretch = 'Uniform'
$img.Source = $null
$img.RenderTransformOrigin = New-Object System.Windows.Point(0.5, 0.5)
$scale = New-Object System.Windows.Media.ScaleTransform(1.0, 1.0)
$img.RenderTransform = $scale
$img.Cursor = 'Hand'
[void]$root.Children.Add($img)

if (Test-Path -LiteralPath $AvatarFile) {
  try {
    $bi = New-Object System.Windows.Media.Imaging.BitmapImage
    $bi.BeginInit(); $bi.CacheOption = 'OnLoad'
    $bi.UriSource = New-Object Uri($AvatarFile, [System.UriKind]::Absolute)
    $bi.EndInit()
    $img.Source = $bi
    Write-Stage ('avatar loaded: ' + $AvatarFile)
  } catch { Write-Stage ('avatar load failed: ' + $_.Exception.Message) }
} else {
  Write-Stage 'avatar missing, pet will be an empty (transparent) window'
}

# --- breathing: 1.00 -> 1.04 -> 1.00 every 3.2s, never steals focus ---
$breath = New-Object System.Windows.Media.Animation.DoubleAnimation
$breath.From = 1.0
$breath.To = 1.04
$breath.Duration = [System.Windows.Duration]::new([TimeSpan]::FromSeconds(1.6))
$breath.AutoReverse = $true
$breath.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
$breath.EasingFunction = New-Object System.Windows.Media.Animation.SineEase
$scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleXProperty, $breath)
$scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleYProperty, $breath)

# --- blink: brief dip in opacity, randomised so it does not look metronomic ---
function Start-Blink {
  $blink = New-Object System.Windows.Media.Animation.DoubleAnimation
  $blink.From = 1.0; $blink.To = 0.72
  $blink.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(110))
  $blink.AutoReverse = $true
  $blink.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::new(2)
  $img.BeginAnimation([System.Windows.Controls.Image]::OpacityProperty, $blink)
}

# --- click: expand the panel; drag: move; double click: reset corner ---
$dragStart = $null
$moved = $false
$img.Add_MouseLeftButtonDown({
  param($src, $ev)
  $script:dragStart = $ev.GetPosition($win)
  $script:moved = $false
  try { $win.DragMove(); $script:moved = $true } catch { }
})
$img.Add_MouseLeftButtonUp({
  param($src, $ev)
  if ($script:moved) {
    $PosX = [int]$win.Left; $PosY = [int]$win.Top
    try {
      ('{ "x": ' + $PosX + ', "y": ' + $PosY + ' }') | Set-Content -LiteralPath $posFile -Encoding UTF8
      Write-Stage ('pos saved ' + $PosX + ',' + $PosY)
    } catch { Write-Stage ('pos save failed: ' + $_.Exception.Message) }
    return
  }
  try {
    $req = [System.Net.HttpWebRequest]::Create($BaseUrl + '/dsh-dual-screen/toggle')
    $req.Method = 'POST'; $req.Proxy = $null; $req.Timeout = 2000
    $bytes = [Text.Encoding]::UTF8.GetBytes('{}')
    $req.ContentType = 'application/json'
    $req.ContentLength = $bytes.Length
    $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
    $resp = $req.GetResponse(); $resp.Close()
    Write-Stage 'click -> toggle sent'
  } catch { Write-Stage ('click toggle failed: ' + $_.Exception.Message) }
})
$img.Add_MouseRightButtonUp({
  $PosX = [int]($wa.X + 40)
  $PosY = [int]($wa.Y + $wa.Height - $Size - 80)
  $win.Left = $PosX; $win.Top = $PosY
  try { ('{ "x": ' + $PosX + ', "y": ' + $PosY + ' }') | Set-Content -LiteralPath $posFile -Encoding UTF8 } catch { }
  Write-Stage 'reset position'
})

$onShow = {
  $h = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
  $line = '{"pet":"ready","pid":' + $PID + ',"hwnd":"0x' + ([long]$h).ToString('X') + '","rect":[' + [int]$win.Left + ',' + [int]$win.Top + ',' + [int]$win.Width + ',' + [int]$win.Height + ']}'
  if ($ReadyFile -ne '') {
    try {
      $dir = Split-Path -Parent $ReadyFile
      if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
      [IO.File]::WriteAllText($ReadyFile, $line, (New-Object Text.UTF8Encoding($false)))
    } catch { Write-Stage ('ready write failed: ' + $_.Exception.Message) }
  }
  Write-Stage $line
}
$win.Add_SourceInitialized($onShow)

# blink timer
$blinkTimer = New-Object System.Windows.Threading.DispatcherTimer
$blinkTimer.Interval = [TimeSpan]::FromSeconds(3.7)
$blinkTimer.Add_Tick({ Start-Blink })
$blinkTimer.Start()

if ($ExitAfterMs -gt 0) {
  $timer = New-Object System.Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds($ExitAfterMs)
  $timer.Add_Tick({ $timer.Stop(); $win.Close() })
  $timer.Start()
}

Write-Stage ('starting pet at ' + $PosX + ',' + $PosY + ' size=' + $Size)
[void]$win.ShowDialog()