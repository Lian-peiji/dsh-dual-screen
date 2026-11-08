// patch-p4-ask.mjs —— P4 问答镜像（服务端中转，不依赖 DOM）
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const P = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/index.js'
let s = readFileSync(P, 'utf8')
if (s.includes('pendingAsks = new Map')) { console.log('already patched'); process.exit(0) }

const HELPERS = `
// ── P4 问答镜像（服务端中转）────────────────────────────────────────────────
// 面板是原生 WPF 窗口，不是网页，所以 PLAN §5.6 的 BroadcastChannel 作废。
// 链路：宿主 user-questions/request → pendingAsks → 面板拉 panel.json 渲染
//       → 面板点选 POST /ask/answer → 宿主收到答案直接回给 agent（主屏不弹窗）
// 超时未答 → 调 next() 交回主屏原生问答，绝不假装成功。
const pendingAsks = new Map()   // key -> { key, createdAt, questions, resolve, timeout }
const ASK_WAIT_MS = Number(process.env.DSH_DUAL_ASK_WAIT_MS || 120000)
const ASK_TTL_MS = 3 * 60 * 1000

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
`

s = s.replace(/\n\/\/ ─+ 显示器检测|const state = \{/, (m) => m) // no-op guard
const stateAnchor = 'const state = {'
const idx = s.indexOf(stateAnchor)
if (idx < 0) throw new Error('state anchor not found')
// insert helpers right before the state block's module-level area: put before the function that owns it
s = s.slice(0, idx).replace(/\n\s*$/, '\n') + HELPERS + '\n' + s.slice(idx)

// panel.json 带真值
s = s.replace(
  `      pendingAsks: 0,                       // P4 接问答镜像后填真值
      asks: [],`,
  `      pendingAsks: pendingAsks.size,
      asks: [...pendingAsks.values()].map(publicAsk),`
)

// 三条路由（插在 toggle 路由前）
const routes = `
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

`
s = s.replace(`  route('/dsh-dual-screen/toggle', async (req, res) => {`, routes + `  route('/dsh-dual-screen/toggle', async (req, res) => {`)

// 事件监听：插在 apply() 的开头（tools 注册之前）
const listener = `
  // ── P4：把问答接到面板上 ───────────────────────────────────────────────────
  // waterfall：能拿到答案就自己回（主屏不弹窗）；超时/异常一律 next() 交回原生 UI。
  try {
    ctx.on('user-questions/request', async (request, next) => {
      let key = ''
      try {
        const qs = Array.isArray(request && request.questions) ? request.questions : []
        if (!qs.length) return next()
        key = (request.wait && request.wait.callId)
          ? String(request.wait.callId)
          : ('ask-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7))
        const questions = qs.map((q) => ({
          id: String(q.id),
          question: String(q.question || ''),
          header: q.header ? String(q.header) : '',
          detail: q.detail ? String(q.detail) : '',
          multiSelect: Boolean(q.multiSelect),
          options: (q.options || []).map((o) => ({ label: String(o.label), description: o.description ? String(o.description) : '' })),
        }))
        const answer = await new Promise((resolve) => {
          const timer = setTimeout(() => { pendingAsks.delete(key); resolve(null) }, ASK_WAIT_MS)
          pendingAsks.set(key, {
            key,
            createdAt: Date.now(),
            questions,
            resolve,
            timeout: () => { clearTimeout(timer); resolve(null) },
          })
          log('ask pending -> panel: ' + key + ' (' + questions.length + ' question(s))')
        })
        if (answer) { log('ask answered on panel: ' + key); return answer }
        log('ask not answered on panel within ' + ASK_WAIT_MS + 'ms, delegating to main UI: ' + key)
        return next()
      } catch (e) {
        log('ask bridge failed (' + String((e && e.message) || e) + '), delegating to main UI')
        return next()
      }
    })
  } catch (e) {
    log('subscribe user-questions/request failed: ' + String((e && e.message) || e))
  }

`
s = s.replace(`  // 1) 立即 / 延时重启`, listener + `  const output = {`)
// 上一行落空就退回另一个锚点
if (!s.includes("subscribe user-questions/request failed")) {
  s = s.replace(`  const output = {`, listener + `  const output = {`)
}

writeFileSync(P, s, 'utf8')
const ok = ['pendingAsks', 'ask/answer', 'ask/mock', 'user-questions/request'].every((k) => s.includes(k))
console.log('p4 patch:', ok)
if (ok) for (const d of ['E:/dsh/profiles/desktop/local-plugins/dsh-dual-screen', 'E:/dsh/profiles/desktop/node_modules/dsh-dual-screen']) copyFileSync(P, `${d}/lib/index.js`)
console.log(ok ? 'synced' : 'NOT synced')