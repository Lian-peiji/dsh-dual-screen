// Minimal repro: does the child's stdin stay open? Does a json line reach it?
const { spawn } = require('node:child_process')
const fs = require('node:fs')

const EXE = 'E:\\dsh\\dual-screen\\electron\\electron.exe'
const APP = 'E:\\dsh\\profiles\\desktop\\node_modules\\dsh-dual-screen\\pet-electron'
const LOG = 'E:\\dsh\\dual-screen\\probe-warm.log'
const READY = 'E:\\dsh\\dual-screen\\probe-warm-ready.json'
try { fs.writeFileSync(LOG, '') } catch {}
try { fs.unlinkSync(READY) } catch {}

const env = { ...process.env, DSH_PET_PAGE: 'http://127.0.0.1:4829/dsh-dual-screen/pet-page?theme=whale&api=http%3A%2F%2F127.0.0.1%3A4829', DSH_PET_READY: READY, DSH_PET_POS_FILE: 'E:\\dsh\\dual-screen\\probe-warm-pos.json', DSH_PET_LOG: LOG, DSH_PET_SIZE: '240', DSH_PET_START_HIDDEN: '1' }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(EXE, [APP], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true, env })
console.log('spawned pid', child.pid)

let n = 0
const t = setInterval(() => {
  n++
  console.log(n + 's  stdin.destroyed=' + child.stdin.destroyed + ' writable=' + child.stdin.writable + ' exitCode=' + child.exitCode)
  if (n === 3) {
    const ok = child.stdin.write(JSON.stringify({ cmd: 'show', x: 2800, y: 200 }) + '\n')
    console.log('wrote show cmd, ok=' + ok)
  }
  if (n >= 8) {
    clearInterval(t)
    try { console.log('ready file:', fs.readFileSync(READY, 'utf8')) } catch (e) { console.log('no ready file') }
    try { child.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n') } catch {}
    setTimeout(() => { try { child.kill() } catch {} process.exit(0) }, 800)
  }
}, 1000)
child.on('exit', (c) => console.log('child exited', c))
