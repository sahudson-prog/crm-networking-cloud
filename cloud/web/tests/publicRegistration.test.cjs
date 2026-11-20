const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Match the local fixture toolchain; transpilation supports TS parameter properties.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { loadPublicRegistrationStatus, loadPublicRegistrationAdminState, setPublicRegistration,
  reconcilePublicRegistration, publicRegistrationLoginMessage } = require('../lib/publicRegistration.ts');
const { resolveBootstrappedAppAccessForSession } = require('../lib/appAccess.ts');
const allow = async () => ({ allowed: true });
const deny = async () => ({ allowed: false });
const response = (data, error = null) => ({ data, error });
const client = data => ({ rpc: async () => response(data) });
const current = { enabled: false, revision: 4 };

test('public ON/OFF only calls anonymous status with no identity', async () => {
  for (const enabled of [true, false]) {
    const calls = [];
    assert.deepEqual(await loadPublicRegistrationStatus({ rpc: async (...args) => {
      calls.push(args); return response({ enabled });
    } }), { status: 'ready', enabled });
    assert.deepEqual(calls, [['public_registration_status_v1', undefined]]);
  }
});

test('missing, malformed, failed and timed-out public status fail closed', async () => {
  const candidates = [null, ...[null, undefined, {}, [], [{ enabled: true }], true, { enabled: 'true' }, { enabled: 1 }].map(client),
    { rpc: async () => response({ enabled: true }, { code: 'PGRST202' }) },
    { rpc: async () => { throw Error('private diagnostic'); } }, { rpc: () => new Promise(() => {}) }];
  for (const candidate of candidates) {
    assert.deepEqual(await loadPublicRegistrationStatus(candidate, 5), { status: 'unavailable', enabled: false });
  }
});

test('admin capability gate blocks denied reads and writes before RPC', async () => {
  const calls = [];
  const blocked = { rpc: async name => { calls.push(name); return response(current); } };
  await assert.rejects(loadPublicRegistrationAdminState(blocked, deny), /No tienes permiso/);
  assert.deepEqual(await setPublicRegistration(blocked, deny, current, true), { outcome: 'denied', state: null });
  assert.deepEqual(calls, []);
  await loadPublicRegistrationAdminState(client(current), async capability => {
    assert.equal(capability, 'admin.manage_access'); return allow();
  });
});

test('admin reads require boolean enabled and nonnegative safe integer revision', async () => {
  assert.deepEqual(await loadPublicRegistrationAdminState(client(current), allow), current);
  for (const data of [null, [], { enabled: false }, { ...current, revision: '4' },
    { ...current, revision: -1 }, { ...current, revision: 1.5 }, { ...current, revision: Number.MAX_SAFE_INTEGER + 1 }]) {
    await assert.rejects(loadPublicRegistrationAdminState(client(data), allow));
  }
  await assert.rejects(loadPublicRegistrationAdminState({ rpc: async () => response(current, { code: '42501' }) }, allow));
  await assert.rejects(loadPublicRegistrationAdminState({ rpc: () => new Promise(() => {}) }, allow, 5));
});

test('ON and OFF writes send the expected revision and use authoritative response', async () => {
  for (const enabled of [true, false]) {
    const calls = [], next = { enabled, revision: 5 };
    assert.deepEqual(await setPublicRegistration({ rpc: async (...args) => {
      calls.push(args); return response(next);
    } }, allow, { ...current, enabled: !enabled }, enabled), { outcome: 'saved', state: next });
    assert.deepEqual(calls, [['admin_set_public_registration_v1', { p_enabled: enabled, p_expected_revision: 4 }]]);
  }
});

