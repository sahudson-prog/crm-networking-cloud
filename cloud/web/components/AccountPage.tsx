"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { GOOGLE_CONTACTS_READONLY_SCOPE } from "../lib/googleContactsClient";
import { GOOGLE_INTERACTIONS_READONLY_SCOPES } from "../lib/googleInteractionClient";
import { resetCurrentUserAppData } from "../lib/accountDataActions";
import {
  disconnectConnectedAccount,
  readCurrentGoogleConnectionState,
  readConnectedAccounts,
  type ConnectedAccountRecord
} from "../lib/connectedAccounts";
import {
  clearRememberedGoogleRequestedScopes,
  reconnectGoogle
} from "../lib/googleAuthSession";
import { supabase } from "../lib/supabaseClient";
import { ContactDuplicateReviewPanel } from "./ContactDuplicateReviewPanel";
import { GoogleContactsSyncPanel } from "./GoogleContactsSyncPanel";
import { GoogleInteractionsSyncPanel } from "./GoogleInteractionsSyncPanel";
import { NetworkingStartDateSetting } from "./NetworkingStartDateSetting";
import { Button } from "./ui/Button";
import { ProviderIcon, type ProviderIconName } from "./ui/ProviderIcon";
import { Panel } from "./ui/Panel";

type AccountState = {
  connectedAccounts: ConnectedAccountRecord[];
  email: string;
  googleConnected: boolean;
  googlePermissionActive: boolean;
  message: string;
  resettingData: boolean;
  provider: ProviderIconName;
};

