// add-topmost-watchdog.mjs -- keep the pet above the desktop layer.
//
// Discovered 2026-11-06: WindowFromPoint over the pet returned explorer's desktop
// window (4160x2560, the whole virtual screen), not the pet. So the pet paints
// correctly but receives no mouse input -- the desktop层 is eating every click.
//
// dsh-pet solves this with a dedicated topmost watchdog (runtime/electron-helper/
// topmost-watchdog.js). Ours re-asserts always-on-top on a timer and after the window
// regains focus, which is cheap and does not fight the user.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/pet-electron/main.js'
let m = readFileSync(p, 'utf8')

const anchor = "    win.on('closed', () => { log('window closed'); win = null })"
if (!m.includes(anchor)) throw new Error('anchor missing')

const block = `    win.on('closed', () => { log('window closed'); win = null })

    // ---- topmost watchdog ----
    // Re-asserting 'screen-saver' level matters: explorer's desktop window spans the
    // whole virtual screen and otherwise wins hit-testing, so the pet becomes
    // click-through whether we want it or not. Cheap enough to run every 3s.
    const topmostTimer = setInterval(() => {
      try {
        if (!win || win.isDestroyed()) return
        win.setAlwaysOnTop(true, 'screen-saver')
        win.moveTop()
      } catch (e) { log('topmost watchdog: ' + e.message) }
    }, 3000)
    win.on('closed', () => clearInterval(topmostTimer))`

m = m.replace(anchor, block)
writeFileSync(p, m, 'utf8')
console.log('topmost watchdog added:', m.includes('topmostTimer'))