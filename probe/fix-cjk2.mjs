import { readFileSync, writeFileSync } from 'node:fs'
const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let s = readFileSync(p, 'utf8')
const lines = s.split('\n')
for (let i = 0; i < lines.length; i++) {
  if (/[^\x00-\x7F]/.test(lines[i]) && lines[i].trimStart().startsWith('#')) {
    lines[i] = '# Event timeline (P3): refreshed every 2s from DataUrl. Rows are rebuilt'
      + (i + 1 < lines.length ? '' : '')
  }
}
s = lines.join('\n')
// replace the follow-up CJK comment line too
s = s.replace(/^# 事件时间线.*$/m, '# Event timeline (P3): refreshed every 2s from DataUrl; rows are rebuilt each tick\n# (simpler and safer than incremental updates).')
s = s.replace(/^#.*每 2 秒刷新.*$/m, '')
writeFileSync(p, s, 'utf8')
console.log('non-ascii now:', (s.match(/[^\x00-\x7F]/g) || []).length)
