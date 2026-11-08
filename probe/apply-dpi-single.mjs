import { readFileSync, writeFileSync } from 'node:fs'

// ---- 1) panel-host.ps1: add -UiScale and apply it to every fixed size ----
const hostPath = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let h = readFileSync(hostPath, 'utf8')
h = h.replace(
  "  [switch]$Topmost,",
  [
    '  [switch]$Topmost,',
    '  # DPI compensation. The window is sized in PHYSICAL pixels, so a font size',
    '  # that looks right on the 100% primary monitor shrinks to 2/3 on the 150%',
    '  # secondary one. The controller passes the target monitor scale here and',
    '  # every size below is multiplied by it.',
    '  [double]$UiScale = 1.0,',
  ].join('\n'))
const sized = [
  ['$t1.FontSize = 15', '$t1.FontSize = 15 * $UiScale'],
  ['$t2.FontSize = 11.5', '$t2.FontSize = 11.5 * $UiScale'],
  ['$status.FontSize = 11.5', '$status.FontSize = 11.5 * $UiScale'],
  ['$empty.FontSize = 13', '$empty.FontSize = 13 * $UiScale'],
  ['$b.FontSize = 12', '$b.FontSize = 12 * $UiScale'],
  ['$head.Height = 52', '$head.Height = 52 * $UiScale'],
  ['$bar.Height = 46', '$bar.Height = 46 * $UiScale'],
  ['$close.Width = 26', '$close.Width = 26 * $UiScale'],
  ['$close.Height = 26', '$close.Height = 26 * $UiScale'],
]
for (const [a, b] of sized) {
  if (!h.includes(a)) { console.log('HOST MISS:', a); continue }
  h = h.replace(a, b)
}
h = h.replace(
  '  $line = \'{"panel":"ready","hwnd":"0x\' + ([long]$h).ToString(\'X\') + \'","rect":[\' + $r.L + \',\' + $r.T + \',\' + ($r.R - $r.L) + \'x\' + ($r.B - $r.T) + \'],"scale":\' + $scale + \'}\'',
  '  $line = \'{"panel":"ready","hwnd":"0x\' + ([long]$h).ToString(\'X\') + \'","rect":[\' + $r.L + \',\' + $r.T + \',\' + ($r.R - $r.L) + \'x\' + ($r.B - $r.T) + \'],"scale":\' + $scale + \',"uiScale":\' + $UiScale + \'}\'')
writeFileSync(hostPath, h, 'utf8')
console.log('host: UiScale applied')

// ---- 2) panel.js: forward the scale to the host ----
const panelPath = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/panel.js'
let p = readFileSync(panelPath, 'utf8')
p = p.replace(
  '  function place(rect, opts = {}) {',
  '  function place(rect, opts = {}) {')
p = p.replace(
  "      '-X:' + rect.x, '-Y:' + rect.y, '-W:' + rect.w, '-H:' + rect.h,\n    ]",
  [
    "      '-X:' + rect.x, '-Y:' + rect.y, '-W:' + rect.w, '-H:' + rect.h,",
    "      // 缩放系数：让字号在 150% 副屏上与 100% 主屏观感一致（不传则 1.0）",
    "      '-UiScale:' + (opts.uiScale || 1),",
    '    ]',
  ].join('\n'))
p = p.replace('  async function open(rect, config = {}) {', '  async function open(rect, config = {}, uiScale = 1) {')
p = p.replace(
  'const proc = spawn(POWERSHELL, place(rect, { topmost }),',
  'const proc = spawn(POWERSHELL, place(rect, { topmost, uiScale }),')
writeFileSync(panelPath, p, 'utf8')
console.log('panel.js: uiScale forwarded')

// ---- 3) index.js: pass secondary scale; close panel when secondary disappears ----
const idxPath = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/index.js'
let i = readFileSync(idxPath, 'utf8')
i = i.replace(
  'const out = await panel.open(url, rect, loadConfig())',
  'const uiScale = (state.displays && state.displays.secondary && state.displays.secondary.scale) || 1\n    const out = await panel.open(rect, loadConfig(), uiScale)')
i = i.replace(
  'const out = await panel.open(url, rect, loadConfig())',
  'const uiScale = (state.displays && state.displays.secondary && state.displays.secondary.scale) || 1\n    const out = await panel.open(rect, loadConfig(), uiScale)')
// single-screen: hide (never move to primary) and report it quietly
i = i.replace(
  "    if (wasActive !== state.active) {\n      log(`active -> ${state.active} (monitors=${d.count}, hasSecondary=${d.hasSecondary})`)\n    }",
  [
    "    if (wasActive !== state.active) {",
    '      log(`active -> ${state.active} (monitors=${d.count}, hasSecondary=${d.hasSecondary})`)',
    '    }',
    '    // 拔掉副屏：面板隐藏而不是搬回主屏（PLAN §7.5 #15），且不报错',
    '    if (!state.active && panel.status().status === "open") {',
    '      log("secondary monitor gone: closing panel (hide, do not move to primary)")',
    '      try { await panel.close() } catch {}',
    '    }',
  ].join('\n'))
writeFileSync(idxPath, i, 'utf8')
console.log('index.js: uiScale + single-screen auto-close')