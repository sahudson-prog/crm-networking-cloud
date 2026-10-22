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
import {
  GOOGLE_DATA_SESSION_REQUIRED_MESSAGE,
  googleDataConnectionPrincipalsMatch,
  googleDataSessionEligibility
} from "../lib/googleDataSessionGuard.ts";
import { googleSyncOperationsForScopes } from "../lib/googleSyncAuthorization.ts";

const EXPECTED_CLIENT_ID = "expected-client.apps.googleusercontent.com";

test("normalize email recorta espacios y compara en minusculas", () => {
  assert.equal(normalizeEmail(" User@Example.Invalid "), "user@example.invalid");
});

test("sesion Google compatible habilita autorizacion de datos", () => {
  const result = googleDataSessionEligibility({
    email: " User@Example.Invalid ",
    identities: [{
      identity_data: { email: "user@example.invalid" },
      provider: "google"
    }]
  });

  assert.deepEqual(result, {
    allowed: true,
    canonicalEmail: "user@example.invalid"
  });
});

test("sesion OTP sin identidad Google compatible queda bloqueada", () => {
  assert.equal(
    GOOGLE_DATA_SESSION_REQUIRED_MESSAGE,
    "Para usar Google, entra a Coffeecito con la misma cuenta Google que quieres sincronizar."
  );
  assert.equal(googleDataSessionEligibility({
    email: "user@outlook.invalid",
    identities: [{
      identity_data: { email: "user@outlook.invalid" },
      provider: "email"
    }]
  }).allowed, false);
});

test("identidad Google del mismo dominio pero otro email queda bloqueada", () => {
  assert.equal(googleDataSessionEligibility({
    email: "owner@example.invalid",
    identities: [{
      identity_data: { email: "other@example.invalid" },
      provider: "google"
    }]
  }).allowed, false);
});

test("Data OAuth conserva el principal cuando A retorna como A", () => {
  assert.equal(googleDataConnectionPrincipalsMatch(
    { email: " User@Example.Invalid ", userId: "user-a" },
    { email: "user@example.invalid", userId: "user-a" }
  ), true);
});

