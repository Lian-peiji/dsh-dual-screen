// patch-focus-cleanup.mjs —— 收尾：把上次半途而废的「焦点归还」代码整段摘干净（它缺 P/Invoke
// 声明、会把 Add-Type 编译搞挂），换成更彻底的两条：
//   ① 启动侧（run-on-secondary）：窗口出生就在副屏 → 根本不抢主屏焦点（A 方案）
//   ② 投送侧（minimizeAfterMove）：搬过去之后按配置最小化（E 方案）
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const P = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/window-bridge.ps1'
let s = readFileSync(P, 'utf8')
const before = s.length

// 1) 删掉 RestoreFocus 方法块（从注释开始到它的结束大括号）
s = s.replace(/\n  \/\/ Foreground lock makes a plain SetForegroundWindow fail[\s\S]*?\n  \}\n(?=\s*public static string Text)/, '\n')
// 2) 删掉 prevFg 相关（初始化、CREATE 时记录、SHOW 后归还、事件字段）
s = s.replace(/\n# 投送前的前台窗口[\s\S]*?\n\$script:prevFg = @\{\}/, '')
s = s.replace(/      if \(-not \$script:prevFg\.ContainsKey\([^\)]*\)\) \{\n[\s\S]*?\n      \}\n/, '')
s = s.replace(/\n  # restore-focus: give the keyboard back[\s\S]*?\n  \} catch \{ \}\n/, '\n')
s = s.replace(/\n    focusRestored = \[bool\]\$restored\n/, '\n')
// 3) 若还残留 CJK 注释，统一换成 ASCII
s = s.replace(/^# 投送前的前台窗口.*$/m, '# (removed) previous-foreground tracking')

// 4) E：搬完按配置最小化（默认开 —— 主人 2026-11-06 要 E）
if (!s.includes('minimizeAfterMove')) {
  s = s.replace(
    '    dpiSettleMs   = $DpiSettleMs',
    `    dpiSettleMs   = $DpiSettleMs
    # E mode: after delivering, keep the window minimised on the second screen so
    # it neither covers the panel nor takes the owner's attention. 0 = disabled.
    minimizeAfterMove = $true`
  )
  s = s.replace(
    "      if ($null -ne $cfg.moveWindows.reserveRightPx) { $d.reserveRightPx = [int]$cfg.moveWindows.reserveRightPx }",
    `      if ($null -ne $cfg.moveWindows.reserveRightPx) { $d.reserveRightPx = [int]$cfg.moveWindows.reserveRightPx }
      if ($null -ne $cfg.moveWindows.minimizeAfterMove) { $d.minimizeAfterMove = [bool]$cfg.moveWindows.minimizeAfterMove }`
  )
  // 移动成功后再最小化（放在 Invoke-Move 的 return 之前）
  s = s.replace(
    `  return [pscustomobject]@{
    ok = ($ok1 -or $ok2) -and $exact`,
    `  if ($script:cfg.minimizeAfterMove -and -not [WBridge]::IsMinimized($hwnd)) {
    # SW_MINIMIZE (6): it stays on the second screen, so restoring it later
    # puts it right there -- and it never covers the panel.
    [void][WBridge]::ShowWindow($hwnd, 6)
  }
  return [pscustomobject]@{
    ok = ($ok1 -or $ok2) -and $exact`
  )
  s = s.replace(
    '  public static bool IsZoomed(IntPtr h);',
    '  public static bool IsZoomed(IntPtr h);'
  )
  s = s.replace(
    '  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);',
    `  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);`
  )
  s = s.replace(
    '  public static bool Move(IntPtr h, int x, int y, int cx, int cy) {',
    `  public static bool IsMinimized(IntPtr h) { return IsIconic(h); }
  public static bool Move(IntPtr h, int x, int y, int cx, int cy) {`
  )
}

writeFileSync(P, s, 'utf8')
const ok = !s.includes('RestoreFocus') && !s.includes('prevFg') && s.includes('minimizeAfterMove') && !/[^\x00-\x7F]/.test(s)
console.log('cleanup ok:', ok, '| ascii:', !/[^\x00-\x7F]/.test(s), '| size', before, '->', s.length)
if (ok) for (const d of ['E:/dsh/profiles/desktop/local-plugins/dsh-dual-screen', 'E:/dsh/profiles/desktop/node_modules/dsh-dual-screen']) copyFileSync(P, `${d}/bin/window-bridge.ps1`)
console.log(ok ? 'synced' : 'NOT synced (source still dirty)')