import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';

function load(file, dependencies) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../components/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react') return React;
    if (name in dependencies) return dependencies[name];
    throw Error(`Unexpected dependency ${name}`);
  } });
  return module.exports;
}

const child = React.createElement('span', null, 'private-content');
const render = Component => renderToStaticMarkup(React.createElement(Component, null, child));

test('ApplicationFrame fails closed while pathname is unavailable', () => {
  let gateCalls = 0;
  let pathname = null;
  const { ApplicationFrame } = load('ApplicationFrame.tsx', {
    'next/navigation': { usePathname: () => pathname },
    './AuthGate': { AuthGate: ({ children }) => { gateCalls += 1; return children; } },
    './Shell': { Shell: ({ children }) => children },
    './PublicLanding': { PublicLanding: () => 'landing' }
  });

  const waiting = render(ApplicationFrame);
  assert.match(waiting, /role="status"/);
  assert.doesNotMatch(waiting, /private-content/);
  assert.equal(gateCalls, 0);

  pathname = '/';
  assert.match(render(ApplicationFrame), /private-content/);
  assert.equal(gateCalls, 1);
});

test('Shell does not render private children before pathname resolves', () => {
  let pathname = null;
  const provider = ({ children }) => children;
  const { Shell } = load('Shell.tsx', {
    'next/navigation': { usePathname: () => pathname },
    './ApplicationShellContent': { ApplicationShellContent: ({ children }) => React.createElement('main', null, children) },
    './InteractionSyncPreferencesProvider': { InteractionSyncPreferencesProvider: provider },
    './OnboardingProvider': { OnboardingProvider: provider },
    './SystemAccess': { SystemAccessProvider: provider }
  });

  const waiting = render(Shell);
  assert.match(waiting, /role="status"/);
  assert.doesNotMatch(waiting, /private-content/);

  pathname = '/onboarding/objetivos';
  assert.match(render(Shell), /private-content/);
  assert.doesNotMatch(render(Shell), /<main>/);

  pathname = '/';
  assert.match(render(Shell), /<main><span>private-content<\/span><\/main>/);
});
