import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LAUNCHER = join(ROOT, 'bin', 'run-on-secondary.ps1')
execFile('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',LAUNCHER,'-Command','powershell.exe','-Args','-NoProfile -Command exit','-Hide'],
  { timeout: 20000, windowsHide: true }, (err, stdout) => {
    const out = String(stdout || '').trim()
    const last = out.split(/\r?\n/).filter(Boolean).pop() || ''
    console.log('codes:', [...last.slice(0, 8)].map(c => c.charCodeAt(0)))
    console.log('len:', last.length)
    try { console.log('parsed:', JSON.parse(last)) } catch (e) { console.log('PARSE FAIL:', e.message) }
  })
