import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSql = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = readSql('../migrations/202610130001_harden_app_access_allowlist_grants.sql');
const verifier = readSql('../verifiers/202609090002_verify_access.sql');

const expectedPrivileges = [
  'select',
  'insert',
  'update',
  'delete',
  'truncate',
  'references',
  'trigger',
  'maintain',
];

test('allowlist hardening revokes only the complete table privilege set from the drifted roles', () => {
  const normalized = migration.toLowerCase().replace(/\s+/g, ' ').trim();
  const executableSql = migration
    .replace(/^--.*$/gm, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  assert.match(normalized, /^-- [^\n]+ begin; revoke /);
  assert.match(
    normalized,
    /revoke select, insert, update, delete, truncate, references, trigger, maintain on table public\.app_access_allowlist from authenticated, service_role;/,
  );
  assert.match(normalized, /commit;$/);
  assert.doesNotMatch(executableSql, /(^|;)\s*grant\s/);
  assert.doesNotMatch(executableSql, /alter default privileges/);
  assert.doesNotMatch(executableSql, /alter table|create policy|drop policy|alter function/);
  assert.deepEqual(
    [...normalized.matchAll(/public\.([a-z0-9_]+)/g)].map((match) => match[1]),
    ['app_access_allowlist'],
  );
});

test('access verifier rejects every table privilege involved in the DEV allowlist drift', () => {
  const inventory = verifier.match(
    /allowlist_table_privileges text\[\] := array\[([\s\S]*?)\];/,
  );
  assert.ok(inventory, 'allowlist privilege inventory is missing');

  const privileges = [...inventory[1].matchAll(/'([A-Z]+)'/g)]
    .map((match) => match[1].toLowerCase());
  assert.deepEqual(privileges, expectedPrivileges);

  const guard = verifier.match(
    /foreach client_role in array array\['anon', 'authenticated', 'service_role'\] loop([\s\S]*?)end loop;/,
  );
  assert.ok(guard, 'allowlist role guard is missing');
  assert.match(guard[1], /foreach allowlist_privilege in array allowlist_table_privileges loop/);
  assert.match(guard[1], /pg_catalog\.has_table_privilege\(/);
  assert.match(guard[1], /'public\.app_access_allowlist'/);
  assert.match(guard[1], /allowlist_privilege/);
});

test('access verifier fixes owner and RLS mode while retaining the RPC surface checks', () => {
  assert.match(verifier, /pg_catalog\.pg_get_userbyid\(relation\.relowner\) = 'postgres'/);
  assert.match(verifier, /relation\.relrowsecurity\s+and not relation\.relforcerowsecurity/);
  assert.match(verifier, /'public\.admin_list_app_access_allowlist\(\)'::regprocedure/);
  assert.match(verifier, /'public\.admin_authorize_app_access_email\(text,text\)'::regprocedure/);
  assert.match(verifier, /'public\.admin_revoke_app_access_email\(text\)'::regprocedure/);
  assert.match(verifier, /'public\.admin_get_app_access_diagnostic\(uuid\)'::regprocedure/);
  assert.match(verifier, /'public\.hook_enforce_app_access_allowlist\(jsonb\)'::regprocedure/);
});
