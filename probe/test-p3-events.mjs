// test-p3-events.mjs -- offline unit test for the P3 session-event translation.
//
// Why this file exists: the real `session/event` feed only fires on the NEXT turn,
// so the translation logic would otherwise ship unverified. This mocks ctx and
// drives the handler with synthetic SessionEvent shapes taken from the host contract
// (cordis_inspect_query -> Event "session/event" -> SessionEventMap).
//
// Run:  ELECTRON_RUN_AS_NODE=1 <electron.exe> probe/test-p3-events.mjs
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = dirname(HERE)

// --- minimal host mocks -----------------------------------------------------
process.env.DSH_HOME = process.env.DSH_HOME || 'E:\\dsh'

const routes = new Map()
let sessionEventHandler = null

const ctx = {
  webServer: {
    getOrigin: () => 'http://127.0.0.1:9999',
    register: (r) => {
      routes.set(r.path, r)
      return () => routes.delete(r.path)
    },
  },
  tools: { defineTool: () => { throw new Error('defineTool should not be needed here') } },
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  on: (name, handler) => {
    if (name === 'session/event') sessionEventHandler = handler
    return () => {}
  },
  get: () => undefined,
  emit: () => {},
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}

const events = []
const fakeRes = () => {
  const r = {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(c, h) { r.statusCode = c; Object.assign(r.headers, h || {}) },
    end(b) { r.body = String(b || ''); events.push(r) },
  }
  return r
}

// import() needs a file:// URL on Windows; a bare J:\ path is parsed as scheme "j:".
const plugin = await import(pathToFileURL(join(PKG, 'lib', 'index.js')).href)
plugin.apply(ctx)

const fail = []
const pass = []
function check(name, cond, extra) {
  if (cond) pass.push(name)
  else fail.push(name + (extra ? ' -> ' + extra : ''))
}

check('session/event handler registered', typeof sessionEventHandler === 'function')

const session = { id: 'session-abcd1234-5678-90ab-cdef-1234567890ab' }
const t0 = Date.now()

// 1) turn/start then turn/end(completed) with ~3.2s elapsed -> "这轮完成 · 3s"
sessionEventHandler(session, { type: 'turn/start', seq: 1, time: t0, data: { turn: 1 } })
sessionEventHandler(session, { type: 'turn/end', seq: 2, time: t0 + 3200, data: { turn: 1, reason: { kind: 'completed' } } })

// 2) turn/end(error) carries an LlmFailure
sessionEventHandler(session, { type: 'turn/start', seq: 3, time: t0, data: { turn: 2 } })
sessionEventHandler(session, {
  type: 'turn/end', seq: 4, time: t0 + 1200,
  data: { turn: 2, reason: { kind: 'error', error: { message: 'rate limited', code: 'provider/429' } } },
})

// 3) turn/end(aborted) = stopped by the owner
sessionEventHandler(session, { type: 'turn/start', seq: 5, time: t0, data: { turn: 3 } })
sessionEventHandler(session, { type: 'turn/end', seq: 6, time: t0 + 500, data: { turn: 3, reason: { kind: 'aborted', reason: { kind: 'user' } } } })

// 4) failed tool call is worth a row; a successful one must NOT be
sessionEventHandler(session, { type: 'tool/result', seq: 7, time: t0, data: { turn: 4, step: 1, message: {}, error: { name: 'bash', code: 'exit 1', reason: 'boom' } } })
sessionEventHandler(session, { type: 'tool/result', seq: 8, time: t0, data: { turn: 4, step: 2, message: {} } })

// 5) noise must not produce rows: assistant/step events every token would flood the panel
sessionEventHandler(session, { type: 'step/start', seq: 9, time: t0, data: { turn: 4, step: 3 } })
sessionEventHandler(session, { type: 'assistant/message', seq: 10, time: t0, data: { turn: 4, step: 3, message: {}, stream: [] } })

// 6) handler must survive junk without throwing (checked below via `threw`).
//    NOTE: keep junk AFTER all content assertions -- a turn/end with no data looks
//    like "turn 0 / no start time" and would otherwise smear the elapsed check.
let threw = null
try {
  sessionEventHandler(null, null)
  sessionEventHandler({}, { type: 'turn/end' })
  sessionEventHandler(session, { type: 'turn/end', seq: 11, time: t0, data: {} })
} catch (e) { threw = e }

// --- read back through the real route --------------------------------------
const route = routes.get('/dsh-dual-screen/panel.json')
check('panel.json route registered', !!route)
const res = fakeRes()
await route.handler({ headers: { host: '127.0.0.1:9999' }, url: '/dsh-dual-screen/panel.json' }, res)
let body = null
try { body = JSON.parse(res.body) } catch { }
check('panel.json returns valid JSON', !!body, res.body && res.body.slice(0, 120))

const list = (body && body.events) || []
const types = list.map((e) => e.type)
check('turn completed -> turn-done', types.includes('turn-done'), types.join(','))
check('turn error -> turn-error', types.includes('turn-error'), types.join(','))
check('turn aborted -> turn-aborted', types.includes('turn-aborted'), types.join(','))
check('failed tool -> tool-failed', types.includes('tool-failed'), types.join(','))
check('no row for successful tool call', types.filter((t) => t === 'tool-failed').length === 1, types.join(','))
check('no row for assistant/step noise',
  !types.includes('assistant/message') && !types.includes('step-start'), types.join(','))

// Find the turn-done that came from the turn we actually saw start AND end;
// list[0] is the junk turn/end from the survivability block above.
const done = list.filter((e) => e.type === 'turn-done').find((e) => /· \d+s/.test(String(e.proc || '')))
check('turn-done carries elapsed seconds', !!done, list.map((e) => e.type + ':' + e.proc).join(' | '))
// A turn/end whose turn/start we never saw must still produce a row, just without
// the "· Ns" suffix -- the panel should never lose the fact that a turn ended.
check('turn-done without a start time still renders',
  list.filter((e) => e.type === 'turn-done').some((e) => /这轮完成$/.test(String(e.proc || ''))),
  list.map((e) => e.type + ':' + e.proc).join(' | '))
const err = list.find((e) => e.type === 'turn-error')
check('turn-error carries the failure text', !!err && /rate limited|429/.test(String(err.reason || '')), err && err.reason)
check('rows are newest-first', list.length < 2 || Number(list[0].ts) >= Number(list[1].ts))
check('handler never throws on junk', threw === null, threw && threw.message)

// --- report ----------------------------------------------------------------
for (const p of pass) console.log('[PASS] ' + p)
for (const f of fail) console.log('[FAIL] ' + f)
console.log('')
console.log('events produced: ' + JSON.stringify(list.map((e) => e.type + ':' + (e.proc || '') + ':' + (e.reason || ''))))
console.log(fail.length === 0 ? 'RESULT: all P3 checks passed' : 'RESULT: ' + fail.length + ' check(s) failed')
process.exit(fail.length === 0 ? 0 : 1)
