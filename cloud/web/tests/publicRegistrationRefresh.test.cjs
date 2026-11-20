const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function mount() {
  const window = new EventTarget(), document = new EventTarget();
  document.visibilityState = 'visible';
  const pending = [], states = [];
  let effect;
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../components/PublicRegistrationStatus.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, window, document, require: name => {
    if (name === 'react') return { useState: () => [null, value => states.push(value)], useEffect: fn => { effect = fn; } };
    if (name === 'react/jsx-runtime') return {};
    if (name.endsWith('/publicRegistration')) return { loadPublicRegistrationStatus: () => new Promise(resolve => pending.push(resolve)) };
    if (name.endsWith('/supabaseClient')) return { supabase: {} };
    throw Error(name);
  } });
  exports.usePublicRegistrationStatus();
  const unmount = effect();
  return { window, document, pending, states, unmount };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const ready = enabled => ({ status: 'ready', enabled });

test('public state refreshes OFF/ON on focus and fails closed on failed reread', async () => {
  const h = mount();
  h.pending.shift()(ready(false)); await settle();
  h.window.dispatchEvent(new Event('focus'));
  h.pending.shift()(ready(true)); await settle();
  h.document.dispatchEvent(new Event('visibilitychange'));
  h.pending.shift()({ status: 'unavailable', enabled: false }); await settle();
  assert.deepEqual(h.states.map(x => x.enabled), [false, true, false]);
  h.unmount();
});

test('overlapping focus events coalesce and do not publish an older in-flight response', async () => {
  const h = mount();
  h.window.dispatchEvent(new Event('focus'));
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.pending.length, 1);
  h.pending.shift()(ready(false)); await settle();
  assert.equal(h.states.length, 0);
  assert.equal(h.pending.length, 1);
  h.pending.shift()(ready(true)); await settle();
  assert.equal(h.states[0].enabled, true);
  h.unmount();
});

test('hidden tabs do not reread; unmount ignores responses and removes listeners', async () => {
  const h = mount();
  h.pending.shift()(ready(false)); await settle();
  h.document.visibilityState = 'hidden';
  h.window.dispatchEvent(new Event('focus'));
  assert.equal(h.pending.length, 0);
  h.document.visibilityState = 'visible';
  h.document.dispatchEvent(new Event('visibilitychange'));
  h.unmount();
  h.pending.shift()(ready(true)); await settle();
  h.window.dispatchEvent(new Event('focus'));
  assert.equal(h.pending.length, 0);
  assert.equal(h.states.length, 1);
});
