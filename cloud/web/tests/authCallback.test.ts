import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AUTH_CALLBACK_RETURN_TO_TTL_MS,
  buildAuthCallbackUrl,
  cleanAuthCallbackUrl,
  cleanLegacyImplicitAuthFragment,
  createSingleAuthCallbackCompletion,
  exchangeAuthCallbackCode,
  normalizeInternalReturnTo,
  prepareAuthCallbackExchange,
  resolveAuthCallbackReturnTo,
  readAuthCallback
} from "../lib/authCallback.ts";

test("callback PKCE usa una ruta explicita por origen", () => {
  assert.equal(
    buildAuthCallbackUrl("https://coffeecito.cl"),
    "https://coffeecito.cl/auth/callback"
  );
  assert.equal(
    buildAuthCallbackUrl("http://localhost:3000"),
    "http://localhost:3000/auth/callback"
  );
});

test("callback acepta solo destinos internos", () => {
  assert.equal(
    normalizeInternalReturnTo("https://coffeecito.cl/cuenta?google_oauth_intent=data_connection", "https://coffeecito.cl"),
    "/cuenta?google_oauth_intent=data_connection"
  );
  assert.equal(normalizeInternalReturnTo("https://example.invalid/phishing", "https://coffeecito.cl"), "/");
});

test("callback delega el codigo al SDK y exige una sesion materializada", async () => {
  const calls: string[] = [];
  const completed = await exchangeAuthCallbackCode("one-time-code", {
    async exchangeCodeForSession(code) {
      calls.push(code);
      return { data: { session: { user: { id: "user-1" } } }, error: null };
    }
  });

  assert.deepEqual(completed, { completed: true, diagnostic: null });
  assert.deepEqual(calls, ["one-time-code"]);

  assert.deepEqual(await exchangeAuthCallbackCode("bad-code", {
    async exchangeCodeForSession() {
      return { data: { session: null }, error: { message: "invalid" } };
    }
  }), {
    completed: false,
    diagnostic: { category: "exchange_rejected" }
  });
});

test("callback detecta error y limpia codigo y fragmento de la URL", () => {
  assert.deepEqual(readAuthCallback("https://coffeecito.cl/auth/callback?code=one-time-code"), {
    code: "one-time-code",
    hasError: false,
    oauthErrorCode: undefined
  });
  assert.equal(
    cleanAuthCallbackUrl("https://coffeecito.cl/auth/callback?code=one-time-code#unexpected"),
    "https://coffeecito.cl/auth/callback"
  );
  assert.equal(
    readAuthCallback("https://coffeecito.cl/auth/callback?error=access_denied").hasError,
    true
  );
});

test("callback sin authorization code falla cerrado, no intercambia y limpia la URL", async () => {
  let exchangeCalls = 0;
  const result = prepareAuthCallbackExchange(
    "https://coffeecito.cl/auth/callback?unexpected=redacted#access_token=redacted",
    {
      async exchangeCodeForSession() {
        exchangeCalls += 1;
        return { data: { session: { user: { id: "unexpected" } } }, error: null };
      }
    }
  );

  assert.deepEqual(await result.completion, {
    completed: false,
    diagnostic: { category: "callback_missing_code" }
  });
  assert.equal(exchangeCalls, 0);
  assert.equal(result.cleanedUrl, "https://coffeecito.cl/auth/callback");
});

test("callback OAuth con error falla cerrado sin intercambiar el code", async () => {
  let exchangeCalls = 0;
  const result = prepareAuthCallbackExchange(
    "https://coffeecito.cl/auth/callback?code=ignored&error=access_denied#provider_token=redacted",
    {
      async exchangeCodeForSession() {
        exchangeCalls += 1;
        return { data: { session: { user: { id: "unexpected" } } }, error: null };
      }
    }
  );

  assert.deepEqual(await result.completion, {
    completed: false,
    diagnostic: { category: "oauth_error", code: "access_denied" }
  });
  assert.equal(exchangeCalls, 0);
  assert.equal(result.cleanedUrl, "https://coffeecito.cl/auth/callback");
});

