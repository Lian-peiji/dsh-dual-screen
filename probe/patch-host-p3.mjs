import { readFileSync, writeFileSync } from 'node:fs'
const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let s = readFileSync(p, 'utf8')

// param
if (!s.includes('[string]$DataUrl')) {
  s = s.replace("  [string]$StageLog = 'E:\dsh\dual-screen\panel-host.log',",
`  [string]$StageLog = 'E:\dsh\dual-screen\panel-host.log',
  # P3: panel.json 的地址（含当前端口），宿主每 2 秒拉一次渲染事件时间线。
  # 端口每次重启都变，所以由控制器现算传进来，绝不写死。
  [string]$DataUrl = '',`)
}

// timeline area: insert before the bottom bar so it fills the middle
const anchor = '# ---- bottom bar ----'
if (!s.includes('$timelineBox')) {
  const block = [
    '# ---- timeline (P3) ----',
    '# 事件时间线：由 DataUrl 每 2 秒刷新。用 StackPanel 装行，重建比增量更新简单可靠。',
    '$tlHead = New-Object System.Windows.Controls.TextBlock',
    '$tlHead.Text = $ui.timelineHead',
    '$tlHead.Foreground = $dimBrush',
    '$tlHead.FontSize = 11.5 * $UiScale',
    '$tlHead.Margin = New-Object System.Windows.Thickness(16, 8, 16, 4)',
    '$tlHead.VerticalAlignment = "Top"',
    '[void]$root.Children.Add($tlHead)',
    '',
    '$timelineBox = New-Object System.Windows.Controls.StackPanel',
    '$timelineBox.Margin = New-Object System.Windows.Thickness(16, 34, 16, 56)',
    '$timelineBox.VerticalAlignment = "Top"',
    '[void]$root.Children.Add($timelineBox)',
    '',
    '$empty.VerticalAlignment = "Center"',
    '',
    ].join('\n')
  s = s.replace(anchor, block + anchor)
}

// the polling timer + renderer, just before ShowDialog
const before = '# 清掉上一次的 ready 文件'
if (!s.includes('Get-PanelData')) {
  const poll = [
    '# ---- data polling (P3) ----',
    'function Set-TextSafe($tb, $text) { try { $tb.Text = [string]$text } catch {} }',
    '',
    'function Update-Timeline($events) {',
    '  try {',
    '    $timelineBox.Children.Clear()',
    '    if (-not $events -or @($events).Count -eq 0) {',
    '      $l = New-Object System.Windows.Controls.TextBlock',
    '      $l.Text = "-"',
    '      $l.Foreground = $dimBrush',
    '      $l.FontSize = 12 * $UiScale',
    '      [void]$timelineBox.Children.Add($l)',
    '      return',
    '    }',
    '    foreach ($e in @($events)) {',
    '      $row = New-Object System.Windows.Controls.TextBlock',
    '      $ts = ""',
    '      try { $ts = ([DateTimeOffset]::FromUnixTimeMilliseconds([long]$e.ts)).LocalDateTime.ToString("HH:mm") } catch { }',
    '      $label = ""',
    '      switch ([string]$e.type) {',
    '        "moved"       { $label = "-> 副屏  " + $e.proc }',
    '        "move-failed" { $label = "x 投送失败  " + $e.reason }',
    '        "skip"        { $label = ". 跳过  " + $e.reason }',
    '        default       { $label = [string]$e.type }',
    '      }',
    '      $row.Text = $ts + "  " + $label',
    '      $row.TextTrimming = "CharacterEllipsis"',
    '      $row.FontSize = 12 * $UiScale',
    '      $row.Margin = New-Object System.Windows.Thickness(0, 3, 0, 3)',
    '      $row.Foreground = if ([string]$e.type -eq "move-failed") { $errorBrush } else { $textBrush }',
    '      [void]$timelineBox.Children.Add($row)',
    '    }',
    '  } catch { }',
    '}',
    '',
    'if ($DataUrl) {',
    '  $pollTimer = New-Object System.Windows.Threading.DispatcherTimer',
    '  $pollTimer.Interval = [TimeSpan]::FromSeconds(2)',
    '  $pollTimer.Add_Tick({',
    '    try {',
    '      $j = Invoke-RestMethod -Uri $DataUrl -TimeoutSec 4 -UseBasicParsing',
    '      if ($j) {',
    '        if ($j.bridge) {',
    '          $st = [string]$j.bridge.status',
    '          Set-TextSafe $t2 ("bridge " + $st + " . moved " + [string]$j.bridge.moved)',
    '        }',
    '        if ($j.display -and $j.display.secondary) {',
    '          $sec = $j.display.secondary',
    '          Set-TextSafe $status ("主屏 " + $j.display.primary.w + "x" + $j.display.primary.h + " . 副屏 " + $(if ($sec.portrait) { "竖屏 " } else { "" }) + $sec.w + "x" + $sec.h + " @" + [int]([double]$sec.scale * 100) + "%")',
    '        }',
    '        $ev = @($j.events) | Where-Object { $_.type -ne "hello" } | Select-Object -Last 6',
    '        Update-Timeline $ev',
    '      }',
    '    } catch {',
    '      Set-TextSafe $t2 "与 DSH 失联... 重连中"',
    '    }',
    '  })',
    '  $pollTimer.Start()',
    '  Write-Stage ("data polling started: " + $DataUrl)',
    '}',
    '',
    ].join('\n')
  s = s.replace(before, poll + before)
}

// error brush for failed moves
if (!s.includes('$errorBrush =')) {
  s = s.replace("$accent = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#4fb3ff')",
    "$accent = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#4fb3ff')\n$errorBrush = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#ff6b6b')")
}
writeFileSync(p, s, 'utf8')
console.log('host: P3 timeline + polling added')
