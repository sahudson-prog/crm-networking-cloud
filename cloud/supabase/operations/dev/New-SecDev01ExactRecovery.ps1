[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SnapshotPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

function Get-Sha256([string]$Value) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
  return [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

function Get-BooleanText($Value) {
  if ([bool]$Value) { return 'true' }
  return 'false'
}

function Quote-SqlLiteral([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

function Quote-SqlIdentifier([string]$Value) {
  return '"' + $Value.Replace('"', '""') + '"'
}

function Assert-CanonicalOrder($Rows, [scriptblock]$GetKey, [string]$Label) {
  $previous = $null
  foreach ($row in $Rows) {
    $current = & $GetKey $row
    if ($null -ne $previous -and [string]::CompareOrdinal($previous, $current) -gt 0) {
      throw "SEC_DEV_01_SNAPSHOT_INTEGRITY: non-canonical $Label order."
    }
    $previous = $current
  }
}

function Resolve-Snapshot($Parsed) {
  if ($Parsed -is [array]) {
    if ($Parsed.Count -ne 1) {
      throw 'SEC_DEV_01_SNAPSHOT_INVALID: expected one exported result row.'
    }
    $Parsed = $Parsed[0]
  }

  $wrapped = $Parsed.PSObject.Properties['sec_dev_01_recovery_snapshot']
  if ($null -ne $wrapped) {
    $Parsed = $wrapped.Value
    if ($Parsed -is [string]) {
      $Parsed = $Parsed | ConvertFrom-Json -Depth 100
    }
  }

  return $Parsed
}

function Assert-SurfaceCounts($Rows, $ExpectedCounts, [string]$Label) {
  $actual = @{}
  foreach ($group in ($Rows | Group-Object surface)) {
    $actual[$group.Name] = $group.Count
  }

  foreach ($property in $ExpectedCounts.PSObject.Properties) {
    if (-not $actual.ContainsKey($property.Name) -or
        [int64]$actual[$property.Name] -ne [int64]$property.Value) {
      throw "SEC_DEV_01_SNAPSHOT_INTEGRITY: $Label count mismatch for $($property.Name)."
    }
    $actual.Remove($property.Name)
  }

  if ($actual.Count -ne 0) {
    throw "SEC_DEV_01_SNAPSHOT_INTEGRITY: unreported $Label surface."
  }
}

$resolvedSnapshotPath = (Resolve-Path -LiteralPath $SnapshotPath).Path
$resolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
if ($resolvedSnapshotPath -eq $resolvedOutputPath) {
  throw 'SEC_DEV_01_OUTPUT_INVALID: output must not overwrite the snapshot.'
}

$snapshot = Resolve-Snapshot (
  Get-Content -LiteralPath $resolvedSnapshotPath -Raw | ConvertFrom-Json -Depth 100
)

if ([int]$snapshot.snapshot_version -ne 3 -or
    $snapshot.integrity_algorithm -ne 'sha256-row-fingerprints-v2') {
  throw 'SEC_DEV_01_SNAPSHOT_INVALID: unsupported version or integrity algorithm.'
}
if ($snapshot.current_user -ne 'postgres') {
  throw 'SEC_DEV_01_SNAPSHOT_INVALID: capture was not executed as postgres.'
}
if ([int64]$snapshot.sequence_acl_exception_count -ne 0 -or
    @($snapshot.sequence_acl_exceptions).Count -ne 0) {
  throw 'SEC_DEV_01_SEQUENCE_DRIFT_STOP: sequence ACL requires a separate decision.'
}

$entries = @($snapshot.entries)
$objects = @($snapshot.objects)
$defaultAclStates = @($snapshot.default_acl_states)
if ($entries.Count -ne [int64]$snapshot.entry_count) {
  throw 'SEC_DEV_01_SNAPSHOT_INTEGRITY: entry count mismatch.'
}
if ($objects.Count -ne [int64]$snapshot.object_count) {
  throw 'SEC_DEV_01_SNAPSHOT_INTEGRITY: object count mismatch.'
}
if ($defaultAclStates.Count -ne [int64]$snapshot.default_acl_state_count -or
    $defaultAclStates.Count -ne 6) {
  throw 'SEC_DEV_01_SNAPSHOT_INTEGRITY: default ACL state count mismatch.'
}

Assert-SurfaceCounts $entries $snapshot.entries_by_surface 'entry'
Assert-SurfaceCounts $objects $snapshot.objects_by_surface 'object'

$unitSeparator = [char]31
foreach ($entry in $entries) {
  $canonical = @(
    [string]$entry.surface,
    [string]$entry.object_name,
    [string]$entry.grantor,
    [string]$entry.grantee,
    [string]$entry.privilege_type,
    (Get-BooleanText $entry.is_grantable),
    [string]$entry.recovery_sql
  ) -join $unitSeparator
  if ((Get-Sha256 $canonical) -ne $entry.entry_fingerprint) {
    throw "SEC_DEV_01_SNAPSHOT_INTEGRITY: entry fingerprint mismatch for $($entry.surface):$($entry.object_name)."
  }
}

foreach ($object in $objects) {
  $canonical = @(
    [string]$object.surface,
    [string]$object.object_name,
    [string]$object.owner_name
  ) -join $unitSeparator
  if ((Get-Sha256 $canonical) -ne $object.object_fingerprint) {
    throw "SEC_DEV_01_SNAPSHOT_INTEGRITY: object fingerprint mismatch for $($object.surface):$($object.object_name)."
  }
}

$expectedDefaultAclObjects = @(
  'postgres:*:S',
  'postgres:*:f',
  'postgres:*:r',
  'postgres:public:S',
  'postgres:public:f',
  'postgres:public:r'
)
$actualDefaultAclObjects = @($defaultAclStates | ForEach-Object { [string]$_.object_name })
if ([string]::Join([char]31, $actualDefaultAclObjects) -ne
    [string]::Join([char]31, $expectedDefaultAclObjects)) {
  throw 'SEC_DEV_01_SNAPSHOT_INTEGRITY: unexpected default ACL state inventory.'
}

foreach ($state in $defaultAclStates) {
  $aclEntries = @($state.acl_entries)
  if ($aclEntries.Count -ne [int64]$state.acl_entry_count) {
    throw "SEC_DEV_01_SNAPSHOT_INTEGRITY: default ACL entry count mismatch for $($state.object_name)."
  }

  $previousAclEntryKey = $null
  foreach ($aclEntry in $aclEntries) {
    $aclEntryCanonical = @(
      [string]$aclEntry.grantor,
      [string]$aclEntry.grantee,
      [string]$aclEntry.privilege_type,
      (Get-BooleanText $aclEntry.is_grantable)
    ) -join $unitSeparator
    if ((Get-Sha256 $aclEntryCanonical) -ne $aclEntry.entry_fingerprint) {
      throw "SEC_DEV_01_SNAPSHOT_INTEGRITY: default ACL entry fingerprint mismatch for $($state.object_name)."
    }
    if ($null -ne $previousAclEntryKey -and
        [string]::CompareOrdinal($previousAclEntryKey, $aclEntryCanonical) -gt 0) {
      throw "SEC_DEV_01_SNAPSHOT_INTEGRITY: non-canonical default ACL entry order for $($state.object_name)."
    }
    $previousAclEntryKey = $aclEntryCanonical
  }

  if ((Get-Sha256 (($aclEntries.entry_fingerprint) -join '')) -ne $state.acl_entries_sha256) {
    throw "SEC_DEV_01_SNAPSHOT_INTEGRITY: default ACL aggregate entry hash mismatch for $($state.object_name)."
  }

  $stateCanonical = @(
    [string]$state.object_name,
    (Get-BooleanText $state.row_present),
    ([int64]$state.acl_entry_count).ToString([Globalization.CultureInfo]::InvariantCulture),
    [string]$state.acl_entries_sha256
  ) -join $unitSeparator
  if ((Get-Sha256 $stateCanonical) -ne $state.state_fingerprint) {
    throw "SEC_DEV_01_SNAPSHOT_INTEGRITY: default ACL state fingerprint mismatch for $($state.object_name)."
  }
}

$entryOrderKey = {
  param($entry)
  @(
    [string]$entry.surface,
    [string]$entry.object_name,
    [string]$entry.grantee,
    [string]$entry.privilege_type,
    [string]$entry.grantor,
    (Get-BooleanText $entry.is_grantable)
  ) -join $unitSeparator
}
$objectOrderKey = {
  param($object)
  @(
    [string]$object.surface,
    [string]$object.object_name,
    [string]$object.owner_name
  ) -join $unitSeparator
}

Assert-CanonicalOrder $entries $entryOrderKey 'entry'
Assert-CanonicalOrder $objects $objectOrderKey 'object'
Assert-CanonicalOrder $defaultAclStates { param($state) [string]$state.object_name } 'default ACL state'
$orderedEntries = $entries
$orderedObjects = $objects
$orderedDefaultAclStates = $defaultAclStates
if ((Get-Sha256 (($orderedEntries.entry_fingerprint) -join '')) -ne $snapshot.entries_sha256) {
  throw 'SEC_DEV_01_SNAPSHOT_INTEGRITY: aggregate entry hash mismatch.'
}
if ((Get-Sha256 (($orderedObjects.object_fingerprint) -join '')) -ne $snapshot.objects_sha256) {
  throw 'SEC_DEV_01_SNAPSHOT_INTEGRITY: aggregate object hash mismatch.'
}
if ((Get-Sha256 (($orderedDefaultAclStates.state_fingerprint) -join '')) -ne $snapshot.default_acl_states_sha256) {
  throw 'SEC_DEV_01_SNAPSHOT_INTEGRITY: aggregate default ACL state hash mismatch.'
}

$allowedSurfaces = @('table', 'sequence', 'function', 'schema', 'default_acl')
$allowedGrantees = @('PUBLIC', 'anon', 'authenticated', 'service_role', 'supabase_auth_admin')
$allowedGrantors = @('postgres', 'supabase_admin')
foreach ($entry in $entries) {
  $grantorIsSupported = $entry.grantor -in $allowedGrantors -or
    ($entry.surface -eq 'schema' -and $entry.grantor -eq 'pg_database_owner')
  if ($entry.surface -notin $allowedSurfaces -or
      $entry.grantee -notin $allowedGrantees -or
      -not $grantorIsSupported -or
      [string]$entry.recovery_sql -notmatch '^(grant|alter default privileges) ') {
    throw "SEC_DEV_01_SNAPSHOT_INVALID: unsupported ACL entry $($entry.surface):$($entry.object_name)."
  }
}

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('-- GENERATED SEC-DEV-01 EXACT MANAGED-ACL RECOVERY. REVIEW BEFORE EXECUTION.')
$lines.Add("-- Snapshot entries SHA-256: $($snapshot.entries_sha256)")
$lines.Add("-- Snapshot objects SHA-256: $($snapshot.objects_sha256)")
$lines.Add("-- Snapshot default ACL states SHA-256: $($snapshot.default_acl_states_sha256)")
$lines.Add('begin;')
$lines.Add("set local lock_timeout = '5s';")
$lines.Add("set local statement_timeout = '60s';")
$lines.Add('set local search_path = pg_catalog, public;')
$lines.Add("do `$`$ begin if current_user <> 'postgres' then raise exception 'SEC_DEV_01_RECOVERY_WRONG_ROLE'; end if; end; `$`$;")
$lines.Add('create temporary table sec_dev_01_recovery_expected_objects (surface text, object_name text, owner_name text, primary key (surface, object_name)) on commit drop;')
$lines.Add('insert into sec_dev_01_recovery_expected_objects values')
$objectValues = foreach ($object in $orderedObjects) {
  '  (' + (Quote-SqlLiteral $object.surface) + ', ' +
    (Quote-SqlLiteral $object.object_name) + ', ' +
    (Quote-SqlLiteral $object.owner_name) + ')'
}
$lines.Add(($objectValues -join ",`n") + ';')
$lines.Add(@'
create temporary table sec_dev_01_recovery_actual_objects on commit drop as
select 'table'::text as surface, namespace.nspname || '.' || relation.relname as object_name, pg_get_userbyid(relation.relowner) as owner_name
from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public' and relation.relkind in ('r', 'p')
union all
select 'sequence', namespace.nspname || '.' || relation.relname, pg_get_userbyid(relation.relowner)
from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public' and relation.relkind = 'S'
union all
select 'function', procedure.oid::regprocedure::text, pg_get_userbyid(procedure.proowner)
from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
union all
select 'schema', namespace.nspname, pg_get_userbyid(namespace.nspowner)
from pg_catalog.pg_namespace namespace where namespace.nspname = 'public'
union all
select 'default_acl', format('postgres:%s:%s', scope.schema_name, object_type.object_type), 'postgres'
from (values ('*'), ('public')) scope(schema_name)
cross join (values ('r'), ('S'), ('f')) object_type(object_type);
do $$
begin
  if exists (
    (select * from pg_temp.sec_dev_01_recovery_expected_objects except select * from pg_temp.sec_dev_01_recovery_actual_objects)
    union all
    (select * from pg_temp.sec_dev_01_recovery_actual_objects except select * from pg_temp.sec_dev_01_recovery_expected_objects)
  ) then
    raise exception 'SEC_DEV_01_RECOVERY_OBJECT_INVENTORY_MISMATCH';
  end if;
end;
$$;
'@)

$lines.Add('create temporary table sec_dev_01_recovery_expected_acl (surface text, object_name text, grantor text, grantee text, privilege_type text, is_grantable boolean, primary key (surface, object_name, grantor, grantee, privilege_type, is_grantable)) on commit drop;')
if ($orderedEntries.Count -gt 0) {
  $lines.Add('insert into sec_dev_01_recovery_expected_acl values')
  $aclValues = foreach ($entry in $orderedEntries) {
    '  (' + (Quote-SqlLiteral $entry.surface) + ', ' +
      (Quote-SqlLiteral $entry.object_name) + ', ' +
      (Quote-SqlLiteral $entry.grantor) + ', ' +
      (Quote-SqlLiteral $entry.grantee) + ', ' +
      (Quote-SqlLiteral $entry.privilege_type) + ', ' +
      (Get-BooleanText $entry.is_grantable) + ')'
  }
  $lines.Add(($aclValues -join ",`n") + ';')
}

$lines.Add('create temporary table sec_dev_01_recovery_expected_default_acl_states (object_name text primary key, row_present boolean not null) on commit drop;')
$lines.Add('insert into sec_dev_01_recovery_expected_default_acl_states values')
$defaultAclStateValues = foreach ($state in $orderedDefaultAclStates) {
  '  (' + (Quote-SqlLiteral $state.object_name) + ', ' + (Get-BooleanText $state.row_present) + ')'
}
$lines.Add(($defaultAclStateValues -join ",`n") + ';')

$lines.Add('create temporary table sec_dev_01_recovery_expected_default_acl_entries (object_name text, grantor text, grantee text, privilege_type text, is_grantable boolean, primary key (object_name, grantor, grantee, privilege_type, is_grantable)) on commit drop;')
$defaultAclEntryValues = foreach ($state in $orderedDefaultAclStates) {
  foreach ($aclEntry in @($state.acl_entries)) {
    '  (' + (Quote-SqlLiteral $state.object_name) + ', ' +
      (Quote-SqlLiteral $aclEntry.grantor) + ', ' +
      (Quote-SqlLiteral $aclEntry.grantee) + ', ' +
      (Quote-SqlLiteral $aclEntry.privilege_type) + ', ' +
      (Get-BooleanText $aclEntry.is_grantable) + ')'
  }
}
if (@($defaultAclEntryValues).Count -gt 0) {
  $lines.Add('insert into sec_dev_01_recovery_expected_default_acl_entries values')
  $lines.Add(($defaultAclEntryValues -join ",`n") + ';')
}

$clientRoles = 'PUBLIC, anon, authenticated, service_role, supabase_auth_admin'
foreach ($object in $orderedObjects) {
  switch ($object.surface) {
    'table' {
      if ($object.object_name -notmatch '^public\.[a-z0-9_]+$') { throw 'SEC_DEV_01_SNAPSHOT_INVALID: unsafe table name.' }
      $lines.Add("revoke select, insert, update, delete, truncate, references, trigger, maintain on table $($object.object_name) from $clientRoles;")
    }
    'sequence' {
      if ($object.object_name -notmatch '^public\.[a-z0-9_]+$') { throw 'SEC_DEV_01_SNAPSHOT_INVALID: unsafe sequence name.' }
      $lines.Add("revoke select, usage, update on sequence $($object.object_name) from $clientRoles;")
    }
    'function' {
      $lines.Add("revoke execute on function $($object.object_name) from $clientRoles;")
    }
    'schema' {
      $lines.Add("revoke usage, create on schema public from $clientRoles;")
    }
  }
}

$lines.Add('alter default privileges for role postgres revoke all on tables from PUBLIC, anon, authenticated, service_role, supabase_auth_admin;')
$lines.Add('alter default privileges for role postgres revoke all on sequences from PUBLIC, anon, authenticated, service_role, supabase_auth_admin;')
$lines.Add('alter default privileges for role postgres revoke execute on functions from PUBLIC, anon, authenticated, service_role, supabase_auth_admin;')
$lines.Add('alter default privileges for role postgres in schema public revoke all on tables from PUBLIC, anon, authenticated, service_role, supabase_auth_admin;')
$lines.Add('alter default privileges for role postgres in schema public revoke all on sequences from PUBLIC, anon, authenticated, service_role, supabase_auth_admin;')
$lines.Add('alter default privileges for role postgres in schema public revoke execute on functions from PUBLIC, anon, authenticated, service_role, supabase_auth_admin;')

$activeGrantor = 'postgres'
foreach ($entry in $orderedEntries) {
  if ($entry.grantor -ne $activeGrantor) {
    if ($activeGrantor -ne 'postgres') { $lines.Add('reset role;') }
    $activeGrantor = [string]$entry.grantor
    if ($activeGrantor -ne 'postgres') {
      $lines.Add('set local role ' + (Quote-SqlIdentifier $activeGrantor) + ';')
    }
  }
  $lines.Add([string]$entry.recovery_sql)
}
if ($activeGrantor -ne 'postgres') { $lines.Add('reset role;') }

$globalFunctionDefault = @($orderedDefaultAclStates | Where-Object { $_.object_name -eq 'postgres:*:f' })
if ($globalFunctionDefault.Count -ne 1) {
  throw 'SEC_DEV_01_SNAPSHOT_INVALID: global function default ACL state is missing.'
}
if (-not [bool]$globalFunctionDefault[0].row_present) {
  $lines.Add('alter default privileges for role postgres grant execute on functions to PUBLIC;')
}

$lines.Add(@'
create temporary table sec_dev_01_recovery_actual_acl on commit drop as
with role_scope(role_name) as (
  values ('PUBLIC'), ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin')
), table_acl as (
  select
    'table'::text as surface,
    namespace.nspname || '.' || relation.relname as object_name,
    pg_get_userbyid(acl.grantor) as grantor,
    case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
    acl.privilege_type,
    acl.is_grantable
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  cross join lateral pg_catalog.aclexplode(coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) acl
  join role_scope scoped_role
    on scoped_role.role_name = case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end
  where namespace.nspname = 'public' and relation.relkind in ('r', 'p')
), sequence_acl as (
  select
    'sequence'::text,
    namespace.nspname || '.' || relation.relname,
    pg_get_userbyid(acl.grantor),
    case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
    acl.privilege_type,
    acl.is_grantable
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  cross join lateral pg_catalog.aclexplode(coalesce(relation.relacl, pg_catalog.acldefault('S', relation.relowner))) acl
  join role_scope scoped_role
    on scoped_role.role_name = case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end
  where namespace.nspname = 'public' and relation.relkind = 'S'
), function_acl as (
  select
    'function'::text,
    procedure.oid::regprocedure::text,
    pg_get_userbyid(acl.grantor),
    case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
    acl.privilege_type,
    acl.is_grantable
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  cross join lateral pg_catalog.aclexplode(coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) acl
  join role_scope scoped_role
    on scoped_role.role_name = case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end
  where namespace.nspname = 'public'
), schema_acl as (
  select
    'schema'::text,
    namespace.nspname,
    pg_get_userbyid(acl.grantor),
    case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
    acl.privilege_type,
    acl.is_grantable
  from pg_catalog.pg_namespace namespace
  cross join lateral pg_catalog.aclexplode(coalesce(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))) acl
  join role_scope scoped_role
    on scoped_role.role_name = case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end
  where namespace.nspname = 'public'
), default_acl as (
  select
    'default_acl'::text,
    format('%s:%s:%s', owner_role.rolname, coalesce(namespace.nspname, '*'), defaults.defaclobjtype),
    owner_role.rolname,
    case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
    acl.privilege_type,
    acl.is_grantable
  from pg_catalog.pg_default_acl defaults
  join pg_catalog.pg_roles owner_role on owner_role.oid = defaults.defaclrole
  left join pg_catalog.pg_namespace namespace on namespace.oid = defaults.defaclnamespace
  cross join lateral pg_catalog.aclexplode(defaults.defaclacl) acl
  join role_scope scoped_role
    on scoped_role.role_name = case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end
  where owner_role.rolname = 'postgres'
    and coalesce(namespace.nspname, 'public') = 'public'
    and defaults.defaclobjtype in ('r', 'S', 'f')
)
select * from table_acl
union all select * from sequence_acl
union all select * from function_acl
union all select * from schema_acl
union all select * from default_acl;

create temporary table sec_dev_01_recovery_actual_default_acl_states on commit drop as
select
  format('%s:%s:%s', owner_role.rolname, scope.schema_name, object_type.object_type) as object_name,
  defaults.oid is not null as row_present
from pg_catalog.pg_roles owner_role
cross join (
  select '*'::text as schema_name, 0::oid as schema_oid
  union all
  select namespace.nspname, namespace.oid
  from pg_catalog.pg_namespace namespace
  where namespace.nspname = 'public'
) scope
cross join (values ('r'::"char"), ('S'::"char"), ('f'::"char")) object_type(object_type)
left join pg_catalog.pg_default_acl defaults
  on defaults.defaclrole = owner_role.oid
 and defaults.defaclnamespace = scope.schema_oid
 and defaults.defaclobjtype = object_type.object_type
where owner_role.rolname = 'postgres';

create temporary table sec_dev_01_recovery_actual_default_acl_entries on commit drop as
select
  format('%s:%s:%s', owner_role.rolname, coalesce(namespace.nspname, '*'), defaults.defaclobjtype) as object_name,
  pg_get_userbyid(acl.grantor) as grantor,
  case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  acl.privilege_type,
  acl.is_grantable
from pg_catalog.pg_default_acl defaults
join pg_catalog.pg_roles owner_role on owner_role.oid = defaults.defaclrole
left join pg_catalog.pg_namespace namespace on namespace.oid = defaults.defaclnamespace
cross join lateral pg_catalog.aclexplode(defaults.defaclacl) acl
where owner_role.rolname = 'postgres'
  and coalesce(namespace.nspname, 'public') = 'public'
  and defaults.defaclobjtype in ('r', 'S', 'f');

do $$
begin
  if exists (
    (select * from pg_temp.sec_dev_01_recovery_expected_acl except select * from pg_temp.sec_dev_01_recovery_actual_acl)
    union all
    (select * from pg_temp.sec_dev_01_recovery_actual_acl except select * from pg_temp.sec_dev_01_recovery_expected_acl)
  ) then
    raise exception 'SEC_DEV_01_RECOVERY_ACL_MISMATCH';
  end if;

  if exists (
    (select * from pg_temp.sec_dev_01_recovery_expected_default_acl_states except select * from pg_temp.sec_dev_01_recovery_actual_default_acl_states)
    union all
    (select * from pg_temp.sec_dev_01_recovery_actual_default_acl_states except select * from pg_temp.sec_dev_01_recovery_expected_default_acl_states)
  ) then
    raise exception 'SEC_DEV_01_RECOVERY_DEFAULT_ACL_STATE_MISMATCH';
  end if;

  if exists (
    (select * from pg_temp.sec_dev_01_recovery_expected_default_acl_entries except select * from pg_temp.sec_dev_01_recovery_actual_default_acl_entries)
    union all
    (select * from pg_temp.sec_dev_01_recovery_actual_default_acl_entries except select * from pg_temp.sec_dev_01_recovery_expected_default_acl_entries)
  ) then
    raise exception 'SEC_DEV_01_RECOVERY_DEFAULT_ACL_ENTRY_MISMATCH';
  end if;
end;
$$;
'@)

$lines.Add("-- Transactional ACL assertions matched snapshot v3 entries_sha256 $($snapshot.entries_sha256).")
$lines.Add('commit;')
$lines.Add('-- Defense in depth: re-run 202610220000_capture_sec_dev_01_recovery.sql and compare every v3 hash and count.')

$outputParent = Split-Path -Parent $resolvedOutputPath
if (-not (Test-Path -LiteralPath $outputParent -PathType Container)) {
  throw 'SEC_DEV_01_OUTPUT_INVALID: output directory does not exist.'
}
[System.IO.File]::WriteAllLines($resolvedOutputPath, $lines, [System.Text.UTF8Encoding]::new($false))

Write-Output ([pscustomobject]@{
  SnapshotVersion = $snapshot.snapshot_version
  EntryCount = $snapshot.entry_count
  ObjectCount = $snapshot.object_count
  EntriesSha256 = $snapshot.entries_sha256
  ObjectsSha256 = $snapshot.objects_sha256
  DefaultAclStatesSha256 = $snapshot.default_acl_states_sha256
  OutputPath = $resolvedOutputPath
})
