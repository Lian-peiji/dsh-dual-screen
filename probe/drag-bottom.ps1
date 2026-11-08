# drag-bottom.ps1 - ASCII-only. Real mouse drag on panel bottom edge.
Add-Type @"
using System; using System.Runtime.InteropServices;
public class DR { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint w,int dx,int dy,uint d,IntPtr e); }"@
$ready=Get-Content 'E:\dsh\dual-screen\panel-ready.json'|ConvertFrom-Json
if(-not $ready.rect){ Write-Output 'fail: no rect'; exit 1}
$rL=$ready.rect[0];$rT=$ready.rect[1];$rW=$ready.rect[2];$rH=$ready.rect[3];$rB=$rT+$rH
$midX=[int]($rL+$rW/2);$yEdge=$rB-3;$Dy=80;$steps=10
$LDown=0x0002;$LeftUp=0x0004
[DR]::SetCursorPos($midX,$yEdge);Start-Sleep -Milliseconds 600
[DR]::mouse_event($LDown,0,0,0,[IntPtr]::Zero);Start-Sleep -Milliseconds 500
for($i=1;$i-le $steps;$i++){ [DR]::SetCursorPos($midX,$yEdge+[int]($Dy*$i/$steps));Start-Sleep -Milliseconds 90}
Start-Sleep -Milliseconds 500;[DR]::mouse_event($LeftUp,0,0,0,[IntPtr]::Zero)
Write-Output "dragged ($midX,$yEdge)+($Dy)"