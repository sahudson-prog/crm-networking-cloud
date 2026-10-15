import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parseDateSetting } from '../../web/lib/syncDate.ts';

const readRepoFile = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = readRepoFile('../migrations/202610130002_initialize_networking_start_v1.sql');
const verifier = readRepoFile('../verifiers/202610130002_verify_networking_start_v1.sql');
const settingComponent = readRepoFile('../../web/components/NetworkingStartDateSetting.tsx');

test('auth trigger persists the UTC registration date without changing access provisioning', () => {
  assert.match(migration, /create or replace function public\.handle_new_auth_user_profile\(\)[\s\S]*security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /public\.is_email_authorized_for_app_access\(new\.email\)/);
  assert.match(migration, /insert into public\.profiles[\s\S]*insert into public\.user_settings[\s\S]*if v_is_authorized then/i);
  assert.match(migration, /'Fecha_Inicio_Networking'[\s\S]*pg_catalog\.to_char\(new\.created_at at time zone 'UTC', 'YYYY-MM-DD'\)/i);
  assert.match(migration, /on conflict \(user_id, setting_key\) do nothing/i);
  assert.match(migration, /'beta_personal', 'active', 'approved'/);
  assert.match(migration, /'beta_personal', 'beta_pending', 'pending'/);
  assert.match(migration, /public\.user_access_profiles\.account_status = 'closed'/);
  assert.match(migration, /public\.user_access_profiles\.beta_access_status = 'blocked'/);
  assert.match(migration, /insert into public\.user_role_assignments/);
});

test('backfill fills only missing or blank networking dates from auth registration', () => {
  assert.match(migration, /from auth\.users auth_user[\s\S]*join public\.profiles profile on profile\.id = auth_user\.id/i);
  assert.match(migration, /pg_catalog\.to_char\(auth_user\.created_at at time zone 'UTC', 'YYYY-MM-DD'\)/i);
  assert.match(migration, /on conflict \(user_id, setting_key\) do update[\s\S]*set setting_value = excluded\.setting_value[\s\S]*where public\.user_settings\.setting_value is null[\s\S]*or pg_catalog\.btrim\(public\.user_settings\.setting_value\) = ''/i);
  assert.doesNotMatch(migration, /alter table|grant\s|revoke\s|delete from|drop\s/i);
});

test('verifier covers invariant, exact uniqueness, permissions and rolled-back trigger behavior', () => {
  assert.match(verifier, /^begin;/m);
  assert.match(verifier, /A profile is missing Fecha_Inicio_Networking/);
  assert.match(verifier, /Fecha_Inicio_Networking contains a null or empty value/);
  assert.match(verifier, /index_definition\.indnkeyatts = 2[\s\S]*array\['user_id', 'setting_key'\]/);
  assert.match(verifier, /authenticated user_settings privileges changed/);
  assert.match(verifier, /Auth user trigger did not persist the UTC registration date/);
  assert.match(verifier, /Non-allowlisted auth user no longer fails closed/);
  assert.match(verifier, /^rollback;$/m);
});

test('canonical date remains readable and editable through the existing UI', () => {
  assert.equal(parseDateSetting('2024-03-01')?.toISOString(), '2024-03-01T00:00:00.000Z');
  assert.match(settingComponent, /type="date"/);
  assert.match(settingComponent, /saveUserSetting\(NETWORKING_START_SETTING, draftDate\)/);
  assert.match(settingComponent, /const NETWORKING_START_SETTING = "Fecha_Inicio_Networking"/);
});
