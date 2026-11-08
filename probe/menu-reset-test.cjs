// Verify "回到右下角" really MOVES the window (not just "the handler fired").
// The pet is launched at the default corner, so a plain reset is a no-op; the selftest
// therefore shoves the window elsewhere first and requires the rect to come back home.
const { spawn } = require('node:child_process')
const fs = require('node:fs')

const EXE = 'E:\\dsh\\dual-screen\\electron\\electron.exe'
const APP = 'E:\\dsh\\profiles\\desktop\\node_modules\\dsh-dual-screen\\pet-electron'
const LOG = 'E:\\dsh\\dual-screen\\probe-reset.log'
const READY = 'E:\\dsh\\dual-screen\\probe-reset-ready.json'

try { fs.writeFileSync(LOG, '') } catch { }

const env = {
  ...process.env,
  DSH_PET_PAGE: 'http://127.0.0.1:4829/dsh-dual-screen/pet-page?theme=whale&api=http%3A%2F%2F127.0.0.1%3A4829',
  DSH_PET_READY: READY,
  DSH_PET_POS_FILE: 'E:\\dsh\\dual-screen\\probe-reset-pos.json',
  DSH_PET_LOG: LOG,
  DSH_PET_SIZE: '240',
  DSH_PET_SELFTEST: 'reset2',
}
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(EXE, [APP], { stdio: 'ignore', windowsHide: true, env })
setTimeout(() => {
  try { child.kill() } catch { }
  let log = ''
  try { log = fs.readFileSync(LOG, 'utf8') } catch { }
  console.log(log.split('\n').filter((l) => /reset|rect/.test(l)).join('\n'))
  const ok = /reset-moved=PASS/.test(log) && /reset-home=PASS/.test(log)
  console.log('\nRESULT: ' + (ok ? 'reset really moves the pet home' : 'FAILED'))
  process.exit(ok ? 0 : 1)
}, 13000)
