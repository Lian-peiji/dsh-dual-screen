// switch-electron-args-to-env.mjs -- pass settings through the environment.
//
// Electron filters argv: unknown --flags are not guaranteed to reach main.js, and in
// fact our --log= never arrived (pet-host.log had zero [el] lines while the window was
// clearly running). Environment variables have no such filter.
//
// Everything the launcher needs now travels as DSH_PET_* so main.js can read it no
// matter how Electron mangles argv.
import { readFileSync, writeFileSync } from 'node:fs'

const mainPath = 'J:/大肥鱼游乐场/dsh-dual-screen/pet-electron/main.js'
let m = readFileSync(mainPath, 'utf8')

const oldArg = `function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='))
  return hit ? hit.slice(name.length + 3) : fallback
}`
if (!m.includes(oldArg)) throw new Error('arg() anchor missing')
m = m.replace(oldArg, `// Read a setting from the environment first (Electron drops unknown argv flags),
// then from argv for manual runs.
function arg(name, fallback) {
  const envKey = 'DSH_PET_' + name.toUpperCase().replace(/-/g, '_')
  if (process.env[envKey] !== undefined && process.env[envKey] !== '') return process.env[envKey]
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='))
  return hit ? hit.slice(name.length + 3) : fallback
}`)

writeFileSync(mainPath, m, 'utf8')
console.log('env-first arg reading installed')

// ---- launcher side ----
const petJs = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/pet.js'
let s = readFileSync(petJs, 'utf8')

const oldArgs = `    const args = [
      PET_ELECTRON_APP,
      '--page=' + page,
      '--ready=' + READY_FILE,
      '--pos-file=' + join(DATA_DIR, 'pet-pos.json'),
      '--log=' + join(DATA_DIR, 'pet-host.log'),
      '--size=' + size,
    ]
    if (opts.x !== undefined) args.push('--x=' + Math.round(opts.x))
    if (opts.y !== undefined) args.push('--y=' + Math.round(opts.y))`
if (!s.includes(oldArgs)) throw new Error('args anchor missing')
s = s.replace(oldArgs, `    // Electron filters unknown argv flags, so the real settings travel as env vars.
    // argv still carries the app directory (that part Electron always honours).
    const petEnv = {
      ...process.env,
      DSH_PET_PAGE: page,
      DSH_PET_READY: READY_FILE,
      DSH_PET_POS_FILE: join(DATA_DIR, 'pet-pos.json'),
      DSH_PET_LOG: join(DATA_DIR, 'pet-host.log'),
      DSH_PET_SIZE: String(size),
    }
    if (opts.x !== undefined) petEnv.DSH_PET_X = String(Math.round(opts.x))
    if (opts.y !== undefined) petEnv.DSH_PET_Y = String(Math.round(opts.y))
    const args = [PET_ELECTRON_APP]`)

const oldEnv = `    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE`
if (!s.includes(oldEnv)) throw new Error('env anchor missing')
s = s.replace(oldEnv, `    const env = petEnv
    delete env.ELECTRON_RUN_AS_NODE`)

writeFileSync(petJs, s, 'utf8')
console.log('launcher env wired:', s.includes('DSH_PET_PAGE'))