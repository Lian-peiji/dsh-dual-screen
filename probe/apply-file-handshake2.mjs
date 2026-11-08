import { readFileSync, writeFileSync } from 'node:fs'
const pp = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/panel.js'
let p = readFileSync(pp, 'utf8')

const startMarker = '    const ok = await new Promise((resolve) => {'
const endMarker = '    const ok = await ready'
const s = p.indexOf(startMarker)
if (s < 0) { console.log('START MISS'); process.exit(1) }
// find the end of the promise: the line "    })" that closes it, right before the "if (!ok &&" block
const tail = p.indexOf('    if (!ok && state.status', s)
if (tail < 0) { console.log('TAIL MISS'); process.exit(1) }

const wait = [
  '    // Ready handshake over a FILE (see panel-host.ps1): stdout is unreliable when',
  '    // the host is spawned with piped stdio, and a file also leaves an audit trail.',
  '    const startedAt = Date.now()',
  '    const ok = await new Promise((resolve) => {',
  '      let settled = false',
  '      const finish = (v) => { if (!settled) { settled = true; clearInterval(tick); resolve(v) } }',
  '      const tick = setInterval(() => {',
  '        try {',
  '          const obj = JSON.parse(readFileSync(READY_FILE, "utf8"))',
  '          if (obj && obj.panel === "ready" && Number(obj.pid) === Number(proc.pid)) {',
  '            state.status = "open"',
  '            state.hwnd = obj.hwnd',
  '            state.rect = { x: obj.rect[0], y: obj.rect[1], w: obj.rect[2], h: obj.rect[3] }',
  '            state.openedAt = Date.now()',
  '            log(`panel: ready hwnd=${obj.hwnd} rect=${JSON.stringify(state.rect)} uiScale=${obj.uiScale}`)',
  '            return finish(true)',
  '          }',
  '        } catch {}',
  '        if (Date.now() - startedAt > 25000) return finish(false)',
  '      }, 200)',
  '      if (tick.unref) tick.unref()',
  '      proc.on("exit", (code) => {',
  '        log(`panel: host exited code=${code}`)',
  '        if (state.status !== "open") {',
  '          state.status = "failed"',
  '          if (!state.lastError) state.lastError = `host exited code=${code}`',
  '        } else { state.status = "closed" }',
  '        state.pid = null; state.hwnd = null; child = null',
  '        finish(false)',
  '      })',
  '    })',
  '',
].join('\n')

p = p.slice(0, s) + wait + p.slice(tail)
writeFileSync(pp, p, 'utf8')
console.log('panel.js: stdout wait replaced with file poll')