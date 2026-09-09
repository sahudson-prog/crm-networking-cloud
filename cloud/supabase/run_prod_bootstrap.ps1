[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

if ($env:COFFEECITO_ALLOW_EMPTY_DB_BOOTSTRAP -ne 'YES') {
  throw 'Set COFFEECITO_ALLOW_EMPTY_DB_BOOTSTRAP=YES to confirm this is a disposable empty database.'
}

if ([string]::IsNullOrWhiteSpace($env:COFFEECITO_BOOTSTRAP_DATABASE_URL)) {
  throw 'COFFEECITO_BOOTSTRAP_DATABASE_URL is required.'
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
  throw 'psql is not available. Install or provide it outside this script before running the bootstrap.'
}

$supabaseDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$requiredBaselineFiles = @(
  'migrations/202609090001_core_schema.sql',
  'migrations/202609090002_access_schema.sql',
  'migrations/202609090003_access_functions.sql',
  'migrations/202609090004_application_rpcs.sql',
  'migrations/202609090005_rls_and_grants.sql',
  'seeds/202609090001_access_catalogs.sql',
  'seeds/202609090002_headhunter_master.sql',
  'verifiers/202609090001_verify_structure.sql',
  'verifiers/202609090002_verify_access.sql',
  'verifiers/202609090003_verify_google.sql',
  'verifiers/202609090004_verify_reset_merge.sql'
)

foreach ($relativePath in $requiredBaselineFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $supabaseDirectory $relativePath) -PathType Leaf)) {
    throw "Missing required bootstrap file: $relativePath"
  }
}

$orderedFiles = @(
  (Join-Path $supabaseDirectory 'bootstrap/preflight_empty.sql')
) + @(
  Get-ChildItem -LiteralPath (Join-Path $supabaseDirectory 'migrations') -Filter '*.sql' -File |
    Sort-Object Name |
    Select-Object -ExpandProperty FullName
) + @(
  Get-ChildItem -LiteralPath (Join-Path $supabaseDirectory 'seeds') -Filter '*.sql' -File |
    Sort-Object Name |
    Select-Object -ExpandProperty FullName
) + @(
  Get-ChildItem -LiteralPath (Join-Path $supabaseDirectory 'verifiers') -Filter '*.sql' -File |
    Sort-Object Name |
    Select-Object -ExpandProperty FullName
)

$previousPgDatabase = $env:PGDATABASE
try {
  # Keep the connection string out of command arguments and console output.
  $env:PGDATABASE = $env:COFFEECITO_BOOTSTRAP_DATABASE_URL

  foreach ($sqlFile in $orderedFiles) {
    Write-Host "Applying $([System.IO.Path]::GetFileName($sqlFile))"
    & $psql.Source --no-psqlrc --set ON_ERROR_STOP=1 --file $sqlFile
    if ($LASTEXITCODE -ne 0) {
      throw "psql failed while applying $([System.IO.Path]::GetFileName($sqlFile))."
    }
  }
}
finally {
  $env:PGDATABASE = $previousPgDatabase
}

Write-Host 'Bootstrap and all verifiers completed successfully.'
