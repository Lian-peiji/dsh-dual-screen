// add-resize-logging.mjs -- find out why EXITSIZEMOVE never reaches Save-PanelSize.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let s = readFileSync(p, 'utf8')

const anchor = 'function Save-PanelSize {'
if (!s.includes(anchor)) throw new Error('Save-PanelSize not found')
s = s.replace(anchor, anchor + "\n  Write-Stage ('save-panel-size enter axis=' + $script:dragAxis)")

const r1 = "  if ($msg -eq 0x0231) { return [IntPtr]::Zero }"
if (!s.includes(r1)) throw new Error('enter anchor')
s = s.replace(r1, "  if ($msg -eq 0x0231) { Write-Stage ('msg ENTERSIZEMOVE axis=' + $script:dragAxis); return [IntPtr]::Zero }")

const r2 = "    if ($script:dragAxis -ne '') { $script:sizeTimer.Stop(); Save-PanelSize }"
if (!s.includes(r2)) throw new Error('exit anchor')
s = s.replace(r2, "    Write-Stage ('msg EXITSIZEMOVE axis=[' + $script:dragAxis + ']')\n    if ($script:dragAxis -ne '') { $script:sizeTimer.Stop(); Save-PanelSize }")

const r3 = "    if (-not [PNative]::GetWindowRect($hh, [ref]$rr)) { return }"
if (!s.includes(r3)) throw new Error('getwindowrect anchor')
s = s.replace(r3, "    if (-not [PNative]::GetWindowRect($hh, [ref]$rr)) { Write-Stage 'save: GetWindowRect FAILED'; return }")

writeFileSync(p, s, 'utf8')
console.log('logging added')