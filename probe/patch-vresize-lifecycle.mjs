// patch-vresize-lifecycle.mjs -- vResize must live from the arming hit-test until
// the save POST, not be recomputed per hit-test.
//
// Measured 2026-11-06: during the OS modal resize loop Windows keeps sending
// WM_NCHITTEST, and once the window has grown past the cursor those hit-tests
// return HTCLIENT -> the per-hit reset wiped the flag, so a vertical drag saved
// width only. Lifecycle now: arming hit-test sets it, save tick consumes it and
// clears it.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let s = readFileSync(p, 'utf8')

const reset = '\n  $script:vResize = $false\n'
if (!s.includes(reset)) throw new Error('per-hit reset line not found (already removed?)')
s = s.replace(reset, '\n')

const marker = "    Write-Stage 'size save failed'\n  }"
if (!s.includes(marker)) throw new Error('save catch anchor missing')
s = s.replace(marker, "    Write-Stage 'size save failed'\n  }\n  $script:vResize = $false   # consumed: the next drag starts from a clean slate")

writeFileSync(p, s, 'utf8')
console.log('ok:', s.split('$script:vResize').length - 1, 'occurrences')