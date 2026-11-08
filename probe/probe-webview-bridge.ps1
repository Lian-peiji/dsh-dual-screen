# probe-webview-bridge.ps1 -- is the web-message bridge actually available in the page?
#
# The drag design depends on window.chrome.webview.postMessage reaching the host.
# This probe loads the page, executes a script that reports what it sees, and prints
# the returned JSON. Run it when drag stops working instead of guessing.
#
# ASCII only.
param(
  [string]$DataDir = 'E:\dsh\dual-screen',
  [int]$ExitAfterMs = 12000
)

$ErrorActionPreference = 'Stop'
$BinDir = 'J:\大肥鱼游乐场\dsh-dual-screen\bin'

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml, System.Windows.Forms

$sdkDst = Join-Path $DataDir 'webview2'
$coreDll = Join-Path $sdkDst 'Microsoft.Web.WebView2.Core.dll'
$wpfDll = Join-Path $sdkDst 'Microsoft.Web.WebView2.Wpf.dll'
[void][System.Reflection.Assembly]::LoadFrom($coreDll)
[void][System.Reflection.Assembly]::LoadFrom($wpfDll)

$wpfRefs = @('PresentationFramework','PresentationCore','WindowsBase','System.Xaml','System.Windows.Forms','System.Drawing') |
  ForEach-Object { try { [System.Reflection.Assembly]::LoadWithPartialName($_).Location } catch { } } |
  Where-Object { $_ }

Add-Type -ReferencedAssemblies ($wpfRefs + @($coreDll, $wpfDll)) -TypeDefinition @'
using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

public static class BridgeProbe {
  public static Window Win;
  public static WebView2 View;
  public static string PageUrl;
  public static string Result = "(not run)";

  public static Window Build(string pageUrl) {
    PageUrl = pageUrl;
    Win = new Window();
    Win.WindowStyle = WindowStyle.None;
    Win.AllowsTransparency = true;
    Win.Background = Brushes.Transparent;
    Win.ShowInTaskbar = false;
    Win.ShowActivated = false;
    Win.Topmost = true;
    Win.Width = 240; Win.Height = 240;
    Win.Left = 2700; Win.Top = 900;
    var root = new Grid();
    root.Background = Brushes.Transparent;
    Win.Content = root;
    View = new WebView2();
    View.DefaultBackgroundColor = System.Drawing.Color.Transparent;
    root.Children.Add(View);
    Win.ContentRendered += OnRendered;
    return Win;
  }

  static void OnRendered(object sender, EventArgs e) {
    string userData = System.IO.Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
      "dsh-dual-screen", "WebView2");
    System.IO.Directory.CreateDirectory(userData);
    var env = CoreWebView2Environment.CreateAsync(null, userData, null).GetAwaiter().GetResult();
    var task = View.EnsureCoreWebView2Async(env);
    task.ContinueWith(t => {
      if (t.IsFaulted) { Result = "FAULT: " + t.Exception.GetBaseException().Message; return; }
      Win.Dispatcher.Invoke(new Action(() => {
        try {
          View.CoreWebView2.Navigate(PageUrl);
        } catch (Exception ex) { Result = "navigate failed: " + ex.Message; }
      }));
    });
  }

  // Ask the page what the bridge looks like from inside.
  public static string AskPage() {
    try {
      var t = View.CoreWebView2.ExecuteScriptAsync(
        "JSON.stringify({chrome: !!window.chrome, webview: !!(window.chrome && window.chrome.webview), post: !!(window.chrome && window.chrome.webview && window.chrome.webview.postMessage), theme: (window.__petTheme||{}).id || null})");
      t.Wait(3000);
      return t.Status == TaskStatus.RanToCompletion ? t.Result : "(timeout)";
    } catch (Exception ex) { return "Exec failed: " + ex.Message; }
  }
}
'@

$page = 'http://127.0.0.1:5273/dsh-dual-screen/pet-page?theme=whale&api=http://127.0.0.1:5273'
$win = [BridgeProbe]::Build($page)

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(6000)
$timer.Add_Tick({
  $timer.Stop()
  try {
    $r = [BridgeProbe]::AskPage()
    Write-Output ('page says: ' + $r)
  } catch { Write-Output ('probe failed: ' + $_.Exception.Message) }
  $win.Close()
})
$timer.Start()

[void]$win.ShowDialog()