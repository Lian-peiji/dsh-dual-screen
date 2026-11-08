// restore-client.mjs —— 恢复 client 半边（侧栏「小肥鱼」按钮）。
// 只改插件的 package.json，**不碰 profile 的 package.json / cordis.patch.yml**（启动链命脉）。
// 前提：lib/client.js 存在且语法正确；注册 id 必须等于包名。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const SRC = 'J:/大肥鱼游乐场/dsh-dual-screen'
const P = `${SRC}/package.json`
const CLIENT = `${SRC}/lib/client.js`
const COPIES = [
  'E:/dsh/profiles/desktop/local-plugins/dsh-dual-screen',
  'E:/dsh/profiles/desktop/node_modules/dsh-dual-screen',
]
const NODE = process.execPath

// 0) client 先过语法，不过就不改清单
try {
  execFileSync(NODE, ['--check', CLIENT], { stdio: 'pipe' })
  console.log('client syntax OK')
} catch (e) {
  console.error('client syntax FAILED - aborting:', String(e && e.message))
  process.exit(1)
}

const j = JSON.parse(readFileSync(P, 'utf8'))
j.exports = j.exports || {}
j.exports['./client'] = './lib/client.js'
j.dsh = j.dsh || {}
j.dsh.client = {
  inject: [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-ui-slots',
  ],
  platform: 'web',
}
writeFileSync(P, JSON.stringify(j, null, 2) + '\n', 'utf8')
for (const dir of COPIES) copyFileSync(P, `${dir}/package.json`)
console.log('client half restored; exports:', JSON.stringify(j.exports))
console.log('dsh.client.inject:', j.dsh.client.inject.length, 'packages')