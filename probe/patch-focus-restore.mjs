// patch-focus-restore.mjs —— 投送不许抢焦点：CREATE 时记住「原来的前台窗口」，
// SHOW 后若新窗口当了前台，就用 AttachThreadInput 把焦点还给原来那个。
// 背景：2026-11-06 主人正在打字，投送一个控制台就把输入焦点抢走了，得重新点回输入框。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const P = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/window-bridge.ps1'
let s = readFileSync(P, 'utf8')

if (!s.includes('public static bool RestoreFocus')) {
  s = s.replace(
    `  public static IntPtr Foreground() { return GetForegroundWindow(); }`,
    `  public static IntPtr Foreground() { return GetForegroundWindow(); }
  // Foreground lock makes a plain SetForegroundWindow fail from a background
  // process, so share the input state with the current foreground thread first.
  public static bool RestoreFocus(IntPtr target) {
    if (target == IntPtr.Zero) return false;
    IntPtr fg = GetForegroundWindow();
    if (fg == target) return true;
    uint fgPid = 0;
    uint fgTid = GetWindowThreadProcessId(fg, out fgPid);
    uint curTid = GetCurrentThreadId();
    bool attached = false;
    try {
      if (fgTid != 0 && fgTid != curTid) { attached = AttachThreadInput(fgTid, curTid, true); }
      return SetForegroundWindow(target);
    } catch { return false; } finally {
      if (attached) { try { AttachThreadInput(fgTid, curTid, false); } catch {} }
    }
  }`
  )
}

if (!s.includes('SetForegroundWindow(IntPtr h)')) {
  s = s.replace(
    `  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();`,
    `  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();`
  )
}

// CREATE 时记下当时的前台窗口（那时新窗口还没抢）
if (!s.includes('$script:prevFg')) {
  s = s.replace(
    '$script:stealth = @{}',
    '$script:stealth = @{}\n# 投送前的前台窗口：hwnd 字符串 -> hwnd。用来在窗口抢走焦点后还回去。\n$script:prevFg = @{}'
  )
  s = s.replace(
    `    [WBridge]::Cloak($hwnd, $true)`,
    `    if (-not $script:prevFg.ContainsKey(('0x{0:X}' -f $hwnd.ToInt64()))) {
      $script:prevFg[('0x{0:X}' -f $hwnd.ToInt64())] = [WBridge]::Foreground()
    }
    [WBridge]::Cloak($hwnd, $true)`
  )
}

// SHOW 之后：若前台被新窗口抢了，还给原来那个
if (!s.includes('restore-focus')) {
  s = s.replace(
    `  if ($res.ok) { [void]$script:moved.Add($key) } else { [void]$script:moved.Add($key) }  # never retry-loop`,
    `  if ($res.ok) { [void]$script:moved.Add($key) } else { [void]$script:moved.Add($key) }  # never retry-loop
  # restore-focus: give the keyboard back to whatever the owner was typing in
  $restored = $false
  try {
    $prev = $script:prevFg[$key]
    if ($prev -and $prev -ne [IntPtr]::Zero -and ([WBridge]::Foreground() -eq $hwnd)) {
      $restored = [WBridge]::RestoreFocus([IntPtr]$prev)
      if ($restored) { Write-StageFg ('focus restored to prev hwnd for ' + $key) }
    }
    $script:prevFg.Remove($key)
  } catch { }`
  )
  s = s.replace(
    `    focus = @{
      kept = ($fgBpid -eq $fgApid)`,
    `    focusRestored = [bool]$restored
    focus = @{
      kept = ($fgBpid -eq $fgApid)`
  )
}

writeFileSync(P, s, 'utf8')
const ok = ['public static bool RestoreFocus', 'SetForegroundWindow(IntPtr h)', '$script:prevFg', 'restore-focus', 'focusRestored'].every((k) => s.includes(k))
console.log('patched focus-restore:', ok, '| ascii:', !/[^\x00-\x7F]/.test(s))
if (ok) for (const d of ['E:/dsh/profiles/desktop/local-plugins/dsh-dual-screen', 'E:/dsh/profiles/desktop/node_modules/dsh-dual-screen']) copyFileSync(P, `${d}/bin/window-bridge.ps1`)