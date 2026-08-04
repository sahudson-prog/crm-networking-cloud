"use client";

import { useEffect, useMemo, useState } from "react";
import { applyContactSyncPreview, type ApplyContactSyncPreviewResult } from "../lib/contactSyncApply";
import { mergeContactsDeep } from "../lib/contactMergeActions";
import type { ContactMergeResult, ContactMergeSource } from "../lib/contactMerge";
import { GOOGLE_CONTACTS_READONLY_SCOPE, GoogleContactsClientError } from "../lib/googleContactsClient";
import { prepareGoogleContactSyncPreview, type PrepareGoogleContactSyncResult } from "../lib/googleContactSyncFlow";
import { readAllActiveContacts } from "../lib/cloudData";
import type { ContactRow } from "../lib/readModel";
import { supabase } from "../lib/supabaseClient";
import type { SyncPreviewChange } from "../lib/syncOrchestrator";
import { Button } from "./ui/Button";
import { ContactMergeDialog } from "./ContactMergeDialog";
import { ProviderButton } from "./ui/ProviderIcon";
import { SyncPreviewDialog } from "./SyncPreviewDialog";

type GoogleSyncState = {
  accessToken: string;
  applying: boolean;
  loading: boolean;
  error: string;
  message: string;
  preview: PrepareGoogleContactSyncResult | null;
  lastApply: ApplyContactSyncPreviewResult | null;
};

const initialState: GoogleSyncState = {
  accessToken: "",
  applying: false,
  error: "",
  lastApply: null,
  loading: false,
  message: "",
  preview: null
};

