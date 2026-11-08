# pet-webview.ps1 -- transparent pet window driven by WebView2 + VP9-alpha webm.
#
# Why this exists (2026-11-06, owner: "the current pet image is not good enough,
# go find a mature community solution"):
#   The old WPF pet could only scale a single PNG, so it looked like a static icon.
#   The community plugin dsh-pet (MIT) ships hand-drawn VP9-alpha webm clips that
#   WPF cannot play at all. WebView2 can, and the runtime is already installed on
#   this machine, so the pet is now a tiny HTML page inside a transparent window.
#
# THE LOADING PROBLEM (three failures before this worked):
#   1. Add-Type -Path on the plugin drive -> HRESULT 0x80131515, J: is untrusted.
#   2. Assembly.Load(bytes) -> loads, but WPF re-resolves by name later and the
#      AppDomain-resolve handler recursing into Load blew the stack.
#   3. Add-Type -ReferencedAssemblies compiles, but the emitted assembly records a
#      hard name dependency that the CLR still cannot bind outside probe paths.
# The working order is: put the DLLs in the DATA dir (E:), load them there with
# LoadFrom (which registers them in the load-from context so later name lookups
# succeed), and only then compile the shim that references those types.
#
# ASCII-only (PS 5.1 reads BOM-less .ps1 as ANSI and CJK eats the next ASCII byte).
param(
  [string]$DataDir = 'E:\dsh\dual-screen',
  [string]$AssetDir = '',
  # Full page URL. When set we navigate there (plugin HTTP origin) instead of
  # loading pet.html from disk: theme.json and the mood endpoint are fetched over
  # HTTP, and file:// fetches are blocked as opaque origins.
  [string]$PageUrl = '',
  [string]$BaseUrl = '',
  [int]$Size = 240,
  [int]$PosX = -2147483648,
  [int]$PosY = -2147483648,
  [string]$ReadyFile = 'E:\dsh\dual-screen\pet-ready.json',
  [int]$ExitAfterMs = 0
)

$ErrorActionPreference = 'Stop'
$BinDir = $PSScriptRoot

function Write-Stage([string]$msg) {
  try {
    $line = (Get-Date).ToString('HH:mm:ss.fff') + ' [petwv] ' + $msg
    $logPath = Join-Path $DataDir 'pet-host.log'
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
  } catch { }
}

Write-Stage ('start size=' + $Size + ' asset=' + $AssetDir)

# ---- WebView2 runtime present? ----
$wvKey = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$wvVer = $null
try { $wvVer = (Get-ItemProperty -Path $wvKey -ErrorAction Stop).pv } catch { }
if (-not $wvVer) {
  Write-Stage 'WebView2 runtime NOT FOUND'
  Write-Output '{"pet":"error","reason":"webview2-missing"}'
  exit 2
}
Write-Stage ('webview2 runtime ' + $wvVer)

# ---- SDK assemblies -> data dir (trusted, and a directory LoadFrom can use) ----
$sdkSrc = Join-Path $BinDir 'webview2'
$sdkDst = Join-Path $DataDir 'webview2'
if (-not (Test-Path -LiteralPath $sdkDst)) { New-Item -ItemType Directory -Force -Path $sdkDst | Out-Null }
foreach ($name in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.Wpf.dll')) {
  $src = Join-Path $sdkSrc $name
  $dst = Join-Path $sdkDst $name
  if (-not (Test-Path -LiteralPath $dst)) {
    if (-not (Test-Path -LiteralPath $src)) {
      Write-Stage ('SDK assembly missing: ' + $src)
      Write-Output '{"pet":"error","reason":"sdk-missing"}'
      exit 3
    }
    Copy-Item -LiteralPath $src -Destination $dst -Force
    Write-Stage ('copied ' + $name + ' -> ' + $sdkDst)
  }
}
$coreDll = Join-Path $sdkDst 'Microsoft.Web.WebView2.Core.dll'
$wpfDll = Join-Path $sdkDst 'Microsoft.Web.WebView2.Wpf.dll'

# LoadFrom registers the assemblies in the load-from context; a later bare-name
# lookup by the shim then binds to these exact files instead of probing for them.
$asmCore = [System.Reflection.Assembly]::LoadFrom($coreDll)
$asmWpf = [System.Reflection.Assembly]::LoadFrom($wpfDll)
Write-Stage ('SDK loaded: ' + $asmCore.GetName().Version + ' / ' + $asmWpf.GetName().Version)

# ---- native + C# shim ----
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml, System.Windows.Forms

