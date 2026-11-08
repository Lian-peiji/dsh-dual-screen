// patch-sizemove.mjs -- save the panel size when a HUMAN finishes dragging an edge.
//
// Why a file: the same patch written inline through bash -> node -e -> PowerShell
// keeps losing backslashes/quotes (see HANDOFF 4.5). Anchor-assert everything so a
// mismatch fails loudly instead of silently doing nothing.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let s = readFileSync(p, 'utf8')

const anchor = '  if ($msg -ne 0x0084) { return [IntPtr]::Zero }        # WM_NCHITTEST only'
if (!s.includes(anchor)) throw new Error('hook head anchor missing')

const inject = [
  '  # WM_ENTERSIZEMOVE / WM_EXITSIZEMOVE is the reliable "a human is dragging an',
  '  # edge" signal. Testing Mouse.LeftButton inside SizeChanged does NOT work:',
  '  # Windows runs its own modal resize loop there and the button reads Released',
  '  # (measured 2026-11-06: the window grew but nothing was ever saved).',
  '  if ($msg -eq 0x0231) { $script:userResized = $true; $script:sizeTimer.Stop(); return [IntPtr]::Zero }',
  '  if ($msg -eq 0x0232) { if ($script:userResized) { $script:sizeTimer.Stop(); $script:sizeTimer.Start() }; return [IntPtr]::Zero }',
].join('\n')

s = s.replace(anchor, inject + '\n' + anchor)

// The SizeChanged hook no longer needs to guess from the mouse button; it only
// has to keep the debounce alive while the drag continues.
const oldSize = `$win.Add_SizeChanged({
  # Only a mouse-driven resize counts as "the user picked this size"; Fit-Height
  # also changes the height and must not disable itself.
  $pressed = ([System.Windows.Input.Mouse]::LeftButton -eq [System.Windows.Input.MouseButtonState]::Pressed)
  if ($pressed) {
    $script:userResized = $true
    $script:sizeTimer.Stop()
    $script:sizeTimer.Start()
  }
})`
if (!s.includes(oldSize)) throw new Error('SizeChanged block anchor missing')
s = s.replace(oldSize, `$win.Add_SizeChanged({
  # Restart the debounce so a long drag only POSTs once, after the last change.
  if ($script:userResized) {
    $script:sizeTimer.Stop()
    $script:sizeTimer.Start()
  }
})`)

writeFileSync(p, s, 'utf8')
console.log('patched sizemove:', s.includes('0x0231'), s.includes('0x0232'))