test("Data OAuth falla cerrado cuando A retorna como B", () => {
  assert.equal(googleDataConnectionPrincipalsMatch(
    { email: "user-a@example.invalid", userId: "user-a" },
    { email: "user-b@example.invalid", userId: "user-b" }
  ), false);
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

test("OAuth de datos consulta rollout y capability operativa antes de guardar intención", () => {
  const dataAuthorization = readFileSync(new URL("../lib/googleDataAuthorizationIntent.ts", import.meta.url), "utf8");
  const activityAuthorization = readFileSync(new URL("../lib/activitySyncAuthorization.ts", import.meta.url), "utf8");

  assert.ok(
    dataAuthorization.indexOf("await requireGoogleOAuthRolloutEligibility(googleDataAuthorizationOperation(intent))")
      < dataAuthorization.indexOf("rememberPendingGoogleDataAction(intent)")
  );
  assert.ok(
    activityAuthorization.indexOf("await requireGoogleOAuthRolloutOperations(")
      < activityAuthorization.indexOf("rememberPendingActivitySyncAuthorization(normalizedRequestedServices)")
  );
});

test("finalize revalida rollout y operaciones antes de consultar Google y persistir", () => {
  const routeSource = readFileSync(new URL("../app/api/google/connected-account/finalize/route.ts", import.meta.url), "utf8");
  const rolloutCheck = routeSource.indexOf("current_user_can_start_connected_oauth_v1");
  const operationCheck = routeSource.indexOf("current_user_has_capability");
  const googleEvidence = routeSource.indexOf("readGoogleEvidence(providerToken)");
  const finalize = routeSource.indexOf("finalize_google_connected_account_verified");

  assert.ok(rolloutCheck > 0);
  assert.ok(operationCheck > rolloutCheck);
  assert.ok(operationCheck < googleEvidence);
  assert.ok(rolloutCheck < googleEvidence);
  assert.ok(googleEvidence < finalize);
  assert.match(routeSource, /google_rollout_denied/);
  assert.match(routeSource, /google_operation_denied/);
  assert.match(routeSource, /requestedOperations\.some[\s\S]*verification\.effectiveScopes\.includes/);
  assert.match(routeSource, /capabilities: account\.capabilities/);
  assert.match(routeSource, /effectiveScopes: account\.scopes/);
});

test("callback deriva operaciones únicamente de scopes de datos solicitados", () => {
  assert.deepEqual(googleSyncOperationsForScopes([
    GOOGLE_CONTACTS_READONLY_SCOPE,
    GOOGLE_GMAIL_READONLY_SCOPE,
    "openid"
  ]), ["contacts", "email"]);
});

test("writers Google usan RPCs transaccionales con cuenta conectada", () => {
  const contactWriter = readFileSync(new URL("../lib/contactSyncApply.ts", import.meta.url), "utf8");
  const interactionWriter = readFileSync(new URL("../lib/externalInteractionSync.ts", import.meta.url), "utf8");

  assert.match(contactWriter, /apply_google_contact_sync_change_v1/);
  assert.match(contactWriter, /if \(context\.provider === "google"\)/);
  assert.match(interactionWriter, /apply_google_interaction_sync_v1/);
  assert.match(interactionWriter, /if \(normalized\.provider === "google"\)/);
});

test("runtime Google deja capabilities legacy solo como tipos compatibles", () => {
  const runtimeSources = [
    "../components/ActivitySyncButton.tsx",
    "../components/ContactDataSyncButton.tsx",
    "../components/GoogleContactsSyncPanel.tsx",
    "../components/GoogleInteractionsSyncPanel.tsx"
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");

  assert.doesNotMatch(runtimeSources, /contacts\.import_google|interactions\.import_google/);
  assert.match(runtimeSources, /requireGoogleConnectedSync/);
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

test("Cuenta concentra integraciones en importacion y elimina el resumen de acceso", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /Acceso a Coffeecito/);
  assert.doesNotMatch(source, /Email por link/);
  assert.match(source, /Importación y sincronización/);
  assert.match(source, /Microsoft/);
  assert.match(source, /Apple/);
  assert.match(source, /Próximamente/);
});

test("Cuenta muestra Próximamente para Google no elegible y conserva controles para operaciones habilitadas", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");

  assert.match(source, /readGoogleOAuthOperationEligibility\("contacts"\)/);
  assert.match(source, /readGoogleOAuthOperationEligibility\("email"\)/);
  assert.match(source, /readGoogleOAuthOperationEligibility\("calendar"\)/);
  assert.match(source, /contactsEligibility === "enabled"[\s\S]*GoogleContactsSyncPanel[\s\S]*SourcePlaceholder[\s\S]*title="Google Contacts"/);
  assert.match(source, /emailEligibility === "enabled"[\s\S]*GoogleInteractionsSyncPanel[\s\S]*SourcePlaceholder[\s\S]*provider="gmail"[\s\S]*title="Gmail"/);
  assert.match(source, /calendarEligibility === "enabled"[\s\S]*InteractionSyncPreferenceToggle[\s\S]*SourcePlaceholder[\s\S]*provider="googleCalendar"[\s\S]*title="Google Calendar"/);
  assert.match(source, /status = "Próximamente"/);
  assert.match(source, /availability === "loading" \? "Revisando\.\.\."/);
  assert.doesNotMatch(source, /capability_code|contacts\.sync_external|interactions\.sync_(email|calendar)/);
});

test("Cuenta usa autorizacion por accion sin CTA Google global ni copy tecnico", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");

  assert.match(source, /Autorizado/);
  assert.match(source, /Requiere autorización/);
  assert.doesNotMatch(source, /Vincular Google|Autorizar Google|Renovar autorización|Actualizar autorización/);
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
  assert.match(interactionsSource, /mailActionDisabledReason && !state\.loading/);
  assert.match(interactionsSource, /Boolean\(mailActionDisabledReason\) \|\| !state\.selectedGmailLabelId/);
  assert.match(accountSource, /showCalendarAction=\{false\}/);
});

test("Cuenta bloquea todas las autorizaciones de datos para una sesion no Google sin afectar vCard", () => {
  const accountSource = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
  const contactsSource = readFileSync(new URL("../components/GoogleContactsSyncPanel.tsx", import.meta.url), "utf8");
  const interactionsSource = readFileSync(new URL("../components/GoogleInteractionsSyncPanel.tsx", import.meta.url), "utf8");

  assert.match(accountSource, /googleDataSessionEligibility\(data\.session\?\.user\)\.allowed/);
  assert.match(accountSource, /!account\.googleDataAuthorizationAllowed[\s\S]*GOOGLE_DATA_SESSION_REQUIRED_MESSAGE/);
  assert.match(accountSource, /googleDisabledReason=\{googleImportDisabledReason\(account, "contacts"\)\}/);
  assert.match(accountSource, /calendarDisabledReason=\{googleImportDisabledReason\(account, "calendar"\)\}/);
  assert.match(accountSource, /mailDisabledReason=\{googleImportDisabledReason\(account, "mail"\)\}/);
  assert.match(accountSource, /disabled=\{syncPreferences\.loading \|\| syncPreferences\.saving \|\| account\.googleAuthorizationVerifying \|\| !account\.googleDataAuthorizationAllowed\}/);
  assert.match(contactsSource, /disabled=\{Boolean\(compactDisabledReason\) \|\| state\.loading\}/);
  assert.match(interactionsSource, /aria-label="Seleccionar correos de Gmail"[\s\S]*disabled=\{Boolean\(mailActionDisabledReason\)\}/);
  assert.match(interactionsSource, /disabled=\{googleConnectionLoading \|\| Boolean\(mailActionDisabledReason\)\}/);
  assert.match(accountSource, /<VCardImportPanel/);
});

test("guard central impide iniciar OAuth de datos antes de signInWithOAuth", () => {
  const sessionSource = readFileSync(new URL("../lib/googleAuthSession.ts", import.meta.url), "utf8");
  const eligibilityIndex = sessionSource.indexOf("googleDataSessionEligibility(session?.user)");
  const blockedIndex = sessionSource.indexOf("if (!session || !eligibility.allowed)");
  const oauthIndex = sessionSource.indexOf("supabase.auth.signInWithOAuth({");

  assert.ok(eligibilityIndex > -1);
  assert.ok(blockedIndex > eligibilityIndex);
  assert.ok(oauthIndex > blockedIndex);
  assert.match(sessionSource, /sessionEmail: eligibility\.canonicalEmail/);
  assert.match(sessionSource, /sessionUserId: session\.user\.id/);
  assert.match(sessionSource, /if \(!googleDataConnectionPrincipalsMatch\(\{[\s\S]*email: intent\.sessionEmail,[\s\S]*userId: intent\.sessionUserId[\s\S]*\}, currentSession\)\)/);
});

test("bootstrap Gmail de Cuenta exige una etiqueta USER antes de Review", () => {
  const interactionsSource = readFileSync(new URL("../components/GoogleInteractionsSyncPanel.tsx", import.meta.url), "utf8");

  assert.match(interactionsSource, /listGoogleGmailUserLabels/);
  assert.match(interactionsSource, /selectedGmailLabelId/);
  assert.match(interactionsSource, /!state\.selectedGmailLabelId/);
  assert.match(interactionsSource, /Selecciona una etiqueta Gmail antes de revisar correos/);
});

test("labels Gmail se recargan con el token actualizado despues de renovar autorizacion", () => {
  const accountSource = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
  const interactionsSource = readFileSync(new URL("../components/GoogleInteractionsSyncPanel.tsx", import.meta.url), "utf8");

  assert.match(accountSource, /googleAccessToken=\{account\.googleAccessToken\}/);
  assert.match(interactionsSource, /listGoogleGmailUserLabels\(\{ accessToken \}\)/);
  assert.ok(
    interactionsSource.indexOf('requireGoogleConnectedSyncAuthorization(googleConnection.account?.id, "email")')
      < interactionsSource.indexOf("listGoogleGmailUserLabels({ accessToken })")
  );
  assert.match(interactionsSource, /\[effectiveAccessToken, gmailLabelsReloadKey, googleMailAvailable\]/);
  assert.match(interactionsSource, /if \(!active\) return/);
});

test("selector Gmail distingue loading, empty y error reintentable", () => {
  const interactionsSource = readFileSync(new URL("../components/GoogleInteractionsSyncPanel.tsx", import.meta.url), "utf8");

  assert.match(interactionsSource, /Cargando etiquetas\.\.\./);
  assert.match(interactionsSource, /No hay etiquetas personales en esta cuenta de Gmail/);
  assert.match(interactionsSource, /No pude cargar las etiquetas de Gmail/);
  assert.match(interactionsSource, /setGmailLabelsReloadKey/);
  assert.match(interactionsSource, /aria-label="Reintentar carga de etiquetas Gmail"/);
});

test("dialogo Gmail autoriza primero y luego exige una etiqueta", () => {
  const interactionsSource = readFileSync(new URL("../components/GoogleInteractionsSyncPanel.tsx", import.meta.url), "utf8");

  assert.match(interactionsSource, /if \(mailAuthorizationRequired\)[\s\S]*connectGoogle\("mail"\)/);
  assert.match(interactionsSource, /mailAuthorizationRequired \? \([\s\S]*Autorizar Gmail[\s\S]*connectGoogle\("mail"\)/);
  assert.match(interactionsSource, /Boolean\(mailActionDisabledReason\) \|\| !state\.selectedGmailLabelId/);
  assert.match(interactionsSource, /selectedGmailLabelId: event\.target\.value/);
});

test("Gmail sin capability no carga labels y puede reautorizar solo gmail readonly", () => {
  const accountSource = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
  const interactionsSource = readFileSync(new URL("../components/GoogleInteractionsSyncPanel.tsx", import.meta.url), "utf8");
  const intentSource = readFileSync(new URL("../lib/googleDataAuthorizationIntent.ts", import.meta.url), "utf8");

  assert.match(interactionsSource, /if \(!accessToken \|\| !googleMailAvailable\)[\s\S]*gmailLabels: \[\][\s\S]*gmailLabelsLoading: false/);
  assert.match(interactionsSource, /readCurrentGoogleConnectionState\(\{ registerRememberedScopes: false \}\)[\s\S]*requireGoogleConnectedSyncAuthorization\(googleConnection\.account\?\.id, "email"\)[\s\S]*listGoogleGmailUserLabels/);
  assert.match(interactionsSource, /beginGoogleDataAuthorization\("import_gmail_history", redirectTo\)/);
  assert.match(intentSource, /import_gmail_history:[\s\S]*scopes: \[GOOGLE_GMAIL_READONLY_SCOPE\]/);
  assert.match(accountSource, /oauthReturn\.status === "invalid"[\s\S]*pendingAction === "import_gmail_history"[\s\S]*setResumeAction\(pendingAction\)/);
  assert.match(accountSource, /!capabilityAvailable[\s\S]*pendingAction === "import_gmail_history"[\s\S]*setResumeAction\(pendingAction\)/);
  assert.match(interactionsSource, /if \(!resumeMailImport \|\| googleConnectionLoading\) return[\s\S]*setHistoricalImportOpen\(true\)/);
  assert.doesNotMatch(interactionsSource, /setServiceEnabled/);
});

test("Gmail histórico revalida capability en lectura preview y apply", () => {
  const flowSource = readFileSync(new URL("../lib/googleInteractionSyncFlow.ts", import.meta.url), "utf8");
  const review = flowSource.match(/export async function reviewGoogleGmailHistoricalBootstrap[\s\S]*?\n\}/);
  const apply = flowSource.match(/export async function applyGoogleGmailHistoricalBootstrap[\s\S]*?\n\}/);

  assert.ok(review);
  assert.ok(apply);
  assert.match(review[0], /authorizeConnectedSync\(input\.connectedAccountId, "email"\)[\s\S]*readMailProfileHistoryId[\s\S]*readMail/);
  assert.match(apply[0], /authorizeConnectedSync\(input\.connectedAccountId, "email"\)[\s\S]*syncMail/);
});