test("diagnostico distingue verifier PKCE ausente de rechazo del exchange", async () => {
  const missingVerifier = await exchangeAuthCallbackCode("one-time-code", {
    async exchangeCodeForSession() {
      return {
        data: { session: null },
        error: {
          code: "pkce_code_verifier_not_found",
          message: "not exposed",
          name: "AuthPKCECodeVerifierMissingError",
          status: 400
        }
      };
    }
  });
  const rejected = await exchangeAuthCallbackCode("one-time-code", {
    async exchangeCodeForSession() {
      return {
        data: { session: null },
        error: { code: "validation_failed", message: "not exposed", name: "AuthApiError", status: 400 }
      };
    }
  });

  assert.deepEqual(missingVerifier, {
    completed: false,
    diagnostic: {
      category: "pkce_verifier_missing",
      code: "pkce_code_verifier_not_found",
      name: "AuthPKCECodeVerifierMissingError",
      status: 400
    }
  });
  assert.deepEqual(rejected, {
    completed: false,
    diagnostic: {
      category: "exchange_rejected",
      code: "validation_failed",
      name: "AuthApiError",
      status: 400
    }
  });
  assert.equal(JSON.stringify([missingVerifier, rejected]).includes("not exposed"), false);
});

test("destino interno expirado se descarta usando el TTL real", () => {
  const now = 2_000_000_000_000;
  const expired = JSON.stringify({
    createdAt: now - AUTH_CALLBACK_RETURN_TO_TTL_MS - 1,
    path: "/cuenta?google_oauth_intent=data_connection"
  });
  const staleExternal = JSON.stringify({
    createdAt: now,
    path: "https://example.invalid/phishing"
  });

  assert.equal(resolveAuthCallbackReturnTo(expired, "https://coffeecito.cl", now), "/");
  assert.equal(resolveAuthCallbackReturnTo(staleExternal, "https://coffeecito.cl", now), "/");
});

test("doble ejecucion reutiliza una unica completion y canjea el code una vez", async () => {
  let exchangeCalls = 0;
  const completeOnce = createSingleAuthCallbackCompletion(async () => {
    exchangeCalls += 1;
    await Promise.resolve();
    return true;
  });

  const firstCompletion = completeOnce();
  const strictModeCompletion = completeOnce();

  assert.equal(firstCompletion, strictModeCompletion);
  assert.deepEqual(await Promise.all([firstCompletion, strictModeCompletion]), [true, true]);
  assert.equal(exchangeCalls, 1);
});

test("fragmentos implicit legacy se eliminan sin materializar una sesion manual", () => {
  assert.equal(
    cleanLegacyImplicitAuthFragment("https://coffeecito.cl/#access_token=redacted&refresh_token=redacted"),
    "https://coffeecito.cl/"
  );
  assert.equal(cleanLegacyImplicitAuthFragment("https://coffeecito.cl/#section"), null);
});

test("cliente usa PKCE explicito y callback reutiliza un unico intercambio", () => {
  const clientSource = readFileSync(new URL("../lib/supabaseClient.ts", import.meta.url), "utf8");
  const callbackSource = readFileSync(new URL("../app/auth/callback/page.tsx", import.meta.url), "utf8");

  assert.match(clientSource, /flowType: "pkce"/);
  assert.match(clientSource, /detectSessionInUrl: false/);
  assert.match(clientSource, /persistSession: true/);
  assert.match(callbackSource, /prepareAuthCallbackExchange/);
  assert.match(callbackSource, /createSingleAuthCallbackCompletion\(completeCallback\)/);
  assert.equal(callbackSource.includes("startedRef"), false);
  assert.equal(callbackSource.includes("setSession"), false);
  assert.equal(callbackSource.includes("location.reload"), false);
  assert.equal(callbackSource.includes("provider_token"), false);
  assert.equal(callbackSource.includes("refresh_token"), false);
});

test("login, magic link y Google Connected Account usan el mismo callback PKCE", () => {
  const authGateSource = readFileSync(new URL("../components/AuthGate.tsx", import.meta.url), "utf8");
  const googleSessionSource = readFileSync(new URL("../lib/googleAuthSession.ts", import.meta.url), "utf8");

  assert.match(authGateSource, /emailRedirectTo: prepareAuthCallback/);
  assert.match(googleSessionSource, /signInWithGoogleForAuth[\s\S]*prepareAuthCallback/);
  assert.match(googleSessionSource, /reconnectGoogle[\s\S]*prepareAuthCallback/);
});
