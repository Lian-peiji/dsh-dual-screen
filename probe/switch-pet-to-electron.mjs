// switch-pet-to-electron.mjs -- make Electron the primary pet host, keep the WebView2
// host as a documented fallback.
//
// Reason for the switch: WPF (the WebView2 host) can be transparent OR clickable but
// never both -- AllowsTransparency kills hit-testing, so the pet could not be dragged
// and clicks fell through to whatever was underneath. Electron's transparent:true
// keeps hit-testing, which is why dsh-pet uses it.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/pet.js'
let s = readFileSync(p, 'utf8')

// 1) exports: add the electron app dir + binary resolver
const expAnchor = "export const PET_ASSET_DIR = join(PKG, 'panel')"
if (!s.includes(expAnchor)) throw new Error('asset dir anchor missing')
s = s.replace(expAnchor, expAnchor + `
/** Electron 宿主（透明 + 可点击，WPF 做不到这点）*/
export const PET_ELECTRON_APP = join(PKG, 'pet-electron')
/** WebView2 宿主（WPF）：保留作降级方案，见 bin/pet-webview.ps1 头注释 */
export const PET_WEBVIEW_PS1 = join(BIN, 'pet-webview.ps1')
/** Electron 二进制：随插件放在数据目录（144MB，安装时从 dsh-pet 的缓存解压）*/
const ELECTRON_EXE = join(DATA_DIR, 'electron', 'electron.exe')`)

// 2) start(): prefer electron
const startAnchor = `    state.status = 'starting'
    state.lastError = null
    state.size = Number(opts.size) || state.size`
if (!s.includes(startAnchor)) throw new Error('start anchor missing')
s = s.replace(startAnchor, `    state.status = 'starting'
    state.lastError = null
    state.size = Number(opts.size) || state.size

    // Electron first: it is the only host that keeps the window draggable while
    // transparent. Fall back to the WPF/WebView2 host when the binary is absent so a
    // fresh checkout still shows something.
    if (existsSync(ELECTRON_EXE) && existsSync(join(PET_ELECTRON_APP, 'main.js'))) {
      return startElectron(baseUrl, opts)
    }
    log('pet: electron binary missing at ' + ELECTRON_EXE + ' -> falling back to WebView2 host')`)

// 3) the electron launcher, inserted before stop()
const stopAnchor = `  /** 收尸：注册表里没有"桌宠"这种人，我们自己 gen 的必须自己收 */`
if (!s.includes(stopAnchor)) throw new Error('stop anchor missing')
s = s.replace(stopAnchor, `  /** Electron 宿主：透明 + 可点击 + 可拖动（-webkit-app-region:drag）*/
  function startElectron(baseUrl, opts = {}) {
    const theme = opts.theme || (opts.config && opts.config.pet && opts.config.pet.theme) || 'whale'
    const size = state.size
    state.theme = theme
    const page = baseUrl.replace(/\\/+$/, '') + '/dsh-dual-screen/pet-page'
      + '?theme=' + encodeURIComponent(theme)
      + '&api=' + encodeURIComponent(baseUrl.replace(/\\/+$/, ''))

    const args = [
      PET_ELECTRON_APP,
      '--page=' + page,
      '--ready=' + READY_FILE,
      '--pos-file=' + join(DATA_DIR, 'pet-pos.json'),
      '--log=' + join(DATA_DIR, 'pet-host.log'),
      '--size=' + size,
    ]
    if (opts.x !== undefined) args.push('--x=' + Math.round(opts.x))
    if (opts.y !== undefined) args.push('--y=' + Math.round(opts.y))

    // CRITICAL: delete ELECTRON_RUN_AS_NODE, do not blank it. DSH's own process tree
    // sets it, and Electron treats a present-but-empty value as "run as plain node",
    // which makes require('electron') throw MODULE_NOT_FOUND.
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE

    try {
      child = spawn(ELECTRON_EXE, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, detached: false, env })
      state.pid = child.pid ?? null
      state.startedAt = Date.now()
      state.status = 'running'
      state.engine = 'electron'
      log('pet: electron started pid=' + state.pid + ' theme=' + theme)

      child.stderr.on('data', (d) => {
        const text = String(d)
        // Chromium is chatty about GPU/cache on this machine; only surface real errors.
        if (/ERROR|FATAL/.test(text) && !/disk_cache|gpu_disk_cache|cache_util_win/.test(text)) {
          log('pet: stderr ' + text.slice(0, 300).replace(/\\s+/g, ' '))
        }
      })
      child.on('exit', (code) => {
        log('pet: electron exited code=' + code)
        if (state.status !== 'stopped') state.status = 'stopped'
        state.pid = null
        child = null
      })
      child.on('error', (err) => {
        state.status = 'failed'
        state.lastError = String((err && err.message) || err)
        log('pet: electron spawn error ' + state.lastError)
        child = null
      })
    } catch (e) {
      state.status = 'failed'
      state.lastError = String((e && e.message) || e)
      log('pet: electron start failed ' + state.lastError)
    }
    return status()
  }

  /** 收尸：注册表里没有"桌宠"这种人，我们自己 gen 的必须自己收 */`)

// 4) status(): report the engine
const statusAnchor = "    return { ...state, running: Boolean(child && child.exitCode === null), readyFile: READY_FILE }"
if (!s.includes(statusAnchor)) throw new Error('status anchor missing')
s = s.replace(statusAnchor, "    return { ...state, running: Boolean(child && child.exitCode === null), readyFile: READY_FILE, engine: state.engine || 'none' }")

writeFileSync(p, s, 'utf8')
console.log('pet.js switched to electron:', s.includes('startElectron'), s.includes('ELECTRON_EXE'))