/**
 * panel.js —— 副屏面板（原生 WPF 窗，P2a）
 *
 * v0.6 起面板宿主从 Edge --app 换成 bin/panel-host.ps1（WPF WindowStyle=None）：
 * Edge 会在客户区自绘一条浏览器工具栏，Win32 剥不掉、顶出屏幕一拖就露，
 * 主人明确不接受。原生窗没有外壳，且给 P6 透明桌宠留了同一条路。
 *
 * 分工（沿用旧约定）：
 *   - 窗口几何归服务端（窗自己改不了大小/位置）→ panel-host.ps1 定位、panel-move.ps1 改尺寸
 *   - 内容由宿主自己渲染（P2a 读 panel/ui.json 静态文案；P3 再接 HTTP 数据）
 *
 * 硬规矩：
 *   - 不抢焦点：WPF ShowActivated=false + SetWindowPos NOACTIVATE
 *   - 不进 Alt+Tab / 任务栏：ShowInTaskbar=false（WPF 侧）
 *   - 关面板 = 杀我们自己的宿主进程，绝不碰主人任何窗口
 *   - 参数一律冒号形式传（-Y:-588），否则负坐标会被 PowerShell 当成参数名
 */
import { spawn, execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(dirname(HERE), 'bin')
export const HOST_PS1 = join(BIN, 'panel-host.ps1')
export const MOVE_PS1 = join(BIN, 'panel-move.ps1')
const POWERSHELL = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const READY_FILE = 'E:\\dsh\\dual-screen\\panel-ready.json'
// Q 版鲸鱼头像：与 dsh-whale-widget 同一角色（DSniang1.png）。放在 panel/ 下，
// 这样鲸鱼挂件被卸载也不影响面板；宿主找不到文件会退回字符头像。
export const AVATAR_FILE = join(dirname(HERE), 'panel', 'avatar.png')

// v0.6: 面板宿主已换成原生 WPF 窗，不再用 Edge。
// 保留这个导出只为兼容 lib/index.js 的旧 import（/panel-window.json 会展示它）。
export function pickEdge() { return null }

export function createPanelController({ log = () => {} } = {}) {
  const state = {
    status: 'closed',     // closed | opening | open | failed
    pid: null,
    hwnd: null,
    form: 'expanded',
    rect: null,
    lastError: null,
    openedAt: null,
  }
  let child = null
  let closing = false   // 我们自己关的窗，别让 exit 把它标成 failed

  function place(rect, opts = {}) {
    // 冒号形式是硬要求：-Y -588 会被解析成「参数名 -588」
    const args = [
      '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', HOST_PS1,
      '-X:' + rect.x, '-Y:' + rect.y, '-W:' + rect.w, '-H:' + rect.h,
      // 缩放系数：让字号在 150% 副屏上与 100% 主屏观感一致（不传则 1.0）
      '-UiScale:' + (opts.uiScale || 1),
      '-ReadyFile:' + READY_FILE,
      '-DataUrl:' + (opts.dataUrl || ''),
      // Q 版鲸鱼头像（DSniang1.png 同一角色）；缺文件时宿主自动退回字符头像
      '-AvatarFile:' + AVATAR_FILE,
    ]
    if (opts.topmost) args.push('-Topmost')
    // Form C: which visual the host draws first. It follows panel.json afterwards,
    // so this only has to be right at open time; the rect already carries the size.
    args.push('-Form:' + (opts.form === 'collapsed' ? 'collapsed' : 'expanded'))
    // 主人已经用鼠标拖过尺寸（config.panel.resizedByUser）：下次开窗不要自动缩回内容高度
    if (opts.noFit) args.push('-NoFit')
    return args
  }

  /** 打开面板：拉起 WPF 宿主，等它自报 ready（含实际 rect） */
  async function open(rect, config = {}, uiScale = 1, dataUrl = '') {
    if (state.status === 'open' || state.status === 'opening') return status()
    if (!existsSync(HOST_PS1)) {
      state.status = 'failed'
      state.lastError = 'panel-host.ps1 missing: ' + HOST_PS1
      return status()
    }
    state.status = 'opening'
    closing = false
    state.lastError = null
    const topmost = config.panel ? config.panel.topmost !== false : true
    const form = config.panel && config.panel.form === 'collapsed' ? 'collapsed' : 'expanded'
    state.form = form

    const proc = spawn(POWERSHELL, place(rect, { topmost, uiScale, dataUrl, form, noFit: !!(config.panel && config.panel.resizedByUser) }), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    child = proc
    state.pid = proc.pid ?? null
    log(`panel: host started pid=${state.pid} rect=${rect.x},${rect.y} ${rect.w}x${rect.h} topmost=${topmost}`)

    // 就绪检测：累积 stdout 文本 + 正则匹配。不用 readline 逐行（2026-11-05 实测：
    // readline 版本里 ready 行确实收到了但状态迟迟不翻转，排查成本高于收益）。
    // Ready handshake over a FILE (see panel-host.ps1): stdout is unreliable when
    // the host is spawned with piped stdio, and a file also leaves an audit trail.
    const startedAt = Date.now()
    const ok = await new Promise((resolve) => {
      let settled = false
      const finish = (v) => { if (!settled) { settled = true; clearInterval(tick); resolve(v) } }
      let ticks = 0
      const tick = setInterval(() => {
        ticks++
        try {
          const obj = JSON.parse(readFileSync(READY_FILE, "utf8"))
          if (ticks % 10 === 0) log('poll#' + ticks + ' file pid=' + obj.pid + ' want=' + proc.pid + ' panel=' + obj.panel)
          if (obj && obj.panel === "ready" && Number(obj.pid) === Number(proc.pid)) {
            state.status = "open"
            state.hwnd = obj.hwnd
            state.rect = { x: obj.rect[0], y: obj.rect[1], w: obj.rect[2], h: obj.rect[3] }
            state.openedAt = Date.now()
            log(`panel: ready hwnd=${obj.hwnd} rect=${JSON.stringify(state.rect)} uiScale=${obj.uiScale}`)
            return finish(true)
          }
        } catch (e) { if (ticks % 10 === 0) log("poll#" + ticks + " read failed: " + (e && e.message)) }
        if (Date.now() - startedAt > 45000) return finish(false)
      }, 200)
      if (tick.unref) tick.unref()
      proc.on("exit", (code) => {
        log(`panel: host exited code=${code}`)
        // 自己关的窗（closing=true）只能是 closed：旧版这里按 status!=='open' 一律
        // 判 failed，于是每次关面板 state 都显示 failed（HANDOFF §3-2）。
        if (closing || state.status === "closed") {
          state.status = "closed"
          log('panel: exit after our own close(), status stays closed')
        } else if (state.status !== "open") {
          state.status = "failed"
          if (!state.lastError) state.lastError = `host exited code=${code}`
        } else {
          state.status = "closed"
        }
        state.pid = null; state.hwnd = null; child = null
        finish(false)
      })
    })
    if (!ok && state.status === 'opening') {
      state.status = 'failed'
      if (!state.lastError) state.lastError = 'host did not report ready'
      try { proc.kill() } catch {}
    }
    return status()
  }

  /** 改尺寸/位置（折叠 ↔ 展开、拖动后落盘）—— 不重启窗口，保住状态 */
  async function resize(rect, form) {
    if (state.status !== 'open' || !state.hwnd) return { ok: false, error: 'panel not open' }
    const out = await new Promise((resolve) => {
      execFile(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', MOVE_PS1,
        '-Hwnd:' + state.hwnd, '-X:' + rect.x, '-Y:' + rect.y, '-W:' + rect.w, '-H:' + rect.h, '-Topmost'],
      { timeout: 15000, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
        const line = String(stdout || '').split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop()
        let parsed = null
        try { parsed = line ? JSON.parse(line) : null } catch {}
        resolve(parsed || { ok: false, error: String((err && err.message) || 'no JSON from panel-move') })
      })
    })
    if (out && out.ok) {
      state.rect = { x: out.got[0], y: out.got[1], w: out.got[2], h: out.got[3] }
      if (form) state.form = form
    }
    return out
  }

  /** 关面板：只杀我们自己的宿主进程 */
  async function close() {
    closing = true
    if (child) {
      const pid = child.pid
      try { child.kill() } catch {}
      // WPF 宿主是 powershell 进程，杀掉即收工；子进程（若有）**当场**连带收掉。
      //
      // 原来这里是 setTimeout(1500) 延后补刀，看着更"温和"，实际是个孤儿制造机：
      // 插件 dispose 时本 Node 进程立刻消失，1.5 秒后的计时器永远不会触发
      // （2026-11-08 实测：热重载几次就攒下没人管的 panel-host）。
      // taskkill 是独立进程，spawn 出去就不依赖我们活着，所以同步发、不等。
      try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, detached: true, stdio: 'ignore' }).unref() } catch {}
    }
    state.status = 'closed'
    state.pid = null
    state.hwnd = null
    state.rect = null
    child = null
    log('panel: closed')
    return { ok: true }
  }

  function status() {
    return { ...state, running: Boolean(child), kind: 'wpf' }
  }

  return { open, resize, close, status }
}