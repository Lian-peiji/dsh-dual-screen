// implement-manual-resize.mjs -- NoResize + custom hook means WE must resize.
//
// The previous attempt relied on the OS modal resize loop, which only runs when the
// window has ResizeMode=CanResize. But CanResize makes WPF claim WM_NCHITTEST
// before our hook, so the drag flag was never set. Chicken and egg.
//
// This version does the resize itself: on WM_LBUTTONDOWN over an edge we capture
// the mouse (SetCapture), then WM_MOUSEMOVE resizes with SetWindowPos, and
// WM_LBUTTONUP saves. No OS loop involved, so no dependency on ResizeMode.
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let s = readFileSync(p, 'utf8')

// Native pieces we still need.
const declAnchor = '  [DllImport("user32.dll")] public static extern bool PtInRect(ref RECTX r, POINT p);'
if (!s.includes(declAnchor)) throw new Error('native decl anchor missing')
const extra = [
  '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);',
  '  [DllImport("user32.dll")] public static extern IntPtr SetCapture(IntPtr h);',
  '  [DllImport("user32.dll")] public static extern bool ReleaseCapture();',
  '  [DllImport("user32.dll")] public static extern short GetKeyState(int key);',
].join('\n')
if (!s.includes('SetWindowPos')) s = s.replace(declAnchor, declAnchor + '\n' + extra)

// Replace everything from the state block to the hook installation with a
// self-driven resize implementation.
const startMark = '# ---- mouse resize: state + the one save() both paths use ----'
const endMark = 'Write-Stage "resize edges enabled"'
const i = s.indexOf(startMark)
const j = s.indexOf(endMark)
if (i < 0 || j < 0) throw new Error('block markers missing')

