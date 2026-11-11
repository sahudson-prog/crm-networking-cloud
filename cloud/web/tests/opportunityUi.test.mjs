import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const component = (name) => readFileSync(new URL(`components/${name}`, root), 'utf8');
const controls = (source, tag) => {
  const file = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const results = [];
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(file) === tag) {
        results.push(new Set(node.attributes.properties.map((attribute) => attribute.name?.getText(file))));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return results;
};

test('Kanban offers drag-and-drop and a keyboard stage menu without a card dropdown', () => {
  const board = component('OpportunityBoard.tsx');
  const popover = component('OpportunityCardPopover.tsx');
  const shared = component('ui/StatusBoard.tsx');
  assert.match(board, /<StatusBoard\s/);
  assert.match(board, /<StatusBoardCard\s/);
  assert.ok(controls(shared, 'div').some((attributes) => attributes.has('draggable') && attributes.has('onDragStart')));
  assert.ok(controls(shared, 'div').some((attributes) => attributes.has('onDrop') && attributes.has('onDragOver')));
  assert.equal(controls(board, 'select').length, 0);
  assert.match(board, /icon="more"/);
  assert.match(board, /<OpportunityCardPopover/);
  assert.match(popover, /role="dialog"/);
  assert.match(popover, /onMove\(action\.row, stage\)/);
  assert.match(popover, /Causa de cierre/);
  assert.doesNotMatch(popover, /Contactos|Interacciones|Prioridades|Enlace de postulación/);
  assert.match(board, /<Icon name="tag"/);
  assert.match(board, /objective-chip opportunity-card-action/);
  assert.doesNotMatch(board, /finalize: true/);
  assert.match(board, /OPPORTUNITY_STAGES\.map/);
});

test('editor is reachable from Objectives, not from Contact profile', () => {
  const objectives = component('ObjectivesPage.tsx');
  const profile = component('ContactProfile.tsx');
  assert.ok(objectives.indexOf('<OpportunityBoard') > objectives.indexOf('objectives-priorities'));
  assert.match(objectives, /<OpportunityEditor/);
  assert.doesNotMatch(profile, /<OpportunityEditor|setOpportunityRequest|opportunitiesAvailable/);
  assert.match(objectives, /objectiveId: objective\.id/);
});

test('editor keeps native modal focus, required title, result, relationships and explicit void', () => {
  const editor = component('OpportunityEditor.tsx');
  assert.ok(controls(editor, 'dialog').some((attributes) => attributes.has('aria-labelledby') && attributes.has('onCancel')));
  assert.ok(controls(editor, 'input').some((attributes) => attributes.has('required') && attributes.has('maxLength')));
  assert.match(editor, /draft\.situation === "finalized"/);
  assert.match(editor, /Causa de cierre/);
  assert.match(editor, /opportunityResultsForStage\(draft\.stage\)/);
  assert.match(editor, /contact-search-select/);
  assert.match(editor, /<ObjectiveSelector/);
  assert.match(editor, /<RelationChoices title="Interacciones"/);
  assert.match(editor, /voidOpportunity\(draft\.id\)/);
  assert.ok(controls(editor, 'form').some((attributes) => attributes.has('onSubmit')));
});

test('editor preserves request identity, prevents simultaneous writes and keeps missing linked rows visible', () => {
  const editor = component('OpportunityEditor.tsx');
  assert.match(editor, /creationRequestId: row \? undefined : crypto\.randomUUID\(\)/);
  assert.match(editor, /if \(inFlight\.current \|\| cannotSave\) return/);
  assert.match(editor, /version === requestVersion\.current/);
  assert.match(editor, /Vincula un contacto para asociar interacciones/);
  assert.match(editor, /interacciones dejarán de estar vinculadas al guardar/);
  assert.ok(controls(editor, 'fieldset').some((attributes) => attributes.has('disabled')));
  assert.match(editor, /Vínculo conservado/);
});

