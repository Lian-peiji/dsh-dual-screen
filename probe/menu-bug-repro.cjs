// Reproduce the right-click menu bug WITHOUT touching the live warm pet.
//
// Hypothesis (from reading panel/pet.html):
//   #petmenu lives inside <body>, and <body> has a click handler that means
//   "tap the pet to reopen the panel". A click on a menu item therefore bubbles up
//   and fires openPanel() as well -- so every item ALSO opens the panel, and the
//   "打开小窗" item runs openPanel() twice concurrently (two /toggle round-trips:
//   the first opens it, the second closes it again = "click does nothing").
//
// Method: launch a throwaway pet with --selftest=full, which right-clicks to open the
// menu and then JS-clicks the "reset" item. Then compare the plugin log before/after:
// any `toggle:` line means the menu click leaked into the body handler.
const { spawn } = require('node:child_process')
const fs = require('node:fs')

const EXE = 'E:\\dsh\\dual-screen\\electron\\electron.exe'
const APP = 'E:\\dsh\\profiles\\desktop\\node_modules\\dsh-dual-screen\\pet-electron'
const LOG = 'E:\\dsh\\dual-screen\\probe-menu.log'
const READY = 'E:\\dsh\\dual-screen\\probe-menu-ready.json'
const PLUGIN_LOG = 'E:\\dsh\\dual-screen\\logs\\dual-screen.log'

try { fs.writeFileSync(LOG, '') } catch { }
try { fs.unlinkSync(READY) } catch { }

// Only count toggle lines that this run could have produced.
const since = Date.now()
const toggleLines = () => {
  try {
    const all = fs.readFileSync(PLUGIN_LOG, 'utf8').split('\n')
    const cut = new Date(since).toISOString().slice(11, 19)
    return all.filter((l) => /toggle:/.test(l) && l.slice(11, 19) >= cut)
  } catch { return [] }
}

const before = toggleLines().length
console.log('toggle lines before:', before)

const env = {
  ...process.env,
  DSH_PET_PAGE: 'http://127.0.0.1:4829/dsh-dual-screen/pet-page?theme=whale&api=http%3A%2F%2F127.0.0.1%3A4829',
  DSH_PET_READY: READY,
  DSH_PET_POS_FILE: 'E:\\dsh\\dual-screen\\probe-menu-pos.json',
  DSH_PET_LOG: LOG,
  DSH_PET_SIZE: '240',
  DSH_PET_SELFTEST: 'full',
}
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(EXE, [APP], { stdio: 'ignore', windowsHide: true, env })
console.log('launched selftest pet pid', child.pid)

setTimeout(() => {
  try { child.kill() } catch { }
  const after = toggleLines().length
  console.log('\n--- menu selftest log ---')
  try { console.log(fs.readFileSync(LOG, 'utf8').trim()) } catch { }
  console.log('\ntoggle lines after:', after, ' delta:', after - before)
  console.log('\nVERDICT: ' + (after - before > 0
    ? 'BUG REPRODUCED - a menu item click also hits /toggle'
    : 'no leak detected in this run'))
  process.exit(0)
}, 14000)