const block = String.raw`# ---- mouse resize: self-driven (no OS modal loop) ----
# ResizeMode is NoResize, so WPF leaves WM_NCHITTEST alone and we own the whole
# gesture: HITTEST decides the edge, LBUTTONDOWN captures the mouse, MOUSEMOVE
# resizes with SetWindowPos, LBUTTONUP saves.
$script:dragEdge = 0          # 0 = no drag; otherwise HTLEFT/HTRIGHT/HTTOP/...
$script:dragOrigin = $null    # cursor position when the drag started (screen px)
$script:dragFrame = $null     # window rect when the drag started (physical px)
$script:userResized = [bool]$NoFit

function Save-PanelSize {
  if (-not $DataUrl) { return }
  if ($DataUrl -notmatch '^(https?://[^/]+)') { return }
  $base = $Matches[1]
  try {
    $rr = New-Object PNative+RECTX
    $hh = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
    if (-not [PNative]::GetWindowRect($hh, [ref]$rr)) { Write-Stage 'save: GetWindowRect FAILED'; return }
    $wDip = [int][math]::Round(($rr.R - $rr.L) / $scale)
    $hDip = [int][math]::Round(($rr.B - $rr.T) / $scale)
    if ($script:userResized) {
      $body = '{"panel":{"width":' + $wDip + ',"height":' + $hDip + ',"resizedByUser":true}}'
    } else {
      $body = '{"panel":{"width":' + $wDip + '}}'
    }
    $req = [System.Net.HttpWebRequest]::Create($base + '/dsh-dual-screen/config')
    $req.Method = 'POST'
    $req.Proxy = $null
    $req.Timeout = 4000
    $req.ContentType = 'application/json; charset=utf-8'
    $bytes = [Text.Encoding]::UTF8.GetBytes($body)
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    $req.GetResponse().Close()
    Write-Stage ('size saved ' + $body)
  } catch {
    Write-Stage 'size save failed'
  }
}

$script:hitHook = {
  param($hh, $msg, $wParam, $lParam, [ref]$handled)

  # ---- start a drag: remember where we are, then capture the mouse ----
  if ($msg -eq 0x0201) {                       # WM_LBUTTONDOWN
    if ($script:dragEdge -eq 0) { return [IntPtr]::Zero }
    $pt = New-Object PNative+POINT
    $pt.x = $lParam.ToInt32() -band 0xFFFF
    $pt.y = ($lParam.ToInt32() -shr 16) -band 0xFFFF
    if ($pt.x -gt 32767) { $pt.x = $pt.x - 65536 }
    if ($pt.y -gt 32767) { $pt.y = $pt.y - 65536 }
    $script:dragOrigin = @($pt.x, $pt.y)
    $fr = New-Object PNative+RECTX
    [void][PNative]::GetWindowRect($hh, [ref]$fr)
    $script:dragFrame = @($fr.L, $fr.T, $fr.R, $fr.B)
    [void][PNative]::SetCapture($hh)
    Write-Stage ('drag start edge=' + $script:dragEdge)
    $handled.Value = $true
    return [IntPtr]::Zero
  }

  # ---- drag: move the edges that were grabbed ----
  if ($msg -eq 0x0200) {                       # WM_MOUSEMOVE
    if ($script:dragEdge -eq 0 -or $null -eq $script:dragOrigin) { return [IntPtr]::Zero }
    $pt = New-Object PNative+POINT
    $pt.x = $lParam.ToInt32() -band 0xFFFF
    $pt.y = ($lParam.ToInt32() -shr 16) -band 0xFFFF
    if ($pt.x -gt 32767) { $pt.x = $pt.x - 65536 }
    if ($pt.y -gt 32767) { $pt.y = $pt.y - 65536 }
    $dx = $pt.x - $script:dragOrigin[0]
    $dy = $pt.y - $script:dragOrigin[1]
    $nl = $script:dragFrame[0]; $nt = $script:dragFrame[1]
    $nr = $script:dragFrame[2]; $nb = $script:dragFrame[3]
    $edge = $script:dragEdge
    # 10=left 11=right 12=top 15=bottom 13=TL 14=TR 16=BL 17=BR
    if ($edge -eq 10 -or $edge -eq 13 -or $edge -eq 16) { $nl = $nl + $dx }
    if ($edge -eq 11 -or $edge -eq 14 -or $edge -eq 17) { $nr = $nr + $dx }
    if ($edge -eq 12 -or $edge -eq 13 -or $edge -eq 14) { $nt = $nt + $dy }
    if ($edge -eq 15 -or $edge -eq 16 -or $edge -eq 17) { $nb = $nb + $dy }
    $minW = [int](320 * $scale); $minH = [int](300 * $scale)
    if (($nr - $nl) -lt $minW) {
      if ($edge -eq 10 -or $edge -eq 13 -or $edge -eq 16) { $nl = $nr - $minW } else { $nr = $nl + $minW }
    }
    if (($nb - $nt) -lt $minH) {
      if ($edge -eq 12 -or $edge -eq 13 -or $edge -eq 14) { $nt = $nb - $minH } else { $nb = $nt + $minH }
    }
    # SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10): stay topmost and never grab focus
    [void][PNative]::SetWindowPos($hh, [IntPtr]::Zero, $nl, $nt, ($nr - $nl), ($nb - $nt), 0x0014)
    $handled.Value = $true
    return [IntPtr]::Zero
  }

  # ---- drop: keep the size, release capture ----
  if ($msg -eq 0x0202) {                       # WM_LBUTTONUP
    if ($script:dragEdge -eq 0) { return [IntPtr]::Zero }
    [void][PNative]::ReleaseCapture()
    $wasVertical = ($script:dragEdge -eq 12 -or $script:dragEdge -eq 15 -or $script:dragEdge -eq 13 -or $script:dragEdge -eq 14 -or $script:dragEdge -eq 16 -or $script:dragEdge -eq 17)
    if ($wasVertical) { $script:userResized = $true }
    $script:dragEdge = 0
    $script:dragOrigin = $null
    $script:dragFrame = $null
    Save-PanelSize
    $handled.Value = $true
    return [IntPtr]::Zero
  }

  # ---- which edge is under the cursor ----
  if ($msg -ne 0x0084) { return [IntPtr]::Zero }        # WM_NCHITTEST
  if ($ExitAfterMs -gt 0) { return [IntPtr]::Zero }
  if ($script:dragEdge -ne 0) { $handled.Value = $true; return [IntPtr]$script:dragEdge }

  $band = [int]([math]::Round(7 * $scale))
  $pt = New-Object PNative+POINT
  $pt.x = $lParam.ToInt32() -band 0xFFFF
  $pt.y = ($lParam.ToInt32() -shr 16) -band 0xFFFF
  if ($pt.x -gt 32767) { $pt.x = $pt.x - 65536 }
  if ($pt.y -gt 32767) { $pt.y = $pt.y - 65536 }
  if (-not [PNative]::ScreenToClient($hh, [ref]$pt)) { return [IntPtr]::Zero }
  $c = New-Object PNative+RECTX
  if (-not [PNative]::GetClientRect($hh, [ref]$c)) { return [IntPtr]::Zero }

  $onL = ($pt.x -ge $c.L) -and ($pt.x -lt ($c.L + $band))
  $onR = ($pt.x -le $c.R) -and ($pt.x -gt ($c.R - $band))
  $onT = ($pt.y -ge $c.T) -and ($pt.y -lt ($c.T + $band))
  $onB = ($pt.y -le $c.B) -and ($pt.y -gt ($c.B - $band))

  $code = 0
  if ($onT -and $onL) { $code = 13 } elseif ($onT -and $onR) { $code = 14 }
  elseif ($onB -and $onL) { $code = 16 } elseif ($onB -and $onR) { $code = 17 }
  elseif ($onL) { $code = 10 } elseif ($onR) { $code = 11 }
  elseif ($onT) { $code = 12 } elseif ($onB) { $code = 15 }
  if ($code -eq 0) { $script:dragEdge = 0; return [IntPtr]::Zero }
  $script:dragEdge = $code
  $handled.Value = $true
  return [IntPtr]$code
}

$win.Add_SourceInitialized({
  try {
    $hh2 = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
    $src = [System.Windows.Interop.HwndSource]::FromHwnd($hh2)
    if ($src) { [void]$src.AddHook($script:hitHook) }
  } catch { Write-Stage 'hit-test hook failed' }
})
Write-Stage "resize edges enabled"`

s = s.slice(0, i) + block + s.slice(j + endMark.length)
writeFileSync(p, s, 'utf8')
console.log('manual resize installed, len', s.length)