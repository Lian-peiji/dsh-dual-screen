// implement-webview-drag.mjs -- make the pet draggable even though WebView2 owns the
// whole client area.
//
// Why the old code never worked: the WPF Window's MouseLeftButtonDown/MouseMove never
// fire, because the WebView2 child control receives every pointer event first and
// handles it (it is a full-bleed browser surface). So the host cannot see the drag at
// all from the WPF side.
//
// The working design: the PAGE owns the gesture and reports it to the host through
// WebView2's message channel (window.chrome.webview.postMessage -> WebMessageReceived),
// and the C# shim moves the window with Win32 SetWindowPos.
//
// Wire format is deliberately not JSON: net462 has no System.Text.Json and we do not
// want a Newtonsoft dependency just for three integers. "drag:<phase>:<x>:<y>[:moved]"
// is unambiguous and cheap to parse.
import { readFileSync, writeFileSync } from 'node:fs'

const ps1 = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/pet-webview.ps1'
let s = readFileSync(ps1, 'utf8')

// ---- 1) native SetWindowPos for the shim ----
const nativeAnchor = '  [DllImport("winmm.dll")] public static extern int timeBeginPeriod(int ms);'
if (!s.includes(nativeAnchor)) throw new Error('native anchor missing')
if (!s.includes('SetWindowPos')) {
  s = s.replace(nativeAnchor, nativeAnchor + `
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);`)
}

// ---- 2) state + drag handling inside PetHost ----
const stateAnchor = `  public static string PagePath;
  public static string Log;`
if (!s.includes(stateAnchor)) throw new Error('state anchor missing')
s = s.replace(stateAnchor, `  public static string PagePath;
  public static string Log;

  // Drag bookkeeping. Screen coordinates come from the page (Chromium reports
  // physical pixels inside a DPI-aware host, which is also how this window's
  // Left/Top behave), so the deltas below are applied 1:1.
  static bool dragging = false;
  static int dragStartCursorX = 0;
  static int dragStartCursorY = 0;
  static double dragStartWinLeft = 0;
  static double dragStartWinTop = 0;
  public static Action<double, double> OnDragEnd;   // PowerShell saves the position`)

// ---- 3) subscribe to page messages once CoreWebView2 is up ----
const readyAnchor = `            core.Navigate(PagePath);   // already an absolute http(s) or file URI`
if (!s.includes(readyAnchor)) throw new Error('ready anchor missing')
s = s.replace(readyAnchor, `            core.WebMessageReceived += OnWebMessage;
            Stage("web message channel wired");
            core.Navigate(PagePath);   // already an absolute http(s) or file URI`)

// ---- 4) the handler itself ----
const execAnchor = `  public static string Exec(string js) {`
if (!s.includes(execAnchor)) throw new Error('Exec anchor missing')
s = s.replace(execAnchor, `  // "drag:<phase>:<screenX>:<screenY>[:moved]" from the page.
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
        SetWindowPos(hwnd, IntPtr.Zero,
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

  public static string Exec(string js) {`)

writeFileSync(ps1, s, 'utf8')
console.log('C# drag handling installed:', s.includes('OnWebMessage'), s.includes('SetWindowPos'))