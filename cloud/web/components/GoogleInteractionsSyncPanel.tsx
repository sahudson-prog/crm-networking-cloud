"use client";

import { useEffect, useMemo, useState } from "react";
import { GOOGLE_CONTACTS_READONLY_SCOPE } from "../lib/googleContactsClient";
import {
  GOOGLE_INTERACTIONS_READONLY_SCOPES,
  GoogleInteractionClientError
} from "../lib/googleInteractionClient";
import {
  syncGoogleInteractions,
  type SyncGoogleInteractionsResult
} from "../lib/googleInteractionSyncFlow";
import { readNetworkingStartIso } from "../lib/syncDate";
import { supabase } from "../lib/supabaseClient";
import { Button } from "./ui/Button";
import { ProviderButton } from "./ui/ProviderIcon";

const GOOGLE_ACCOUNT_READONLY_SCOPES = [
  GOOGLE_CONTACTS_READONLY_SCOPE,
  GOOGLE_INTERACTIONS_READONLY_SCOPES
].join(" ");

type GoogleInteractionsState = {
  accessToken: string;
  applying: boolean;
  error: string;
  lastRun: SyncGoogleInteractionsResult | null;
  loading: boolean;
  message: string;
  userEmail: string;
};

const initialState: GoogleInteractionsState = {
  accessToken: "",
  applying: false,
  error: "",
  lastRun: null,
  loading: false,
  message: "",
  userEmail: ""
};

