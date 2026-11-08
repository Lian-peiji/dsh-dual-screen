import { readFileSync, writeFileSync } from 'node:fs'

// ---------- 1) panel-host.ps1: write-ready-file ----------
const hp = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let h = readFileSync(hp, 'utf8')

h = h.replace(
  "  [double]$UiScale = 1.0,",
  [
    '  [double]$UiScale = 1.0,',
    '  # Ready handshake over a FILE, not stdout: when the host is spawned by node',
    '  # with piped stdio, the ready line never reached the controller (it works',
    '  # from an interactive console). A file survives console/pipe/encoding',
    '  # differences and leaves an audit trail.',
    "  [string]$ReadyFile = 'E:\\dsh\\dual-screen\\panel-ready.json',",
  ].join('\n'))

const oldLine = "  $line = '{\"panel\":\"ready\",\"hwnd\":\"0x' + ([long]$h).ToString('X') + '\",\"rect\":[' + $r.L + ',' + $r.T + ',' + ($r.R - $r.L) + 'x' + ($r.B - $r.T) + '],\"scale\":' + $scale + ',\"uiScale\":' + $UiScale + '}'\n  [Console]::Out.WriteLine($line); [Console]::Out.Flush()"
const newBlock = [
  "  $line = '{\"panel\":\"ready\",\"pid\":' + $PID + ',\"hwnd\":\"0x' + ([long]$h).ToString('X') + '\",\"rect\":[' + $r.L + ',' + $r.T + ',' + ($r.R - $r.L) + 'x' + ($r.B - $r.T) + '],\"scale\":' + $scale + ',\"uiScale\":' + $UiScale + '}'",
  '  try {',
  '    $dir = Split-Path -Parent $ReadyFile',
  '    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }',
  '    $tmp = $ReadyFile + ".tmp"',
  '    [IO.File]::WriteAllText($tmp, $line, (New-Object Text.UTF8Encoding($false)))',
  '    Move-Item -LiteralPath $tmp -Destination $ReadyFile -Force',
  '  } catch { }',
  '  [Console]::Out.WriteLine($line); [Console]::Out.Flush()',
].join('\n')
if (!h.includes(oldLine)) { console.log('HOST READY LINE MISS'); } else { h = h.replace(oldLine, newBlock) }

// clear a stale ready file before showing the window
h = h.replace(
  '[void]$win.ShowDialog()',
  [
    '# 清掉上一次的 ready 文件：控制器按 pid 校验，但清干净更省事',
    'try { if (Test-Path -LiteralPath $ReadyFile) { Remove-Item -LiteralPath $ReadyFile -Force } } catch { }',
    '[void]$win.ShowDialog()',
  ].join('\n'))
writeFileSync(hp, h, 'utf8')
console.log('host: ready file wired')

// ---------- 2) panel.js: poll the file instead of stdout ----------
const pp = 'J:/大肥鱼游乐场/dsh-dual-screen/lib/panel.js'
let p = readFileSync(pp, 'utf8')

p = p.replace(
  "const POWERSHELL = join(process.env.SystemRoot || 'C:\\\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')",
  [
    "const POWERSHELL = join(process.env.SystemRoot || 'C:\\\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')",
    "const READY_FILE = 'E:\\\\dsh\\\\dual-screen\\\\panel-ready.json'",
  ].join('\n'))

p = p.replace(
  "      '-UiScale:' + (opts.uiScale || 1),",
  [
    "      '-UiScale:' + (opts.uiScale || 1),",
    "      '-ReadyFile:' + READY_FILE,",
  ].join('\n'))

// replace the whole stdout-based wait block with a file poll
const startMarker = '    const ready = new Promise((resolve) => {'
const endMarker = '    const ok = await ready'
const startIdx = p.indexOf(startMarker)
const endIdx = p.indexOf(endMarker)
if (startIdx < 0 || endIdx < 0) {
  console.log('PANEL WAIT BLOCK MISS', startIdx, endIdx)
} else {
  const newWait = [
    '    // 等宿主自报 ready：走文件握手（stdout 在管道下不可靠，见 panel-host.ps1 注释）',
    '    const startedAt = Date.now()',
    '    const ready = await new Promise((resolve) => {',
    '      let settled = false',
    '      const finish = (v) => { if (!settled) { settled = true; clearInterval(tick); resolve(v) } }',
    '      const tick = setInterval(() => {',
    '        try {',
    '          const raw = readFileSync(READY_FILE, "utf8")',
    '          const obj = JSON.parse(raw)',
    '          if (obj && obj.panel === "ready" && Number(obj.pid) === Number(proc.pid)) {',
    '            state.status = "open"',
    '            state.hwnd = obj.hwnd',
    '            state.rect = { x: obj.rect[0], y: obj.rect[1], w: obj.rect[2], h: obj.rect[3] }',
    '            state.openedAt = Date.now()',
    '            log(`panel: ready hwnd=${obj.hwnd} rect=${JSON.stringify(state.rect)} uiScale=${obj.uiScale}`)',
    '            return finish(true)',
    '          }',
    '        } catch {}',
    '        if (Date.now() - startedAt > 25000) return finish(false)',
    '      }, 200)',
    '      if (tick.unref) tick.unref()',
    '      proc.on("exit", (code) => {',
    '        log(`panel: host exited code=${code}`)',
    '        if (state.status !== "open") {',
    '          state.status = "failed"',
    '          if (!state.lastError) state.lastError = `host exited code=${code}`',
    '        } else { state.status = "closed" }',
    '        state.pid = null; state.hwnd = null; child = null',
    '        finish(false)',
    '      })',
    '    })',
    '',
  ].join('\n')
  p = p.slice(0, startIdx) + newWait + p.slice(endIdx)
}
writeFileSync(pp, p, 'utf8')
console.log('panel.js: file handshake wired')