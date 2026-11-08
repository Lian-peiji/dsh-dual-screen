// main.js -- the pet's Electron main process.
//
// WHY ELECTRON AND NOT WPF (this is the whole reason this file exists):
//   WPF can do "transparent" OR "clickable", never both. AllowsTransparency=true
//   creates a layered window that stops receiving hit-tests (verified by probe:
//   every point over the pet answered "through"); turning it off paints a black
//   rectangle. Electron's transparent:true uses Chromium's own alpha compositing, so
//   the window is see-through AND still receives the mouse -- which is exactly what
//   dsh-pet relies on (runtime/electron-helper/main/windows.js).
//
// The pet therefore became a tiny Electron app that borrows the already-downloaded
// electron binary. It loads the page served by the DSH plugin, so theme assets and
// mood polling keep working over HTTP.
//
// Contract with lib/pet.js (all through argv, because there is no IPC plumbing here):
//   electron.exe <thisDir> --page=<url> --ready=<file> --x=<n> --y=<n> --size=<n>
//   --pos-file=<file> --log=<file> [--exit-after=<ms>]
'use strict'

const { app, BrowserWindow, screen } = require('electron')
const fs = require('fs')
const path = require('path')

// DPI: force one coherent coordinate space for the whole process.
//
// Measured problem (2026-11-06): the window was created at 2704,696 with size 240, but
// GetWindowRect reported 3244,639 292x292 -- a 1.22 ratio, i.e. the window was laid out
// in DIP on a scaled monitor while every Win32 probe speaks PHYSICAL pixels. Position
// and hit-testing therefore disagreed, and synthetic clicks landed outside the pet.
//
// Electron is DPI-aware by default (PerMonitorV2 via the manifest), but a child process
// launched from a non-DPI-aware parent can still inherit a virtualized space. Setting
// the switch explicitly before app-ready keeps CSS pixels == physical pixels on every
// monitor, which is what makes SetCursorPos and the drag deltas line up.
app.commandLine.appendSwitch('high-dpi-support', '1')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

// ---- argv ----
// Read a setting from the environment first (Electron drops unknown argv flags),
// then from argv for manual runs.
function arg(name, fallback) {
  const envKey = 'DSH_PET_' + name.toUpperCase().replace(/-/g, '_')
  if (process.env[envKey] !== undefined && process.env[envKey] !== '') return process.env[envKey]
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='))
  return hit ? hit.slice(name.length + 3) : fallback
}

const PAGE_URL = arg('page', '')
const READY_FILE = arg('ready', '')
const POS_FILE = arg('pos-file', '')
const LOG_FILE = arg('log', '')
const SIZE = Number(arg('size', '240')) || 240
const EXIT_AFTER = Number(arg('exit-after', '0')) || 0
// Dev-only acceptance hook. OS-level input injection turned out to be unreliable in
// this host (SetCursorPos returns False; relative moves stop short), so the pet can
// verify its own right-click path through Blink instead: Chromium's own input
// pipeline, the same one a hardware click uses. Empty = disabled (production path).
const SELFTEST = arg('selftest', '')

let startX = Number(arg('x', 'NaN'))
let startY = Number(arg('y', 'NaN'))

function log(msg) {
  try {
    if (LOG_FILE) fs.appendFileSync(LOG_FILE, new Date().toISOString().slice(11, 23) + ' [el] ' + msg + '\n')
  } catch { /* logging must never break the pet */ }
}

log('main loaded; electron=' + process.versions.electron + ' page=' + PAGE_URL)

// Electron refuses to start without a writable userData dir.
const userData = path.join(path.dirname(LOG_FILE || __filename), 'pet-electron-userdata')
try { fs.mkdirSync(userData, { recursive: true }) } catch { }
app.setPath('userData', userData)

// DSH may already be running; this process must never join that single-instance pool.
app.requestSingleInstanceLock && app.requestSingleInstanceLock()

let win = null
let moveSaveTimer = null

function savePosition() {
  if (!win || !POS_FILE) return
  try {
    const b = win.getBounds()
    fs.writeFileSync(POS_FILE, JSON.stringify({ x: b.x, y: b.y }), 'utf8')
    log('pos saved ' + b.x + ',' + b.y)
  } catch (e) { log('pos save failed: ' + e.message) }
}

/** Default corner: bottom-right of the secondary monitor's work area, else primary. */
function homeCorner() {
  const displays = screen.getAllDisplays()
  const target = displays.find((d) => d.id !== screen.getPrimaryDisplay().id) || displays[0]
  const wa = target.workArea
  return { x: wa.x + wa.width - SIZE - 80, y: wa.y + wa.height - SIZE - 120 }
}

/**
 * Right-click acceptance test (only when --selftest=<mode> is given).
 *
 * Uses webContents.debugger -> Input.dispatchMouseEvent so the click enters Blink's
 * real mouse pipeline (pointerdown / mousedown / contextmenu), which is what a
 * hardware right-click produces. Then it reads the page: the title pet.html writes
 * ("menu@x,y") and the menu's computed display, and finally exercises the IPC action.
 */
