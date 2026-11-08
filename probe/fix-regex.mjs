import { readFileSync, writeFileSync } from 'node:fs'
const p = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/panel.js'
let s = readFileSync(p, 'utf8')
const bad = /for \(const line of s\.split\(\/[\s\S]{0,10}?\/\)\) \{/
if (!bad.test(s)) { console.log('pattern not found'); process.exit(1) }
s = s.replace(bad, 'for (const line of s.split(/[\\r\\n]+/)) {')
writeFileSync(p, s, 'utf8')
console.log('fixed:', /for \(const line of s\.split\([^\n]*\)/.exec(s)[0])