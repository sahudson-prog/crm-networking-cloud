import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(new URL('../migrations/202610150002_legal_acceptance_v1.sql', import.meta.url), 'utf8');
const verifier = readFileSync(new URL('../verifiers/202610150002_verify_legal_acceptance_v1.sql', import.meta.url), 'utf8');
const v11Migration = readFileSync(new URL('../migrations/202610150003_legal_acceptance_v1_1.sql', import.meta.url), 'utf8');
const v11Verifier = readFileSync(new URL('../verifiers/202610150003_verify_legal_acceptance_v1_1.sql', import.meta.url), 'utf8');

test('legal acceptance is RPC-only, RLS protected and append-only for clients', () => {
  assert.match(migration, /alter table public\.legal_acceptances enable row level security/i);
  assert.match(migration, /revoke all on table public\.legal_acceptances[\s\S]*from public, anon, authenticated, service_role, supabase_auth_admin/i);
  assert.doesNotMatch(migration, /grant (select|insert|update|delete).*legal_acceptances/i);
  assert.doesNotMatch(migration, /update public\.legal_acceptances|delete from public\.legal_acceptances/i);
  assert.match(verifier, /'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'/);
});

test('narrow RPCs derive ownership and current contract server-side', () => {
  for (const functionName of [
    'current_user_legal_acceptance_status_v1',
    'record_current_user_legal_acceptance_v1'
  ]) {
    const definition = migration.match(new RegExp(`create or replace function public\\.${functionName}\\(\\)[\\s\\S]*?\\n\\$\\$;`, 'i'))?.[0] ?? '';
    assert.match(definition, /auth\.uid\(\)/);
    assert.match(definition, /current_user_has_app_access\(\)/);
    assert.match(definition, /security definer/i);
    assert.match(definition, /set search_path = ''/i);
    assert.doesNotMatch(definition, /p_user_id|p_terms_version|p_privacy_version/i);
  }
  assert.match(migration, /80323d9b915dd2cb423fe4cfbaed7851675cd070da596117c5bc08214af4cd12/g);
  assert.match(migration, /f0ec2f6ecf1ca3f262508942a37f2d057b79449bab20fb6729a5861a6a75fd30/g);
});

test('idempotency and user isolation are covered by rollback verifier fixtures', () => {
  assert.match(migration, /on conflict on constraint uq_legal_acceptances_user_contract do nothing/i);
  assert.match(verifier, /^begin;/m);
  assert.match(verifier, /Legal acceptance retry is not idempotent/);
  assert.match(verifier, /Legal acceptance leaked across users/);
  assert.match(verifier, /derive ownership independently from auth\.uid\(\)/);
  assert.match(verifier, /rollback;\s*$/i);
});

test('general access inventory includes the table and both authenticated RPCs', () => {
  const accessVerifier = readFileSync(new URL('../verifiers/202609090002_verify_access.sql', import.meta.url), 'utf8');
  assert.match(accessVerifier, /no_authenticated_table_privileges[\s\S]*'legal_acceptances'/);
  assert.match(accessVerifier, /'public\.current_user_legal_acceptance_status_v1\(\)'::regprocedure/);
  assert.match(accessVerifier, /'public\.record_current_user_legal_acceptance_v1\(\)'::regprocedure/);
});

test('V1.1 advances only the current RPC contract and preserves the V1.0 table history', () => {
  assert.doesNotMatch(v11Migration, /create table|drop table|alter table|update public\.legal_acceptances|delete from public\.legal_acceptances/i);
  assert.match(v11Migration, /terms_version = '1\.1'/);
  assert.match(v11Migration, /privacy_version = '1\.1'/);
  assert.match(v11Migration, /73c2b6927eeeda18c550b25c2fb66cd56191dc0e075192492f68aa5b83459c43/g);
  assert.match(v11Migration, /653fc1460b2a227e71a570da90486db213bc0a0adc7d9136896b28a4e5270f0f/g);
  assert.match(v11Migration, /revoke execute[\s\S]*grant execute[\s\S]*to authenticated/i);
});

test('V1.1 verifier rejects V1.0 as current and preserves both immutable rows', () => {
  assert.match(v11Verifier, /^begin;/m);
  assert.match(v11Verifier, /V1\.0 acceptance incorrectly satisfies the current V1\.1 contract/);
  assert.match(v11Verifier, /Recorded V1\.1 acceptance does not satisfy the current contract/);
  assert.match(v11Verifier, /V1\.1 retry is not idempotent or V1\.0 history was changed/);
  assert.match(v11Verifier, /rollback;\s*$/i);
});
