"use client";

import { useMemo, useState } from "react";
import { readAllActiveContacts } from "../lib/cloudData";
import { applyContactSyncPreview, type ApplyContactSyncPreviewResult } from "../lib/contactSyncApply";
import { syncContacts, type ExternalContactInput, type SyncPreviewChange } from "../lib/syncOrchestrator";
import type { ContactRow } from "../lib/readModel";
import { Button } from "./ui/Button";
import { SyncPreviewDialog } from "./SyncPreviewDialog";

type SandboxState = {
  applying: boolean;
  loading: boolean;
  error: string;
  applyMessage: string;
  contactsLoaded: number;
  changes: SyncPreviewChange[];
  lastApply: ApplyContactSyncPreviewResult | null;
};

const initialState: SandboxState = {
  applying: false,
  applyMessage: "",
  changes: [],
  contactsLoaded: 0,
  error: "",
  lastApply: null,
  loading: false
};

export function ContactSyncPreviewSandbox() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SandboxState>(initialState);

  const changeSummary = useMemo(() => ({
    deleted: state.changes.filter((change) => change.type === "deleted" || change.type === "deactivated").length,
    changed: state.changes.filter((change) => change.type === "modified" || change.type === "consolidation").length,
    new: state.changes.filter((change) => change.type === "new").length
  }), [state.changes]);

  async function buildPreview() {
    setState({ ...initialState, loading: true });
    try {
      const contacts = await readAllActiveContacts();
      const simulation = buildExternalSimulation(contacts);
      const result = await syncContacts({
        appContacts: contacts,
        externalIdToContactId: simulation.externalIdToContactId,
        items: simulation.externalContacts,
        knownExternalValuesByContactId: simulation.knownExternalValuesByContactId,
        mode: "manual_batch",
        provider: "google",
        resourceType: "contacts"
      });

      setState({
        applying: false,
        applyMessage: "",
        changes: result.preview ?? [],
        contactsLoaded: contacts.length,
        error: "",
        lastApply: null,
        loading: false
      });
      setOpen(true);
    } catch (error) {
      setState({
        ...initialState,
        error: error instanceof Error ? error.message : "No pude preparar el preview.",
        loading: false
      });
    }
  }

  async function applyPreview(selectedChanges: SyncPreviewChange[]) {
    setState((current) => ({
      ...current,
      applying: true,
      applyMessage: "",
      error: ""
    }));

    try {
      const result = await applyContactSyncPreview(
        {
          changes: selectedChanges,
          cursorAfter: "sandbox-next-cursor",
          provider: "google",
          source: "design_system_sandbox",
          totalPreviewChanges: actionableChangeCount(state.changes)
        },
        {
          applyChange: async (change) => simulatedContactId(change),
          completeInvocation: async () => undefined,
          createInvocation: async () => "sandbox-invocation",
          failInvocation: async () => undefined,
          getUserId: async () => "sandbox-user",
          saveCursor: async () => undefined
        }
      );

      const remainingChanges = remainingPreviewChanges(state.changes, result.appliedChangeIds);
      setState((current) => ({
        ...current,
        applying: false,
        changes: remainingChanges,
        applyMessage: applyResultMessage(result),
        lastApply: result
      }));
      setOpen(hasActionableChanges(remainingChanges));
    } catch (error) {
      setState((current) => ({
        ...current,
        applying: false,
        error: error instanceof Error ? error.message : "No pude simular la aplicacion del preview."
      }));
    }
  }

  return (
    <>
      <div className="sync-preview-sandbox">
        <div>
          <strong>Sandbox con datos de la app</strong>
          <span className="panel-caption">
            Carga contactos reales, simula una fuente conectada y prueba el aplicador sin escribir datos.
          </span>
        </div>
        <div className="sync-preview-sandbox-actions">
          {state.contactsLoaded ? (
            <span className="meta">
              {state.contactsLoaded} contactos leidos - {changeSummary.new} nuevos - {changeSummary.changed} cambios - {changeSummary.deleted} eliminaciones
            </span>
          ) : null}
          <Button icon="sync" onClick={buildPreview} tone="primary">
            {state.loading ? "Preparando..." : "Simular sync"}
          </Button>
        </div>
        {state.error ? <span className="form-error">{state.error}</span> : null}
        {state.applyMessage ? <span className="meta">{state.applyMessage}</span> : null}
      </div>

      <SyncPreviewDialog
        applying={state.applying}
        changes={state.changes}
        description="Simulacion segura: usa el mismo aplicador real, pero con escritura simulada. Los cambios no seleccionados quedan pendientes."
        feedbackMessage={state.error || state.applyMessage}
        feedbackTone={state.error || state.lastApply?.failedCount ? "error" : "info"}
        onApply={applyPreview}
        onClose={() => setOpen(false)}
        open={open}
        title="Preview de contactos"
      />
    </>
  );
}

