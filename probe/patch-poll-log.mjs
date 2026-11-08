import { readFileSync, writeFileSync } from 'node:fs'
const p = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/panel.js'
let s = readFileSync(p, 'utf8')
const old = `      const tick = setInterval(() => {
        try {
          const obj = JSON.parse(readFileSync(READY_FILE, "utf8"))`
const neu = `      let ticks = 0
      const tick = setInterval(() => {
        ticks++
        try {
          const obj = JSON.parse(readFileSync(READY_FILE, "utf8"))
          if (ticks % 10 === 0) log('poll#' + ticks + ' file pid=' + obj.pid + ' want=' + proc.pid + ' panel=' + obj.panel)`
if (!s.includes(old)) { console.log('MISS A'); process.exit(1) }
s = s.replace(old, neu)
s = s.replace('        } catch {}\n        if (Date.now() - startedAt > 25000) return finish(false)',
  '        } catch (e) { if (ticks % 10 === 0) log("poll#" + ticks + " read failed: " + (e && e.message)) }\n        if (Date.now() - startedAt > 45000) return finish(false)')
writeFileSync(p, s, 'utf8')
console.log('poll diagnostics added; timeout -> 45s')
