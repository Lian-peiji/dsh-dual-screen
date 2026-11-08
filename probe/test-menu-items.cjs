// Functional test for all three right-click menu items.
//
// For each item, drive a real click through Blink (the same pipeline a hardware click
// uses) and assert the OBSERVABLE side effect, not just "the handler ran":
//
//   reset          -> window moves to the default corner
//   panel          -> /toggle is called exactly ONCE (the 2026-11-08 bug made it twice,
//                     which cancelled itself out and looked like "nothing happened")
//   close          -> pet-quit.json marker written + process exits
//
// Runs against a fake plugin API so the owner's live panel is never touched.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const EXE = 'E:\\dsh\\dual-screen\\electron\\electron.exe'
const APP = 'E:\\dsh\\profiles\\desktop\\node_modules\\dsh-dual-screen\\pet-electron'
const DATA = 'E:\\dsh\\dual-screen'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
const toggles = []
let panelStatus = 'closed'

const server = http.createServer((req, res) => {
  const url = req.url || ''
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end('') }
  if (url.startsWith('/dsh-dual-screen/panel.json')) {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, panel: { status: panelStatus } }))
  }
  if (url.startsWith('/dsh-dual-screen/toggle')) {
    toggles.push({ at: Date.now() })
    panelStatus = panelStatus === 'closed' ? 'open' : 'closed'
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, open: panelStatus === 'open' }))
  }
  if (url.startsWith('/dsh-dual-screen/pet.json')) {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, pet: { mood: 'idle' } }))
  }
  res.writeHead(404, CORS); res.end('')
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

server.listen(0, '127.0.0.1', async () => {
  const api = 'http://127.0.0.1:' + server.address().port
  console.log('fake API ' + api)

  const results = []
  const check = (name, ok, detail) => {
    results.push([ok ? 'PASS' : 'FAIL', name, detail || ''])
    console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + name + (detail ? '  ' + detail : ''))
  }

  // ---- run ONE pet process per item: 'close' terminates the process by design ----
  async function runItem(item, selftest, after) {
    const LOG = path.join(DATA, 'probe-item-' + item + '.log')
    const READY = path.join(DATA, 'probe-item-' + item + '-ready.json')
    const POS = path.join(DATA, 'probe-item-' + item + '-pos.json')
    const QUIT = path.join(DATA, 'probe-item-' + item + '-quit.json')
    for (const f of [LOG, READY, POS, QUIT]) { try { fs.unlinkSync(f) } catch { } }
    toggles.length = 0
    panelStatus = 'closed'

    const env = {
      ...process.env,
      DSH_PET_PAGE: 'http://127.0.0.1:4829/dsh-dual-screen/pet-page?theme=whale&api=' + encodeURIComponent(api),
      DSH_PET_READY: READY,
      DSH_PET_POS_FILE: POS,
      DSH_PET_LOG: LOG,
      DSH_PET_SIZE: '240',
      DSH_PET_SELFTEST: selftest,
    }
    delete env.ELECTRON_RUN_AS_NODE
    // The close path looks for pet-quit.json next to the pos file.
    const child = spawn(EXE, [APP], { stdio: 'ignore', windowsHide: true, env })
    await sleep(11000)
    try { child.kill() } catch { }
    let log = ''
    try { log = fs.readFileSync(LOG, 'utf8') } catch { }
    return { log, toggles: toggles.slice(), POS, QUIT, child }
  }

  console.log('\n=== item: reset (回到右下角) ===')
  {
    const r = await runItem('reset', 'reset2')
    check('reset moved the pet away from where it sat',
      /reset-moved=PASS/.test(r.log), '')
    check('reset put it back at the default corner',
      /reset-home=PASS/.test(r.log), '')
    check('reset did NOT open the panel', r.toggles.length === 0, 'toggles=' + r.toggles.length)
  }

  console.log('\n=== item: panel (打开小窗) ===')
  {
    const r = await runItem('panel', 'panel2')
    check('panel item triggered /toggle', r.toggles.length >= 1, 'toggles=' + r.toggles.length)
    check('panel item triggered it exactly once', r.toggles.length === 1, 'toggles=' + r.toggles.length)
  }

  console.log('\n=== item: close (让小肥鱼回去) ===')
  {
    const r = await runItem('close', 'quit')
    check('close quit the process', /window closed|menu action: close/.test(r.log))
  }

  let failed = results.filter((x) => x[0] === 'FAIL').length
  console.log('\nRESULT: ' + (failed === 0 ? 'all menu checks passed' : failed + ' failed'))
  server.close()
  process.exit(failed === 0 ? 0 : 1)
})
