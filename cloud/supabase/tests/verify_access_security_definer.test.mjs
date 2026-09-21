import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSql = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const verifier = readSql('../verifiers/202609090002_verify_access.sql');
const migrations = [
  readSql('../migrations/202609090003_access_functions.sql'),
  readSql('../migrations/202609090004_application_rpcs.sql'),
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

test('every Coffeecito SECURITY DEFINER function is in the scoped verifier inventory', () => {
  const internal = expectedNames('internal_functions')
    .filter((name) => !['set_updated_at', 'normalize_app_access_email'].includes(name));
  const authenticated = expectedNames('authenticated_functions');
  const scoped = [
    ...internal,
    ...authenticated,
    'hook_enforce_app_access_allowlist',
    'finalize_google_connected_account_verified',
  ];
  const defined = migrations.flatMap(migrationDefinerNames);

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
