import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  effectiveGoogleDataScopesFromTokenScope,
  googleDataCapabilitiesFromEffectiveScopes,
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GOOGLE_CONTACTS_READONLY_SCOPE,
  GOOGLE_GMAIL_READONLY_SCOPE,
  verifyGoogleAuthorizationEvidence
} from "../lib/googleConnectedAccountVerification.ts";
import {
  buildGoogleAuthLoginRequest,
  canUseGoogleDataToken,
  normalizeEmail,
  selectCurrentGoogleConnectedAccount
} from "../lib/googleAuthLoginConfig.ts";
import { googleConnectionRevalidationUi } from "../lib/accountGoogleConnectionUi.ts";

const EXPECTED_CLIENT_ID = "expected-client.apps.googleusercontent.com";

test("normalize email recorta espacios y compara en minusculas", () => {
  assert.equal(normalizeEmail(" User@Example.Invalid "), "user@example.invalid");
});

test("effective scopes se extraen solo desde scope real del token", () => {
  const result = effectiveGoogleDataScopesFromTokenScope([
    GOOGLE_CONTACTS_READONLY_SCOPE,
    "https://www.googleapis.com/auth/drive.readonly",
    GOOGLE_GMAIL_READONLY_SCOPE
  ].join(" "));

  assert.deepEqual(result, [GOOGLE_CONTACTS_READONLY_SCOPE, GOOGLE_GMAIL_READONLY_SCOPE]);
});

test("requested scopes no sirven como effective scopes si tokeninfo no los trae", () => {
  const result = effectiveGoogleDataScopesFromTokenScope("openid email profile");

  assert.deepEqual(result, []);
});

test("capabilities derivan solo de effective scopes y soportan consentimiento parcial", () => {
  assert.deepEqual(googleDataCapabilitiesFromEffectiveScopes([GOOGLE_CALENDAR_READONLY_SCOPE]), {
    calendar_read: true,
    contacts_read: false,
    gmail_read: false
  });
});

test("verificacion Google acepta token, userinfo, email y audience validos", () => {
  const result = verifyGoogleAuthorizationEvidence({
    expectedClientId: EXPECTED_CLIENT_ID,
    sessionEmail: "User@Example.Invalid",
    tokenInfo: {
      aud: EXPECTED_CLIENT_ID,
      expires_in: "3600",
      scope: `${GOOGLE_CONTACTS_READONLY_SCOPE} ${GOOGLE_GMAIL_READONLY_SCOPE}`
    },
    userInfo: {
      email: " user@example.invalid ",
      email_verified: true,
      sub: "google-sub-1"
    }
  });

  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.effectiveScopes, [GOOGLE_CONTACTS_READONLY_SCOPE, GOOGLE_GMAIL_READONLY_SCOPE]);
  assert.deepEqual(result.capabilities, {
    calendar_read: false,
    contacts_read: true,
    gmail_read: true
  });
});

test("verificacion falla cerrado si el email Google no coincide con Coffeecito", () => {
  const result = verifyGoogleAuthorizationEvidence({
    expectedClientId: EXPECTED_CLIENT_ID,
    sessionEmail: "user@example.invalid",
    tokenInfo: {
      aud: EXPECTED_CLIENT_ID,
      expires_in: "3600",
      scope: GOOGLE_CONTACTS_READONLY_SCOPE
    },
    userInfo: {
      email: "other@example.invalid",
      email_verified: true,
      sub: "google-sub-1"
    }
  });

  assert.deepEqual(result, {
    code: "email_mismatch",
    message: "Usa la misma cuenta Google con la que entraste a Coffeecito.",
    status: "error"
  });
});

test("verificacion falla cerrado si email_verified no es true", () => {
  const result = verifyGoogleAuthorizationEvidence({
    expectedClientId: EXPECTED_CLIENT_ID,
    sessionEmail: "user@example.invalid",
    tokenInfo: {
      aud: EXPECTED_CLIENT_ID,
      expires_in: "3600",
      scope: GOOGLE_CONTACTS_READONLY_SCOPE
    },
    userInfo: {
      email: "user@example.invalid",
      email_verified: false,
      sub: "google-sub-1"
    }
  });

  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.code, "missing_account_identity");
});

