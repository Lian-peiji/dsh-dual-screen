import { readFileSync, writeFileSync } from 'node:fs'
// 1) panel.js: forward a data URL so the host can poll bridge events
const pp = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/panel.js'
let p = readFileSync(pp, 'utf8')
p = p.replace("      '-ReadyFile:' + READY_FILE,", "      '-ReadyFile:' + READY_FILE,\n      '-DataUrl:' + (opts.dataUrl || ''),")
p = p.replace('  async function open(rect, config = {}, uiScale = 1) {', '  async function open(rect, config = {}, uiScale = 1, dataUrl = \'\') {')
p = p.replace('place(rect, { topmost, uiScale })', 'place(rect, { topmost, uiScale, dataUrl })')
writeFileSync(pp, p, 'utf8')

// 2) index.js: pass the url (already computed there)
const ip = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/index.js'
let i = readFileSync(ip, 'utf8')
i = i.replace('const out = await panel.open(rect, loadConfig(), uiScale)',
  'const dataUrl = baseUrl(req) + "/dsh-dual-screen/panel.json"\n    const out = await panel.open(rect, loadConfig(), uiScale, dataUrl)')
writeFileSync(ip, i, 'utf8')
console.log('JS: dataUrl plumbed through')
