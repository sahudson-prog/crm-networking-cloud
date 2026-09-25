import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authGateSource = readFileSync(new URL("../components/AuthGate.tsx", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");
const tokensSource = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

test("landing no autenticada usa copy y asset oficiales de Coffeecito", () => {
  assert.match(authGateSource, /Tu red puede abrir tu próxima oportunidad\./);
  assert.match(
    authGateSource,
    /Coffeecito te ayuda a organizar tus contactos, dar seguimiento a tus relaciones y avanzar hacia tus[\s\S]*objetivos profesionales\./
  );
  assert.match(authGateSource, /src="\/brand\/coffeecito-isotipo\.svg"/);
  assert.match(authGateSource, /className="auth-brand-wordmark">Coffeecito</);
});

test("landing conserva una sola implementacion de los flujos Google y email", () => {
  assert.equal(authGateSource.match(/signInWithGoogleForAuth\(/g)?.length, 1);
  assert.equal(authGateSource.match(/signInWithOtp\(/g)?.length, 1);
  assert.match(authGateSource, /onClick=\{signInWithGoogle\}/);
  assert.match(authGateSource, /<details className="auth-email-fallback">/);
  assert.match(authGateSource, /<form onSubmit=\{signIn\}/);
  assert.match(authGateSource, /<TurnstileWidget/);
});

test("landing deja una capa de fondo reemplazable y no usa panel anidado", () => {
  assert.match(authGateSource, /<main className="auth-landing">/);
  assert.match(authGateSource, /<div aria-hidden="true" className="auth-landing-background" \/>/);
  assert.equal(/panel auth-entry-panel/.test(authGateSource), false);
  assert.match(stylesSource, /\.auth-landing-background\s*\{[\s\S]*background: var\(--brand-cream\)/);
});

test("wordmark carga solo Lato 900 y respeta la proporcion horizontal aprobada", () => {
  assert.match(layoutSource, /import \{ Lato \} from "next\/font\/google"/);
  assert.match(layoutSource, /variable: "--font-coffeecito-wordmark"/);
  assert.match(layoutSource, /weight: "900"/);
  assert.match(stylesSource, /\.auth-brand-lockup img\s*\{[\s\S]*width: 102px/);
  assert.match(stylesSource, /\.auth-brand-wordmark\s*\{[\s\S]*font-size: 44px/);
  assert.match(stylesSource, /letter-spacing: -0\.015em/);
});

test("landing usa tokens de marca sin reemplazar tokens semanticos", () => {
  for (const token of [
    "--brand-espresso: #3b261b",
    "--brand-coffee: #8b5a3c",
    "--brand-terracotta: #c7774c",
    "--brand-apricot: #e3b18c",
    "--brand-cream: #faf4ec",
    "--brand-warm-white: #fffdfb"
  ]) {
    assert.equal(tokensSource.includes(token), true);
  }
  assert.match(tokensSource, /--crm-bg: #f6f7fb/);
  assert.match(tokensSource, /--crm-primary: #111827/);
});