for (const failure of ['throw', 'conflict', 'malformed', 'wrong-value', 'old-revision', 'timeout']) {
  test(`${failure}: recheck permission and reread without automatically retrying write`, async () => {
    const calls = [], next = { enabled: true, revision: 7 };
    let checks = 0;
    const result = await setPublicRegistration({ rpc: async name => {
      calls.push(name);
      if (name === 'admin_public_registration_state_v1') return response(next);
      if (failure === 'throw') throw Error('lost response');
      if (failure === 'timeout') return new Promise(() => {});
      if (failure === 'conflict') return response(null, { message: 'public_registration_revision_conflict' });
      return response(failure === 'wrong-value' ? { enabled: false, revision: 5 }
        : failure === 'old-revision' ? { enabled: true, revision: 4 } : {});
    } }, async () => { checks++; return allow(); }, current, true, 5);
    assert.deepEqual(result, { outcome: 'reconciled', state: next });
    assert.equal(checks, 2);
    assert.deepEqual(calls, ['admin_set_public_registration_v1', 'admin_public_registration_state_v1']);
  });
}

test('failed reconciliation clears state; revoked capability prevents reread', async () => {
  assert.deepEqual(await setPublicRegistration({ rpc: async () => response(null, { code: '42501' }) }, allow, current, true),
    { outcome: 'unavailable', state: null });
  let checks = 0;
  const calls = [];
  assert.deepEqual(await setPublicRegistration({ rpc: async name => {
    calls.push(name); throw Error('lost response');
  } }, async () => ({ allowed: ++checks === 1 }), current, true), { outcome: 'denied', state: null });
  assert.deepEqual(calls, ['admin_set_public_registration_v1']);
});

test('permission error and malformed baseline never send a mutation', async () => {
  let calls = 0;
  const blocked = { rpc: async () => { calls++; return response(null); } };
  for (const [check, before, enabled] of [[async () => { throw Error('network'); }, current, true],
    [allow, null, true], [allow, current, 'true']]) {
    assert.deepEqual(await setPublicRegistration(blocked, check, before, enabled), { outcome: 'unavailable', state: null });
  }
  assert.equal(calls, 0);
});

test('P2: unchanged rereads preserve uncertainty until timed-out write settles and a fresh read completes', async () => {
  let finishWrite, stored = current, writes = 0;
  const pending = new Promise(resolve => { finishWrite = resolve; });
  const fixture = { rpc: async name => {
    if (name === 'admin_set_public_registration_v1') { writes++; return pending; }
    return response(stored);
  } };
  const first = await setPublicRegistration(fixture, allow, current, true, 5);
  assert.equal(first.outcome, 'pending');
  assert.equal(first.state, null);
  assert.equal(first.uncertainty.revision, 4);
  for (let attempt = 0; attempt < 3; attempt++) {
    const reread = await reconcilePublicRegistration(fixture, allow, first.uncertainty, 5);
    assert.equal(reread.outcome, 'pending');
    assert.equal(reread.state, null);
    assert.equal(reread.uncertainty, first.uncertainty);
  }
  stored = { enabled: true, revision: 5 };
  finishWrite(response(stored));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(first.uncertainty.pending.settled, true);
  assert.deepEqual(await reconcilePublicRegistration(fixture, allow, first.uncertainty),
    { outcome: 'reconciled', state: stored });
  assert.equal(writes, 1);
});

test('P2: write settling during an old reread still requires another fresh read', async () => {
  const uncertainty = { revision: 4, pending: { settled: false } };
  const result = await reconcilePublicRegistration({ rpc: async () => {
    uncertainty.pending.settled = true;
    return response(current);
  } }, allow, uncertainty);
  assert.equal(result.outcome, 'pending');
  assert.equal(result.state, null);
  assert.deepEqual(await reconcilePublicRegistration(client(current), allow, result.uncertainty),
    { outcome: 'reconciled', state: current });
});

test('P2: definitive RPC error allows authoritative reread at unchanged revision', async () => {
  const calls = [];
  const result = await setPublicRegistration({ rpc: async name => {
    calls.push(name);
    return name === 'admin_set_public_registration_v1' ? response(null, { code: '42501' }) : response(current);
  } }, allow, current, true);
  assert.deepEqual(result, { outcome: 'reconciled', state: current });
  assert.deepEqual(calls, ['admin_set_public_registration_v1', 'admin_public_registration_state_v1']);
});