test('title-only save is independent of choice reads; contact search is opt-in and priorities follow interactions', () => {
  const editor = component('OpportunityEditor.tsx');
  assert.match(editor, /draft\.contactIds\.length && \(loading/);
  assert.match(editor, /draft\.objectiveIds\.length && \(loading/);
  assert.match(editor, /contactQuery\.trim\(\) \? contacts\.filter/);
  assert.match(editor, /contactQuery\.trim\(\) \? <div id=/);
  assert.match(editor, /setContactQuery\(""\)/);
  assert.ok(editor.indexOf('<ObjectiveSelector') > editor.indexOf('<RelationChoices title="Interacciones"'));
  assert.match(editor, /failure instanceof OpportunityFailure/);
  const css = readFileSync(new URL('styles/components.css', root), 'utf8');
  assert.match(css, /\.opportunity-editor-feedback\s*\{ font-weight: 600;/);
  assert.doesNotMatch(editor, /className="form-error"/);
  assert.doesNotMatch(css, /\.opportunity-column\.identified \{ background: var\(--crm-status-pendiente-soft\)/);
  const board = component('OpportunityBoard.tsx');
  assert.match(board, /<BriefcaseBusiness size=\{22\} strokeWidth=\{1\.8\}/);
});

test('board ignores stale reads and does not offer creation during loading or failure', () => {
  const board = component('OpportunityBoard.tsx');
  assert.match(board, /version === loadVersion\.current/);
  assert.match(board, /const busy = loading \|\| Boolean\(error\)/);
  assert.match(board, /disabled=\{editorBlocked\}/);
  assert.match(board, /if \(busy \|\| editor \|\| row\.situation !== "active"\) return/);
});

// Run the real action module with an entirely in-memory transport. Unexpected
// imports fail closed: these tests cannot instantiate Supabase or contact a service.
function actionFixture({ changeVersion = false, rpcError = null, failTable = '', noCycle = false } = {}) {
  const calls = [];
  const rows = Array.from({ length: 401 }, (_, i) => ({ id: `opp-${String(i).padStart(4, '0')}`,
    user_id: 'synthetic-owner', cycle_id: 'cycle', title: 'Synthetic', stage: 'identified', result: null,
    result_note: null, company: null, application_url: null, voided_at: null, updated_at: '2026-01-01T00:00:00Z' }));
  const links = Array.from({ length: 1201 }, (_, i) => ({ user_id: 'synthetic-owner',
    opportunity_id: rows[0].id, contact_id: `contact-${String(i).padStart(4, '0')}` }));
  const tables = { opportunities: rows, opportunity_contacts: links, opportunity_objectives: [], opportunity_interactions: [],
    contacts: [{ id: 'contact-1', user_id: 'synthetic-owner', display_name: 'One', is_active: true },
      { id: 'contact-2', user_id: 'synthetic-owner', display_name: 'Two', is_active: true }],
    objectives: [{ id: 'priority-1', user_id: 'synthetic-owner', cycle_id: 'cycle', objective_name: 'Priority',
      objective_type: 'COMPANY', priority_level: 'HIGH', is_active: true }],
    interaction_participants: [
      { id: 'participant-1', user_id: 'synthetic-owner', contact_id: 'contact-1', interaction_id: 'interaction-1' },
      { id: 'participant-2', user_id: 'synthetic-owner', contact_id: 'contact-2', interaction_id: 'interaction-1' },
      { id: 'participant-3', user_id: 'synthetic-owner', contact_id: 'other-contact', interaction_id: 'interaction-2' }
    ],
    interactions: [
      { id: 'interaction-1', user_id: 'synthetic-owner', subject: 'Eligible', interaction_type: 'manual', is_deleted: false },
      { id: 'interaction-2', user_id: 'synthetic-owner', subject: 'Not eligible', interaction_type: 'manual', is_deleted: false }
    ] };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-owner' } }, error: null }) },
    rpc(name, input) {
      if (name === 'read_opportunity_interactions_v1') return client.from('interactions').select('id,subject,interaction_type,occurred_at')
        .in('id', input.p_ids).eq('is_deleted', false);
      calls.push({ name, input }); return Promise.resolve({ data: '00000000-0000-4000-8000-000000000001', error: rpcError });
    },
    from(table) {
      let columns = ''; let from = 0; let to = 999; const predicates = []; const orders = [];
      const query = {
        select(value) { columns = value; return query; },
        eq(key, value) { predicates.push((row) => row[key] === value); return query; },
        is(key, value) { return query.eq(key, value); },
        in(key, values) { predicates.push((row) => values.includes(row[key])); return query; },
        order(key) { orders.push(key); return query; },
        range(start, end) { from = start; to = end; return query; },
        then(resolve, reject) {
          const data = (tables[table] ?? []).filter((row) => predicates.every((predicate) => predicate(row)))
            .sort((a, b) => { for (const key of orders) { const result = String(a[key]).localeCompare(String(b[key])); if (result) return result; } return 0; })
            .slice(from, to + 1).map((row) => Object.fromEntries(columns.split(',').map((key) => [key,
              changeVersion && columns === 'id,updated_at' && key === 'updated_at' ? 'changed' : row[key]])));
          return Promise.resolve({ data: failTable === table ? null : data,
            count: (tables[table] ?? []).filter((row) => predicates.every((predicate) => predicate(row))).length,
            error: failTable === table ? new Error(`synthetic ${table} failure`) : null }).then(resolve, reject);
        }
      };
      return query;
    }
  };
  const load = (file, require) => {
    const module = { exports: {} };
    const source = readFileSync(new URL(`lib/${file}.ts`, root), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require });
    return module.exports;
  };
  const model = load('opportunityModel', () => { throw new Error('Unexpected model import'); });
  const diagnostics = load('opportunityDiagnostics', () => { throw new Error('Unexpected diagnostics import'); });
  const actions = load('opportunityActions', (name) => {
    if (name === './interactionState') return load('interactionState', () => { throw new Error('Unexpected visibility import'); });
    if (name === './supabaseClient') return { supabase: client };
    if (name === './opportunityModel') return model;
    if (name === './opportunityDiagnostics') return diagnostics;
    if (name === './networkingCycles') return {
      expectedNetworkingContext: async () => ({ cycleId: noCycle ? null : 'cycle', token: 'synthetic-token' }),
      readNetworkingCycles: async () => noCycle ? [] : [{ id: 'cycle', status: 'active', objective_type: 'JOB_SEARCH' }],
      networkingContextFromCycles: () => ({ cycleId: noCycle ? null : 'cycle', token: 'synthetic-token' })
    };
    throw new Error(`Unexpected action import: ${name}`);
  });
  return { actions, calls };
}

test('real read action pages opportunities and relations beyond API limits', async () => {
  const { actions } = actionFixture();
  const rows = await actions.readOpportunities();
  assert.equal(rows.length, 401);
  assert.equal(rows.find((row) => row.id === 'opp-0000').contact_ids.length, 1201);
  assert.equal(new Set(rows.find((row) => row.id === 'opp-0000').contact_ids).size, 1201);
});

test('real read action rejects fields/relations from different versions', async () => {
  const { actions } = actionFixture({ changeVersion: true });
  await assert.rejects(actions.readOpportunities(), /cambiaron/);
});

test('relation reads isolate a failed source and never treat it as a successful empty list', async () => {
  const { actions } = actionFixture({ failTable: 'objectives' });
  const choices = await actions.readOpportunityChoices();
  assert.equal(choices.contacts.status, 'fulfilled');
  assert.equal(choices.contacts.value.length, 2);
  assert.equal(choices.objectives.status, 'rejected');
  await assert.rejects(actionFixture({ failTable: 'interaction_participants' })
     .actions.readEligibleOpportunityInteractions(['contact-1']), /opportunity_uncertain/);
});

test('absence of an active cycle does not invalidate contact choices', async () => {
  const { actions } = actionFixture({ noCycle: true });
  const choices = await actions.readOpportunityChoices();
  assert.equal(choices.contacts.status, 'fulfilled');
  assert.equal(choices.contacts.value.length, 2);
  assert.equal(choices.objectives.status, 'fulfilled');
  assert.equal(choices.objectives.value.length, 0);
});

test('priority choices supply the fields used by the existing grouped selector', async () => {
  const { actions } = actionFixture();
  const choices = await actions.readOpportunityChoices();
  assert.equal(choices.objectives.status, 'fulfilled');
  assert.deepEqual(choices.objectives.value[0], {
    id: 'priority-1', objective_name: 'Priority', objective_type: 'COMPANY', priority_level: 'HIGH'
  });
});

test('interaction choices require a selected participant, deduplicate, and allow no contacts', async () => {
  const { actions } = actionFixture();
  assert.equal((await actions.readEligibleOpportunityInteractions([])).length, 0);
  const choices = await actions.readEligibleOpportunityInteractions(['contact-1']);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].id, 'interaction-1');
  assert.equal((await actions.readEligibleOpportunityInteractions(['contact-1', 'contact-2'])).length, 1);
});