$wpfRefs = @(
  'PresentationFramework', 'PresentationCore', 'WindowsBase', 'System.Xaml',
  'System.Windows.Forms', 'System.Drawing'
) | ForEach-Object {
  try { [System.Reflection.Assembly]::LoadWithPartialName($_).Location } catch { }
} | Where-Object { $_ }

Add-Type -ReferencedAssemblies ($wpfRefs + @($coreDll, $wpfDll)) -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

public static class PetNative {
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("winmm.dll")] public static extern int timeBeginPeriod(int ms);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECTX r);
  [DllImport("dwmapi.dll")] public static extern int DwmExtendFrameIntoClientArea(IntPtr h, ref MARGINS m);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct RECTX { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MARGINS { public int Left, Right, Top, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}

public static class PetHost {
  public static Window Win;
  public static WebView2 View;
  public static Grid Root;
  public static string PagePath;
  public static string Log;

  // Drag bookkeeping. Screen coordinates come from the page (Chromium reports
  // physical pixels inside a DPI-aware host, which is also how this window's
  // Left/Top behave), so the deltas below are applied 1:1.
  static bool dragging = false;
  static int dragStartCursorX = 0;
  static int dragStartCursorY = 0;
  static double dragStartWinLeft = 0;
  static double dragStartWinTop = 0;
  public static Action<double, double> OnDragEnd;   // PowerShell saves the position

  // Fraction of the window width/height that counts as "on the pet". The character is
  // drawn centred by the page with object-fit:contain, so a centred box around 60% of
  // the window covers the body while leaving the transparent corners click-through.
  public const double HIT_FRACTION = 0.72;

  // "Sheet of glass": extend the DWM frame over the whole client area with all margins
  // at -1. The window stays non-layered so it still receives input.
  public static void EnableDwmTransparency() {
    try {
      IntPtr hwnd = new WindowInteropHelper(Win).Handle;
      if (hwnd == IntPtr.Zero) { Stage("dwm: no hwnd"); return; }
      var m = new PetNative.MARGINS();
      m.Left = -1; m.Right = -1; m.Top = -1; m.Bottom = -1;
      int hr = PetNative.DwmExtendFrameIntoClientArea(hwnd, ref m);
      Stage("dwm extend hr=" + hr);
      // A non-layered window needs a transparent WPF background for the glass to show.
      Win.Background = Brushes.Transparent;
      Stage("dwm transparency enabled");
    } catch (Exception ex) {
      Stage("dwm failed: " + ex.Message);
    }
  }

  public static void InstallHitHook() {
    try {
      IntPtr hwnd = new WindowInteropHelper(Win).Handle;
      if (hwnd == IntPtr.Zero) { Stage("hit hook: no hwnd"); return; }
      var src = System.Windows.Interop.HwndSource.FromHwnd(hwnd);
      if (src == null) { Stage("hit hook: no HwndSource"); return; }
      src.AddHook(OnHitTest);
      Stage("hit hook installed");
    } catch (Exception ex) {
      Stage("hit hook failed: " + ex.Message);
    }
  }

  // WM_NCHITTEST = 0x0084. Returning HTCLIENT (1) makes the layered window receive the
  // click; returning HTTRANSPARENT (-1) lets it fall through to whatever is behind.
  static IntPtr OnHitTest(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled) {
    if (msg != 0x0084) return IntPtr.Zero;
    try {
      int sx = (int)(lParam.ToInt64() & 0xFFFF);
      int sy = (int)((lParam.ToInt64() >> 16) & 0xFFFF);
      if (sx > 32767) sx -= 65536;
      if (sy > 32767) sy -= 65536;

      var pt = new PetNative.POINT();
      pt.X = sx; pt.Y = sy;
      if (!PetNative.ScreenToClient(hwnd, ref pt)) return IntPtr.Zero;

      var rc = new PetNative.RECTX();
      if (!PetNative.GetClientRect(hwnd, out rc)) return IntPtr.Zero;

      double w = rc.R - rc.L;
      double h = rc.B - rc.T;
      double marginX = w * (1.0 - HIT_FRACTION) / 2.0;
      double marginY = h * (1.0 - HIT_FRACTION) / 2.0;

      bool inside = pt.X >= rc.L + marginX && pt.X <= rc.R - marginX
                 && pt.Y >= rc.T + marginY && pt.Y <= rc.B - marginY;
      handled = true;
      return inside ? (IntPtr)1 : (IntPtr)(-1);
    } catch {
      return IntPtr.Zero;
    }
  }

  public static void Stage(string msg) {
    try {
      System.IO.File.AppendAllText(Log, DateTime.Now.ToString("HH:mm:ss.fff") + " [cs] " + msg + Environment.NewLine);
    } catch { }
  }

  public static Window Build(string pagePath, string logPath, int size, double left, double top) {
    PagePath = pagePath;
    Log = logPath;
    Win = new Window();
    Win.WindowStyle = WindowStyle.None;
    // Non-layered so the window takes hit-tests (a layered window never does, which is
    // what made dragging impossible). Per-pixel transparency comes from DWM frame
    // extension instead -- see PetHost.EnableDwmTransparency.
    Win.AllowsTransparency = false;
    Win.Background = Brushes.Transparent;
    Win.ShowInTaskbar = false;
    Win.ShowActivated = false;
    Win.Topmost = true;
    Win.Width = size;
    Win.Height = size;
    Win.Left = left;
    Win.Top = top;

    Root = new Grid();
    Root.Background = Brushes.Transparent;
    Win.Content = Root;

    Win.ContentRendered += OnRendered;
    return Win;
  }

  static void OnRendered(object sender, EventArgs e) {
    try {
      View = new WebView2();
      View.DefaultBackgroundColor = System.Drawing.Color.Transparent;
      View.HorizontalAlignment = HorizontalAlignment.Stretch;
      View.VerticalAlignment = VerticalAlignment.Stretch;
      Root.Children.Add(View);
      Stage("control added");
      EnableDwmTransparency();

      // WebView2 needs a WRITABLE user-data folder. Without one it returns
      // E_ACCESSDENIED (0x80070005) because the default location next to the
      // runtime install is not writable by a normal user.
      string userData = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "dsh-dual-screen", "WebView2");
      System.IO.Directory.CreateDirectory(userData);
      Stage("user data: " + userData);
      var env = CoreWebView2Environment.CreateAsync(null, userData, null).GetAwaiter().GetResult();
      Stage("environment ready");

      var task = View.EnsureCoreWebView2Async(env);
      task.ContinueWith(t => {
        if (t.IsFaulted) {
          Stage("EnsureCoreWebView2 FAULT: " + t.Exception.GetBaseException().Message);
          return;
        }
        Win.Dispatcher.Invoke(new Action(() => {
          try {
            var core = View.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.WebMessageReceived += OnWebMessage;
            Stage("web message channel wired");
            core.Navigate(PagePath);   // already an absolute http(s) or file URI
            Stage("navigated");
          } catch (Exception ex) {
            Stage("post-init failed: " + ex.Message);
          }
        }));
      });
      Stage("EnsureCoreWebView2Async started");
    } catch (Exception ex) {
      Stage("OnRendered failed: " + ex.Message);
    }
  }

  // "drag:<phase>:<screenX>:<screenY>[:moved]" from the page.
  static void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
    try {
      string raw;
      try { raw = e.TryGetWebMessageAsString(); } catch { return; }
      if (string.IsNullOrEmpty(raw) || !raw.StartsWith("drag:")) return;
      var parts = raw.Split(':');
      if (parts.Length < 4) return;
      string phase = parts[1];
      int sx, sy;
      if (!int.TryParse(parts[2], out sx) || !int.TryParse(parts[3], out sy)) return;
      bool moved = parts.Length > 4 && parts[4] == "moved";

      var helper = new WindowInteropHelper(Win);
      IntPtr hwnd = helper.Handle;
      if (hwnd == IntPtr.Zero) return;

      if (phase == "start") {
        dragging = true;
        dragStartCursorX = sx;
        dragStartCursorY = sy;
        dragStartWinLeft = Win.Left;
        dragStartWinTop = Win.Top;
        return;
      }
      if (phase == "move") {
        if (!dragging) return;
        int dx = sx - dragStartCursorX;
        int dy = sy - dragStartCursorY;
        // SWP_NOSIZE(1) | SWP_NOZORDER(4) | SWP_NOACTIVATE(16): never resize,
        // stay topmost, never steal focus from whatever the owner is typing in.
        PetNative.SetWindowPos(hwnd, IntPtr.Zero,
          (int)Math.Round(dragStartWinLeft) + dx,
          (int)Math.Round(dragStartWinTop) + dy,
          0, 0, 0x0001 | 0x0004 | 0x0010);
        return;
      }
      if (phase == "end") {
        dragging = false;
        if (moved && OnDragEnd != null) {
          try { OnDragEnd(Win.Left, Win.Top); } catch { }
        }
        return;
      }
    } catch (Exception ex) {
      Stage("drag msg failed: " + ex.Message);
    }
  }

  public static string Exec(string js) {
    try {
      if (View == null || View.CoreWebView2 == null) return "";
      var t = View.CoreWebView2.ExecuteScriptAsync(js);
      t.Wait(1500);
      return t.Status == System.Threading.Tasks.TaskStatus.RanToCompletion ? t.Result : "";
    } catch { return ""; }
  }
}
'@