function runSelfTest() {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const js = (code) => win.webContents.executeJavaScript(code)
      try {
        const before = await js('document.title')
        const displayBefore = await js('(function(){var m=document.getElementById("petmenu");return m?getComputedStyle(m).display:"missing"})()')
        log('selftest: before title=' + before + ' menu=' + displayBefore)

        const dbg = win.webContents.debugger
        if (!dbg.isAttached()) dbg.attach('1.3')
        const x = SIZE / 2
        const y = Math.round(SIZE * 0.55)
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 })
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 })
        await new Promise((r) => setTimeout(r, 700))

        const after = await js('document.title')
        const displayAfter = await js('(function(){var m=document.getElementById("petmenu");return m?getComputedStyle(m).display:"missing"})()')
        const btns = await js('(function(){var m=document.getElementById("petmenu");return m?m.innerText.replace(/\\n/g,"|"):"missing"})()')
        log('selftest: after title=' + after + ' menu=' + displayAfter + ' items=' + btns)
        log('selftest: right-click path ' + (after.startsWith('menu@') && displayAfter !== 'none' && displayAfter !== 'missing' ? 'PASS' : 'FAIL'))

        // Visual evidence: the owner judges UI by pictures, not by log lines.
        try {
          await dbg.sendCommand('Page.enable')
          const shot = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true })
          const out = require('path').join(require('path').dirname(LOG_FILE || __filename), 'menu-selftest.png')
          fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
          log('selftest: screenshot ' + out)
        } catch (e) { log('selftest: screenshot failed: ' + (e && e.message)) }

        if (SELFTEST === 'panel') {
          // "Open the panel" menu item: must reach the plugin API and say so in a bubble.
          log('selftest: items=' + await js('document.getElementById("petmenu").innerText.replace(/\\n/g,"|")'))
          await js('window.__pet.openPanel()')
          // The WPF panel takes seconds to come up, so poll the bubble instead of
          // assuming a fixed delay.
          let said = ''
          for (let i = 0; i < 30; i++) {
            said = await js('document.getElementById("bubble").textContent')
            if (said) break
            await new Promise((r) => setTimeout(r, 500))
          }
          log('selftest: panel bubble=' + JSON.stringify(said) + ' ' + (said ? 'PASS' : 'FAIL'))
        }

        if (SELFTEST === 'full' && after.startsWith('menu@')) {
          // Exercise the IPC bridge exactly as the owner would: click the first item.
          await js('document.querySelector(\'#petmenu button[data-act="reset"]\').click()')
          await new Promise((r) => setTimeout(r, 800))
          const b = win.getBounds()
          log('selftest: reset -> rect ' + b.x + ',' + b.y)
        }

        if (SELFTEST === 'quit') {
          // Same path the owner's right-click takes: IPC 'pet-menu' with act=close.
          // ipcMain is scoped inside app-ready below, so fetch it here instead.
          const { ipcMain: ipc } = require('electron')
          log('selftest: triggering menu close')
          ipc.emit('pet-menu', { sender: null }, { act: 'close' })
          return
        }

        if (SELFTEST === 'fallback') {
          // The auxclick fallback must open the menu even without a contextmenu.
          await js('document.getElementById("petmenu").style.display="none"')
          await new Promise((r) => setTimeout(r, 500))
          await js('document.dispatchEvent(new MouseEvent("auxclick",{button:2,clientX:61,clientY:63,bubbles:true}))')
          await new Promise((r) => setTimeout(r, 300))
          const disp = await js('getComputedStyle(document.getElementById("petmenu")).display')
          log('selftest: auxclick fallback menu=' + disp + ' ' + (disp === 'flex' ? 'PASS' : 'FAIL'))
        }
      } catch (e) {
        log('selftest failed: ' + (e && e.message ? e.message : e))
      }
    }, 1500)
  })
}

