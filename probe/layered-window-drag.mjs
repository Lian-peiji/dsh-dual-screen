// layered-window-drag.mjs -- keep per-pixel transparency AND make the pet draggable.
//
// The two constraints fight each other:
//   * Transparent pet  -> WPF AllowsTransparency -> HWND is WS_EX_LAYERED.
//   * Layered windows answer WM_NCHITTEST with HTTRANSPARENT by default, so
//     WindowFromPoint skips them entirely and Chromium never gets a mousedown.
//     Turning AllowsTransparency off instead paints a black box (verified by
//     screenshot), so "just disable it" is not an option.
//
// The way out: keep the layered window for transparency, and handle WM_NCHITTEST in
// our own window procedure, returning HTCLIENT for the pet's body so the click is
// delivered. The page then reports the drag over the web-message channel exactly as
// before (that half worked already). For the hit region we answer HTCLIENT in a
// centred square that covers the character; the rest stays HTTRANSPARENT so clicks
// pass through the transparent margin.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/pet-webview.ps1'
let s = readFileSync(p, 'utf8')

// ---- 1) transparency back on ----
const anchorOff = `    // NOT AllowsTransparency: that makes the HWND layered, and a layered window answers
    // WindowFromPoint with the desktop for every pixel -- the pet becomes unclickable and
    // therefore undraggable. WebView2 composites its own per-pixel alpha, so the pet still
    // looks transparent inside an ordinary window.
    Win.AllowsTransparency = false;`
if (!s.includes(anchorOff)) throw new Error('transparency anchor missing')
s = s.replace(anchorOff, `    // Transparency is mandatory (without it the pet draws a black box), and it makes the
    // HWND layered. A layered window is skipped by hit-testing unless we answer
    // WM_NCHITTEST ourselves -- see PetHost.HitHook, installed on ContentRendered.
    Win.AllowsTransparency = true;`)

// ---- 2) native pieces for the hit hook ----
const nativeAnchor = `  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);`
if (!s.includes(nativeAnchor)) throw new Error('SetWindowPos anchor missing')
if (!s.includes('GetClientRect')) {
  s = s.replace(nativeAnchor, nativeAnchor + `
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECTX r);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);`)
}
const rectAnchor = '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }'
if (!s.includes('struct RECTX')) {
  s = s.replace(rectAnchor, rectAnchor + '\n  [StructLayout(LayoutKind.Sequential)] public struct RECTX { public int L, T, R, B; }')
}

// ---- 3) install the hit hook + expose it ----
const stageAnchor = `  public static void Stage(string msg) {`
if (!s.includes(stageAnchor)) throw new Error('Stage anchor missing')
s = s.replace(stageAnchor, `  // Fraction of the window width/height that counts as "on the pet". The character is
  // drawn centred by the page with object-fit:contain, so a centred box around 60% of
  // the window covers the body while leaving the transparent corners click-through.
  public const double HIT_FRACTION = 0.72;

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

  public static void Stage(string msg) {`)

// ---- 4) call it from OnRendered (after the control is up) ----
const renderedAnchor = `      Root.Children.Add(View);
      Stage("control added");`
if (!s.includes(renderedAnchor)) throw new Error('OnRendered anchor missing')
s = s.replace(renderedAnchor, `      Root.Children.Add(View);
      Stage("control added");
      InstallHitHook();`)

writeFileSync(p, s, 'utf8')
console.log('layered hit hook installed:', s.includes('InstallHitHook'), 'transparency:', s.includes('Win.AllowsTransparency = true'))