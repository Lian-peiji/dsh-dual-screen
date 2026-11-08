/**
 * windows.js —— 投送器进程管理（P1）
 *
 * 投送器本体是 bin/window-bridge.ps1（pwsh + C#，SetWinEventHook），它往 stdout
 * 一行一个 JSON 上报；这里负责拉起、解析、计数、异常重启（有上限，绝不无限重启）。
 *
 * 为什么不在 Node 里做钩子：Node 没有 Win32 窗口 API，宿主也不是我们能改的
 * Electron 主进程。pwsh + Add-Type 最省事，出错也好改（PLAN §5.2）。
 *
 * 硬规矩：
 *   - 崩了只重启 1 次；还是崩就停在 failed 并留日志，等用户体验到的只是“没投送”，
 *     不能变成进程风暴。
 *   - 屏数变 1 或功能关闭时主动停，不留残进程（PLAN §8）。
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const HERE = dirname(fileURLToPath(import.meta.url))
export const BRIDGE_PS1 = join(dirname(HERE), 'bin', 'window-bridge.ps1')
const POWERSHELL = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

const MAX_RESTARTS = 1
const RESTART_DELAY_MS = 3000
const EVENT_RING = 80

export function createBridgeController({ dataDir, onEvent, onLog }) {
  const state = {
    status: 'stopped',      // stopped | starting | running | failed | idle
    pid: null,
    startedAt: null,
    hookOk: null,
    secondary: null,
    moved: 0,
    skipped: 0,
    failed: 0,
    restarts: 0,
    lastError: null,
    lastEventAt: null,
    events: [],
  }

  let child = null
  let wantRunning = false
  let restartTimer = null
  let intentionalStop = false

  const log = (line) => { try { onLog && onLog(line) } catch {} }

  function pushEvent(obj) {
    state.lastEventAt = Date.now()
    state.events.push(obj)
    if (state.events.length > EVENT_RING) state.events.splice(0, state.events.length - EVENT_RING)
    try { onEvent && onEvent(obj) } catch {}
  }

  function handleLine(line) {
    const text = String(line || '').trim()
    if (!text || text[0] !== '{') return
    let obj = null
    try { obj = JSON.parse(text) } catch { return }
    switch (obj.type) {
      case 'hello':
        state.status = 'running'
        state.pid = obj.pid ?? null
        state.startedAt = obj.startedAtMs ?? Date.now()
        state.hookOk = Boolean(obj.hookOk)
        state.secondary = obj.secondary || null
        log(`bridge hello pid=${state.pid} hookOk=${state.hookOk} secondary=${JSON.stringify(state.secondary)}`)
        break
      case 'moved':
        state.moved++
        log(`moved [${obj.kind}] ${obj.proc}#${obj.pid} "${obj.title}" -> ${JSON.stringify(obj.got || obj.want)}`)
        break
      case 'move-failed':
        state.failed++
        state.lastError = `${obj.reason} ${obj.proc}#${obj.pid}`
        log(`move failed [${obj.kind}] ${obj.reason} ${obj.proc}#${obj.pid} want=${JSON.stringify(obj.want)} got=${JSON.stringify(obj.got)}`)
        break
      case 'skip':
        state.skipped++
        log(`skip ${obj.reason} ${obj.proc}#${obj.pid} "${obj.title}"`)
        break
      case 'display.changed':
        state.secondary = obj.hasSecondary ? state.secondary : null
        log(`display changed hasSecondary=${obj.hasSecondary}`)
        break
      case 'idle':
        state.status = 'idle'
        log(`bridge idle: ${obj.reason}`)
        break
      case 'error':
        state.lastError = `${obj.where}: ${obj.message}`
        log(`bridge error: ${state.lastError}`)
        break
      case 'bye':
        log(`bridge bye movedCount=${obj.movedCount}`)
        break
      default:
        break
    }
    pushEvent(obj)
  }

  function start() {
    if (child) return state
    wantRunning = true
    intentionalStop = false
    state.status = 'starting'
    state.lastError = null
    log('bridge starting: ' + BRIDGE_PS1)
    child = spawn(POWERSHELL, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', BRIDGE_PS1, '-DataDir', dataDir,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

    state.pid = child.pid ?? null

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', handleLine)
    }
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr })
      rl.on('line', (line) => {
        const t = String(line || '').trim()
        if (!t) return
        state.lastError = t.slice(0, 400)
        log('bridge stderr: ' + t.slice(0, 400))
      })
    }
    child.on('exit', (code, signal) => {
      const wasIntentional = intentionalStop
      child = null
      if (wasIntentional || !wantRunning) {
        state.status = 'stopped'
        log(`bridge stopped (code=${code} signal=${signal})`)
        return
      }
      // Crash: one restart only (a crashing hook must not become a process storm)
      if (state.restarts < MAX_RESTARTS) {
        state.restarts++
        state.status = 'starting'
        log(`bridge exited unexpectedly (code=${code} signal=${signal}); restart ${state.restarts}/${MAX_RESTARTS} in ${RESTART_DELAY_MS}ms`)
        restartTimer = setTimeout(() => { restartTimer = null; if (wantRunning) start() }, RESTART_DELAY_MS)
        if (restartTimer.unref) restartTimer.unref()
      } else {
        state.status = 'failed'
        state.lastError = `exited code=${code} signal=${signal} after ${state.restarts} restart(s)`
        log('bridge failed: ' + state.lastError + ' (giving up, no more restarts)')
      }
    })
    return state
  }

  function stop(reason = 'requested') {
    wantRunning = false
    intentionalStop = true
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null }
    if (!child) { state.status = 'stopped'; return state }
    log(`bridge stopping (${reason}) pid=${child.pid}`)
    try { child.kill() } catch {}
    // Hard kill if it does not leave in 2s: it owns a WinEventHook, never leave it.
    const pid = child.pid
    const t = setTimeout(() => {
      try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }) } catch {}
    }, 2000)
    if (t.unref) t.unref()
    return state
  }

  function restart(reason = 'manual') {
    stop(reason)
    state.restarts = 0
    setTimeout(() => start(), 600)
    return state
  }

  return {
    start,
    stop,
    restart,
    status: () => ({
      ...state,
      running: Boolean(child),
      events: state.events.slice(-20),
    }),
  }
}