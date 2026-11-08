// fix: PowerShell 大小写不敏感 —— 参数 $Show 与变量 $show 撞车（同 $H/$h 那个老坑）。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const P = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/run-on-secondary.ps1'
let s = readFileSync(P, 'utf8')

s = s.replace('$show = 7            # SW_SHOWMINNOACTIVE', '$showMode = 7        # SW_SHOWMINNOACTIVE')
s = s.replace('if ($Show) { $show = 4 }', 'if ($Show) { $showMode = 4 }')
s = s.replace('if ($Hide) { $show = 0 }', 'if ($Hide) { $showMode = 0 }')
s = s.replace('[int16]$show)', '[int16]$showMode)')
s = s.replace('" show": \' + $show + \'', '" show": \' + $showMode + \'')

writeFileSync(P, s, 'utf8')
const bad = /(^|[^A-Za-z])\$show([^M]|$)/m.test(s)
console.log('uses showMode:', s.includes('$showMode'), '| stray $show:', bad, '| ascii:', !/[^\x00-\x7F]/.test(s))
for (const d of ['E:/dsh/profiles/desktop/local-plugins/dsh-dual-screen', 'E:/dsh/profiles/desktop/node_modules/dsh-dual-screen']) {
  copyFileSync(P, `${d}/bin/run-on-secondary.ps1`)
}
console.log('synced')