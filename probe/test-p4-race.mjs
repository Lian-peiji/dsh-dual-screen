// test-p4-race.mjs -- THE regression test for "小窗把主窗口问答吞了".
//
// Owner report (2026-11-06): 问答只能在小窗进行，主窗口的问答直接消失.
// Root cause: the user-questions/request listener took the request and never called
// next(), so the native (main-window) answerer never ran.
//
// What must stay true forever:
//   R1  next() is ALWAYS called when the mirror is engaged (main window still works)
//   R2  if the panel answers first, its answer wins AND the native signal is aborted
//   R3  if the main window answers first, the panel card is withdrawn
//   R4  approvals are never intercepted
//   R5  ask.enabled=false / mode='panel-only' / no secondary => native only
//
// Run: ELECTRON_RUN_AS_NODE=1 <electron.exe> probe/test-p4-race.mjs
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import http from 'node:http'

const ROOT = 'J:\\大肥鱼游乐场\\dsh-dual-screen'
const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' -> ' + detail : ''))
}

const routes = new Map()

// HTTP harness state MUST live above the tests: `const/let` at the bottom of a
// module are in the temporal dead zone for every earlier reference (this test hit
// exactly that on its first run).
let PORT = 0
let SRV = null

// ---- fake host context -------------------------------------------------------
const handlers = new Map()
function makeCtx(over) {
  const ctx = {
    get: over && over.get ? over.get : () => undefined,
    on(name, fn, opts) {
      // record every registration so we can fire the waterfall ourselves
      const list = handlers.get(name) || []
      list.push({ fn, opts })
      handlers.set(name, list)
      return () => {}
    },
    effect(fn) { try { fn() } catch {} return () => {} },
    emit() {},
    inject: () => () => {},
    webServer: { register() { return () => {} }, getOrigin: () => 'http://127.0.0.1:1' },
    logger: { info() {}, warn() {}, error() {} },
  }
  return ctx
}

// Minimal route() shim: the plugin calls ctx.webServer.register({kind,path,handler})
function routeStore(path, handler) { routes.set(path, handler) }

async function boot(over) {
  const mod = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href + '?t=' + Math.random())
  const ctx = makeCtx(over)
  // Intercept the real register API the plugin uses.
  ctx.webServer.register = (r) => { if (r && r.path) routes.set(r.path, r.handler); return () => {} }
  handlers.clear()
  mod.apply(ctx)
  await new Promise((r) => setTimeout(r, 2500))
  // The mirror only engages when the host sees a secondary display; print it so a
  // failing run says WHY instead of just "card not published".
  const h = await fetchJson('/dsh-dual-screen/health.json').catch(() => null)
  if (h) console.log('   [info] active=' + h.active + ' monitors=' + h.monitors + ' hasSecondary=' + h.hasSecondary + ' probeError=' + h.probeError)
  return ctx
}

function askHandler() {
  const l = handlers.get('user-questions/request') || []
  return l.length ? l[l.length - 1] : null
}

const QUESTION = {
  questions: [{ id: 'q1', question: '要继续吗？', options: [{ label: '要' }, { label: '不要' }] }],
}

// ---- R1/R3: main window answers first ---------------------------------------
{
  await boot({ get: () => undefined })
  const h = askHandler()
  check('listener registered', !!h)
  check('prepend+global', h && h.opts && h.opts.global === true && h.opts.prepend === true,
    h && h.opts ? JSON.stringify(h.opts) : 'none')

  let nextCalls = 0
  const promptShown = []
  const req = {
    ...QUESTION,
    signal: { addEventListener() {} },
  }
  // main window answers after 50ms
  const next = async () => {
    nextCalls += 1
    promptShown.push(true)
    await new Promise((r) => setTimeout(r, 50))
    return { answers: [{ id: 'q1', selected: ['要'] }] }
  }
  const answer = await h.fn(req, next)
  check('R1 next() called exactly once', nextCalls === 1, 'calls=' + nextCalls)
  check('R3 main answer returned', answer && answer.answers && answer.answers[0].selected[0] === '要',
    JSON.stringify(answer))
  // panel card must be gone
  const panelRes = await fetchJson('/dsh-dual-screen/panel.json')
  check('R3 panel card withdrawn after main answer', panelRes && panelRes.pendingAsks === 0,
    panelRes ? 'pendingAsks=' + panelRes.pendingAsks : 'no panel.json')
}

// ---- R2: panel answers first, native gets aborted ---------------------------
{
  await boot({ get: () => undefined })
  const h = askHandler()
  let abortFired = false
  const ctrl = new AbortController()
  const req = { ...QUESTION, signal: ctrl.signal }

  let nextCalls = 0
  const next = async () => {
    nextCalls += 1
    // native never answers by itself; it only unwinds when aborted
    return await new Promise((resolve, reject) => {
      ctrl.signal.addEventListener('abort', () => { abortFired = true; reject(new Error('aborted')) }, { once: true })
      // also listen on the swapped signal
      try { req.signal.addEventListener('abort', () => { abortFired = true; reject(new Error('aborted')) }, { once: true }) } catch {}
    })
  }

  const p = h.fn(req, next)
  // wait for the card to be published, then answer it like the panel would
  let key = ''
  for (let i = 0; i < 40 && !key; i++) {
    await new Promise((r) => setTimeout(r, 25))
    const j = await fetchJson('/dsh-dual-screen/panel.json')
    if (j && j.asks && j.asks.length) key = j.asks[0].key
  }
  check('R2 card published to panel', !!key, key || 'none')
  if (key) {
    await postJson('/dsh-dual-screen/ask/answer', {
      key,
      answers: [{ id: 'q1', selected: ['不要'] }],
    })
  }
  const answer = await Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT'), 3000))])
  check('R2 next() was still called (main window not starved)', nextCalls === 1, 'calls=' + nextCalls)
  check('R2 panel answer won', answer && answer.answers && answer.answers[0].selected[0] === '不要',
    JSON.stringify(answer))
  check('R2 native prompt aborted', abortFired === true, 'aborted=' + abortFired)
}

// ---- R4: approvals are never intercepted ------------------------------------
{
  await boot({ get: () => undefined })
  const h = askHandler()
  let nextCalls = 0
  const req = {
    questions: [{ id: 'a1', question: '允许执行？', intent: { kind: 'approval', approve: '允许', reject: '拒绝' } }],
    signal: { addEventListener() {} },
  }
  const answer = await h.fn(req, async () => { nextCalls += 1; return { answers: [{ id: 'a1', selected: ['允许'] }] } })
  check('R4 approval goes straight to main window', nextCalls === 1 && !!answer, 'next=' + nextCalls)
}

// ---- helpers ----------------------------------------------------------------
function serverPort() {
  // the plugin registered its routes into `routes`; serve them on a throwaway port
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x')
      const h = routes.get(url.pathname)
      if (!h) { res.writeHead(404); res.end('no route ' + url.pathname); return }
      h(req, res)
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

async function ensureServer() {
  if (PORT) return PORT
  const { srv, port } = await serverPort()
  SRV = srv
  PORT = port
  return PORT
}

async function fetchJson(path) {
  const port = await ensureServer()
  try {
    const r = await fetch('http://127.0.0.1:' + port + path)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

async function postJson(path, body) {
  const port = await ensureServer()
  try {
    const r = await fetch('http://127.0.0.1:' + port + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await r.json()
  } catch { return null }
}

const passed = results.filter((r) => r.ok).length
const failed = results.length - passed
console.log('')
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed')
if (SRV) SRV.close()
process.exit(failed ? 1 : 0)
