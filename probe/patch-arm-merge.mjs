import { readFileSync, writeFileSync } from 'node:fs'
const p = 'J:/大肥鱼游乐场/dsh-dual-screen/probe/arm-restart.mjs'
let s = readFileSync(p, 'utf8')
if (!s.includes('armRestart')) {
  s = s.replace(
    "import { join } from 'node:path'",
    "import { join } from 'node:path'\nimport { armRestart } from 'file:///J:/%E5%A4%A7%E8%82%A5%E9%B1%BC%E6%B8%B8%E4%B9%90%E5%9C%BA/dsh-restart-guard/lib/request-queue.js'")
  const old = `const reqPath = join(STATE_DIR, 'request.json')
if (!existsSync(STATE_DIR)) { console.log('ABORT: state dir missing'); process.exit(2) }
writeFileSync(reqPath, JSON.stringify(req, null, 2), 'utf8')
try { rmSync(join(STATE_DIR, 'cancel.json'), { force: true }) } catch {}
console.log('request written, targetAt =', req.targetAt)`
  const neu = `if (!existsSync(STATE_DIR)) { console.log('ABORT: state dir missing'); process.exit(2) }
// 单一写者 + 合并：已有排队请求就不覆盖，只合并（保留更早的 targetAt）
const armed = armRestart({ stateDir: STATE_DIR, request: req })
if (!armed.ok) { console.log('ABORT: arm failed:', armed.error); process.exit(2) }
try { rmSync(join(STATE_DIR, 'cancel.json'), { force: true }) } catch {}
if (armed.coalesced) {
  console.log('merged into pending request', armed.request.id, '| targetAt kept =', armed.request.targetAt, '| reasons =', (armed.request.reasons || []).length)
} else {
  console.log('request written, targetAt =', req.targetAt)
}`
  if (!s.includes(old)) { console.log('MISS arm write block'); process.exit(1) }
  s = s.replace(old, neu)
}
writeFileSync(p, s, 'utf8')
console.log('arm-restart.mjs: merge wired')
