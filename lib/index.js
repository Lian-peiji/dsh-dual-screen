/**
 * dsh-dual-screen / 副屏管家 —— cordis 服务端入口（P0 骨架）
 * ============================================================================
 * 干什么（PLAN.md v0.5）：
 *   1) 本鲸调工具打开的浏览器/终端窗口，自动投送到副屏（Win32 投送器，P1）
 *   2) 副屏常驻小面板，可关；开关按钮在 DSH 左侧菜单栏（P2）
 *   3) 问答/确认可在副屏直接回答（P3/P4）
 *
 * 硬约束（不许破）：
 *   - 绝不移动 DSH 主窗
 *   - 绝不动主人自己的浏览器窗口（只认 ego 标记，见 P0 实测）
 *   - 单屏时静默待机
 *   - 杀进程一律按 --user-data-dir 精确匹配，绝不 kill 主人的 Edge
 *
 * P0 阶段只做：屏幕枚举 + 配置读写 + 健康检查路由。
 *   P1 → lib/windows.js（投送器拉起/守护/规则下发/上报接收）
 *   P2 → lib/panel.js（面板 HTML + Edge --app + toggle）
 *   P3 → session/event → SSE
 *   P4 → 问答镜像与回填
 *   P6 → V2 透明鲸鱼桌宠：面板形态走 config.panel.form（'bubble' | 'pet'），
 *        投送器与面板之间的接口只传「矩形 + 状态」，不认具体窗体技术，
 *        所以 v2 只换 panel 壳，不改 windows.js / 事件流。
 * ============================================================================
 */