test('P2: permission errors are unavailable and reconciliation retains pending baseline across failures', async () => {
  const uncertainty = { revision: 4, pending: { settled: false } };
  for (const status of ['error', 'missing_model', 'denied', 'no_session']) {
    const expected = ['error', 'missing_model'].includes(status) ? 'unavailable' : 'denied';
    const check = async () => ({ allowed: false, status });
    assert.deepEqual(await reconcilePublicRegistration({ rpc: () => assert.fail('RPC must not run') }, check, uncertainty),
      { outcome: expected, state: null, uncertainty });
    assert.deepEqual(await setPublicRegistration(client(current), check, current, true), { outcome: expected, state: null });
  }
});

test('login distinguishes ON/OFF/unknown and preserves existing sign in', () => {
  assert.match(publicRegistrationLoginMessage({ status: 'ready', enabled: true }), /crear tu cuenta o iniciar/);
  assert.match(publicRegistrationLoginMessage({ status: 'ready', enabled: false }), /cerrado.*ya tienes acceso o una/);
  for (const status of ['checking', 'unavailable']) {
    assert.match(publicRegistrationLoginMessage({ status, enabled: false }), /puedes iniciar/);
    assert.doesNotMatch(publicRegistrationLoginMessage({ status, enabled: false }), /^El registro libre está (disponible|cerrado)/);
  }
});

test('public ON never bypasses authenticated bootstrap or central access', async () => {
  assert.equal((await loadPublicRegistrationStatus(client({ enabled: true }))).enabled, true);
  const calls = [];
  const result = await resolveBootstrappedAppAccessForSession({ user: { id: 'synthetic' } }, { rpc: async name => {
    calls.push(name); return response({ allowed: name === 'bootstrap_current_user_invitation_v1', reason: 'denied' });
  } });
  assert.equal(result.status, 'denied');
  assert.deepEqual(calls, ['bootstrap_current_user_invitation_v1', 'current_user_app_access_status']);
});

test('bootstrap access_source public_registration is additive, never an authorization shortcut', async () => {
  for (const bootstrapAllowed of [true, false]) {
    for (const centralAllowed of [true, false]) {
      const calls = [];
      const result = await resolveBootstrappedAppAccessForSession({ user: { id: 'synthetic' } }, { rpc: async name => {
        calls.push(name);
        return response({ allowed: name === 'bootstrap_current_user_invitation_v1' ? bootstrapAllowed : centralAllowed,
          reason: null, access_source: 'public_registration' });
      } });
      assert.equal(result.status, bootstrapAllowed && centralAllowed ? 'allowed' : 'denied');
      assert.deepEqual(calls, bootstrapAllowed ? ['bootstrap_current_user_invitation_v1', 'current_user_app_access_status']
        : ['bootstrap_current_user_invitation_v1']);
    }
  }
});

test('panel stays independent and confirmed; AuthGate change is presentation-only', () => {
  const read = file => fs.readFileSync(require('node:path').join(__dirname, '..', 'components', file), 'utf8');
  const panel = read('PublicRegistrationAdminPanel.tsx');
  assert.match(panel, /window.confirm\(enabled/);
  assert.match(panel, /if \(!confirmed\) return/);
  assert.match(panel, /role="switch"/);
  assert.match(panel, /uncertainty.current = result.uncertainty/);
  assert.match(panel, /<\/form> : null\}[\s\S]*<Button icon="sync"/);
  assert.match(panel, /lock.current \|\| busy \|\| denied \|\| !state/);
  assert.doesNotMatch(panel, /Invitation|admin_update_invitation|registrations_enabled/);
  assert.match(read('AdminMaintenancePage.tsx'), /<PublicRegistrationAdminPanel \/>/);
  const landing = read('PublicLanding.tsx');
  assert.match(landing, /registration.enabled \? "Crear mi cuenta" : "Entrar con mi invitación"/);
  assert.match(landing, /¿Sin invitación\? La mejor recomendación es la de alguien que ya la usa: pídésela\./);
  assert.doesNotMatch(landing, /El registro libre está disponible|No necesitas una invitación/);
  assert.equal((landing.match(/href="\/ingresar"/g) || []).length, 2);
  const auth = read('AuthGate.tsx');
  assert.match(auth, /<PublicRegistrationMessage \/>/);
  assert.doesNotMatch(auth, /registration.enabled|setPublicRegistration|loadPublicRegistration/);
});
