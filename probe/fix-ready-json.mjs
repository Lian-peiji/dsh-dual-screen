import { readFileSync, writeFileSync } from 'node:fs'
const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let s = readFileSync(p, 'utf8')
const old = `'","rect":[' + $r.L + ',' + $r.T + ',' + ($r.R - $r.L) + 'x' + ($r.B - $r.T) + '],'`
const neu = `'","rect":[' + $r.L + ',' + $r.T + ',' + ($r.R - $r.L) + ',' + ($r.B - $r.T) + '],"size":"' + ($r.R - $r.L) + 'x' + ($r.B - $r.T) + '",'`
if (!s.includes(old)) { console.log('MISS: ready json line'); process.exit(1) }
s = s.replace(old, neu)
writeFileSync(p, s, 'utf8')
console.log('host: ready JSON fixed (rect is now [x,y,w,h])')
