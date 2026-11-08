// patch-resize-split.mjs -- width-only drags must not freeze the auto-fit height.
//
// Problem measured 2026-11-06: dragging the RIGHT edge saved "418x320". The 320 was
// the auto-fitted height at that moment, and because the save also set
// resizedByUser=true the panel would have opened 320 DIP tall forever.
//
// Rule: a drag that involves a horizontal edge only saves width and leaves
// Fit-Height alive; only a drag touching a top/bottom edge stores the height and
// switches the panel to "user picked the size".
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let s = readFileSync(p, 'utf8')

const aEnter = "  if ($msg -eq 0x0231) { $script:userResized = $true; $script:sizeTimer.Stop(); return [IntPtr]::Zero }"
if (!s.includes(aEnter)) throw new Error('enter anchor missing')
s = s.replace(aEnter, "  if ($msg -eq 0x0231) { $script:vResize = $false; $script:sizeTimer.Stop(); return [IntPtr]::Zero }")

const aExit = "  if ($msg -eq 0x0232) { if ($script:userResized) { $script:sizeTimer.Stop(); $script:sizeTimer.Start() }; return [IntPtr]::Zero }"
if (!s.includes(aExit)) throw new Error('exit anchor missing')
s = s.replace(aExit, "  if ($msg -eq 0x0232) { $script:sizeTimer.Stop(); $script:sizeTimer.Start(); return [IntPtr]::Zero }")

const aCode = "  if ($code -eq 0) { return [IntPtr]::Zero }"
if (!s.includes(aCode)) throw new Error('code anchor missing')
s = s.replace(aCode, [
  "  if ($code -eq 0) { return [IntPtr]::Zero }",
  "  # 10/11 are the pure left/right edges; anything else touches top or bottom.",
  "  if ($code -ne 10 -and $code -ne 11) { $script:vResize = $true }",
].join('\n'))

// Save body: width always, height only when the vertical extent was dragged.
const oldBody = "  $body = '{\"panel\":{\"width\":' + $wDip + ',\"height\":' + $hDip + ',\"resizedByUser\":true}}'"
if (!s.includes(oldBody)) throw new Error('save body anchor missing')
s = s.replace(oldBody, [
  '  if ($script:vResize) {',
  '    $body = \'{"panel":{"width":\' + $wDip + \',"height":\' + $hDip + \',"resizedByUser":true}}\'',
  '  } else {',
  '    $body = \'{"panel":{"width":\' + $wDip + \'}}\'',
  '  }',
].join('\n'))

// Remember whether this session's drag was vertical (default: no).
const aInit = "$script:userResized = [bool]$NoFit   # once true, Fit-Height stops fighting the user"
if (!s.includes(aInit)) throw new Error('init anchor missing')
s = s.replace(aInit, aInit + '\n$script:vResize = $false       # this drag touched a top/bottom edge')

writeFileSync(p, s, 'utf8')
console.log('ok:', s.includes('$script:vResize = $false       # this drag'), s.includes("'{\"panel\":{\"width\":' + $wDip + '}}'"))