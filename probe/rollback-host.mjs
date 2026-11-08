// rollback-host.mjs —— host 半边的止血脚本。
//
// 为什么要有：2026-11-06 02:06 那次「应用无法启动」是 lib/index.js 里的
// run_on_secondary 工具抛错（defineTool 的 spec 缺字段 → TypeError: reading 'render'），
// apply() 里抛错 = host 根本起不来。rollback-client.mjs 只管 client 半边，管不到它，
// 所以补这一条：把宿主里「可选、可摘」的能力整段摘掉并同步两处副本。
//
// 用法：node rollback-host.mjs
// 判据：按行号删「工具 run_on_secondary」这一段（从注释行到该 IIFE 的 '})()'），
//       删完做一次语法检查 + 同步 src / local-plugins / node_modules。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const SRC = 'J:/大肥鱼游乐场/dsh-dual-screen'
const P = `${SRC}/lib/index.js`
const COPIES = [
  'E:/dsh/profiles/desktop/local-plugins/dsh-dual-screen/lib/index.js',
  'E:/dsh/profiles/desktop/node_modules/dsh-dual-screen/lib/index.js',
]
const NODE = process.execPath

let s = readFileSync(P, 'utf8')
if (!s.includes('run_on_secondary')) {
  console.log('nothing to remove: run_on_secondary not present')
} else {
  const lines = s.split('\n')
  const start = lines.findIndex((l) => l.includes('工具 run_on_secondary'))
  let end = -1
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim() === '})()') { end = i; break }
  }
  if (start < 0 || end < 0) {
    console.error('markers not found (start=' + start + ' end=' + end + ') - aborting, nothing written')
    process.exit(1)
  }
  lines.splice(start, end - start + 1)
  s = lines.join('\n')
  writeFileSync(P, s, 'utf8')
  console.log('removed run_on_secondary block (' + (end - start + 1) + ' lines)')
}

// 语法检查：宁可报错也不要把坏代码同步出去
try {
  execFileSync(NODE, ['--check', P], { stdio: 'pipe' })
  console.log('syntax OK')
} catch (e) {
  console.error('syntax check FAILED, copies not updated:', String(e && e.message))
  process.exit(1)
}

for (const c of COPIES) copyFileSync(P, c)
console.log('synced to', COPIES.length, 'copies')
console.log('run_on_secondary present now:', readFileSync(P, 'utf8').includes('run_on_secondary'))