# probe/p5-wt3.ps1 -- verify wt --pos determinism: two launches, new window each time,
# both on the secondary. Prints captured stderr so a bad flag is visible. ASCII only.
$ErrorActionPreference = 'Continue'
$wt = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\wt.exe'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Wt3 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  public static List<string> Rows = new List<string>();
  static bool Cb(IntPtr h, IntPtr p) {
    if (!IsWindowVisible(h)) return true;
    var cls = new StringBuilder(256); GetClassNameW(h, cls, 256);
    if (cls.ToString() != "CASCADIA_HOSTING_WINDOW_CLASS") return true;
    RECT r; GetWindowRect(h, out r);
    Rows.Add(r.L + "," + r.T + " " + (r.R-r.L) + "x" + (r.B-r.T));
    return true;
  }
  public static List<string> All() { Rows.Clear(); EnumWindows(new EnumProc(Cb), IntPtr.Zero); return new List<string>(Rows); }
}
'@
'BEFORE: ' + ([Wt3]::All() -join ' ; ')
$log = Join-Path $env:TEMP 'p5-wt3.log'
foreach ($mode in @('-w','new')) {
  $args = @('-w','new','--pos','2584,-564','cmd.exe','/c','ping -n 6 127.0.0.1')
  if ($mode -eq 'new') { $args = @('--pos','2584,-564','cmd.exe','/c','ping -n 6 127.0.0.1') }
  $p = Start-Process -FilePath $wt -ArgumentList $args -PassThru -RedirectStandardError $log
  Start-Sleep -Milliseconds 2500
  'launch [' + ($args -join ' ') + '] pid ' + $p.Id + ' exited=' + $p.HasExited + ' err=' + ((Get-Content $log -Raw -EA 0) -replace "`r?`n",' ')
  'AFTER : ' + ([Wt3]::All() -join ' ; ')
}
