"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { readEligibleOpportunityInteractions, readOpportunityChoices, saveOpportunity, voidOpportunity, type OpportunityInput } from "../lib/opportunityActions";
import { opportunityClosureValid, opportunityResultsForStage, opportunityStageLabel, type Opportunity, type OpportunityStage } from "../lib/opportunityModel";
import { ObjectiveSelector } from "./ObjectiveSelector";
import { Button } from "./ui/Button";
import { OpportunityFailure } from "../lib/opportunityDiagnostics";

export type OpportunityEditorRequest = {
  opportunity?: Opportunity;
  stage?: OpportunityStage;
  objectiveId?: string;
};

function initialDraft(request: OpportunityEditorRequest): OpportunityInput {
  const row = request.opportunity;
  return {
    id: row?.id, creationRequestId: row ? undefined : crypto.randomUUID(),
    expectedUpdatedAt: row?.updated_at, title: row?.title ?? "", company: row?.company ?? "", applicationUrl: row?.application_url ?? "",
    stage: request.stage ?? row?.stage ?? "identified",
    situation: row?.situation === "finalized" ? "finalized" : "active",
    result: row?.result ?? null,
    resultNote: row?.result_note ?? "",
    contactIds: row?.contact_ids ?? [],
    objectiveIds: row?.objective_ids ?? (request.objectiveId ? [request.objectiveId] : []),
    interactionIds: row?.interaction_ids ?? []
  };
}

