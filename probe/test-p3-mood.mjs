// test-p3-mood.mjs -- offline test for the six-mood map (PLAN §21.2 gap).
//
// The point of this file: think/happy were declared in the theme for weeks but
// never produced, because petMood() had no rule for them. Assert the transitions
// rather than trusting the diff.
//
// Drives the real module with a mocked ctx, pushes SessionEvents through the very
// handler the host calls, and reads the mood back from the real panel.json route.
//
// Run: ELECTRON_RUN_AS_NODE=1 <electron.exe> probe/test-p3-mood.mjs
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = dirname(HERE)
process.env.DSH_HOME = process.env.DSH_HOME || 'E:\\dsh'

const routes = new Map()
let onSessionEvent = null
let onApiStatus = null

const ctx = {
  webServer: {
    getOrigin: () => 'http://127.0.0.1:9999',
    register: (r) => { routes.set(r.path, r); return () => routes.delete(r.path) },
  },
  tools: { defineTool: () => {} },
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  on: (name, handler) => {
    if (name === 'session/event') onSessionEvent = handler
    if (name === 'api-session/status') onApiStatus = handler
    return () => {}
  },
  get: () => undefined,
  emit: () => {},
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}

const plugin = await import(pathToFileURL(join(PKG, 'lib', 'index.js')).href)
plugin.apply(ctx)

const pass = []
const fail = []
function check(name, cond, extra) {
  if (cond) pass.push(name)
  else fail.push(name + (extra ? ' -> ' + extra : ''))
}

/** Ask the plugin for the current mood the same way the pet page does. */
async function mood() {
  const route = routes.get('/dsh-dual-screen/pet.json')
  if (!route) throw new Error('pet.json route missing')
  let body = ''
  const res = {
    writeHead() {},
    end(b) { body = String(b || '') },
  }
  await route.handler({ method: 'GET', headers: { host: '127.0.0.1:9999' }, url: '/dsh-dual-screen/pet.json' }, res)
  const j = JSON.parse(body)
  return j && j.pet ? j.pet.mood : null
}

const session = { id: 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }
function emit(event) { onSessionEvent(session, event) }

// --- 1. idle baseline -------------------------------------------------------
check('baseline is idle', (await mood()) === 'idle', await mood())

// --- 2. turn/start -> think -------------------------------------------------
emit({ type: 'turn/start', time: Date.now(), data: { turn: 1 } })
check('turn/start -> think', (await mood()) === 'think', await mood())

// --- 3. first tool call -> work --------------------------------------------
emit({ type: 'tool/call', time: Date.now(), data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' } })
check('tool/call -> work', (await mood()) === 'work', await mood())

// --- 4. successful turn end -> happy ---------------------------------------
emit({ type: 'turn/end', time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } })
check('completed turn -> happy', (await mood()) === 'happy', await mood())

// --- 5. happy decays -------------------------------------------------------
// We cannot wait 6s in a unit test, so assert the rule indirectly: a new turn
// start clears the celebration and goes back to think.
emit({ type: 'turn/start', time: Date.now(), data: { turn: 2 } })
check('next turn/start clears happy -> think', (await mood()) === 'think', await mood())

// --- 6. error -> sad -------------------------------------------------------
emit({ type: 'turn/end', time: Date.now(), data: { turn: 2, reason: { kind: 'error', error: { code: 'rate_limited', message: 'rate limited' } } } })
check('errored turn -> sad', (await mood()) === 'sad', await mood())

// --- 7. aborted is NOT sad -------------------------------------------------
// A user cancel must not look like a failure; it should just fall back.
emit({ type: 'turn/start', time: Date.now(), data: { turn: 3 } })
emit({ type: 'turn/end', time: Date.now(), data: { turn: 3, reason: { kind: 'aborted', reason: { kind: 'user' } } } })
const afterAbort = await mood()
check('aborted turn is not sad', afterAbort !== 'sad', afterAbort)

// --- 8. running session beats idle ----------------------------------------
if (onApiStatus) {
  onApiStatus(session.id, true)
  const m1 = await mood()
  check('running session -> work (not think, not idle)', m1 === 'work', m1)
  onApiStatus(session.id, false)
}

// --- 9. handler survives junk ---------------------------------------------
let threw = null
try {
  emit(null)
  emit({ type: 'turn/start' })
  emit({ type: 'turn/end', data: null })
  emit({ type: 'tool/call', data: {} })
} catch (e) { threw = e }
check('mood hooks never throw on junk', threw === null, threw && threw.message)

for (const p of pass) console.log('[PASS] ' + p)
for (const f of fail) console.log('[FAIL] ' + f)
console.log('')
console.log(fail.length === 0 ? 'RESULT: all mood checks passed' : 'RESULT: ' + fail.length + ' check(s) failed')
process.exit(fail.length === 0 ? 0 : 1)
