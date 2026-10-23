import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../migrations/202610210001_google_sync_capability_enforcement_v1.sql', import.meta.url),
  'utf8'
);
const preflight = readFileSync(
  new URL('../preflight/202610210001_preflight_google_sync_rollout_v1.sql', import.meta.url),
  'utf8'
);
const verifier = readFileSync(
  new URL('../verifiers/202610210001_verify_google_sync_capability_enforcement_v1.sql', import.meta.url),
  'utf8'
);
const behaviorVerifier = readFileSync(
  new URL('../verifiers/202610210001_verify_google_sync_capability_enforcement_behavior.sql', import.meta.url),
  'utf8'
);

test('rollout Google ignora grants positivos directos y conserva deny', () => {
  const rollout = migration.match(/create or replace function public\.user_has_provider_rollout_for_user_v1[\s\S]*?\n\$\$;/i);
  assert.ok(rollout);
  assert.match(rollout[0], /override\.override_mode = 'deny'/);
  assert.doesNotMatch(rollout[0], /override_mode in \('grant', 'limit'\)/);
  assert.match(rollout[0], /app_role_capabilities/);
  assert.match(rollout[0], /subscription_plan_capabilities/);
  assert.match(rollout[0], /app_capabilities/);
  assert.match(rollout[0], /capability\.is_active = true/);
});

test('operaciones y scopes permanecen separados por contacto email y calendario', () => {
  assert.match(migration, /when 'contacts' then 'contacts\.sync_external'/);
  assert.match(migration, /when 'email' then 'interactions\.sync_email'/);
  assert.match(migration, /when 'calendar' then 'interactions\.sync_calendar'/);
  assert.match(migration, /when 'contacts' then 'contacts_read'/);
  assert.match(migration, /when 'email' then 'gmail_read'/);
  assert.match(migration, /when 'calendar' then 'calendar_read'/);
  assert.match(migration, /capability\.is_active = true/);
  const oauthStart = migration.match(/create or replace function public\.current_user_can_start_connected_oauth_v1[\s\S]*?\n\$\$;/i);
  assert.ok(oauthStart);
  assert.match(oauthStart[0], /contacts\.sync_external/);
  assert.match(oauthStart[0], /interactions\.sync_email/);
  assert.match(oauthStart[0], /interactions\.sync_calendar/);
  assert.match(oauthStart[0], /user_has_capability_for_user/);
});

test('finalizacion conserva solo scopes de operaciones efectivamente permitidas', () => {
  const finalize = migration.match(/create or replace function public\.finalize_google_connected_account_verified[\s\S]*?\n\$\$;/i);
  assert.ok(finalize);
  assert.match(finalize[0], /user_has_provider_rollout_for_user_v1/);
  assert.match(finalize[0], /user_has_capability_for_user/);
  assert.match(finalize[0], /contacts\.sync_external/);
  assert.match(finalize[0], /interactions\.sync_email/);
  assert.match(finalize[0], /interactions\.sync_calendar/);
});

test('writers Google hardcodean provider y revalidan autorizacion por item', () => {
  for (const functionName of [
    'apply_google_contact_sync_change_v1',
    'apply_google_interaction_sync_v1'
  ]) {
    const definition = migration.match(new RegExp(
      `create or replace function public\\.${functionName}[\\s\\S]*?\\n\\$\\$;`,
      'i'
    ));
    assert.ok(definition, `${functionName} missing`);
    assert.match(definition[0], /current_user_can_sync_connected_account_v1/);
    assert.match(definition[0], /pg_advisory_xact_lock/);
    assert.match(definition[0], /'google'/);
    assert.doesNotMatch(definition[0], /p_(change|item)->>'provider'/);
  }
});

test('fase expand conserva temporalmente escrituras legacy de provenance', () => {
  assert.doesNotMatch(migration, /revoke insert, update on table[\s\S]*external_contact_ids/i);
});

test('connected_accounts mantiene escritura RPC-only desde la fase expand', () => {
  assert.match(
    migration,
    /revoke insert, update, delete on table public\.connected_accounts\s+from PUBLIC, anon, authenticated, service_role/i
  );
  assert.match(verifier, /connected_accounts does not preserve its RPC-only write contract/i);
});

test('verifier resuelve PUBLIC mediante ACL y no como rol PostgreSQL', () => {
  assert.match(verifier, /pg_catalog\.aclexplode/);
  assert.match(verifier, /acl\.grantee = 0/);
  assert.doesNotMatch(verifier, /has_function_privilege\('PUBLIC'/i);
});

test('capabilities legacy se conservan durante el cutover', () => {
  assert.doesNotMatch(migration, /delete from public\.app_(role_capabilities|capabilities)/i);
  assert.doesNotMatch(migration, /delete from public\.subscription_plan_capabilities/i);
  assert.match(verifier, /contacts\.import_google/);
  assert.match(verifier, /interactions\.import_google/);
});

test('preflight es read-only y no asigna cohortes', () => {
  assert.match(preflight, /begin transaction read only/i);
  assert.match(preflight, /rollback;/i);
  assert.doesNotMatch(preflight, /\b(insert|update|delete|merge|grant|revoke|alter|create|drop)\b/i);
  assert.match(preflight, /has_active_beta_tester_role/);
  assert.match(preflight, /active_roles/);
  assert.match(preflight, /has_active_google_account/);
  assert.match(preflight, /account_status = 'active'/);
  assert.match(preflight, /beta_access_status = 'approved'/);
});

test('verifier funcional prueba overrides ownership revocacion y rollback', () => {
  assert.match(behaviorVerifier, /^begin;/im);
  assert.match(behaviorVerifier, /'connectors\.google\.use', 'grant'/i);
  assert.match(behaviorVerifier, /'contacts\.sync_external', 'deny'/i);
  assert.match(behaviorVerifier, /current_user_can_start_connected_oauth_v1/i);
  assert.match(behaviorVerifier, /current_user_can_sync_connected_account_v1/i);
  assert.match(behaviorVerifier, /apply_google_contact_sync_change_v1/i);
  assert.match(behaviorVerifier, /cross-user connected account/i);
  assert.match(behaviorVerifier, /rollback;\s*$/i);
});