test("verificacion falla cerrado si falta sub", () => {
  const result = verifyGoogleAuthorizationEvidence({
    expectedClientId: EXPECTED_CLIENT_ID,
    sessionEmail: "user@example.invalid",
    tokenInfo: {
      aud: EXPECTED_CLIENT_ID,
      expires_in: "3600",
      scope: GOOGLE_CONTACTS_READONLY_SCOPE
    },
    userInfo: {
      email: "user@example.invalid",
      email_verified: true,
      sub: ""
    }
  });

  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.code, "missing_account_identity");
});

test("verificacion falla cerrado si audience no coincide", () => {
  const result = verifyGoogleAuthorizationEvidence({
    expectedClientId: EXPECTED_CLIENT_ID,
    sessionEmail: "user@example.invalid",
    tokenInfo: {
      aud: "other-client.apps.googleusercontent.com",
      expires_in: "3600",
      scope: GOOGLE_CONTACTS_READONLY_SCOPE
    },
    userInfo: {
      email: "user@example.invalid",
      email_verified: true,
      sub: "google-sub-1"
    }
  });

  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.code, "audience_mismatch");
});

test("verificacion falla cerrado si tokeninfo esta expirado o invalido", () => {
  const result = verifyGoogleAuthorizationEvidence({
    expectedClientId: EXPECTED_CLIENT_ID,
    sessionEmail: "user@example.invalid",
    tokenInfo: {
      aud: EXPECTED_CLIENT_ID,
      expires_in: "0",
      scope: GOOGLE_CONTACTS_READONLY_SCOPE
    },
    userInfo: {
      email: "user@example.invalid",
      email_verified: true,
      sub: "google-sub-1"
    }
  });

  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.code, "expired_token");
});

test("permissionActive no nace de scopes persistidos si no coincide fingerprint de data authorization", () => {
  assert.equal(canUseGoogleDataToken({
    accountEmail: "user@example.invalid",
    activeDataTokenFingerprint: "old-data-token",
    currentProviderTokenFingerprint: "login-token",
    sessionEmail: "user@example.invalid"
  }), false);
});

test("autorizacion activa deja de habilitar permissionActive tras invalidacion", () => {
  assert.equal(canUseGoogleDataToken({
    accountEmail: "user@example.invalid",
    activeDataTokenFingerprint: "data-token-fingerprint",
    currentProviderTokenFingerprint: "data-token-fingerprint",
    sessionEmail: "user@example.invalid"
  }), true);

  assert.equal(canUseGoogleDataToken({
    accountEmail: "user@example.invalid",
    activeDataTokenFingerprint: "",
    currentProviderTokenFingerprint: "data-token-fingerprint",
    sessionEmail: "user@example.invalid"
  }), false);
});

test("logout sigue limpiando autorizacion Google data activa", () => {
  const sessionSource = readFileSync(new URL("../lib/googleAuthSession.ts", import.meta.url), "utf8");
  const logoutMatch = sessionSource.match(/export function clearRememberedGoogleRequestedScopes\(\) \{([\s\S]*?)\n\}/);

  assert.ok(logoutMatch);
  assert.match(logoutMatch[1], /clearPendingGoogleDataConnection\(\)/);
  assert.match(logoutMatch[1], /invalidateActiveGoogleDataAuthorization\(\)/);
});

test("login Google normal no registra Google data connection ni pide scopes de datos", () => {
  const loginRequest = buildGoogleAuthLoginRequest("http://localhost:3000");

  assert.equal(loginRequest.options.scopes.includes("contacts.readonly"), false);
  assert.equal(loginRequest.options.scopes.includes("gmail.readonly"), false);
  assert.equal(loginRequest.options.scopes.includes("calendar.readonly"), false);
});

test("cuenta de otro email no es la Connected Account actual", () => {
  const result = selectCurrentGoogleConnectedAccount([
    { accountEmail: "other@example.invalid", provider: "google", status: "active" }
  ], "user@example.invalid");

  assert.equal(result, null);
});

