import { readFileSync, writeFileSync } from 'node:fs'
const hp = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let h = readFileSync(hp, 'utf8')
const lines = h.split('\n')
const out = []
let removed = 0
for (const line of lines) {
  // drop any line that contains non-ASCII (all of them are comments I added)
  if (/[^\x00-\x7F]/.test(line)) { removed++; out.push('# (removed CJK comment: PS 5.1 reads BOM-less .ps1 as ANSI and would eat a character)'); continue }
  out.push(line)
}
h = out.join('\n')
writeFileSync(hp, h, 'utf8')
console.log('non-ASCII lines replaced:', removed)