import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSql = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const verifier = readSql('../verifiers/202610210001_verify_access_expand_pre_contract.sql');
const phaseFunctions = {
  internal_functions: ['user_has_provider_rollout_for_user_v1(uuid,text)'],
  authenticated_functions: [
    'current_user_can_start_connected_oauth_v1(text)',
    'current_user_can_sync_connected_account_v1(uuid,text)',
    'apply_google_contact_sync_change_v1(uuid,jsonb)',
    'apply_google_interaction_sync_v1(uuid,jsonb)',
  ],
};
const migrations = [
  readSql('../migrations/202609090003_access_functions.sql'),
  readSql('../migrations/202609090004_application_rpcs.sql'),
  readSql('../migrations/202610120001_require_ics_focus_contacts_v1.sql'),
  readSql('../migrations/202610140001_enforce_ics_networking_start_v1.sql'),
  readSql('../migrations/202610150001_contact_requests_v1.sql'),
  readSql('../migrations/202610150002_legal_acceptance_v1.sql'),
  readSql('../migrations/202610150003_legal_acceptance_v1_1.sql'),
  readSql('../migrations/202610210001_google_sync_capability_enforcement_v1.sql'),
];

function expectedNames(listName) {
  const list = verifier.match(new RegExp(`${listName} regprocedure\\[\\] := array\\[([\\s\\S]*?)\\];`));
  assert.ok(list, `${listName} is missing`);
  return [...list[1].matchAll(/'public\.([a-z0-9_]+)\([^']*\)'::regprocedure/g)]
    .map((match) => match[1]);
}

function migrationDefinerNames(sql) {
  const definitions = [...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\s*\(/gi)];
  return definitions
    .filter((definition) => {
      const header = sql.slice(definition.index, sql.indexOf('as $$', definition.index));
      return /\bsecurity definer\b/i.test(header);
    })
    .map((definition) => definition[1]);
}

test('expand verifier preserves every canonical check without reading reserved contract files', () => {
  let canonical = verifier.replace(/\r\n?/g, '\n');
  canonical = canonical.slice(canonical.indexOf('-- Fails unless'));
  canonical = canonical.replace('begin transaction read only;\n\n', '').replace(/\nrollback;\s*$/, '');
  for (const signatures of Object.values(phaseFunctions)) {
    for (const signature of signatures) {
      const line = `    'public.${signature}'::regprocedure,\n`;
      assert.equal(canonical.split(line).length, 2);
      canonical = canonical.replace(line, '');
    }
  }
  // Canonical 202609090002 at 88b6ad3, LF-normalized and trimmed. A phase
  // change may add classifications, never silently remove canonical controls.
  assert.equal(createHash('sha256').update(canonical.trim()).digest('hex'),
    '100c04fe67df99a44d540a9a998dd12d1a4722a83c9f35ef589eaf56d29d5de8');
  assert.match(verifier, /begin transaction read only;/i);
  assert.match(verifier, /rollback;\s*$/i);
});

test('expand classifies exact signatures and keeps internal helper inaccessible to clients', () => {
  for (const [listName, signatures] of Object.entries(phaseFunctions)) {
    const list = verifier.match(new RegExp(`${listName} regprocedure\\[\\] := array\\[([\\s\\S]*?)\\];`));
    for (const signature of signatures) assert.ok(list[1].includes(`'public.${signature}'::regprocedure`));
  }
  assert.match(verifier, /acl\.grantee = 0/);
  for (const role of ['anon', 'authenticated', 'service_role', 'supabase_auth_admin']) {
    assert.ok(verifier.includes(`has_function_privilege('${role}', app_function, 'EXECUTE')`));
  }
  assert.equal(expectedNames('service_role_functions').includes('user_has_provider_rollout_for_user_v1'), false);
  assert.equal(expectedNames('authenticated_functions').includes('user_has_provider_rollout_for_user_v1'), false);
});

test('every Coffeecito SECURITY DEFINER function is in the scoped verifier inventory', () => {
  const internal = expectedNames('internal_functions')
    .filter((name) => !['set_updated_at', 'normalize_app_access_email'].includes(name));
  const authenticated = expectedNames('authenticated_functions');
  const scoped = [
    ...internal,
    ...authenticated,
    'hook_enforce_app_access_allowlist',
    'finalize_google_connected_account_verified',
    'submit_contact_request_v1',
  ];
  const defined = [...new Set(migrations.flatMap(migrationDefinerNames))];

  assert.equal(new Set(scoped).size, scoped.length);
  assert.deepEqual(scoped.sort(), defined.sort());
  assert.ok(!scoped.includes('rls_auto_enable'));
});

test('scoped functions must remain SECURITY DEFINER with empty search_path and postgres owner', () => {
  const check = verifier.match(/foreach app_function in array security_definer_functions loop([\s\S]*?)end loop;/);
  assert.ok(check, 'scoped SECURITY DEFINER check is missing');
  assert.match(check[1], /procedure\.oid = app_function and procedure\.prosecdef/);
  const pathGuard = check[1].match(/if not exists \(([\s\S]*?)\) then\s*raise exception 'Coffeecito SECURITY DEFINER function % does not use an empty search_path'/);
  assert.ok(pathGuard, 'a non-empty or missing search_path must raise an exception');
  assert.match(pathGuard[1], /procedure\.oid = app_function/);
  assert.match(pathGuard[1], /config in \('search_path=', 'search_path=""'\)/);
  assert.match(check[1], /pg_catalog\.pg_get_userbyid\(procedure\.proowner\) = 'postgres'/);
  assert.doesNotMatch(check[1], /namespace\.nspname = 'public'/);
});
