import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_MIGRATION_SHA256 = '919aa78dbd2305455f3b7c40cef3bc6529e47f63d21b2e9d17eaa7d9a35d3136';
const PROD_PROJECT_REF = 'ppowxoglqspwvsgyxlft';
const ownerAcl = { grantor: 'postgres', grantee: 'postgres', privilege: 'EXECUTE', grantable: false };
const authenticatedAcl = { grantor: 'postgres', grantee: 'authenticated', privilege: 'EXECUTE', grantable: false };
const serviceRoleAcl = { grantor: 'postgres', grantee: 'service_role', privilege: 'EXECUTE', grantable: false };
const sqlStable = {
  owner: 'postgres', language: 'sql', securityDefiner: true, volatility: 's',
  parallelSafety: 'u', strict: false, leakproof: false, kind: 'f', returnsSet: false,
  proconfig: ['search_path=""'],
};
const plpgsqlVolatile = {
  owner: 'postgres', language: 'plpgsql', securityDefiner: true, volatility: 'v',
  parallelSafety: 'u', strict: false, leakproof: false, kind: 'f', returnsSet: false,
  proconfig: ['search_path=""'],
};
const EXPECTED_EXPAND_FUNCTION_STATE = {
  'public.apply_google_contact_sync_change_v1(uuid,jsonb)': {
    ...plpgsqlVolatile, bodyMd5: '55ccb0f98c7b9d0c1401432cc3a6b11e',
    definitionMd5: 'c9c3caa85f3cd6588df0e79d557eb948', acl: [ownerAcl, authenticatedAcl],
  },
  'public.apply_google_interaction_sync_v1(uuid,jsonb)': {
    ...plpgsqlVolatile, bodyMd5: 'bcc3ca6580e45ee31a307269bb1764dd',
    definitionMd5: '9037af511a6036818312c5023efe0452', acl: [ownerAcl, authenticatedAcl],
  },
  'public.current_user_can_start_connected_oauth_v1(text)': {
    ...sqlStable, bodyMd5: '2416f700a17267a27830605ba30b49f9',
    definitionMd5: 'dc284e4ba0555d9bb62a56d8f454cb07', acl: [ownerAcl, authenticatedAcl],
  },
  'public.current_user_can_sync_connected_account_v1(uuid,text)': {
    ...sqlStable, bodyMd5: '87b109e1eb93bbcd347255f55af637e1',
    definitionMd5: '3fa33b2247116359954070051f51c1ba', acl: [ownerAcl, authenticatedAcl],
  },
  'public.finalize_google_connected_account_verified(uuid,text,text[])': {
    ...plpgsqlVolatile, bodyMd5: '0b67358ea7db20b7f353bb69ffc81064',
    definitionMd5: 'b3fbb02563268a32e05e9a4849bf7410', returnsSet: true,
    acl: [ownerAcl, serviceRoleAcl],
  },
  'public.user_has_provider_rollout_for_user_v1(uuid,text)': {
    ...sqlStable, bodyMd5: 'ea863e0b1387d1f58368b2d990f08095',
    definitionMd5: '4eb2a76712dfe830cc5e44a0561365ef', acl: [ownerAcl],
  },
};
const CAPABILITIES = [
  'connectors.google.use',
  'contacts.sync_external',
  'interactions.sync_email',
  'interactions.sync_calendar',
];
const NEW_FUNCTIONS = [
  'public.apply_google_contact_sync_change_v1(uuid,jsonb)',
  'public.apply_google_interaction_sync_v1(uuid,jsonb)',
  'public.current_user_can_sync_connected_account_v1(uuid,text)',
  'public.current_user_can_start_connected_oauth_v1(text)',
  'public.user_has_provider_rollout_for_user_v1(uuid,text)',
];
const FINALIZE = 'public.finalize_google_connected_account_verified(uuid,text,text[])';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const snapshotPath = args.get('--snapshot');
const outputPath = args.get('--output');
const approval = args.get('--approve') ?? '';
if (!snapshotPath || !outputPath) {
  throw new Error('Usage: node build-sec-google-01-expand-recovery.mjs --snapshot <capture.json> --output <recovery.sql> [--approve <payload_md5>]');
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const md5 = (value) => createHash('md5').update(value).digest('hex');
const quoteLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const sqlTextArray = (values) => values == null
  ? 'null::text[]'
  : `array[${values.map(quoteLiteral).join(', ')}]::text[]`;

function parseEnvelope(raw) {
  let parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) parsed = parsed[0];
  if (parsed?.sec_google_01_expand_capture) parsed = parsed.sec_google_01_expand_capture;
  if (typeof parsed === 'string') parsed = JSON.parse(parsed);
  return parsed;
}

