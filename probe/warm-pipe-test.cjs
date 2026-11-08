// Verify the warm-standby named-pipe control channel end to end.
//   1. spawn a hidden pet with DSH_PET_PIPE
//   2. connect, send {"cmd":"show"}, read back pet-host.log to confirm it placed & showed
//   3. send {"cmd":"quit"} and confirm the process exits
const { spawn } = require('node:child_process')
const net = require('node:net')
const fs = require('node:fs')

const EXE = 'E:\\dsh\\dual-screen\\electron\\electron.exe'
const APP = 'E:\\dsh\\profiles\\desktop\\node_modules\\dsh-dual-screen\\pet-electron'
const LOG = 'E:\\dsh\\dual-screen\\probe-warm.log'
const READY = 'E:\\dsh\\dual-screen\\probe-warm-ready.json'
const PIPE = '\\\\.\\pipe\\dsh-dual-screen-pet-probe-' + process.pid

try { fs.writeFileSync(LOG, '') } catch { }
try { fs.unlinkSync(READY) } catch { }

const env = {
  ...process.env,
  DSH_PET_PAGE: 'http://127.0.0.1:4829/dsh-dual-screen/pet-page?theme=whale&api=http%3A%2F%2F127.0.0.1%3A4829',
  DSH_PET_READY: READY,
  DSH_PET_POS_FILE: 'E:\\dsh\\dual-screen\\probe-warm-pos.json',
  DSH_PET_LOG: LOG,
  DSH_PET_SIZE: '240',
  DSH_PET_START_HIDDEN: '1',
  DSH_PET_PIPE: PIPE,
}
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(EXE, [APP], { stdio: 'ignore', windowsHide: true, env })
console.log('spawned pid', child.pid, 'pipe', PIPE)
const t0 = Date.now()

let result = { connected: false, shown: false, exited: false }
let sock = null

function step(msg) { console.log(((Date.now() - t0) / 1000).toFixed(2) + 's  ' + msg) }

function connectLoop(tries) {
  if (tries <= 0) { step('FAIL: never connected'); return done(1) }
  sock = net.connect(PIPE)
  sock.on('connect', () => {
    result.connected = true
    step('pipe connected after ' + (Date.now() - t0) + 'ms')
    // ask it to appear at a known spot inside the secondary monitor
    sock.write(JSON.stringify({ cmd: 'show', x: 2800, y: 200 }) + '\n')
    step('sent show 2800,200')
    setTimeout(() => {
      try {
        const r = JSON.parse(fs.readFileSync(READY, 'utf8'))
        result.shown = String(r.rect || '').startsWith('2800,200')
        step('ready.json rect=' + JSON.stringify(r.rect) + ' -> ' + (result.shown ? 'PASS' : 'FAIL'))
      } catch (e) { step('ready.json unreadable: ' + e.message) }
      try { sock.write(JSON.stringify({ cmd: 'quit' }) + '\n') } catch { }
      step('sent quit')
    }, 2500)
  })
  sock.on('error', () => {
    setTimeout(() => connectLoop(tries - 1), 250)
  })
}

child.on('exit', (c) => {
  result.exited = true
  step('child exited code=' + c + ' -> ' + (c === 0 ? 'PASS' : 'FAIL'))
  done(result.connected && result.shown && c === 0 ? 0 : 1)
})

function done(code) {
  try { console.log('\n--- pet-host.log ---\n' + fs.readFileSync(LOG, 'utf8').trim()) } catch { }
  console.log('\nRESULT: ' + (code === 0 ? 'all checks passed' : 'FAILED'))
  try { child.kill() } catch { }
  process.exit(code)
}

connectLoop(80)
setTimeout(() => { step('TIMEOUT'); done(1) }, 30000).unref?.()
