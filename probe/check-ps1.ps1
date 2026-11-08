# check-ps1.ps1 -- parse-only syntax check for a PowerShell file (ASCII only).
# Pass -Path explicitly: a CJK default here would be read as ANSI by PS 5.1.
param([string]$Path)
if (-not $Path) { Write-Output 'usage: check-ps1.ps1 -Path <file.ps1>'; exit 2 }
$errors = $null
$tokens = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
if ($errors -and $errors.Count -gt 0) {
  foreach ($e in $errors) { Write-Output ('ERROR line ' + $e.Extent.StartLineNumber + ': ' + $e.Message) }
  exit 1
}
Write-Output ('parse ok: ' + $Path)
exit 0