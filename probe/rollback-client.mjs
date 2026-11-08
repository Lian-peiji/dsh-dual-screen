// rollback-client.mjs —— 出事的止血脚本：把 dual-screen 的 client 半边摘掉并同步两处副本。
// 用法：node rollback-client.mjs   （改完等一次重启/刷新即可恢复）
// 为什么要有：手写 bundle 上一次把 DSH web boot 搞崩过（1 entry did not activate），
// 必须能在 10 秒内退回「无 client」的干净状态。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const SRC = 'J:/大肥鱼游乐场/dsh-dual-screen'
const TARGETS = [
  'E:/dsh/profiles/desktop/local-plugins/dsh-dual-screen',
  'E:/dsh/profiles/desktop/node_modules/dsh-dual-screen',
]

const p = `${SRC}/package.json`
const j = JSON.parse(readFileSync(p, 'utf8'))
if (j.exports) delete j.exports['./client']
if (j.dsh) delete j.dsh.client
writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8')
for (const dir of TARGETS) copyFileSync(p, `${dir}/package.json`)
console.log('client halves removed; package.json synced to', TARGETS.length, 'copies')
console.log('exports now:', JSON.stringify(j.exports), 'dsh:', JSON.stringify(j.dsh))