test("Contactos no se bloquea por fecha de inicio pero correos y calendario si", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
  const contactsReasonIndex = source.indexOf('googleImportDisabledReason(account, "contacts")');
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

test("vCard queda como import one-shot sin Connected Account", () => {
  const accountSource = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
  const vcardSource = readFileSync(new URL("../components/VCardImportPanel.tsx", import.meta.url), "utf8");

  assert.match(accountSource, /VCardImportPanel/);
  assert.match(vcardSource, /Importar contactos desde archivo vCard/);
  assert.match(vcardSource, /Compatible con exportaciones de Google, Apple Contacts, Outlook y otros servicios/);
  assert.match(vcardSource, /Importar selección/);
  assert.doesNotMatch(vcardSource, /Próximamente/);
  assert.equal(vcardSource.includes("readCurrentGoogleConnectionState"), false);
});

test("Cuenta presenta vCard antes de Google y conserva proveedores futuros", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");

  assert.ok(source.indexOf("<VCardImportPanel") < source.indexOf("<GoogleContactsSyncPanel"));
  assert.match(source, /<VCardImportPanel[\s\S]*actionLabel="Importar archivo vCard"[\s\S]*sourceLabel="vCard \(\.vcf\)"/);
  assert.ok(source.indexOf('title="Apple Contacts"') > source.indexOf("<GoogleContactsSyncPanel"));
  assert.ok(source.indexOf('title="Microsoft Contacts"') > source.indexOf('title="Apple Contacts"'));
  assert.match(source, /status = "Próximamente"[\s\S]*account-source-status">\{status\}/);
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

test("ActivitySyncButton ejecuta servicios independientes conservando snapshots Gmail", () => {
  const source = readFileSync(new URL("../components/ActivitySyncButton.tsx", import.meta.url), "utf8");
  const execution = readFileSync(new URL("../lib/activitySyncExecution.ts", import.meta.url), "utf8");

  assert.match(source, /globalFocusedMailSync: variant === "focus_incremental"/);
  assert.match(source, /startGlobalActivitySync\(async \(\) =>/);
  assert.match(source, /executeActivitySyncServices\(\{/);
  assert.match(source, /runService: \(service\) => runActivityService\(input, scope, service\)/);
  assert.match(source, /includeCalendar: service === "calendar"/);
  assert.match(source, /includeMail: service === "mail"/);
  assert.match(source, /const reviewed = await runSync\(\{ \.\.\.serviceInput, dryRun: true \}\)/);
  assert.match(source, /const applied = await runSync\(\{[\s\S]*dryRun: false,[\s\S]*gmailFocusedSnapshot: scope === "global" \? reviewed\.result\.gmailFocusedSnapshot/);
  assert.match(source, /gmailFocusedSnapshot: input\.dryRun \? null : input\.gmailFocusedSnapshot/);
  assert.match(source, /await runContactSync\(/);
  assert.match(source, /gmailContactSnapshot: scope === "contact" \? reviewed\.result\.gmailContactSnapshot/);
  assert.match(source, /contactRecentMailSync: variant === "single_contact"/);
  assert.match(source, /gmailContactSnapshot: input\.dryRun \? null : input\.gmailContactSnapshot/);
  assert.match(source, /calendarRollingSnapshot: reviewed\.result\.calendarRollingSnapshot/);
  assert.match(source, /calendarRollingSnapshot: input\.dryRun \? null : input\.calendarRollingSnapshot/);
  assert.match(source, /const networkingStart = await requirePeriodicNetworkingStartIso\(\)/);
  assert.match(source, /gmailSince: networkingStart/);
  assert.match(source, /calendarRollingWindowSync: input\.includeCalendar \? \(variant === "focus_incremental" \? "global" : "contact"\)/);
  assert.match(source, /const calendarWindow = input\.includeCalendar \? calendarRollingWindowIso\(\) : null/);
  assert.match(source, /const calendarTimeMin = latestIsoInstant\(calendarWindow\?\.since, networkingStart\)/);
  assert.match(source, /error instanceof NetworkingStartConfigurationError/);
  assert.match(source, /input\.includeCalendar[\s\S]*syncLimits\.calendarPages \|\| ACTIVITY_SYNC_MAX_CALENDAR_PAGES[\s\S]*syncLimits\.mailPages \|\| ACTIVITY_SYNC_MAX_MAIL_PAGES/);
  assert.doesNotMatch(source, /SyncPreviewDialog/);
  assert.match(source, /scope === "global" && allActivitySyncServicesSucceeded\(outcomes\)/);
  assert.match(source, /recordGlobalActivitySyncSuccess/);
  assert.match(source, /freshnessAfterActivitySync\(current\.serviceFreshness, globalOutcomes\)/);
  assert.match(source, /running: globalSync\.running/);
  assert.doesNotMatch(source, /transientOutcomes|serviceErrors/);
  assert.match(execution, /if \(activeGlobalActivitySync\)/);
  assert.match(execution, /\.finally\(\(\) => \{[\s\S]*activeGlobalActivitySync = null/);
  assert.match(source, /finally \{[\s\S]*applying: false,[\s\S]*loading: false,[\s\S]*message: ""/);
});

test("ActivitySyncButton abre popover antes de ejecutar y deriva una acción contextual", () => {
  const source = readFileSync(new URL("../components/ActivitySyncButton.tsx", import.meta.url), "utf8");

  assert.match(source, /if \(currentSelection\.connectionRequired \|\| !googleConnection\.connected \|\| !googleConnection\.accessToken\)/);
  assert.match(source, /onClick=\{\(\) => setPopoverOpen\(true\)\}/);
  assert.match(source, /onFocus=\{\(\) => setPopoverOpen\(true\)\}/);
  assert.match(source, /globalPrimaryAction\.kind === "authorize"/);
  assert.match(source, /beginActivitySyncAuthorization\(enabledGlobalServices, missingServices, window\.location\.href\)/);
  assert.match(source, /aria-label="Estado de sincronización"/);
  assert.doesNotMatch(source, /activity-sync-status/);
  assert.match(source, /executeActivitySyncServices\(\{/);
});

test("sync now solicita solo scopes faltantes de servicios ON y reanuda tras OAuth", () => {
  const source = readFileSync(new URL("../components/ActivitySyncButton.tsx", import.meta.url), "utf8");
  const authorization = readFileSync(new URL("../lib/activitySyncAuthorization.ts", import.meta.url), "utf8");

  assert.match(authorization, /service === "mail" \? GOOGLE_GMAIL_READONLY_SCOPE : GOOGLE_CALENDAR_READONLY_SCOPE/);
  assert.doesNotMatch(authorization, /GOOGLE_CONTACTS_READONLY_SCOPE|contacts\.readonly|"contacts"/);
  assert.match(authorization, /rememberPendingActivitySyncAuthorization\(normalizedRequestedServices\)/);
  assert.match(authorization, /reconnectGoogle\(activitySyncAuthorizationScopes\(normalizedMissingServices\), redirectTo\)/);
  assert.match(authorization, /PENDING_ACTIVITY_SYNC_AUTHORIZATION_KEY/);
  assert.match(source, /pendingAuthorization\.services\.filter\(\(service\) => \([\s\S]*gmailEnabled[\s\S]*calendarEnabled/);
  assert.match(source, /oauthReturn\.status !== "completed" \|\| resumeAuthorizationRef\.current/);
  assert.match(source, /missingServices\.length \|\| !googleConnection\.accessToken \|\| !googleConnection\.userEmail/);
  assert.match(source, /startGlobalActivitySync\(\(\) => runGlobalSync\(\{[\s\S]*requestedServices\.includes\("calendar"\)[\s\S]*requestedServices\.includes\("mail"\)/);
});

test("preferencias de interacción gobiernan Cuenta y ActivitySyncButton sin afectar Bootstrap", () => {
  const accountSource = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
  const activitySource = readFileSync(new URL("../components/ActivitySyncButton.tsx", import.meta.url), "utf8");
  const bootstrapSource = readFileSync(new URL("../components/GoogleInteractionsSyncPanel.tsx", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../components/Shell.tsx", import.meta.url), "utf8");

  assert.match(shellSource, /InteractionSyncPreferencesProvider/);
  assert.match(accountSource, /label="Correos de Gmail"/);
  assert.match(accountSource, /label="Citas de Google Calendar"/);
  assert.match(accountSource, /interactionSyncToggleAction/);
  assert.match(accountSource, /enable_gmail_sync/);
  assert.match(accountSource, /enable_calendar_sync/);
  assert.match(accountSource, /capabilityAvailable[\s\S]*setServiceEnabled\(pendingService, true\)/);
  assert.match(accountSource, /oauthReturn\.status !== "completed"[\s\S]*clearPendingGoogleDataAction/);
  assert.match(activitySource, /resolveActivitySyncSelection/);
  assert.match(activitySource, /!selection\.canSync/);
  assert.match(activitySource, /openSyncSettings/);
  assert.match(activitySource, /readGlobalActivityServiceFreshness/);
  assert.doesNotMatch(bootstrapSource, /useInteractionSyncPreferences/);
});

test("Cuenta separa importacion manual de sincronizacion automatica", () => {
  const accountSource = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");

  assert.match(accountSource, />Importar datos</);
  assert.match(accountSource, />Sincronización automática</);
  assert.match(accountSource, /AccountDataBlock title="Contactos"/);
  assert.match(accountSource, /AccountDataBlock title="Citas"/);
  assert.match(accountSource, /AccountDataBlock title="Correos"/);
  assert.match(accountSource, /iCalendar \(\.ics\)/);
  assert.match(accountSource, /Apple Contacts/);
  assert.match(accountSource, /Microsoft Contacts/);
  assert.doesNotMatch(accountSource, /Otros proveedores|Apple \/ iCloud Mail|Microsoft Outlook/);
  assert.match(accountSource, /account-provider-sync-block[\s\S]*ProviderIcon name="google"/);
  assert.match(accountSource, /icon="calendar"[\s\S]*label="Citas de Google Calendar"/);
  assert.match(accountSource, /icon="mail"[\s\S]*label="Correos de Gmail"/);
  assert.doesNotMatch(accountSource, /label="Contactos de Google"/);
  assert.match(accountSource, /Cerrar sesión/);
  assert.match(styles, /\.account-data-grid \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 780px\)[\s\S]*\.account-data-grid \{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
});

test("Importar datos homologa proveedor, documento y botones plus accesibles", () => {
  const accountSource = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
  const contactsSource = readFileSync(new URL("../components/GoogleContactsSyncPanel.tsx", import.meta.url), "utf8");
  const interactionsSource = readFileSync(new URL("../components/GoogleInteractionsSyncPanel.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");

  assert.match(accountSource, /compactAction=\{includeOtherSources\}/);
  assert.match(accountSource, /iconOnlyActions=\{includeOtherSources\}/);
  assert.match(accountSource, /actionLabel="Importar archivo vCard"/);
  assert.match(accountSource, /AccountDataBlock title="Citas">[\s\S]*SourcePlaceholder icon="file" title="iCalendar \(\.ics\)"/);
  assert.match(contactsSource, /ProviderIcon name="google"/);
  assert.match(contactsSource, /aria-label=.*Importar contactos de Google[\s\S]*icon="plus"/);
  assert.match(contactsSource, /aria-label="Borrar contactos importados"[\s\S]*square=\{iconOnlyActions\}/);
  assert.match(interactionsSource, /ProviderIcon name="google"/);
  assert.match(interactionsSource, /<strong>Seleccionar correos<\/strong>/);
  assert.match(interactionsSource, /aria-label="Seleccionar correos de Gmail"[\s\S]*icon="plus"/);
  assert.match(interactionsSource, /aria-modal="true"[\s\S]*gmail-history-dialog/);
  assert.match(interactionsSource, /aria-label=\{googleConnectionLoading \? "Verificando Gmail"[\s\S]*"Importar correos antiguos"\}/);
  assert.match(interactionsSource, /aria-label="Borrar correos importados"/);
  assert.match(interactionsSource, /setHistoricalImportOpen\(false\)[\s\S]*previewOpen: true/);
  assert.match(styles, /\.account-icon-action\.destructive \.icon \{[\s\S]*color: var\(--crm-danger\)/);
});

test("Google agrupa toggles accesibles con iconos de tipo y el verde vigente", () => {
  const accountSource = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
  const providerSource = readFileSync(new URL("../components/ui/ProviderIcon.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");

  assert.match(accountSource, /ProviderIcon name="google"/);
  assert.match(accountSource, /icon="calendar"/);
  assert.match(accountSource, /icon="mail"/);
  assert.match(accountSource, /account-sync-preference-service[\s\S]*account-data-type-icon[\s\S]*<strong>\{label\}<\/strong>[\s\S]*<input/);
  assert.match(accountSource, /aria-label=\{`\$\{label\}: \$\{checked \? "activado" : "desactivado"\}`\}/);
  assert.match(providerSource, /function GmailIcon/);
  assert.match(providerSource, /function GoogleCalendarIcon/);
  assert.match(styles, /\.connected-service-logo \.provider-icon,[\s\S]*\.connected-service-logo \.icon \{[\s\S]*width: 18px;[\s\S]*height: 18px/);
  assert.match(styles, /\.account-sync-preference input:checked \{[^}]*var\(--crm-positive\)/);
  assert.doesNotMatch(styles, /\.account-sync-preference input:checked \{[^}]*var\(--crm-success\)/);
});

test("cada intención Google solicita solo su scope mínimo", () => {
  const source = readFileSync(new URL("../lib/googleDataAuthorizationIntent.ts", import.meta.url), "utf8");
  const contactButtonSource = readFileSync(new URL("../components/ContactDataSyncButton.tsx", import.meta.url), "utf8");

  assert.match(source, /enable_calendar_sync:[\s\S]*capability: "calendar",[\s\S]*scopes: \[GOOGLE_CALENDAR_READONLY_SCOPE\]/);
  assert.match(source, /enable_gmail_sync:[\s\S]*capability: "gmail",[\s\S]*scopes: \[GOOGLE_GMAIL_READONLY_SCOPE\]/);
  assert.match(source, /import_contacts:[\s\S]*capability: "contacts",[\s\S]*scopes: \[GOOGLE_CONTACTS_READONLY_SCOPE\]/);
  assert.match(source, /import_gmail_history:[\s\S]*capability: "gmail",[\s\S]*scopes: \[GOOGLE_GMAIL_READONLY_SCOPE\]/);
  assert.doesNotMatch(source, /GOOGLE_AUTH_LOGIN_SCOPES|GOOGLE_INTERACTIONS_READONLY_SCOPES/);
  assert.match(contactButtonSource, /reconnectGoogle\(\[GOOGLE_CONTACTS_READONLY_SCOPE\]\)/);
  assert.doesNotMatch(contactButtonSource, /GOOGLE_INTERACTIONS_READONLY_SCOPES|GOOGLE_AUTH_LOGIN_SCOPES/);
});

test("OAuth incremental pide conservar grants anteriores y persiste capability efectiva", () => {
  const sessionSource = readFileSync(new URL("../lib/googleAuthSession.ts", import.meta.url), "utf8");
  const connectedAccountsSource = readFileSync(new URL("../lib/connectedAccounts.ts", import.meta.url), "utf8");

  assert.match(sessionSource, /include_granted_scopes: "true"/);
  assert.match(sessionSource, /effectiveScopes/);
  assert.match(connectedAccountsSource, /finalizeRememberedGoogleDataConnection/);
});

test("callback completa solo la intención pendiente y OFF no revoca permisos", () => {
  const accountSource = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
  const preferencesSource = readFileSync(new URL("../lib/interactionSyncPreferences.ts", import.meta.url), "utf8");

  assert.match(accountSource, /pendingAction === "import_contacts" \|\| pendingAction === "import_gmail_history"/);
  assert.match(accountSource, /pendingAction === "enable_gmail_sync" \? "gmail" : "calendar"/);
  assert.match(accountSource, /resumeImport=\{resumeAction === "import_contacts"\}/);
  assert.match(accountSource, /resumeMailImport=\{resumeAction === "import_gmail_history"\}/);
  assert.match(preferencesSource, /if \(!input\.enabled\) return "disable"/);
  assert.doesNotMatch(accountSource, /disconnectConnectedAccount/);
});

test("handlers productivos de errores auth Google invalidan autorizacion activa", () => {
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

test("401 y 403 no-quota se clasifican como auth failure sin revocar connected_accounts", () => {
  const contactsClient = readFileSync(new URL("../lib/googleContactsClient.ts", import.meta.url), "utf8");
  const interactionsClient = readFileSync(new URL("../lib/googleInteractionClient.ts", import.meta.url), "utf8");

  assert.match(contactsClient, /status === 401 \|\| status === 403[\s\S]*GOOGLE_CONTACTS_AUTH_REQUIRED/);
  assert.match(interactionsClient, /status === 401 \|\| status === 403[\s\S]*GOOGLE_INTERACTIONS_AUTH_REQUIRED/);
  assert.equal(contactsClient.includes("disconnect_current_user_google_connected_account"), false);
  assert.equal(interactionsClient.includes("disconnect_current_user_google_connected_account"), false);
});

test("rate limit Gmail no usa el codigo que activa invalidacion de autorizacion", () => {
  const interactionsClient = readFileSync(new URL("../lib/googleInteractionClient.ts", import.meta.url), "utf8");
  const activityButton = readFileSync(new URL("../components/ActivitySyncButton.tsx", import.meta.url), "utf8");
  const interactionsPanel = readFileSync(new URL("../components/GoogleInteractionsSyncPanel.tsx", import.meta.url), "utf8");

  assert.match(interactionsClient, /GOOGLE_INTERACTIONS_RATE_LIMITED/);
  assert.match(activityButton, /error\.code === "GOOGLE_INTERACTIONS_AUTH_REQUIRED"/);
  assert.match(interactionsPanel, /error\.code === "GOOGLE_INTERACTIONS_AUTH_REQUIRED"/);
  assert.match(activityButton, /error\.code === "GOOGLE_INTERACTIONS_RATE_LIMITED"[\s\S]*alcanzó temporalmente su límite de uso/);
  assert.doesNotMatch(activityButton, /error\.code === "GOOGLE_INTERACTIONS_RATE_LIMITED"[\s\S]{0,180}invalidateActiveGoogleDataAuthorization/);
  assert.equal(interactionsPanel.includes('error.code === "GOOGLE_INTERACTIONS_RATE_LIMITED"'), false);
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
