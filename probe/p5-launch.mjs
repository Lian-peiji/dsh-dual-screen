// probe/p5-launch.mjs -- exercise bin/run-on-secondary.ps1 exactly like lib/index.js does.
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const LAUNCHER = join(ROOT, 'bin', 'run-on-secondary.ps1')
console.log('launcher:', LAUNCHER)

const argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', LAUNCHER,
  '-Command', 'powershell.exe', '-Args', '-NoProfile -Command exit', '-Hide']
console.log('argv:', JSON.stringify(argv))

execFile('powershell.exe', argv, { timeout: 20000, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
  console.log('err:', err ? `${err.code} ${err.message}` : 'none')
  console.log('stdout:', JSON.stringify(stdout))
  console.log('stderr:', JSON.stringify(stderr))
})
