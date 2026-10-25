import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSql = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const migration = readSql('../migrations/202610250001_invitation_access_v1.sql');
const verifier = readSql('../verifiers/202610250001_verify_invitation_access_v1.sql');
const behavior = readSql('../verifiers/202610250001_verify_invitation_access_v1_behavior.sql');

test('INV-01 rollout is inert and uses authoritative lifecycle tables', () => {
  assert.match(migration, /invitations_enabled boolean not null default false/i);
  assert.match(migration, /registrations_enabled boolean not null default false/i);
  assert.match(migration, /global_capacity integer not null default 500/i);
  assert.match(migration, /invitation_expires_at_v1\(p_authorized_at timestamptz\)[\s\S]*immutable[\s\S]*p_authorized_at \+ interval '120 hours'/i);
  assert.match(migration, /expires_at timestamptz generated always as \([\s\S]*invitation_expires_at_v1\(authorized_at\)[\s\S]*\) stored/i);
  assert.match(migration, /invitation_status in \('pending', 'registered', 'expired', 'cancelled'\)/i);
  assert.match(migration, /uq_app_invitations_active_email/i);
  assert.match(migration, /uq_app_invitations_registered_user/i);
  assert.doesNotMatch(migration, /create extension|pg_cron|http_request|net\.http/i);
});

test('client roles have no direct invitation table access', () => {
  for (const table of [
    'app_invitation_program_settings', 'app_invitations', 'app_invitation_events',
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(
      `revoke all on table public\\.${table} from public, anon, authenticated, service_role, supabase_auth_admin`,
      'i',
    ));
  }
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete)[\s\S]*app_invitations/i);
  assert.match(verifier, /SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN/i);
});

test('Auth Hook admits legacy or valid invitation but never converts lifecycle state', () => {
  const hook = migration.match(/create or replace function public\.hook_enforce_app_access_allowlist[\s\S]*?\n\$\$;/i)?.[0] ?? '';
  assert.match(hook, /is_email_authorized_for_app_access/);
  assert.match(hook, /is_email_authorized_for_invitation_registration_v1/);
  assert.doesNotMatch(hook, /update public\.app_invitations|insert into public\.user_role_assignments/i);
  assert.match(migration, /create or replace function public\.bootstrap_current_user_invitation_v1\(\)/i);
  assert.match(migration, /auth_user\.email_confirmed_at/i);
  assert.match(migration, /invitation_status = 'registered'/i);
  assert.match(migration, /plan_code = case[\s\S]*then 'free'/i);
  assert.match(migration, /role_code, assignment_reason[\s\S]*'user', 'INV-01 invitation registration'/i);
});

test('authorization serializes decisions and takes the clock after locks', () => {
  const authorize = migration.match(/create or replace function public\.authorize_current_user_invitation_v1[\s\S]*?\n\$\$;/i)?.[0] ?? '';
  assert.match(authorize, /app_invitation_program_settings[\s\S]*for update/);
  assert.match(authorize, /pg_advisory_xact_lock/);
  assert.match(authorize, /from public\.profiles where id = v_user_id for update;[\s\S]*v_now := clock_timestamp\(\)/i);
  assert.match(authorize, /invitation_personal_limit_for_user_v1\(v_user_id\)/);
  assert.match(authorize, /v_personal_count >= v_personal_limit/);
  assert.match(authorize, /v_capacity_count >= v_settings\.global_capacity/);
  assert.doesNotMatch(authorize, /interval '120 hours'/);
  assert.match(authorize, /'result', 'existing'/);
});

test('bootstrap rejects administrative states and takes a fresh clock after invitation lock', () => {
  const bootstrap = migration.match(/create or replace function public\.bootstrap_current_user_invitation_v1[\s\S]*?\n\$\$;/i)?.[0] ?? '';
  assert.match(bootstrap, /v_account_status in \('paused', 'closed'\)/i);
  assert.match(bootstrap, /v_beta_access_status = 'blocked'/i);
  assert.match(bootstrap, /revoked_at is not null/i);
  assert.match(bootstrap, /invitation_status = 'pending'[\s\S]*for update;[\s\S]*v_now := clock_timestamp\(\)/i);
  assert.match(bootstrap, /invitation_personal_limit_for_user_v1|ensure_invitation_user_role_v1/);
  assert.doesNotMatch(bootstrap, /v_now\s*:=\s*(?:now|transaction_timestamp)\(/i);
});

test('admin cancellation blocks reinvitation until explicit audited lift', () => {
  assert.match(migration, /create or replace function public\.admin_cancel_invitation_v1/i);
  assert.match(migration, /reinvite_blocked_at = v_now/);
  assert.match(migration, /create or replace function public\.admin_lift_invitation_email_block_v1/i);
  assert.match(migration, /reinvite_unblocked_at = v_now/);
  assert.match(migration, /current_user_has_capability\('admin\.manage_access'\)/g);
  assert.match(migration, /'reinvite_unblocked'/);
  assert.match(migration, /jsonb_build_object\('reason', btrim\(p_reason\)\)/i);
  assert.match(migration, /event_details = invitation_event\.event_details - 'reason'/i);
});

test('PII cleanup retains only an active security fingerprint after 90 days', () => {
  const purge = migration.match(/create or replace function public\.admin_purge_invitation_pii_v1[\s\S]*?\n\$\$;/i)?.[0] ?? '';
  assert.match(purge, /interval '90 days'/);
  assert.match(purge, /set email_normalized = null/);
  assert.match(purge, /cancellation_reason = null/);
  assert.match(purge, /when invitation\.invitation_status = 'cancelled'[\s\S]*reinvite_unblocked_at is null[\s\S]*then invitation\.email_fingerprint/i);
  assert.match(migration, /jsonb_build_object\('reason',\s*btrim\(p_reason\)\)/i);
  assert.match(purge, /event_details = invitation_event\.event_details - 'reason'/i);
  assert.doesNotMatch(migration, /delete from public\.app_invitations/i);
  const eventTable = migration.match(
    /create table if not exists public\.app_invitation_events[\s\S]*?\n\);/i,
  )?.[0] ?? '';
  assert.doesNotMatch(eventTable, /\bemail(?:_normalized)?\b/i);
});

test('free gets only the existing own-data reset capability and Google remains beta-only', () => {
  assert.match(migration, /select plan\.plan_code, 'data\.delete_account', '\{\}'::jsonb[\s\S]*plan\.plan_code = 'free'/i);
  assert.doesNotMatch(migration, /\('free', '(?:connectors\.google\.use|contacts\.(?:import_google|sync_external)|interactions\.(?:import_google|sync_email|sync_calendar))'/i);
  assert.doesNotMatch(migration, /\('user', '(?:connectors\.google\.use|contacts\.(?:import_google|sync_external)|interactions\.(?:import_google|sync_email|sync_calendar))'/i);
  assert.match(verifier, /reset_current_user_app_data_v0_1/);
});

test('behavior verifier is transactional and covers required boundaries', () => {
  assert.match(behavior, /^--[\s\S]*\nbegin;/i);
  assert.match(behavior, /rollback;\s*$/i);
  for (const evidence of [
    'Sixth personal invitation', 'Duplicate authorization', '120-hour boundary',
    'email_not_verified', 'Legacy beta', 'Own-data reset',
  ]) assert.ok(behavior.includes(evidence), evidence);
});