const rawCapture = readFileSync(resolve(snapshotPath), 'utf8').trim();
const envelope = parseEnvelope(rawCapture);
assert.equal(envelope.capture_version, 'sec-google-01-expand-envelope-v1');
assert.equal(envelope.payload_encoding, 'base64-utf8');
const payloadBuffer = Buffer.from(envelope.payload_base64, 'base64');
assert.equal(payloadBuffer.byteLength, Number(envelope.payload_bytes), 'Capture byte count mismatch');
assert.equal(md5(payloadBuffer), envelope.payload_md5, 'Capture MD5 mismatch');
const snapshot = JSON.parse(payloadBuffer.toString('utf8'));
assert.equal(snapshot.capture_version, 'sec-google-01-expand-v1');
assert.deepEqual(snapshot.manifest, { capabilities: 4, functions: 6, tables: 1 });
assert.deepEqual(snapshot.stop_reasons, [], `Capture STOP reasons: ${snapshot.stop_reasons?.join(', ')}`);
assert.equal(snapshot.executor, 'postgres');
assert.equal(snapshot.capabilities.length, CAPABILITIES.length);
assert.equal(snapshot.functions.length, 6);
assert.equal(snapshot.beta_tester_role_grants.length, CAPABILITIES.length);
assert.deepEqual(
  snapshot.functions.map((state) => state.signature).sort(),
  Object.keys(EXPECTED_EXPAND_FUNCTION_STATE).sort(),
  'Capture function manifest differs from the certified expand manifest',
);

for (const capability of snapshot.capabilities) {
  assert.ok(CAPABILITIES.includes(capability.capability_code));
  assert.equal(capability.exists, false, `Capability already existed: ${capability.capability_code}`);
  assert.equal(Number(capability.role_grant_count), 0);
  assert.equal(Number(capability.plan_grant_count), 0);
  assert.equal(Number(capability.override_count), 0);
}
for (const grant of snapshot.beta_tester_role_grants) assert.equal(grant.exists, false);
for (const state of snapshot.functions) {
  assert.equal(state.exists, state.signature === FINALIZE, `Unexpected pre-expand function state: ${state.signature}`);
}
const finalize = snapshot.functions.find((state) => state.signature === FINALIZE);
assert.ok(finalize?.definition);
assert.equal(finalize.owner_name, 'postgres');
assert.equal(finalize.security_definer, true);
assert.ok(finalize.acl_entries.every((entry) => ['postgres', 'service_role'].includes(entry.grantee)));
assert.ok(finalize.acl_entries.every((entry) => entry.grantor === 'postgres'));
assert.equal(snapshot.connected_accounts.exists, true);
assert.equal(snapshot.connected_accounts.owner, 'postgres');
assert.equal(snapshot.connected_accounts.rls_enabled, true);
assert.equal(snapshot.connected_accounts.force_rls, false);
const finalizeDefinition = finalize.definition.trim().endsWith(';')
  ? finalize.definition.trim()
  : `${finalize.definition.trim()};`;
const capturedFinalizeDefinitionMd5 = md5(Buffer.from(finalize.definition, 'utf8'));

const scriptDir = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(scriptDir, '../../migrations/202610210001_google_sync_capability_enforcement_v1.sql');
const migration = readFileSync(migrationPath, 'utf8').replace(/\r\n?/g, '\n');
assert.equal(sha256(Buffer.from(migration, 'utf8')), EXPECTED_MIGRATION_SHA256, 'Expand migration changed; regenerate and recertify recovery tooling');
for (const state of Object.values(EXPECTED_EXPAND_FUNCTION_STATE)) {
  assert.match(state.bodyMd5, /^[0-9a-f]{32}$/, 'Expanded function body hash is not certified');
  assert.match(state.definitionMd5, /^[0-9a-f]{32}$/, 'Expanded function definition hash is not certified');
}

