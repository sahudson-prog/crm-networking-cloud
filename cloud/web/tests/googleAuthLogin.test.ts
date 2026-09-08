import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildGoogleAuthLoginRequest,
  buildGoogleDataConnectionRedirectTo,
  canFinalizeGoogleDataConnection,
  canUseGoogleDataToken,
  GOOGLE_AUTH_LOGIN_SCOPES,
  readGoogleDataConnectionReturn,
  selectCurrentGoogleConnectedAccount
} from "../lib/googleAuthLoginConfig.ts";

const DATA_SCOPES = [
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly"
];

test("login Google usa provider google con scopes minimos de identidad", () => {
  const request = buildGoogleAuthLoginRequest("http://localhost:3000");

  assert.equal(request.provider, "google");
  assert.equal(request.options.redirectTo, "http://localhost:3000");
  assert.equal(request.options.scopes, "openid email profile");
  assert.deepEqual([...GOOGLE_AUTH_LOGIN_SCOPES], ["openid", "email", "profile"]);
});

test("login Google no incluye scopes de Contacts, Gmail, Calendar ni Drive", () => {
  const scopes = buildGoogleAuthLoginRequest("http://localhost:3000").options.scopes;

  for (const dataScope of DATA_SCOPES) {
    assert.equal(scopes.includes(dataScope), false);
  }
  assert.equal(scopes.includes("contacts"), false);
  assert.equal(scopes.includes("gmail"), false);
  assert.equal(scopes.includes("calendar"), false);
  assert.equal(scopes.includes("drive"), false);
});

test("AuthGate mantiene magic link y no reconstruye allowlist en frontend", () => {
  const source = readFileSync(new URL("../components/AuthGate.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("signInWithOtp"), true);
  assert.equal(source.includes("Entrar con email"), true);
  assert.equal(source.includes("app_access_allowlist"), false);
});

test("login Google normal limpia intent de datos pendiente antes de iniciar", () => {
  const source = readFileSync(new URL("../lib/googleAuthSession.ts", import.meta.url), "utf8");

  assert.match(source, /signInWithGoogleForAuth[\s\S]*clearRememberedGoogleRequestedScopes\(\)/);
});

test("provider token de login sin OAuth de datos completado no activa permiso", () => {
  assert.equal(
    canUseGoogleDataToken({
      accountEmail: "user@example.invalid",
      activeDataTokenFingerprint: "",
      currentProviderTokenFingerprint: "login-token-fingerprint",
      sessionEmail: "user@example.invalid"
    }),
    false
  );
});

test("Connected Account historica mas token nuevo de login mantiene connected pero no permissionActive", () => {
  assert.equal(
    canUseGoogleDataToken({
      accountEmail: "user@example.invalid",
      activeDataTokenFingerprint: "data-token-fingerprint",
      currentProviderTokenFingerprint: "login-token-fingerprint",
      sessionEmail: "user@example.invalid"
    }),
    false
  );
});

test("scopes e intent pendientes con token previo no finalizan conexion", () => {
  assert.equal(
    canFinalizeGoogleDataConnection({
      currentProviderTokenFingerprint: "old-token-fingerprint",
      previousProviderTokenFingerprint: "old-token-fingerprint",
      rememberedScopes: ["https://www.googleapis.com/auth/contacts.readonly"],
      returnNonce: "nonce-1",
      returnStatus: "completed",
      storedNonce: "nonce-1"
    }),
    false
  );
});

test("retorno valido de OAuth de datos actual finaliza conexion", () => {
  const redirectTo = buildGoogleDataConnectionRedirectTo("http://localhost:3000/cuenta", "nonce-2");
  const oauthReturn = readGoogleDataConnectionReturn(redirectTo);

  assert.deepEqual(oauthReturn, { status: "completed", nonce: "nonce-2" });
  assert.equal(
    canFinalizeGoogleDataConnection({
      currentProviderTokenFingerprint: "new-data-token-fingerprint",
      previousProviderTokenFingerprint: "old-token-fingerprint",
      rememberedScopes: ["https://www.googleapis.com/auth/contacts.readonly"],
      returnNonce: oauthReturn.nonce,
      returnStatus: oauthReturn.status,
      storedNonce: "nonce-2"
    }),
    true
  );
});

test("finalize con token previo no consume el intent antes de que llegue la sesion nueva", () => {
  const source = readFileSync(new URL("../lib/googleAuthSession.ts", import.meta.url), "utf8");
  const canFinalizeIndex = source.indexOf("const canFinalize = canFinalizeGoogleDataConnection({");
  const noFinalizeIndex = source.indexOf("if (!canFinalize || !providerToken || !supabaseAccessToken) return null;");
  const clearIndex = source.indexOf("clearPendingGoogleDataConnection();", noFinalizeIndex);

  assert.ok(canFinalizeIndex > -1);
  assert.ok(noFinalizeIndex > canFinalizeIndex);
  assert.ok(clearIndex > noFinalizeIndex);
});

test("retorno cancelado o invalido no deja completar conexion", () => {
  const oauthReturn = readGoogleDataConnectionReturn(
    "http://localhost:3000/cuenta?google_oauth_intent=data_connection&google_oauth_nonce=nonce-3&error=access_denied"
  );

  assert.deepEqual(oauthReturn, { status: "invalid", nonce: "nonce-3" });
  assert.equal(
    canFinalizeGoogleDataConnection({
      currentProviderTokenFingerprint: "new-data-token-fingerprint",
      previousProviderTokenFingerprint: "old-token-fingerprint",
      rememberedScopes: ["https://www.googleapis.com/auth/contacts.readonly"],
      returnNonce: oauthReturn.nonce,
      returnStatus: oauthReturn.status,
      storedNonce: "nonce-3"
    }),
    false
  );
});

test("Connected Account de email distinto no permite usar token de datos", () => {
  assert.equal(
    canUseGoogleDataToken({
      accountEmail: "other@example.invalid",
      activeDataTokenFingerprint: "data-token-fingerprint",
      currentProviderTokenFingerprint: "data-token-fingerprint",
      sessionEmail: "user@example.invalid"
    }),
    false
  );
});

test("Connected Account actual solo existe si el email coincide con la sesion", () => {
  const accounts = [
    {
      accountEmail: "other@example.invalid",
      id: "other",
      provider: "google",
      status: "active"
    },
    {
      accountEmail: "revoked-user@example.invalid",
      id: "revoked",
      provider: "google",
      status: "revoked"
    }
  ];

  assert.equal(selectCurrentGoogleConnectedAccount(accounts, "user@example.invalid"), null);
});

test("Connected Account actual selecciona solo cuenta activa Google con email normalizado coincidente", () => {
  const accounts = [
    {
      accountEmail: "other@example.invalid",
      id: "other",
      provider: "google",
      status: "active"
    },
    {
      accountEmail: " User@Example.Invalid ",
      id: "current",
      provider: "google",
      status: "active"
    }
  ];

  assert.equal(selectCurrentGoogleConnectedAccount(accounts, "user@example.invalid")?.id, "current");
});
