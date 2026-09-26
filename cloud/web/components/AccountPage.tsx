"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { GOOGLE_CONTACTS_READONLY_SCOPE } from "../lib/googleContactsClient";
import { GOOGLE_INTERACTIONS_READONLY_SCOPES } from "../lib/googleInteractionClient";
import { GOOGLE_AUTH_LOGIN_SCOPES } from "../lib/googleAuthSession";
import { resetCurrentUserAppData } from "../lib/accountDataActions";
import {
  disconnectConnectedAccount,
  readCurrentGoogleConnectionState,
  type ConnectedAccountRecord,
  type GoogleConnectionState
} from "../lib/connectedAccounts";
import {
  clearRememberedGoogleRequestedScopes,
  readGoogleDataConnectionReturn,
  reconnectGoogle
} from "../lib/googleAuthSession";
import { readNetworkingStartIso } from "../lib/syncDate";
import { isOnboardingTestResetAvailable } from "../lib/onboarding";
import { googleConnectionRevalidationUi } from "../lib/accountGoogleConnectionUi";
import { supabase } from "../lib/supabaseClient";
import { ContactDuplicateReviewPanel } from "./ContactDuplicateReviewPanel";
import { GoogleContactsSyncPanel } from "./GoogleContactsSyncPanel";
import { GoogleInteractionsSyncPanel } from "./GoogleInteractionsSyncPanel";
import { NetworkingStartDateSetting } from "./NetworkingStartDateSetting";
import { useOnboarding } from "./OnboardingProvider";
import { Button } from "./ui/Button";
import { ProviderIcon, type ProviderIconName } from "./ui/ProviderIcon";

type AccountState = {
  email: string;
  googleAccount: ConnectedAccountRecord | null;
  googleAccessToken: string;
  googleConnected: boolean;
  googleConnectionKnown: boolean;
  googleConnectionLoading: boolean;
  googleAuthorizationVerifying: boolean;
  googlePermissionActive: boolean;
  message: string;
  networkingStartReady: boolean;
  resettingData: boolean;
  provider: ProviderIconName;
};

export function AccountPage({ view = "full" }: { view?: "full" | "google-onboarding" } = {}) {
  const onboarding = useOnboarding();
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
      </section>

      <section className="account-section" aria-labelledby="account-access-title">
        <div className="account-section-title">
          <h2 id="account-access-title">Acceso a Coffeecito</h2>
        </div>
        <div className="account-provider-list">
          <ProviderAccessRow provider="google" label="Google" status={account.provider === "google" ? "En uso" : "Disponible"} />
          <ProviderAccessRow provider="mail" label="Email por link" status={account.provider === "google" ? "Disponible" : "En uso"} />
          <ProviderAccessRow provider="microsoft" label="Microsoft" status="Próximamente" muted />
          <ProviderAccessRow provider="apple" label="Apple" status="Próximamente" muted />
        </div>
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
    </div>
  );
}