const expectedAclValues = finalize.acl_entries.map((entry) =>
  `(${quoteLiteral(entry.grantor)}, ${quoteLiteral(entry.grantee)}, ${quoteLiteral(entry.privilege)}, ${entry.grantable ? 'true' : 'false'})`,
).join(',\n    ');
const capturedAclGrants = finalize.acl_entries
  .filter((entry) => entry.grantee !== 'postgres')
  .map((entry) => `grant ${entry.privilege.toLowerCase()} on function ${FINALIZE} to ${entry.grantee === 'PUBLIC' ? 'PUBLIC' : quoteIdentifier(entry.grantee)}${entry.grantable ? ' with grant option' : ''};`)
  .join('\n');
const aclDifferenceSql = (signature, entries) => {
  const values = entries.map((entry) =>
    `(${quoteLiteral(entry.grantor)}, ${quoteLiteral(entry.grantee)}, ${quoteLiteral(entry.privilege)}, ${entry.grantable ? 'true' : 'false'})`,
  ).join(', ');
  const actual = `select pg_catalog.pg_get_userbyid(acl.grantor),
        case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end,
        acl.privilege_type, acl.is_grantable
      from pg_catalog.pg_proc procedure
      cross join lateral pg_catalog.aclexplode(coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) acl
      where procedure.oid = pg_catalog.to_regprocedure(${quoteLiteral(signature)})`;
  return `exists (
      (${actual}
       except select * from (values ${values}) expected(grantor_name, grantee_name, privilege_type, is_grantable))
      union all
      (select * from (values ${values}) expected(grantor_name, grantee_name, privilege_type, is_grantable)
       except ${actual})
    )`;
};
const expectedFunctionStateChecks = Object.entries(EXPECTED_EXPAND_FUNCTION_STATE)
  .map(([signature, state]) => `
    if not exists (
      select 1
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_language language on language.oid = procedure.prolang
      where procedure.oid = pg_catalog.to_regprocedure(${quoteLiteral(signature)})
        and pg_catalog.pg_get_userbyid(procedure.proowner) = ${quoteLiteral(state.owner)}
        and language.lanname = ${quoteLiteral(state.language)}
        and procedure.prosecdef is ${state.securityDefiner ? 'true' : 'false'}
        and procedure.provolatile::text = ${quoteLiteral(state.volatility)}
        and procedure.proparallel::text = ${quoteLiteral(state.parallelSafety)}
        and procedure.proisstrict is ${state.strict ? 'true' : 'false'}
        and procedure.proleakproof is ${state.leakproof ? 'true' : 'false'}
        and procedure.prokind::text = ${quoteLiteral(state.kind)}
        and procedure.proretset is ${state.returnsSet ? 'true' : 'false'}
        and procedure.proconfig is not distinct from ${sqlTextArray(state.proconfig)}
        and md5(procedure.prosrc) = ${quoteLiteral(state.bodyMd5)}
        and md5(pg_catalog.pg_get_functiondef(procedure.oid)) = ${quoteLiteral(state.definitionMd5)}
    ) then
      raise exception 'Expanded function definition or security properties changed: ${signature}';
    end if;
    if ${aclDifferenceSql(signature, state.acl)} then
      raise exception 'Expanded function ACL changed: ${signature}';
    end if;`)
  .join('');
const capabilityList = CAPABILITIES.map(quoteLiteral).join(', ');
const approvalGuard = approval === envelope.payload_md5
  ? `-- Explicit generation approval matched capture ${envelope.payload_md5}.`
  : `do $$ begin raise exception 'DRAFT ONLY: regenerate with --approve ${envelope.payload_md5} after explicit recovery authorization'; end $$;`;

