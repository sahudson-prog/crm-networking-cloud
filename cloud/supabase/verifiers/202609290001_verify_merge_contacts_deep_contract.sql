-- Verifies the installed merge_contacts_deep contract without writing fixture data.

begin;

do $verify$
declare
  merge_function regprocedure := 'public.merge_contacts_deep(uuid,uuid[],jsonb,text)'::regprocedure;
  function_definition text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_index index_definition
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_definition.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where table_namespace.nspname = 'public'
      and table_relation.relname = 'contact_emails'
      and index_definition.indisunique
      and index_definition.indisvalid
      and index_definition.indisready
      and index_definition.indpred is null
      and index_definition.indexprs is null
      and index_definition.indnkeyatts = 3
      and (
        select array_agg(attribute.attname::text order by key_column.ordinality)
        from unnest(index_definition.indkey::smallint[])
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = index_definition.indrelid
         and attribute.attnum = key_column.attnum
        where key_column.ordinality <= index_definition.indnkeyatts
      ) = array['user_id', 'contact_id', 'normalized_email']::text[]
  ) then
    raise exception 'merge_contacts_deep requires a compatible unique contact email index';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_definition
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_definition.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where table_namespace.nspname = 'public'
      and table_relation.relname = 'contact_phones'
      and index_definition.indisunique
      and index_definition.indisvalid
      and index_definition.indisready
      and index_definition.indpred is null
      and index_definition.indexprs is null
      and index_definition.indnkeyatts = 3
      and (
        select array_agg(attribute.attname::text order by key_column.ordinality)
        from unnest(index_definition.indkey::smallint[])
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = index_definition.indrelid
         and attribute.attnum = key_column.attnum
        where key_column.ordinality <= index_definition.indnkeyatts
      ) = array['user_id', 'contact_id', 'normalized_phone']::text[]
  ) then
    raise exception 'merge_contacts_deep requires a compatible unique contact phone index';
  end if;

  select regexp_replace(lower(pg_get_functiondef(merge_function)), '\s+', ' ', 'g')
    into function_definition;

  if position(
    'on conflict (user_id, contact_id, normalized_email)' in function_definition
  ) = 0 then
    raise exception 'merge_contacts_deep has a stale contact email conflict target';
  end if;

  if position(
    'on conflict (user_id, contact_id, normalized_phone)' in function_definition
  ) = 0 then
    raise exception 'merge_contacts_deep has a stale contact phone conflict target';
  end if;

  if position('on conflict (user_id, normalized_email)' in function_definition) > 0
    or position('on conflict (user_id, normalized_phone)' in function_definition) > 0 then
    raise exception 'merge_contacts_deep still contains a global identity conflict target';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid = merge_function
      and (
        not procedure.prosecdef
        or pg_get_userbyid(procedure.proowner) <> 'postgres'
        or not exists (
          select 1
          from unnest(coalesce(procedure.proconfig, array[]::text[])) config
          where config in ('search_path=', 'search_path=""')
        )
      )
  ) then
    raise exception 'merge_contacts_deep owner or SECURITY DEFINER contract changed';
  end if;

  if not has_function_privilege('authenticated', merge_function, 'EXECUTE')
    or has_function_privilege('anon', merge_function, 'EXECUTE')
    or has_function_privilege('service_role', merge_function, 'EXECUTE')
    or has_function_privilege('supabase_auth_admin', merge_function, 'EXECUTE') then
    raise exception 'merge_contacts_deep grants are incorrect';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) acl
    where procedure.oid = merge_function
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC can execute merge_contacts_deep';
  end if;
end;
$verify$;

rollback;
