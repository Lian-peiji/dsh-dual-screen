// patch-vresize-reset.mjs -- each WM_NCHITTEST re-decides whether the cursor is on
// a top/bottom edge, so the flag must be reset per hit-test, not on ENTERSIZEMOVE
// (that fires AFTER the hit-test which armed the drag, wiping the flag: measured
// 2026-11-06, vertical drags saved width only).
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let s = readFileSync(p, 'utf8')

const guard = '  if ($msg -ne 0x0084) { return [IntPtr]::Zero }        # WM_NCHITTEST only'
if (!s.includes(guard)) throw new Error('guard anchor missing')

const reset = "\n  $script:vResize = $false"
if (s.includes(reset)) throw new Error('already patched')

s = s.replace(guard, guard + reset)
writeFileSync(p, s, 'utf8')
console.log('ok:', s.includes(reset))