/**
 * probe/fix-pkg.mjs —— 摘掉 dsh-dual-screen 的 client bundle 声明（三处副本统一）
 *
 * 死因（crash log 实证）：web boot 阶段 renderer 报
 *   dsh-client-modules/client.js:99 TypeError: Cannot read properties of undefined (reading 'endsWith')
 *   然后 dsh-dual-screen: import failed → 1 entry did not activate → 主界面起不来。
 *
 * 也就是说：服务端插件没问题，是我手写的 client bundle 不符合宿主 ModuleLoader 的契约。
 * 侧栏按钮留到之后用正确形态重做；先把 client 声明摘干净，让 DSH 能带第三方插件启动。
 *
 * 用法：node probe/fix-pkg.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const FILES = [
  'J:/大肥鱼游乐场/dsh-dual-screen/package.json',
  'E:/dsh/profiles/desktop/local-plugins/dsh-dual-screen/package.json',
  'E:/dsh/profiles/desktop/node_modules/dsh-dual-screen/package.json',
]

let changed = 0
for (const f of FILES) {
  if (!existsSync(f)) { console.log('missing:', f); continue }
  const before = readFileSync(f, 'utf8')
  const pkg = JSON.parse(before)
  let touched = []
  if (pkg.exports && Object.prototype.hasOwnProperty.call(pkg.exports, './client')) {
    delete pkg.exports['./client']
    touched.push('exports["./client"]')
  }
  if (pkg.dsh && Object.prototype.hasOwnProperty.call(pkg.dsh, 'client')) {
    delete pkg.dsh.client
    touched.push('dsh.client')
  }
  if (touched.length) {
    writeFileSync(f, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    changed++
    console.log(`fixed (${touched.join(', ')}): ${f}`)
  } else {
    console.log(`already clean: ${f}`)
  }
}

// 回读校验：JSON 合法 + 关键字段仍在
for (const f of FILES) {
  if (!existsSync(f)) continue
  const pkg = JSON.parse(readFileSync(f, 'utf8'))
  const hasClient = Boolean((pkg.exports && pkg.exports['./client']) || (pkg.dsh && pkg.dsh.client))
  console.log(`${f}\n  type=${pkg.type} clientDecl=${hasClient} main=${pkg.main} patch=${pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch}`)
}
console.log(`\nchanged ${changed} file(s)`)