export function GoogleInteractionsSyncPanel() {
  const [state, setState] = useState<GoogleInteractionsState>(initialState);
  const canApplyLastReview = Boolean(state.lastRun && (state.lastRun.mail?.dryRun || state.lastRun.calendar?.dryRun));

  useEffect(() => {
    let active = true;
    supabase?.auth.getSession().then(({ data }) => {
      if (!active) return;
      setState((current) => ({
        ...current,
        accessToken: data.session?.provider_token ?? "",
        userEmail: data.session?.user.email ?? ""
      }));
    });
    return () => {
      active = false;
    };
  }, []);

  const lastRunSummary = useMemo(() => {
    if (!state.lastRun) return null;
    const mail = state.lastRun.mail;
    const calendar = state.lastRun.calendar;
    return {
      calendarCandidates: calendar?.counts.scanned ?? 0,
      calendarCreated: calendar?.counts.created ?? 0,
      calendarScanned: state.lastRun.googleRead.calendarEvents,
      calendarUpdated: calendar?.counts.updated ?? 0,
      mailCandidates: mail?.counts.scanned ?? 0,
      mailCreated: mail?.counts.created ?? 0,
      mailScanned: state.lastRun.googleRead.mailMessages,
      mailUpdated: mail?.counts.updated ?? 0,
      participants: (mail?.counts.participantsInserted ?? 0) + (calendar?.counts.participantsInserted ?? 0),
      skipped: (mail?.counts.skipped ?? 0) + (calendar?.counts.skipped ?? 0)
    };
  }, [state.lastRun]);

  async function connectGoogle() {
    if (!supabase) {
      setState((current) => ({ ...current, error: "Supabase no esta configurado." }));
      return;
    }

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/cuenta`,
        scopes: GOOGLE_ACCOUNT_READONLY_SCOPES
      }
    });
  }

  async function reviewInteractions() {
    await runSync(true);
  }

  async function applyInteractions() {
    await runSync(false);
  }

  async function runSync(dryRun: boolean) {
    if (!state.accessToken) {
      setState((current) => ({
        ...current,
        error: "Primero conecta Google para autorizar lectura de correos y calendario."
      }));
      return;
    }

    if (!state.userEmail) {
      setState((current) => ({
        ...current,
        error: "No pude identificar el correo del usuario conectado."
      }));
      return;
    }

    setState((current) => ({
      ...current,
      applying: !dryRun,
      error: "",
      lastRun: dryRun ? null : current.lastRun,
      loading: dryRun,
      message: dryRun ? "Revisando correos y calendario sin guardar cambios..." : "Sincronizando interacciones seleccionadas..."
    }));

    try {
      const historicalStart = await readNetworkingStartIso();
      const result = await syncGoogleInteractions({
        accessToken: state.accessToken,
        calendarTimeMin: historicalStart,
        dryRun,
        forceFullSync: true,
        gmailSince: historicalStart,
        includeCalendar: true,
        includeMail: true,
        maxCalendarEvents: 20,
        maxMailMessages: 20,
        maxPages: 2,
        saveCursors: false,
        userEmail: state.userEmail
      });

      setState((current) => ({
        ...current,
        applying: false,
        error: result.errors.map((error) => error.message).join(" ") || "",
        lastRun: result,
        loading: false,
        message: resultMessage(result, dryRun)
      }));
    } catch (error) {
      if (error instanceof GoogleInteractionClientError && error.code === "GOOGLE_INTERACTIONS_AUTH_REQUIRED") {
        setState((current) => ({
          ...current,
          accessToken: "",
          applying: false,
          error: "El permiso de Google vencio o no incluye Gmail/Calendar. Vuelve a conectar Google.",
          loading: false,
          message: ""
        }));
        return;
      }

      setState((current) => ({
        ...current,
        applying: false,
        error: error instanceof Error ? error.message : "No pude sincronizar correos y calendario.",
        loading: false,
        message: ""
      }));
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Sincronizar correos y calendario</h2>
          <span className="panel-caption">Mantenimiento pesado: reconstruye historial desde la fecha global de inicio.</span>
        </div>
        <div className="toolbar">
          <ProviderButton label={state.accessToken ? "Reconectar Google" : "Conectar Google"} name="google" onClick={connectGoogle} />
          <Button disabled={state.loading || state.applying} icon="sync" onClick={state.accessToken ? reviewInteractions : connectGoogle} tone="primary">
            {state.loading ? "Revisando..." : state.accessToken ? "Revisar historico" : "Conectar Google"}
          </Button>
        </div>
      </div>

      <div className="compact-list">
        <div className="compact-row">
          <strong>Permiso</strong>
          <span>{state.accessToken ? "Google conectado para lectura de Gmail y Calendar." : "Pendiente conectar Google."}</span>
        </div>
        <div className="compact-row">
          <strong>Limite beta</strong>
          <span>Maximo 20 correos, 20 eventos y 2 paginas por revision historica para evitar consumo excesivo.</span>
        </div>
        <div className="compact-row">
          <strong>Aplicacion</strong>
          <span>Primero revisa sin guardar. Esta accion no actualiza cursores incrementales; sirve para reparar o cargar hacia atras.</span>
        </div>
        {lastRunSummary ? (
          <div className="compact-row">
            <strong>Ultima revision</strong>
            <span>
              Gmail: {lastRunSummary.mailScanned} leidos, {lastRunSummary.mailCandidates} compatibles, {lastRunSummary.mailCreated} nuevos, {lastRunSummary.mailUpdated} actualizados. Calendar: {lastRunSummary.calendarScanned} leidos, {lastRunSummary.calendarCandidates} compatibles, {lastRunSummary.calendarCreated} nuevos, {lastRunSummary.calendarUpdated} actualizados. Participantes vinculados: {lastRunSummary.participants}. Omitidos: {lastRunSummary.skipped}.
            </span>
          </div>
        ) : null}
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        <Button disabled={!canApplyLastReview || state.loading || state.applying} icon="check" onClick={applyInteractions} tone="primary">
          {state.applying ? "Aplicando..." : "Aplicar reconstruccion"}
        </Button>
      </div>

      {state.message ? <p className="meta">{state.message}</p> : null}
      {state.lastRun?.warnings.length ? <p className="meta">{state.lastRun.warnings.join(" ")}</p> : null}
      {state.error ? <p className="form-error">{state.error}</p> : null}
    </section>
  );
}

function resultMessage(result: SyncGoogleInteractionsResult, dryRun: boolean) {
  const prefix = dryRun ? "Revision lista sin guardar" : "Sincronizacion aplicada";
  if (!result.ok) return `${prefix}, con errores por revisar.`;
  const scanned = result.googleRead.mailMessages + result.googleRead.calendarEvents;
  const candidates = (result.mail?.counts.scanned ?? 0) + (result.calendar?.counts.scanned ?? 0);
  if (dryRun) return `${prefix}: ${scanned} objetos leidos y ${candidates} compatibles con contactos guardados.`;
  const created = (result.mail?.counts.created ?? 0) + (result.calendar?.counts.created ?? 0);
  const updated = (result.mail?.counts.updated ?? 0) + (result.calendar?.counts.updated ?? 0);
  return `${prefix}: ${scanned} objetos leidos, ${created} nuevos y ${updated} actualizados.`;
}
