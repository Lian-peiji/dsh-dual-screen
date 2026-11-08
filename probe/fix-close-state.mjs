import { readFileSync, writeFileSync } from 'node:fs'
const p = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/panel.js'
let s = readFileSync(p, 'utf8')
if (!s.includes('let closing = false')) {
  s = s.replace('  let child = null', '  let child = null\n  let closing = false   // 我们自己关的窗，别让 exit 把它标成 failed')
}
s = s.replace(
  "      proc.on('exit', (code) => {\n        log(`panel: host exited code=${code}`)\n        if (state.status !== 'open') {",
  "      proc.on('exit', (code) => {\n        log(`panel: host exited code=${code} closing=${closing}`)\n        if (closing) {\n          state.status = 'closed'\n        } else if (state.status !== 'open') {")
// mark closing in close() and reset on open
s = s.replace('  async function close() {\n    if (child) {', '  async function close() {\n    closing = true\n    if (child) {')
s = s.replace("    state.status = 'opening'\n    state.lastError = null", "    state.status = 'opening'\n    closing = false\n    state.lastError = null")
writeFileSync(p, s, 'utf8')
console.log('close state fixed')
