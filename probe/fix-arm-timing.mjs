import { readFileSync, writeFileSync } from 'node:fs'
const p = 'J:/大肥鱼游乐场/dsh-dual-screen/probe/arm-restart.mjs'
let s = readFileSync(p, 'utf8')
s = s.replace("  quietMin: 3,", "  quietMin: 0.35,   // 21 秒：输出结束后只留一个「你好判断要不要拦住」的窗口")
s = s.replace("  maxWaitMin: 10,", "  maxWaitMin: 3,     // 主人一直有新输入就最多等 3 分钟，然后放弃")
s = s.replace('const delaySec = Number(process.argv[2] || 75)', 'const delaySec = Number(process.argv[2] || 20)')
s = s.replace("console.log('guard armed; policy='", "console.log('guard armed (20s window); policy='")
writeFileSync(p, s, 'utf8')
console.log('arm-restart: delay=20s quietSec=21s maxWait=3min')
