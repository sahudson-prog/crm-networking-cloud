import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readSql = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = readSql('../migrations/202610260001_starting_point_v1.sql');
const preflight = readSql('../preflight/202610260001_preflight_starting_point_v1.sql');
const verifier = readSql('../verifiers/202610260001_verify_starting_point_v1.sql');
const behavior = readSql('../verifiers/202610260001_verify_starting_point_v1_behavior.sql');

test('migration is additive, nullable and does not backfill profile values', () => {
  assert.match(migration, /add column if not exists professional_situation_code text/i);
  assert.doesNotMatch(migration, /professional_situation_code text not null/i);
  assert.doesNotMatch(migration, /update public\.profiles[\s\S]*professional_situation_code\s*=[\s\S]*(employed|unemployed)/i);
  for (const code of ['employed', 'unemployed', 'independent', 'studying', 'other', 'prefer_not_to_say']) {
    assert.match(migration, new RegExp(`'${code}'`));
  }
});

test('preconditions and verifier require the complete validated situation constraint', () => {
  for (const sql of [migration, verifier]) {
    assert.match(sql, /\.contype\s*(?:<>|=)\s*'c'/i);
    assert.match(sql, /\.convalidated/i);
  }
  for (const code of ['employed', 'unemployed', 'independent', 'studying', 'other', 'prefer_not_to_say']) {
    assert.match(migration, new RegExp(`''${code}''::text`));
    assert.match(verifier, new RegExp(`''${code}''::text`));
  }
  assert.match(migration, /has an incompatible definition/);
  assert.doesNotMatch(verifier, /like '%prefer_not_to_say%'/i);
});

test('networking date validation is narrow, UTC-consistent and preflighted without exposing rows', () => {
  assert.match(preflight, /begin transaction read only;/i);
  assert.match(preflight, /incompatible_networking_start_rows/i);
  assert.match(preflight, /stop_reasons/i);
  assert.doesNotMatch(preflight, /user_id|email/i);
  assert.match(preflight, /rollback;\s*$/i);
  assert.match(migration, /create or replace function public\.validate_networking_start_setting_v1\(\)/i);
  assert.match(migration, /before insert or update of setting_key, setting_value on public\.user_settings/i);
  assert.match(migration, /new\.setting_key <> 'Fecha_Inicio_Networking'/i);
  assert.match(migration, /statement_timestamp\(\) at time zone 'UTC'/i);
  assert.match(migration, /from public, anon, authenticated, service_role, supabase_auth_admin/i);
  assert.match(verifier, /Networking-start validation trigger is missing or disabled/);
});

test('RPCs derive identity and effective access without arbitrary user ids', () => {
  for (const signature of [
    /current_user_starting_point_v1\(\)/,
    /save_current_user_starting_point_v1\([\s\S]*?p_networking_start_date date/
  ]) assert.match(migration, signature);
  assert.equal((migration.match(/auth\.uid\(\)/g) ?? []).length, 2);
  assert.equal((migration.match(/current_user_has_app_access\(\)/g) ?? []).length, 3);
  assert.doesNotMatch(migration, /p_user_id/i);
  assert.match(migration, /where profile\.id = v_user_id for update/i);
});

test('write is atomic over profile and the existing networking setting source', () => {
  const write = migration.slice(migration.indexOf('create or replace function public.save_current_user_starting_point_v1'));
  assert.match(write, /update public\.profiles/);
  assert.match(write, /insert into public\.user_settings\(user_id, setting_key, setting_value\)/);
  assert.match(write, /'Fecha_Inicio_Networking'/);
  assert.match(write, /on conflict \(user_id, setting_key\) do update/);
  assert.match(write, /where v_date_value is not null/);
  assert.match(write, /coalesce\(v_full_name, profile\.full_name\)/);
  assert.match(write, /coalesce\(v_situation, profile\.professional_situation_code\)/);
  assert.doesNotMatch(write, /public\.(import_batches|connected_accounts|sync_cursors|sync_run_logs)/i);
});

test('RPC grants are minimal and profile UPDATE is not opened to clients', () => {
  for (const role of ['public', 'anon', 'service_role', 'supabase_auth_admin']) {
    assert.match(migration, new RegExp(`from public, anon, authenticated, service_role, supabase_auth_admin`, 'i'));
  }
  assert.match(migration, /grant execute on function public\.current_user_starting_point_v1\(\) to authenticated/i);
  assert.match(migration, /grant execute on function public\.save_current_user_starting_point_v1\(text, text, date\) to authenticated/i);
  assert.doesNotMatch(migration, /grant update on (table )?public\.profiles to authenticated/i);
  assert.match(verifier, /authenticated received broad UPDATE on profiles/);
});

test('behavior verifier covers legacy values, isolation, atomic rejection and revoked access', () => {
  assert.match(behavior, /Legacy starting-point values were not preserved/);
  assert.match(behavior, /crossed the auth\.uid ownership boundary/);
  assert.match(behavior, /A rejected write left a partial update/);
  assert.match(behavior, /Partial update overwrote an unsubmitted starting-point field/);
  assert.match(behavior, /Paused user unexpectedly updated starting-point data/);
  assert.match(behavior, /A valid legacy networking date was not preserved/);
  assert.match(behavior, /Future direct networking date unexpectedly persisted/);
  assert.match(behavior, /Direct networking-date write crossed the ownership boundary/);
  assert.match(behavior, /Networking-date validation changed an unrelated setting/);
  assert.match(behavior, /rollback;\s*$/i);
});
