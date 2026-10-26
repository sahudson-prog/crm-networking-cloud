import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSql = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const previous = readSql('../verifiers/202610250001_verify_access_invitation_composed.sql');
const verifier = readSql('../verifiers/202610260001_verify_access_starting_point_composed.sql');
const r1Signatures = [
  'current_user_starting_point_v1()',
  'save_current_user_starting_point_v1(text,text,date)',
];

const migrations = [
  '../migrations/202609090003_access_functions.sql',
  '../migrations/202609090004_application_rpcs.sql',
  '../migrations/202610120001_require_ics_focus_contacts_v1.sql',
  '../migrations/202610140001_enforce_ics_networking_start_v1.sql',
  '../migrations/202610150001_contact_requests_v1.sql',
  '../migrations/202610150002_legal_acceptance_v1.sql',
  '../migrations/202610150003_legal_acceptance_v1_1.sql',
  '../migrations/202610210001_google_sync_capability_enforcement_v1.sql',
  '../migrations/202610250001_invitation_access_v1.sql',
  '../migrations/202610250002_invitation_admin_state_v1.sql',
  '../migrations/202610260001_starting_point_v1.sql',
].map(readSql);

function expectedNames(listName) {
  const list = verifier.match(new RegExp(`${listName} regprocedure\\[\\] := array\\[([\\s\\S]*?)\\];`));
  assert.ok(list, `${listName} is missing`);
  return [...list[1].matchAll(/'public\.([a-z0-9_]+)\([^']*\)'::regprocedure/g)].map((match) => match[1]);
}

function definerNames(sql) {
  return [...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\s*\(/gi)]
    .filter((match) => /\bsecurity definer\b/i.test(sql.slice(match.index, sql.indexOf('as $$', match.index))))
    .map((match) => match[1]);
}

test('R1 composition preserves the complete INV-01 pre-contract verifier', () => {
  let stripped = verifier
    .replace(
      '-- Phase-specific composed verifier: Google expand, INV-01 and OBJ-02 R1 are applied,\n',
      '-- Phase-specific composed verifier: Google expand and INV-01 are applied,\n',
    );
  for (const signature of r1Signatures) {
    const line = `    'public.${signature}'::regprocedure,\n`;
    assert.equal(stripped.split(line).length, 2);
    stripped = stripped.replace(line, '');
  }
  assert.equal(stripped, previous);
  assert.match(verifier, /begin transaction read only;/i);
  assert.match(verifier, /rollback;\s*$/i);
});

test('R1 functions are authenticated-only and remain inside all SECURITY DEFINER checks', () => {
  const authenticated = expectedNames('authenticated_functions');
  for (const signature of r1Signatures) {
    assert.ok(verifier.includes(`'public.${signature}'::regprocedure`));
    assert.ok(authenticated.includes(signature.slice(0, signature.indexOf('('))));
  }
  assert.match(verifier, /has_function_privilege\('anon', app_function, 'EXECUTE'\)/);
  assert.match(verifier, /has_function_privilege\('service_role', app_function, 'EXECUTE'\)/);
  assert.match(verifier, /procedure\.prosecdef/);
  assert.match(verifier, /search_path=/);
  assert.match(verifier, /pg_catalog\.pg_get_userbyid\(procedure\.proowner\) = 'postgres'/);
});

test('every scoped SECURITY DEFINER implementation is classified once', () => {
  const internal = expectedNames('internal_functions').filter((name) => ![
    'set_updated_at', 'normalize_app_access_email', 'invitation_email_fingerprint_v1', 'invitation_expires_at_v1',
  ].includes(name));
  const scoped = [
    ...internal,
    ...expectedNames('authenticated_functions'),
    'hook_enforce_app_access_allowlist',
    'finalize_google_connected_account_verified',
    'submit_contact_request_v1',
  ];
  const defined = [...new Set(migrations.flatMap(definerNames))];
  assert.equal(new Set(scoped).size, scoped.length);
  assert.deepEqual(scoped.sort(), defined.sort());
});