app.on('ready', () => {
  log('app ready')
  try {
    if (!Number.isFinite(startX) || !Number.isFinite(startY)) {
      const home = homeCorner()
      startX = home.x
      startY = home.y
      log('default placement ' + startX + ',' + startY)
    }

    win = new BrowserWindow({
      width: SIZE,
      height: SIZE,
      x: Math.round(startX),
      y: Math.round(startY),
      transparent: true,          // <- the entire point
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      focusable: true,            // must stay true or the window cannot be dragged
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        // A dedicated preload exposes exactly one function (window.petDrag) and nothing
        // else. contextBridge keeps the renderer sandboxed.
        preload: require('path').join(__dirname, 'preload.js'),
      },
    })

    // 'screen-saver' outranks ordinary always-on-top windows, matching the pet's
    // "always visible on the secondary screen" intent without stealing focus.
    win.setAlwaysOnTop(true, 'screen-saver')
    if (win.setVisibleOnAllWorkspaces) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    win.once('ready-to-show', () => {
      win.show()
      // Accept the mouse. On Windows a transparent BrowserWindow is click-through by
      // default; without this call WindowFromPoint never reports the pet and no drag,
      // click or hover can ever reach the page.
      try { win.setIgnoreMouseEvents(false) } catch (e) { log('setIgnoreMouseEvents failed: ' + e.message) }

      // ---- raw Win32 assertion ----
      // Electron's own calls are not enough here: the desktop window (explorer,
      // 4160x2560) still wins hit-testing. Re-assert topmost and strip any
      // click-through style at the Win32 level.
      try {
        const native = win.getNativeWindowHandle()
        const hwnd = native.readBigUInt64LE(0)
        const koffi = null   // no native deps: use a tiny PowerShell helper instead
        const { execFile } = require('child_process')
        const ps = [
          '$sig = @"',
          'using System;',
          'using System.Runtime.InteropServices;',
          'public class PetFix {',
          '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);',
          '  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);',
          '  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);',
          '}',
          '"@',
          'Add-Type -TypeDefinition $sig',
          '$h = [IntPtr]' + hwnd,
          '$ex = [PetFix]::GetWindowLong($h, -20)',
          'if (($ex -band 0x20) -ne 0) { [void][PetFix]::SetWindowLong($h, -20, $ex -band (-bnot 0x20)) }',
          '[void][PetFix]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010)',
          'Write-Output ("ex=0x" + ([PetFix]::GetWindowLong($h, -20)).ToString("X8"))',
        ].join('\n')
        execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
          { windowsHide: true, timeout: 8000 },
          (err, stdout, stderr) => {
            if (err) { log('native assert failed: ' + err.message); return }
            log('native assert: ' + String(stdout).trim() + (stderr ? ' / ' + String(stderr).trim().slice(0, 200) : ''))
          })
      } catch (e) { log('native assert threw: ' + e.message) }
      log('shown')
      try {
        fs.writeFileSync(READY_FILE, JSON.stringify({
          pet: 'ready',
          pid: process.pid,
          hwnd: '0x' + win.getNativeWindowHandle().readBigUInt64LE(0).toString(16),
          rect: [win.getBounds().x, win.getBounds().y, SIZE, SIZE],
          engine: 'electron',
          electron: process.versions.electron,
        }), 'utf8')
      } catch (e) { log('ready write failed: ' + e.message) }
    })

    // Persist position when a drag finishes (throttled: move fires continuously).
    win.on('move', () => {
      if (moveSaveTimer) clearTimeout(moveSaveTimer)
      moveSaveTimer = setTimeout(savePosition, 500)
    })

    win.on('closed', () => { log('window closed'); win = null })

    // Page console -> host log. The right-click menu is page code, so without this
    // there is no way to tell "the event never arrived" from "the handler ran but the
    // menu stayed hidden". Cheap and always on: the page logs very little.
    win.webContents.on('console-message', (event, level, message) => {
      // Electron 43 passes a single event object; older versions pass (e, level, msg).
      const msg = (event && typeof event === 'object' && event.message) ? event.message : message
      if (msg) log('page: ' + String(msg).slice(0, 400))
    })
    win.webContents.on('render-process-gone', (e, d) => log('renderer gone: ' + JSON.stringify(d)))

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
  })

  // ---- right-click menu ----
  // The window has no frame and no taskbar button, so this is the ONLY way the owner
  // can send the pet home or dismiss it without killing the process by hand.
  ipcMain.on('pet-menu', (event, payload) => {
    try {
      const act = payload && payload.act
      log('menu action: ' + act)
      if (act === 'reset') {
        const home = homeCorner()
        if (win && !win.isDestroyed()) {
          win.setBounds({ x: home.x, y: home.y, width: SIZE, height: SIZE })
          savePosition()
        }
        return
      }
      if (act === 'close') {
        // Leave a marker before quitting. The plugin decides "owner closed me" vs
        // "I crashed" from this file: without it a crash looks exactly like user
        // intent and autoStart would never bring the pet back (that is what
        // happened on 2026-11-06 20:12 -- the window vanished and stayed gone).
        try {
          if (POS_FILE) {
            const marker = require('path').join(require('path').dirname(POS_FILE), 'pet-quit.json')
            fs.writeFileSync(marker, JSON.stringify({ at: Date.now(), by: 'menu' }), 'utf8')
            log('quit marker written: ' + marker)
          }
        } catch (e) { log('quit marker failed: ' + (e && e.message)) }
        app.quit()
      }
    } catch (e) { log('menu failed: ' + e.message) }
  })

    if (PAGE_URL) {
      win.loadURL(PAGE_URL)
      if (SELFTEST) runSelfTest()
    } else {
      win.loadURL('data:text/html,<body style="margin:0;background:transparent"></body>')
      log('no --page given; loaded blank')
    }

    if (EXIT_AFTER > 0) {
      setTimeout(() => { log('exit-after reached'); app.quit() }, EXIT_AFTER)
    }
  } catch (e) {
    log('BUILD FAILED: ' + (e && e.stack ? e.stack : e))
    app.quit()
  }
})

app.on('window-all-closed', () => { log('window-all-closed'); app.quit() })

process.on('uncaughtException', (e) => {
  log('uncaught: ' + (e && e.stack ? e.stack : e))
})