test("frontend no conserva escrituras directas a connected_accounts", () => {
  const source = readFileSync(new URL("../lib/connectedAccounts.ts", import.meta.url), "utf8");

  assert.equal(source.includes('.from("connected_accounts").insert'), false);
  assert.equal(source.includes('.from("connected_accounts").update'), false);
  assert.equal(source.includes('.from("connected_accounts").delete'), false);
  assert.equal(source.includes("disconnect_current_user_google_connected_account"), true);
});

test("server finalize no persiste ni loguea provider token", () => {
  const routeSource = readFileSync(new URL("../app/api/google/connected-account/finalize/route.ts", import.meta.url), "utf8");

  assert.equal(routeSource.includes("console."), false);
  assert.equal(routeSource.includes("oauth_refresh_token_encrypted"), false);
  assert.equal(routeSource.includes("provider_refresh_token"), false);
});

test("server finalize no acepta identidad ni permisos efectivos declarados por browser", () => {
  const routeSource = readFileSync(new URL("../app/api/google/connected-account/finalize/route.ts", import.meta.url), "utf8");

  assert.match(routeSource, /auth\.getUser\(supabaseAccessToken\)/);
  assert.match(routeSource, /current_user_app_access_status/);
  assert.match(routeSource, /verifyGoogleAuthorizationEvidence/);
  assert.match(routeSource, /finalize_google_connected_account_verified/);
  assert.equal(/body\?\.(user_id|account_email|effectiveScopes|capabilities|status)/.test(routeSource), false);
});

test("AccountPage no selecciona cualquier Google activa como cuenta actual", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("googleConnection?.account ?? null"), true);
  assert.equal(source.includes("connectedAccount.status === \"active\""), false);
});

test("AccountPage finaliza retorno OAuth y refresca estado sin reload manual", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");

  assert.match(source, /readGoogleDataConnectionReturn\(window\.location\.href\)/);
  assert.match(source, /refreshAccountState\(\{ preserveKnownGoogleState: false, registerRememberedScopes: true \}\)/);
  assert.match(source, /readCurrentGoogleConnectionState\(\{[\s\S]*registerRememberedScopes: options\.registerRememberedScopes/);
  assert.match(source, /Verificando autorización/);
  assert.equal(source.includes("router.refresh"), false);
});

test("Cuenta separa acceso a Coffeecito de importacion Google", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");

  assert.match(source, /Acceso a Coffeecito/);
  assert.match(source, /Importación y sincronización/);
  assert.match(source, /Email por link/);
  assert.match(source, /Microsoft/);
  assert.match(source, /Apple/);
  assert.match(source, /Próximamente/);
});

test("Cuenta usa lenguaje de autorizacion Google sin exponer copy tecnico", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");

  assert.match(source, /Autorizado/);
  assert.match(source, /Autorización parcial/);
  assert.match(source, /Autoriza Google para importar contactos, correos y calendario/);
  assert.equal(source.includes("permissionActive"), true);
  assert.equal(source.includes("permiso activo"), false);
  assert.equal(source.includes("Vinculado"), false);
});

test("revalidacion silenciosa conserva estado Google conocido sin loading visible", () => {
  assert.deepEqual(googleConnectionRevalidationUi({
    hasKnownState: true,
    isOAuthReturn: false
  }), {
    googleAuthorizationVerifying: false,
    googleConnectionLoading: false
  });
});

test("primera carga y retorno OAuth mantienen loading visible solo cuando corresponde", () => {
  assert.deepEqual(googleConnectionRevalidationUi({
    hasKnownState: false,
    isOAuthReturn: false
  }), {
    googleAuthorizationVerifying: false,
    googleConnectionLoading: true
  });
  assert.deepEqual(googleConnectionRevalidationUi({
    hasKnownState: true,
    isOAuthReturn: true
  }), {
    googleAuthorizationVerifying: true,
    googleConnectionLoading: true
  });
});

test("Cuenta mantiene estado Google conocido durante revalidacion de foco", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");

  assert.match(source, /googleConnectionRevalidationUi/);
  assert.match(source, /preserveKnownGoogleState: true, registerRememberedScopes: false/);
  assert.match(source, /hasKnownState: preserveKnownGoogleState && current\.googleConnectionKnown/);
  assert.match(source, /message: verifyingAuthorization \? "Verificando autorización\.\.\." : current\.message/);
});

