import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';

const root = new URL('../', import.meta.url);
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    if (name in dependencies) return dependencies[name];
    throw Error(`Unexpected dependency: ${name}`);
  } });
  return module.exports;
}

function detailFixture({ failTable, failAssignments = false } = {}) {
  const calls = [];
  const rows = Array.from({ length: 401 }, (_, i) => ({ id: String(i).padStart(4, '0'),
    display_name: 'Synthetic', interaction_id: String(i).padStart(4, '0'), is_active: true }));
  const supabase = { from(table) {
    let start = 0, end = 199;
    const filters = [], orders = [];
    const query = {
      select(_columns, options) { assert.equal(options.count, 'exact'); return query; },
      eq(key, value) { filters.push(r => r[key] === value); return query; },
      in(key, values) { assert.ok(values.length <= 100); filters.push(r => values.includes(r[key])); return query; },
      order(key) { orders.push(key); return query; },
      range(from, to) { start = from; end = to; return query; },
      then(resolve, reject) {
        calls.push({ table, start, orders });
        const all = rows.filter(r => filters.every(f => f(r)));
        return Promise.resolve({ data: all.slice(start, Math.min(end + 1, start + 100)), count: all.length,
          error: table === failTable ? Error('synthetic') : null }).then(resolve, reject);
      }
    };
    return query;
  } };
  const readers = load('lib/cloudData.ts', {
    './supabaseClient': { supabase }, './completeRead': load('lib/completeRead.ts'),
    './interactionState': {}, './kpiCalculations': {},
    './cycleObjectiveActions': { readObjectiveAssignmentsForContacts: async () => {
      if (failAssignments) throw Error('synthetic');
      return new Map();
    } }
  });
  return { readers, rows, calls };
}

test('dashboard complete detail readers do not truncate at API cap 100', async () => {
  const { readers, rows, calls } = detailFixture();
  assert.equal((await readers.readAllActiveContacts(true)).length, 401);
  assert.equal((await readers.readInteractionParticipants(true)).length, 401);
  assert.equal((await readers.readExternalSourcesForInteractions([...rows.map(r => r.id), rows[0].id], true)).length, 401);
  assert.ok(calls.every(c => c.orders.includes('id')));
  assert.deepEqual(calls.filter(c => c.table === 'contacts').map(c => c.start), [0, 100, 200, 300, 400]);
});

test('failed detail or assignment reads reject instead of producing valid empty data', async () => {
  await assert.rejects(detailFixture({ failTable: 'contacts' }).readers.readAllActiveContacts(true), /complete_read_failed/);
  await assert.rejects(detailFixture({ failAssignments: true }).readers.readAllActiveContacts(true), /dashboard_assignments_unavailable/);
  await assert.rejects(detailFixture({ failTable: 'external_interaction_sources' }).readers.readExternalSourcesForInteractions(['0000'], true), /complete_read_failed/);
});

test('dashboard detail composition opts into complete reads and keeps failures independent of metrics', async () => {
  const calls = [];
  const dependencies = {};
  for (const name of ['readAllActiveContacts', 'readAllInteractions', 'readInteractionParticipants', 'readDashboardReferrals', 'readExternalSourcesForInteractions']) {
    dependencies[name] = async (...args) => { calls.push([name, ...args]); return [{ id: 'synthetic' }]; };
  }
  const { readDashboardDetails } = load('lib/dashboardDetails.ts', { './cloudData': dependencies });
  const result = await readDashboardDetails();
  assert.equal(result.contacts.length, 1);
  assert.ok(calls.some(([name, complete]) => name === 'readAllActiveContacts' && complete === true));
  assert.ok(calls.some(([name, complete]) => name === 'readInteractionParticipants' && complete === true));
  assert.ok(calls.some(([name, ids, complete]) => name === 'readExternalSourcesForInteractions' && ids[0] === 'synthetic' && complete === true));
  dependencies.readDashboardReferrals = async () => { throw Error('synthetic'); };
  await assert.rejects(readDashboardDetails(), /synthetic/);
});

test('the original KPI chart remains unchanged when no stacked series is supplied', () => {
  const { KpiLineChart } = load('components/DashboardKpis.tsx', {
    react: React, 'react/jsx-runtime': jsx, './ui/HelpTooltip': {}
  });
  const html = renderToStaticMarkup(React.createElement(KpiLineChart, {
    trend: { title: 'Original', points: [{ label: 'A', total: 2, firstTime: 1 }, { label: 'B', total: 3, firstTime: 2 }] }
  }));
  assert.match(html, /viewBox="0 0 320 118"/);
  assert.equal((html.match(/class="kpi-first-bar"/g) ?? []).length, 2);
  assert.equal((html.match(/class="kpi-total-dot"/g) ?? []).length, 2);
  assert.match(html, /class="kpi-total-line"/);
  assert.doesNotMatch(html, /tracking-chart|kpi-future-bar/);
  assert.doesNotMatch(html, /rotate\(-45/);
});
