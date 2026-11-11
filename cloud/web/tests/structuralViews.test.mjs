import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

function load(file, dependencies) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URLSearchParams, require(name) {
    if (name === 'react/jsx-runtime') return jsx;
    if (name in dependencies) return dependencies[name];
    throw Error(`Unexpected dependency ${name}`);
  } });
  return module.exports;
}
const marker = name => props => React.createElement('div', { 'data-block': `${name}:${props.view ?? ''}` });
function views(contactId = '') {
  return load('components/StructuralViews.tsx', {
    'next/navigation': { useSearchParams: () => new URLSearchParams(contactId ? { contactId } : {}) },
    './ReadOnlyContacts': { ReadOnlyContacts: marker('contacts') },
    './ReadOnlyDashboard': { ReadOnlyDashboard: marker('tracking') },
    './OpportunityWorkspace': { OpportunityWorkspace: marker('opportunities') }
  });
}
const blocks = component => [...renderToStaticMarkup(React.createElement(component)).matchAll(/data-block="([^"]+)"/g)].map(m => m[1]);

test('approved V0.5 compositions mount each block in its destination once', () => {
  const v = views();
  assert.deepEqual(blocks(v.HomeView), ['tracking:home']);
  assert.deepEqual(blocks(v.RegisterProgressView), ['contacts:states', 'opportunities:', 'tracking:interactions']);
  assert.deepEqual(blocks(v.PlanningView), ['tracking:planning']);
  assert.deepEqual(blocks(v.ContactsView), ['contacts:contacts', 'tracking:referrals']);
});

test('legacy root contactId and contactos contactId still select the original profile reader only', () => {
  const v = views('synthetic-contact');
  assert.deepEqual(blocks(v.HomeView), ['contacts:contacts']);
  assert.deepEqual(blocks(v.ContactsView), ['contacts:contacts']);
});

test('five routes and dashboard compatibility alias retain the private AuthGate and Shell', () => {
  for (const route of ['', 'contactos/', 'objetivos/', 'registrar-avances/', 'planificar/', 'dashboard/']) {
    const prefix = route ? '../../components/' : '../components/';
    let allowed = false;
    const dependencies = {
      [prefix+'AuthGate']: { AuthGate: ({children}) => allowed ? React.createElement('div', { 'data-auth': 'allowed' }, children) : 'access-gate' },
      [prefix+'Shell']: { Shell: ({children}) => React.createElement('main', { 'data-shell': 'original' }, children) },
      [prefix+'StructuralViews']: Object.fromEntries(['HomeView','ContactsView','RegisterProgressView','PlanningView'].map(n => [n, marker(n)])),
      [prefix+'ObjectivesPage']: { ObjectivesPage: ({showOpportunities}) => {
        assert.equal(showOpportunities, false);
        return React.createElement('div', { 'data-block': 'objectives-and-priorities' });
      } }
    };
    const Page = load(`app/${route}page.tsx`, dependencies).default;
    assert.equal(renderToStaticMarkup(React.createElement(Page)), 'access-gate', route);
    allowed = true;
    const html = renderToStaticMarkup(React.createElement(Page));
    assert.ok(html.includes('data-auth="allowed"') && html.includes('data-shell="original"') && html.includes('data-block='), route);
  }
});

test('temporary navigation has five destinations, preserves filter context and highlights legacy/onboarding paths', () => {
  for (const [pathname, active] of [['/', 'Inicio'], ['/dashboard', 'Inicio'], ['/onboarding/objetivos', 'Objetivos y prioridades'], ['/onboarding/contacto', 'Contactos']]) {
    const { WorkspaceNavigation } = load('components/WorkspaceNavigation.tsx', {
      'next/link': { default: ({children, ...props}) => React.createElement('a', props, children) },
      'next/navigation': { usePathname: () => pathname },
      './useTrackingViewFilters': { TRACKING_QUERY_KEY: 'ux-tracking', useTrackingViewFilters: () => ({ query: '{"domains":["@synthetic.invalid"]}' }) }
    });
    const html = renderToStaticMarkup(React.createElement(WorkspaceNavigation));
    assert.equal([...html.matchAll(/<a /g)].length, 5);
    assert.ok(html.includes(`aria-current="page">${active}</a>`));
    assert.equal([...html.matchAll(/ux-tracking=/g)].length, 5);
  }
});
