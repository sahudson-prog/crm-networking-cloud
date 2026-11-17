const test = require('node:test');
const assert = require('node:assert/strict');
const {createPreviewStore} = require('./local/onboarding-preview-storage.cjs');
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
test('normal preview never reads old error fixtures or changes their data', () => {
  const storage = memory();
  const previous = JSON.stringify([{id:'synthetic-error',display_name:'Contacto de fallo'}]);
  storage.setItem('onboarding-fixture-contacts', previous);
  assert.deepEqual(createPreviewStore(storage, '').read('contacts', []), []);
  assert.equal(storage.getItem('onboarding-fixture-contacts'), previous);
});
test('negative save scenario isolates contacts, profile, cycle, priorities and progress', () => {
  const storage = memory();
  const normal = createPreviewStore(storage, '');
  const failure = createPreviewStore(storage, '?fail-save');
  for (const key of ['contacts', 'profile', 'cycles', 'priorities', 'progress']) {
    failure.write(key, ['negative-test']);
    assert.deepEqual(normal.read(key, []), []);
    normal.write(key, ['normal-test']);
    assert.deepEqual(failure.read(key, []), ['negative-test']);
    assert.deepEqual(createPreviewStore(storage, '').read(key, []), ['normal-test']);
  }
});
