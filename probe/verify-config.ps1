# verify-config.ps1 -- 检查 restart-guard 的可自定义设置能否被读到
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$dir = 'E:\dsh\profiles\desktop\node_modules\dsh-restart-guard'
. (Join-Path $dir 'scripts\restart-lib.ps1')
Initialize-RgEnv -StateDir 'E:\dsh\restart-guard'
$s = Get-RgSettings -StateDir 'E:\dsh\restart-guard'
'effective settings: ' + ($s | ConvertTo-Json -Compress)
'auth doc exists    : ' + (Test-Path -LiteralPath (Join-Path $dir 'AUTH.md'))
'config file exists : ' + (Test-Path -LiteralPath 'E:\dsh\restart-guard\config.json')
'quiet window (sec) : ' + [double]$s.quietSec