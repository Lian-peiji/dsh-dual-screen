// probe-electron-simple.mjs -- narrow it down: does the Electron main process even run?
//
// Previous run: process started, logged cache errors, exited 0, no ready file. Two
// possibilities: (a) app.whenReady never resolved, (b) ready-to-show never fired.
// This writes a file at EVERY stage so the failure point is a fact, not a guess.
import { writeFileSync, existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const DIR = 'C:/Users/lpj32/AppData/Local/dsh-dual-screen/electron-probe'
const ELECTRON = "E:/dsh/dual-screen/electron/electron.exe"
const trace = join(DIR, 'trace.log')

mkdirSync(DIR, { recursive: true })
try { rmSync(trace) } catch { }

const main = String.raw`
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = process.argv[process.argv.length - 1]
function T(m) { try { fs.appendFileSync(OUT, m + '\n') } catch (e) {} }

T('main.cjs loaded; electron=' + process.versions.electron + ' node=' + process.versions.node)
app.setPath('userData', path.join(path.dirname(OUT), 'userdata'))
T('userData set')

app.on('ready', () => {
  T('app ready fired')
  try {
    const win = new BrowserWindow({
      width: 240, height: 240, x: 2800, y: 900,
      transparent: true, frame: false, resizable: false,
      alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
      focusable: true, show: false
    })
    T('BrowserWindow constructed')
    win.webContents.on('did-finish-load', () => T('did-finish-load'))
    win.loadURL('data:text/html,<body style="margin:0;background:transparent"><h1>hi</h1></body>')
    win.once('ready-to-show', () => {
      T('ready-to-show fired')
      win.show()
      T('shown; bounds=' + JSON.stringify(win.getBounds()))
    })
    setTimeout(() => { T('quitting'); app.quit() }, 7000)
  } catch (e) {
    T('ERROR building window: ' + (e && e.stack || e))
    app.quit()
  }
})

app.on('window-all-closed', () => T('window-all-closed'))
process.on('uncaughtException', (e) => T('uncaught: ' + (e && e.stack || e)))
`

writeFileSync(join(DIR, 'main.cjs'), main, 'utf8')
writeFileSync(join(DIR, 'package.json'), JSON.stringify({ name: 'pet-probe', version: '1.0.0', main: 'main.cjs' }, null, 2), 'utf8')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(ELECTRON, [DIR, trace], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false })
let out = ''
child.stdout.on('data', (d) => { out += d.toString() })
child.stderr.on('data', (d) => { out += d.toString() })
child.on('exit', (code) => {
  console.log('exit code=', code)
  if (existsSync(trace)) {
    console.log('--- trace ---')
    console.log(readFileSync(trace, 'utf8'))
  } else {
    console.log('NO TRACE: main.cjs never ran')
  }
  if (out.trim()) console.log('--- stderr (first 800) ---\n' + out.slice(0, 800))
})