test('real save action forwards one stable creation request without client ownership and propagates denial', async () => {
  const input = { creationRequestId: 'synthetic-request', title: ' Synthetic ', company: '', applicationUrl: '',
    stage: 'identified', situation: 'active', result: null, resultNote: '', contactIds: ['contact', 'contact'], objectiveIds: [], interactionIds: [] };
  const { actions, calls } = actionFixture();
  assert.equal(await actions.saveOpportunity(input), '00000000-0000-4000-8000-000000000001');
  assert.equal(await actions.saveOpportunity(input), '00000000-0000-4000-8000-000000000001');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.name, 'save_opportunity_v2');
    assert.equal(call.input.p_situation, 'active');
    assert.equal(call.input.p_creation_request_id, input.creationRequestId);
    assert.equal(call.input.p_contact_ids.length, 1);
    assert.ok(!Object.keys(call.input).some((key) => /user|email/.test(key)));
  }
  await assert.rejects(actionFixture({ rpcError: { code: '42501', message: 'app_access_denied' } }).actions.saveOpportunity(input), /opportunity_rejected/);
});

test('title-only creation sends empty relation arrays despite unrelated choice read errors', async () => {
  const { actions, calls } = actionFixture({ failTable: 'contacts' });
  const choices = await actions.readOpportunityChoices();
  assert.equal(choices.contacts.status, 'rejected');
  await actions.saveOpportunity({ creationRequestId: 'title-only', title: 'Title only', company: '',
    applicationUrl: '', stage: 'identified', situation: 'active', result: null, resultNote: '',
    contactIds: [], objectiveIds: [], interactionIds: [] });
  assert.equal(calls[0].input.p_contact_ids.length, 0);
  assert.equal(calls[0].input.p_objective_ids.length, 0);
  assert.equal(calls[0].input.p_interaction_ids.length, 0);
});
