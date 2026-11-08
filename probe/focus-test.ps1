# focus-test.ps1 -- spawn an attributable console and report WHO owns the foreground
# at 250ms / 1200ms. Expect: DSH keeps it (delivery must not steal focus).
$ErrorActionPreference = 'Continue'
$p = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\conhost.exe') -ArgumentList @('cmd.exe','/k','title ds-focus') -PassThru
Start-Sleep -Milliseconds 250
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
function Show-FG([string]$tag) {
  $h = [FG]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 256
  [void][FG]::GetWindowTextW($h, $sb, 256)
  $procId = 0; [void][FG]::GetWindowThreadProcessId($h, [ref]$procId)
  $pname = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
  '{0}: fg="{1}" proc={2} pid={3}' -f $tag, $sb.ToString(), $pname, $procId
}
Show-FG 't250'
Start-Sleep -Milliseconds 950
Show-FG 't1200'
'target pid ' + $p.Id
Start-Sleep -Seconds 3
