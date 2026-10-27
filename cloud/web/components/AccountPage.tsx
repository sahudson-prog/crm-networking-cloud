"use client";

import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { resetCurrentUserAppData } from "../lib/accountDataActions";
import {
  readCurrentGoogleConnectionState,
  type ConnectedAccountRecord,
  type GoogleConnectionState
} from "../lib/connectedAccounts";
import {
  clearRememberedGoogleRequestedScopes,
  readGoogleDataConnectionReturn
} from "../lib/googleAuthSession";
import {
  beginGoogleDataAuthorization,
  clearPendingGoogleDataAction,
  googleDataAuthorizationCapability,
  googleDataAuthorizationOperation,
  readPendingGoogleDataAction,
  type GoogleDataAuthorizationIntent
} from "../lib/googleDataAuthorizationIntent";
import {
  GOOGLE_DATA_SESSION_REQUIRED_MESSAGE,
  googleDataSessionEligibility
} from "../lib/googleDataSessionGuard";
import { isIcsImportEnabled } from "../lib/icsImportFeature";
import { readNetworkingStartIso } from "../lib/syncDate";
import { isOnboardingTestResetAvailable } from "../lib/onboarding";
import { googleConnectionRevalidationUi } from "../lib/accountGoogleConnectionUi";
import {
  readGoogleOAuthOperationEligibility,
  type ConnectedSyncOperation
} from "../lib/googleSyncAuthorization";
import {
  interactionSyncToggleAction,
  type InteractionSyncService
} from "../lib/interactionSyncPreferences";
import { supabase } from "../lib/supabaseClient";
import { ContactDuplicateReviewPanel } from "./ContactDuplicateReviewPanel";
import { GoogleContactsSyncPanel } from "./GoogleContactsSyncPanel";
import { GoogleInteractionsSyncPanel } from "./GoogleInteractionsSyncPanel";
import { IcsImportPanel } from "./IcsImportPanel";
import { useInteractionSyncPreferences } from "./InteractionSyncPreferencesProvider";
import { StartingPointFields } from "./StartingPointFields";
import { useShellActions } from "./Shell";
import { useOnboarding } from "./OnboardingProvider";
import { VCardImportPanel } from "./VCardImportPanel";
import { Button } from "./ui/Button";
import { Icon, type IconName } from "./ui/Icon";
import { ProviderIcon, type ProviderIconName } from "./ui/ProviderIcon";

type AccountState = {
  email: string;
  googleAccount: ConnectedAccountRecord | null;
  googleAccessToken: string;
  googleConnected: boolean;
  googleConnectionKnown: boolean;
  googleConnectionLoading: boolean;
  googleAuthorizationVerifying: boolean;
  googleDataAuthorizationAllowed: boolean;
  googlePermissionActive: boolean;
  googleSyncEligibility: Record<ConnectedSyncOperation, boolean>;
  googleSyncEligibilityKnown: boolean;
  message: string;
  networkingStartReady: boolean;
  resettingData: boolean;
};

