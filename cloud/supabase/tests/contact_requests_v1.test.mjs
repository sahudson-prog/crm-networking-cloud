import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(new URL('../migrations/202610150001_contact_requests_v1.sql', import.meta.url), 'utf8');
const verifier = readFileSync(new URL('../verifiers/202610150001_verify_contact_requests_v1.sql', import.meta.url), 'utf8');

test('contact request table remains RLS protected without direct client grants', () => {
  assert.match(migration, /alter table public\.contact_requests enable row level security/i);
  assert.match(migration, /revoke all on table public\.contact_requests from public, anon, authenticated, service_role, supabase_auth_admin/i);
  assert.match(verifier, /'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'/);
  assert.match(verifier, /PUBLIC has forbidden % privilege on contact_requests/);
});

test('public submit is internal to service role and admin RPCs require their narrow capability', () => {
  assert.match(migration, /grant execute on function public\.submit_contact_request_v1[\s\S]*to service_role/i);
  assert.match(migration, /revoke execute on function public\.submit_contact_request_v1[\s\S]*from public, anon, authenticated, service_role, supabase_auth_admin/i);
  assert.match(migration, /current_user_has_capability\('admin\.manage_contact_requests'\)/g);
  assert.match(verifier, /service_role cannot execute submit_contact_request_v1/);
});

test('server-derived user association is optional and constrained to auth users', () => {
  assert.match(migration, /user_id uuid references auth\.users\(id\) on delete set null/i);
  assert.match(migration, /select 1 from auth\.users auth_user where auth_user\.id = p_user_id/i);
  assert.doesNotMatch(migration, /inet_client_addr|user-agent|user_agent|request\.headers/i);
});

test('admin mutation only changes operational and identity verification states', () => {
  const updateBody = migration.match(/create or replace function public\.admin_update_contact_request_v1[\s\S]*?\n\$\$;/i)?.[0] ?? '';
  assert.match(updateBody, /set status = v_status,[\s\S]*identity_verification_status = v_identity_status/i);
  assert.doesNotMatch(updateBody, /set[\s\S]*requester_email\s*=/i);
  assert.match(updateBody, /'contact_request\.update'/);
  assert.doesNotMatch(updateBody, /v_before\.message|v_after\.message/);
});
