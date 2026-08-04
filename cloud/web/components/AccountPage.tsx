"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { ContactDuplicateReviewPanel } from "./ContactDuplicateReviewPanel";
import { GoogleContactsSyncPanel } from "./GoogleContactsSyncPanel";
import { ProviderButton } from "./ui/ProviderIcon";
import { Panel } from "./ui/Panel";

type AccountState = {
  email: string;
  userId: string;
};

export function AccountPage() {
  const [account, setAccount] = useState<AccountState>({
    email: "",
    userId: ""
  });

  useEffect(() => {
    let active = true;
    supabase?.auth.getSession().then(({ data }) => {
      if (!active) return;
      setAccount({
        email: data.session?.user.email ?? "",
        userId: data.session?.user.id ?? ""
      });
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="account-page">
      <section className="page-heading">
        <p className="panel-caption">Configuracion personal</p>
        <h1>Cuenta</h1>
        <span>Administra tu perfil, plan, conexiones y datos de la copia cloud.</span>
      </section>

      <div className="account-grid">
        <Panel title="Perfil y plan" caption="Estado actual de esta beta">
          <div className="compact-list">
            <div className="compact-row">
              <strong>Usuario</strong>
              <span>{account.email || "Sesion activa"}</span>
            </div>
            <div className="compact-row">
              <strong>Plan</strong>
              <span>Beta personal</span>
            </div>
            <div className="compact-row">
              <strong>Permisos</strong>
              <span>Lectura de servicios conectados; sin escritura sobre Google.</span>
            </div>
          </div>
        </Panel>

        <Panel title="Servicios conectados" caption="Google activo en v1; Apple y Microsoft quedan para v2">
          <div className="provider-sync-group account-provider-row">
            <ProviderButton label="Google Contacts disponible" name="google" />
            <ProviderButton disabled label="Apple proximamente" name="apple" />
            <ProviderButton disabled label="Microsoft proximamente" name="microsoft" />
          </div>
          <div className="compact-list account-service-list">
            <div className="compact-row">
              <strong>Contactos</strong>
              <span>Disponible con revision previa y seleccion de cambios.</span>
            </div>
            <div className="compact-row">
              <strong>Correos y calendario</strong>
              <span>Pendiente de conectar en cloud usando la misma capa de proveedores.</span>
            </div>
          </div>
        </Panel>
      </div>

      <GoogleContactsSyncPanel />

      <ContactDuplicateReviewPanel />

      <div className="account-grid">
        <Panel title="Datos y respaldo" caption="Acciones previstas para operar la cuenta sin depender del proveedor">
          <div className="compact-list">
            <div className="compact-row">
              <strong>Exportar datos</strong>
              <span>Pendiente: descarga completa de contactos, interacciones, referidos y sugerencias.</span>
            </div>
            <div className="compact-row">
              <strong>Importar datos</strong>
              <span>Pendiente: CSV/Excel y nuevas fuentes conectadas.</span>
            </div>
          </div>
        </Panel>

        <Panel title="Seguridad" caption="Acciones delicadas siempre con confirmacion">
          <div className="compact-list">
            <div className="compact-row">
              <strong>ID interno</strong>
              <span>{account.userId ? `${account.userId.slice(0, 8)}...` : "Disponible al iniciar sesion"}</span>
            </div>
            <div className="compact-row">
              <strong>Eliminar cuenta</strong>
              <span>Pendiente: debe borrar o anonimizar datos segun la politica final.</span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
