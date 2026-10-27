import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSql = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = readSql('../migrations/202610270001_networking_cycles_history_v1.sql');
const preflight = readSql('../preflight/202610270001_preflight_networking_cycles_history_v1.sql');
const structural = readSql('../verifiers/202610270001_verify_networking_cycles_history_v1.sql');
const behavior = readSql('../verifiers/202610270001_verify_networking_cycles_history_v1_behavior.sql');
const composed = readSql('../verifiers/202610270001_verify_access_networking_cycles_composed.sql');
const canonicalReset = readSql('../migrations/202609090004_application_rpcs.sql');
const standaloneReset = readSql('../reset_current_user_app_data_v0_1.sql');
const resetBody = (sql) => sql
  .slice(sql.indexOf('create or replace function public.reset_current_user_app_data_v0_1'))
  .split('as $$', 2)[1]
  .split('$$;', 1)[0]
  .replace(/\r\n?/g, '\n');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('reset admission names only the canonical and hardened standalone bodies', () => {
  const canonical = resetBody(canonicalReset);
  const standalone = resetBody(standaloneReset);
  const canonicalHash = sha256(canonical);
  const standaloneHash = sha256(standalone);
  assert.equal(canonical.replace(/    'sync_change_suppressions',\n/, ''), standalone);
  assert.equal(canonicalHash, '2e2a05539d97c80704f7cb4c2c05f36bdc3cccbea2af37e5558aa60b8f988799');
  assert.equal(standaloneHash, '63b1d83b83d56b0b3717af1059c82672e358ee265ebcd08b5b278d0be7df3a1d');
  for (const sql of [preflight, migration]) {
    assert.ok(sql.includes(canonicalHash));
    assert.ok(sql.includes(standaloneHash));
    assert.match(sql, /has_function_privilege\('authenticated'/i);
    assert.match(sql, /has_function_privilege\('anon'/i);
    assert.match(sql, /acl\.is_grantable/i);
  }
});

test('preflight is aggregate, read-only and fail-closed', () => {
  assert.match(preflight, /begin transaction read only;/i);
  assert.match(preflight, /stop_reasons/i);
  assert.match(preflight, /clean_install/i);
  assert.match(preflight, /unexpected_reset_contract/i);
  assert.match(preflight, /rollback;\s*$/i);
  assert.doesNotMatch(preflight, /select\s+(?:profile\.)?(?:id|email)\b/i);
});

test('cycles preserve unknown legacy dates and enforce one active cycle', () => {
  assert.match(migration, /create table public\.networking_cycles/i);
  assert.match(migration, /started_on date/i);
  assert.match(migration, /origin in \('user', 'legacy'\)/i);
  assert.match(migration, /uq_networking_cycles_one_active_per_user[\s\S]*where status = 'active'/i);
  assert.match(migration, /select distinct objective\.user_id, 'JOB_SEARCH', 'active', null::date, null::text, 'legacy'/i);
  assert.doesNotMatch(migration, /coalesce\([^\n]*started_on/i);
  assert.match(migration, /networking_cycle_identity_or_snapshot_immutable/i);
  assert.match(migration, /interactions\.cycle_id already exists/i);
  assert.match(migration, /create trigger set_networking_cycles_updated_at/i);
});

test('objectives keep IDs and old-runtime inserts receive an active cycle', () => {
  assert.match(migration, /alter table public\.objectives add column cycle_id uuid/i);
  assert.match(migration, /on delete restrict/i);
  assert.match(migration, /create or replace function public\.assign_objective_cycle_v1\(\)/i);
  assert.match(migration, /objective_cycle_change_not_allowed/i);
  assert.match(migration, /insert into public\.networking_cycles[\s\S]*'legacy'/i);
  assert.doesNotMatch(migration, /delete from public\.objectives/i);
  assert.doesNotMatch(migration, /update public\.contact_objective_assignments/i);
});

test('professional situation records only real post-install transitions', () => {
  assert.match(migration, /after update of professional_situation_code on public\.profiles/i);
  assert.match(migration, /old\.professional_situation_code is distinct from new\.professional_situation_code/i);
  assert.match(migration, /professional_situation_code_at_start/i);
  assert.doesNotMatch(migration, /insert into public\.professional_situation_transitions[\s\S]*select[\s\S]*from public\.profiles/i);
});

test('contact ledger is PII-minimized and covers insert plus status and focus changes', () => {
  assert.match(migration, /after insert or update of networking_status, networking_focus on public\.contacts/i);
  assert.match(migration, /event_kind in \('initialized', 'changed'\)/i);
  assert.match(migration, /changed_fields <@ array\['networking_status', 'networking_focus'\]/i);
  assert.doesNotMatch(migration, /contact_networking_transitions[\s\S]{0,800}\b(?:email|display_name|company|phone|notes)\b/i);
});

test('interaction attribution remains temporal and internal', () => {
  assert.match(migration, /networking_cycle_for_event_v1\(\s*p_user_id uuid,\s*p_occurred_at timestamptz/i);
  assert.match(migration, /p_occurred_at >= \(cycle\.started_on::timestamp at time zone 'UTC'\)/i);
  assert.match(migration, /case when pg_catalog\.count\(\*\) = 1 then \(pg_catalog\.array_agg\(id\)\)\[1\] end/i);
  assert.doesNotMatch(migration, /alter table public\.interactions add column cycle_id/i);
  assert.match(structural, /interactions must not persist cycle_id/i);
});

test('new tables expose owner reads only and internal functions remain private', () => {
  assert.match(migration, /grant select on table[\s\S]*public\.networking_cycles[\s\S]*to authenticated/i);
  assert.match(migration, /revoke all privileges on table[\s\S]*from public, anon, authenticated, service_role, supabase_auth_admin/i);
  assert.match(structural, /'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'/i);
  assert.match(structural, /broader than approved/i);
  for (const name of [
    'active_networking_cycle_id_for_user_v1',
    'networking_cycle_for_event_v1',
    'validate_networking_cycle_v1',
    'assign_objective_cycle_v1',
    'capture_professional_situation_transition_v1',
    'capture_contact_networking_transition_v1',
  ]) {
    assert.match(composed, new RegExp(name));
  }
});

test('reset deletes R2-A records in dependency order without redefining its public signature', () => {
  const professional = migration.indexOf("'professional_situation_transitions'");
  const objectives = migration.lastIndexOf("'objectives'");
  const contacts = migration.lastIndexOf("'contacts'");
  const cycles = migration.lastIndexOf("'networking_cycles'");
  assert.ok(professional > 0 && professional < objectives);
  assert.ok(objectives < cycles && contacts < cycles);
  assert.match(migration, /reset_current_user_app_data_v0_1\(p_confirmation text\)/i);
  assert.match(migration, /'sync_change_suppressions', 'sync_run_logs'/i);
  assert.match(migration, /'professional_situation_transitions', 'contact_networking_transitions'/i);
  assert.match(migration, /'external_contact_ids', 'contacts', 'networking_cycles'/i);
  assert.match(migration, /grant execute on function public\.reset_current_user_app_data_v0_1\(text\) to authenticated/i);
});

test('behavior verifier exercises legacy compatibility and narrow ledgers', () => {
  assert.match(behavior, /Old-runtime objective insert did not obtain a conservative legacy cycle/i);
  assert.match(behavior, /Professional-situation transition ledger is incomplete or noisy/i);
  assert.match(behavior, /Contact networking transition ledger is incomplete or noisy/i);
  assert.match(behavior, /rollback;\s*$/i);
});
