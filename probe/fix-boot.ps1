# fix-boot.ps1 -- 紧急修复：让 DSH 能带第三方插件启动
#
# 1) 从 dsh-dual-screen/package.json 摘掉 client bundle 声明
#    （crash log 证死因：web boot 阶段 dsh-dual-screen: import failed，
#     renderer 报 dsh-client-modules 里 undefined.endsWith）
# 2) 把 profile 的 dsh.profile.bundles 从备份恢复（主人按「禁用第三方插件」
#    启动时被打包成只剩官方两个 bundle）
#
# 一律 UTF-8 无 BOM 读写（pnpm 对 BOM 敏感）。
$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding($false)

function Read-Json([string]$p) {
  return [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) | ConvertFrom-Json
}
function Write-Json([string]$p, $obj) {
  [IO.File]::WriteAllText($p, ($obj | ConvertTo-Json -Depth 20), $utf8)
}

$srcPkg = 'J:\大肥鱼游乐场\dsh-dual-screen\package.json'
$copies = @(
  'E:\dsh\profiles\desktop\local-plugins\dsh-dual-screen\package.json',
  'E:\dsh\profiles\desktop\node_modules\dsh-dual-screen\package.json'
)

# ---- 1. 摘掉 client 声明 ----
foreach ($p in @($srcPkg) + $copies) {
  if (-not (Test-Path -LiteralPath $p)) { Write-Output "skip (missing): $p"; continue }
  $j = Read-Json $p
  $removed = @()
  if ($j.exports -and $j.exports.PSObject.Properties['./client']) {
    $j.exports.PSObject.Properties.Remove('./client'); $removed += 'exports["./client"]'
  }
  if ($j.dsh -and $j.dsh.PSObject.Properties['client']) {
    $j.dsh.PSObject.Properties.Remove('client'); $removed += 'dsh.client'
  }
  Write-Json $p $j
  Write-Output ("plugin pkg cleaned: " + $p + "  removed=" + ($removed -join '|'))
}

# ---- 2. 恢复 profile bundles ----
$profPkg = 'E:\dsh\profiles\desktop\package.json'
$backup = 'E:\dsh\profiles\desktop\package.json.bak-dual-screen-20261105-223322'
if (-not (Test-Path -LiteralPath $backup)) { throw "backup missing: $backup" }
$cur = Read-Json $profPkg
$bak = Read-Json $backup
$wanted = @($bak.dsh.profile.bundles)
$hasDual = $wanted -contains 'dsh-dual-screen'
if (-not $hasDual) { $wanted += 'dsh-dual-screen' }
$cur.dsh.profile.bundles = $wanted
Write-Json $profPkg $cur
Write-Output ("profile bundles restored: " + $wanted.Count + " entries, has dsh-dual-screen=" + ($wanted -contains 'dsh-dual-screen'))

# ---- 3. 自检：JSON 能回读、关键字段在 ----
$check = Read-Json $profPkg
$plug = Read-Json $srcPkg
Write-Output ("check profile: bundles=" + $check.dsh.profile.bundles.Count + " deps=" + ($check.dependencies.PSObject.Properties.Name).Count)
Write-Output ("check plugin: type=" + $plug.type + " clientDecl=" + [bool]($plug.dsh.PSObject.Properties['client']) + " exportsClient=" + [bool]($plug.exports.PSObject.Properties['./client']))
Write-Output 'OK'