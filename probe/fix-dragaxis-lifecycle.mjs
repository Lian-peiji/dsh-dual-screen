// fix-dragaxis-lifecycle.mjs -- dragAxis must survive until EXITSIZEMOVE.
//
// Measured 2026-11-06: hit-test armed dragAxis='h', then the 800ms debounce timer
// fired MID-DRAG and Save-PanelSize cleared the axis at its first line. By the time
// WM_EXITSIZEMOVE arrived the axis was '' and nothing was saved. The timer is only
// meant for programmatic resizes (Fit-Height), never for human drags.
//
// New contract:
//   hit-test on an edge  -> $script:dragAxis = 'h'|'v'
//   WM_ENTERSIZEMOVE     -> $script:inDrag = $true
//   WM_EXITSIZEMOVE      -> save, then clear dragAxis + inDrag
//   timer tick           -> save only when NOT in a drag; never clears dragAxis
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let s = readFileSync(p, 'utf8')

// 1) Save-PanelSize no longer clears the axis; callers own the lifecycle.
const clr = "  Write-Stage ('save-panel-size enter axis=' + $script:dragAxis)\n  $script:dragAxis = ''\n"
if (!s.includes(clr)) throw new Error('Save-PanelSize head anchor missing')
s = s.replace(clr, "  Write-Stage ('save-panel-size enter axis=' + $script:dragAxis)\n")

// 2) ENTERSIZEMOVE marks the drag as live.
const enter = "  if ($msg -eq 0x0231) { Write-Stage ('msg ENTERSIZEMOVE axis=' + $script:dragAxis); return [IntPtr]::Zero }"
if (!s.includes(enter)) throw new Error('ENTER anchor missing')
s = s.replace(enter, "  if ($msg -eq 0x0231) { $script:inDrag = $true; Write-Stage ('msg ENTERSIZEMOVE axis=' + $script:dragAxis); return [IntPtr]::Zero }")

// 3) EXITSIZEMOVE saves and then releases both flags.
const exit = `    Write-Stage ('msg EXITSIZEMOVE axis=[' + $script:dragAxis + ']')
    if ($script:dragAxis -ne '') { $script:sizeTimer.Stop(); Save-PanelSize }`
if (!s.includes(exit)) throw new Error('EXIT anchor missing')
s = s.replace(exit, `    Write-Stage ('msg EXITSIZEMOVE axis=[' + $script:dragAxis + ']')
    if ($script:dragAxis -ne '') { $script:sizeTimer.Stop(); Save-PanelSize }
    $script:dragAxis = ''
    $script:inDrag = $false`)

// 4) The debounce timer must not fire mid-drag.
const tick = "$script:sizeTimer.Add_Tick({ $script:sizeTimer.Stop(); Save-PanelSize })"
if (!s.includes(tick)) throw new Error('timer tick anchor missing')
s = s.replace(tick, `$script:sizeTimer.Add_Tick({
  $script:sizeTimer.Stop()
  # A human drag is saved by EXITSIZEMOVE; this timer only covers programmatic
  # resizes (Fit-Height). Firing mid-drag used to wipe dragAxis.
  if (-not $script:inDrag) { Save-PanelSize }
})`)

// 5) Initialise the new flag next to dragAxis.
const init = "$script:dragAxis = ''\n"
if (!s.includes(init)) throw new Error('init anchor missing')
s = s.replace(init, "$script:dragAxis = ''\n$script:inDrag = $false\n", 1)

writeFileSync(p, s, 'utf8')
console.log('ok:', s.includes('$script:inDrag = $false\n') && s.includes('-not $script:inDrag'))