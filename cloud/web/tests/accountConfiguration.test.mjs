import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

export function load(file, deps, suffix = '') {
  const module = { exports: {} };
  const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source + suffix, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX
  }}).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Date, Error,
    require(name) { if (name === 'react/jsx-runtime') return jsx; if (name in deps) return deps[name]; throw Error(name); }
  });
  return module.exports;
}

export function accountHarness({ ics = false } = {}) {
  const source = readFileSync(new URL('../components/AccountPage.tsx', import.meta.url), 'utf8');
  const deps = Object.fromEntries([...source.matchAll(/from "([^"]+)"/g)].map(m => [m[1], {}]));
  Object.assign(deps, {
    react: React,
    'next/link': { default: ({children, ...props}) => React.createElement('a', props, children) },
    '../lib/supabaseClient': { supabase: null },
    '../lib/icsImportFeature': { isIcsImportEnabled: () => ics },
    '../lib/onboarding': { isOnboardingTestResetAvailable: () => false },
    './OnboardingProvider': { useOnboarding: () => ({}) },
    './HistoryImportNotice': { useHistoryImportAvailability: () => ({status: 'ready'}), HistoryImportAvailabilityFeedback: () => null },
    './InteractionSyncPreferencesProvider': {useInteractionSyncPreferences: () => ({loading: false, preferences: {}})},
    './StartingPointFields': {StartingPointFields: () => React.createElement('input', {'aria-label': 'Nombre'})},
    './ContactDuplicateReviewPanel': {ContactDuplicateReviewPanel: ({embedded}) => React.createElement('div', {'data-embedded': embedded})},
    './ui/Icon': {Icon: () => null}, './ui/ProviderIcon': {ProviderIcon: () => null},
    './ui/Button': {Button: ({children, icon, tone, square, ...props}) => React.createElement('button', props, children)},
    './ContactImportDialog': {ContactImportButton: ({google}) => React.createElement('button', {'data-google': google.enabled}, 'Importar contactos')},
    './IcsImportPanel': {IcsImportPanel: () => React.createElement('button', null, 'Importar ICS')},
    './GoogleInteractionsSyncPanel': {GoogleInteractionsSyncPanel: () => React.createElement('button', null, 'Seleccionar correos')}
  });
  return load('components/AccountPage.tsx', deps, '\nexport {GoogleImportSection, createInitialAccountState};');
}

test('normal/admin/loading visibility is fail closed; import gates remain independent', () => {
  const h = accountHarness({ics: true});
  for (const adminVisible of [undefined, false, true]) {
    const account = {...h.createInitialAccountState(false), googleSyncEligibilityKnown: true,
      googleSyncEligibility: {contacts: true, email: true, calendar: true}};
    const html = renderToStaticMarkup(React.createElement(h.GoogleImportSection, {
      account, adminVisible, includeOtherSources: true, redirectPath: '/cuenta', setAccount() {}
    }));
    assert.match(html, /Importar contactos/); assert.match(html, /Importar ICS/);
    assert.equal(html.includes('Seleccionar correos'), adminVisible === true);
    assert.equal(html.includes('Citas de Google Calendar'), adminVisible === true);
    assert.doesNotMatch(html, /Incluir al actualizar|Fuentes desde|account-import-data-title/);
    assert.equal((html.match(/>Importar datos</g) ?? []).length, 1);
  }
});

test('onboarding keeps its existing presentation and no sync controls', () => {
  const h = accountHarness();
  const html = renderToStaticMarkup(React.createElement(h.GoogleImportSection, {
    account: h.createInitialAccountState(true), includeOtherSources: false,
    redirectPath: '/onboarding/google', setAccount() {}
  }));
  assert.match(html, /Importación y sincronización/); assert.match(html, /Correos/);
  assert.match(html, /iCalendar/); assert.doesNotMatch(html, /account-import-grid|Citas de Google Calendar/);
});

test('account removes placeholders and duplicate frame, keeps reset and contact request', () => {
  const h = accountHarness();
  const html = renderToStaticMarkup(React.createElement(h.AccountPage));
  assert.doesNotMatch(html, /Cambiar plan|Borrar cuenta|Cerrar sesión|Calidad de datos/);
  assert.match(html, /href="\/contacto"/); assert.match(html, /no elimina tu cuenta automáticamente/);
  assert.match(html, /Reiniciar datos/); assert.match(html, /data-embedded="true"/);
});

test('admin reader accepts only active, currently valid system admin role; errors do not grant', async () => {
  let result; const filters = [];
  const query = {select() {return this;}, eq(key, value) {filters.push([key,value]);return this;},
    then(resolve) { return Promise.resolve(result).then(resolve); }};
  const h = load('lib/accountAdminVisibility.ts', {'./supabaseClient': {supabase: {from(name) {
    assert.equal(name, 'user_role_assignments'); return query;
  }}}});
  const valid = {is_active: true, starts_at: '2020-01-01', expires_at: null, app_roles: {is_active: true}};
  for (const [row, expected] of [[valid,true], [{...valid,is_active:false},false],
    [{...valid,starts_at:'2999-01-01'},false], [{...valid,expires_at:'2020-01-02'},false],
    [{...valid,app_roles:{is_active:false}},false]]) {
    result = {data:[row],error:null}; assert.equal(await h.readAccountAdminVisibility('synthetic-owner'),expected);
  }
  result = {data:[],error:null}; assert.equal(await h.readAccountAdminVisibility('synthetic-owner'),false);
  result = {data:null,error:Error('read failed')}; await assert.rejects(h.readAccountAdminVisibility('synthetic-owner'));
  assert.ok(filters.some(([key,value]) => key === 'role_code' && value === 'system_admin'));
  assert.ok(filters.some(([key,value]) => key === 'user_id' && value === 'synthetic-owner'));
});
