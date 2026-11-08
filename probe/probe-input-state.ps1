# probe-input-state.ps1 -- can this process inject real mouse input, and on which desktop?
#
# Why this exists (2026-11-06): SetCursorPos returned False for EVERY coordinate, so
# probe-menu-title.ps1's "right-click" never physically happened. Before blaming the
# pet page, prove whether the harness can move the cursor at all.
# ASCII only.
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WSP {
  [DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(int tid);
  [DllImport("user32.dll")] public static extern bool GetUserObjectInformationW(IntPtr h, int idx, StringBuilder buf, int len, out int need);
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint f, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
  [DllImport("kernel32.dll")] public static extern int GetLastError();
  [DllImport("kernel32.dll")] public static extern int GetCurrentProcessId();
  [DllImport("kernel32.dll")] public static extern int GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("kernel32.dll")] public static extern bool ProcessIdToSessionId(int pid, out int s);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }
}
"@
# Not DPI aware on purpose: we want to know whether the *raw* call works.
function NameOf($h) {
  $sb = New-Object System.Text.StringBuilder 256
  $need = 0
  [void][WSP]::GetUserObjectInformationW($h, 2, $sb, 256, [ref]$need)
  return $sb.ToString()
}

Write-Output ("pid: " + [WSP]::GetCurrentProcessId())
$sid = 0
[void][WSP]::ProcessIdToSessionId([WSP]::GetCurrentProcessId(), [ref]$sid)
Write-Output ("session id: " + $sid)
Write-Output ("window station: " + (NameOf ([WSP]::GetProcessWindowStation())))
Write-Output ("thread desktop: " + (NameOf ([WSP]::GetThreadDesktop([WSP]::GetCurrentThreadId()))))

$inp = [WSP]::OpenInputDesktop(0, $false, 0x0001)
Write-Output ("OpenInputDesktop handle: " + $inp + " (0 = cannot open)")
if ($inp -ne [IntPtr]::Zero) {
  Write-Output ("input desktop name: " + (NameOf $inp))
  [void][WSP]::CloseDesktop($inp)
}

$p = New-Object WSP+POINT
[void][WSP]::GetCursorPos([ref]$p)
Write-Output ("cursor: " + $p.X + "," + $p.Y)

$okMove = [WSP]::SetCursorPos(400, 400)
$err = [WSP]::GetLastError()
Write-Output ("SetCursorPos(400,400) -> " + $okMove + " lastError=" + $err)

[void][WSP]::SetCursorPos(1, 1)
Start-Sleep -Milliseconds 100
$p2 = New-Object WSP+POINT
[void][WSP]::GetCursorPos([ref]$p2)
Write-Output ("cursor after: " + $p2.X + "," + $p2.Y)

# SendInput as the alternative injection path.
$arr = New-Object 'WSP+INPUT[]' 1
$arr[0].type = 0
$arr[0].mi.dx = 10
$arr[0].mi.dy = 10
$arr[0].mi.dwFlags = 0x0001
$sent = [WSP]::SendInput(1, $arr, [System.Runtime.InteropServices.Marshal]::SizeOf($arr[0]))
Write-Output ("SendInput sent=" + $sent + " lastError=" + [WSP]::GetLastError())

$fg = [WSP]::GetForegroundWindow()
$cls = New-Object System.Text.StringBuilder 256
[void][WSP]::GetClassNameW($fg, $cls, 256)
Write-Output ("foreground hwnd: 0x" + ([int64]$fg).ToString('X') + " class=" + $cls.ToString())