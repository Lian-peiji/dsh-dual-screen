// fix-layered-clickthrough.mjs -- stop WPF from making the pet a LAYERED window.
//
// Root cause (measured 2026-11-06): with AllowsTransparency=true WPF creates the window
// with WS_EX_LAYERED (0x00080000 -- visible in the ex-style as 0x80108 alongside
// TOPMOST and WINDOWEDGE). WindowFromPoint then reports the desktop for EVERY pixel of
// the pet, including the opaque character: the layered surface never takes hit-tests,
// so Chromium never receives a mousedown and dragging is impossible. The page handlers
// and the C# web-message plumbing were fine all along.
//
// Fix: AllowsTransparency=false. WebView2's own DefaultBackgroundColor=Transparent still
// yields a see-through pet, because the browser composites with per-pixel alpha inside
// an ordinary window; WPF no longer wraps everything in a layered surface, so the window
// takes hit-tests normally.
//
// Trade-off, recorded honestly: WPF cannot do a transparent BACKGROUND without
// AllowsTransparency, so the window gets a solid Brush as its base colour. We use
// Transparent anyway -- on a non-layered window WPF ignores alpha for the background,
// but nothing paints it because the WebView2 child covers the entire client area and
// draws transparent pixels itself. If a future WPF version paints black instead, set
// Background to a colour matching the wallpaper or revisit with a DWM-based approach.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/pet-webview.ps1'
let s = readFileSync(p, 'utf8')

const anchor = `    Win.WindowStyle = WindowStyle.None;
    Win.AllowsTransparency = true;`
if (!s.includes(anchor)) throw new Error('window style anchor missing')

s = s.replace(anchor, `    Win.WindowStyle = WindowStyle.None;
    // NOT AllowsTransparency: that makes the HWND layered, and a layered window answers
    // WindowFromPoint with the desktop for every pixel -- the pet becomes unclickable and
    // therefore undraggable. WebView2 composites its own per-pixel alpha, so the pet still
    // looks transparent inside an ordinary window.
    Win.AllowsTransparency = false;`)

writeFileSync(p, s, 'utf8')
console.log('AllowsTransparency disabled:', s.includes('Win.AllowsTransparency = false'))