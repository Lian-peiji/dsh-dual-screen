// fix-mouse-accept.mjs -- the pet must ACCEPT the mouse, not ignore it.
//
// Root cause found 2026-11-06: Chromium creates transparent windows with
// setIgnoreMouseEvents semantics such that a fully transparent composition still
// swallows nothing -- and dsh-pet goes further, calling
//   setWindowIgnore(win, true)   // ignore = true right after creation
// i.e. its windows are click-through BY DEFAULT and it flips them off only while the
// cursor is near the pet. Our window never called setIgnoreMouseEvents at all, and on
// Windows a layered transparent BrowserWindow starts in the "ignore" state anyway, so
// WindowFromPoint returned explorer's desktop for every pixel.
//
// Fix: explicitly call setIgnoreMouseEvents(false) after the window is shown.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/pet-electron/main.js'
let m = readFileSync(p, 'utf8')

const anchor = `    win.once('ready-to-show', () => {
      win.show()`
if (!m.includes(anchor)) throw new Error('ready-to-show anchor missing')

m = m.replace(anchor, `    win.once('ready-to-show', () => {
      win.show()
      // Accept the mouse. On Windows a transparent BrowserWindow is click-through by
      // default; without this call WindowFromPoint never reports the pet and no drag,
      // click or hover can ever reach the page.
      try { win.setIgnoreMouseEvents(false) } catch (e) { log('setIgnoreMouseEvents failed: ' + e.message) }`)

writeFileSync(p, m, 'utf8')
console.log('mouse acceptance wired:', m.includes('setIgnoreMouseEvents(false)'))