function GoogleImportSection({
  account,
  includeOtherSources,
  redirectPath,
  setAccount
}: {
  account: AccountState;
  includeOtherSources: boolean;
  redirectPath: "/cuenta" | "/onboarding/google";
  setAccount: Dispatch<SetStateAction<AccountState>>;
}) {
  const activeGoogle = account.googleAccount;
  const googleServices = googleServiceAvailability(account);
  const googleAuthorizationStatus = googleAuthorizationSummary(account, googleServices);

  return (
    <section className="account-section account-section-primary" aria-labelledby="account-import-title">
      <div className="account-section-title">
        <h2 id="account-import-title">Importación y sincronización</h2>
        <span>Fuentes desde las que Coffeecito puede leer datos para tu networking.</span>
      </div>

      <NetworkingStartDateSetting onSaved={() => setAccount((current) => ({ ...current, networkingStartReady: true }))} />

      <div className="account-source-list">
        <div className="account-source-row expanded">
          <div className="account-source-main">
            <span className={`connected-service-logo ${googleAuthorizationStatus.authorized ? "active" : ""}`}>
              <ProviderIcon name="google" />
            </span>
            <div>
              <strong>Google</strong>
              <span>{googleAuthorizationStatus.label}</span>
              {activeGoogle?.accountEmail ? <small>{activeGoogle.accountEmail}</small> : null}
            </div>
          </div>
          <div className="connected-service-head-actions account-source-actions">
            <Button
              disabled={account.googleConnectionLoading || account.googleAuthorizationVerifying}
              icon="link"
              onClick={() => void connectGoogle(redirectPath)}
              tone="secondary"
            >
              {googleAuthorizationActionLabel(account)}
            </Button>
            {activeGoogle ? (
              <Button icon="close" onClick={() => disconnectGoogle(activeGoogle.id)} tone="ghost">
                Desconectar
              </Button>
            ) : null}
          </div>

          <div className="connected-service-permissions" aria-label="Servicios Google disponibles">
            <ServiceCapability label="Contactos" available={googleServices.contacts} />
            <ServiceCapability label="Correos" available={googleServices.mail} />
            <ServiceCapability label="Calendario" available={googleServices.calendar} />
          </div>

          <div className="connected-service-actions">
            <GoogleContactsSyncPanel
              compact
              googleAccessToken={account.googleAccessToken}
              googleCapabilityAvailable={googleServices.contacts}
              googleConnected={account.googleConnected}
              googleConnectionLoading={account.googleConnectionLoading || account.googleAuthorizationVerifying}
              googleDisabledReason={googleImportDisabledReason(account, googleServices.contacts, "contacts")}
              registerRememberedScopes={false}
            />
            <GoogleInteractionsSyncPanel
              compact
              googleAccessToken={account.googleAccessToken}
              googleCalendarAvailable={googleServices.calendar}
              googleConnected={account.googleConnected}
              googleConnectionLoading={account.googleConnectionLoading || account.googleAuthorizationVerifying}
              googleMailAvailable={googleServices.mail}
              registerRememberedScopes={false}
              calendarDisabledReason={googleImportDisabledReason(account, googleServices.calendar, "calendar")}
              mailDisabledReason={googleImportDisabledReason(account, googleServices.mail, "mail")}
              networkingStartReady={account.networkingStartReady}
            />
          </div>
        </div>

        {includeOtherSources ? (
          <>
            <SourcePlaceholder provider="microsoft" title="Microsoft" detail="Importación desde Outlook y Microsoft Calendar." />
            <SourcePlaceholder provider="apple" title="Apple" detail="Importación desde Apple Contacts y Calendar." />
            <div className="account-source-row">
              <div className="account-source-main">
                <span className="connected-service-logo">
                  <ProviderIcon name="apple" />
                </span>
                <div>
                  <strong>vCard (.vcf)</strong>
                  <span>Compatible con exportaciones de Google, Apple Contacts, Outlook y otros servicios.</span>
                </div>
              </div>
              <span className="account-source-status">Próximamente</span>
            </div>
          </>
        ) : null}
      </div>

      {account.message ? <p className="meta">{account.message}</p> : null}
    </section>
  );
}

function ProviderAccessRow({
  provider,
  label,
  muted = false,
  status
}: {
  provider: ProviderIconName | "mail";
  label: string;
  muted?: boolean;
  status: string;
}) {
  return (
    <div className={`account-provider-row ${muted ? "muted" : ""}`}>
      <span className="account-provider-name">
        {provider === "mail" ? null : <ProviderIcon name={provider} />}
        <strong>{label}</strong>
      </span>
      <span>{status}</span>
    </div>
  );
}

function ServiceCapability({ available, label }: { available: boolean; label: string }) {
  return (
    <span className={`connected-service-pill ${available ? "active" : "inactive"}`}>
      {available ? "✓" : "✕"} {label}
    </span>
  );
}

function SourcePlaceholder({ detail, provider, title }: { detail: string; provider: ProviderIconName; title: string }) {
  return (
    <div className="account-source-row">
      <div className="account-source-main">
        <span className="connected-service-logo">
          <ProviderIcon name={provider} />
        </span>
        <div>
          <strong>{title}</strong>
          <span>{detail}</span>
        </div>
      </div>
      <span className="account-source-status">Próximamente</span>
    </div>
  );
}

function providerIconName(provider: unknown): ProviderIconName {
  if (provider === "apple" || provider === "microsoft") return provider;
  return "google";
}

