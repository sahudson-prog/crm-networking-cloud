const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const { createPreviewStore } = require('./local/onboarding-preview-storage.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
const baseline = file => execFileSync('git', ['show', `6ab1913:cloud/web/${file}`], { cwd: root, encoding: 'utf8' }).replaceAll('\r\n', '\n');

test('owner fixture stays isolated from prior walkthroughs and negative scenarios without deleting them', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const original = createPreviewStore(storage, '');
  original.write('progress', { status: 'completed' });
  const owner = createPreviewStore(storage, '?case=owner');
  assert.equal(owner.read('progress', null), null);
  owner.write('profile', { fullName: 'Synthetic' });
  assert.deepEqual(createPreviewStore(storage, '?surface=account&case=owner').read('profile', null), { fullName: 'Synthetic' });
  assert.equal(createPreviewStore(storage, '?case=owner&fail-save').read('profile', null), null);
  assert.deepEqual(original.read('progress', null), { status: 'completed' });
  assert.throws(() => createPreviewStore(storage, '?case=../invalid'), /Invalid/);
});

test('editorial, normal priorities popup and shell paint preserve the exact local baseline', () => {
  for (const file of ['components/EditorialFeed.tsx', 'components/ObjectivesPage.tsx', 'styles/shell.css']) {
    assert.equal(read(file), baseline(file), file);
  }
  const css = read('styles/gamification.css');
  assert.doesNotMatch(css, /\.editorial-home\s|editorial-(dots|viewport|more)/);
  assert.match(css, /\.editorial-home-grid > \.editorial-block \{ grid-column: 1 \/ -1; grid-row: 3; \}/);
  assert.match(read('components/ReadOnlyDashboard.tsx'), /<EditorialFeed\/>/);
});

test('account and onboarding share labels, field presentation and persisted codes', () => {
  const fields = read('components/StartingPointFields.tsx');
  assert.match(fields, /<span>¿Cómo te llamas\?<\/span>/);
  assert.match(fields, /<span>Situación profesional<\/span>/);
  assert.doesNotMatch(fields, /¿Cómo te llamamos|¿Cuál es tu situación/);
  assert.doesNotMatch(read('styles/onboarding.css'), /\.starting-point-field \{/);
  assert.match(read('lib/startingPoint.ts'), /code: "employed", label: "Dependiente"/);
  assert.match(read('lib/startingPoint.ts'), /code: "unemployed", label: "En búsqueda activa"/);
  assert.equal(read('lib/startingPointActions.ts'), baseline('lib/startingPointActions.ts'));
  const css = read('styles/components.css');
  assert.match(css, /\.objectives-priorities \.panel-title \.icon \{\s*width: 20px;\s*height: 20px;\s*color: var\(--crm-primary\);/);
});

test('visual correction keeps editorial behavior and uses only a scoped width override', () => {
  const css=read('styles/gamification.css');
  assert.match(css, /@media \(min-width: 1024px\) \{ \.editorial-home-grid > \.editorial-block \{ width: 100%; aspect-ratio: auto; height: 480px;/);
  assert.match(css, /grid-auto-rows: 1fr/);
  assert.doesNotMatch(css, /\.gam-result/);
  const panel=read('components/GamificationPanel.tsx');
  assert.match(panel, /gam-goal-heading[\s\S]*?gam-complete[\s\S]*?<\/div>[\s\S]*?gam-progress-row/);
  const preview=read('tests/local/onboarding-three-step-preview.cjs');
  assert.match(preview, /import \{ShellChrome\}/);
  assert.match(preview, /<OnboardingProvider><ShellChrome>/);
  assert.doesNotMatch(preview, /<ShellHeader linkedBrand=\{false\}/);
});

function statusWriter({ previous = 'Pendiente', fail = false, focus = false } = {}) {
  let revisions = 0, writes = 0;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-owner' } } }) },
    from(table) {
      const query = {
        select() { return query; }, eq() { return query; }, insert() { return query; },
        update() { if (table === 'contacts') writes++; return query; },
        maybeSingle: async () => ({ data: { id: 'synthetic-contact', networking_status: previous, networking_focus:focus, is_headhunter:false } }),
        single: async () => ({ data: { id: 'synthetic-invocation' } }),
        then(resolve, reject) { return Promise.resolve({ error: table === 'contacts' && fail ? Error('synthetic write failure') : null }).then(resolve, reject); }
      };
      return query;
    }
  };
  const dependencies = {
    './supabaseClient': { supabase: client },
    './networkingDataRevision': { notifyNetworkingDataChanged: () => revisions++ },
    './format': {}, './cycleObjectiveActions': {},
    './coachRuleTriggers': { triggerCoachRuleReviewForContacts: async () => {} },
    './networkingCycles': { networkingWriteContext: async () => 'synthetic' }
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(read('lib/contactActions.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', compiled)(id => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`); return dependencies[id];
  }, module, module.exports);
  return { execute: () => module.exports.updateContactNetworkingStatus('synthetic-contact', 'Contactado'),
    flags: (networkingFocus) => module.exports.updateContactFlags('synthetic-contact',{networkingFocus}),
    result: () => ({ revisions, writes }) };
}

test('real shared status writer returns the onboarding transition and invalidates Home once', async () => {
  const writer = statusWriter();
  assert.deepEqual(await writer.execute(), { previousStatus: 'Pendiente', status: 'Contactado' });
  assert.deepEqual(writer.result(), { revisions: 1, writes: 1 });
});

test('no-op status cannot credit a new exercise or emit a revision; failed write cannot invalidate', async () => {
  const noop = statusWriter({ previous: 'Contactado' });
  assert.deepEqual(await noop.execute(), { previousStatus: 'Contactado', status: 'Contactado' });
  assert.deepEqual(noop.result(), { revisions: 0, writes: 0 });
  const failed = statusWriter({ fail: true });
  await assert.rejects(failed.execute(), /synthetic write failure/);
  assert.deepEqual(failed.result(), { revisions: 0, writes: 1 });
});

test('real Foco writer invalidates once after saving; no-op and rejected updates do not invalidate',async()=>{
  const writer=statusWriter();assert.deepEqual(await writer.flags(true),{updated:true});
  assert.deepEqual(writer.result(),{revisions:1,writes:1});
  const noop=statusWriter({focus:true});assert.deepEqual(await noop.flags(true),{updated:false});
  assert.deepEqual(noop.result(),{revisions:0,writes:0});
  const failed=statusWriter({fail:true});await assert.rejects(failed.flags(true),/synthetic write failure/);
  assert.deepEqual(failed.result(),{revisions:0,writes:1});
});
