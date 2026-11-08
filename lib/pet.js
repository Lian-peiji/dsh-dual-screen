/**
 * pet.js —— V2（P6）透明鲸鱼桌宠的进程控制
 *
 * 为什么单开一个模块：桌宠是"锦上添花"的能力，宿主进程绝不能因为它挂掉。
 * 这里所有对外函数都不抛错，失败只 log + 返回 { ok:false }，与面板/P4 完全解耦。
 *
 * 宿主脚本：bin/pet-webview.ps1（WPF 透明窗 + WebView2 播放 VP9-alpha webm）
 *   —— v2b 换掉旧的 pet-host.ps1（那份只能缩放一张 PNG，主人 2026-11-06 嫌不好看）。
 *   动画素材来自社区插件 dsh-pet（MIT，(c) 2026 PC2005-cloud），已随插件打包在
 *   panel/webm/，不依赖对方安装。
 * 状态文件：E:\dsh\dual-screen\pet-pos.json（位置记忆） + pet-host.log（阶段日志）
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = dirname(HERE)
const BIN = join(PKG, 'bin')
// DATA_DIR must be declared BEFORE anything that derives a path from it: a const used
// above its declaration is a temporal dead zone ReferenceError, which fails at import
// time and takes the whole host down (caught by probe/p1-plugin-load.mjs, 2026-11-06).
const DATA_DIR = 'E:\\dsh\\dual-screen'
const READY_FILE = join(DATA_DIR, 'pet-ready.json')
export const PET_PS1 = join(BIN, 'pet-webview.ps1')
/** 桌宠页面 + 素材目录（pet.html 与 webm/ 同级） */
export const PET_ASSET_DIR = join(PKG, 'panel')
/** Electron 宿主（透明 + 可点击，WPF 做不到这点）*/
export const PET_ELECTRON_APP = join(PKG, 'pet-electron')
/** WebView2 宿主（WPF）：保留作降级方案，见 bin/pet-webview.ps1 头注释 */
export const PET_WEBVIEW_PS1 = join(BIN, 'pet-webview.ps1')
/** Electron 二进制：随插件放在数据目录（144MB，安装时从 dsh-pet 的缓存解压）*/
const ELECTRON_EXE = join(DATA_DIR, 'electron', 'electron.exe')
const POWERSHELL = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

