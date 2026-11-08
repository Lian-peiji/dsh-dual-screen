import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
const p = 'J:/大肥鱼游乐场/dsh-dual-screen/PLAN.md'
copyFileSync(p, p + '.bak-v0.5')
let t = readFileSync(p, 'utf8')
let miss = 0
const rep = (from, to) => {
  if (!t.includes(from)) { console.log('MISS:', from.slice(0, 60)); miss++; return }
  t = t.replace(from, to)
}

rep('> 版本：**v0.5（2026-11-05 打磨稿 · 交接版 + 实机体验 + 浮窗调研 + V2 立项）**',
  '> 版本：**v0.6（2026-11-05 夜间施工回填 · 面板宿主换原生 WPF，见 §14 变更记录）**')

const s54 = [
  '### 5.4 副屏面板（panel.js + panel/）',
  '',
  '> ### ⚠️ v0.6 选型变更（2026-11-05 夜间实测后主人拍板 A 案）',
  '> **本节原方案「Edge --app 拉面板」已废弃，改为原生 WPF 无边框窗 `bin/panel-host.ps1`。**',
  '>',
  '> 废弃原因（三条实测，缺一不可推翻）：',
  '> 1. `SetWindowLong` 剥 `WS_CAPTION` **能**去掉系统边框（实测 hasCaption=False、rect 精确），',
  '>    但 Edge `--app` 会**在客户区里自绘一条工具栏**（文档标题 + 最小化/最大化/关闭），Win32 剥不掉；',
  '> 2. 把这条工具栏顶到屏幕外（窗口 y 上移 ToolbarH）视觉上没了，**一拖窗就露出来** —— 主人判为自欺欺人，不接受；',
  '> 3. Edge 没有任何开关能关掉这条 app 工具栏。',
  '>',
  '> 采用方案：WPF `WindowStyle=None` + `ShowActivated=false` + `ShowInTaskbar=false`，',
  '> 真无边框、可真拖拽（头部 `DragMove()`），且给 P6 透明桌宠打好地基（同一套 WPF，`AllowsTransparency` 一步之遥）。',
  '> 界面文案放 `panel/ui.json`（UTF-8），`.ps1` 一律纯 ASCII。',
  '>',
  '> ⚠️ 本机实测坑：Per-Monitor V2 的 WPF 窗在这台机上 **DIP→物理是 1:1**',
  '> （scale 报 1.5，但 Left/Top/Width/Height 按物理像素生效），**不要除以 scale**，',
  '> 否则摆到 2357,-392 400x900（跑到主屏还小一圈）。直接传物理矩形。',
  '',
  '> 以下为 v0.5 原文，保留作历史参考（Edge 方案已不采用）：',
].join('\n')
rep('### 5.4 副屏面板（panel.js + panel/）', s54)

rep('- [ ] 面板 HTML 骨架 + Edge --app 拉起 + 定位 + 不抢焦点',
  '- [x] ~~面板 HTML 骨架 + Edge --app 拉起~~ → **v0.6 改为原生 WPF 窗**（见 §5.4）：无边框 + 定位 + 拖拽 + 不抢焦点已成立，待接真实数据')

rep('| 11 | V2 透明鲸鱼桌宠 | **✅ 已立项（主人拍板），排 P6；v2a WPF 透明窗优先，v2b 接 dsh-pet 可选** | ✅ 已定 |', [
  '| 11 | V2 透明鲸鱼桌宠 | **✅ 已立项（主人拍板），排 P6；v2a WPF 透明窗优先，v2b 接 dsh-pet 可选** | ✅ 已定 |',
  '| 12 | 面板宿主技术 | **原生 WPF 无边框窗（A 案）**；Edge --app 因自绘工具栏无法去除而废弃 | ✅ 已定（v0.6） |',
  '| 13 | 重启时机 | 有人用（含本会话正在跑）→ 延迟/等安静；无人用才自动重启；不用 policy=continue 强推 | ✅ 已定（v0.6） |',
].join('\n'))

