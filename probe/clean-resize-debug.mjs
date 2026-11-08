// clean-resize-debug.mjs -- strip the temporary Write-Stage probes from the
// hit-test hook now that all eight edges are proven to work.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let s = readFileSync(p, 'utf8')

const lines = s.split('\n')
const kept = []
let dropped = 0
for (const line of lines) {
  const t = line.trim()
  // Temporary instrumentation added while chasing the resize bug.
  if (t.startsWith("Write-Stage ('NCHIT")) { dropped++; continue }
  if (t.startsWith("Write-Stage ('msg ENTERSIZEMOVE")) { dropped++; continue }
  if (t.startsWith("Write-Stage ('msg EXITSIZEMOVE")) { dropped++; continue }
  if (t.startsWith("Write-Stage ('save-panel-size enter")) { dropped++; continue }
  if (t.includes('# no drag in flight: just report the code')) { dropped++; continue }
  kept.push(line)
}

s = kept.join('\n')
writeFileSync(p, s, 'utf8')
console.log('dropped', dropped, 'debug lines')