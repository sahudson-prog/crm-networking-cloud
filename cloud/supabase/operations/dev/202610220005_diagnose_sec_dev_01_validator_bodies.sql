-- DEV-only SEC-DEV-01 diagnosis for the two validator body drifts.
-- Read-only and non-fail-fast: returns one cumulative result set and changes nothing.

begin transaction read only;

with target_functions(signature, canonical_body) as (
  values
    (
      'public.validate_contact_sync_storage_v0_1()'::text,
      $contact$
declare
  missing_or_stale text[] := array[]::text[];
begin
  if to_regclass('public.external_contact_snapshots') is null then
    missing_or_stale := array_append(missing_or_stale, 'external_contact_snapshots table');
  end if;

  if to_regclass('public.uq_external_contact_snapshots_provider_external') is null then
    missing_or_stale := array_append(missing_or_stale, 'external contact snapshot unique index');
  end if;

  if to_regclass('public.uq_contact_emails_contact_normalized') is null then
    missing_or_stale := array_append(missing_or_stale, 'contact email per-contact unique index');
  end if;

  if to_regclass('public.uq_contact_phones_contact_normalized') is null then
    missing_or_stale := array_append(missing_or_stale, 'contact phone per-contact unique index');
  end if;

  if to_regclass('public.uq_contact_emails_user_normalized') is not null then
    missing_or_stale := array_append(missing_or_stale, 'old global email unique index still exists');
  end if;

  if to_regclass('public.uq_contact_phones_user_normalized') is not null then
    missing_or_stale := array_append(missing_or_stale, 'old global phone unique index still exists');
  end if;

  if array_length(missing_or_stale, 1) is not null then
    raise exception 'CONTACT_SYNC_STORAGE_NOT_READY: %', array_to_string(missing_or_stale, ', ');
  end if;

  return jsonb_build_object('ok', true);
end;
$contact$::text
    ),
    (
      'public.validate_headhunter_company_master_v0_1()'::text,
      $headhunter$
declare
  missing_or_stale text[] := array[]::text[];
begin
  if to_regclass('public.headhunter_companies') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter_companies table');
  end if;

  if to_regclass('public.headhunter_company_domains') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter_company_domains table');
  end if;

  if to_regclass('public.uq_headhunter_companies_name_active') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter company name unique index');
  end if;

  if to_regclass('public.uq_headhunter_company_domains_domain_active') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter company domain unique index');
  end if;

  if array_length(missing_or_stale, 1) is not null then
    raise exception 'HEADHUNTER_COMPANY_MASTER_NOT_READY: %', array_to_string(missing_or_stale, ', ');
  end if;

  return jsonb_build_object('ok', true);
end;
$headhunter$::text
    )
),
actual_functions as (
  select
    target.signature,
    target.canonical_body,
    procedure.oid,
    procedure.prokind,
    procedure.proowner,
    procedure.proacl,
    pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
    language_definition.lanname as language_name,
    procedure.prosecdef as security_definer,
    procedure.provolatile as volatility,
    procedure.proconfig,
    procedure.prosrc as actual_body,
    case procedure.prokind
      when 'f' then 'function'
      when 'p' then 'procedure'
      when 'a' then 'aggregate'
      when 'w' then 'window'
      else procedure.prokind::text
    end as routine_kind,
    case
      when procedure.prokind in ('f', 'w') then pg_catalog.pg_get_function_result(procedure.oid)
      else null
    end as result_type,
    case
      when procedure.prokind in ('f', 'p') then pg_catalog.pg_get_functiondef(procedure.oid)
      else null
    end as function_definition
  from target_functions target
  left join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(target.signature)
  left join pg_catalog.pg_language language_definition
    on language_definition.oid = procedure.prolang
),
normalized_functions as (
  select
    actual.*,
    replace(
      replace(actual.actual_body, chr(13) || chr(10), chr(10)),
      chr(13),
      chr(10)
    ) as actual_body_normalized,
    replace(
      replace(actual.canonical_body, chr(13) || chr(10), chr(10)),
      chr(13),
      chr(10)
    ) as canonical_body_normalized,
    ((
      char_length(actual.actual_body)
      - char_length(replace(actual.actual_body, chr(13) || chr(10), ''))
    ) / 2)::integer as actual_crlf_count,
    (
      char_length(actual.actual_body)
      - char_length(replace(actual.actual_body, chr(13), ''))
      - ((
          char_length(actual.actual_body)
          - char_length(replace(actual.actual_body, chr(13) || chr(10), ''))
        ) / 2)
    )::integer as actual_standalone_cr_count,
    (
      char_length(actual.actual_body)
      - char_length(replace(actual.actual_body, chr(10), ''))
      - ((
          char_length(actual.actual_body)
          - char_length(replace(actual.actual_body, chr(13) || chr(10), ''))
        ) / 2)
    )::integer as actual_standalone_lf_count,
    ((
      char_length(actual.actual_body)
      - char_length(replace(actual.actual_body, chr(92) || 'n', ''))
    ) / 2)::integer as actual_literal_backslash_n_count,
    ((
      char_length(actual.canonical_body)
      - char_length(replace(actual.canonical_body, chr(13) || chr(10), ''))
    ) / 2)::integer as canonical_crlf_count,
    (
      char_length(actual.canonical_body)
      - char_length(replace(actual.canonical_body, chr(13), ''))
      - ((
          char_length(actual.canonical_body)
          - char_length(replace(actual.canonical_body, chr(13) || chr(10), ''))
        ) / 2)
    )::integer as canonical_standalone_cr_count,
    (
      char_length(actual.canonical_body)
      - char_length(replace(actual.canonical_body, chr(10), ''))
      - ((
          char_length(actual.canonical_body)
          - char_length(replace(actual.canonical_body, chr(13) || chr(10), ''))
        ) / 2)
    )::integer as canonical_standalone_lf_count,
    ((
      char_length(actual.canonical_body)
      - char_length(replace(actual.canonical_body, chr(92) || 'n', ''))
    ) / 2)::integer as canonical_literal_backslash_n_count
  from actual_functions actual
),
function_comparison as (
  select
    normalized.*,
    encode(
      extensions.digest(
        convert_to(normalized.actual_body, 'UTF8'),
        'sha256'
      ),
      'hex'
    ) as actual_body_sha256_raw,
    encode(
      extensions.digest(
        convert_to(normalized.canonical_body, 'UTF8'),
        'sha256'
      ),
      'hex'
    ) as canonical_body_sha256_raw,
    encode(
      extensions.digest(
        convert_to(normalized.actual_body_normalized, 'UTF8'),
        'sha256'
      ),
      'hex'
    ) as actual_body_sha256_normalized,
    encode(
      extensions.digest(
        convert_to(normalized.canonical_body_normalized, 'UTF8'),
        'sha256'
      ),
      'hex'
    ) as canonical_body_sha256_normalized,
    encode(
      extensions.digest(
        convert_to(
          regexp_replace(
            normalized.actual_body_normalized,
            '[[:space:]]+',
            '',
            'g'
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as actual_whitespace_insensitive_sha256,
    encode(
      extensions.digest(
        convert_to(
          regexp_replace(
            normalized.canonical_body_normalized,
            '[[:space:]]+',
            '',
            'g'
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as canonical_whitespace_insensitive_sha256
  from normalized_functions normalized
),
function_acls as (
  select
    function.signature,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'grantor', grantor.rolname,
          'grantee', case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        )
        order by
          coalesce(grantor.rolname, ''),
          case when acl.grantee = 0 then 'PUBLIC' else coalesce(grantee.rolname, '') end,
          acl.privilege_type,
          acl.is_grantable
      ) filter (where acl.privilege_type is not null),
      '[]'::jsonb
    ) as acl
  from actual_functions function
  left join lateral aclexplode(
    coalesce(function.proacl, acldefault('f', function.proowner))
  ) acl on function.oid is not null
  left join pg_catalog.pg_roles grantor
    on grantor.oid = acl.grantor
  left join pg_catalog.pg_roles grantee
    on grantee.oid = acl.grantee
  group by function.signature
),
actual_lines as (
  select
    function.signature,
    line.ordinality::integer as line_number,
    line.value as actual_line
  from normalized_functions function
  cross join lateral regexp_split_to_table(
    function.actual_body_normalized,
    chr(10)
  ) with ordinality line(value, ordinality)
  where function.actual_body is not null
),
canonical_lines as (
  select
    function.signature,
    line.ordinality::integer as line_number,
    line.value as canonical_line
  from normalized_functions function
  cross join lateral regexp_split_to_table(
    function.canonical_body_normalized,
    chr(10)
  ) with ordinality line(value, ordinality)
),
line_differences as (
  select
    coalesce(actual.signature, canonical.signature) as signature,
    coalesce(actual.line_number, canonical.line_number) as line_number,
    actual.actual_line,
    canonical.canonical_line
  from actual_lines actual
  full join canonical_lines canonical
    on canonical.signature = actual.signature
   and canonical.line_number = actual.line_number
  where actual.actual_line is distinct from canonical.canonical_line
),
function_references as (
  select
    source.signature,
    source.source_kind,
    reference.matches[1] as referenced_object
  from (
    select signature, 'actual'::text as source_kind, actual_body as body
    from actual_functions
    where actual_body is not null
    union all
    select signature, 'canonical'::text, canonical_body
    from actual_functions
  ) source
  cross join lateral regexp_matches(
    source.body,
    $regex$to_regclass\('([^']+)'\)$regex$,
    'g'
  ) reference(matches)
),
index_manifest(index_name, expected_state, expected_table, expected_unique, expected_columns, expected_predicate) as (
  values
    (
      'uq_external_contact_snapshots_provider_external'::text,
      'present'::text,
      'public.external_contact_snapshots'::text,
      true,
      array['user_id', 'provider', 'external_id']::text[],
      null::text
    ),
    (
      'uq_contact_emails_contact_normalized',
      'present',
      'public.contact_emails',
      true,
      array['user_id', 'contact_id', 'normalized_email']::text[],
      null
    ),
    (
      'uq_contact_phones_contact_normalized',
      'present',
      'public.contact_phones',
      true,
      array['user_id', 'contact_id', 'normalized_phone']::text[],
      null
    ),
    (
      'uq_contact_emails_user_normalized',
      'absent',
      'public.contact_emails',
      null,
      null,
      null
    ),
    (
      'uq_contact_phones_user_normalized',
      'absent',
      'public.contact_phones',
      null,
      null,
      null
    ),
    (
      'uq_headhunter_companies_name_active',
      'present',
      'public.headhunter_companies',
      true,
      array['normalized_name']::text[],
      '(is_active = true)'
    ),
    (
      'uq_headhunter_company_domains_domain_active',
      'present',
      'public.headhunter_company_domains',
      true,
      array['normalized_domain']::text[],
      '(is_active = true)'
    ),
    (
      'uq_headhunter_companies_user_name_active',
      'absent',
      'public.headhunter_companies',
      null,
      null,
      null
    ),
    (
      'uq_headhunter_company_domains_user_domain_active',
      'absent',
      'public.headhunter_company_domains',
      null,
      null,
      null
    )
),
index_inventory as (
  select
    manifest.*,
    index_class.oid as index_oid,
    case when index_class.oid is null then null else index_class.oid::regclass::text end as actual_index,
    case
      when indexed_table.oid is null then null
      else pg_catalog.format('%I.%I', indexed_table_namespace.nspname, indexed_table.relname)
    end as actual_table,
    indexed_table.oid = pg_catalog.to_regclass(manifest.expected_table) as actual_table_matches,
    index_definition.indisunique,
    index_definition.indisvalid,
    index_definition.indisready,
    index_definition.indislive,
    case
      when index_definition.indexrelid is null then null
      else pg_catalog.pg_get_expr(index_definition.indpred, index_definition.indrelid)
    end as actual_predicate,
    case
      when index_definition.indexrelid is null then null
      else (
        select array_agg(
          pg_catalog.pg_get_indexdef(index_definition.indexrelid, key_position, true)
          order by key_position
        )
        from generate_series(1, index_definition.indnkeyatts) key_position
      )
    end as actual_columns,
    case
      when index_definition.indexrelid is null then null
      else pg_catalog.pg_get_indexdef(index_definition.indexrelid)
    end as actual_definition,
    constraint_definition.conname as backing_constraint
  from index_manifest manifest
  left join pg_catalog.pg_namespace index_namespace
    on index_namespace.nspname = 'public'
  left join pg_catalog.pg_class index_class
    on index_class.relnamespace = index_namespace.oid
   and index_class.relname = manifest.index_name
   and index_class.relkind in ('i', 'I')
  left join pg_catalog.pg_index index_definition
    on index_definition.indexrelid = index_class.oid
  left join pg_catalog.pg_class indexed_table
    on indexed_table.oid = index_definition.indrelid
  left join pg_catalog.pg_namespace indexed_table_namespace
    on indexed_table_namespace.oid = indexed_table.relnamespace
  left join pg_catalog.pg_constraint constraint_definition
    on constraint_definition.conindid = index_class.oid
),
table_manifest(table_name, expected_user_id) as (
  values
    ('external_contact_snapshots'::text, true),
    ('contact_emails', true),
    ('contact_phones', true),
    ('headhunter_companies', false),
    ('headhunter_company_domains', false)
),
table_shape as (
  select
    manifest.table_name,
    manifest.expected_user_id,
    table_class.oid is not null as table_exists,
    exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = table_class.oid
        and attribute.attname = 'user_id'
        and attribute.attnum > 0
        and not attribute.attisdropped
    ) as actual_user_id,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'name', attribute.attname,
            'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
            'not_null', attribute.attnotnull
          )
          order by attribute.attnum
        )
        from pg_catalog.pg_attribute attribute
        where attribute.attrelid = table_class.oid
          and attribute.attnum > 0
          and not attribute.attisdropped
      ),
      '[]'::jsonb
    ) as columns
  from table_manifest manifest
  left join pg_catalog.pg_namespace table_namespace
    on table_namespace.nspname = 'public'
  left join pg_catalog.pg_class table_class
    on table_class.relnamespace = table_namespace.oid
   and table_class.relname = manifest.table_name
   and table_class.relkind in ('r', 'p')
),
catalog_dependencies as (
  select
    function.signature,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'dependency_type', dependency.deptype,
          'referenced_catalog', dependency.refclassid::regclass::text,
          'referenced_object', pg_catalog.pg_describe_object(
            dependency.refclassid,
            dependency.refobjid,
            dependency.refobjsubid
          )
        )
        order by dependency.refclassid::regclass::text,
                 dependency.refobjid,
                 dependency.refobjsubid,
                 dependency.deptype
      ) filter (where dependency.objid is not null),
      '[]'::jsonb
    ) as dependencies
  from actual_functions function
  left join pg_catalog.pg_depend dependency
    on dependency.classid = 'pg_catalog.pg_proc'::regclass
   and dependency.objid = function.oid
  group by function.signature
),
reference_inventory as (
  select
    reference.signature,
    reference.source_kind,
    reference.referenced_object,
    pg_catalog.to_regclass(reference.referenced_object) is not null as object_exists,
    case
      when pg_catalog.to_regclass(reference.referenced_object) is null then null
      else pg_catalog.to_regclass(reference.referenced_object)::text
    end as resolved_object,
    coalesce(
      (
        select count(*)
        from pg_catalog.pg_depend dependency
        where dependency.classid = 'pg_catalog.pg_proc'::regclass
          and dependency.objid = function.oid
          and dependency.refclassid = 'pg_catalog.pg_class'::regclass
          and dependency.refobjid = pg_catalog.to_regclass(reference.referenced_object)
      ),
      0
    ) as catalog_dependency_count
  from function_references reference
  join actual_functions function using (signature)
),
diagnostic_rows as (
  select
    10 as block_order,
    'function_body_comparison'::text as diagnostic_block,
    comparison.signature as subject,
    jsonb_build_object(
      'function_exists', comparison.oid is not null,
      'routine_kind', comparison.routine_kind,
      'result_type', comparison.result_type,
      'expected_routine_kind', 'function',
      'expected_result_type', 'jsonb',
      'routine_type_matches',
        comparison.routine_kind = 'function' and comparison.result_type = 'jsonb',
      'owner', comparison.owner_name,
      'language', comparison.language_name,
      'security_definer', comparison.security_definer,
      'volatility', comparison.volatility,
      'proconfig', comparison.proconfig,
      'proacl_is_null', comparison.proacl is null,
      'proacl_raw', to_jsonb(comparison.proacl),
      'acl_source', case when comparison.proacl is null then 'owner_default' else 'explicit_proacl' end,
      'acl', acl.acl,
      'function_definition', comparison.function_definition,
      'actual_body_original', comparison.actual_body,
      'actual_body_normalized', comparison.actual_body_normalized,
      'canonical_body_original', comparison.canonical_body,
      'canonical_body_normalized', comparison.canonical_body_normalized,
      'actual_body_sha256_raw', comparison.actual_body_sha256_raw,
      'canonical_body_sha256_raw', comparison.canonical_body_sha256_raw,
      'raw_body_match', comparison.actual_body_sha256_raw = comparison.canonical_body_sha256_raw,
      'actual_body_sha256_normalized', comparison.actual_body_sha256_normalized,
      'canonical_body_sha256_normalized', comparison.canonical_body_sha256_normalized,
      'line_endings_normalized_match',
        comparison.actual_body_sha256_normalized = comparison.canonical_body_sha256_normalized,
      'actual_line_endings', jsonb_build_object(
        'crlf', comparison.actual_crlf_count,
        'standalone_cr', comparison.actual_standalone_cr_count,
        'standalone_lf', comparison.actual_standalone_lf_count,
        'literal_backslash_n', comparison.actual_literal_backslash_n_count
      ),
      'canonical_line_endings', jsonb_build_object(
        'crlf', comparison.canonical_crlf_count,
        'standalone_cr', comparison.canonical_standalone_cr_count,
        'standalone_lf', comparison.canonical_standalone_lf_count,
        'literal_backslash_n', comparison.canonical_literal_backslash_n_count
      ),
      'actual_whitespace_insensitive_sha256', comparison.actual_whitespace_insensitive_sha256,
      'canonical_whitespace_insensitive_sha256', comparison.canonical_whitespace_insensitive_sha256,
      'whitespace_insensitive_match_heuristic',
        comparison.actual_whitespace_insensitive_sha256 = comparison.canonical_whitespace_insensitive_sha256,
      'heuristic_note',
        'Whitespace stripping also affects quoted strings; use the exact bodies and line differences for the final decision.',
      'normalization_contract', 'replace CRLF with LF, then replace remaining CR with LF; literal backslash+n is preserved'
    ) as details
  from function_comparison comparison
  left join function_acls acl using (signature)

  union all

  select
    20,
    'function_body_line_differences',
    function.signature,
    jsonb_build_object(
      'difference_count', count(difference.line_number),
      'differences', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'line', difference.line_number,
            'actual', difference.actual_line,
            'canonical', difference.canonical_line
          )
          order by difference.line_number
        ) filter (where difference.line_number is not null),
        '[]'::jsonb
      )
    )
  from actual_functions function
  left join line_differences difference using (signature)
  group by function.signature

  union all

  select
    30,
    'function_to_regclass_references',
    reference.signature || ' [' || reference.source_kind || ']',
    jsonb_build_object(
      'referenced_object', reference.referenced_object,
      'object_exists', reference.object_exists,
      'resolved_object', reference.resolved_object,
      'catalog_dependency_count', reference.catalog_dependency_count,
      'dependency_note', 'Names passed as string literals to to_regclass normally do not create pg_depend links.'
    )
  from reference_inventory reference

  union all

  select
    40,
    'index_inventory',
    'public.' || inventory.index_name,
    jsonb_build_object(
      'expected_state', inventory.expected_state,
      'expected_table', inventory.expected_table,
      'expected_unique', inventory.expected_unique,
      'expected_columns', inventory.expected_columns,
      'expected_predicate', inventory.expected_predicate,
      'exists', inventory.index_oid is not null,
      'actual_index', inventory.actual_index,
      'actual_table', inventory.actual_table,
      'actual_table_matches', inventory.actual_table_matches,
      'unique', inventory.indisunique,
      'valid', inventory.indisvalid,
      'ready', inventory.indisready,
      'live', inventory.indislive,
      'columns', inventory.actual_columns,
      'predicate', inventory.actual_predicate,
      'definition', inventory.actual_definition,
      'backing_constraint', inventory.backing_constraint,
      'presence_matches', case
        when inventory.expected_state = 'present' then inventory.index_oid is not null
        else inventory.index_oid is null
      end,
      'structure_matches_when_expected_present', case
        when inventory.expected_state <> 'present' or inventory.index_oid is null then null
        else inventory.actual_table_matches
          and inventory.indisunique is not distinct from inventory.expected_unique
          and inventory.actual_columns is not distinct from inventory.expected_columns
          and coalesce(regexp_replace(inventory.actual_predicate, '[[:space:]]+', '', 'g'), '')
            = coalesce(regexp_replace(inventory.expected_predicate, '[[:space:]]+', '', 'g'), '')
      end,
      'valid_ready_live_when_expected_present', case
        when inventory.expected_state <> 'present' or inventory.index_oid is null then null
        else inventory.indisvalid and inventory.indisready and inventory.indislive
      end,
      'full_index_contract_matches', case
        when inventory.expected_state = 'absent' then inventory.index_oid is null
        when inventory.index_oid is null then false
        else inventory.actual_table_matches
          and inventory.indisunique is not distinct from inventory.expected_unique
          and inventory.actual_columns is not distinct from inventory.expected_columns
          and coalesce(regexp_replace(inventory.actual_predicate, '[[:space:]]+', '', 'g'), '')
            = coalesce(regexp_replace(inventory.expected_predicate, '[[:space:]]+', '', 'g'), '')
          and inventory.indisvalid
          and inventory.indisready
          and inventory.indislive
      end,
      'index_contract_note',
        'Structure and operational valid/ready/live state are reported separately and combined in full_index_contract_matches.'
    )
  from index_inventory inventory

  union all

  select
    50,
    'table_shape',
    'public.' || shape.table_name,
    jsonb_build_object(
      'exists', shape.table_exists,
      'expected_user_id_column', shape.expected_user_id,
      'actual_user_id_column', shape.actual_user_id,
      'user_id_shape_matches', shape.actual_user_id = shape.expected_user_id,
      'columns', shape.columns
    )
  from table_shape shape

  union all

  select
    60,
    'catalog_dependencies',
    dependency.signature,
    jsonb_build_object('dependencies', dependency.dependencies)
  from catalog_dependencies dependency

  union all

  select
    70,
    'reconciliation_summary',
    comparison.signature,
    jsonb_build_object(
      'raw_body_match', comparison.actual_body_sha256_raw = comparison.canonical_body_sha256_raw,
      'line_endings_normalized_match',
        comparison.actual_body_sha256_normalized = comparison.canonical_body_sha256_normalized,
      'whitespace_insensitive_match_heuristic',
        comparison.actual_whitespace_insensitive_sha256 = comparison.canonical_whitespace_insensitive_sha256,
      'actual_references', coalesce(
        (
          select jsonb_agg(reference.referenced_object order by reference.referenced_object)
          from reference_inventory reference
          where reference.signature = comparison.signature
            and reference.source_kind = 'actual'
        ),
        '[]'::jsonb
      ),
      'canonical_references', coalesce(
        (
          select jsonb_agg(reference.referenced_object order by reference.referenced_object)
          from reference_inventory reference
          where reference.signature = comparison.signature
            and reference.source_kind = 'canonical'
        ),
        '[]'::jsonb
      ),
      'actual_references_match_canonical', coalesce(
        (
          select array_agg(reference.referenced_object order by reference.referenced_object)
          from reference_inventory reference
          where reference.signature = comparison.signature
            and reference.source_kind = 'actual'
        ),
        array[]::text[]
      ) = coalesce(
        (
          select array_agg(reference.referenced_object order by reference.referenced_object)
          from reference_inventory reference
          where reference.signature = comparison.signature
            and reference.source_kind = 'canonical'
        ),
        array[]::text[]
      ),
      'actual_reference_resolution', coalesce(
        (
          select jsonb_object_agg(reference.referenced_object, reference.object_exists)
          from reference_inventory reference
          where reference.signature = comparison.signature
            and reference.source_kind = 'actual'
        ),
        '{}'::jsonb
      ),
      'interpretation', case
        when comparison.oid is null
          then 'FUNCTION_MISSING'
        when comparison.routine_kind <> 'function' or comparison.result_type <> 'jsonb'
          then 'UNEXPECTED_ROUTINE_TYPE'
        when comparison.actual_body_sha256_raw = comparison.canonical_body_sha256_raw
          then 'EXACT_RAW_MATCH'
        when comparison.actual_body_sha256_normalized = comparison.canonical_body_sha256_normalized
          then 'MATCH_AFTER_LINE_ENDING_NORMALIZATION'
        when comparison.actual_whitespace_insensitive_sha256 = comparison.canonical_whitespace_insensitive_sha256
          then 'WHITESPACE_INSENSITIVE_MATCH_REVIEW_EXACT_DIFF'
        when comparison.signature = 'public.validate_headhunter_company_master_v0_1()'
          then 'BODY_DIFF_REQUIRES_GLOBAL_VS_USER_SCOPED_INDEX_REVIEW'
        else 'BODY_DIFF_REQUIRES_LINE_REVIEW'
      end
    )
  from function_comparison comparison
)
select
  diagnostic_block,
  subject,
  details
from diagnostic_rows
order by block_order, subject;

rollback;
