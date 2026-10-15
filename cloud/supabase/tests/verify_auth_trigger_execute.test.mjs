import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSql = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = readSql('../migrations/202610130003_harden_auth_trigger_execute.sql');
const verifier = readSql('../verifiers/202610130003_verify_auth_trigger_execute.sql');

test('migration changes only EXECUTE on the auth trigger function', () => {
  const executableSql = migration
    .replace(/^--.*$/gm, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  assert.equal(
    executableSql,
    'begin; revoke execute on function public.handle_new_auth_user_profile() ' +
      'from public, anon, authenticated, service_role, supabase_auth_admin; commit;',
  );
});

test('verifier checks the trigger contract and effective EXECUTE permissions', () => {
  assert.match(verifier, /pg_catalog\.to_regprocedure\('public\.handle_new_auth_user_profile\(\)'\)/);
  assert.match(verifier, /procedure\.prosecdef/);
  assert.match(verifier, /pg_catalog\.pg_get_userbyid\(procedure\.proowner\) = 'postgres'/);
  assert.match(verifier, /config in \('search_path=', 'search_path=""'\)/);
  assert.match(verifier, /trigger_definition\.tgname = 'on_auth_user_created_profile'/);
  assert.match(verifier, /trigger_definition\.tgfoid = v_function/);
  assert.match(verifier, /trigger_definition\.tgenabled in \('O', 'A'\)/);
  assert.match(verifier, /AFTER INSERT ON auth\.users/);
  assert.match(verifier, /FOR EACH ROW/);
  assert.match(verifier, /acl\.grantee = 0[\s\S]*acl\.privilege_type = 'EXECUTE'/);
  assert.match(verifier, /array\['anon', 'authenticated', 'service_role', 'supabase_auth_admin'\]/);
  assert.match(verifier, /pg_catalog\.has_function_privilege\(v_role, v_function, 'EXECUTE'\)/);
  assert.match(verifier, /pg_catalog\.has_function_privilege\('postgres', v_function, 'EXECUTE'\)/);
});