export function createPetController({ log = () => {} } = {}) {
  const state = {
    status: 'stopped',   // stopped | starting | running | failed
    pid: null,
    startedAt: null,
    lastError: null,
    size: 240,
  }
  let child = null

  function status() {
    return { ...state, running: Boolean(child && child.exitCode === null), readyFile: READY_FILE, engine: state.engine || 'none' }
  }

  /** 拉起桌宠。baseUrl 预留给后续"点一下就展开面板"（端口每次都变，必须现算） */
  async function start(baseUrl, opts = {}) {
    if (child && child.exitCode === null) return status()
    if (!existsSync(PET_PS1)) {
      state.status = 'failed'
      state.lastError = 'pet-webview.ps1 missing: ' + PET_PS1
      log('pet: ' + state.lastError)
      return status()
    }
    if (!existsSync(join(PET_ASSET_DIR, 'pet.html'))) {
      state.status = 'failed'
      state.lastError = 'pet.html missing in ' + PET_ASSET_DIR
      log('pet: ' + state.lastError)
      return status()
    }

    state.status = 'starting'
    state.lastError = null
    state.size = Number(opts.size) || state.size

    // Electron first: it is the only host that keeps the window draggable while
    // transparent. Fall back to the WPF/WebView2 host when the binary is absent so a
    // fresh checkout still shows something.
    if (existsSync(ELECTRON_EXE) && existsSync(join(PET_ELECTRON_APP, 'main.js'))) {
      return startElectron(baseUrl, opts)
    }
    log('pet: electron binary missing at ' + ELECTRON_EXE + ' -> falling back to WebView2 host')

    const args = [
      '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', PET_PS1,
      '-DataDir:' + DATA_DIR,
      '-AssetDir:' + PET_ASSET_DIR,
      '-Size:' + state.size,
      '-ReadyFile:' + READY_FILE,
    ]
    // The page must live on the plugin's own HTTP origin: theme.json and the mood
    // endpoint are fetched from there, and file:// fetches are blocked as opaque
    // origins. Both query parameters are recomputed every launch because the port
    // changes on each restart.
    if (baseUrl) {
      const theme = opts.theme || (opts.config && opts.config.pet && opts.config.pet.theme) || 'whale'
      const page = baseUrl.replace(/\/+$/, '') + '/dsh-dual-screen/pet-page'
        + '?theme=' + encodeURIComponent(theme)
        + '&api=' + encodeURIComponent(baseUrl.replace(/\/+$/, ''))
      args.push('-PageUrl:' + page)
      args.push('-BaseUrl:' + baseUrl)
      state.theme = theme
    }
    if (opts.x !== undefined) args.push('-PosX:' + Math.round(opts.x))
    if (opts.y !== undefined) args.push('-PosY:' + Math.round(opts.y))

    try {
      child = spawn(POWERSHELL, args, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true, detached: false })
      state.pid = child.pid ?? null
      state.startedAt = Date.now()
      state.status = 'running'
      log('pet: started pid=' + state.pid + ' assets=' + PET_ASSET_DIR)

      child.on('exit', (code) => {
        log('pet: host exited code=' + code)
        // 自己关的就别标 failed（与面板同一坑：exit 回调要尊重"是我关的"）
        if (state.status !== 'stopped') state.status = 'stopped'
        state.pid = null
        child = null
      })
      child.on('error', (err) => {
        state.status = 'failed'
        state.lastError = String((err && err.message) || err)
        log('pet: spawn error ' + state.lastError)
        child = null
      })
    } catch (e) {
      state.status = 'failed'
      state.lastError = String((e && e.message) || e)
      log('pet: start failed ' + state.lastError)
    }
    return status()
  }

  /** Electron 宿主：透明 + 可点击 + 可拖动（-webkit-app-region:drag）*/
  function startElectron(baseUrl, opts = {}) {
    const theme = opts.theme || (opts.config && opts.config.pet && opts.config.pet.theme) || 'whale'
    const size = state.size
    state.theme = theme
    const page = baseUrl.replace(/\/+$/, '') + '/dsh-dual-screen/pet-page'
      + '?theme=' + encodeURIComponent(theme)
      + '&api=' + encodeURIComponent(baseUrl.replace(/\/+$/, ''))

    // Electron filters unknown argv flags, so the real settings travel as env vars.
    // argv still carries the app directory (that part Electron always honours).
    const petEnv = {
      ...process.env,
      DSH_PET_PAGE: page,
      DSH_PET_READY: READY_FILE,
      DSH_PET_POS_FILE: join(DATA_DIR, 'pet-pos.json'),
      DSH_PET_LOG: join(DATA_DIR, 'pet-host.log'),
      DSH_PET_SIZE: String(size),
    }
    if (opts.x !== undefined) petEnv.DSH_PET_X = String(Math.round(opts.x))
    if (opts.y !== undefined) petEnv.DSH_PET_Y = String(Math.round(opts.y))
    const args = [PET_ELECTRON_APP]

    // CRITICAL: delete ELECTRON_RUN_AS_NODE, do not blank it. DSH's own process tree
    // sets it, and Electron treats a present-but-empty value as "run as plain node",
    // which makes require('electron') throw MODULE_NOT_FOUND.
    const env = petEnv
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
          log('pet: stderr ' + text.slice(0, 300).replace(/\s+/g, ' '))
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

  /** 收尸：注册表里没有"桌宠"这种人，我们自己 gen 的必须自己收 */
  function stop(reason = '') {
    state.status = 'stopped'
    if (child) {
      const pid = child.pid
      try { child.kill() } catch { /* ignore */ }
      log('pet: stopping pid=' + pid + (reason ? ' (' + reason + ')' : ''))
      child = null
      state.pid = null
    }
    return status()
  }

  /**
   * 把当前状态推给桌宠页面。
   *
   * 桌面页面（pet.html）运行在 WebView2 里，它拿不到宿主的会话状态，所以由这里
   * 定个节奏读 panel.json 再通过文件/HTTP 把 mood 送进去。
   * 实现走**文件**而不是注入 JS：往 WebView2 里执行脚本需要宿主持有 CoreWebView2
   * 引用，而桌宠是独立进程 —— 中间隔一层文件最省事，页面自己读。
   */
  let moodTimer = null
  let lastMood = ''

  function startMoodBridge(baseUrl) {
    if (moodTimer || !baseUrl) return
    const MOOD_FILE = join(DATA_DIR, 'pet-mood.json')
    moodTimer = setInterval(async () => {
      try {
        const r = await fetch(baseUrl + '/dsh-dual-screen/pet.json', { signal: AbortSignal.timeout(4000) })
        if (!r.ok) return
        const j = await r.json()
        const mood = (j && j.pet && j.pet.mood) || 'idle'
        if (mood === lastMood) return
        lastMood = mood
        const { writeFileSync } = await import('node:fs')
        writeFileSync(MOOD_FILE, JSON.stringify({ mood, at: Date.now() }), 'utf8')
        log('pet: mood -> ' + mood)
      } catch { /* 状态推送失败不影响桌宠本身 */ }
    }, 3000)
    if (typeof moodTimer.unref === 'function') moodTimer.unref()
    log('pet: mood bridge started')
  }

  function stopMoodBridge() {
    if (moodTimer) { clearInterval(moodTimer); moodTimer = null }
    lastMood = ''
  }

  return { start, stop, status, startMoodBridge, stopMoodBridge, MOOD_FILE: join(DATA_DIR, 'pet-mood.json') }
}