export function GoogleContactsSyncPanel() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<GoogleSyncState>(initialState);
  const [mergeContacts, setMergeContacts] = useState<ContactRow[]>([]);
  const [savedDuplicateMergeSources, setSavedDuplicateMergeSources] = useState<ContactMergeSource[] | null>(null);
  const [savedDuplicateMerging, setSavedDuplicateMerging] = useState(false);

  useEffect(() => {
    let active = true;
    supabase?.auth.getSession().then(({ data }) => {
      if (!active) return;
      setState((current) => ({
        ...current,
        accessToken: data.session?.provider_token ?? ""
      }));
    });
    return () => {
      active = false;
    };
  }, []);

  const summary = useMemo(() => {
    const changes = state.preview?.preview ?? [];
    return {
      deleted: changes.filter((change) => change.type === "deleted" || change.type === "deactivated").length,
      consolidated: changes.filter((change) => change.type === "consolidation").length,
      duplicateComplex: changes.filter((change) => change.type === "duplicate_complex").length,
      modified: changes.filter((change) => change.type === "modified").length,
      new: changes.filter((change) => change.type === "new").length,
      unchanged: changes.filter((change) => change.type === "unchanged").length,
      total: changes.length
    };
  }, [state.preview]);

  async function connectGoogle() {
    if (!supabase) {
      setState((current) => ({ ...current, error: "Supabase no esta configurado." }));
      return;
    }

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/cuenta`,
        scopes: GOOGLE_CONTACTS_READONLY_SCOPE
      }
    });
  }

  async function preparePreview(forceFullSync = false) {
    if (!state.accessToken) {
      setState((current) => ({
        ...current,
        error: "Primero conecta Google para autorizar lectura de contactos."
      }));
      return;
    }

    setState((current) => ({
      ...current,
      error: "",
      lastApply: null,
      loading: true,
      message: "",
      preview: null
    }));

    try {
      const preview = await prepareGoogleContactSyncPreview({
        accessToken: state.accessToken,
        forceFullSync,
        maxPages: 5
      });

      setState((current) => ({
        ...current,
        loading: false,
        message: previewMessage(preview),
        preview
      }));
      setOpen(true);
    } catch (error) {
      if (error instanceof GoogleContactsClientError && error.code === "GOOGLE_CONTACTS_AUTH_REQUIRED") {
        setState((current) => ({
          ...current,
          accessToken: "",
          error: "El permiso de Google vencio o no es valido. Vuelve a conectar Google y luego revisa cambios.",
          loading: false
        }));
        return;
      }

      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No pude preparar la sincronizacion de contactos.",
        loading: false
      }));
    }
  }

  async function applyPreview(selectedChanges: SyncPreviewChange[]) {
    const previewBeforeApply = state.preview;
    if (!previewBeforeApply) return;

    setState((current) => ({
      ...current,
      applying: true,
      error: "",
      message: ""
    }));

    try {
      const result = await applyContactSyncPreview({
        changes: selectedChanges,
        cursorAfter: previewBeforeApply.cursorAfter,
        cursorLabel: "",
        provider: "google",
        source: "google_contacts_sync_panel",
        totalPreviewChanges: actionableChangeCount(previewBeforeApply.preview ?? selectedChanges)
      });

      const remainingChanges = remainingPreviewChanges(previewBeforeApply.preview ?? [], selectedChanges);
      setState((current) => ({
        ...current,
        applying: false,
        lastApply: result,
        message: applyMessage(result),
        preview: result.ok && remainingChanges.length
          ? { ...previewBeforeApply, preview: remainingChanges }
          : result.ok
            ? null
            : previewBeforeApply
      }));
      setOpen(result.ok ? hasActionableChanges(remainingChanges) : true);
    } catch (error) {
      setState((current) => ({
        ...current,
        applying: false,
        error: error instanceof Error ? error.message : "No pude aplicar la seleccion."
      }));
    }
  }

  async function openSavedDuplicateMerge(sources: ContactMergeSource[]) {
    setState((current) => ({ ...current, error: "", message: "" }));
    try {
      const rows = await readAllActiveContacts();
      setMergeContacts(rows);
      setSavedDuplicateMergeSources(sources);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No pude cargar contactos guardados para fusionar."
      }));
    }
  }

  async function mergeSavedDuplicates(result: ContactMergeResult, sources: ContactMergeSource[]) {
    const [target, ...sourceContacts] = sources;
    if (!target || !sourceContacts.length) {
      setState((current) => ({ ...current, error: "Elige 2 o 3 contactos guardados para fusionar." }));
      return;
    }

    setSavedDuplicateMerging(true);
    setState((current) => ({ ...current, error: "", message: "" }));
    try {
      await mergeContactsDeep({
        result,
        source: "google_contacts_duplicate_complex",
        sourceContactIds: sourceContacts.map((source) => source.id),
        targetContactId: target.id
      });
      setSavedDuplicateMergeSources(null);
      setState((current) => ({
        ...current,
        message: "Contactos guardados fusionados. Vuelve a revisar cambios para actualizar esta propuesta."
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No pude fusionar estos contactos guardados."
      }));
    } finally {
      setSavedDuplicateMerging(false);
    }
  }

  function handlePrimarySyncClick() {
    if (!state.accessToken) {
      void connectGoogle();
      return;
    }
    void preparePreview(false);
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Sincronizar contactos</h2>
          <span className="panel-caption">Lee cambios desde Google y confirma antes de guardarlos en la app.</span>
        </div>
        <div className="toolbar">
          <ProviderButton label={state.accessToken ? "Reconectar Google" : "Conectar Google"} name="google" onClick={connectGoogle} />
          <Button disabled={state.loading} icon="sync" onClick={handlePrimarySyncClick} tone="primary">
            {state.loading ? "Revisando..." : state.accessToken ? "Revisar cambios" : "Conectar Google"}
          </Button>
        </div>
      </div>

      <div className="compact-list">
        <div className="compact-row">
          <strong>Permiso</strong>
          <span>{state.accessToken ? "Google conectado para lectura de contactos." : "Pendiente conectar Google."}</span>
        </div>
        <div className="compact-row">
          <strong>Aplicacion</strong>
          <span>Solo se guardan los cambios que selecciones. Lo no seleccionado queda pendiente.</span>
        </div>
        {state.preview ? (
          <div className="compact-row">
            <strong>Preview</strong>
            <span>
              {summary.total} revisados: {summary.new} nuevos, {summary.modified} modificaciones, {summary.consolidated} duplicados fusionables, {summary.duplicateComplex} duplicados complejos, {summary.deleted} eliminaciones, {summary.unchanged} sin cambios.
            </span>
          </div>
        ) : null}
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        <Button disabled={!state.accessToken || state.loading} onClick={() => preparePreview(true)}>
          Forzar revision completa
        </Button>
      </div>

      {state.message ? <p className="meta">{state.message}</p> : null}
      {state.lastApply?.warnings.length ? (
        <p className="meta">{state.lastApply.warnings.join(" ")}</p>
      ) : null}
      {state.error ? <p className="form-error">{state.error}</p> : null}

      <SyncPreviewDialog
        applying={state.applying}
        changes={state.preview?.preview ?? []}
        description="Revisa los cambios detectados. Los cambios que no selecciones quedan pendientes para la proxima sincronizacion."
        onApply={applyPreview}
        onClose={() => setOpen(false)}
        onOpenSavedDuplicateMerge={openSavedDuplicateMerge}
        open={open}
        title="Cambios desde Google Contacts"
      />

      <ContactMergeDialog
        availableContacts={mergeContacts}
        description="Fusiona contactos que ya estan guardados en la app. Despues vuelve a revisar cambios para recalcular la importacion."
        note="Al fusionar, las interacciones, referidos, ToDos e IDs externos quedaran asociados al contacto resultante."
        onClose={() => setSavedDuplicateMergeSources(null)}
        onSave={mergeSavedDuplicates}
        open={Boolean(savedDuplicateMergeSources)}
        saveLabel={savedDuplicateMerging ? "Fusionando..." : "Fusionar"}
        saving={savedDuplicateMerging}
        sources={savedDuplicateMergeSources ?? []}
        title="Fusionar duplicados guardados"
      />
    </section>
  );
}

function previewMessage(preview: PrepareGoogleContactSyncResult) {
  const mode = preview.googleRead.mode === "incremental" ? "incremental" : "completa";
  const changes = preview.preview ?? [];
  const actionables = actionableChangeCount(changes);
  const unchanged = changes.filter((change) => change.type === "unchanged").length;
  const warnings = preview.warnings.length ? ` ${preview.warnings.join(" ")}` : "";
  return `Revision ${mode}: ${actionables} cambios detectados y ${unchanged} contactos sin cambios en ${preview.googleRead.pagesRead} pagina(s).${warnings}`;
}

function applyMessage(result: ApplyContactSyncPreviewResult) {
  const cursor = result.cursorSaved ? "cursor actualizado" : "cursor sin actualizar";
  return `Aplicacion terminada: ${result.appliedCount} aplicados, ${result.failedCount} fallidos, ${result.pendingCount} pendientes; ${cursor}.`;
}

function actionableChangeCount(changes: SyncPreviewChange[]) {
  return changes.filter((change) => change.type !== "unchanged").length;
}

function remainingPreviewChanges(changes: SyncPreviewChange[], selectedChanges: SyncPreviewChange[]) {
  const selectedIds = new Set(selectedChanges.map((change) => change.id));
  return changes.filter((change) => change.type === "unchanged" || !selectedIds.has(change.id));
}

function hasActionableChanges(changes: SyncPreviewChange[]) {
  return changes.some((change) => change.type !== "unchanged");
}
