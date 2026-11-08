import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
const PS = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
const HOST = 'E:\dsh\profiles\desktop\node_modules\dsh-dual-screen\bin\panel-host.ps1'
const READY = 'E:\dsh\dual-screen\panel-ready.json'
const cases = [
  ['bare', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', HOST, '-X:3536', '-Y:-564', '-W:600', '-H:1350', '-ExitAfterMs:4000']],
  ['withTopmost', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', HOST, '-X:3536', '-Y:-564', '-W:600', '-H:1350', '-Topmost', '-ExitAfterMs:4000']],
  ['withReadyFile', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', HOST, '-X:3536', '-Y:-564', '-W:600', '-H:1350', '-ReadyFile:' + READY, '-ExitAfterMs:4000']],
]
for (const [name, args] of cases) {
  try { rmSync(READY, { force: true }) } catch {}
  const p = spawn(PS, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let out = ''
  if (p.stdout) p.stdout.on('data', (d) => { out += d.toString() })
  if (p.stderr) p.stderr.on('data', (d) => { out += '[err]' + d.toString() })
  await new Promise((r) => setTimeout(r, 5000))
  let file = '(none)'
  if (existsSync(READY)) { try { file = readFileSync(READY, 'utf8').trim() } catch { file = '(unreadable)' } }
  console.log(name + ': stdout=' + JSON.stringify(out.slice(0, 120)) + ' file=' + file.slice(0, 90))
  try { p.kill() } catch {}
  await new Promise((r) => setTimeout(r, 600))
}