test("botones de importacion compactos reciben razones visibles para disabled", () => {
  const accountSource = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
  const contactsSource = readFileSync(new URL("../components/GoogleContactsSyncPanel.tsx", import.meta.url), "utf8");
  const interactionsSource = readFileSync(new URL("../components/GoogleInteractionsSyncPanel.tsx", import.meta.url), "utf8");

  assert.match(accountSource, /Define primero la fecha de inicio de networking/);
  assert.match(contactsSource, /connected-service-reason/);
  assert.match(interactionsSource, /connected-service-action-reason/);
  assert.match(contactsSource, /Boolean\(compactDisabledReason\) \|\| state\.loading/);
  assert.match(interactionsSource, /Boolean\(mailActionDisabledReason\) \|\| state\.loading \|\| state\.applying/);
  assert.match(interactionsSource, /toolbar connected-service-action-controls[\s\S]*connected-service-action-reason[\s\S]*mailActionDisabledReason/);
  assert.match(interactionsSource, /toolbar connected-service-action-controls[\s\S]*connected-service-action-reason[\s\S]*calendarActionDisabledReason/);
});

test("Contactos no se bloquea por fecha de inicio pero correos y calendario si", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
  const contactsReasonIndex = source.indexOf('googleImportDisabledReason(account, googleServices.contacts, "contacts")');
  const dateReasonIndex = source.indexOf("Define primero la fecha de inicio de networking.");

  assert.ok(contactsReasonIndex > -1);
  assert.ok(dateReasonIndex > -1);
  assert.match(source, /service === "calendar" \|\| service === "mail"/);
});

test("revalidacion aplica un permiso Google invalido al terminar", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");

  assert.match(source, /setAccount\(nextAccount\)/);
  assert.match(source, /googlePermissionActive: Boolean\(activeGoogle && googleConnection\?\.permissionActive\)/);
});

test("vCard queda como entrada UI sin Connected Account", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");

  assert.match(source, /vCard \(\.vcf\)/);
  assert.match(source, /Compatible con exportaciones de Google, Apple Contacts, Outlook y otros servicios/);
  assert.equal(/vCard[\s\S]{0,240}readCurrentGoogleConnectionState/.test(source), false);
});

test("AccountPage protege contra lecturas stale y logout durante finalize", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");

  assert.match(source, /accountLoadGenerationRef/);
  assert.match(source, /generation !== accountLoadGenerationRef\.current/);
  assert.match(source, /event === "SIGNED_OUT"[\s\S]*accountLoadGenerationRef\.current \+= 1/);
});

test("paneles compactos de Cuenta no compiten por finalizar OAuth", () => {
  const accountSource = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
  const contactsSource = readFileSync(new URL("../components/GoogleContactsSyncPanel.tsx", import.meta.url), "utf8");
  const interactionsSource = readFileSync(new URL("../components/GoogleInteractionsSyncPanel.tsx", import.meta.url), "utf8");

  assert.match(accountSource, /registerRememberedScopes=\{false\}/);
  assert.match(contactsSource, /registerRememberedScopes = true/);
  assert.match(interactionsSource, /registerRememberedScopes = true/);
  assert.match(contactsSource, /readCurrentGoogleConnectionState\(\{ registerRememberedScopes \}\)/);
  assert.match(interactionsSource, /readCurrentGoogleConnectionState\(\{ registerRememberedScopes \}\)/);
});

test("importadores compactos quedan bloqueados mientras Google verifica autorizacion", () => {
  const contactsSource = readFileSync(new URL("../components/GoogleContactsSyncPanel.tsx", import.meta.url), "utf8");
  const interactionsSource = readFileSync(new URL("../components/GoogleInteractionsSyncPanel.tsx", import.meta.url), "utf8");

  assert.match(contactsSource, /compactDisabledReason/);
  assert.match(interactionsSource, /mailActionDisabledReason/);
  assert.match(interactionsSource, /calendarActionDisabledReason/);
});

