// patch-exit-save.mjs -- fix vertical resize drop: EXITSIZEMOVE must unconditionally POST size
// in case the debounce timer tick was lost during modal resize loop.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let s = readFileSync(p, 'utf8')

const enter = "  if ($msg -eq 0x0231) { $script:sizeTimer.Stop(); return [IntPtr]::Zero }"
const exit = "  if ($msg -eq 0x0232) { $script:sizeTimer.Stop(); $script:sizeTimer.Start(); return [IntPtr]::Zero }"
if (!s.includes(enter) || !s.includes(exit)) throw new Error('anchors missing')

// ENTER: set a flag that next NCHITTEST can use to know we're starting a drag
s = s.replace(enter, "  if ($msg -eq 0x0231) { $script:inDrag = $true; $script:sizeTimer.Stop(); return [IntPtr]::Zero }")

// EXIT: always save once (width-only vs width+height decided by last NCHITTEST code)
const newExit = `  if ($msg -eq 0x0232) {
    try {
      \$wDip = [int][math]::Round(\$win.ActualWidth)
      \$hDip = [int][math]::Round(\$win.ActualHeight)
      \$base = if (\$DataUrl -match '^(https?://[^/]+)') { \$Matches[1] } else { \$null }
      if (\$base) {
        \$body = if (\$script:saveHeight) {
          '{"panel":{"width":' + \$wDip + ',"height":' + \$hDip + ',"resizedByUser":true}}',
        } else {
          '{"panel":{"width":' + \$wDip + '}}';
        }
        try {
          \$req = [System.Net.HttpWebRequest]::Create(\$base + '/dsh-dual-screen/config')
          \$req.Method = 'POST'; \$req.Proxy = \$null; \$req.Timeout = 4000
          \$req.ContentType = 'application/json; charset=utf-8'
          \$bytes = [Text.Encoding]::UTF8.GetBytes(\$body)
          \$req.ContentLength = \$bytes.Length
          \$stream = \$req.GetRequestStream()
          \$stream.Write(\$bytes, 0, \$bytes.Length)
          \$stream.Close()
          \$req.GetResponse().Close()
          Write-Stage 'unconditional save: ' + \$body
        } catch { Write-Stage 'unconditional save failed' }
      }
    } finally { \$script:inDrag = \$false; \$script:saveHeight = \$false }
    return [IntPtr]::Zero
  }`
s = s.replace(exit, newExit)

writeFileSync(p, s, 'utf8')
console.log('ok:', s.includes('unconditional save'))