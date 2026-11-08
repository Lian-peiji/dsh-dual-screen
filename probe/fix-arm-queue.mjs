import { readFileSync, writeFileSync } from 'node:fs'
const p = 'J:/大肥鱼游乐场/dsh-dual-screen/probe/arm-restart.mjs'
let s = readFileSync(p, 'utf8')
const old = `if (others.length > 0) {
  console.log('ABORT: another session is running — ask the owner first')
  process.exit(3)
}`
const neu = `// 有别的会话在跑 -> 不中止、不请示：转成"排队等安静"（runner 自己会等它们安静再动手）。
// 主人 2026-11-05 口径：确认条件我自己查，查完就执行；有冲突就延迟，不问。
const mustQueue = others.length > 0
if (mustQueue) console.log('another session is active -> queueing (runner will wait for quiet, never interrupts it)')`
if (!s.includes(old)) { console.log('MISS abort block'); process.exit(1) }
s = s.replace(old, neu)
s = s.replace('policy,', 'policy,')
s = s.replace("const policy = process.argv[3] === 'continue' ? 'continue' : 'safe'",
  "const policy = process.argv[3] === 'continue' ? 'continue' : 'safe'   // mustQueue 时强制 safe")
s = s.replace('  waitQuiet: policy !== \'continue\',', '  waitQuiet: mustQueue || policy !== \'continue\',')
writeFileSync(p, s, 'utf8')
console.log('arm-restart: multi-session now queues instead of aborting')
