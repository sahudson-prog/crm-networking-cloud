import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSql = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const migration = readSql('../migrations/202610250002_invitation_admin_state_v1.sql');
const verifier = readSql('../verifiers/202610250002_verify_invitation_admin_state_v1.sql');
const behavior = readSql('../verifiers/202610250002_verify_invitation_admin_state_v1_behavior.sql');
const panel = readSql('../../web/components/InvitationAdminPanel.tsx');

test('admin state is a new forward-only RPC and leaves PR 1 untouched', () => {
  assert.match(migration, /^-- INV-01 PR 2:[\s\S]*\nbegin;/i);
  assert.match(migration, /create or replace function public\.admin_invitation_program_state_v1\(\)/i);
  assert.doesNotMatch(migration, /create or replace function public\.current_user_invitation_state_v1/i);
  assert.doesNotMatch(migration, /alter table|update public\.app_invitation_program_settings|insert into public\.app_role_capabilities/i);
  assert.match(migration, /commit;\s*$/i);
});

test('admin state uses effective admin capability and exposes aggregates without PII', () => {
  const definition = migration.match(
    /create or replace function public\.admin_invitation_program_state_v1\(\)[\s\S]*?\n\$\$;/i,
  )?.[0] ?? '';
  assert.match(definition, /auth\.uid\(\)/i);
  assert.match(definition, /current_user_has_capability\('admin\.manage_access'\)/i);
  assert.doesNotMatch(definition, /invitations\.authorize|email_normalized|email_fingerprint|inviter_user_id|registered_user_id|updated_by_user_id/i);
  for (const key of [
    'invitations_enabled', 'registrations_enabled', 'global_capacity',
    'pending_reservations', 'registered_users', 'used_capacity', 'available_capacity', 'updated_at',
  ]) assert.ok(definition.includes(`'${key}'`), key);
});

test('RPC ACL is authenticated-only and structural verifier checks the full boundary', () => {
  assert.match(migration, /revoke all on function public\.admin_invitation_program_state_v1\(\)[\s\S]*from public, anon, authenticated, service_role, supabase_auth_admin/i);
  assert.match(migration, /grant execute on function public\.admin_invitation_program_state_v1\(\) to authenticated/i);
  assert.match(verifier, /owner\/security\/volatility\/search_path\/return type/i);
  assert.match(verifier, /PUBLIC can execute administrative invitation state RPC/i);
  assert.match(verifier, /private invitation or actor fields/i);
  assert.match(verifier, /^--[\s\S]*begin transaction read only;/i);
  assert.match(verifier, /rollback;\s*$/i);
});

test('behavior verifier covers independent admin read, regular denial and effective deny', () => {
  assert.match(behavior, /Admin fixture unexpectedly retains invitations\.authorize/i);
  assert.match(behavior, /Regular user unexpectedly read administrative invitation state/i);
  assert.match(behavior, /Effective admin deny unexpectedly allowed administrative invitation state/i);
  assert.match(behavior, /returned unexpected fields/i);
  assert.match(behavior, /controls must remain closed/i);
  assert.match(behavior, /^--[\s\S]*\nbegin;/i);
  assert.match(behavior, /rollback;\s*$/i);
});

test('maintenance uses only the narrow admin read operation', () => {
  assert.match(panel, /loadInvitationAdminState\(supabase\)/);
  assert.doesNotMatch(panel, /loadInvitations\(supabase\)|current_user_invitation_state_v1/);
});