export function AccountPage() {
  const [account, setAccount] = useState<AccountState>({
    connectedAccounts: [],
    email: "",
    googleConnected: false,
    googlePermissionActive: false,
    message: "",
    resettingData: false,
    provider: "google"
  });
  const activeGoogle = account.connectedAccounts.find((connectedAccount) => (
    connectedAccount.provider === "google" && connectedAccount.status === "active"
  ));

  useEffect(() => {
    let active = true;
    loadAccountState()
      .then((nextAccount) => {
        if (active) setAccount(nextAccount);
      })
      .catch((error) => {
        if (!active) return;
        setAccount((current) => ({
          ...current,
          message: error instanceof Error ? error.message : "No pude leer la cuenta."
        }));
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="account-page">
      <section className="page-heading">
        <h1>Cuenta</h1>
      </section>

      <div className="account-grid">
        <Panel title="Perfil y plan">
          <div className="compact-list">
            <div className="compact-row">
              <strong>Usuario</strong>
              <span className="account-login-provider">
                <ProviderIcon name={account.provider} />
                {account.email || "Sesion activa"}
              </span>
            </div>
            <div className="compact-row">
              <strong>Plan</strong>
              <span className="account-plan-row">
                Beta personal
                <Button icon="settings" onClick={() => window.alert("Pendiente: cambio de plan.")}>
                  Cambiar plan
                </Button>
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="Seguridad">
          <div className="compact-list">
            <div className="compact-row">
              <strong>Reiniciar datos</strong>
              <span className="account-plan-row">
                Conserva usuario y plan
                <Button
                  disabled={account.resettingData}
                  icon="trash"
                  onClick={() => resetMyAppData(setAccount)}
                  tone="danger"
                >
                  {account.resettingData ? "Reiniciando..." : "Reiniciar datos"}
                </Button>
              </span>
            </div>
            <div className="compact-row">
              <strong>Eliminar cuenta</strong>
              <span className="account-plan-row">
                Pendiente de politica final
                <Button
                  icon="trash"
                  onClick={() => window.alert("Pendiente: definir borrado, conservacion y anonimizado antes de activar esta accion.")}
                  tone="danger"
                >
                  Borrar cuenta
                </Button>
              </span>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Servicios conectados">
        <div className="connected-service-card">
          <div className="connected-service-head">
            <span className={`connected-service-logo ${account.googleConnected ? "active" : ""}`}>
              <ProviderIcon name="google" />
            </span>
            <div>
              <strong>Google</strong>
              <span>{googleConnectionLabel(account)}</span>
            </div>
            <div className="connected-service-head-actions">
              <Button icon="link" onClick={connectGoogle} tone="secondary">
                {googleConnectionActionLabel(account)}
              </Button>
              {activeGoogle ? (
                <Button icon="close" onClick={() => disconnectGoogle(activeGoogle.id)} tone="ghost">
                  Desvincular
                </Button>
              ) : null}
            </div>
          </div>
          {activeGoogle ? (
            <div className="connected-service-status-grid">
              <span className="connected-service-meta">Cuenta: {activeGoogle.accountEmail || account.email || "Google"}</span>
              <span className="connected-service-meta">
                Permiso: {account.googlePermissionActive ? "activo ahora" : "requiere autorizar acceso"}
              </span>
              <div className="connected-service-permissions" aria-label="Permisos Google conocidos">
                <span className={`connected-service-pill ${googleAccountHasCapability(activeGoogle, "contacts") ? "active" : ""}`}>
                  Contactos
                </span>
                <span className={`connected-service-pill ${googleAccountHasCapability(activeGoogle, "gmail") ? "active" : ""}`}>
                  Correos
                </span>
                <span className={`connected-service-pill ${googleAccountHasCapability(activeGoogle, "calendar") ? "active" : ""}`}>
                  Calendario
                </span>
              </div>
            </div>
          ) : null}
          <p className="connected-service-description">
            Puedes volver a importar contactos, correos y citas desde la fecha de inicio de networking. Calendar tambien mira 3 meses hacia adelante. Te avisaremos si hay datos nuevos o cambios antes de guardar.
          </p>
          {account.message ? <p className="meta">{account.message}</p> : null}
          <div className="connected-service-actions">
            <GoogleContactsSyncPanel compact googleConnected={account.googleConnected} />
            <GoogleInteractionsSyncPanel compact googleConnected={account.googleConnected} />
          </div>
        </div>
      </Panel>

      <section className="account-import-section" aria-label="Configuracion de actividad">
        <NetworkingStartDateSetting />
      </section>

      <ContactDuplicateReviewPanel />
    </div>
  );
}

function providerIconName(provider: unknown): ProviderIconName {
  if (provider === "apple" || provider === "microsoft") return provider;
  return "google";
}

function googleConnectionLabel(account: AccountState) {
  if (!account.googleConnected) return "No vinculado";
  return account.googlePermissionActive ? "Vinculado · permiso activo" : "Vinculado · permiso pendiente";
}

function googleConnectionActionLabel(account: AccountState) {
  if (!account.googleConnected) return "Conectar Google";
  return account.googlePermissionActive ? "Renovar acceso" : "Autorizar acceso";
}

async function connectGoogle() {
  await reconnectGoogle(googleRequiredScopes(), `${window.location.origin}/cuenta`);
}

async function disconnectGoogle(accountId: string) {
  if (!window.confirm("Desvincular Google en la app? No borra contactos, correos ni citas ya importados.")) return;
  clearRememberedGoogleRequestedScopes();
  await disconnectConnectedAccount(accountId);
  window.location.reload();
}

async function loadAccountState(): Promise<AccountState> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  const provider = providerIconName(
    data.session?.user.app_metadata?.provider ?? data.session?.user.identities?.[0]?.provider
  );
  const email = data.session?.user.email ?? "";
  let message = "";

  let connectedAccounts: ConnectedAccountRecord[] = [];
  let googleConnection = null;
  try {
    googleConnection = await readCurrentGoogleConnectionState({ registerRememberedScopes: true });
    connectedAccounts = await readConnectedAccounts("google");
  } catch (error) {
    message = error instanceof Error ? error.message : "No pude leer cuentas conectadas.";
  }

  const activeGoogle = connectedAccounts.find((account) => account.provider === "google" && account.status === "active");
  return {
    connectedAccounts,
    email,
    googleConnected: Boolean(activeGoogle),
    googlePermissionActive: Boolean(activeGoogle && googleConnection?.permissionActive),
    message,
    resettingData: false,
    provider
  };
}

function googleRequiredScopes() {
  return [GOOGLE_CONTACTS_READONLY_SCOPE, ...GOOGLE_INTERACTIONS_READONLY_SCOPES.split(" ")];
}

function googleAccountHasCapability(account: ConnectedAccountRecord, capability: "calendar" | "contacts" | "gmail") {
  const capabilityKey = `${capability}_read`;
  return Boolean(account.capabilities?.[capabilityKey]) || account.scopes.some((scope) => scope.includes(capability));
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