import { existsSync, appendFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { loadConfig, saveConfig, ensureDirs, DATA_DIR, LOG_DIR, CONFIG_PATH, EDGE_PROFILE_DIR } from './config.js'
import { getDisplays, panelRect, toolWindowRect, lastProbeError } from './display.js'
import { createBridgeController } from './windows.js'
import { createPanelController, pickEdge } from './panel.js'
import { createPetController } from './pet.js'
import { loadHostDeps } from './hostdeps.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PANEL_DIR = join(dirname(HERE), 'panel')
const LAUNCHER_PS1 = join(dirname(HERE), 'bin', 'run-on-secondary.ps1')

export const name = 'dual-screen'
export const inject = ['webServer', 'tools']

// ── P5-1 `run_on_secondary`：把「在副屏上生一个进程」变成工具 ────────────────
// 为什么必须"生"而不是"搬"：窗口第一帧的位置由 CreateProcess 的 STARTUPINFO 决定，
// 任何事后的 SetWindowPos 都已经在主屏画过一帧（就是那道白闪，PLAN §14.5）。
//
// 为什么绕道 hostdeps：`@deepseek-ai/dsh-tools` 在这里是 optional peer，桌面 profile
// 不装 peers → 裸 import 直接抛。旧版把它写在 apply() 里裸跑，2026-11-06 凌晨
// **整个宿主起不来**（POSTMORTEM 那一晚）。现在照 dsh-restart-guard 验证过的做法：
//   ① 顶层 await 动态解析（宿主树 → 自己依赖 → 本地等价实现），拿不到也**不抛**；
//   ② 真正注册整段包在 try/catch 里，失败只是"工具不可用"，投送/面板/桌宠照常。
const hostDeps = await loadHostDeps().catch((e) => ({
  defineTool: null,
  notes: ['hostdeps 加载失败: ' + String((e && e.message) || e)],
}))
const toolInfo = {
  name: 'run_on_secondary',
  registered: false,
  error: null,
  notes: (hostDeps && Array.isArray(hostDeps.notes)) ? hostDeps.notes.slice(0, 6) : [],
}

const LOG_FILE = join(LOG_DIR, 'dual-screen.log')

// ---- P3 会话事件环（PLAN §9 P3 / §7.6）----
// 面板时间线原先只有投送事件（窗口被搬到副屏），主人最想知道的「这轮跑完了 /
// 报错了 / 长任务挂了」完全没有。这里维护一个定长环，喂给 panel.json 的 events。
//
// 只留"有意义"的几类，别把每个 token 都塞进去：turn/start、turn/end、tool/result
// 里的失败、以及一轮结束时算出耗时。其它事件一律忽略（fires 每秒都可能有）。
const EVT_CAP = 40
const sessionEvents = []          // 最新在前
const sessionSeen = new Map()     // sessionId -> 最近活动时间（任何会话事件）
const userSeen = new Map()        // sessionId -> 最近**用户亲手**发言时间
// 本插件自己注进去的消息（rpcId）。判断"用户亲手打的"时必须排除它们，
// 否则「继续」会在目标会话里制造事件、把自己喂成"最新"，形成自我强化的错误目标
// —— 这正是 2026-11-06 那次十几连点全部发错会话的机制。
const selfInjected = new Set()

/**
 * 选「继续」的目标。
 *
 * 血的教训（2026-11-06 21:44）：早先按 `activity.running[0]` 取，结果每一次点击都
 * 注进了**另一间会话**（同工作区里的 session-378047f0），主人那边当然什么都不发生。
 * 他连着点了十几次「继续」，界面全都显示"已发送" —— 消息是真的发了，只是发错了人。
 *
 * 现在的规则（按主人 2026-11-06 的意见：应该发给"当前打开/最近在聊的那个"）：
 *   1. 指定了 session 就用它（面板上可以点选）；
 *   2. 否则只在**顶层会话**里挑（agents.roots()）—— 子会话是 agent 自己派出去的活，
 *      主人看不见，注进去等于石沉大海；
 *   3. 排序：最近**用户亲手**发言 > 最近任意活动 > 正在跑 > 注册顺序。
 *      用"用户发言"优先，是因为"主人刚在哪个窗口说过话"就等于"他正看着哪个"。
 */
function pickContinueTarget(agents, activity, wanted) {
  const safe = (fn, fb) => { try { return fn() } catch { return fb } }
  let roots = safe(() => agents.roots(), null)
  if (!Array.isArray(roots) || !roots.length) roots = safe(() => agents.list(), []) || []
  const ids = roots.map((a) => String(a && a.id)).filter(Boolean)
  if (!ids.length) return { id: '', why: 'no-live-agent' }

  if (wanted && ids.includes(String(wanted))) return { id: String(wanted), why: 'explicit' }
  if (wanted) {
    // 面板点了别的会话：只要那个 agent 还活着（哪怕不是 root）就尊重它。
    const anyId = String(wanted)
    if (safe(() => !!agents.get(anyId), false)) return { id: anyId, why: 'explicit-non-root' }
  }

  // 排序只用「用户亲手发言」这一项。**故意不掺 sessionSeen**：注入会在目标会话里
  // 制造事件，把它喂成"最新"，越点越错（2026-11-06 连点十几次的根因）。
  const score = (id) => {
    const user = userSeen.get(id) || 0
    const run = activity && activity.running.has(id) ? 1 : 0
    return [user, run]
  }
  const sorted = ids.slice().sort((a, b) => {
    const A = score(a), B = score(b)
    for (let i = 0; i < A.length; i++) { if (A[i] !== B[i]) return B[i] - A[i] }
    return 0
  })
  const best = sorted[0]
  const A = score(best)
  if (!A[0] && !A[1]) {
    // 既没人发言、也没有在跑的会话 —— 这一刻没有"当前会话"可言。
    // 宁可拒绝，也不许瞎猜一个注进去：2026-11-06 那次连点十几次全是"显示已发送、
    // 其实发到别的会话"，根因就是这里退回了脏值（activity.lastSession）。
    return { id: '', why: 'need-explicit' }
  }
  return { id: best, why: A[0] ? 'recent-user' : 'running-root' }
}
const turnStartedAt = new Map()   // `${sessionId}#${turn}` -> 起始 ms

function evtPush(type, title, reason) {
  try {
    sessionEvents.unshift({ ts: Date.now(), type, proc: title, title: '', reason: reason || '' })
    if (sessionEvents.length > EVT_CAP) sessionEvents.length = EVT_CAP
    // 面板每 2 秒拉一次；这里只在"有事"时才需要动，无需通知机制。
    log('event: ' + type + ' ' + (reason ? '(' + reason + ')' : title || ''))
  } catch { }
}

function shortId(id) {
  const s = String(id || '')
  const m = s.match(/([0-9a-f]{8})[0-9a-f-]*$/i)
  return m ? m[1] : s.slice(0, 8)
}

// onSessionEvent 在模块顶层，而 activity / noteActivity 是 apply() 里的局部量。
// 直接引用会 ReferenceError（而且被内部 catch 吞掉，表现是"事件静默不生效"——
// 2026-11-06 补六档状态时踩的）。用这个钩子把两边接起来：apply 里注册，
// 顶层只负责调用，没有注册就什么都不做。
let moodNotify = null
function notifyMood(kind) {
  try { if (typeof moodNotify === 'function') moodNotify(kind) } catch { }
}

/** 把一条宿主 session/event 翻译成面板能显示的一行。不抛错。 */
function onSessionEvent(session, event) {
  try {
    const sid = session && session.id ? String(session.id) : ''
    if (!sid || !event) return
    sessionSeen.set(sid, Date.now())
    // 用户亲手发言 → 记进 userSeen；本插件注入的（rpcId 认识）不算。
    if (event.type === 'user/message') {
      const src = (event.data && event.data.source) || null
      const rpc = src && src.rpcId ? String(src.rpcId) : ''
      if (rpc && selfInjected.has(rpc)) {
        selfInjected.delete(rpc)   // 只认一次，别让集合无限长
      } else {
        userSeen.set(sid, event.time || Date.now())
      }
    }
    const key = sid + '#' + (event.data && event.data.turn)
    switch (event.type) {
      case 'turn/start':
        turnStartedAt.set(key, event.time || Date.now())
        // 新一轮刚开始 = 在"想"（还没动手）。90 秒兜底防止卡在这一档。
        notifyMood('start')
        return
      case 'tool/call':
        // 一动工具就不再是"纯思考"，交给 work。
        notifyMood('tool')
        return
      case 'turn/end': {
        const r = event.data && event.data.reason
        const kind = r && r.kind ? String(r.kind) : 'completed'
        const started = turnStartedAt.get(key) || 0
        turnStartedAt.delete(key)
        const tookMs = started ? Math.max(0, (event.time || Date.now()) - started) : 0
        const took = tookMs >= 1000 ? ' · ' + Math.round(tookMs / 1000) + 's' : ''
        if (kind === 'completed') {
          // 顺利收工 → 庆祝 6 秒（happy 池），然后自然落回 idle。
          notifyMood('done')
          evtPush('turn-done', shortId(sid) + ' 这轮完成' + took, '')
        } else if (kind === 'error') {
          const msg = (r.error && (r.error.message || r.error.code)) || 'error'
          notifyMood('error')
          evtPush('turn-error', shortId(sid) + ' 这轮出错' + took, String(msg).slice(0, 80))
        } else if (kind === 'aborted') {
          notifyMood('stop')
          evtPush('turn-aborted', shortId(sid) + ' 这轮被停' + took, '')
        } else if (kind === 'max-tokens') {
          notifyMood('error')
          evtPush('turn-error', shortId(sid) + ' 撞了上下文上限', 'max-tokens')
        } else {
          notifyMood('stop')
          evtPush('turn-end', shortId(sid) + ' 这轮结束', kind)
        }
        return
      }
      case 'tool/result': {
        const err = event.data && event.data.error
        if (!err) return
        const name = (err.name || 'tool')
        // 一次失败的工具调用值得记一行；成功的那些不记（太吵）。
        evtPush('tool-failed', '工具 ' + name + ' 失败', String(err.reason || err.code || '').slice(0, 80))
        return
      }
      default:
        return
    }
  } catch { }
}

function log(line) {
  try {
    ensureDirs()
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`, 'utf8')
  } catch {}
}

function json(res, value, status = 200) {
  const body = JSON.stringify(value, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(body)
}

async function readBody(req) {
  let body = ''
  try { for await (const chunk of req) body += chunk } catch {}
  try { return JSON.parse(body || '{}') } catch { return {} }
}

// ── P5-1 工具实现（放在 apply 外面，纯函数，方便离线测试直接 import）────────
function txt(t) {
  return { type: 'text', text: String(t ?? '') }
}

/**
 * 起一个副屏进程。永远 resolve 成对象，不抛 —— 工具报错不该变成一层异常栈。
 */
function launchOnSecondary(input) {
  return new Promise((resolvePromise) => {
    const done = (obj) => resolvePromise(obj)
    try {
      const command = String(input?.command ?? '').trim()
      if (!command) return done({ ok: false, message: '缺 command（要启动的可执行文件 / 命令名）' })
      if (/[\r\n]/.test(command)) return done({ ok: false, message: 'command 里不能带换行' })
      let args = input?.args == null ? '' : String(input.args)
      if (/[\r\n]/.test(args)) return done({ ok: false, message: 'args 里不能带换行' })
      const mode = ['minimized', 'show', 'hidden'].includes(input?.mode) ? input.mode : 'minimized'
      const timeoutMs = Math.min(60000, Math.max(5000, Number(input?.timeout_ms) || 20000))

      // PowerShell 会把「看起来像参数」的裸 token 当成自己的参数（-Args -NoProfile 会炸），
      // 所以给值补一个尾随空格逼它被引号包起来；值本身语义不变。
      if (args && !/\s/.test(args) && args.startsWith('-')) args += ' '

      const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', LAUNCHER_PS1, '-Command', command]
      if (args) psArgs.push('-Args', args)
      if (mode === 'show') psArgs.push('-Show')
      else if (mode === 'hidden') psArgs.push('-Hide')

      execFile('powershell.exe', psArgs, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
        const out = String(stdout || '').trim()
        const last = out.split(/\r?\n/).filter(Boolean).pop() || ''
        let parsed = null
        try { parsed = JSON.parse(last) } catch { /* 不是 JSON，下面按错误报 */ }
        if (parsed && typeof parsed === 'object') {
          if (parsed.ok === false) return done({ ok: false, message: String(parsed.error || 'CreateProcess 失败') })
          return done({ ok: true, ...parsed, mode })
        }
        const why = String((err && err.message) || stderr || '').trim().slice(0, 400)
        const tail = out.slice(-200)
        return done({ ok: false, message: (why || '启动器没有返回可解析的结果') + (tail ? ' | stdout: ' + tail : '') })
      })
    } catch (e) {
      return done({ ok: false, message: String((e && e.message) || e) })
    }
  })
}

/**
 * 注册 `run_on_secondary`。任何一步不满足就抛给调用方（那边统一降级），
 * 宿主本身永远不会因为这里失败而受影响。
 */
function registerRunOnSecondaryTool(ctx) {
  if (!ctx || !ctx.tools || typeof ctx.tools.register !== 'function') {
    throw new Error('tools 服务不可用（ctx.tools.register 不存在）')
  }
  const defineTool = hostDeps && typeof hostDeps.defineTool === 'function' ? hostDeps.defineTool : null
  if (!defineTool) throw new Error('@deepseek-ai/dsh-tools 拿不到，且没有本地等价实现')
  if (!existsSync(LAUNCHER_PS1)) throw new Error('启动器缺失: ' + LAUNCHER_PS1)

  const def = defineTool({
    name: 'run_on_secondary',
    description:
      '在**副屏**上启动一个进程，窗口出现在副屏（默认不抢键盘焦点）。'
      + '控制台程序（cmd / powershell / node / npm …）走 Windows Terminal 新窗口 --pos，'
      + '从窗口创建起就在副屏，不会先在主屏闪一下；其它程序走 CreateProcess + STARTUPINFO，'
      + '落错屏或超出副屏范围时用 SetWindowPos 立刻挪回来。'
      + '默认 mode=minimized：最小化出现在副屏（点任务栏恢复）；mode=show 可见且把焦点还给你；'
      + 'mode=hidden 完全隐藏（后台任务）。单屏时回落到主屏，返回的 screen 字段会说真话。',
    parameters: {
      command: { type: 'string', required: true, description: '要启动的可执行文件或命令名，如 cmd.exe / powershell.exe / npm.cmd' },
      args: { type: 'string', description: '原样拼在命令后面的参数，如 "/k npm run dev"；不给就是不传' },
      mode: { type: 'string', enum: ['minimized', 'show', 'hidden'], description: '窗口显示方式，默认 minimized' },
      timeout_ms: { type: 'number', description: '启动器超时（毫秒，默认 20000，范围 5000-60000）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          pid: { type: 'number' },
          hwnd: { type: 'number' },
          via: { type: 'string' },
          screen: { type: 'string' },
          rect: { type: 'array', items: { type: 'number' } },
          show: { type: 'number' },
          mode: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render(_args, value) {
        if (!value || value.ok === false) return [txt('✗ ' + (value?.message ?? '启动失败'))]
        const r = Array.isArray(value.rect) && value.rect.length === 4 ? ` · 位置 ${value.rect[0]},${value.rect[1]} ${value.rect[2]}×${value.rect[3]}` : ''
        return [txt(`✅ 已在 ${value.screen || '副屏'} 启动（${value.mode || 'minimized'}${value.via === 'terminal' ? ' · 终端窗口' : ''}）${r}`)]
      },
    },
    async execute(args) {
      try {
        return await launchOnSecondary(args || {})
      } catch (e) {
        return { ok: false, message: String((e && e.message) || e) }
      }
    },
  })

  ctx.effect(() => ctx.tools.register(def))
}

export function apply(ctx) {
  const config = loadConfig()
  ensureDirs()

  /** 运行时状态机。P1/P2 往这里挂 bridge/panel 子状态。 */

// ── P4 问答镜像（服务端中转）────────────────────────────────────────────────
// 面板是原生 WPF 窗口，不是网页，所以 PLAN §5.6 的 BroadcastChannel 作废。
// 链路：宿主 user-questions/request → pendingAsks → 面板拉 panel.json 渲染
//       → 面板点选 POST /ask/answer → 宿主收到答案直接回给 agent（主屏不弹窗）
// 超时未答 → 调 next() 交回主屏原生问答，绝不假装成功。
const pendingAsks = new Map()   // key -> { key, createdAt, questions, resolve, timeout }
const ASK_WAIT_MS = Number(process.env.DSH_DUAL_ASK_WAIT_MS || 120000)
const ASK_TTL_MS = 3 * 60 * 1000

/**
 * 会话活动状态（驱动桌宠表情）。
 *
 * 为什么放在插件里而不是让页面去猜：桌宠只拿到 panel.json，它不知道宿主里
 * 有几个会话在跑。这里维护一份最小状态机，由宿主事件喂：
 *   - 有会话 running            → 'work'（工作时它也跟着忙）
 *   - 有 pendingAsks            → 'wait'（等主人回答，优先级高于 work）
 *   - 都没了且最后一次变化超过 N → 'idle' / 长时间无活动 → 'sleep'
 * 不阻塞、不抛错：状态只影响一张脸，绝不该影响投送和面板。
 */
const activity = {
  running: new Set(),      // 正在跑的 sessionId
  lastSession: '',         // 最近跑过的会话（"继续"按钮的目标，PLAN §7.6）
  lastChangeAt: Date.now(),
  lastErrorAt: 0,
  // ---- 六档状态的另外两档（PLAN §21.2 缺口：think / happy 从来没产出过）----
  // think：刚起的那一轮还在"想"，还没有任何工具动手 —— 用 turn/start 打点，
  //        第一次 tool/call 就清掉。没有这一档，桌宠永远只有 work 一张脸。
  thinkingSince: 0,
  // happy：一轮顺利收工后的一小段庆祝，然后自然回落。
  happyUntil: 0,
  // 当前是否在一轮里（turn/start .. turn/end）。没有它，"刚动了个工具但会话
  // 还没结束"会掉回 idle —— 六档测试抓到的（2026-11-06）。
  turnActive: false,
}

/** 桌宠的"当前表情"，由宿主事件与 pendingAsks 共同决定 */
function petMood() {
  // 主人可以关掉"跟着忙闲换表情"，那就只留 idle —— 桌宠安静陪着也是一种选择。
  const cfg = loadConfig()
  if (cfg.pet && cfg.pet.followActivity === false) return 'idle'
  const now = Date.now()
  // 优先级从"最该让人知道"往下排：出错 > 等人回答 > 庆祝 > 思考 > 忙 > 闲。
  if (activity.lastErrorAt && now - activity.lastErrorAt < 20000) return 'sad'
  if (pendingAsks.size > 0) return 'wait'
  if (activity.happyUntil && now < activity.happyUntil) return 'happy'
  if (activity.thinkingSince && now - activity.thinkingSince < 90000) return 'think'
  // 一轮还没结束但已经动过手：work。running 是宿主状态，turnActive 是事件状态，
  // 两者任一说"忙"就该是 work。
  if (activity.turnActive) return 'work'
  if (activity.running.size > 0) return 'work'
  const idleMs = now - activity.lastChangeAt
  if (idleMs > 15 * 60 * 1000) return 'sleep'
  return 'idle'
}

function noteActivity(kind) {
  activity.lastChangeAt = Date.now()
  if (kind === 'error') activity.lastErrorAt = Date.now()
}

// 把顶层 onSessionEvent 的情绪变化接回这里的 activity（模块级钩子，见文件上部）。
// 六档：start=think、tool=work、done=happy 6 秒、error=sad、stop=回落。
moodNotify = (kind) => {
  try {
    if (kind === 'start') {
      activity.turnActive = true
      activity.thinkingSince = Date.now()
      activity.happyUntil = 0
      // 新一轮开始 = 上一轮的报错翻篇，否则一次失败会让后面几轮都挂"难过"脸。
      activity.lastErrorAt = 0
      noteActivity('start')
    } else if (kind === 'tool') {
      // 看到工具调用就说明"在一轮里"：插件热重载会错过 turn/start，
      // 靠这一行它也不会一直显示 idle（2026-11-06 实测）。
      activity.turnActive = true
      activity.thinkingSince = 0
      noteActivity('work')
    } else if (kind === 'done') {
      activity.turnActive = false
      activity.thinkingSince = 0
      activity.happyUntil = Date.now() + 6000
      noteActivity('stop')
    } else if (kind === 'error') {
      activity.turnActive = false
      activity.thinkingSince = 0
      noteActivity('error')
    } else if (kind === 'stop') {
      activity.turnActive = false
      activity.thinkingSince = 0
      noteActivity('stop')
    }
  } catch { }
}
ctx.effect(() => () => { moodNotify = null })

function publicAsk(a) {
  return { key: a.key, createdAt: a.createdAt, questions: a.questions }
}

function sweepAsks() {
  const now = Date.now()
  for (const [k, a] of pendingAsks) {
    if (now - a.createdAt > ASK_TTL_MS) {
      try { if (a.timeout) a.timeout() } catch { /* ignore */ }
      pendingAsks.delete(k)
    }
  }
}

function settleAsk(key, answer) {
  const a = pendingAsks.get(key)
  if (!a) return false
  pendingAsks.delete(key)
  try { if (a.resolve) a.resolve(answer) } catch { /* ignore */ }
  return true
}

const state = {
    startedAt: new Date().toISOString(),
    // 这两个字段是给"以后接手的人"和本鲸自己看的；写着 P2 而实际 P2/P3/P4/P6
    // 都完成了，会误导排查方向（2026-11-06 对账时被抓到，PLAN §21）。
    version: '0.3.0',
    phase: 'P6/P4/P3/P5',
    displays: null,
    displayCheckedAt: 0,
    active: false,        // 双屏且在运行 = true
    // 「主人亲手关的」标记：autoOpen / autoStart 不许把他的关闭动作撤销掉。
    // 只在这几种情况下为 true：面板被关、桌宠被关（不论来自 ✕、右键菜单、HTTP）。
    // 崩溃（lastError 非空）不算，那种要让它自己重试。
    panelClosedByUser: false,
    panelWasOpen: false,
    // 系统/插件自己关的（拔屏、停用），不是主人点的 ✕。不区分的话，重新插回
    // 副屏后面板再也不自动开了 —— 2026-11-06 单屏测试抓到的真 bug。
    panelClosedBySystem: false,
    petClosedByUser: false,
    petWasRunning: false,
    petClosedBySystem: false,
    bridge: { status: 'not-started', pid: null, moved: 0, lastError: null },  // P1
    panel: { status: 'not-implemented', pid: null, open: false },                 // P2
    events: 0,                                                                     // P3
    asks: 0,                                                                       // P4
  }

  // ---- 投送器（P1）：双屏 + 开启才跑；屏数变 1 或关功能就收尸，绝不留残进程 ----
  const bridge = createBridgeController({
    dataDir: DATA_DIR,
    onLog: (line) => log('[bridge] ' + line),
    onEvent: (evt) => {
      state.bridge = { ...state.bridge, status: bridge.status().status, pid: bridge.status().pid, moved: bridge.status().moved, lastError: bridge.status().lastError }
      if (evt && evt.type === 'moved' && typeof ctx.emit === 'function') {
        try { ctx.emit('dual-screen/window-moved', evt) } catch {}
      }
    },
  })

  function syncBridge() {
    const wantBridge = Boolean(state.active && config.enabled && config.moveWindows.enabled)
    const st = bridge.status()
    if (wantBridge && !st.running) {
      log('syncBridge: starting bridge')
      bridge.start()
    } else if (!wantBridge && st.running) {
      log(`syncBridge: stopping bridge (active=${state.active} enabled=${config.enabled} moveWindows=${config.moveWindows.enabled})`)
      bridge.stop('not needed')
    }
  }

  // ---- 面板（P2）：形态 C —— 折叠 56px 头像气泡 ↔ 展开 400 DIP ----
  const panel = createPanelController({ edgeProfileDir: EDGE_PROFILE_DIR, log: (l) => log('[panel] ' + l) })
  // ---- V2 桌宠（P6）：可选能力，失败绝不影响面板/投送（见 lib/pet.js 头注释）----
  const pet = createPetController({ log: (l) => log('[pet] ' + l) })

  // ---- 桌宠启动策略：单屏静默 + 随 DSH 自动启停（PLAN §19.7）----
  /**
   * 本机 http origin。webServer 是硬依赖（见文件顶部 inject），但 listen 之前
   * getOrigin() 会抛 —— 那时先给空串，让调用方跳过这一次，下一轮轮询再来。
   * 端口每次重启都变，所以绝不缓存、绝不写死。
   */
  function selfOrigin() {
    try {
      const o = ctx.webServer && typeof ctx.webServer.getOrigin === 'function' ? ctx.webServer.getOrigin() : ''
      return o || ''
    } catch {
      return ''
    }
  }

  let petLastAttempt = 0

  /**
   * 桌宠该不该活着。
   *   onlyOnSecondary（默认 true）→ 没有副屏：不启动；已经在跑就收掉。
   *   autoStart（默认 false）     → 随 DSH 起来；主人自己点 start 的不受这里影响。
   * 拉不起来不许重试成瘾：同一个进程里两次尝试至少隔 15 秒，否则 2 秒的屏幕轮询
   * 会变成每 2 秒拉一次 Electron（实测过一次就会懂）。
   */
  // 桌宠自己退出**不一定**是主人关的：崩溃也长一个样。判据是 pet-electron 在
  // 菜单「让小肥鱼回去」时写的 pet-quit.json（见 pet-electron/main.js）。
  // 没有它 = 进程自己没了 = 崩溃，要让 autoStart 继续重试。
  const PET_QUIT_FILE = join(DATA_DIR, 'pet-quit.json')
  function petQuitMarkerFresh(startedAt) {
    try {
      const j = JSON.parse(readFileSync(PET_QUIT_FILE, 'utf8'))
      const at = Number(j && j.at) || 0
      return at > 0 && (!startedAt || at >= Number(startedAt) - 1000)
    } catch {
      return false
    }
  }

  function syncPet() {
    const cfgPet = loadConfig().pet || {}
    const st = pet.status()

    if (st.running) {
      state.petWasRunning = true
    } else if (state.petWasRunning && st.status !== 'starting') {
      state.petWasRunning = false
      if (state.petClosedBySystem) {
        state.petClosedBySystem = false
        log('syncPet: pet was stopped by us (no secondary), not a crash and not the owner')
      } else if (!st.lastError) {
        if (petQuitMarkerFresh(st.startedAt)) {
          log('syncPet: pet closed from its own menu -> owner intent, no auto restart')
          state.petClosedByUser = true
        } else {
          log('syncPet: pet vanished without a quit marker -> treating as a CRASH, autoStart will retry')
        }
      }
    }
    if (state.petClosedByUser && !st.running) return

    if (!state.active && st.running) {
      log('syncPet: no secondary monitor -> stopping pet')
      // 我们自己收的，别让下一轮当成"主人关的"或"崩溃"。
      state.petClosedBySystem = true
      pet.stop('no secondary')
      return
    }
    // 面板开着 = 副屏已经有主体，桌宠让位（二选一，见 panelIsUp）。
    if (panelIsUp() && st.running) {
      log('syncPet: panel is up -> hiding the pet')
      state.petClosedBySystem = true
      pet.stop('panel open')
      return
    }
    const want = petShouldShow()
    if (!want || st.running || st.status === 'starting') return
    if (Date.now() - petLastAttempt < 15000) return
    const origin = selfOrigin()
    if (!origin) {
      log('syncPet: webServer origin unavailable yet, skip')
      return
    }
    petLastAttempt = Date.now()
    log('syncPet: auto-start pet')
    pet.start(origin, { size: Number(cfgPet.size) || 0, theme: cfgPet.theme || '', config: loadConfig() })
      .catch((e) => log('syncPet: pet start failed ' + String((e && e.message) || e)))
  }

  /**
   * 面板是否占着副屏（open/opening）。桌宠与面板**二选一**：
   * 主人 2026-11-06 的决定 —— 折叠圆气泡又卡又难看，直接砍掉；
   * 收起态就是桌宠本身（透明、可点、可拖），平时面板开着时不摆桌宠。
   */
  function panelIsUp() {
    const st = panel.status()
    return st.status === 'open' || st.status === 'opening'
  }

  /** 此刻桌宠该不该出现：只有一个出口时它才有存在的意义。 */
  function petShouldShow() {
    const cfgPet = loadConfig().pet || {}
    if (cfgPet.enabled === false) return false
    if (!state.active) return false              // 单屏静默（PLAN §19.7）
    if (state.petClosedByUser) return false      // 主人亲手叫它回去
    if (panelIsUp()) return false                // 面板开着 = 副屏有主体，不摆桌宠
    return cfgPet.autoStart !== false            // 默认开：面板关掉后它是唯一入口
  }

  /** 折叠/展开各自的窗口矩形（物理像素）。折叠是 56 DIP 的方块，贴副屏右上角。 */
  function panelRectFor(form) {
    const d = state.displays
    if (!d || !d.hasSecondary) return null
    return panelRect(d, config.panel.marginPx, config.panel.width, config.panel.height)
  }

  function baseUrl(req) {
    const host = (req && req.headers && req.headers.host) || '127.0.0.1'
    return `http://${host}`
  }

  async function togglePanel(req) {
    const st = panel.status()
    if (st.status === 'open' || st.status === 'opening') {
      await panel.close()
      // 主人自己关的就别再被 autoOpen 弹回来（2026-11-06：不记这一笔，
      // 点一下 ✕ 十五秒后自己又出来，像中了邪）。
      state.panelClosedByUser = true
      // 收起态 = 桌宠。刚才是"收起来"不是"叫它滚"，所以清掉主人关桌宠的标记，
      // 让它顶上来当出口（2026-11-06 主人定的交互）。
      state.petClosedByUser = false
      state.petClosedBySystem = false
      petLastAttempt = 0
      syncPet()
      return { ok: true, open: false, pet: pet.status().status }
    }
    state.panelClosedByUser = false
    if (!state.active) return { ok: false, error: 'no secondary monitor', open: false }
    // 面板占屏时桌宠让位：两个都摆着既挡视线又抢置顶（主人 2026-11-06 的反馈）。
    if (pet.status().running) {
      state.petClosedBySystem = true
      pet.stop('panel opened')
    }
    const rect = panelRectFor('expanded')
    // v0.6: 原生 WPF 宿主自己渲染内容，不再需要 URL（P3 再接 HTTP 数据）
    // 副屏缩放系数：字号按目标屏等比放大，否则 150% 副屏上字只有 2/3 大
    const out = await openPanelAt(baseUrl(req), rect)
    return out
  }

  /** 用给定 origin 打开面板（HTTP 请求和开机自动打开共用同一条路）。 */
  async function openPanelAt(origin, rect) {
    const uiScale = (state.displays && state.displays.secondary && state.displays.secondary.scale) || 1
    const dataUrl = origin + '/dsh-dual-screen/panel.json'
    const out = await panel.open(rect, loadConfig(), uiScale, dataUrl)
    return { ok: out.status === 'open', open: out.status === 'open', panel: out, error: out.lastError }
  }

  let panelLastAttempt = 0

  /**
   * 面板随 DSH 启动自动打开（config.panel.autoOpen）。
   * 三条刹车：没有副屏 / 主人手动关过（panelClosedByUser）/ 刚试过（15 秒）。
   */
  function syncPanel() {
    try {
      const cfg = loadConfig()
      const st = panel.status()
      if (st.status === 'open' || st.status === 'opening') { state.panelWasOpen = true; return }
      // 之前开着、现在没了 = 主人点了 ✕（我们的 close() 会先置 panelClosedByUser）。
      if (state.panelWasOpen) {
        state.panelWasOpen = false
        // 系统收的（拔屏/停用）不算主人的意思，否则插回副屏后再也不自动开。
        if (state.panelClosedBySystem) {
          state.panelClosedBySystem = false
          log('syncPanel: panel was closed by us (no secondary/disabled), not by the owner')
        } else {
          state.panelClosedByUser = true
        }
      }
      if (!state.active || state.panelClosedByUser) return
      if (!(cfg.panel && cfg.panel.autoOpen)) return
      if (Date.now() - panelLastAttempt < 15000) return
      const origin = selfOrigin()
      if (!origin) { log('syncPanel: webServer origin unavailable yet, skip'); return }
      panelLastAttempt = Date.now()
      const rect = panelRectFor('expanded')
      if (!rect) return
      log('syncPanel: auto-open panel')
      openPanelAt(origin, rect).catch((e) => log('syncPanel: open failed ' + String((e && e.message) || e)))
    } catch (e) {
      log('syncPanel failed: ' + String((e && e.message) || e))
    }
  }

  // ---- 屏幕检测：启动即测一次，之后 2 秒轮询兜底（PLAN §5.1 热插拔） ----
  async function refreshDisplays(force = true) {
    const d = await getDisplays(force)
    state.displays = d
    state.displayCheckedAt = Date.now()
    const wasActive = state.active
    state.active = Boolean(config.enabled && d.hasSecondary)
    if (wasActive !== state.active) {
      log(`active -> ${state.active} (monitors=${d.count}, hasSecondary=${d.hasSecondary})`)
    }
    // 拔掉副屏：面板隐藏而不是搬回主屏（PLAN §7.5 #15），且不报错
    if (!state.active && panel.status().status === "open") {
      log("secondary monitor gone: closing panel (hide, do not move to primary)")
      state.panelClosedBySystem = true
      try { await panel.close() } catch {}
    }
    syncBridge()
    syncPanel()
    syncPet()
    return d
  }

  ctx.effect(() => {
    refreshDisplays(true).catch((e) => log('initial display probe failed: ' + String(e && e.message)))
    const timer = setInterval(() => { refreshDisplays(true).catch(() => {}) }, 2000)
    if (typeof timer.unref === 'function') timer.unref()
    return () => {
      clearInterval(timer)
      // 收尸：投送器与面板必须跟着插件一起走，绝不留下孤儿进程（PLAN §8）
      try { bridge.stop('plugin disposed') } catch {}
      try { panel.close() } catch {}
      try { pet.stop('plugin disposed') } catch {}
    }
  })

  // ---- 会话活动 → 桌宠表情（V2 状态映射）----
  // api-session/status(sessionId, running) 是宿主给的最便宜信号：一个 agent 开始
  // 或结束一轮。我们只记集合大小，不碰会话内容 —— 桌宠只需要"忙不忙"。
  //
  // 订阅包在 try 里：事件名或签名变了，最坏结果只是桌宠不跟着变脸，绝不能在
  // apply() 里抛出去 —— 那会把整套宿主拖下水（这条是 2026-11-06 凌晨用宿主
  // 崩溃换来的，见 PLAN §14.5）。
  try {
    ctx.on('api-session/status', (sessionId, running) => {
      try {
        if (running) activity.running.add(String(sessionId))
        else activity.running.delete(String(sessionId))
        // "继续"按钮要有个目标：记最近跑过的会话（run 起来时更新，停了不清）。
        if (running) activity.lastSession = String(sessionId)
        noteActivity(running ? 'start' : 'stop')
      } catch { }
    })

    ctx.on('api-session/removed', (sessionId) => {
      try { activity.running.delete(String(sessionId)) } catch { }
    })

    // 最近**用户亲手**发言的会话（api-session/activity 的语义就是"用户写的消息推进了
    // 会话列表活动"）。「继续」按它排序，才对得上"主人正看着哪个窗口"。
    ctx.on('api-session/activity', (sessionId, updatedAt) => {
      try {
        const id = String(sessionId)
        userSeen.set(id, Number(updatedAt) || Date.now())
        // 顺手把列表活动时间也记一份：有些事件流在这个宿主上不一定都到。
        if (!sessionSeen.get(id)) sessionSeen.set(id, Number(updatedAt) || Date.now())
      } catch { }
    }, { global: true, prepend: true })

    // P3：会话事件流 → 面板时间线（turn 完成/出错/被停/工具失败）。
    // 和 P4 一样必须 global+prepend：emit 型事件按 agent 作用域派发，不 global
    // 就只能看见本插件自己的会话。订阅放在 activity 的 try 里，签名变了也只是
    // 时间线空着，绝不在 apply() 里抛。
    ctx.on('session/event', (session, event) => { onSessionEvent(session, event) }, {
      global: true,
      prepend: true,
    })
  } catch (e) {
    log('session activity hooks unavailable (pet mood stays idle): ' + String((e && e.message) || e))
  }

  // 热重载刚起来时 activity 是空的（status 事件只在新一轮开始时才来），
  // "继续"按钮会瞬间没目标。用 agents 注册表兜一次底：注册顺序里最后一个
  // 就是最近创建/恢复的 agent，作为"最近会话"够用了。
  try {
    let agents = null
    try { agents = ctx.get('agents') } catch { agents = null }
    if (agents && typeof agents.list === 'function' && !activity.lastSession) {
      const live = agents.list()
      const newest = live.length ? live[live.length - 1] : null
      if (newest && newest.id) {
        activity.lastSession = String(newest.id)
        log('activity: seeded lastSession from agents registry -> ' + activity.lastSession)
      }
    }
  } catch (e) {
    log('activity seed failed: ' + String((e && e.message) || e))
  }

  // ---- P4：把宿主的「问用户」镜像到副屏面板（PLAN §5.6 / §19.8 / §26）----
  //
  // ⚠️ 2026-11-06 主人投诉：「问答只能在小窗进行了，主窗口的问答直接消失」。
  //    根因：本监听器拿了 request **不调 next()**，原生回答者永远轮不到，主窗口自然
  //    什么都弹不出来。小窗可以加成，但**绝不能顶掉 DSH 本体**。
  //
  // 现在的做法（照同一台机器上 dsh-im 的成对竞速法）：
  //   1. 立刻 `next()` —— 主窗口原生问答**照常弹出**，这是底线；
  //   2. 同时把同一题镜像到副屏面板；
  //   3. 谁先答算谁：
  //        · 主窗口先答 → 撤掉副屏卡片，返回主窗口的答案；
  //        · 副屏先答 → abort 我们自己塞进去的 signal（原生窗口随之收起），返回副屏答案；
  //        · 副屏一直没人点 → 就是等主窗口，超时也不影响它。
  //   `ask.mode: 'panel-only'` 才回到"只在副屏"的旧行为（主人明确要时才用）。
  //
  // approval / plan-review 这类 intent 一律不接管：高危确认必须让人看清主屏上下文。
  const PANEL_ASK_MS = Number(process.env.DSH_DUAL_PANEL_ASK_WAIT_MS || 120000)

  /** 把一条提问放进 pendingAsks，返回 { promise, cancel }；promise 得到 null = 超时/撤销。 */
  function queuePanelAsk(key, qs, outerSignal) {
    let cancelFn = () => {}
    const promise = new Promise((resolve) => {
      const finish = (a) => { try { clearTimeout(timer) } catch {} resolve(a) }
      const timer = setTimeout(() => {
        log('ask timed out on panel (main window unaffected): ' + key)
        pendingAsks.delete(key)
        finish(null)
      }, PANEL_ASK_MS)
      if (timer.unref) timer.unref()
      cancelFn = () => { pendingAsks.delete(key); finish(null) }
      pendingAsks.set(key, {
        key,
        createdAt: Date.now(),
        // publicAsk 直接把 questions 交给面板，宿主的结构原样传，不翻译字段。
        questions: qs.map((q) => ({
          id: String(q.id || ''),
          question: String(q.question || ''),
          header: q.header ? String(q.header) : '',
          detail: q.detail ? String(q.detail) : '',
          multiSelect: Boolean(q.multiSelect),
          options: (Array.isArray(q.options) ? q.options : []).map((o) => ({
            label: String((o && o.label) || ''),
            description: String((o && o.description) || ''),
          })),
        })),
        resolve: finish,
        timeout: () => finish(null),
      })
      // 主窗口那边被取消/会话中断：副屏卡片也跟着撤。
      if (outerSignal && typeof outerSignal.addEventListener === 'function') {
        outerSignal.addEventListener('abort', () => { pendingAsks.delete(key); finish(null) }, { once: true })
      }
    })
    return { promise, cancel: () => cancelFn() }
  }

  try {
    ctx.on('user-questions/request', async (request, next) => {
      let key = ''
      try {
        const cfgAsk = loadConfig().ask || {}
        if (cfgAsk.enabled === false) return await next()

        // 门槛只看"有没有副屏"，**不看面板此刻开没开**：
        // 提问可能挂着 120 秒，主人完全可能在这期间把面板打开再来答；
        // 而面板关着时多一条待答记录，代价只是 TTL 到期自己消失。
        // 反过来（要求面板开着才镜像）会让"先提问、后开面板"这个真实用法失效。
        if (!state.active) return await next()
        const qs = Array.isArray(request && request.questions) ? request.questions : []
        if (!qs.length) return await next()
        if (qs.some((q) => q && q.intent && q.intent.kind === 'approval')) return await next()

        key = 'ask-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
        log('ask mirrored to panel (' + String(cfgAsk.mode || 'race') + '): ' + key + ' (' + qs.length + ' question(s))')

        if (cfgAsk.mode === 'panel-only') {
          // 旧行为：只有副屏能答。主人明确选了才走这条。
          const panelAsk = queuePanelAsk(key, qs, request && request.signal)
          const answer = await panelAsk.promise
          if (answer) return answer
          log('panel-only ask got no answer -> main screen: ' + key)
          return await next()
        }

        // ---- race 模式：主窗口照常弹，两边抢答 ----
        const ac = new AbortController()
        let prevSignal = null
        try {
          prevSignal = request && request.signal
          if (request) request.signal = ac.signal     // 原生回答者拿到我们可控的 signal
        } catch (e) {
          log('ask: could not swap request.signal -> ' + String((e && e.message) || e))
        }
        if (prevSignal && typeof prevSignal.addEventListener === 'function') {
          prevSignal.addEventListener('abort', () => { try { ac.abort() } catch {} }, { once: true })
        }

        const nativeP = Promise.resolve().then(() => next())
        const panelAsk = queuePanelAsk(key, qs, ac.signal)

        const winner = await Promise.race([
          nativeP.then((a) => ({ from: 'main', answer: a }), (e) => ({ from: 'main-error', error: e })),
          panelAsk.promise.then((a) => ({ from: a ? 'panel' : 'panel-timeout', answer: a })),
        ])

        if (winner.from === 'panel') {
          log('ask answered on the secondary panel: ' + key)
          panelAsk.cancel()
          try { ac.abort(new Error('answered on the secondary panel')) } catch {}
          nativeP.catch(() => {})          // 原生那边被 abort，别留未处理拒绝
          return winner.answer
        }
        // 主窗口先答 / 超时 / 报错 —— 面板这张卡都该撤掉，答案照旧走主窗口的。
        panelAsk.cancel()
        if (winner.from === 'main-error') {
          log('ask: native answerer failed (' + key + '): ' + String((winner.error && winner.error.message) || winner.error))
          throw winner.error
        }
        log('ask answered on the main window: ' + key)
        return winner.answer
      } catch (e) {
        log('ask mirror failed (' + key + '): ' + String((e && e.message) || e))
        try { if (key) pendingAsks.delete(key) } catch {}
        return await next()
      }
    }, {
      // `global: true` 才能收到别的会话的提问（这个事件按 agent 作用域派发）；
      // `prepend: true` 必须排在宿主原生回答者前面，否则监听器根本不跑。
      // 注意：prepend 只决定"谁先被问"，**不代表可以吞掉 next()** —— 见上面的教训。
      global: true,
      prepend: true,
    })
  } catch (e) {
    // 事件不存在 / 签名变了：P4 只是锦上添花，绝不能连累插件加载（PLAN §14.5）。
    log('user-question mirror unavailable (P4 stays mock-only): ' + String((e && e.message) || e))
  }

  // ---- P5-1：注册 run_on_secondary（失败只降级，绝不连累宿主）────────────
  // POSTMORTEM 那晚的教训：可选能力失败必须降级，不能连坐宿主。
  try {
    registerRunOnSecondaryTool(ctx)
    toolInfo.error = null
    toolInfo.registered = true
    log('run_on_secondary registered')
  } catch (e) {
    toolInfo.registered = false
    toolInfo.error = String((e && e.message) || e)
    log('run_on_secondary disabled: ' + toolInfo.error)
  }

  // ---- 路由（同源，沿用 DSH 既有 webServer；不额外开端口，PLAN §8） ----

  // kind='exact' 覆盖绝大多数端点；主题素材走前缀路由（一个 handler 服务整个目录）。
  const route = (path, handler, kind = 'exact') =>
    ctx.effect(() => ctx.webServer.register({
      kind,
      path,
      handler: async (req, res) => {
        try { await handler(req, res) } catch (err) {
          log(`route ${path} failed: ${String((err && err.message) || err)}`)
          json(res, { ok: false, error: String((err && err.message) || err) }, 500)
        }
      },
    }))

  route('/dsh-dual-screen/health.json', async (_req, res) => {
    const d = state.displays
    json(res, {
      ok: true,
      name,
      version: state.version,
      phase: state.phase,
      startedAt: state.startedAt,
      enabled: config.enabled,
      active: state.active,
      dataDir: DATA_DIR,
      configPath: CONFIG_PATH,
      configExists: existsSync(CONFIG_PATH),
      monitors: d ? d.count : 0,
      hasSecondary: d ? Boolean(d.hasSecondary) : false,
      dpiAwareAfter: d ? d.dpiAfter : null,
      primary: d ? d.primary : null,
      secondary: d ? d.secondary : null,
      probeError: lastProbeError(),
      bridge: state.bridge,
      panel: panel.status(),
      events: state.events,
      asks: state.asks,
      tool: toolInfo,
    })
  })

  route('/dsh-dual-screen/displays.json', async (req, res) => {
    if (req.method === 'POST') {
      const d = await refreshDisplays(true)
      return json(res, { ok: true, reason: 'forced refresh', displays: d })
    }
    json(res, { ok: true, displays: state.displays || (await refreshDisplays(true)) })
  })

  route('/dsh-dual-screen/config', async (req, res) => {
    if (req.method === 'POST') {
      const patch = await readBody(req)
      const result = saveConfig(patch)
      log('config saved: ' + JSON.stringify(patch))
      // 面板拖边改尺寸也走这里：内存里的 config 必须立刻跟上，否则下一次开窗
      // 仍按旧宽高算矩形（2026-11-06 实测踩到：改了磁盘、开了还是 400x900）
      if (result.ok && result.config) { Object.assign(config, result.config) }
      await refreshDisplays(true)
      return json(res, { ok: result.ok, error: result.error, config: result.config })
    }
    json(res, { ok: true, config: loadConfig(), defaults: undefined })
  })

  // ---- 面板静态资源 + 开关（P2）----
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' }
  function serveFile(res, name, fallbackMime = 'application/octet-stream') {
    const p = join(PANEL_DIR, name)
    const ext = name.slice(name.lastIndexOf('.'))
    try {
      const buf = readFileSync(p)
      res.writeHead(200, { 'Content-Type': MIME[ext] || fallbackMime, 'Cache-Control': 'no-store' })
      res.end(buf)
      return true
    } catch {
      return false
    }
  }

  // ---- 桌宠主题（V2 可插拔）----
  // A theme is a folder under panel/pets/<id>/ with theme.json + clips. Discovery
  // is by directory listing, so adding a character later needs no code change.
  const PETS_DIR = join(PANEL_DIR, 'pets')

  function listPetThemes() {
    const out = []
    try {
      for (const e of readdirSync(PETS_DIR, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        const dir = join(PETS_DIR, e.name)
        let meta = null
        try { meta = JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8')) } catch { meta = null }
        if (!meta) continue      // 没有 theme.json 的目录不是主题，跳过而不是报错
        out.push({
          id: e.name,
          name: meta.name || e.name,
          description: meta.description || '',
          clips: Object.keys(meta.clips || {}).length,
        })
      }
    } catch { /* 没有 pets 目录也不能让插件崩 */ }
    return out
  }

  route('/dsh-dual-screen/pets.json', async (_req, res) => {
    const themes = listPetThemes()
    const picked = (loadConfig().pet && loadConfig().pet.theme) || (themes[0] && themes[0].id) || ''
    json(res, { ok: true, themes, current: picked })
  })

  // 桌宠页面本体
  route('/dsh-dual-screen/pet-page', async (_req, res) => {
    if (!serveFile(res, 'pet.html', 'text/html; charset=utf-8')) { res.writeHead(404); res.end('pet page not found') }
  })

  // 主题素材：/dsh-dual-screen/pet-asset?f=<主题id>/<相对路径>
  // 单条 exact 路由 + 查询参数。**不要改成 prefix 路由**：实测（2026-11-06）
  // kind='prefix' 注册不报错、但任何子路径都 404，白折腾一轮。
  route('/dsh-dual-screen/pet-asset', async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const rel = decodeURIComponent(url.searchParams.get('f') || '')
      if (!rel) { res.writeHead(400); res.end('missing f'); return }
      const full = resolve(PETS_DIR, rel)
      const root = resolve(PETS_DIR)
      if (!full.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return }
      const ext = full.slice(full.lastIndexOf('.')).toLowerCase()
      const mime = {
        '.json': 'application/json; charset=utf-8',
        '.webm': 'video/webm',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
      }[ext] || 'application/octet-stream'
      const buf = readFileSync(full)
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' })
      res.end(buf)
    } catch {
      res.writeHead(404); res.end('not found')
    }
  })


  route('/dsh-dual-screen/panel', async (_req, res) => {
    if (!serveFile(res, 'index.html')) { res.writeHead(404); res.end('panel not found') }
  })
  route('/dsh-dual-screen/panel.js', async (_req, res) => {
    if (!serveFile(res, 'panel.js')) { res.writeHead(404); res.end('') }
  })
  route('/dsh-dual-screen/panel.css', async (_req, res) => {
    if (!serveFile(res, 'panel.css')) { res.writeHead(404); res.end('') }
  })
  // 头像走运行时读取本机已装的 whale-widget 素材，**不打包进仓库**
  // （大肥鱼形象 CC BY-NC-SA 4.0，非商用，按 PLAN §7.8 不进仓库）
  route('/dsh-dual-screen/avatar.png', async (_req, res) => {
    const candidates = [
      // 优先用插件自己的副本：鲸鱼挂件被卸载也不影响面板
      join(PANEL_DIR, 'avatar.png'),
      'E:\\dsh\\profiles\\desktop\\node_modules\\dsh-whale-widget\\assets\\DSniang1.png',
      'E:\\dsh\\profiles\\desktop\\node_modules\\dsh-whale-widget\\assets\\DSniang02.png',
    ]
    for (const p of candidates) {
      try {
        const buf = readFileSync(p)
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
        res.end(buf)
        return
      } catch {}
    }
    res.writeHead(404); res.end('')
  })

  route('/dsh-dual-screen/panel.json', async (_req, res) => {
    const d = state.displays
    const pst = panel.status()
    json(res, {
      ok: true,
      form: 'expanded',
      panel: pst,
      bridge: { status: bridge.status().status, moved: bridge.status().moved, skipped: bridge.status().skipped },
      display: d ? { primary: d.primary, secondary: d.secondary, hasSecondary: d.hasSecondary } : null,
      pendingAsks: pendingAsks.size,
      asks: [...pendingAsks.values()].map(publicAsk),
      // Panel bottom bar mirrors this so the pet button reflects the real process,
      // whoever started it (panel, sidebar, curl, or auto-start).
      pet: {
        status: pet.status().status,
        running: pet.status().running,
        size: pet.status().size,
        mood: petMood(),                 // idle | sleep | think | work | wait | happy | sad
        busy: activity.running.size,     // 正在跑的会话数（面板可显示）
      },
      // P3：投送事件 + 会话事件合并，新的在前。两边结构都是
      // { ts, type, proc, title, reason }，面板的 New-EventRow 直接吃。
      events: [...sessionEvents, ...(bridge.status().events || [])]
        .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
        .slice(0, 12),
      // 底部「继续」的可选目标（主人 2026-11-06：「应该发给当前打开的会话，或者能选」）。
      // 只列顶层会话，按用户亲手发言时间倒序；面板点一下就把「继续」发给那一间。
      sessions: (() => {
        try {
          let agents = null
          try { agents = ctx.get('agents') } catch { agents = null }
          if (!agents) return []
          let roots = null
          try { roots = typeof agents.roots === 'function' ? agents.roots() : null } catch { roots = null }
          if (!Array.isArray(roots) || !roots.length) roots = agents.list() || []
          return roots
            .map((a) => String(a && a.id))
            .filter(Boolean)
            .map((id) => ({
              id,
              short: shortId(id),
              // 只报"用户亲手"的时间：注入造成的时间戳是噪音，显示出来会误导。
              at: userSeen.get(id) || 0,
              running: activity.running.has(id),
            }))
            .sort((a, b) => (b.at - a.at) || (Number(b.running) - Number(a.running)))
            .slice(0, 5)
        } catch { return [] }
      })(),
      // 底部「设置」卡片的三个开关（PLAN §7.6「投送 / 面板开关」）。
      // 用 loadConfig() 现读：apply 开头那份 config 是快照，改完会滞后。
      settings: (() => {
        const c = loadConfig()
        return {
          moveWindows: c.moveWindows ? c.moveWindows.enabled !== false : true,
          panelAutoOpen: c.panel ? c.panel.autoOpen === true : false,
          petAutoStart: c.pet ? c.pet.autoStart === true : false,
          panelOpen: pst.status === 'open',
        }
      })(),
    })
  })


  route('/dsh-dual-screen/ask/pending.json', async (_req, res) => {
    sweepAsks()
    json(res, { ok: true, asks: [...pendingAsks.values()].map(publicAsk) })
  })

  route('/dsh-dual-screen/ask/answer', async (req, res) => {
    if (req.method !== 'POST') return json(res, { ok: false, error: 'POST only' }, 405)
    const body = await readBody(req)
    const key = String(body.key || '')
    if (!key || !Array.isArray(body.answers)) return json(res, { ok: false, error: 'key + answers[] required' }, 400)
    const ask = pendingAsks.get(key)
    if (!ask) return json(res, { ok: false, error: 'ask not pending (expired or already answered)' }, 404)
    const answers = body.answers.map((it) => {
      const out = { id: String(it && it.id || ''), selected: Array.isArray(it && it.selected) ? it.selected.map(String) : [] }
      if (it && it.custom) out.custom = String(it.custom)
      return out
    })
    const done = settleAsk(key, { answers })
    log('ask answered from panel: ' + key + ' -> ' + JSON.stringify(answers))
    json(res, { ok: done })
  })

  // 自测用：造一条假问答，验证「面板渲染 + 点选回填」整条链路，不驱动真实工具调用。
  route('/dsh-dual-screen/ask/mock', async (req, res) => {
    if (req.method !== 'POST') return json(res, { ok: false, error: 'POST only' }, 405)
    const body = await readBody(req)
    const key = 'mock-' + Date.now()
    const options = (Array.isArray(body.options) && body.options.length ? body.options : ['要', '不要', '稍后'])
    pendingAsks.set(key, {
      key,
      createdAt: Date.now(),
      questions: [{
        id: 'mock-q1',
        question: String(body.question || '要现在打包吗？'),
        header: '自测',
        detail: '',
        multiSelect: false,
        options: options.map((l) => ({ label: String(l), description: '' })),
      }],
      resolve: () => {},
      timeout: () => {},
    })
    json(res, { ok: true, key })
  })

  route('/dsh-dual-screen/toggle', async (req, res) => {
    if (req.method !== 'POST') return json(res, { ok: false, error: 'POST only' }, 405)
    const body = await readBody(req)
    if (body.action === 'close') { await panel.close(); return json(res, { ok: true, open: false }) }
    const out = await togglePanel(req)
    log('toggle: ' + JSON.stringify({ ok: out.ok, open: out.open, error: out.error }))
    json(res, out)
  })

  // 表单态（折叠/展开）：页面点一下就换窗口尺寸，几何归服务端管
  // Dev-only probe: what does a live agent actually expose? The public Agent type
  // only declares `id`, so the chip handlers would be guessing. This answers it in
  // one request instead of "click and read an error".
  route('/dsh-dual-screen/action/probe', async (_req, res) => {
    let agents = null
    try { agents = ctx.get('agents') } catch { agents = null }
    if (!agents || typeof agents.list !== 'function') {
      return json(res, { ok: false, error: 'agents service unavailable' })
    }
    const all = agents.list().map((a) => ({
      id: String(a.id),
      cancel: typeof a.cancel,
      inject: typeof a.inject,
      methods: Object.keys(a).filter((k) => typeof a[k] === 'function').slice(0, 40),
    }))
    // roots() 才是主人能看见的会话；子会话注进去等于石沉大海。
    let roots = null
    try { roots = typeof agents.roots === 'function' ? agents.roots().map((a) => String(a.id)) : null } catch { roots = null }
    const picked = pickContinueTarget(agents, activity, null)
    json(res, {
      ok: true, count: all.length, running: [...activity.running], lastSession: activity.lastSession,
      roots, continueTarget: picked, userSeen: [...userSeen.entries()], agents: all,
    })
  })

  // 副屏底部 chip 的落点（PLAN §7.6「核心」+「高价值」）：
//   stop     = 紧急刹车（停当前任务，主人主屏忙时最有用）
//   continue = 预设快捷指令「继续」，注进最近在跑的那个会话
  route('/dsh-dual-screen/action', async (req, res) => {
    if (req.method !== 'POST') return json(res, { ok: false, error: 'POST only' }, 405)
    const body = await readBody(req)
    const action = String(body.action || '')
    try {
      let agents = null
      try { agents = ctx.get('agents') } catch { agents = null }
      if (!agents || typeof agents.get !== 'function') {
        return json(res, { ok: false, action, error: 'agents service 不可用' })
      }

      if (action === 'stop') {
        const ids = [...activity.running]
        if (!ids.length) {
          return json(res, {
            ok: false, action,
            error: '没有正在跑的任务（刚热重载过插件时会这样，下一轮开始就准了）',
          })
        }
        const done = []
        for (const id of ids) {
          const agent = agents.get(id)
          if (!agent || typeof agent.cancel !== 'function') continue
          try {
            // keepInbox：和 dsh-im 的用法一致，别顺手把待发消息清了
            await agent.cancel({ kind: 'user' }, { keepInbox: true })
            done.push(id)
          } catch (e) {
            log('action stop failed for ' + id + ': ' + String((e && e.message) || e))
          }
        }
        log('action stop: cancelled ' + done.length + '/' + ids.length)
        return json(res, {
          ok: done.length > 0, action, cancelled: done.length, total: ids.length,
          error: done.length ? null : '取消没成功（看 dual-screen.log）',
        })
      }

      if (action === 'continue') {
        // 目标必须点击那一刻现取，而且只认顶层会话（除非面板明确指定了某一间）。
        const picked = pickContinueTarget(agents, activity, body && body.session)
        const id = picked.id
        if (!id) {
          return json(res, {
            ok: false, action, why: picked.why,
            error: picked.why === 'need-explicit'
              ? '现在没有"当前会话"可判断，请在小窗的会话列表里点一间'
              : '没有可继续的会话（先在 DSH 里跑一轮）',
          })
        }
        const agent = agents.get(id)
        if (!agent || typeof agent.inject !== 'function') {
          return json(res, { ok: false, action, error: '那个会话已经不在了' })
        }
        activity.lastSession = id
        const rpcId = randomUUID()
        // 记下自己的 rpcId：等这条消息在 session/event 里回来时，onSessionEvent 要认出
        // 它是"机器人发的"，不能算成主人亲手发言（否则目标排序会自我强化）。
        selfInjected.add(rpcId)
        if (selfInjected.size > 200) selfInjected.delete(selfInjected.values().next().value)
        // UserMessage 的形状照 dsh-im 的 Xke()：id/role/content/source.rpcId。
        agent.inject({
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: '继续' }],
          source: { kind: 'user', rpcId },
        })
        log('action continue: injected into ' + id + ' (picked because ' + picked.why + ')')
        return json(res, { ok: true, action, session: id, why: picked.why })
      }

      return json(res, { ok: false, error: 'unknown action: ' + action }, 400)
    } catch (e) {
      log('action failed (' + action + '): ' + String((e && e.message) || e))
      return json(res, { ok: false, action, error: String((e && e.message) || e) }, 500)
    }
  })

  // 旧的折叠/展开接口。折叠形态已经砍掉（2026-11-06 主人：又卡又难看），
  // 现在 "collapsed" 的含义就是"收起小窗，让桌宠顶上"。
  route('/dsh-dual-screen/panel/form', async (req, res) => {
    if (req.method !== 'POST') return json(res, { ok: false, error: 'POST only' }, 405)
    const body = await readBody(req)
    if (body.form === 'collapsed') {
      if (panel.status().status === 'open' || panel.status().status === 'opening') await panel.close()
      state.panelClosedByUser = true
      state.petClosedByUser = false
      petLastAttempt = 0
      syncPet()
      return json(res, { ok: true, form: 'pet', open: false, pet: pet.status().status })
    }
    const out = await togglePanel(req)
    json(res, { ok: out.ok !== false, form: 'expanded', open: Boolean(out.open), error: out.error })
  })


  route('/dsh-dual-screen/pet.json', async (_req, res) => {
    // 页面（WebView2 里的 pet.html）每 3 秒拉这个决定表情，所以 mood 必须在这里，
    // 不能只挂在 panel.json 上（那是面板那条链路）。
    json(res, { ok: true, pet: { ...pet.status(), mood: petMood(), busy: activity.running.size } })
  })

  // 桌宠开关：body {action:'start'|'stop'}；start 时用 req.headers.host 现算 baseUrl
  // （端口每次重启都变，绝不写死 —— PLAN 14.2-10）。
  route('/dsh-dual-screen/pet', async (req, res) => {
    if (req.method !== 'POST') return json(res, { ok: false, error: 'POST only' }, 405)
    try {
      const body = await readBody(req)
      const action = String((body && body.action) || 'start')
      if (action === 'stop') {
        // 主人亲手叫它回去：autoStart 不许再把它拉出来。
        state.petClosedByUser = true
        state.petWasRunning = false
        pet.stop('http request')
        return json(res, { ok: true, action, pet: pet.status() })
      }
      state.petClosedByUser = false
      state.petWasRunning = false
      const base = baseUrl(req)
      const cfgPet = loadConfig().pet || {}
      // 单屏静默：没有副屏就不要把桌宠放到主屏上挡主人（PLAN §19.7）。
      // 返回 skipped 而不是 error —— 这是"按设计不做"，不是坏了。
      if (cfgPet.enabled === false) {
        return json(res, { ok: false, action, skipped: 'pet-disabled', pet: pet.status() })
      }
      if (cfgPet.onlyOnSecondary !== false && !state.active) {
        log('pet start refused: no secondary monitor (onlyOnSecondary)')
        return json(res, { ok: false, action, skipped: 'no-secondary', pet: pet.status() })
      }
      // theme/size 优先取请求里的，缺了才用配置；两者都可能为空，pet.js 会兜底。
      const out = await pet.start(base, {
        size: Number(body && body.size) || Number(cfgPet.size) || 0,
        theme: (body && body.theme) || cfgPet.theme || '',
      })
      return json(res, { ok: out.status === 'running', action, pet: out, error: out.lastError })
    } catch (e) {
      log('pet route failed: ' + String((e && e.message) || e))
      return json(res, { ok: false, error: String((e && e.message) || e) }, 500)
    }
  })

  route('/dsh-dual-screen/panel-window.json', async (_req, res) => {
    json(res, { ok: true, edge: pickEdge(), profileDir: EDGE_PROFILE_DIR, panelDir: PANEL_DIR, panel: panel.status(), rectExpanded: panelRectFor('expanded'), rectCollapsed: null, collapsedForm: 'pet' })
  })

  // P1 投送器状态（面板/侧栏按钮/自检都读这个）
  route('/dsh-dual-screen/bridge.json', async (_req, res) => {
    json(res, { ok: true, active: state.active, enabled: config.enabled, bridge: bridge.status() })
  })

  route('/dsh-dual-screen/bridge/restart', async (req, res) => {
    if (req.method !== 'POST') return json(res, { ok: false, error: 'POST only' }, 405)
    log('bridge restart requested over HTTP')
    bridge.restart('http request')
    json(res, { ok: true, restarting: true })
  })

  // P1 会在这里挂投送器；P0 先给出它将要用的落点，方便肉眼核对
  route('/dsh-dual-screen/layout-preview.json', async (_req, res) => {
    const d = state.displays || (await refreshDisplays(true))
    json(res, {
      ok: Boolean(d.hasSecondary),
      panel: panelRect(d, config.panel.marginPx, config.panel.width, config.panel.height),
      toolWindow: toolWindowRect(d, config.panel.marginPx, 1280, 900),
      note: 'panel = 副屏右上角；toolWindow = 副屏左上剩余区（PLAN §7.5 #2 分区）',
    })
  })

  log(`plugin applied: dataDir=${DATA_DIR} enabled=${config.enabled}`)
}