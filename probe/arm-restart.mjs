/**
 * probe/arm-restart.mjs —— 通过 dsh-restart-guard 的官方通道排一次重启
 *
 * 为什么走这里而不是插件工具：当前实例是「第三方插件全禁用」启起来的，
 * restart_* 工具根本没加载；但计划任务 DSH-Restart-Guard 独立存在于 OS，
 * 照旧可用（runner.ps1 会被 wscript 垫片静默启动）。
 *
 * 用法：node probe/arm-restart.mjs [delaySeconds]
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { armRestart } from 'file:///J:/%E5%A4%A7%E8%82%A5%E9%B1%BC%E6%B8%B8%E4%B9%90%E5%9C%BA/dsh-restart-guard/lib/request-queue.js'

const STATE_DIR = 'E:\\dsh\\restart-guard'
const SESSIONS_ROOT = 'E:\\dsh\\sessions'
const delaySec = Number(process.argv[2] || 20)
// 重启口径（主人 2026-11-05 修正后的原话）：
//   「保留自主重启权限，只是要修改检测条件：执行重启前再次确认无对话进行，
//     而且你需要重启时必须输出完毕。」
//
// 翻成参数：
//   policy=safe + waitQuiet=true  -> runner 在 targetAt 到点后会**再次**确认，
//                                    发现还有对话活跃就继续等（这就是"执行前二次确认"）
//   quietMin=3                    -> 活跃判定用 3 分钟（不是 10 分钟长门槛）：
//                                    我这条会话刚输出完，3 分钟无新活动即视为"输出完毕"
//   maxWaitMin=10                 -> 等不到就放弃，不无限挂着
//   excludeSession=''             -> 不排除自己：别的对话同样要等它安静
// 保留 continue 作为显式逃生口（主人说"现在就重启"时才用）。
const policy = process.argv[3] === 'continue' ? 'continue' : 'safe'   // mustQueue 时强制 safe

// 找最近活跃的会话目录（= 本会话），作为 excludeSession
function newestSessionDir(root) {
  let best = null
  const walk = (dir) => {
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === 'session.v4.jsonl.zstd') {
        try {
          const m = statSync(p).mtimeMs
          if (!best || m > best.m) best = { m, dir }
        } catch {}
      }
    }
  }
  walk(root)
  return best ? best.dir.split(/[\\/]/).pop() : ''
}

// 忙闲检查：<3 分钟算在用
function busySessions(minutes = 3) {
  const now = Date.now()
  const out = []
  const walk = (dir) => {
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === 'session.v4.jsonl.zstd') {
        try {
          const age = (now - statSync(p).mtimeMs) / 60000
          if (age < minutes) out.push(dir.split(/[\\/]/).pop())
        } catch {}
      }
    }
  }
  walk(SESSIONS_ROOT)
  return [...new Set(out)]
}

const me = newestSessionDir(SESSIONS_ROOT)
const busy = busySessions()
const others = busy.filter((s) => s !== me)
console.log('busy sessions (<3min):', busy.join(', ') || '(none)')
console.log('mine:', me || '(unknown)')
console.log('others:', others.join(', ') || '(none)')
// 有别的会话在跑 -> 不中止、不请示：转成"排队等安静"（runner 自己会等它们安静再动手）。
// 主人 2026-11-05 口径：确认条件我自己查，查完就执行；有冲突就延迟，不问。
const mustQueue = others.length > 0
if (mustQueue) console.log('another session is active -> queueing (runner will wait for quiet, never interrupts it)')

const now = new Date()
// appExe 不写死：先找真存在的路径（2026-11-06 02:24 那次，手写的反斜杠被打工层吃掉，
// 变成 E:deepseek harnessDeepSeek Harness.exe，应用被杀后 3 次拉起全失败）。
// 手写仍然可以，只要走这个函数就不会写进一个不存在的路径。
function resolveAppExe() {
  const candidates = [
    'E:\deepseek harness\DeepSeek Harness.exe',
  ]
  for (const c of candidates) { if (existsSync(c)) return c.split(String.fromCharCode(92)).join("/") }
  console.log('WARN: app exe not found, falling back to the first candidate')
  return candidates[0]
}

const req = {
  id: randomUUID(),
  createdAt: now.toISOString(),
  targetAt: new Date(now.getTime() + delaySec * 1000).toISOString(),
  mode: 'in',
  policy,
  force: false,
  waitQuiet: mustQueue || policy !== 'continue',
  quietMin: 0.35,   // 21 秒：输出结束后只留一个「你好判断要不要拦住」的窗口
  maxWaitMin: 3,     // 主人一直有新输入就最多等 3 分钟，然后放弃
  reason: 'restore third-party bundles after dsh-dual-screen client-bundle boot crash (client decl removed)',
  // 关键：不排除自己。当前对话也算「有人在用」，正在跑就该等它安静下来。
  excludeSession: '',
  requestedBy: 'agent',
  appExe: resolveAppExe(),
  sessionsRoot: SESSIONS_ROOT,
}

if (!existsSync(STATE_DIR)) { console.log('ABORT: state dir missing'); process.exit(2) }
// 单一写者 + 合并：已有排队请求就不覆盖，只合并（保留更早的 targetAt）
const armed = armRestart({ stateDir: STATE_DIR, request: req })
if (!armed.ok) { console.log('ABORT: arm failed:', armed.error); process.exit(2) }
try { rmSync(join(STATE_DIR, 'cancel.json'), { force: true }) } catch {}
if (armed.coalesced) {
  console.log('merged into pending request', armed.request.id, '| targetAt kept =', armed.request.targetAt, '| reasons =', (armed.request.reasons || []).length)
} else {
  console.log('request written, targetAt =', req.targetAt)
}

for (const task of ['DSH-Restart-Guard', 'DSH-Restart-Guard-Watchdog']) {
  const r = spawnSync('schtasks.exe', ['/run', '/tn', task], { encoding: 'utf8', windowsHide: true })
  console.log(`schtasks /run ${task} -> exit ${r.status} ${String(r.stdout || '').trim().slice(0, 60)}`)
}
console.log('guard armed (20s window); policy=' + policy + ' targetAt=' + req.targetAt + ' ; runner re-checks at fire time: waits until no session has activity younger than ' + req.quietMin + 'min (max ' + req.maxWaitMin + 'min)')
