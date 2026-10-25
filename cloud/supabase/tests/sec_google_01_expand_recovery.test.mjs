import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const capture = read('../operations/prod/202610240001_capture_sec_google_01_expand.sql');
const builder = read('../operations/prod/build-sec-google-01-expand-recovery.mjs');
const runbook = read('../operations/prod/SEC_GOOGLE_01_EXPAND.md');
const backlog = read('../../../docs/planning/BACKLOG.md');

test('capture is read-only, transactional and privacy-preserving', () => {
  assert.match(capture, /begin transaction read only;/i);
  assert.match(capture, /rollback;\s*$/i);
  assert.doesNotMatch(capture, /\b(insert|update|delete|grant|revoke|alter|create|drop)\s+(table|function|role|policy|schema|on|from|into)\b/i);
  assert.doesNotMatch(capture, /auth\.users|account_email|provider_token|oauth_refresh_token|user_id/i);
  assert.match(capture, /payload_base64/);
  assert.match(capture, /payload_md5/);
  assert.match(capture, /payload_bytes/);
});

test('capture inventories the exact expand manifest', () => {
  for (const capability of [
    'connectors.google.use',
    'contacts.sync_external',
    'interactions.sync_email',
    'interactions.sync_calendar',
  ]) assert.match(capture, new RegExp(capability.replaceAll('.', '\\.')));
  for (const routine of [
    'user_has_provider_rollout_for_user_v1',
    'current_user_can_start_connected_oauth_v1',
    'current_user_can_sync_connected_account_v1',
    'finalize_google_connected_account_verified',
    'apply_google_interaction_sync_v1',
    'apply_google_contact_sync_change_v1',
  ]) assert.match(capture, new RegExp(routine));
  assert.match(capture, /connected_accounts_privilege_mismatch/);
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
    assert.match(capture, new RegExp(`'${privilege}'`));
  }
  assert.match(capture, /stop_reasons/);
});

test('builder binds recovery to capture and immutable expand migration', () => {
  assert.match(builder, /EXPECTED_MIGRATION_SHA256/);
  assert.match(builder, /EXPECTED_EXPAND_FUNCTION_STATE/);
  assert.match(builder, /definitionMd5/);
  assert.match(builder, /Capture byte count mismatch/);
  assert.match(builder, /Capture MD5 mismatch/);
  assert.match(builder, /Expand migration changed/);
  assert.match(builder, /DRAFT ONLY/);
  assert.match(builder, /--approve/);
});

test('generated recovery is designed to fail before permanent changes', () => {
  const preconditions = builder.indexOf('do $preconditions$');
  const firstPermanentChange = builder.indexOf('${finalizeDefinition}');
  assert.ok(preconditions > 0 && firstPermanentChange > preconditions);
  assert.match(builder, /Post-expand capability references require manual recovery review/);
  assert.match(builder, /Expanded function definition or security properties changed/);
  assert.match(builder, /Expanded function ACL changed/);
  assert.match(builder, /connected_accounts owner or RLS configuration changed after capture/);
  assert.match(builder, /connected_accounts ACL changed after capture/);
  assert.match(builder, /MANUAL PROJECT GATE/);
  assert.doesNotMatch(builder, /current_database\(\)/);
});

test('recovery preserves app-owned tables and asserts before commit', () => {
  for (const table of [
    'connected_accounts', 'contacts', 'external_contact_ids',
    'external_contact_snapshots', 'interactions',
    'external_interaction_sources', 'sync_cursors',
  ]) assert.match(builder, new RegExp(`public\\.${table}`));
  assert.ok(builder.indexOf('do $assertions$') < builder.indexOf('commit;'));
  assert.match(builder, /Application-owned row counts changed during recovery/);
  assert.match(builder, /definition or security properties were not restored/);
  assert.match(builder, /owner or RLS configuration changed during recovery/);
  assert.doesNotMatch(builder, /\bcascade\b/i);
});

test('runbook keeps backup, expand, runtime and contract as separate gates', () => {
  assert.match(runbook, /no sustituye un backup recuperable ni PITR/i);
  assert.match(runbook, /202610210001_google_sync_capability_enforcement_v1\.sql/);
  assert.match(runbook, /merge manual de PR #36/);
  assert.match(runbook, /`202610210002` es otro release/i);
  assert.match(runbook, /No reutilizar recuentos históricos/i);
});

test('backlog records one Astra review before rollout to user', () => {
  const matches = backlog.split(/\r?\n/).filter((line) =>
    line.includes('Astra') && line.includes('Google Sync') && line.includes('rol `user`'),
  );
  assert.equal(matches.length, 1);
  assert.match(matches[0], /duplicados/i);
  assert.match(matches[0], /error inicial de conexión/i);
  assert.match(matches[0], /causa/i);
});