Write-Stage 'C# shim compiled'

[void][PetNative]::SetProcessDpiAwarenessContext([IntPtr](-4))
[void][PetNative]::timeBeginPeriod(1)

# ---- target monitor: secondary first, else primary ----
$screens = [System.Windows.Forms.Screen]::AllScreens
$target = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1
if (-not $target) { $target = $screens | Where-Object { $_.Primary } | Select-Object -First 1 }
$wa = $target.WorkingArea
if (-not (Test-Path -LiteralPath $DataDir)) { New-Item -ItemType Directory -Force -Path $DataDir | Out-Null }

# ---- remembered position ----
$posFile = Join-Path $DataDir 'pet-pos.json'
if ($PosX -eq -2147483648 -or $PosY -eq -2147483648) {
  $PosX = $wa.X + 60
  $PosY = $wa.Y + $wa.Height - $Size - 120
  if (Test-Path -LiteralPath $posFile) {
    try {
      $saved = Get-Content -LiteralPath $posFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($null -ne $saved.x -and $null -ne $saved.y) { $PosX = [int]$saved.x; $PosY = [int]$saved.y }
    } catch { Write-Stage ('pos read failed: ' + $_.Exception.Message) }
  }
}

$pagePath = if ($PageUrl) { $PageUrl } else { Join-Path $AssetDir 'pet.html' }
if (-not $PageUrl -and -not (Test-Path -LiteralPath $pagePath)) {
  Write-Stage ('page missing: ' + $pagePath)
  Write-Output '{"pet":"error","reason":"page-missing"}'
  exit 4
}

