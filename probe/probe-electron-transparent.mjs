// probe-electron-transparent.mjs -- can we borrow DSH's Electron to host a transparent pet?
//
// WHY: WPF cannot do "transparent AND clickable". AllowsTransparency uses a layered
// window that loses hit-testing; the non-layered fallbacks paint black. Electron's
// transparent:true uses Chromium's own alpha compositing and keeps hit-testing --
// that is exactly what dsh-pet relies on (runtime/electron-helper/main/windows.js:
//   transparent:true, frame:false, alwaysOnTop:true, hasShadow:false).
//
// DSH itself ships Electron 44.7.0. If that binary runs a plain main script, the pet
// can be a tiny Electron app with no extra download.
//
// This probe: write a minimal main.js that opens a transparent window, run it with the
// DSH executable + ELECTRON_RUN_AS_NODE off (we want the real browser process), write
// a ready file, then exit.
import { writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const DIR = 'E:/dsh/dual-screen/electron-probe'
const ELECTRON = 'E:/deepseek harness/DeepSeek Harness.exe'

if (!existsSync(ELECTRON)) {
  console.error('FAIL: electron binary missing:', ELECTRON)
  process.exit(2)
}
mkdirSync(DIR, { recursive: true })
const ready = join(DIR, 'ready.json')
try { rmSync(ready) } catch { }

const main = String.raw`
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const READY = process.argv[process.argv.length - 1]

// Electron needs a writable userData dir. Without it the browser process still starts
// but logs "Unable to create cache: access denied" and the window never shows up.
app.setPath('userData', path.join(path.dirname(READY), 'userdata'))

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 240, height: 240, x: 2800, y: 900,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: { backgroundThrottling: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<html><body style="margin:0;background:transparent">' +
    '<div style="width:240px;height:240px;display:flex;align-items:center;justify-content:center">' +
    '<div style="width:150px;height:150px;border-radius:50%;background:#4fb3ff;opacity:.85"></div>' +
    '</div></body></html>'))
  win.once('ready-to-show', () => {
    win.show()
    const sz = win.getSize()
    const pos = win.getPosition()
    try {
      fs.writeFileSync(READY, JSON.stringify({
        ok: true, pid: process.pid, size: sz, pos: pos,
        transparent: true, electron: process.versions.electron
      }), 'utf8')
    } catch (e) { }
  })
  setTimeout(() => app.quit(), 9000)
})
`

writeFileSync(join(DIR, 'main.cjs'), main, 'utf8')
writeFileSync(join(DIR, 'package.json'), JSON.stringify({ name: 'pet-probe', version: '1.0.0', main: 'main.cjs' }, null, 2), 'utf8')

console.log('launching electron from DSH binary...')
// CRITICAL: delete the variable, do not set it to ''. Node's Electron shim treats an
// EMPTY ELECTRON_RUN_AS_NODE as still-set (it checks for presence), so the binary runs
// as plain Node and require('electron') throws MODULE_NOT_FOUND. Only a deleted key
// lets it boot the real browser process.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_ENABLE_LOGGING
const child = spawn(ELECTRON, [DIR, ready], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
})
let out = ''
child.stdout.on('data', (d) => { out += d.toString() })
child.stderr.on('data', (d) => { out += d.toString() })
child.on('exit', (code) => {
  console.log('electron exited code=', code)
  if (out.trim()) console.log('--- output ---\n' + out.slice(0, 2000))
  if (existsSync(ready)) {
    console.log('READY FILE:', require('node:fs').readFileSync(ready, 'utf8'))
    console.log('RESULT: PASS (electron transparent window works)')
  } else {
    console.log('RESULT: FAIL (no ready file)')
  }
})
