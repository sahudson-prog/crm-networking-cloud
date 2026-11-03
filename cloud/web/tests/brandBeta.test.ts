import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";

const require = createRequire(import.meta.url);
const lockupPaths = [
  "AuthGate.tsx",
  "LegalAcceptanceGate.tsx",
  "OnboardingRoutePage.tsx",
  "PublicContactPage.tsx",
  "Shell.tsx"
];

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function renderVariant(enabled: boolean, className = "") {
  const componentSource = source("../components/ui/BrandBetaWordmark.tsx").replace(
    "BRAND_BETA_ENABLED: boolean = true",
    `BRAND_BETA_ENABLED: boolean = ${enabled}`
  );
  const compiled = ts.transpileModule(componentSource, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)(require, module, module.exports);
  const exports = module.exports as {
    BRAND_ACCESSIBLE_NAME: string;
    BrandBetaWordmark: (props: { className?: string }) => ReturnType<typeof createElement>;
  };
  return {
    accessibleName: exports.BRAND_ACCESSIBLE_NAME,
    markup: renderToStaticMarkup(createElement(exports.BrandBetaWordmark, { className }))
  };
}

test("one toggle renders the beta badge or the exact original wordmark", () => {
  const beta = renderVariant(true);
  const original = renderVariant(false);
  assert.equal(beta.accessibleName, "Coffeecito Beta");
  assert.match(beta.markup, /class="brand-beta-wordmark"/);
  assert.match(beta.markup, /class="brand-beta-mark">BETA<\/span>/);
  assert.equal(original.accessibleName, "Coffeecito");
  assert.equal(original.markup, "<span>Coffeecito</span>");
  assert.equal(renderVariant(false, "auth-brand-wordmark").markup, '<span class="auth-brand-wordmark">Coffeecito</span>');
});

test("all five live logo lockups share the badge and accessible name", () => {
  const components = new URL("../components/", import.meta.url);
  const paths = readdirSync(components, { recursive: true })
    .filter((path): path is string => typeof path === "string" && path.endsWith(".tsx"))
    .filter((path) => readFileSync(new URL(path.replaceAll("\\", "/"), components), "utf8").includes("/brand/coffeecito-isotipo.svg"))
    .sort();
  assert.deepEqual(paths, [...lockupPaths].sort());

  for (const path of lockupPaths) {
    const page = source(`../components/${path}`);
    assert.match(page, /aria-label=\{BRAND_ACCESSIBLE_NAME\}/);
    assert.match(page, /<BrandBetaWordmark(?: className="auth-brand-wordmark")? \/>/);
    assert.match(page, /src="\/brand\/coffeecito-isotipo\.svg"/);
  }
});

test("badge is absolute; original and beta wordmarks share responsive dimensions", () => {
  const css = source("../styles/components.css");
  const invitations = source("../styles/invitations.css");
  assert.match(css, /\.brand-beta-wordmark\s*\{[\s\S]*position: relative;[\s\S]*white-space: nowrap;/);
  assert.match(css, /\.brand-beta-wordmark \.brand-beta-mark\s*\{[\s\S]*position: absolute;[\s\S]*right: 0;[\s\S]*bottom: -8px;/);
  assert.match(css, /\.shell-brand-lockup > span/);
  assert.match(css, /\.onboarding-brand-lockup > span/);
  assert.match(css, /\.public-contact-brand > span/);
  assert.match(invitations, /\.topbar \.shell-brand-lockup > span/);
});

test("favicon keeps the master artwork with a square proportional viewport and no beta badge", () => {
  const master = source("../public/brand/coffeecito-isotipo.svg").trim();
  const icon = source("../app/icon.svg").trim();
  assert.match(icon, /^<svg width="64" height="64" viewBox="34 -72 1554 1554" preserveAspectRatio="xMidYMid meet"/);
  assert.equal(icon.slice(icon.indexOf(">") + 1), master.slice(master.indexOf(">") + 1));
  assert.doesNotMatch(icon, /BETA/);
});