export function OpportunityEditor({ request, onClose, onSaved }: {
  request: OpportunityEditorRequest | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const contactOptionsId = useId();
  const inFlight = useRef(false);
  const requestVersion = useRef(0);
  const interactionVersion = useRef(0);
  const [draft, setDraft] = useState<OpportunityInput>(() => initialDraft(request ?? {}));
  const [contacts, setContacts] = useState<{ id: string; display_name: string }[]>([]);
  const [objectives, setObjectives] = useState<{ id: string; objective_name: string;
    objective_type: "COMPANY" | "INDUSTRY" | "ROLE" | "FUNCTION"; priority_level: "HIGH" | "MEDIUM" | "LOW" }[]>([]);
  const [contactQuery, setContactQuery] = useState("");
  const [interactions, setInteractions] = useState<{ id: string; subject: string | null; interaction_type: string; occurred_at: string | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const [failedChoices, setFailedChoices] = useState<string[]>([]);
  const [fatalLoadFailure, setFatalLoadFailure] = useState(false);
  const [interactionLoading, setInteractionLoading] = useState(false);
  const [interactionFailed, setInteractionFailed] = useState(false);
  const [contactsChanged, setContactsChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!request) return;
    let live = true;
    requestVersion.current += 1;
    inFlight.current = false; setSaving(false);
    setDraft(initialDraft(request)); setError(""); setLoading(true); setFailedChoices([]); setContactQuery("");
    setFatalLoadFailure(false); setContactsChanged(false);
    dialog.current?.showModal();
    void readOpportunityChoices().then((choices) => {
      if (!live) return;
      setContacts(choices.contacts.status === "fulfilled" ? choices.contacts.value : []);
      setObjectives(choices.objectives.status === "fulfilled" ? choices.objectives.value : []);
      setFailedChoices([...(choices.contacts.status === "rejected" ? ["Contactos"] : []),
        ...(choices.objectives.status === "rejected" ? ["Prioridades"] : [])]);
    }).catch(() => { if (live) { setFatalLoadFailure(true); setFailedChoices(["Contactos", "Prioridades"]); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; requestVersion.current += 1; dialog.current?.close(); };
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const version = ++interactionVersion.current;
    if (!draft.contactIds.length) { setInteractions([]); setInteractionLoading(false); setInteractionFailed(false); return; }
    setInteractionLoading(true); setInteractionFailed(false);
    void readEligibleOpportunityInteractions(draft.contactIds).then((rows) => {
      if (version === interactionVersion.current) setInteractions(rows);
    }).catch(() => { if (version === interactionVersion.current) setInteractionFailed(true); })
      .finally(() => { if (version === interactionVersion.current) setInteractionLoading(false); });
    return () => { interactionVersion.current += 1; };
  }, [request, draft.contactIds]);

  const missingInteractions = draft.interactionIds.filter((id) => !interactions.some((row) => row.id === id));
  const unsafeEdit = Boolean(draft.id && (loading || interactionLoading || fatalLoadFailure || failedChoices.length || interactionFailed));
  const unsafeCreate = Boolean(!draft.id && (
    (draft.contactIds.length && (loading || fatalLoadFailure || failedChoices.includes("Contactos")))
    || (draft.objectiveIds.length && (loading || fatalLoadFailure || failedChoices.includes("Prioridades")))
    || (draft.interactionIds.length && (interactionLoading || interactionFailed))));
  const cannotSave = saving || unsafeEdit || unsafeCreate || !draft.title.trim()
    || !opportunityClosureValid(draft.stage, draft.situation, draft.result);
  const contactMatches = contactQuery.trim() ? contacts.filter((contact) =>
    !draft.contactIds.includes(contact.id) && contact.display_name.toLocaleLowerCase("es-CL")
      .includes(contactQuery.trim().toLocaleLowerCase("es-CL"))).slice(0, 20) : [];

  function close() { if (!inFlight.current) { dialog.current?.close(); onClose(); } }
  async function submit() {
    if (inFlight.current || cannotSave) return;
    if (contactsChanged && missingInteractions.length && !window.confirm(
      `${missingInteractions.length} interacciones dejarán de estar vinculadas al guardar. ¿Continuar?`)) return;
    inFlight.current = true;
    const version = requestVersion.current;
    setSaving(true); setError("");
    try { await saveOpportunity({ ...draft, interactionIds: contactsChanged
      ? draft.interactionIds.filter((id) => !missingInteractions.includes(id)) : draft.interactionIds }); }
    catch (failure) { if (version === requestVersion.current) {
      setError(failure instanceof OpportunityFailure && failure.kind === "stale"
        ? "La oportunidad cambió. Cierra y actualiza el tablero antes de editar nuevamente."
        : failure instanceof OpportunityFailure && failure.kind === "rejected"
          ? "No pudimos guardar la oportunidad. Revisa los datos e intenta nuevamente."
          : "No pudimos confirmar el guardado. Puedes reintentar sin duplicar la oportunidad.");
    } return; }
    finally { if (version === requestVersion.current) { inFlight.current = false; setSaving(false); } }
    if (version === requestVersion.current) { dialog.current?.close(); onSaved(); }
  }
  async function remove() {
    if (!draft.id || inFlight.current || unsafeEdit
      || !window.confirm("¿Anular esta oportunidad creada por error? Quedará fuera del tablero y de los indicadores.")) return;
    inFlight.current = true;
    const version = requestVersion.current;
    setSaving(true); setError("");
    try { await voidOpportunity(draft.id); if (version === requestVersion.current) { dialog.current?.close(); onSaved(); } }
    catch { if (version === requestVersion.current) setError("No pudimos anular. Intenta nuevamente."); }
    finally { if (version === requestVersion.current) { inFlight.current = false; setSaving(false); } }
  }
  function toggle(key: "contactIds" | "objectiveIds" | "interactionIds", id: string) {
    if (key === "contactIds") setContactsChanged(true);
    setDraft((current) => ({ ...current, [key]: current[key].includes(id)
      ? current[key].filter((value) => value !== id) : [...current[key], id] }));
  }

  return (
    <dialog ref={dialog} className="modal-card opportunity-editor-dialog" aria-labelledby={titleId}
      onCancel={(event) => { if (inFlight.current) event.preventDefault(); else onClose(); }}>
      <header className="modal-head">
        <h2 id={titleId}>{draft.id ? "Editar oportunidad" : "Nueva oportunidad"}</h2>
        <Button icon="close" square aria-label="Cerrar diálogo" onClick={close} disabled={saving} />
      </header>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset className="opportunity-editor-fields" disabled={saving}>
        <legend className="sr-only">Datos de la oportunidad</legend>
        <label className="field"><span>Título</span><input autoFocus required maxLength={180} value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="field"><span>Empresa <small>(opcional)</small></span><input maxLength={120} value={draft.company}
          onChange={(event) => setDraft({ ...draft, company: event.target.value })} /></label>
        <label className="field"><span>Enlace de postulación <small>(opcional)</small></span><input type="url" value={draft.applicationUrl}
          onChange={(event) => setDraft({ ...draft, applicationUrl: event.target.value })} /></label>
        <div className="field"><span>Etapa</span><strong className="opportunity-editor-stage">{opportunityStageLabel(draft.stage)}</strong></div>
        {draft.situation === "finalized" ? <label className="field"><span>Resultado</span>
          <select required value={draft.result ?? ""} onChange={(event) => setDraft({ ...draft,
            result: event.target.value ? event.target.value as OpportunityInput["result"] : null })}>
            <option value="">Seleccionar resultado</option>
            {opportunityResultsForStage(draft.stage).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select></label> : null}
        {draft.situation === "finalized" ? <label className="field">
          <span>Causa de cierre <small>(opcional)</small></span><textarea maxLength={500} value={draft.resultNote}
            onChange={(event) => setDraft({ ...draft, resultNote: event.target.value })} />
        </label> : null}
        {loading ? <p role="status" className="opportunity-editor-note">Leyendo relaciones...</p> : null}
        {failedChoices.length ? <p role="alert" className="opportunity-editor-feedback danger-text">No pudimos cargar {failedChoices.join(" y ")}. Reintenta abrir el editor.</p> : null}
        <div className="opportunity-contact-picker">
          <label className="opportunity-picker-label" htmlFor={contactOptionsId}>Contactos</label>
          {draft.contactIds.length ? <div className="opportunity-selected-contacts">{draft.contactIds.map((id) => {
            const contact = contacts.find((row) => row.id === id);
            return <button type="button" className="objective-chip active" key={id}
              disabled={loading || failedChoices.includes("Contactos")}
              aria-label={`Desvincular ${contact?.display_name ?? "contacto conservado"}`}
              onClick={() => toggle("contactIds", id)}>{contact?.display_name ?? "Vínculo conservado"} <X size={12} aria-hidden="true" /></button>;
          })}</div> : null}
          <div className="contact-search-select">
            <input id={contactOptionsId} type="search" role="combobox" aria-expanded={Boolean(contactQuery.trim() && contactMatches.length)}
              aria-controls={`${contactOptionsId}-options`} autoComplete="off" placeholder="Buscar contactos"
              disabled={loading || failedChoices.includes("Contactos")}
              value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} />
            {contactQuery.trim() ? <div id={`${contactOptionsId}-options`} className="contact-search-options" role="listbox">
              {contactMatches.length ? contactMatches.map((contact) => <button type="button" role="option" aria-selected="false"
                className="contact-search-option" key={contact.id} onClick={() => { toggle("contactIds", contact.id); setContactQuery(""); }}>
                {contact.display_name}</button>) : <span className="contact-search-empty">Sin coincidencias</span>}
            </div> : null}
          </div>
        </div>
        {!draft.contactIds.length ? <p className="opportunity-editor-note">Vincula un contacto para asociar interacciones</p> : null}
        {interactionLoading ? <p role="status" className="opportunity-editor-note">Leyendo interacciones...</p> : null}
        {interactionFailed ? <p role="alert" className="opportunity-editor-feedback danger-text">No pudimos cargar Interacciones. Reintenta abrir el editor.</p> : null}
        <RelationChoices title="Interacciones" rows={interactions.map((interaction) => ({ id: interaction.id,
            label: `${interaction.subject || interaction.interaction_type} · ${interaction.occurred_at ? new Date(interaction.occurred_at).toLocaleDateString("es-CL") : "Sin fecha"}` }))}
            selected={draft.interactionIds} onToggle={(id) => toggle("interactionIds", id)}
            failed={interactionFailed || interactionLoading} disabled={!draft.contactIds.length} />
        <ObjectiveSelector choices={objectives} choicesLoading={loading}
          choicesError={failedChoices.includes("Prioridades") ? "No pudimos cargar Prioridades. Reintenta abrir el editor." : ""}
          selectedObjectiveIds={draft.objectiveIds} disabled={loading || failedChoices.includes("Prioridades")}
          onChange={(objectiveIds) => setDraft((current) => ({ ...current, objectiveIds }))} />
      </fieldset>
      {error ? <p role="alert" className="opportunity-editor-feedback danger-text">{error}</p> : null}
      <footer className="modal-actions">
        {draft.id ? <Button tone="danger" disabled={saving || unsafeEdit}
          onClick={() => void remove()}>Anular</Button> : null}
        <Button disabled={saving} onClick={close}>Cancelar</Button>
        <Button type="submit" tone="primary" disabled={Boolean(cannotSave)}>
          {saving ? "Guardando..." : "Guardar"}
        </Button>
      </footer>
      </form>
    </dialog>
  );
}

function RelationChoices({ title, rows, selected, onToggle, failed = false, disabled = false }: {
  title: string; rows: { id: string; label: string }[]; selected: string[]; onToggle: (id: string) => void;
  failed?: boolean; disabled?: boolean;
}) {
  const options = [...rows, ...selected.filter((id) => !rows.some((row) => row.id === id))
    .map((id) => ({ id, label: "Vínculo conservado (no disponible para nuevas asociaciones)" }))];
  return <fieldset className="opportunity-relations" disabled={failed || disabled}><legend>{title}</legend>
    {options.length ? <div className="opportunity-relation-list">{options.map((row) => <label key={row.id}>
      <input type="checkbox" checked={selected.includes(row.id)} onChange={() => onToggle(row.id)} />
      <span>{row.label}</span>
    </label>)}</div> : failed ? <small>No disponible</small> : <small>Sin elementos disponibles</small>}
  </fieldset>;
}
