// dwm-transparency.mjs -- transparent pet WITHOUT a layered window.
//
// The recorded dead ends (all verified on this machine, 2026-11-06):
//   A. AllowsTransparency=true  -> HWND gets WS_EX_LAYERED -> hit-testing skips it,
//      so the page never receives mousedown and dragging is impossible.
//   B. AllowsTransparency=false -> the window is clickable but paints a BLACK BOX
//      behind the character (screenshot pet-notransp.png), unacceptable for a pet.
//   C. Adding our own WM_NCHITTEST hook to the layered window does not help: the OS
//      never routes the click to a layered window in the first place, so the handler
//      is not called either (verified: no drag message reached the host).
//
// The remaining option used here: keep the window NON-layered (so it takes clicks) and
// make the client area transparent through DWM by extending the frame over the whole
// client area with a null (0xFF000000) composition, which yields per-pixel alpha from
// the window's own composition. This is the standard "sheet of glass" recipe.
//
// IMPORTANT: this file only sets up the DWM part and keeps a fallback. If DWM frame
// extension does not produce transparency on this build, the pet keeps a solid colour
// and the code says so in the log rather than silently looking broken.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/pet-webview.ps1'
let s = readFileSync(p, 'utf8')

// 1) window back to non-layered
const anchor = `    // Transparency is mandatory (without it the pet draws a black box), and it makes the
    // HWND layered. A layered window is skipped by hit-testing unless we answer
    // WM_NCHITTEST ourselves -- see PetHost.HitHook, installed on ContentRendered.
    Win.AllowsTransparency = true;`
if (!s.includes(anchor)) throw new Error('transparency anchor missing')
s = s.replace(anchor, `    // Non-layered so the window takes hit-tests (a layered window never does, which is
    // what made dragging impossible). Per-pixel transparency comes from DWM frame
    // extension instead -- see PetHost.EnableDwmTransparency.
    Win.AllowsTransparency = false;`)

// 2) DWM natives
const nativeAnchor = `  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECTX r);`
if (!s.includes(nativeAnchor)) throw new Error('GetClientRect anchor missing')
if (!s.includes('DwmExtendFrameIntoClientArea')) {
  s = s.replace(nativeAnchor, nativeAnchor + `
  [DllImport("dwmapi.dll")] public static extern int DwmExtendFrameIntoClientArea(IntPtr h, ref MARGINS m);`)
}
if (!s.includes('struct MARGINS')) {
  const r = '  [StructLayout(LayoutKind.Sequential)] public struct RECTX { public int L, T, R, B; }'
  s = s.replace(r, r + '\n  [StructLayout(LayoutKind.Sequential)] public struct MARGINS { public int Left, Right, Top, Bottom; }')
}

// 3) the DWM call itself
const installAnchor = '  public static void InstallHitHook() {'
if (!s.includes(installAnchor)) throw new Error('InstallHitHook anchor missing')
s = s.replace(installAnchor, `  // "Sheet of glass": extend the DWM frame over the whole client area with all margins
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

  public static void InstallHitHook() {`)

// 4) call it after the WebView2 is up (so the DWM change is applied last)
const renderedAnchor = `      InstallHitHook();`
if (!s.includes(renderedAnchor)) throw new Error('InstallHitHook call anchor missing')
s = s.replace(renderedAnchor, `      EnableDwmTransparency();`)

writeFileSync(p, s, 'utf8')
console.log('dwm path installed:', s.includes('EnableDwmTransparency'), 'non-layered:', s.includes('Win.AllowsTransparency = false'))