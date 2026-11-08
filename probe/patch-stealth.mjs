// patch-stealth.mjs —— 让投送真正「无感」：CREATE 阶段先 DWM 披风（遮住不画）+ 禁止激活，
// 位置挪好后再揭开；1.5 秒后恢复正常（这样主人之后还能点进窗口打字）。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const P = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/window-bridge.ps1'
let s = readFileSync(P, 'utf8')

// ---- 1) C# 里加 DWM 披风 / 扩展样式 ----
if (!s.includes('DwmSetWindowAttribute')) {
  s = s.replace(
    '  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);',
    `  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int val, int size);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);`)
}

if (!s.includes('public static void Cloak')) {
  s = s.replace(
    '  public static int Cloaked(IntPtr h) {',
    `  // DWMWA_CLOAK (13): the window stops being composited while remaining a
  // normal window -- no ShowWindow games, so a window that was going to stay
  // hidden stays hidden and never flashes on the primary.
  public static void Cloak(IntPtr h, bool on) { int v = on ? 1 : 0; try { DwmSetWindowAttribute(h, 13, ref v, 4); } catch {} }
  // WS_EX_NOACTIVATE: the new window must never take the keyboard away from the
  // owner's DSH window. Cleared later so the console can still be typed into.
  public static void NoActivate(IntPtr h, bool on) {
    int ex = GetWindowLong(h, -20);
    if (on) ex |= 0x08000000; else ex &= ~0x08000000;
    SetWindowLong(h, -20, ex);
  }
  public static int Cloaked(IntPtr h) {`)
}

// ---- 2) Pre-MoveWindow：先披风，再挪位置，再禁激活 ----
if (!s.includes('$script:stealth')) {
  s = s.replace(
    `    $tx = $wr.x + $margin
    $ty = $wr.y + $margin
    [void][WBridge]::MovePos($hwnd, $tx, $ty)`,
    `    $tx = $wr.x + $margin
    $ty = $wr.y + $margin
    $key = ('0x{0:X}' -f $hwnd.ToInt64())
    # 先遮住（此刻还没画过），再挪到副屏，再禁止激活 —— 顺序不能换
    [WBridge]::Cloak($hwnd, $true)
    [void][WBridge]::MovePos($hwnd, $tx, $ty)
    [WBridge]::NoActivate($hwnd, $true)
    $script:stealth[$key] = @{ at = [WBridge]::NowMs(); hwnd = $hwnd }`
  )
}

// ---- 3) setup 里初始化表 ----
if (!s.includes('$script:stealth =')) {
  s = s.replace(
    '$script:preMoved = New-Object System.Collections.Generic.HashSet[string]',
    `$script:preMoved = New-Object System.Collections.Generic.HashSet[string]
# 披风中的窗口：key -> { at, hwnd }。180ms 后揭开（位置已对），1.5s 后允许激活。
$script:stealth = @{}`
  )
}

// ---- 4) 主循环里到期揭开 ----
if (!s.includes('function Settle-Stealth')) {
  s = s.replace(
    '# ------------------------------------------------------------ main loop -----',
    `# ------------------------------------------------ cloak settle (stealth) -----
# 列表很小（每次投送一个），直接遍历；到点揭开，超时恢复正常激活。
function Settle-Stealth {
  if ($script:stealth.Count -eq 0) { return }
  $now = [WBridge]::NowMs()
  foreach ($k in @($script:stealth.Keys)) {
    $e = $script:stealth[$k]
    if ($null -eq $e) { $script:stealth.Remove($k); continue }
    $age = $now - [double]$e.at
    if ($age -ge 180) {
      [WBridge]::Cloak($e.hwnd, $false)
      if ($age -ge 1500) {
        [WBridge]::NoActivate($e.hwnd, $false)
        $script:stealth.Remove($k)
      }
    }
  }
}

# ------------------------------------------------------------ main loop -----`
  )
}

if (!s.includes('Settle-Stealth\n')) {
  s = s.replace(
    `    while ($true) {
      $rawn = 0L
      if (-not [WBridge]::Hits.TryDequeue([ref]$rawn)) { break }`,
    `    Settle-Stealth
    while ($true) {
      $rawn = 0L
      if (-not [WBridge]::Hits.TryDequeue([ref]$rawn)) { break }`
  )
}

writeFileSync(P, s, 'utf8')
console.log('patched stealth:', ['DwmSetWindowAttribute', 'Cloak(', 'NoActivate(', '$script:stealth =', 'function Settle-Stealth', 'Settle-Stealth'].every((k) => s.includes(k)))
for (const d of ['E:/dsh/profiles/desktop/local-plugins/dsh-dual-screen', 'E:/dsh/profiles/desktop/node_modules/dsh-dual-screen']) {
  copyFileSync(P, `${d}/bin/window-bridge.ps1`)
}
console.log('synced to 2 deployed copies')