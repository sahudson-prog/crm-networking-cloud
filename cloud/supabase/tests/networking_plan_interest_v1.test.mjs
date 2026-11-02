import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const file = (path) => readFileSync(new URL(path, root), 'utf8');

test('preflight y verificador son read-only; migration es transaccional', () => {
  for (const path of ['preflight/202610290001_preflight_networking_plan_interest_v1.sql',
    'verifiers/202610290001_verify_networking_plan_interest_v1.sql']) {
    const sql = file(path);
    assert.match(sql, /begin transaction read only;/i);
    assert.match(sql, /rollback;\s*$/i);
  }
  const migration = file('migrations/202610290001_networking_plan_interest_v1.sql');
  assert.match(migration, /^-- PROD CONTRACT CHANGE:/);
  assert.match(migration, /begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.match(migration, /on conflict \(user_id, objective_type\) do nothing/i);
  assert.match(migration, /references auth\.users\(id\) on delete cascade/i);
  assert.doesNotMatch(migration, /create or replace function public\.reset_current_user_app_data_v0_1/i);
  assert.doesNotMatch(migration, /delete from public\.networking_cycles/i);
});

test('operaciones manuales tienen fronteras explícitas', () => {
  const audience = file('operations/manual/202610290001_networking_plan_notice_audience.sql');
  assert.match(audience, /begin transaction read only;/i);
  assert.match(audience, /rollback;\s*$/i);
  const close = file('operations/manual/202610290001_close_networking_plan_notice_mode.sql');
  assert.match(close, /v_approved boolean := false/);
  assert.match(close, /v_modality text := null/);
  assert.match(close, /v_expected_count integer := null/);
  assert.match(close, /mode_close_count_changed/);
  assert.match(close, /rollback;\s*$/i);
  assert.doesNotMatch(close, /cascade/i);
});
