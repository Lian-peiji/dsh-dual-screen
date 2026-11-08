// fix: CreateProcess 需要可执行文件的**完整路径**（lpApplicationName 传 'cmd.exe' 直接 -2 FILE_NOT_FOUND）。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const P = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/run-on-secondary.ps1'
let s = readFileSync(P, 'utf8')

if (!s.includes('# resolve the executable')) {
  s = s.replace(
    "$pid2 = [Launch2]::Spawn($Command,",
    `# resolve the executable: CreateProcess needs a real path (a bare name fails with -2)
$exePath = $Command
if ($Command -notmatch '[\\\\/]') {
  $c = Get-Command $Command -ErrorAction SilentlyContinue
  if ($c -and $c.Source) { $exePath = $c.Source }
  elseif ($Command -ieq 'cmd.exe') { $exePath = $env:ComSpec }
}
$pid2 = [Launch2]::Spawn($exePath,`
  )
}

writeFileSync(P, s, 'utf8')
console.log('resolved-exe patch:', s.includes('# resolve the executable'), '| ascii:', !/[^\x00-\x7F]/.test(s))
for (const d of ['E:/dsh/profiles/desktop/local-plugins/dsh-dual-screen', 'E:/dsh/profiles/desktop/node_modules/dsh-dual-screen']) {
  copyFileSync(P, `${d}/bin/run-on-secondary.ps1`)
}
console.log('synced')