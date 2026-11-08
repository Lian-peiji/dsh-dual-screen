/**
 * display.js —— 屏幕枚举与副屏定位
 *
 * 走 bin/display-info.ps1（Per-Monitor V2 物理坐标），带缓存与单飞（并发只跑一份）。
 * 单屏时 hasSecondary() = false，P1/P2 据此待机（不装钩子、不建窗）。
 *
 * 物理像素口径（本机实测）：
 *   主屏 2560x1440 @ (0,0)，100%
 *   副屏 1600x2560 @ (2560,-588)，150%，工作区 1600x2488（底部少 72 = 任务栏）
 * → 摆窗一律用 work*（可用区）+ 物理像素，别用逻辑像素。
 */
import { execFile } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOG_DIR } from './config.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PS1 = join(dirname(HERE), 'bin', 'display-info.ps1')
const POWERSHELL = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

const CACHE_MS = 4000

let last = null          // 上一次成功结果
let lastAt = 0
let inflight = null
let lastError = null

function runProbe(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    execFile(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-OutFile', join(LOG_DIR, 'displays-last.json')],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`display probe failed: ${err.message} ${String(stderr || '').slice(0, 300)}`))
        try {
          const text = String(stdout || '').trim()
          const start = text.indexOf('{')
          resolve(JSON.parse(text.slice(start)))
        } catch (e) {
          reject(new Error(`display probe returned non-JSON: ${String(stdout || '').slice(0, 200)}`))
        }
      },
    )
  })
}

/** 枚举屏幕；命中缓存直接返回。失败时回上一次成功结果（宁可用旧坐标也不要崩）。 */
export async function getDisplays(force = false) {
  const now = Date.now()
  if (!force && last && now - lastAt < CACHE_MS) return last
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const data = await runProbe()
      const monitors = Array.isArray(data.monitors) ? data.monitors : []
      const primary = monitors.find((m) => m.primary) || monitors[0] || null
      const secondary = monitors.find((m) => !m.primary) || null
      last = {
        ok: true,
        ts: data.ts || new Date().toISOString(),
        count: monitors.length,
        dpiBefore: data.dpiBefore,
        dpiAfter: data.dpiAfter,
        virtualScreen: data.virtualScreen || null,
        monitors,
        primary,
        secondary,
        hasSecondary: Boolean(secondary),
      }
      lastAt = Date.now()
      lastError = null
      return last
    } catch (err) {
      lastError = String((err && err.message) || err)
      if (last) return { ...last, stale: true, error: lastError }
      return { ok: false, error: lastError, monitors: [], primary: null, secondary: null, hasSecondary: false }
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * 面板落点：副屏可用区右上角，留 margin 物理像素。
 * 参数是 DIP（PLAN §7.7.1 拍板的 400x900 是 DIP），这里按副屏缩放换成物理像素：
 * 150% 竖屏下 400 DIP = 600 物理像素，直接拿 400 去摆窗会小掉三分之一。
 */
export function panelRect(displays, marginPx = 24, widthDip = 400, heightDip = 900) {
  const sec = displays && displays.secondary
  if (!sec) return null
  const scale = sec.scale || 1
  const wantW = Math.round(widthDip * scale)
  const wantH = Math.round(heightDip * scale)
  const w = Math.min(wantW, sec.workW - marginPx * 2)
  const h = Math.min(wantH, sec.workH - marginPx * 2)
  return {
    x: sec.workX + sec.workW - marginPx - w,
    y: sec.workY + marginPx,
    w,
    h,
  }
}

/** 工具窗落点：副屏左侧剩余区（PLAN §7.5 #2 分区），避开面板宽度。 */
export function toolWindowRect(displays, marginPx = 24, wantW = 1280, wantH = 900) {
  const sec = displays && displays.secondary
  if (!sec) return null
  const w = Math.min(wantW, sec.workW - marginPx * 2)
  const h = Math.min(wantH, sec.workH - marginPx * 2)
  return { x: sec.workX + marginPx, y: sec.workY + marginPx, w, h }
}

export function lastProbeError() { return lastError }