const s14 = [
  '',
  '---',
  '',
  '## 14. v0.6 变更记录（2026-11-05 夜间施工）',
  '',
  '> 施工中被实测推翻/修正的东西全部回填这里，避免下个会话按旧计划重犯。',
  '',
  '### 14.1 选型变更',
  '',
  '| 项 | v0.5 | v0.6 | 依据 |',
  '|---|---|---|---|',
  '| 面板宿主 | Edge --app + SetWindowPos | **原生 WPF 无边框窗** `bin/panel-host.ps1` | Edge 自绘工具栏剥不掉、顶出屏幕一拖就露（§5.4） |',
  '| 面板内容载体 | panel/index.html + css + js | **WPF 控件 + panel/ui.json 文案** | 同上；HTML 三件保留但不再使用 |',
  '| 面板定位 | 逻辑像素 + scale | **物理像素直接传，不除 scale** | 实测 WPF 在此机 DIP=物理 1:1 |',
  '',
  '### 14.2 新发现的硬事实（已写进代码注释，别再踩）',
  '',
  '1. **PS 5.1 按 ANSI 解码无 BOM 的 .ps1**：中文注释会吞掉后面一个 ASCII 字符，实测把 `param()` 与 `if ($Frameless) {` 解析崩掉 → **本插件所有 .ps1 必须纯 ASCII**，中文一律外置到 `panel/ui.json` 或 `lib/*.js`。',
  '2. **`$PID` 是只读保留变量**：参数不能叫 `-Pid`（报「无法覆盖变量 Pid」），改 `-ProcessId` + `[Alias(\'Pid\')]`。',
  '3. **PowerShell 大小写不敏感**：参数 `$H` 与循环变量 `$h` 撞车（高度被写成窗口句柄 67142），改用 `$Width`/`$Height` + Alias。',
  '4. **负坐标参数**：`-Y -564` 会被当成参数名，必须写 `-Y:-564`。',
  '5. **Edge 会 re-exec**：spawn 的 pid ≠ 窗口 owner pid（实测 23828 vs 23356），定位/杀进程一律按 `--user-data-dir` 匹配命令行。',
  '6. **Chromium 自绘 app 工具栏**：剥 `WS_CAPTION` 后仍在客户区内，Win32 无解（§5.4）。',
  '7. **跨 DPI 移动要两段式**：单次 SetWindowPos 位置准、尺寸被乘 1.5（Chromium 响应 WM_DPICHANGED），250ms 后补一刀才精确（`moveWindows.dpiSettleMs`）。',
  '8. **`window.__ModuleLoader__` 契约**：手写 client bundle 形状不对会让 **web boot 崩掉整个应用**（`dsh-dual-screen: import failed` + `undefined.endsWith`）。侧栏按钮必须照抄已编译 bundle 的完整契约，且**先在浏览器里跑通再进 profile**。',
  '9. **启动器「禁用第三方插件」会重置 `cordis.patch.yml`**：300 行 → 28 行默认模板，连带 qwen/智谱等 provider 全丢。好配置已存 `E:\\dsh\\backups\\dual-screen\\cordis.patch.yml.good-20261105`。',
  '10. **端口每次重启都变**，面板/侧栏的 URL 必须从 `req.headers.host` 现算，不能写死。',
  '',
  '### 14.3 验收口径调整（P2 拆两半）',
  '',
  '- **P2a 面板窗本体**：无边框 / 定位 / 拖拽 / 不抢焦点。已完成，验收方式 = `bin/panel-host.ps1 -ExitAfterMs N` 自报 `{"panel":"ready","rect":[...]}` + 副屏截图比对。',
  '- **P2b 侧栏按钮**：待做，必须先过浏览器验证再进 profile。',
].join('\n')

t = t.trimEnd() + s14 + '\n'
writeFileSync(p, t, 'utf8')
console.log('PLAN.md v0.6 updated; miss =', miss, '; lines =', t.split('\n').length)