function simulatedContactId(change: SyncPreviewChange) {
  const fromApp = metadataString(change, "appContactId");
  if (fromApp) return fromApp;
  const fromConsolidation = metadataString(change, "consolidationTargetContactId");
  if (fromConsolidation) return fromConsolidation;
  return `sandbox-${change.id}`;
}

function applyResultMessage(result: ApplyContactSyncPreviewResult) {
  const cursor = result.cursorSaved ? "cursor avanzado" : "cursor sin avanzar";
  const prefix = result.ok ? "Simulacion aplicada" : "Simulacion parcial";
  return `${prefix}: ${result.appliedCount} aplicados - ${result.failedCount} fallidos - ${result.pendingCount} pendientes - ${cursor}.`;
}

function metadataString(change: SyncPreviewChange, key: string) {
  const value = change.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function remainingPreviewChanges(changes: SyncPreviewChange[], appliedChangeIds: string[]) {
  const appliedIds = new Set(appliedChangeIds);
  return changes.filter((change) => change.type === "unchanged" || !appliedIds.has(change.id));
}

function actionableChangeCount(changes: SyncPreviewChange[]) {
  return changes.filter((change) => change.type !== "unchanged").length;
}

function hasActionableChanges(changes: SyncPreviewChange[]) {
  return changes.some((change) => change.type !== "unchanged");
}

function buildExternalSimulation(contacts: ContactRow[]) {
  const first = contacts[0];
  const second = contacts[1];
  const candidateWithEmail = contacts.find((contact) => contact.id !== first?.id && firstEmail(contact));
  const deleted = contacts[2];

  const externalContacts: ExternalContactInput[] = [
    {
      company: "C-Group",
      displayName: "Ana Pereira Demo",
      emails: ["ana.demo@c-group.cl"],
      externalId: "sandbox/new-ana",
      phones: ["+56 9 4444 2222"],
      provider: "google",
      role: "Consultora"
    }
  ];
  const externalIdToContactId: Record<string, string> = {};
  const knownExternalValuesByContactId: Record<string, Array<{ kind: "email" | "phone"; value: string }>> = {};

  if (first) {
    externalContacts.push({
      company: "Empresa enriquecida",
      displayName: first.display_name,
      emails: [...(first.contact_emails ?? []).map((item) => item.email), `sync.${slug(first.display_name)}@ejemplo.cl`],
      externalId: "sandbox/modified-1",
      phones: (first.contact_phones ?? []).map((item) => item.phone),
      provider: "google",
      role: first.role || "Cargo enriquecido"
    });
    externalIdToContactId["sandbox/modified-1"] = first.id;
  }

  if (second && candidateWithEmail) {
    externalContacts.push({
      company: candidateWithEmail.company,
      displayName: second.display_name,
      emails: [firstEmail(candidateWithEmail)].filter(Boolean),
      externalId: "sandbox/consolidation-1",
      phones: [],
      provider: "google",
      role: candidateWithEmail.role
    });
    externalIdToContactId["sandbox/consolidation-1"] = second.id;
  }

  if (deleted) {
    externalIdToContactId["sandbox/deleted-1"] = deleted.id;
    const email = firstEmail(deleted);
    if (email) {
      knownExternalValuesByContactId[deleted.id] = [{ kind: "email", value: email }];
    }
  }

  return { externalContacts, externalIdToContactId, knownExternalValuesByContactId };
}

function firstEmail(contact: ContactRow) {
  return contact.contact_emails?.[0]?.email || "";
}

function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 32) || "contacto";
}