test("consumidores Google exigen capability efectiva antes de usar token", () => {
  const files = [
    "../components/ActivitySyncButton.tsx",
    "../components/ContactDataSyncButton.tsx",
    "../components/GoogleContactsSyncPanel.tsx",
    "../components/GoogleInteractionsSyncPanel.tsx"
  ];

  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(source.includes("googleConnectionHasCapability"), true, file);
  }
});

test("handlers productivos de 401/403 Google invalidan autorizacion activa", () => {
  const files = [
    "../components/ActivitySyncButton.tsx",
    "../components/ContactDataSyncButton.tsx",
    "../components/GoogleContactsSyncPanel.tsx",
    "../components/GoogleInteractionsSyncPanel.tsx"
  ];

  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(source.includes("invalidateActiveGoogleDataAuthorization"), true, file);
  }
});

test("401 y 403 se clasifican como auth failure sin revocar connected_accounts", () => {
  const contactsClient = readFileSync(new URL("../lib/googleContactsClient.ts", import.meta.url), "utf8");
  const interactionsClient = readFileSync(new URL("../lib/googleInteractionClient.ts", import.meta.url), "utf8");

  assert.match(contactsClient, /status === 401 \|\| status === 403[\s\S]*GOOGLE_CONTACTS_AUTH_REQUIRED/);
  assert.match(interactionsClient, /status === 401 \|\| status === 403[\s\S]*GOOGLE_INTERACTIONS_AUTH_REQUIRED/);
  assert.equal(contactsClient.includes("disconnect_current_user_google_connected_account"), false);
  assert.equal(interactionsClient.includes("disconnect_current_user_google_connected_account"), false);
});

test("errores no-auth de Google no invalidan autorizacion automaticamente", () => {
  const contactsClient = readFileSync(new URL("../lib/googleContactsClient.ts", import.meta.url), "utf8");
  const interactionsClient = readFileSync(new URL("../lib/googleInteractionClient.ts", import.meta.url), "utf8");

  assert.match(contactsClient, /GOOGLE_CONTACTS_HTTP_ERROR/);
  assert.match(interactionsClient, /GOOGLE_INTERACTIONS_HTTP_ERROR/);
  assert.equal(contactsClient.includes("invalidateActiveGoogleDataAuthorization"), false);
  assert.equal(interactionsClient.includes("invalidateActiveGoogleDataAuthorization"), false);
});

test("invalidar autorizacion no revoca cuentas conectadas ni cierra sesion Supabase", () => {
  const sessionSource = readFileSync(new URL("../lib/googleAuthSession.ts", import.meta.url), "utf8");
  const invalidatorMatch = sessionSource.match(/export function invalidateActiveGoogleDataAuthorization\(\) \{([\s\S]*?)\n\}/);

  assert.ok(invalidatorMatch);
  assert.match(invalidatorMatch[1], /clearActiveGoogleDataTokenFingerprint\(\)/);
  assert.match(invalidatorMatch[1], /bumpGoogleDataAuthorizationInvalidationGeneration\(\)/);
  assert.equal(invalidatorMatch[1].includes("signOut"), false);
  assert.equal(invalidatorMatch[1].includes("disconnect_current_user_google_connected_account"), false);
  assert.equal(invalidatorMatch[1].includes("connected_accounts"), false);
});

test("finalize en vuelo no reactiva fingerprint si hubo invalidacion mientras esperaba servidor", () => {
  const sessionSource = readFileSync(new URL("../lib/googleAuthSession.ts", import.meta.url), "utf8");
  const captureIndex = sessionSource.indexOf("const invalidationGenerationBeforeFinalize = readGoogleDataAuthorizationInvalidationGeneration();");
  const finalizeIndex = sessionSource.indexOf("const finalized = await finalizeImpl({");
  const guardIndex = sessionSource.indexOf("readGoogleDataAuthorizationInvalidationGeneration() !== invalidationGenerationBeforeFinalize");
  const rememberIndex = sessionSource.indexOf("rememberActiveGoogleDataTokenFingerprint(currentProviderTokenFingerprint)");

  assert.ok(captureIndex > -1);
  assert.ok(finalizeIndex > captureIndex);
  assert.ok(guardIndex > finalizeIndex);
  assert.ok(rememberIndex > guardIndex);
});
