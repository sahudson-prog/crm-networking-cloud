import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rootRoute = source("../app/page.tsx");
const contactsRoute = source("../app/contactos/page.tsx");
const dashboardRoute = source("../app/dashboard/page.tsx");
const shell = source("../components/Shell.tsx");
const authGate = source("../components/AuthGate.tsx");

test("la home conserva AuthGate y usa la experiencia real de Contactos", () => {
  assert.match(rootRoute, /<AuthGate>[\s\S]*<Shell>[\s\S]*<ReadOnlyContacts \/>/);
  assert.doesNotMatch(rootRoute, /ReadOnlyDashboard/);
  assert.match(authGate, /if \(!session\)[\s\S]*<main className="auth-landing">/);
});

test("Contactos conserva su ruta explícita", () => {
  assert.match(contactsRoute, /<AuthGate>[\s\S]*<Shell>[\s\S]*<ReadOnlyContacts \/>/);
});

test("Dashboard queda protegido en una ruta directa no navegable", () => {
  assert.match(dashboardRoute, /<AuthGate>[\s\S]*<Shell>[\s\S]*<ReadOnlyDashboard \/>/);
  assert.doesNotMatch(shell, /href="\/dashboard"|>\s*Dashboard\s*</);
});

test("la home activa Contactos y el lockup conserva su destino explícito", () => {
  assert.match(shell, /const isContacts = pathname === "\/"[\s\S]*\|\| pathname === "\/contactos"/);
  assert.match(shell, /className="shell-brand-lockup" href="\/contactos"/);
  assert.match(shell, /href="\/contactos"[\s\S]*Contactos/);
});

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
