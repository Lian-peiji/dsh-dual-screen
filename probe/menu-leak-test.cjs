// Isolate the menu bug with a FAKE plugin API, so the live panel is never touched.
//
// The fake server pretends the panel is CLOSED (the normal state whenever the pet is
// on screen) and records every /toggle call. If a menu item click also reaches the
// body-level "tap the pet = open the panel" handler, /toggle gets hit.
const http = require('node:http')

const hits = []
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}
const server = http.createServer((req, res) => {
  const url = req.url || ''
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end('') }
  if (url.startsWith('/dsh-dual-screen/panel.json')) {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
    // panel is closed -> openPanel() will proceed to /toggle
    return res.end(JSON.stringify({ ok: true, panel: { status: 'closed' } }))
  }
  if (url.startsWith('/dsh-dual-screen/toggle')) {
    hits.push({ at: Date.now() })
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, open: true }))
  }
  if (url.startsWith('/dsh-dual-screen/pet.json')) {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, pet: { mood: 'idle' } }))
  }
  // pet-page / theme assets are served by the real plugin; proxy nothing, just 404.
  res.writeHead(404, CORS); res.end('')
})

const { spawn } = require('node:child_process')
const fs = require('node:fs')

const EXE = 'E:\\dsh\\dual-screen\\electron\\electron.exe'
const APP = 'E:\\dsh\\profiles\\desktop\\node_modules\\dsh-dual-screen\\pet-electron'
const LOG = 'E:\\dsh\\dual-screen\\probe-menu2.log'
const READY = 'E:\\dsh\\dual-screen\\probe-menu2-ready.json'

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port
  const api = 'http://127.0.0.1:' + port
  console.log('fake API on ' + api)

  try { fs.writeFileSync(LOG, '') } catch { }
  try { fs.unlinkSync(READY) } catch { }

  const env = {
    ...process.env,
    // page still comes from the REAL plugin origin (theme assets live there),
    // but &api= points at the fake so /toggle is recorded here.
    DSH_PET_PAGE: 'http://127.0.0.1:4829/dsh-dual-screen/pet-page?theme=whale&api=' + encodeURIComponent(api),
    DSH_PET_READY: READY,
    DSH_PET_POS_FILE: 'E:\\dsh\\dual-screen\\probe-menu2-pos.json',
    DSH_PET_LOG: LOG,
    DSH_PET_SIZE: '240',
    DSH_PET_SELFTEST: 'full',
  }
  delete env.ELECTRON_RUN_AS_NODE

  const child = spawn(EXE, [APP], { stdio: 'ignore', windowsHide: true, env })
  console.log('selftest pet pid ' + child.pid)

  setTimeout(() => {
    try { child.kill() } catch { }
    server.close()
    console.log('\n/toggle hits recorded: ' + hits.length)
    hits.forEach((h, i) => console.log('  #' + (i + 1) + ' at +' + (h.at - hits[0].at) + 'ms'))
    console.log('\n--- selftest log ---')
    try { console.log(fs.readFileSync(LOG, 'utf8').trim()) } catch { }
    console.log('\nVERDICT: ' + (hits.length > 0
      ? 'BUG CONFIRMED - clicking a menu item ALSO fired the body tap handler (/toggle)'
      : 'no leak'))
    process.exit(0)
  }, 15000)
})
