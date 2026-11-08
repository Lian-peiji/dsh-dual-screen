import { readFileSync, writeFileSync } from 'node:fs'

const hp = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let h = readFileSync(hp, 'utf8')

// stage logger: file, so it works even when stdio is a pipe / there is no console
h = h.replace(
  "  [string]$ReadyFile = 'E:\\dsh\\dual-screen\\panel-ready.json',",
  [
    "  [string]$ReadyFile = 'E:\\dsh\\dual-screen\\panel-ready.json',",
    "  [string]$StageLog = 'E:\\dsh\\dual-screen\\panel-host.log',",
  ].join('\n'))

h = h.replace(
  '$ErrorActionPreference = \'Stop\'',
  [
    "$ErrorActionPreference = 'Stop'",
    '',
    '# 阶段日志：写文件而不是 stdout —— node 用管道 spawn 时 stdout 常常拿不到，',
    '# 这个文件是定位"卡在哪一步"的唯一可靠证据。',
    'function Write-Stage([string]$msg) {',
    '  try {',
    '    $line = (Get-Date).ToString("HH:mm:ss.fff") + " [" + $PID + "] " + $msg',
    '    Add-Content -LiteralPath $StageLog -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue',
    '  } catch { }',
    '}',
    'Write-Stage ("start args X=" + $PosX + " Y=" + $PosY + " W=" + $Width + " H=" + $Height + " uiScale=" + $UiScale)',
  ].join('\n'))

const marks = [
  ['[void][PNative]::SetAware()', '[void][PNative]::SetAware()\nWrite-Stage "dpi aware set"'],
  ['$ui = [IO.File]::ReadAllText($UiJson, [Text.Encoding]::UTF8) | ConvertFrom-Json', '$ui = [IO.File]::ReadAllText($UiJson, [Text.Encoding]::UTF8) | ConvertFrom-Json\nWrite-Stage ("ui.json loaded from " + $UiJson)'],
  ['$win = New-Object System.Windows.Window', 'Write-Stage "creating window"\n$win = New-Object System.Windows.Window'],
  ['$win.Content = $root', '$win.Content = $root\nWrite-Stage "content attached"'],
  ['if ($ExitAfterMs -gt 0) {', 'Write-Stage "about to ShowDialog"\nif ($ExitAfterMs -gt 0) {'],
  ['[void]$win.ShowDialog()', '[void]$win.ShowDialog()\nWrite-Stage "ShowDialog returned"'],
]
for (const [a, b] of marks) {
  if (!h.includes(a)) { console.log('MARK MISS:', a.slice(0, 40)); continue }
  h = h.replace(a, b)
}

// log the onShow callback too
h = h.replace(
  '$win.Add_SourceInitialized($onShow)',
  '$win.Add_SourceInitialized($onShow)\nWrite-Stage "SourceInitialized handler attached"')

writeFileSync(hp, h, 'utf8')
console.log('host: stage logging added')