const sql = `-- Generated SEC-GOOGLE-01 expand recovery.
-- Capture MD5: ${envelope.payload_md5}
-- Capture bytes: ${envelope.payload_bytes}
-- Expand migration SHA-256: ${EXPECTED_MIGRATION_SHA256}
-- This restores the captured pre-expand catalog state. It does not restore a database backup.
-- MANUAL PROJECT GATE: confirm Supabase project ${PROD_PROJECT_REF} before execution.
-- PostgreSQL database_name is not an environment identifier and is intentionally not used as one.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

${approvalGuard}

do $preconditions$
begin
  if current_user <> 'postgres' then raise exception 'Recovery must run as postgres'; end if;
  if exists (
    select 1 from (values
      ('connectors.google.use', 'Usar conector Google', 'connectors', 'Elegibilidad temporal de rollout para autorizar y usar Google Connected Account.'),
      ('contacts.sync_external', 'Sincronizar contactos externos', 'contacts', 'Leer y aplicar cambios de contactos desde un proveedor conectado autorizado.'),
      ('interactions.sync_email', 'Sincronizar email externo', 'interactions', 'Leer y aplicar actividad de email desde un proveedor conectado autorizado.'),
      ('interactions.sync_calendar', 'Sincronizar calendario externo', 'interactions', 'Leer y aplicar actividad de calendario desde un proveedor conectado autorizado.')
    ) expected(code, display_name, area, description)
    left join public.app_capabilities actual on actual.capability_code = expected.code
    where actual.capability_code is null or actual.display_name <> expected.display_name
      or actual.capability_area <> expected.area or actual.description <> expected.description or not actual.is_active
  ) then raise exception 'Expanded capability catalog differs from 202610210001'; end if;
  if (select count(*) from public.app_role_capabilities where role_code = 'beta_tester' and capability_code in (${capabilityList})) <> 4 then
    raise exception 'beta_tester expanded grants are incomplete';
  end if;
  if exists (select 1 from public.app_role_capabilities where capability_code in (${capabilityList}) and role_code <> 'beta_tester')
    or exists (select 1 from public.subscription_plan_capabilities where capability_code in (${capabilityList}))
    or exists (select 1 from public.user_capability_overrides where capability_code in (${capabilityList})) then
    raise exception 'Post-expand capability references require manual recovery review';
  end if;${expectedFunctionStateChecks}
  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'connected_accounts'
      and relation.relkind = 'r'
      and pg_catalog.pg_get_userbyid(relation.relowner) = ${quoteLiteral(snapshot.connected_accounts.owner)}
      and relation.relrowsecurity is ${snapshot.connected_accounts.rls_enabled ? 'true' : 'false'}
      and relation.relforcerowsecurity is ${snapshot.connected_accounts.force_rls ? 'true' : 'false'}
  ) then
    raise exception 'connected_accounts owner or RLS configuration changed after capture';
  end if;
  if (select relacl::text from pg_catalog.pg_class where oid = 'public.connected_accounts'::regclass) is distinct from ${quoteLiteral(snapshot.connected_accounts.raw_acl)} then
    raise exception 'connected_accounts ACL changed after capture';
  end if;
end
$preconditions$;

create temporary table sec_google_01_preserved_counts on commit drop as
select
  (select count(*) from public.connected_accounts) as connected_accounts,
  (select count(*) from public.contacts) as contacts,
  (select count(*) from public.external_contact_ids) as external_contact_ids,
  (select count(*) from public.external_contact_snapshots) as external_contact_snapshots,
  (select count(*) from public.interactions) as interactions,
  (select count(*) from public.external_interaction_sources) as external_interaction_sources,
  (select count(*) from public.sync_cursors) as sync_cursors;

create temporary table sec_google_01_expected_finalize_acl(
  grantor_name text not null,
  grantee_name text not null,
  privilege_type text not null,
  is_grantable boolean not null
) on commit drop;
insert into sec_google_01_expected_finalize_acl values
    ${expectedAclValues};

${finalizeDefinition}
alter function ${FINALIZE} owner to ${quoteIdentifier(finalize.owner_name)};
revoke all on function ${FINALIZE} from PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
${capturedAclGrants}

${NEW_FUNCTIONS.map((signature) => `drop function ${signature};`).join('\n')}

delete from public.app_role_capabilities
where role_code = 'beta_tester' and capability_code in (${capabilityList});
delete from public.app_capabilities where capability_code in (${capabilityList});

do $assertions$
begin
  if exists (select 1 from public.app_capabilities where capability_code in (${capabilityList})) then
    raise exception 'Expanded capabilities remain after recovery';
  end if;
  if exists (select 1 from public.app_role_capabilities where capability_code in (${capabilityList})) then
    raise exception 'Expanded role grants remain after recovery';
  end if;
  if exists (select 1 from unnest(array[${NEW_FUNCTIONS.map(quoteLiteral).join(', ')}]) signature where pg_catalog.to_regprocedure(signature) is not null) then
    raise exception 'A new expand function remains after recovery';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language on language.oid = procedure.prolang
    where procedure.oid = pg_catalog.to_regprocedure(${quoteLiteral(FINALIZE)})
      and pg_catalog.pg_get_userbyid(procedure.proowner) = ${quoteLiteral(finalize.owner_name)}
      and language.lanname = ${quoteLiteral(finalize.language_name)}
      and procedure.prosecdef is ${finalize.security_definer ? 'true' : 'false'}
      and procedure.provolatile::text = ${quoteLiteral(finalize.volatility)}
      and procedure.proparallel::text = ${quoteLiteral(finalize.parallel_safety)}
      and procedure.proisstrict is ${finalize.strict ? 'true' : 'false'}
      and procedure.proleakproof is ${finalize.leakproof ? 'true' : 'false'}
      and procedure.proconfig is not distinct from ${sqlTextArray(finalize.proconfig)}
      and md5(procedure.prosrc) = ${quoteLiteral(finalize.body_md5)}
      and md5(pg_catalog.pg_get_functiondef(procedure.oid)) = ${quoteLiteral(capturedFinalizeDefinitionMd5)}
  ) then
    raise exception 'finalize_google_connected_account_verified definition or security properties were not restored';
  end if;
  if exists (
    (select pg_catalog.pg_get_userbyid(acl.grantor), case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end, acl.privilege_type, acl.is_grantable
      from pg_catalog.pg_proc procedure, lateral pg_catalog.aclexplode(coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) acl
      where procedure.oid = ${quoteLiteral(FINALIZE)}::regprocedure
     except select grantor_name, grantee_name, privilege_type, is_grantable from sec_google_01_expected_finalize_acl)
    union all
    (select grantor_name, grantee_name, privilege_type, is_grantable from sec_google_01_expected_finalize_acl
     except select pg_catalog.pg_get_userbyid(acl.grantor), case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end, acl.privilege_type, acl.is_grantable
      from pg_catalog.pg_proc procedure, lateral pg_catalog.aclexplode(coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) acl
      where procedure.oid = ${quoteLiteral(FINALIZE)}::regprocedure)
  ) then raise exception 'finalize_google_connected_account_verified ACL was not restored'; end if;
  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'connected_accounts'
      and relation.relkind = 'r'
      and pg_catalog.pg_get_userbyid(relation.relowner) = ${quoteLiteral(snapshot.connected_accounts.owner)}
      and relation.relrowsecurity is ${snapshot.connected_accounts.rls_enabled ? 'true' : 'false'}
      and relation.relforcerowsecurity is ${snapshot.connected_accounts.force_rls ? 'true' : 'false'}
  ) then
    raise exception 'connected_accounts owner or RLS configuration changed during recovery';
  end if;
  if (select relacl::text from pg_catalog.pg_class where oid = 'public.connected_accounts'::regclass) is distinct from ${quoteLiteral(snapshot.connected_accounts.raw_acl)} then
    raise exception 'connected_accounts ACL changed during recovery';
  end if;
  if exists (
    select 1 from sec_google_01_preserved_counts before
    where before.connected_accounts <> (select count(*) from public.connected_accounts)
       or before.contacts <> (select count(*) from public.contacts)
       or before.external_contact_ids <> (select count(*) from public.external_contact_ids)
       or before.external_contact_snapshots <> (select count(*) from public.external_contact_snapshots)
       or before.interactions <> (select count(*) from public.interactions)
       or before.external_interaction_sources <> (select count(*) from public.external_interaction_sources)
       or before.sync_cursors <> (select count(*) from public.sync_cursors)
  ) then raise exception 'Application-owned row counts changed during recovery'; end if;
end
$assertions$;

commit;
`;

writeFileSync(resolve(outputPath), sql, 'utf8');
console.log(JSON.stringify({
  approved: approval === envelope.payload_md5,
  captureMd5: envelope.payload_md5,
  migrationSha256: EXPECTED_MIGRATION_SHA256,
  output: resolve(outputPath),
}));
