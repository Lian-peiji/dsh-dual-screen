// fix-ps-parse.mjs -- remove the stray JS-style trailing comma inside the
// PowerShell if-expression: PS 5.1 stops parsing at the comma and the whole
// script dies before the window exists ("host exited code=1", no log lines).
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let s = readFileSync(p, 'utf8')

const bad = `        $body = if ($script:saveHeight) {
          '{"panel":{"width":' + $wDip + ',"height":' + $hDip + ',"resizedByUser":true}}',
        } else {
          '{"panel":{"width":' + $wDip + '}}';
        }`
if (!s.includes(bad)) throw new Error('anchor missing')

const good = `        if ($script:saveHeight) {
          $body = '{"panel":{"width":' + $wDip + ',"height":' + $hDip + ',"resizedByUser":true}}'
        } else {
          $body = '{"panel":{"width":' + $wDip + '}}'
        }`
s = s.replace(bad, good)

writeFileSync(p, s, 'utf8')
console.log('fixed:', s.includes(good.slice(0, 40)))