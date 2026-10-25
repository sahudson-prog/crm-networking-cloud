import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { legalDocuments } from "../content/legalDocuments.ts";
import {
  clearLegalAcceptanceIntent,
  hasCurrentLegalAcceptanceIntent,
  rememberLegalAcceptanceIntent,
  resolveLegalAcceptanceForSession,
  type LegalAcceptanceRpcClient,
  type LegalAcceptanceStorage
} from "../lib/legalAcceptance.ts";
import {
  CURRENT_LEGAL_CONTRACT,
  LEGAL_CONTRACT_V1,
  LEGAL_PRIVACY_SHA256,
  LEGAL_TERMS_SHA256
} from "../lib/legalContract.ts";

test("los hashes V1.1 corresponden exactamente al contenido canónico vigente", () => {
  assert.equal(sha256(legalDocuments.terms.content.trim()), LEGAL_TERMS_SHA256);
  assert.equal(sha256(legalDocuments.privacy.content.trim()), LEGAL_PRIVACY_SHA256);
});

test("V1.0 no satisface el contrato frontend vigente V1.1", async () => {
  const client = fakeRpcClient([{
    accepted: true,
    accepted_at: "2026-10-15T12:00:00.000Z",
    privacy_sha256: LEGAL_CONTRACT_V1.privacySha256,
    privacy_version: LEGAL_CONTRACT_V1.privacyVersion,
    terms_sha256: LEGAL_CONTRACT_V1.termsSha256,
    terms_version: LEGAL_CONTRACT_V1.termsVersion
  }]);

  const result = await resolveLegalAcceptanceForSession(client, fakeStorage());
  assert.equal(result.status, "error");
});

test("la intención pre-login conserva solo el contrato vigente", () => {
  const storage = fakeStorage();
  rememberLegalAcceptanceIntent(storage, true);
  assert.equal(hasCurrentLegalAcceptanceIntent(storage), true);

  storage.setItem("coffeecito_legal_acceptance_intent_v1", JSON.stringify({
    ...CURRENT_LEGAL_CONTRACT,
    termsVersion: "0.9"
  }));
  assert.equal(hasCurrentLegalAcceptanceIntent(storage), false);
  assert.equal(storage.size, 0);

  rememberLegalAcceptanceIntent(storage, true);
  clearLegalAcceptanceIntent(storage);
  assert.equal(storage.size, 0);
});

test("una sesión existente sin aceptación ni intención queda en gate", async () => {
  const client = fakeRpcClient([currentRow(false)]);
  const result = await resolveLegalAcceptanceForSession(client, fakeStorage());

  assert.deepEqual(result, { status: "required" });
  assert.deepEqual(client.calls, ["current_user_legal_acceptance_status_v1"]);
});

test("la intención pre-login se materializa después de consultar la sesión autenticada", async () => {
  const storage = fakeStorage();
  rememberLegalAcceptanceIntent(storage, true);
  const client = fakeRpcClient([currentRow(false), currentRow(true)]);

  const result = await resolveLegalAcceptanceForSession(client, storage);

  assert.deepEqual(result, { status: "accepted", acceptedAt: "2026-10-15T12:00:00.000Z" });
  assert.deepEqual(client.calls, [
    "current_user_legal_acceptance_status_v1",
    "record_current_user_legal_acceptance_v1"
  ]);
  assert.equal(storage.size, 0);
});

test("una aceptación vigente omite el gate y limpia intención residual", async () => {
  const storage = fakeStorage();
  rememberLegalAcceptanceIntent(storage, true);
  const client = fakeRpcClient([currentRow(true)]);

  const result = await resolveLegalAcceptanceForSession(client, storage);

  assert.equal(result.status, "accepted");
  assert.deepEqual(client.calls, ["current_user_legal_acceptance_status_v1"]);
  assert.equal(storage.size, 0);
});

test("AuthGate exige checkbox antes de Google/email y aplica legal después del acceso beta", () => {
  const authGate = source("../components/AuthGate.tsx");
  const accessCheck = authGate.indexOf("resolveBootstrappedAppAccessForSession(currentSession, supabase)");
  const legalCheck = authGate.indexOf("resolveLegalAcceptanceForSession(supabase, window.sessionStorage)");
  const privateRender = authGate.lastIndexOf("cloneElement(children");

  assert.ok(accessCheck >= 0 && legalCheck > accessCheck && privateRender > legalCheck);
  assert.match(authGate, /if \(!legalIntentChecked\)[\s\S]*signInWithOtp/);
  assert.match(authGate, /disabled=\{signingInWithGoogle \|\| !legalIntentChecked\}/);
  assert.match(authGate, /\{legalIntentChecked \? \([\s\S]*<details className="auth-email-fallback">/);
  assert.match(authGate, /<button aria-disabled="true" className="auth-email-fallback-disabled" disabled type="button">/);
  assert.match(authGate, /disabled=\{!canSubmitPasswordlessEmail\(/);
  assert.match(authGate, /legalAcceptance\.status !== "accepted"[\s\S]*<LegalAcceptanceGate/);
  assert.match(authGate, /onSignOut=\{\(\) => void signOut\(\)\}/);
});

test("los links legales del checkbox son públicos y preservan el login en otra pestaña", () => {
  const checkbox = source("../components/LegalAcceptanceCheckbox.tsx");
  assert.match(checkbox, /href="\/terminos" rel="noreferrer" target="_blank"/);
  assert.match(checkbox, /href="\/privacidad" rel="noreferrer" target="_blank"/);
  assert.match(checkbox, /Acepto los\{" "\}/);
});

test("páginas legales y gate reutilizan el fondo onboarding con scroll interno", () => {
  const legalPage = source("../components/LegalDocumentPage.tsx");
  const gate = source("../components/LegalAcceptanceGate.tsx");
  const css = source("../styles/components.css");

  assert.match(legalPage, /className="onboarding-intro-background"/);
  assert.match(gate, /className="onboarding-intro-background"/);
  assert.doesNotMatch(legalPage, /public-legal-header|public-legal-navigation/);
  assert.match(legalPage, /<footer className="public-legal-footer">[\s\S]*<PublicSiteLinks \/>/);
  assert.match(css, /\.public-legal-panel[\s\S]*grid-template-rows: minmax\(0, 1fr\) auto/);
  assert.match(css, /\.public-legal-document[\s\S]*overflow-y: auto/);
  assert.match(css, /\.public-legal-page,[\s\S]*\.legal-acceptance-shell[\s\S]*overflow: hidden/);
});

function currentRow(accepted: boolean) {
  return {
    accepted,
    accepted_at: accepted ? "2026-10-15T12:00:00.000Z" : null,
    privacy_sha256: CURRENT_LEGAL_CONTRACT.privacySha256,
    privacy_version: CURRENT_LEGAL_CONTRACT.privacyVersion,
    terms_sha256: CURRENT_LEGAL_CONTRACT.termsSha256,
    terms_version: CURRENT_LEGAL_CONTRACT.termsVersion
  };
}

function fakeRpcClient(responses: unknown[]): LegalAcceptanceRpcClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async rpc(functionName) {
      calls.push(functionName);
      return { data: responses.shift(), error: null };
    }
  };
}

function fakeStorage(): LegalAcceptanceStorage & { size: number } {
  const values = new Map<string, string>();
  return {
    get size() {
      return values.size;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
