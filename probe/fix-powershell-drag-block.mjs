// fix-powershell-drag-block.mjs -- replace the dead WPF mouse handlers with the
// position-saving callback the C# shim now calls.
//
// The old block never fired (WebView2 owns the pointer), so it is deleted rather than
// left as misleading dead code. What remains is the one job PowerShell still owns:
// persisting where the owner dropped the pet.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/pet-webview.ps1'
let s = readFileSync(p, 'utf8')

const startMark = '# ---- dragging ----'
const endMark = 'if ($ExitAfterMs -gt 0) {'
const i = s.indexOf(startMark)
const j = s.indexOf(endMark)
if (i < 0 || j < 0 || j < i) throw new Error('drag block markers not found')

const block = String.raw`# ---- dragging ----
# The GESTURE lives in the page (see panel/pet.html): WebView2 sits on top of the
# whole client area, so WPF never sees a mouse button. The page posts
# "drag:start|move|end:<screenX>:<screenY>[:moved]" over the web message channel and
# the C# shim moves the window with SetWindowPos.
#
# PowerShell keeps exactly one job here: remember where the owner dropped it.
# Assigning a scriptblock to a C# Action<,> is enough; the shim invokes it on the UI
# thread, which is where file IO for a few bytes belongs anyway.
$script:savePos = [Action[double, double]]{
  param($wx, $wy)
  try {
    $body = '{ "x": ' + [int][math]::Round($wx) + ', "y": ' + [int][math]::Round($wy) + ' }'
    [IO.File]::WriteAllText($posFile, $body, (New-Object Text.UTF8Encoding($false)))
    Write-Stage ('pos saved ' + [int][math]::Round($wx) + ',' + [int][math]::Round($wy))
  } catch {
    Write-Stage ('pos save failed: ' + $_.Exception.Message)
  }
}
[PetHost]::OnDragEnd = $script:savePos

`

s = s.slice(0, i) + block + s.slice(j)
writeFileSync(p, s, 'utf8')
console.log('PS drag block replaced; dead WPF handlers removed:', !s.includes('Add_MouseLeftButtonDown'))