function googleAuthorizationSummary(account: AccountState, services: ReturnType<typeof googleServiceAvailability>) {
  if (account.googleAuthorizationVerifying) {
    return { authorized: Boolean(account.googleConnected), label: "Verificando autorización..." };
  }
  if (account.googleConnectionLoading && !account.googleConnectionKnown) {
    return { authorized: false, label: "Revisando conexión" };
  }
  if (!account.googleConnected || !account.googlePermissionActive) {
    return {
      authorized: false,
      label: "Autoriza Google para importar contactos, correos y calendario."
    };
  }
  if (!services.contacts || !services.mail || !services.calendar) {
    return { authorized: true, label: "Autorización parcial" };
  }
  return { authorized: true, label: "Autorizado" };
}

function googleAuthorizationActionLabel(account: AccountState) {
  if (account.googleAuthorizationVerifying) return "Verificando...";
  if (!account.googleConnected || !account.googlePermissionActive) return "Autorizar Google";
  return googlePermissionScopeCount(account.googleAccount) < 3 ? "Actualizar autorización" : "Renovar autorización";
}

function googleImportDisabledReason(
  account: AccountState,
  serviceAvailable: boolean,
  service: "calendar" | "contacts" | "mail"
) {
  if (account.googleAuthorizationVerifying) return "Estamos verificando la autorización de Google.";
  if (account.googleConnectionLoading && !account.googleConnectionKnown) return "Revisando autorización de Google.";
  if (!account.googleConnected || !account.googleAccessToken) return "Autoriza Google para importar.";
  if (!serviceAvailable) return "Actualiza la autorización de Google para habilitar este servicio.";
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

async function connectGoogle(redirectPath: "/cuenta" | "/onboarding/google") {
  await reconnectGoogle(googleRequiredScopes(), `${window.location.origin}${redirectPath}`);
}

async function disconnectGoogle(accountId: string) {
  if (!window.confirm("Desvincular Google en la app? No borra contactos, correos ni citas ya importados.")) return;
  clearRememberedGoogleRequestedScopes();
  await disconnectConnectedAccount(accountId);
  window.location.reload();
}

async function loadAccountState(options: { registerRememberedScopes: boolean }): Promise<AccountState> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  const provider = providerIconName(
    data.session?.user.app_metadata?.provider ?? data.session?.user.identities?.[0]?.provider
  );
  const email = data.session?.user.email ?? "";
  let message = "";

  let googleConnection: GoogleConnectionState | null = null;
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

  const activeGoogle = googleConnection?.account ?? null;
  return {
    email,
    googleAccount: activeGoogle,
    googleAccessToken: googleConnection?.accessToken ?? "",
    googleConnected: Boolean(activeGoogle),
    googleConnectionKnown: true,
    googleAuthorizationVerifying: false,
    googleConnectionLoading: false,
    googlePermissionActive: Boolean(activeGoogle && googleConnection?.permissionActive),
    message,
    networkingStartReady,
    resettingData: false,
    provider
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
    googleConnectionLoading,
    googlePermissionActive: false,
    message: "",
    networkingStartReady: false,
    resettingData: false,
    provider: "google"
  };
}

function isGoogleDataConnectionReturn() {
  if (typeof window === "undefined") return false;
  return readGoogleDataConnectionReturn(window.location.href).status !== "none";
}

function googleRequiredScopes() {
  return [
    ...GOOGLE_AUTH_LOGIN_SCOPES,
    GOOGLE_CONTACTS_READONLY_SCOPE,
    ...GOOGLE_INTERACTIONS_READONLY_SCOPES.split(" ")
  ];
}

function googleAccountHasCapability(account: ConnectedAccountRecord | null, capability: "calendar" | "contacts" | "gmail") {
  if (!account) return false;
  const capabilityKey = `${capability}_read` as const;
  return Boolean(account.capabilities?.[capabilityKey]);
}

function googlePermissionScopeCount(account: ConnectedAccountRecord | null) {
  if (!account) return 0;
  return (["contacts", "gmail", "calendar"] as const).filter((capability) => googleAccountHasCapability(account, capability)).length;
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
