[CmdletBinding()]
param(
  [string]$DockerContainer,
  [string]$DockerPsqlImage
)

$ErrorActionPreference = 'Stop'

if ($env:COFFEECITO_ALLOW_EMPTY_DB_BOOTSTRAP -ne 'YES') {
  throw 'Set COFFEECITO_ALLOW_EMPTY_DB_BOOTSTRAP=YES to confirm this is a disposable empty database.'
}

$useDocker = $PSBoundParameters.ContainsKey('DockerContainer')
$useDockerPsqlImage = $PSBoundParameters.ContainsKey('DockerPsqlImage')
$docker = $null
$psql = $null

if ($useDocker -and $useDockerPsqlImage) {
  throw 'DockerContainer and DockerPsqlImage cannot be used together.'
}
if ($useDocker -and [string]::IsNullOrWhiteSpace($DockerContainer)) {
  throw 'DockerContainer must name an explicit local container.'
}
if ($useDockerPsqlImage -and [string]::IsNullOrWhiteSpace($DockerPsqlImage)) {
  throw 'DockerPsqlImage must name an explicit local image.'
}

if ($useDocker -or $useDockerPsqlImage) {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    throw 'docker is not available.'
  }
}

if (-not $useDocker -and [string]::IsNullOrWhiteSpace($env:COFFEECITO_BOOTSTRAP_DATABASE_URL)) {
  throw 'COFFEECITO_BOOTSTRAP_DATABASE_URL is required when DockerContainer is not provided.'
}

if (-not $useDocker -and -not $useDockerPsqlImage) {
  $psql = Get-Command psql -ErrorAction SilentlyContinue
  if (-not $psql) {
    throw 'psql is not available. Install or provide it outside this script before running the bootstrap.'
  }
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
$previousDockerConnectionEnv = @{}
try {
  if ($useDockerPsqlImage) {
    $connectionUri = $null
    if (-not [Uri]::TryCreate($env:COFFEECITO_BOOTSTRAP_DATABASE_URL, [UriKind]::Absolute, [ref]$connectionUri) -or
        $connectionUri.Scheme -notin @('postgres', 'postgresql') -or
        [string]::IsNullOrWhiteSpace($connectionUri.Host)) {
      throw 'COFFEECITO_BOOTSTRAP_DATABASE_URL must be a PostgreSQL connection URL.'
    }

    $userInfo = $connectionUri.UserInfo
    $separator = $userInfo.IndexOf(':')
    $database = [Uri]::UnescapeDataString($connectionUri.AbsolutePath.TrimStart('/'))
    if ($separator -le 0 -or [string]::IsNullOrWhiteSpace($database)) {
      throw 'COFFEECITO_BOOTSTRAP_DATABASE_URL must include a user, password, and database.'
    }

    $sslMode = $null
    if ($connectionUri.Query.Length -gt 1) {
      foreach ($parameter in $connectionUri.Query.Substring(1).Split('&')) {
        $equals = $parameter.IndexOf('=')
        if ($equals -le 0 -or
            [System.Net.WebUtility]::UrlDecode($parameter.Substring(0, $equals)) -ne 'sslmode' -or
            $null -ne $sslMode) {
          throw 'COFFEECITO_BOOTSTRAP_DATABASE_URL contains an unsupported connection option.'
        }
        $sslMode = [System.Net.WebUtility]::UrlDecode($parameter.Substring($equals + 1))
      }
    }
    if ([string]::IsNullOrWhiteSpace($sslMode)) {
      $sslMode = 'require'
    }
    if ($sslMode -notin @('disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full')) {
      throw 'COFFEECITO_BOOTSTRAP_DATABASE_URL has an invalid sslmode.'
    }

    $dockerConnectionEnv = @{
      PGHOST = $connectionUri.Host
      PGPORT = if ($connectionUri.Port -gt 0) { [string]$connectionUri.Port } else { '5432' }
      PGUSER = [Uri]::UnescapeDataString($userInfo.Substring(0, $separator))
      PGPASSWORD = [Uri]::UnescapeDataString($userInfo.Substring($separator + 1))
      PGDATABASE = $database
      PGSSLMODE = $sslMode
    }
    foreach ($name in $dockerConnectionEnv.Keys) {
      $previousDockerConnectionEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
      [Environment]::SetEnvironmentVariable($name, $dockerConnectionEnv[$name], 'Process')
    }
  }
  elseif (-not $useDocker) {
    # Keep the connection string out of command arguments and console output.
    $env:PGDATABASE = $env:COFFEECITO_BOOTSTRAP_DATABASE_URL
  }

  foreach ($sqlFile in $orderedFiles) {
    Write-Host "Applying $([System.IO.Path]::GetFileName($sqlFile))"
    if ($useDocker) {
      Get-Content -LiteralPath $sqlFile -Raw |
        & $docker.Source exec -i $DockerContainer psql -U postgres -d postgres --no-psqlrc --set ON_ERROR_STOP=1
    }
    elseif ($useDockerPsqlImage) {
      Get-Content -LiteralPath $sqlFile -Raw |
        & $docker.Source run --rm -i --pull never --env PGHOST --env PGPORT --env PGUSER --env PGPASSWORD --env PGDATABASE --env PGSSLMODE $DockerPsqlImage psql --no-psqlrc --set ON_ERROR_STOP=1
    }
    else {
      & $psql.Source --no-psqlrc --set ON_ERROR_STOP=1 --file $sqlFile
    }

    if ($LASTEXITCODE -ne 0) {
      throw "psql failed while applying $([System.IO.Path]::GetFileName($sqlFile))."
    }
  }
}
finally {
  if ($useDockerPsqlImage) {
    foreach ($name in $previousDockerConnectionEnv.Keys) {
      [Environment]::SetEnvironmentVariable($name, $previousDockerConnectionEnv[$name], 'Process')
    }
  }
  elseif (-not $useDocker) {
    $env:PGDATABASE = $previousPgDatabase
  }
}

Write-Host 'Bootstrap and all verifiers completed successfully.'
