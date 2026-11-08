// implement-ipc-drag.mjs -- drag the pet by moving the window from the main process,
// driven by pointer events in the renderer.
//
// Why not -webkit-app-region: drag: that path needs the OS to treat the click as a
// window-activation drag. This window is created with alwaysOnTop + skipTaskbar, and
// Electron consequently sets WS_EX_NOACTIVATE, so the activation never happens and
// app-region drags do nothing (measured 2026-11-06: window did not move at all).
//
// The reliable route is the same one used for the WebView2 host: the page reports the
// gesture, the host moves the window. Here the channel is IPC instead of a web message.
import { readFileSync, writeFileSync } from 'node:fs'

const mainPath = 'J:/大肥鱼游乐场/dsh-dual-screen/pet-electron/main.js'
let m = readFileSync(mainPath, 'utf8')

// ---- 1) main.js: handle the drag messages ----
const anchor = "  win.on('closed', () => { log('window closed'); win = null })"
if (!m.includes(anchor)) throw new Error('main anchor missing')
m = m.replace(anchor, anchor + `

  // ---- drag driven by the renderer ----
  // The page posts {type:'pet-drag', phase, dx, dy}; we move the window by the delta
  // since the previous report. Deltas rather than absolute coordinates keep this
  // immune to DPI differences between CSS pixels and physical window position.
  const { ipcMain } = require('electron')
  let dragBase = null
  ipcMain.on('pet-drag', (event, payload) => {
    try {
      if (!win) return
      if (payload.phase === 'start') {
        dragBase = win.getBounds()
        log('drag start')
        return
      }
      if (payload.phase === 'move') {
        if (!dragBase) return
        const nx = Math.round(dragBase.x + payload.dx)
        const ny = Math.round(dragBase.y + payload.dy)
        win.setBounds({ x: nx, y: ny, width: dragBase.width, height: dragBase.height })
        return
      }
      if (payload.phase === 'end') {
        dragBase = null
        savePosition()
        log('drag end')
      }
    } catch (e) { log('drag failed: ' + e.message) }
  })`)

// ---- 2) webPreferences: expose a tiny preload so the page can reach ipcRenderer ----
const wp = `      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
      },`
if (!m.includes(wp)) throw new Error('webPreferences anchor missing')
m = m.replace(wp, `      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        // A dedicated preload exposes exactly one function (window.petDrag) and nothing
        // else. contextBridge keeps the renderer sandboxed.
        preload: require('path').join(__dirname, 'preload.js'),
      },`)

writeFileSync(mainPath, m, 'utf8')
console.log('main.js: ipc drag wired')

// ---- 3) preload.js ----
const preload = `// preload.js -- the ONLY bridge between the pet page and the window.
//
// The page needs to move the window (dragging). contextIsolation is on, so we expose a
// single narrow function instead of handing over ipcRenderer.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petHost', {
  engine: 'electron',
  /** phase: 'start' | 'move' | 'end'; dx/dy in CSS pixels since the drag started */
  drag(phase, dx, dy) {
    try { ipcRenderer.send('pet-drag', { phase: phase, dx: dx || 0, dy: dy || 0 }) } catch (e) { }
  },
})
`
writeFileSync('J:/大肥鱼游乐场/dsh-dual-screen/pet-electron/preload.js', preload, 'utf8')
console.log('preload.js written')
