-- PROD CONTRACT CHANGE: REG-OPEN-01, expand-only, OFF by default.
-- Drain in-flight signups/bootstrap before installation. No backfill.
begin;
set local lock_timeout = '5s';
lock table auth.users in share row exclusive mode;
do $reg_contract$
declare r record; p pg_proc%rowtype; who text; v_multi_testers boolean;
begin
  if current_user <> 'postgres' then raise exception 'STOP: postgres required'; end if;
  -- Granting anon schema USAGE must not uncover unrelated effective privileges.
  if has_schema_privilege('anon', 'public', 'CREATE')
    or exists(select 1 from pg_proc where pronamespace='public'::regnamespace
      and has_function_privilege('anon', oid, 'EXECUTE'))
    or exists(select 1 from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f')
      and (has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        or has_any_column_privilege('anon', oid, 'SELECT,INSERT,UPDATE,REFERENCES')))
    or exists(select 1 from pg_class where relnamespace='public'::regnamespace
      and case when relkind='S' then has_sequence_privilege('anon', oid, 'USAGE,SELECT,UPDATE') else false end)
  then raise exception 'STOP: anon schema exposure would uncover existing privileges'; end if;
  if exists (select 1 from pg_class where relnamespace='public'::regnamespace and relname in
    ('app_public_registration_settings','app_public_registration_admissions'))
    or exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in
    ('public_registration_status_v1','admin_public_registration_state_v1','admin_set_public_registration_v1',
     'public_registration_email_blocked_v1','capture_public_registration_candidate_v1',
     'public_registration_admission_valid_v1','bootstrap_public_registration_v1'))
    or exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass
      and tgname='zz_capture_public_registration_candidate_v1')
  then raise exception 'STOP: REG-OPEN-01 already present or name collision'; end if;
  if exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole='postgres'::regrole and d.defaclnamespace in (0,'public'::regnamespace)
      and a.grantee not in (0,'postgres'::regrole,'anon'::regrole,'authenticated'::regrole,
        'service_role'::regrole,'supabase_auth_admin'::regrole))
  then raise exception 'STOP: unexpected default ACL'; end if;
  -- Only complete, known R2-B variants are supported; never mix their bodies.
  select case md5(replace(prosrc,E'\r',''))
    when '867ff4ec5f934c919d7787342e74a70f' then false
    when '989795c48d4d86eea224b26e7752a874' then true
    else null end into v_multi_testers
    from pg_proc where oid=to_regprocedure('public.set_r2b_rollout_gate(text,uuid)');
  if v_multi_testers is null then raise exception 'STOP: unknown R2-B gate variant'; end if;
  if v_multi_testers then
    if not exists(select 1 from pg_attribute a join pg_attrdef d
        on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid='public.r2b_rollout_gate'::regclass
        and a.attname='additional_test_user_ids' and not a.attisdropped
        and a.atttypid='uuid[]'::regtype and a.attnotnull
        and pg_get_expr(d.adbin,d.adrelid)='''{}''::uuid[]')
    then raise exception 'STOP: DEV multi-tester gate column drift'; end if;
  elsif exists(select 1 from pg_attribute where attrelid='public.r2b_rollout_gate'::regclass
    and attname='additional_test_user_ids' and not attisdropped) then
    raise exception 'STOP: standard R2-B gate has unexpected multi-tester column';
  end if;
  if not exists(select 1 from pg_class where oid='public.r2b_rollout_gate'::regclass
      and relowner='postgres'::regrole and relrowsecurity)
    or exists(select 1 from unnest(array['anon','authenticated','service_role','supabase_auth_admin']) role_name
      where has_table_privilege(role_name,'public.r2b_rollout_gate','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(role_name,'public.r2b_rollout_gate','SELECT,INSERT,UPDATE,REFERENCES'))
  then raise exception 'STOP: R2-B gate security drift'; end if;
  for r in select * from (values
    ('public.hook_enforce_app_access_allowlist(jsonb)','416a5f23aacafa271e1eb34b8e711525','supabase_auth_admin','s','jsonb','plpgsql',true),
    ('public.bootstrap_current_user_invitation_v1()','419776a9ba534250312083c491d02172','authenticated','v','TABLE(allowed boolean, reason text, access_source text)','plpgsql',true),
    ('public.app_access_status_for_user(uuid)',case when v_multi_testers then '8fa17c0cb4f35de3c773b3568da93d30' else 'f58a4c86cc02c5efade201f1644dbfaf' end,'','s','TABLE(allowed boolean, reason text)','plpgsql',true),
    ('public.handle_new_auth_user_profile()','d88a092e24b5819670567e2e3751e3af','','v','trigger','plpgsql',true),
    ('public.ensure_invitation_user_role_v1(uuid,timestamptz)','2495514c010ab7fc3abbc5401e6ede0e','','v','void','plpgsql',true),
    ('public.invitation_email_fingerprint_v1(text)','79a1a3f6c7ca0e56d2ed8197258867c8','','i','bytea','sql',false),
    ('public.set_r2b_rollout_gate(text,uuid)',case when v_multi_testers then '989795c48d4d86eea224b26e7752a874' else '867ff4ec5f934c919d7787342e74a70f' end,'','v','void','plpgsql',true),
    ('public.current_user_app_access_status()','bafebceb676bb21f2d09a587881af7ea','authenticated','s','TABLE(allowed boolean, reason text)','plpgsql',true),
    ('public.current_user_has_app_access()','a9ccc4c95d98fbbd14ed1ced0a94771e','authenticated','s','boolean','sql',true),
    ('public.current_user_has_capability(text)','b1384155ef3df1fde0b84ecc175a61af','authenticated','s','boolean','sql',true),
    ('public.is_email_authorized_for_app_access(text)','2e3776446dd7f5bcd930a2294f29c54b','','s','boolean','sql',true)
  ) x(signature,hash,client,volatility,result,language,definer) loop
    select * into p from pg_proc where oid=to_regprocedure(r.signature);
    if not found or p.prosecdef is distinct from r.definer or p.proowner<>'postgres'::regrole
      or p.proconfig is distinct from array['search_path=""']
      or p.provolatile::text<>r.volatility
      or pg_get_function_result(p.oid)<>r.result
      or p.prolang<>(select oid from pg_language where lanname=r.language)
      or (select count(*) from pg_proc x where x.pronamespace=p.pronamespace and x.proname=p.proname)<>1
      or md5(replace(p.prosrc,E'\r',''))<>r.hash
      or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee not in ('postgres'::regrole,coalesce(nullif(r.client,'')::regrole,'postgres'::regrole))
          or (a.is_grantable and a.grantee<>'postgres'::regrole))
    then raise exception 'STOP: REG-OPEN-01 body/signature/security/ACL drift: %',r.signature; end if;
    foreach who in array array['anon','authenticated','service_role','supabase_auth_admin'] loop
      if has_function_privilege(who,p.oid,'EXECUTE') is distinct from (who=r.client)
      then raise exception 'STOP: inherited EXECUTE drift: % / %',r.signature,who; end if;
    end loop;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass
    and tgname='on_auth_user_created_profile' and tgfoid='public.handle_new_auth_user_profile()'::regprocedure
    and tgtype=5 and tgenabled='O' and tgqual is null and tgnargs=0)
  then raise exception 'STOP: Auth profile trigger drift'; end if;
  if not exists(select 1 from pg_attribute where attrelid='auth.users'::regclass
    and attname='email_confirmed_at' and atttypid='timestamptz'::regtype and not attisdropped)
    or not exists(select 1 from pg_attribute where attrelid='auth.users'::regclass
    and attname='banned_until' and atttypid='timestamptz'::regtype and not attisdropped)
  then raise exception 'STOP: Auth verification/ban columns missing'; end if;
  if (select count(*) from public.r2b_rollout_gate)<>1
    or not exists(select 1 from public.r2b_rollout_gate where singleton and mode in ('paused','test_only','open'))
    or (select count(*) from public.app_invitation_program_settings)<>1
  then raise exception 'STOP: existing singleton missing'; end if;
end $reg_contract$;

-- REG-OPEN-01 definitions follow.
create table public.app_public_registration_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by_user_id uuid references public.profiles(id) on delete set null
);
insert into public.app_public_registration_settings(singleton) values (true);

create table public.app_public_registration_admissions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email_fingerprint bytea not null check (octet_length(email_fingerprint) = 32),
  captured_revision bigint not null check (captured_revision >= 0),
  captured_at timestamptz not null default clock_timestamp(),
  admitted_at timestamptz,
  revoked_at timestamptz,
  check (isfinite(captured_at)),
  check (admitted_at is null or (isfinite(admitted_at) and admitted_at >= captured_at)),
  check (revoked_at is null or (isfinite(revoked_at) and revoked_at >= captured_at))
);
alter table public.app_public_registration_settings owner to postgres;
alter table public.app_public_registration_admissions owner to postgres;
alter table public.app_public_registration_settings enable row level security;
alter table public.app_public_registration_admissions enable row level security;
revoke all on public.app_public_registration_settings, public.app_public_registration_admissions
  from public, anon, authenticated, service_role, supabase_auth_admin;

create function public.public_registration_status_v1()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('enabled', coalesce((
    select s.enabled and g.mode = 'open'
    from public.app_public_registration_settings s cross join public.r2b_rollout_gate g
    where s.singleton and g.singleton
  ), false));
$$;

create function public.admin_public_registration_state_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin_manage_access_required' using errcode = '42501';
  end if;
  select jsonb_build_object('enabled', enabled, 'revision', revision) into v_result
    from public.app_public_registration_settings where singleton;
  if v_result is null then raise exception 'public_registration_settings_missing'; end if;
  return v_result;
end;
$$;

create function public.admin_set_public_registration_v1(p_enabled boolean, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_settings public.app_public_registration_settings%rowtype;
begin
  if auth.uid() is null or not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin_manage_access_required' using errcode = '42501';
  end if;
  if p_enabled is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid_public_registration_settings' using errcode = '22023';
  end if;
  select * into v_settings from public.app_public_registration_settings where singleton for update;
  if not found then raise exception 'public_registration_settings_missing'; end if;
  if not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin_manage_access_required' using errcode = '42501';
  end if;
  if v_settings.revision <> p_expected_revision then
    raise exception 'public_registration_revision_conflict' using errcode = '40001';
  end if;
  if v_settings.enabled is distinct from p_enabled then
    update public.app_public_registration_settings
      set enabled = p_enabled, revision = revision + 1,
          updated_at = clock_timestamp(), updated_by_user_id = auth.uid()
      where singleton returning * into v_settings;
    insert into public.audit_log(user_id, actor, action, object_type, before_json, after_json)
    values(auth.uid(), 'admin', 'public_registration_update', 'public_registration_settings',
      jsonb_build_object('enabled', not p_enabled, 'revision', p_expected_revision),
      jsonb_build_object('enabled', v_settings.enabled, 'revision', v_settings.revision));
  end if;
  return jsonb_build_object('enabled', v_settings.enabled, 'revision', v_settings.revision);
end;
$$;

create function public.public_registration_email_blocked_v1(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.normalize_app_access_email(p_email) is null
    or position('@' in coalesce(public.normalize_app_access_email(p_email), '')) <= 1
    or exists(select 1 from public.app_access_allowlist a
      where a.email_normalized = public.normalize_app_access_email(p_email) and a.revoked_at is not null)
    or exists(select 1 from public.app_invitations i
      where i.email_fingerprint = public.invitation_email_fingerprint_v1(p_email)
        and i.invitation_status = 'cancelled' and i.reinvite_blocked_at is not null
        and i.reinvite_unblocked_at is null);
$$;

create function public.capture_public_registration_candidate_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_enabled boolean; v_revision bigint;
begin
  -- Evidence comes from this INSERT, never created_at or user-controlled metadata.
  select enabled, revision into v_enabled, v_revision
    from public.app_public_registration_settings where singleton for share;
  if v_enabled is true
    and not public.is_email_authorized_for_app_access(new.email)
    and not public.public_registration_email_blocked_v1(new.email)
    and (new.banned_until is null or new.banned_until <= clock_timestamp()) then
    insert into public.app_public_registration_admissions(user_id, email_fingerprint, captured_revision)
      values(new.id, public.invitation_email_fingerprint_v1(new.email), v_revision);
  end if;
  return new;
end;
$$;

-- PostgreSQL orders same-event triggers by name: keep the existing profile trigger first.
create trigger zz_capture_public_registration_candidate_v1
after insert on auth.users for each row
execute function public.capture_public_registration_candidate_v1();

create function public.public_registration_admission_valid_v1(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.app_public_registration_admissions a
    join auth.users u on u.id = a.user_id
    where a.user_id = p_user_id and a.admitted_at is not null and a.revoked_at is null
      and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
      and a.email_fingerprint = public.invitation_email_fingerprint_v1(u.email)
      and not public.public_registration_email_blocked_v1(u.email));
$$;

create function public.bootstrap_public_registration_v1()
returns table(allowed boolean, reason text, access_source text)
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_admission public.app_public_registration_admissions%rowtype;
  v_auth auth.users%rowtype;
  v_profile public.user_access_profiles%rowtype;
  v_gate public.r2b_rollout_gate%rowtype;
  v_enabled boolean;
  v_now timestamptz;
begin
  if v_user_id is null then return query select false, 'not_authenticated', null::text; return; end if;
  select * into v_admission from public.app_public_registration_admissions where user_id = v_user_id;
  if not found then return query select false, 'public_registration_evidence_missing', null::text; return; end if;

  -- Gate and first-admission decisions remain stable until COMMIT. Already admitted
  -- users never lock invitation settings/tables or repair their profile/roles.
  select * into v_gate from public.r2b_rollout_gate where singleton for share;
  if not found or v_gate.mode = 'paused'
    or (v_gate.mode = 'test_only' and v_gate.test_user_id is distinct from v_user_id) then
    return query select false, 'maintenance', null::text; return;
  end if;
  if v_admission.admitted_at is null then
    select enabled into v_enabled from public.app_public_registration_settings where singleton for share;
    if v_enabled is distinct from true then
      return query select false, 'public_registration_disabled', null::text; return;
    end if;
    -- Existing admin writers do not share an email lock. Table SHARE locks cover
    -- both existing veto rows and absent-row inserts, only during first admission.
    lock table public.app_access_allowlist, public.app_invitations in share mode;
  end if;
  select * into v_auth from auth.users where id = v_user_id for update;
  if not found then return query select false, 'auth_user_missing', null::text; return; end if;
  perform 1 from public.profiles where id = v_user_id for update;
  if not found then return query select false, 'profile_missing', null::text; return; end if;
  select * into v_profile from public.user_access_profiles where user_id = v_user_id for update;
  if not found then return query select false, 'access_profile_missing', null::text; return; end if;
  select * into v_admission from public.app_public_registration_admissions where user_id = v_user_id for update;
  if not found then return query select false, 'public_registration_evidence_missing', null::text; return; end if;
  v_now := clock_timestamp();
  if v_admission.revoked_at is not null or v_profile.account_status in ('paused', 'closed')
    or v_profile.beta_access_status = 'blocked' then
    return query select false, 'administratively_blocked', null::text; return;
  end if;
  if v_auth.banned_until > v_now then
    return query select false, 'auth_user_banned', null::text; return;
  end if;
  if v_auth.email_confirmed_at is null then
    return query select false, 'email_not_verified', null::text; return;
  end if;
  if v_admission.email_fingerprint is distinct from public.invitation_email_fingerprint_v1(v_auth.email) then
    return query select false, 'public_registration_identity_changed', null::text; return;
  end if;
  if public.public_registration_email_blocked_v1(v_auth.email) then
    return query select false, 'public_registration_email_blocked', null::text; return;
  end if;
  if v_admission.admitted_at is not null then
    return query select s.allowed, s.reason,
      case when s.allowed then 'public_registration'::text else null::text end
      from public.app_access_status_for_user(v_user_id) s;
    return;
  end if;
  if v_profile.account_status <> 'beta_pending' or v_profile.beta_access_status <> 'pending' then
    return query select false, 'public_registration_profile_changed', null::text; return;
  end if;
  -- Never undo a prior role restriction, even inactive, expired or scheduled.
  -- A concurrent insert can take its unique key before waiting on the profile FK:
  -- PostgreSQL may abort a deadlock participant. The whole admission rolls back;
  -- retry must recheck evidence and role history, never repair the role.
  perform 1 from public.user_role_assignments where user_id = v_user_id for update;
  if exists(select 1 from public.user_role_assignments where user_id = v_user_id and role_code = 'user') then
    return query select false, 'public_registration_role_history', null::text; return;
  end if;
  update public.user_access_profiles set plan_code = 'free', account_status = 'active', beta_access_status = 'approved'
    where user_id = v_user_id;
  insert into public.user_role_assignments(user_id, role_code, assignment_reason, starts_at)
    values(v_user_id, 'user', 'REG-OPEN-01 public registration', v_now);
  update public.app_public_registration_admissions set admitted_at = v_now where user_id = v_user_id;
  return query select true, 'allowed', 'public_registration';
end;
$$;

-- Exact input bodies were certified above. Replace in place: existing OIDs,
-- dependencies, parameter names, signatures and ACL remain intact.
do $reg_expand$
declare v_definition text; v_old text; v_new text;
begin
  v_definition := replace(pg_get_functiondef('public.hook_enforce_app_access_allowlist(jsonb)'::regprocedure), E'\r', '');
  v_old := E'begin\n  if public.is_email_authorized_for_app_access(v_email) then';
  v_new := $hook$begin
  if (public.public_registration_status_v1()->>'enabled')::boolean
    and not public.public_registration_email_blocked_v1(v_email) then
    return '{}'::jsonb;
  end if;
  if public.is_email_authorized_for_app_access(v_email) then$hook$;
  if strpos(v_definition, v_old) = 0 then raise exception 'STOP: hook anchor missing'; end if;
  execute replace(v_definition, v_old, v_new);

  v_definition := replace(pg_get_functiondef('public.bootstrap_current_user_invitation_v1()'::regprocedure), E'\r', '');
  v_old := '  perform 1 from public.app_invitation_program_settings where singleton = true for update;';
  v_new := $bootstrap$  if exists(select 1 from public.app_public_registration_admissions a where a.user_id = v_user_id)
    and not exists(select 1 from auth.users u where u.id = v_user_id
      and public.is_email_authorized_for_app_access(u.email))
    and not exists(select 1 from public.app_invitations i where i.registered_user_id = v_user_id
      and i.invitation_status = 'registered') then
    if not exists(select 1 from public.app_public_registration_admissions a
      where a.user_id = v_user_id and a.admitted_at is not null) then
      perform 1 from public.app_public_registration_settings where singleton for share;
    end if;
    if exists(select 1 from public.app_public_registration_settings where singleton and enabled)
      or exists(select 1 from public.app_public_registration_admissions a
        join auth.users u on u.id = a.user_id where a.user_id = v_user_id
        and (a.admitted_at is not null or a.revoked_at is not null
          or a.email_fingerprint is distinct from public.invitation_email_fingerprint_v1(u.email)
          or u.banned_until > clock_timestamp())) then
      return query select * from public.bootstrap_public_registration_v1();
      return;
    end if;
  end if;
  perform 1 from public.app_invitation_program_settings where singleton = true for update;$bootstrap$;
  if strpos(v_definition, v_old) = 0 then raise exception 'STOP: bootstrap anchor missing'; end if;
  execute replace(v_definition, v_old, v_new);

  v_definition := replace(pg_get_functiondef('public.app_access_status_for_user(uuid)'::regprocedure), E'\r', '');
  v_old := 'if not (coalesce(v_allowlist_found, false) or v_has_registered_invitation) then';
  v_new := 'if not (coalesce(v_allowlist_found, false) or v_has_registered_invitation or public.public_registration_admission_valid_v1(p_user_id)) then';
  if strpos(v_definition, v_old) = 0 then raise exception 'STOP: access anchor missing'; end if;
  execute replace(v_definition, v_old, v_new);
  if (select md5(replace(prosrc,E'\r','')) from pg_proc
      where oid='public.app_access_status_for_user(uuid)'::regprocedure)
    is distinct from (case when (select md5(replace(prosrc,E'\r','')) from pg_proc
      where oid='public.set_r2b_rollout_gate(text,uuid)'::regprocedure)='989795c48d4d86eea224b26e7752a874'
      then '17fd2247f0d585f2e3cfd84700bfe92f' else '89ca95c07a760b0cbb77f42bbff3cf1f' end)
  then raise exception 'STOP: expanded access body drift'; end if;

  -- DEV retains its existing tester membership. The standard variant never
  -- references the DEV-only column, and REG-OPEN never replaces the gate setter.
  if (select md5(replace(prosrc,E'\r','')) from pg_proc
    where oid='public.set_r2b_rollout_gate(text,uuid)'::regprocedure)='989795c48d4d86eea224b26e7752a874' then
    v_definition := replace(pg_get_functiondef('public.bootstrap_public_registration_v1()'::regprocedure), E'\r', '');
    v_old := 'or (v_gate.mode = ''test_only'' and v_gate.test_user_id is distinct from v_user_id)';
    v_new := $gate$or (v_gate.mode = 'test_only' and v_gate.test_user_id is distinct from v_user_id
      and not coalesce(v_user_id = any(v_gate.additional_test_user_ids), false))$gate$;
    if strpos(v_definition,v_old)=0 then raise exception 'STOP: public bootstrap gate anchor missing'; end if;
    execute replace(v_definition,v_old,v_new);
    if (select md5(replace(prosrc,E'\r','')) from pg_proc
      where oid='public.bootstrap_public_registration_v1()'::regprocedure) is distinct from '26cd9264451ccf34d3779815b3db992b'
    then raise exception 'STOP: expanded bootstrap body drift'; end if;
  end if;
end $reg_expand$;

do $reg_acl$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.public_registration_status_v1()',
    'public.admin_public_registration_state_v1()',
    'public.admin_set_public_registration_v1(boolean,bigint)',
    'public.public_registration_email_blocked_v1(text)',
    'public.capture_public_registration_candidate_v1()',
    'public.public_registration_admission_valid_v1(uuid)',
    'public.bootstrap_public_registration_v1()'
  ] loop
    execute format('alter function %s owner to postgres', v_signature);
    execute format('revoke all on function %s from public, anon, authenticated, service_role, supabase_auth_admin', v_signature);
  end loop;
end $reg_acl$;
grant execute on function public.public_registration_status_v1() to anon, authenticated;
grant usage on schema public to anon;
grant execute on function public.admin_public_registration_state_v1() to authenticated;
grant execute on function public.admin_set_public_registration_v1(boolean,bigint) to authenticated;

comment on table public.app_public_registration_admissions is
  'Private REG-OPEN-01 Auth INSERT evidence and persistent public admission. No client DML or legacy backfill; email changes fail closed.';
comment on function public.bootstrap_public_registration_v1() is
  'Private transactional first admission; OFF affects only pending evidence. Never repairs roles, consumes invitations, or bypasses explicit blocks.';
commit;
