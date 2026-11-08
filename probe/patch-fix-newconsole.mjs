// fix2: CreateProcess 必须带 CREATE_NEW_CONSOLE(0x10)，否则子进程挂到我们的控制台上、根本不建新窗口；
// 顺手把 JSON 里的 $show 改成 $showMode（$Show 是 switch，累加出来是 False）。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const P = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/run-on-secondary.ps1'
let s = readFileSync(P, 'utf8')

s = s.replace(
  'bool ok = CreateProcessW(app, cmd, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref si, out pi);',
  'bool ok = CreateProcessW(app, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x00000010, IntPtr.Zero, null, ref si, out pi);  // CREATE_NEW_CONSOLE'
)
// JSON 里那个 $show（switch）换成 $showMode
s = s.replace('"show": \' + $show + \'', '"show": \' + $showMode + \'')

writeFileSync(P, s, 'utf8')
const ok = s.includes('0x00000010') && !/'\+ \$show \+'/.test(s) && !/[^\x00-\x7F]/.test(s)
console.log('fix2 ok:', ok)
for (const d of ['E:/dsh/profiles/desktop/local-plugins/dsh-dual-screen', 'E:/dsh/profiles/desktop/node_modules/dsh-dual-screen']) {
  copyFileSync(P, `${d}/bin/run-on-secondary.ps1`)
}
console.log('synced')