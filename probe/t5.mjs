import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.env.SystemRoot || 'C:\\Windows'
const PS = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const HOST = 'E:\\dsh\\profiles\\desktop\\node_modules\\dsh-dual-screen\\bin\\panel-host.ps1'
const STAGE = 'E:\\dsh\\dual-screen\\panel-host.log'

console.log('PS exists:', existsSync(PS), 'HOST exists:', existsSync(HOST))

const p = spawn(PS, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', HOST,
  '-X:-1130', '-Y:40', '-W:600', '-H:900', '-UiScale:1', '-ExitAfterMs:3000'],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

let out = ''
p.stdout.on('data', (d) => { out += d })
p.stderr.on('data', (d) => { out += '[ERR]' + d })
p.on('error', (e) => console.log('spawn error:', e.message))
console.log('pid:', p.pid)

await new Promise((r) => setTimeout(r, 7000))
console.log('stdout/stderr =', JSON.stringify(out.slice(0, 400)))
try { p.kill() } catch {}

if (existsSync(STAGE)) {
  console.log('--- stage log ---')
  console.log(readFileSync(STAGE, 'utf8').split(/\r?\n/).slice(-12).join('\n'))
} else {
  console.log('--- stage log missing ---')
}