$logPath = Join-Path $DataDir 'pet-host.log'
$win = [PetHost]::Build($pagePath, $logPath, $Size, [double]$PosX, [double]$PosY)

# ---- dragging ----
# The GESTURE lives in the page (see panel/pet.html): WebView2 sits on top of the
# whole client area, so WPF never sees a mouse button. The page posts
# "drag:start|move|end:<screenX>:<screenY>[:moved]" over the web message channel and
# the C# shim moves the window with SetWindowPos.
#
# PowerShell keeps exactly one job here: remember where the owner dropped it.
# Assigning a scriptblock to a C# Action<,> is enough; the shim invokes it on the UI
# thread, which is where file IO for a few bytes belongs anyway.
$script:savePos = [Action[double, double]]{
  param($wx, $wy)
  try {
    $body = '{ "x": ' + [int][math]::Round($wx) + ', "y": ' + [int][math]::Round($wy) + ' }'
    [IO.File]::WriteAllText($posFile, $body, (New-Object Text.UTF8Encoding($false)))
    Write-Stage ('pos saved ' + [int][math]::Round($wx) + ',' + [int][math]::Round($wy))
  } catch {
    Write-Stage ('pos save failed: ' + $_.Exception.Message)
  }
}
[PetHost]::OnDragEnd = $script:savePos

if ($ExitAfterMs -gt 0) {
  $timer = New-Object System.Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds($ExitAfterMs)
  $timer.Add_Tick({ $timer.Stop(); $win.Close() })
  $timer.Start()
}

# ---- ready handshake over a file (stdout is unreliable when spawned by node) ----
$script:handle = [IntPtr]::Zero
$win.Add_SourceInitialized({
  try { $script:handle = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle } catch { }
})

$readyTimer = New-Object System.Windows.Threading.DispatcherTimer
$readyTimer.Interval = [TimeSpan]::FromMilliseconds(700)
$readyTimer.Add_Tick({
  $readyTimer.Stop()
  try {
    $r = New-Object PetNative+RECT
    [void][PetNative]::GetWindowRect($script:handle, [ref]$r)
    $line = '{"pet":"ready","pid":' + $PID + ',"hwnd":"0x' + ([long]$script:handle).ToString('X') + '","rect":[' + $r.L + ',' + $r.T + ',' + ($r.R - $r.L) + ',' + ($r.B - $r.T) + '],"size":' + $Size + '}'
    if ($ReadyFile) {
      $dir = Split-Path -Parent $ReadyFile
      if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
      $tmp = $ReadyFile + '.tmp'
      [IO.File]::WriteAllText($tmp, $line, (New-Object Text.UTF8Encoding($false)))
      Move-Item -LiteralPath $tmp -Destination $ReadyFile -Force
    }
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
    Write-Stage $line
  } catch { Write-Stage ('ready write failed: ' + $_.Exception.Message) }
})
$readyTimer.Start()

Write-Stage 'about to ShowDialog'
[void]$win.ShowDialog()
Write-Stage 'closed'