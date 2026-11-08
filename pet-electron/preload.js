// preload.js -- the ONLY bridge between the pet page and the window.
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
  /** act: 'reset' (back to the default corner) | 'close' (quit the pet) */
  menu(act) {
    try { ipcRenderer.send('pet-menu', { act: String(act || '') }) } catch (e) { }
  },
})
