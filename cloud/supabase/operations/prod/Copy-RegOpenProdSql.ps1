param(
  [ValidateRange(1,10)][int]$Step = 1,
  [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$Manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'reg_open_prod_release_manifest.json') -Raw -Encoding utf8 | ConvertFrom-Json
if ($Manifest.project -cne 'ppowxoglqspwvsgyxlft' -or $Manifest.steps.Count -ne 10) { throw 'Manifest unexpected. STOP.' }
$Prefix = $Root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$Selected = $null
foreach ($Entry in $Manifest.steps) {
  $Path = [IO.Path]::GetFullPath((Join-Path $Root $Entry.path))
  if (-not $Path.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetExtension($Path) -ine '.sql' -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw 'Invalid SQL path. STOP.'
  }
  $Bytes = [IO.File]::ReadAllBytes($Path)
  $Hasher = [Security.Cryptography.SHA256]::Create()
  try { $Hash = [BitConverter]::ToString($Hasher.ComputeHash($Bytes)).Replace('-', '') }
  finally { $Hasher.Dispose() }
  if ($Hash -cne $Entry.sha256) { throw "SHA-256 mismatch: $Path. STOP. Do not update the manifest to bypass this check." }
  if ($Entry.step -eq $Step) { $Selected = @{ Entry=$Entry; Path=$Path; Bytes=$Bytes; Hash=$Hash } }
}
if (-not $Selected) { throw 'Step not found. STOP.' }
Write-Host 'All release SQL hashes match. This script never connects to a database.'
if ($ValidateOnly) { return }
Write-Host "Step $Step : $($Selected.Entry.kind)"
Write-Host $Selected.Path
Write-Host "SHA-256: $($Selected.Hash)"
Write-Host 'Do not execute a migration without separate authorization and approved backup/recovery.'
Write-Host 'Run one whole file in SQL Editor, never a selection. STOP on any error or unexpected result.'
if ((Read-Host 'Confirm the project ref visibly selected in Supabase SQL Editor') -cne $Manifest.project) {
  throw 'Project not confirmed. STOP.'
}
$Text = [Text.UTF8Encoding]::new($false, $true).GetString($Selected.Bytes).TrimStart([char]0xFEFF)
if ([string]::IsNullOrWhiteSpace($Text)) { throw 'Empty SQL. STOP.' }
Set-Clipboard -Value $Text
Write-Host "SQL copied in full. NOT EXECUTED. Confirm step $Step PASS before proceeding."