export function AccountPage({ view = "full" }: { view?: "full" | "google-onboarding" } = {}) {
  const onboarding = useOnboarding();
  const { onSignOut } = useShellActions();
  const [account, setAccount] = useState<AccountState>(createInitialAccountState(true));
  const accountLoadGenerationRef = useRef(0);
  const googleFinalizeInFlightRef = useRef(false);
  const currentAccountEmailRef = useRef("");

  useEffect(() => {
    let mounted = true;

    async function refreshAccountState({
      preserveKnownGoogleState,
      registerRememberedScopes
    }: {
      preserveKnownGoogleState: boolean;
      registerRememberedScopes: boolean;
    }) {
      const generation = accountLoadGenerationRef.current + 1;
      accountLoadGenerationRef.current = generation;
      const verifyingAuthorization = registerRememberedScopes && isGoogleDataConnectionReturn();
      googleFinalizeInFlightRef.current = verifyingAuthorization;

      setAccount((current) => {
        const googleUi = googleConnectionRevalidationUi({
          hasKnownState: preserveKnownGoogleState && current.googleConnectionKnown,
          isOAuthReturn: verifyingAuthorization
        });
        return {
          ...current,
          ...googleUi,
          message: verifyingAuthorization ? "Verificando autorización..." : current.message
        };
      });

      return loadAccountState({ registerRememberedScopes })
      .then((nextAccount) => {
        if (!mounted || generation !== accountLoadGenerationRef.current) return;
        googleFinalizeInFlightRef.current = false;
        currentAccountEmailRef.current = nextAccount.email;
        setAccount(nextAccount);
      })
      .catch((error) => {
        if (!mounted || generation !== accountLoadGenerationRef.current) return;
        googleFinalizeInFlightRef.current = false;
        if (verifyingAuthorization) clearPendingGoogleDataAction();
        setAccount((current) => ({
          ...current,
          googleAuthorizationVerifying: false,
          googleConnectionLoading: false,
          message: error instanceof Error ? error.message : "No pude leer la cuenta."
        }));
      });
    }

    void refreshAccountState({ preserveKnownGoogleState: false, registerRememberedScopes: true });

    const { data: authListener } = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        accountLoadGenerationRef.current += 1;
        googleFinalizeInFlightRef.current = false;
        currentAccountEmailRef.current = "";
        setAccount(createInitialAccountState(false));
        return;
      }

      const nextEmail = session?.user.email ?? "";
      if ((nextEmail || currentAccountEmailRef.current) && !googleFinalizeInFlightRef.current) {
        void refreshAccountState({ preserveKnownGoogleState: true, registerRememberedScopes: false });
      }
    }) ?? { data: { subscription: null } };

    return () => {
      mounted = false;
      accountLoadGenerationRef.current += 1;
      authListener.subscription?.unsubscribe();
    };
  }, []);

  if (view === "google-onboarding") {
    return (
      <div className="account-page onboarding-google-account">
        <GoogleImportSection
          account={account}
          includeOtherSources={false}
          includeVCard
          redirectPath="/onboarding/google"
          setAccount={setAccount}
        />
      </div>
    );
  }

  return (
    <div className="account-page">
      <section className="page-heading">
        <h1>Cuenta</h1>
      </section>

      <section className="account-section" aria-labelledby="account-profile-title">
        <div className="account-section-title">
          <h2 id="account-profile-title">Tu cuenta</h2>
        </div>
        <div className="account-inline-list">
          <div>
            <span>Usuario</span>
            <strong>{account.email || "Sesión activa"}</strong>
          </div>
          <div>
            <span>Plan</span>
            <strong>Beta personal</strong>
          </div>
          <Button icon="settings" onClick={() => window.alert("Pendiente: cambio de plan.")}>
            Cambiar plan
          </Button>
        </div>
        <StartingPointFields
          mode="account"
          onSaved={(values) => setAccount((current) => ({
            ...current,
            networkingStartReady: Boolean(values.networkingStartDate)
          }))}
        />
      </section>

      {isOnboardingTestResetAvailable() ? (
        <section className="account-section" aria-labelledby="account-development-title">
          <div className="account-section-title">
            <h2 id="account-development-title">Herramientas de desarrollo</h2>
          </div>
          <div className="toolbar">
            <Button onClick={() => void onboarding.resetForDevelopment()} tone="ghost">
              Reiniciar onboarding de prueba
            </Button>
          </div>
          {onboarding.error ? <p className="form-error" role="alert">{onboarding.error}</p> : null}
        </section>
      ) : null}

      <GoogleImportSection account={account} includeOtherSources redirectPath="/cuenta" setAccount={setAccount} />

      <section className="account-section" aria-labelledby="account-quality-title">
        <div className="account-section-title">
          <h2 id="account-quality-title">Calidad de datos</h2>
        </div>
        <ContactDuplicateReviewPanel />
      </section>

      <section className="account-section" aria-labelledby="account-privacy-title">
        <div className="account-section-title">
          <h2 id="account-privacy-title">Datos y privacidad</h2>
        </div>
        <div className="account-danger-list">
          <div className="account-danger-row">
            <div>
              <strong>Reiniciar datos</strong>
              <span>Borra contactos, interacciones, objetivos, sugerencias, conexiones, logs y configuración personal. Conserva usuario y plan.</span>
            </div>
            <Button
              disabled={account.resettingData}
              icon="trash"
              onClick={() => resetMyAppData(setAccount)}
              tone="danger"
            >
              {account.resettingData ? "Reiniciando..." : "Reiniciar datos"}
            </Button>
          </div>
          <div className="account-danger-row">
            <div>
              <strong>Eliminar cuenta</strong>
              <span>Pendiente de política final de conservación y anonimizado.</span>
            </div>
            <Button
              icon="trash"
              onClick={() => window.alert("Pendiente: definir borrado, conservacion y anonimizado antes de activar esta accion.")}
              tone="danger"
            >
              Borrar cuenta
            </Button>
          </div>
        </div>
      </section>

      {onSignOut ? (
        <section className="account-section" aria-labelledby="account-session-title">
          <div className="account-section-title">
            <h2 id="account-session-title">Sesión</h2>
            <span>Finaliza la sesión actual de Coffeecito en este dispositivo.</span>
          </div>
          <div className="toolbar">
            <Button icon="close" onClick={onSignOut} tone="ghost">
              Cerrar sesión
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function GoogleImportSection({
  account,
  includeOtherSources,
  includeVCard = false,
  redirectPath,
  setAccount
}: {
  account: AccountState;
  includeOtherSources: boolean;
  includeVCard?: boolean;
  redirectPath: "/cuenta" | "/onboarding/google";
  setAccount: Dispatch<SetStateAction<AccountState>>;
}) {
  const googleServices = googleServiceAvailability(account);
  const contactsEligibility = googleIntegrationAvailability(account, "contacts");
  const emailEligibility = googleIntegrationAvailability(account, "email");
  const calendarEligibility = googleIntegrationAvailability(account, "calendar");
  const syncPreferences = useInteractionSyncPreferences();
  const [resumeAction, setResumeAction] = useState<GoogleDataAuthorizationIntent | null>(null);

  useEffect(() => {
    if (syncPreferences.loading || !account.googleConnectionKnown) return;
    const pendingAction = readPendingGoogleDataAction();
    if (!pendingAction) return;
    const oauthReturn = readGoogleDataConnectionReturn(window.location.href);
    if (oauthReturn.status !== "completed") {
      if (oauthReturn.status === "invalid") {
        clearPendingGoogleDataAction();
        if (pendingAction === "import_gmail_history") {
          setResumeAction(pendingAction);
          setAccount((current) => ({
            ...current,
            message: "Gmail no quedó autorizado. Puedes reintentar desde Seleccionar correos."
          }));
        }
      }
      return;
    }
    if (account.googleConnectionLoading || account.googleAuthorizationVerifying) return;
    if (!account.googleSyncEligibilityKnown) return;
    const operation = googleDataAuthorizationOperation(pendingAction);
    if (!account.googleSyncEligibility[operation]) {
      clearPendingGoogleDataAction();
      setResumeAction(null);
      setAccount((current) => ({
        ...current,
        message: "Esta integración de Google todavía no está disponible para tu cuenta."
      }));
      return;
    }
    const capability = googleDataAuthorizationCapability(pendingAction);
    const capabilityAvailable = capability === "gmail" ? googleServices.mail : googleServices[capability];
    if (!capabilityAvailable) {
      clearPendingGoogleDataAction();
      if (pendingAction === "import_gmail_history") setResumeAction(pendingAction);
      setAccount((current) => ({
        ...current,
        message: "Google no confirmó el permiso necesario. La acción no se completó."
      }));
      return;
    }

    clearPendingGoogleDataAction();
    if (pendingAction === "import_contacts" || pendingAction === "import_gmail_history") {
      setResumeAction(pendingAction);
      return;
    }

    const pendingService: InteractionSyncService = pendingAction === "enable_gmail_sync" ? "gmail" : "calendar";
    let active = true;
    void syncPreferences.setServiceEnabled(pendingService, true)
      .then(() => {
        if (!active) return;
        setAccount((current) => ({ ...current, message: "Preferencia de sincronización activada." }));
      })
      .catch(() => {
        if (!active) return;
        setAccount((current) => ({
          ...current,
          message: "No pude activar la sincronización. La preferencia permanece desactivada."
        }));
      });
    return () => {
      active = false;
    };
  }, [
    account.googleAuthorizationVerifying,
    account.googleConnectionKnown,
    account.googleConnectionLoading,
    account.googleSyncEligibility,
    account.googleSyncEligibilityKnown,
    googleServices.calendar,
    googleServices.contacts,
    googleServices.mail,
    setAccount,
    syncPreferences.loading,
    syncPreferences.setServiceEnabled
  ]);

  async function changeSyncPreference(service: InteractionSyncService, enabled: boolean) {
    const operation = service === "gmail" ? "email" : "calendar";
    if (enabled && !account.googleSyncEligibility[operation]) {
      setAccount((current) => ({
        ...current,
        message: "Esta integración de Google todavía no está disponible para tu cuenta."
      }));
      return;
    }
    if (enabled && !account.googleDataAuthorizationAllowed) {
      setAccount((current) => ({ ...current, message: GOOGLE_DATA_SESSION_REQUIRED_MESSAGE }));
      return;
    }
    const capabilityAvailable = service === "gmail" ? googleServices.mail : googleServices.calendar;
    const action = interactionSyncToggleAction({ capabilityAvailable, enabled });
    if (action === "disable" || action === "enable") {
      try {
        await syncPreferences.setServiceEnabled(service, enabled);
      } catch {
        // The provider restores the previous value and exposes the persistence error.
      }
      return;
    }

    setAccount((current) => ({ ...current, message: "Abriendo autorización de Google..." }));
    try {
      await beginGoogleDataAuthorization(
        service === "gmail" ? "enable_gmail_sync" : "enable_calendar_sync",
        `${window.location.origin}/cuenta`
      );
    } catch (error) {
      setAccount((current) => ({
        ...current,
        message: error instanceof Error ? error.message : "No pude abrir la autorización de Google."
      }));
    }
  }

  return (
    <section className="account-section account-section-primary" aria-labelledby="account-import-title">
      <div className="account-section-title">
        <h2 id="account-import-title">Importación y sincronización</h2>
        <span>Fuentes desde las que Coffeecito puede leer datos para tu networking.</span>
      </div>

      <section className="account-data-group" aria-labelledby="account-import-data-title">
        <h3 id="account-import-data-title">Importar datos</h3>
        <div className={`account-data-grid ${includeOtherSources ? "" : "single"}`}>
          <AccountDataBlock title="Contactos">
            <div className="account-data-options">
              {includeOtherSources || includeVCard ? (
                <VCardImportPanel
                  actionLabel="Importar archivo vCard"
                  compactAction={includeOtherSources}
                  description={includeOtherSources ? "Selecciona un archivo de contactos." : undefined}
                  sourceLabel="vCard (.vcf)"
                />
              ) : null}
              {contactsEligibility === "enabled" ? (
                <GoogleContactsSyncPanel
                  authorizationRedirectPath={redirectPath}
                  compact
                  googleAccessToken={account.googleAccessToken}
                  googleCapabilityAvailable={googleServices.contacts}
                  googleConnectionLoading={account.googleConnectionLoading || account.googleAuthorizationVerifying}
                  googleDisabledReason={googleImportDisabledReason(account, "contacts")}
                  iconOnlyActions={includeOtherSources}
                  onResumeImportHandled={() => setResumeAction(null)}
                  registerRememberedScopes={false}
                  resumeImport={resumeAction === "import_contacts"}
                />
              ) : (
                <SourcePlaceholder
                  provider="google"
                  status={googlePlaceholderStatus(contactsEligibility)}
                  title="Google Contacts"
                />
              )}
              {includeOtherSources ? (
                <>
                  <SourcePlaceholder provider="apple" title="Apple Contacts" />
                  <SourcePlaceholder provider="microsoft" title="Microsoft Contacts" />
                </>
              ) : null}
            </div>
          </AccountDataBlock>

          {includeOtherSources ? (
            <AccountDataBlock title="Citas">
              {isIcsImportEnabled()
                ? <IcsImportPanel />
                : <SourcePlaceholder icon="file" title="iCalendar (.ics)" />}
            </AccountDataBlock>
          ) : null}

          {includeOtherSources ? (
            <AccountDataBlock title="Correos">
              {emailEligibility === "enabled" ? (
                <GoogleInteractionsSyncPanel
                  authorizationRedirectPath={redirectPath}
                  compact
                  googleAccessToken={account.googleAccessToken}
                  googleCalendarAvailable={googleServices.calendar}
                  googleConnected={account.googleConnected}
                  googleConnectionLoading={account.googleConnectionLoading || account.googleAuthorizationVerifying}
                  googleMailAvailable={googleServices.mail}
                  onResumeMailImportHandled={() => setResumeAction(null)}
                  registerRememberedScopes={false}
                  calendarDisabledReason={googleImportDisabledReason(account, "calendar")}
                  mailDisabledReason={googleImportDisabledReason(account, "mail")}
                  networkingStartReady={account.networkingStartReady}
                  resumeMailImport={resumeAction === "import_gmail_history"}
                  showCalendarAction={false}
                />
              ) : (
                <SourcePlaceholder
                  provider="gmail"
                  status={googlePlaceholderStatus(emailEligibility)}
                  title="Gmail"
                />
              )}
            </AccountDataBlock>
          ) : null}
        </div>
      </section>

      {includeOtherSources ? (
        <section className="account-data-group" aria-labelledby="account-auto-sync-title">
          <h3 id="account-auto-sync-title">Sincronización automática</h3>
          <div className="account-provider-sync-grid">
            <section className="account-data-block account-provider-sync-block" aria-label="Google">
              <div className="account-provider-sync-heading">
                <span className="connected-service-logo active"><ProviderIcon name="google" /></span>
                <strong>Google</strong>
              </div>
              <div className="account-provider-sync-options">
                {calendarEligibility === "enabled" ? (
                  <InteractionSyncPreferenceToggle
                    checked={syncPreferences.preferences.calendarEnabled}
                    description={!account.googleDataAuthorizationAllowed
                      ? "No disponible para esta sesión"
                      : googleServices.calendar ? "Autorizado" : "Requiere autorización"}
                    disabled={syncPreferences.loading || syncPreferences.saving || account.googleAuthorizationVerifying || !account.googleDataAuthorizationAllowed}
                    icon="calendar"
                    label="Citas de Google Calendar"
                    onChange={(enabled) => void changeSyncPreference("calendar", enabled)}
                  />
                ) : (
                  <SourcePlaceholder
                    provider="googleCalendar"
                    status={googlePlaceholderStatus(calendarEligibility)}
                    title="Google Calendar"
                  />
                )}
                {emailEligibility === "enabled" ? (
                  <InteractionSyncPreferenceToggle
                    checked={syncPreferences.preferences.gmailEnabled}
                    description={!account.googleDataAuthorizationAllowed
                      ? "No disponible para esta sesión"
                      : googleServices.mail ? "Autorizado" : "Requiere autorización"}
                    disabled={syncPreferences.loading || syncPreferences.saving || account.googleAuthorizationVerifying || !account.googleDataAuthorizationAllowed}
                    icon="mail"
                    label="Correos de Gmail"
                    onChange={(enabled) => void changeSyncPreference("gmail", enabled)}
                  />
                ) : (
                  <SourcePlaceholder
                    provider="gmail"
                    status={googlePlaceholderStatus(emailEligibility)}
                    title="Gmail"
                  />
                )}
              </div>
            </section>
          </div>
          {!account.googleDataAuthorizationAllowed ? (
            <p className="connected-service-action-reason">{GOOGLE_DATA_SESSION_REQUIRED_MESSAGE}</p>
          ) : null}
          {syncPreferences.error ? <p className="form-error" role="alert">{syncPreferences.error}</p> : null}
        </section>
      ) : null}

      {account.message ? <p className="meta">{account.message}</p> : null}
    </section>
  );
}

function AccountDataBlock({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="account-data-block" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function InteractionSyncPreferenceToggle({
  checked,
  description,
  disabled,
  icon,
  label,
  onChange
}: {
  checked: boolean;
  description: string;
  disabled: boolean;
  icon: IconName;
  label: string;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="account-sync-preference" title={label}>
      <span className="account-sync-preference-service">
        <span className="account-data-type-icon"><Icon name={icon} /></span>
        <span>
          <strong>{label}</strong>
          <small>{description}</small>
        </span>
      </span>
      <input
        aria-label={`${label}: ${checked ? "activado" : "desactivado"}`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        role="switch"
        type="checkbox"
      />
    </label>
  );
}

function SourcePlaceholder({
  icon,
  provider,
  status = "Próximamente",
  title
}: {
  icon?: IconName;
  provider?: ProviderIconName;
  status?: string;
  title: string;
}) {
  return (
    <div aria-disabled="true" className="account-source-row account-source-placeholder">
      <div className="account-source-main">
        <span className="connected-service-logo">
          {provider ? <ProviderIcon name={provider} /> : <Icon name={icon ?? "link"} />}
        </span>
        <div>
          <strong>{title}</strong>
        </div>
      </div>
      <span className="account-source-status">{status}</span>
    </div>
  );
}

function googleImportDisabledReason(
  account: AccountState,
  service: "calendar" | "contacts" | "mail"
) {
  if (account.googleAuthorizationVerifying) return "Estamos verificando la autorización de Google.";
  if (account.googleConnectionLoading && !account.googleConnectionKnown) return "Revisando autorización de Google.";
  if (!account.googleDataAuthorizationAllowed) return GOOGLE_DATA_SESSION_REQUIRED_MESSAGE;
  if ((service === "calendar" || service === "mail") && !account.networkingStartReady) {
    return "Define primero la fecha de inicio de networking.";
  }
  return "";
}

function googleServiceAvailability(account: AccountState) {
  return {
    calendar: Boolean(account.googlePermissionActive && googleAccountHasCapability(account.googleAccount, "calendar")),
    contacts: Boolean(account.googlePermissionActive && googleAccountHasCapability(account.googleAccount, "contacts")),
    mail: Boolean(account.googlePermissionActive && googleAccountHasCapability(account.googleAccount, "gmail"))
  };
}

async function loadAccountState(options: { registerRememberedScopes: boolean }): Promise<AccountState> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  const email = data.session?.user.email ?? "";
  const googleDataAuthorizationAllowed = googleDataSessionEligibility(data.session?.user).allowed;
  let message = "";

  let googleConnection: GoogleConnectionState | null = null;
  let googleSyncEligibility = emptyGoogleSyncEligibility();
  let googleSyncEligibilityKnown = false;
  let networkingStartReady = false;
  try {
    const [nextGoogleConnection, networkingStart] = await Promise.all([
      readCurrentGoogleConnectionState({
        registerRememberedScopes: options.registerRememberedScopes
      }),
      readNetworkingStartIso()
    ]);
    googleConnection = nextGoogleConnection;
    networkingStartReady = Boolean(networkingStart);
  } catch (error) {
    message = error instanceof Error ? error.message : "No pude leer cuentas conectadas.";
  }

  try {
    const [contacts, email, calendar] = await Promise.all([
      readGoogleOAuthOperationEligibility("contacts"),
      readGoogleOAuthOperationEligibility("email"),
      readGoogleOAuthOperationEligibility("calendar")
    ]);
    googleSyncEligibility = { calendar, contacts, email };
    googleSyncEligibilityKnown = true;
  } catch {
    message = message || "No pudimos verificar la disponibilidad de las integraciones de Google.";
  }

  const activeGoogle = googleConnection?.account ?? null;
  return {
    email,
    googleAccount: activeGoogle,
    googleAccessToken: googleConnection?.accessToken ?? "",
    googleConnected: Boolean(activeGoogle),
    googleConnectionKnown: true,
    googleAuthorizationVerifying: false,
    googleDataAuthorizationAllowed,
    googleConnectionLoading: false,
    googlePermissionActive: Boolean(activeGoogle && googleConnection?.permissionActive),
    googleSyncEligibility,
    googleSyncEligibilityKnown,
    message,
    networkingStartReady,
    resettingData: false
  };
}

function createInitialAccountState(googleConnectionLoading: boolean): AccountState {
  return {
    email: "",
    googleAccount: null,
    googleAccessToken: "",
    googleConnected: false,
    googleConnectionKnown: false,
    googleAuthorizationVerifying: false,
    googleDataAuthorizationAllowed: false,
    googleConnectionLoading,
    googlePermissionActive: false,
    googleSyncEligibility: emptyGoogleSyncEligibility(),
    googleSyncEligibilityKnown: false,
    message: "",
    networkingStartReady: false,
    resettingData: false
  };
}

type GoogleIntegrationAvailability = "enabled" | "loading" | "unavailable";

function googleIntegrationAvailability(
  account: AccountState,
  operation: ConnectedSyncOperation
): GoogleIntegrationAvailability {
  if (!account.googleSyncEligibilityKnown) {
    return account.googleConnectionLoading ? "loading" : "unavailable";
  }
  return account.googleSyncEligibility[operation] ? "enabled" : "unavailable";
}

function googlePlaceholderStatus(availability: GoogleIntegrationAvailability) {
  return availability === "loading" ? "Revisando..." : availability === "unavailable" ? "Próximamente" : "";
}

function emptyGoogleSyncEligibility(): Record<ConnectedSyncOperation, boolean> {
  return { calendar: false, contacts: false, email: false };
}

function isGoogleDataConnectionReturn() {
  if (typeof window === "undefined") return false;
  return readGoogleDataConnectionReturn(window.location.href).status !== "none";
}

function googleAccountHasCapability(account: ConnectedAccountRecord | null, capability: "calendar" | "contacts" | "gmail") {
  if (!account) return false;
  const capabilityKey = `${capability}_read` as const;
  return Boolean(account.capabilities?.[capabilityKey]);
}

async function resetMyAppData(setAccount: Dispatch<SetStateAction<AccountState>>) {
  const warningAccepted = window.confirm(
    "Esto borrara tus contactos, interacciones, objetivos, sugerencias, conexiones, logs y configuracion personal dentro de la app. No borra tu usuario ni tu plan. Continuar?"
  );
  if (!warningAccepted) return;

  const confirmation = window.prompt('Para confirmar, escribe exactamente: BORRAR MIS DATOS');
  if (confirmation !== "BORRAR MIS DATOS") return;

  setAccount((current) => ({ ...current, message: "", resettingData: true }));
  try {
    const result = await resetCurrentUserAppData(confirmation);
    clearRememberedGoogleRequestedScopes();
    const deletedRows = result.reduce((total, row) => total + row.deletedRowCount, 0);
    window.alert(`Datos reiniciados. Se borraron ${deletedRows} registros de tu espacio de trabajo.`);
    window.location.reload();
  } catch (error) {
    setAccount((current) => ({
      ...current,
      message: error instanceof Error ? error.message : "No pude reiniciar tus datos.",
      resettingData: false
    }));
  }
}
