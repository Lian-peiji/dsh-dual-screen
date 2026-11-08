// rewrite-resize.mjs -- replace the whole mouse-resize block with one coherent version.
//
// What the patched-together version got wrong (all measured 2026-11-06):
//   1. `userResized` was never set anymore, so Fit-Height kept forcing the height
//      back to 480 every 2s and the user's drag lost after ~2 seconds.
//   2. `saveHeight` was never set (the hit-test wrote `vResize` instead), so a
//      vertical drag saved width only.
//   3. The save POST ran from WM_EXITSIZEMOVE using ActualWidth/Height, which is
//      DIP while `$scale` handling elsewhere assumed physical - it saved 418x320
//      for a window that was really 400x900 DIP.
//
// The new block keeps ONE source of truth:
//   $script:dragAxis  = '' | 'h' | 'v'   set by the hit-test that armed the drag
//   $script:userResized = true once the owner dragged a vertical edge
//   save() reads GetWindowRect (physical) and divides by $scale -> DIP
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/bin/panel-host.ps1'
let s = readFileSync(p, 'utf8')

const startMark = "$win.ResizeMode = 'CanResize'"
const endMark = 'Write-Stage "resize edges enabled"'
const i = s.indexOf(startMark)
const j = s.indexOf(endMark)
if (i < 0 || j < 0 || j < i) throw new Error('block markers not found')
const endOfBlock = j + endMark.length

const block = String.raw`$win.ResizeMode = 'CanResize'
$win.MinWidth = [double]([math]::Round(320 * $scale))
$win.MinHeight = [double]([math]::Round(300 * $scale))

# ---- mouse resize: state + the one save() both paths use ----
# $script:dragAxis   '' | 'h' | 'v'  -- which kind of edge the current drag grabbed
# $script:userResized                -- owner picked a height; Fit-Height must stop
$script:dragAxis = ''
$script:userResized = [bool]$NoFit

function Save-PanelSize {
  $script:dragAxis = ''
  if (-not $DataUrl) { return }
  if ($DataUrl -notmatch '^(https?://[^/]+)') { return }
  $base = $Matches[1]
  try {
    # Physical pixels straight from Win32, converted to DIP for the config file.
    # ActualWidth/Height are DIP and were the source of the 418x320 nonsense.
    $rr = New-Object PNative+RECTX
    $hh = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
    if (-not [PNative]::GetWindowRect($hh, [ref]$rr)) { return }
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

$script:sizeTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:sizeTimer.Interval = [TimeSpan]::FromMilliseconds(800)
$script:sizeTimer.Add_Tick({ $script:sizeTimer.Stop(); Save-PanelSize })

$win.Add_SizeChanged({
  # Fit-Height also changes the height; only a drag re-arms the save timer.
  if ($script:dragAxis -ne '') {
    $script:sizeTimer.Stop()
    $script:sizeTimer.Start()
  }
})

$script:hitHook = {
  param($hwnd, $msg, $wParam, $lParam, [ref]$handled)

  # WM_ENTERSIZEMOVE: a drag really started. Do not touch dragAxis here - it was
  # decided by the WM_NCHITTEST that armed this drag (ENTER fires after it).
  if ($msg -eq 0x0231) { return [IntPtr]::Zero }

  # WM_EXITSIZEMOVE: the drag ended. Save unconditionally - the DispatcherTimer
  # tick is unreliable inside the OS modal resize loop (that is why vertical
  # drags used to vanish).
  if ($msg -eq 0x0232) {
    if ($script:dragAxis -ne '') { $script:sizeTimer.Stop(); Save-PanelSize }
    return [IntPtr]::Zero
  }

  if ($msg -ne 0x0084) { return [IntPtr]::Zero }        # WM_NCHITTEST only
  if ($ExitAfterMs -gt 0) { return [IntPtr]::Zero }

  $band = [int]([math]::Round(7 * $scale))
  # lParam carries SCREEN coordinates; this process is per-monitor DPI aware, so
  # comparing them against GetWindowRect silently missed on the 150% monitor.
  # Convert to CLIENT space - ScreenToClient and GetClientRect always agree.
  $pt = New-Object PNative+POINT
  $pt.x = $lParam.ToInt32() -band 0xFFFF
  $pt.y = ($lParam.ToInt32() -shr 16) -band 0xFFFF
  if ($pt.x -gt 32767) { $pt.x = $pt.x - 65536 }
  if ($pt.y -gt 32767) { $pt.y = $pt.y - 65536 }
  if (-not [PNative]::ScreenToClient($hwnd, [ref]$pt)) { return [IntPtr]::Zero }
  $c = New-Object PNative+RECTX
  if (-not [PNative]::GetClientRect($hwnd, [ref]$c)) { return [IntPtr]::Zero }

  $onL = ($pt.x -ge $c.L) -and ($pt.x -lt ($c.L + $band))
  $onR = ($pt.x -le $c.R) -and ($pt.x -gt ($c.R - $band))
  $onT = ($pt.y -ge $c.T) -and ($pt.y -lt ($c.T + $band))
  $onB = ($pt.y -le $c.B) -and ($pt.y -gt ($c.B - $band))

  $code = 0
  if ($onT -and $onL) { $code = 13 } elseif ($onT -and $onR) { $code = 14 }
  elseif ($onB -and $onL) { $code = 16 } elseif ($onB -and $onR) { $code = 17 }
  elseif ($onL) { $code = 10 } elseif ($onR) { $code = 11 }
  elseif ($onT) { $code = 12 } elseif ($onB) { $code = 15 }
  if ($code -eq 0) { return [IntPtr]::Zero }

  # Pure left/right edges only change width; anything touching top/bottom is a
  # height decision by the owner -> freeze auto-fit.
  if ($code -eq 10 -or $code -eq 11) {
    $script:dragAxis = 'h'
  } else {
    $script:dragAxis = 'v'
    $script:userResized = $true
  }
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

s = s.slice(0, i) + block + s.slice(endOfBlock)
writeFileSync(p, s, 'utf8')
console.log('block replaced, length', (s.length))