-- REG-OPEN PROD context, before installation and after the final verifier.
-- NOT a replacement for either installation preflight or composed verifier.
-- Owner must select PROD ppowxoglqspwvsgyxlft: database name is not tenant identity.
-- No writer RPCs, user rows, gate changes or permission repairs.
begin isolation level repeatable read read only;
set local statement_timeout = '30s';
set local lock_timeout = '3s';

do $context$
declare r record; p pg_proc%rowtype; who text; closed boolean;
begin
  if current_user <> 'postgres' then raise exception 'STOP: postgres required'; end if;
  if (select count(*) from public.r2b_rollout_gate) <> 1
    or not exists(select 1 from public.r2b_rollout_gate where singleton and mode='open' and test_user_id is null)
    or exists(select 1 from pg_attribute where attrelid='public.r2b_rollout_gate'::regclass
      and attname='additional_test_user_ids' and not attisdropped)
  then raise exception 'STOP: expected PROD standard R2-B open; do not change the gate'; end if;

  for r in select * from (values
    ('public.set_r2b_rollout_gate(text,uuid)','867ff4ec5f934c919d7787342e74a70f','','void'),
    ('public.finalize_google_connected_account_verified(uuid,text,text[])','4705a448d879fcfa35155d9deb3fc654','service_role','TABLE(id uuid, provider text, account_email text, scopes text[], capabilities jsonb, status text, connected_at timestamp with time zone, revoked_at timestamp with time zone, updated_at timestamp with time zone)'),
    ('public.submit_contact_request_v1(text,text,text,text,text,uuid)','ee13e27bf0fbb93dff33a4086afb6798','service_role','uuid')
  ) x(signature,hash,client,result) loop
    select * into p from pg_proc where oid=to_regprocedure(r.signature);
    if not found or p.prokind<>'f' or not p.prosecdef or p.proowner<>'postgres'::regrole
      or p.proconfig is distinct from array['search_path=""']
      or p.provolatile<>'v' or p.prolang<>(select oid from pg_language where lanname='plpgsql')
      or pg_get_function_result(p.oid)<>r.result
      or md5(replace(p.prosrc,E'\r',''))<>r.hash
      or (select count(*) from pg_proc q where q.pronamespace=p.pronamespace and q.proname=p.proname)<>1
      or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee not in ('postgres'::regrole,coalesce(nullif(r.client,'')::regrole,'postgres'::regrole))
          or (a.is_grantable and a.grantee<>'postgres'::regrole))
    then raise exception 'STOP: PROD context function drift: %',r.signature; end if;
    foreach who in array array['anon','authenticated','service_role','supabase_auth_admin'] loop
      if has_function_privilege(who,p.oid,'EXECUTE') is distinct from (who=r.client)
      then raise exception 'STOP: PROD context effective EXECUTE drift: % / %',r.signature,who; end if;
    end loop;
  end loop;

  -- Dynamic SQL keeps this context check valid before REG-OPEN tables exist.
  if to_regclass('public.app_public_registration_settings') is not null then
    execute 'select count(*)=1 and coalesce(bool_and(singleton and not enabled),false)
      from public.app_public_registration_settings' into closed;
    if closed is distinct from true then raise exception 'STOP: public registration must remain OFF'; end if;
  end if;
end $context$;

select jsonb_build_object('verdict','pass','scope','PROD context only',
  'r2b_variant','standard','gate','open',
  'registration_state',case when to_regclass('public.app_public_registration_settings') is null then 'not_installed' else 'OFF' end,
  'finalize_service_execute',true,'contact_request_service_execute',true,
  'project_identity','Owner must verify ppowxoglqspwvsgyxlft in SQL Editor') as reg_open_prod_context;
rollback;
