"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  OBJECTIVE_PRIORITIES,
  deleteObjective,
  objectivePriorityLabel,
  objectiveTypeLabel,
  readContactIdsForObjective,
  readObjectives,
  saveObjective,
  setObjectiveContactAssignments,
  type ObjectiveEditorInput
} from "../lib/cycleObjectiveActions";
import { readAllActiveContacts } from "../lib/cloudData";
import { formatContactCompanyRole, joinCompact } from "../lib/format";
import type { ContactRow, ObjectivePriority, ObjectiveRow, ObjectiveType } from "../lib/readModel";
import { Button } from "./ui/Button";
import { EmptyValue } from "./ui/EmptyValue";
import { Icon } from "./ui/Icon";
import { NetworkingCyclePanel } from "./NetworkingCyclePanel";

const OBJECTIVE_PAGE_TYPES: ObjectiveType[] = ["INDUSTRY", "COMPANY", "ROLE", "FUNCTION"];

const emptyDraft: ObjectiveEditorInput = {
  objectiveName: "",
  objectiveType: "COMPANY",
  priorityLevel: "MEDIUM",
  objectiveDescription: "",
  isActive: true
};

export function ObjectivesPage({ onboardingCoach, onCycleReadyChange }: {
  onboardingCoach?: ReactNode;
  onCycleReadyChange?: (ready: boolean) => void;
} = {}) {
  const [objectives, setObjectives] = useState<ObjectiveRow[]>([]);
  const [draft, setDraft] = useState<ObjectiveEditorInput>(emptyDraft);
  const [editingId, setEditingId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const editorDialog = useRef<HTMLDialogElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prioritySavingId, setPrioritySavingId] = useState("");
  const [message, setMessage] = useState("");
  const [selectedObjectiveId, setSelectedObjectiveId] = useState("");
  const [linkingObjective, setLinkingObjective] = useState<ObjectiveRow | null>(null);
  const [cycleReady, setCycleReady] = useState(false);

  const grouped = useMemo(() => groupObjectives(objectives), [objectives]);

  useEffect(() => {
    void loadObjectives();
  }, []);
  useEffect(() => { if (editorOpen && !editorDialog.current?.open) editorDialog.current?.showModal(); }, [editorOpen]);

  async function loadObjectives() {
    setLoading(true);
    setMessage("");
    try {
      const rows = await readObjectives();
      setObjectives(rows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pude leer Prioridades.");
    } finally {
      setLoading(false);
    }
  }

  function editObjective(objective: ObjectiveRow) {
    setEditingId(objective.id);
    setDraft({
      objectiveId: objective.id,
      objectiveName: objective.objective_name,
      objectiveType: objective.objective_type,
      priorityLevel: objective.priority_level,
      objectiveDescription: objective.objective_description,
      isActive: objective.is_active
    });
    setMessage("");
    setEditorOpen(true);
  }

  function addObjective(type: ObjectiveType) {
    setEditingId("");
    setDraft({ ...emptyDraft, objectiveType: type });
    setMessage("");
    setEditorOpen(true);
  }

  function resetDraft() {
    setEditorOpen(false);
    setEditingId("");
    setDraft(emptyDraft);
  }

  async function submitDraft() {
    if (!draft.objectiveName.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      await saveObjective({ ...draft, objectiveId: editingId || undefined });
      editorDialog.current?.close();
      await loadObjectives();
      setMessage("Prioridad guardada.");
    } catch (error) {
      setMessage(readableObjectiveError(error));
    } finally {
      setSaving(false);
    }
  }

  async function removeObjective(objective: ObjectiveRow) {
    const confirmed = window.confirm(`Archivar ${objective.objective_name}? Permanecerá en este ciclo y conservará sus asociaciones.`);
    if (!confirmed) return;
    setSaving(true);
    setMessage("");
    try {
      await deleteObjective(objective.id);
      if (selectedObjectiveId === objective.id) setSelectedObjectiveId("");
      await loadObjectives();
      setMessage("Prioridad archivada.");
    } catch (error) {
      setMessage(readableObjectiveError(error));
    } finally {
      setSaving(false);
    }
  }

  async function updateObjectivePriority(objective: ObjectiveRow, priorityLevel: ObjectivePriority) {
    if (objective.priority_level === priorityLevel || prioritySavingId) return;
    setPrioritySavingId(objective.id);
    setMessage("");
    setObjectives((current) =>
      current.map((currentObjective) =>
        currentObjective.id === objective.id ? { ...currentObjective, priority_level: priorityLevel } : currentObjective
      )
    );
    try {
      await saveObjective({
        objectiveId: objective.id,
        objectiveName: objective.objective_name,
        objectiveType: objective.objective_type,
        priorityLevel,
        objectiveDescription: objective.objective_description,
        isActive: objective.is_active
      });
    } catch (error) {
      setMessage(readableObjectiveError(error));
      await loadObjectives();
    } finally {
      setPrioritySavingId("");
    }
  }

  return (
    <div className={`objectives-page ${onboardingCoach ? "onboarding-objectives-page" : ""}`}>
      {onboardingCoach ? <div className="objectives-onboarding-coach">{onboardingCoach}</div> : null}
      <NetworkingCyclePanel onReadyChange={(ready) => { setCycleReady(ready); onCycleReadyChange?.(ready); }}
        onCycleChange={() => void loadObjectives()} />
      {cycleReady ? <>
      <section className="objectives-priorities" aria-labelledby="priorities-title">
        <div className="panel-header">
          <h2 className="panel-title" id="priorities-title"><Icon name="tag" /> Prioridades</h2>
        </div>
        {!editorOpen && message ? <p className={message.includes("No pude") || message.includes("ya existe") ? "danger-text" : "form-success"} role="status">{message}</p> : null}
        {loading ? <p role="status">Leyendo prioridades...</p> : null}

      {!loading ? (
        <section className="objectives-column-grid">
          {OBJECTIVE_PAGE_TYPES.map((type) => {
            const rows = grouped.get(type) ?? [];
            return (
              <div className="panel objectives-group" key={type}>
                <div className="objectives-group-head">
                  <h3>{objectiveTypeLabel(type)}</h3>
                  <span>{rows.length}</span>
                  <Button icon="plus" square onClick={() => addObjective(type)}
                    aria-label={`Agregar Prioridad en ${objectiveTypeLabel(type)}`} />
                </div>
                {rows.length ? (
                  <div className="objectives-list">
                    {rows.map((objective) => (
                      <div
                        className={`objective-row ${objective.is_active ? "" : "inactive"} ${selectedObjectiveId === objective.id ? "selected" : ""}`}
                        key={objective.id}
                      >
                        <button className="objective-row-main" type="button"
                          aria-expanded={selectedObjectiveId === objective.id}
                          aria-label={`${objective.objective_name}, ${selectedObjectiveId === objective.id ? "ocultar" : "mostrar"} acciones`}
                          onClick={() => setSelectedObjectiveId((current) => current === objective.id ? "" : objective.id)}>
                          <strong>{objective.objective_name}</strong>
                          {objective.objective_description ? <p>{objective.objective_description}</p> : null}
                        </button>
                        <PriorityStars
                          disabled={Boolean(prioritySavingId)}
                          priority={objective.priority_level}
                          onChange={(priorityLevel) => updateObjectivePriority(objective, priorityLevel)}
                        />
                        {selectedObjectiveId === objective.id ? (
                          <div className="objective-row-actions">
                            <Button
                              icon="users"
                              onClick={(event) => {
                                event.stopPropagation();
                                setLinkingObjective(objective);
                              }}
                              square
                              aria-label={`Vincular contactos a ${objective.objective_name}`}
                            />
                            <Button
                              icon="edit"
                              onClick={(event) => {
                                event.stopPropagation();
                                editObjective(objective);
                              }}
                              square
                              aria-label={`Editar ${objective.objective_name}`}
                            />
                            <Button
                              icon="trash"
                              onClick={(event) => {
                                event.stopPropagation();
                                void removeObjective(objective);
                              }}
                              square
                              aria-label={`Archivar ${objective.objective_name}`}
                            />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyValue>sin prioridades</EmptyValue>
                )}
              </div>
            );
          })}
        </section>
      ) : null}
      </section>
      {editorOpen ? (
        <dialog ref={editorDialog} className="modal-card objective-editor-dialog" aria-labelledby="objective-editor-title"
          onCancel={(event) => { if (saving) event.preventDefault(); }} onClose={resetDraft}>
          <header className="modal-head">
            <h2 id="objective-editor-title">{editingId ? "Editar Prioridad" : `Nueva Prioridad · ${objectiveTypeLabel(draft.objectiveType)}`}</h2>
            <Button icon="close" square aria-label="Cerrar diálogo" disabled={saving} onClick={() => editorDialog.current?.close()} />
          </header>
          <div className="objectives-editor-grid">
            <label className="field"><span>Nombre</span>
              <input autoFocus placeholder="Empresa, industria, cargo o función" value={draft.objectiveName}
                onChange={(event) => setDraft({ ...draft, objectiveName: event.target.value })} />
            </label>
            <label className="field"><span>Categoría</span>
              <select value={draft.objectiveType} onChange={(event) => setDraft({ ...draft, objectiveType: event.target.value as ObjectiveType })}>
                {OBJECTIVE_PAGE_TYPES.map((type) => <option key={type} value={type}>{objectiveTypeLabel(type)}</option>)}
              </select>
            </label>
            <label className="field"><span>Prioridad</span>
              <select value={draft.priorityLevel} onChange={(event) => setDraft({ ...draft, priorityLevel: event.target.value as ObjectivePriority })}>
                {OBJECTIVE_PRIORITIES.map((priority) => <option key={priority.value} value={priority.value}>{objectivePriorityLabel(priority.value)}</option>)}
              </select>
            </label>
            <label className="contact-editor-toggle objectives-active-toggle"><span>Activo</span>
              <input checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} type="checkbox" />
              <i aria-hidden="true" />
            </label>
          </div>
          <label className="field objectives-description-field"><span>Descripción</span>
            <textarea placeholder="Opcional" value={draft.objectiveDescription}
              onChange={(event) => setDraft({ ...draft, objectiveDescription: event.target.value })} />
          </label>
          {message ? <p className="form-error" role="alert">{message}</p> : null}
          <footer className="modal-actions">
            <Button disabled={saving} onClick={() => editorDialog.current?.close()}>Cancelar</Button>
            <Button disabled={!draft.objectiveName.trim() || saving} onClick={() => void submitDraft()} tone="primary">
              {saving ? "Guardando..." : editingId ? "Guardar cambios" : "Crear Prioridad"}
            </Button>
          </footer>
        </dialog>
      ) : null}
      <ObjectiveContactLinkDialog
        objective={linkingObjective}
        onClose={() => setLinkingObjective(null)}
        onSaved={() => {
          setLinkingObjective(null);
          void loadObjectives();
        }}
      />
      </> : null}
    </div>
  );
}

function groupObjectives(objectives: ObjectiveRow[]) {
  const grouped = new Map<ObjectiveType, ObjectiveRow[]>();
  for (const objective of objectives) {
    const current = grouped.get(objective.objective_type) ?? [];
    current.push(objective);
    grouped.set(objective.objective_type, current);
  }
  for (const rows of grouped.values()) {
    rows.sort(compareObjectivesByPriority);
  }
  return grouped;
}

function PriorityStars({
  disabled,
  onChange,
  priority
}: {
  disabled: boolean;
  onChange: (priority: ObjectivePriority) => void;
  priority: ObjectivePriority;
}) {
  const activeStars = priorityToStars(priority);
  return (
    <div className="objective-priority-stars" title={`Prioridad ${objectivePriorityLabel(priority)}`}>
      {[1, 2, 3].map((stars) => (
        <button
          aria-label={`Prioridad ${objectivePriorityLabel(priorityFromStars(stars))}`}
          className={`objective-priority-star ${stars <= activeStars ? "filled" : "empty"}`}
          disabled={disabled}
          key={stars}
          onClick={(event) => {
            event.stopPropagation();
            onChange(priorityFromStars(stars));
          }}
          onKeyDown={(event) => event.stopPropagation()}
          type="button"
        >
          <Icon name="star" />
        </button>
      ))}
    </div>
  );
}

function ObjectiveContactLinkDialog({
  objective,
  onClose,
  onSaved
}: {
  objective: ObjectiveRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!objective) return;
    let active = true;
    setLoading(true);
    setMessage("");
    setQuery("");
    Promise.all([readAllActiveContacts(), readContactIdsForObjective(objective.id)])
      .then(([contactRows, linkedIds]) => {
        if (!active) return;
        setContacts(contactRows);
        setSelectedContactIds(new Set(linkedIds));
      })
      .catch((error) => {
        if (!active) return;
        setContacts([]);
        setSelectedContactIds(new Set());
        setMessage(error instanceof Error ? error.message : "No pude leer contactos vinculados.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [objective]);

  const filteredContacts = useMemo(() => {
    const cleanQuery = normalizeSearch(query);
    const base = cleanQuery ? contacts.filter((contact) => normalizeSearch(contactSearchText(contact)).includes(cleanQuery)) : contacts;
    return [...base]
      .sort((a, b) => compareContactsForObjectivePicker(a, b, selectedContactIds))
      .slice(0, 80);
  }, [contacts, query, selectedContactIds]);

  if (!objective) return null;

  function toggleContact(contactId: string) {
    setSelectedContactIds((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  async function saveLinks() {
    if (!objective) return;
    setSaving(true);
    setMessage("");
    try {
      await setObjectiveContactAssignments({
        objectiveId: objective.id,
        contactIds: Array.from(selectedContactIds)
      });
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pude guardar vinculos.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card objective-link-dialog" role="dialog" aria-modal="true" aria-labelledby="objective-link-title">
        <header className="modal-head">
          <div>
            <h2 id="objective-link-title">Vincular contactos</h2>
            <p>{objective.objective_name}</p>
          </div>
          <Button icon="close" square aria-label="Cerrar sin guardar" onClick={onClose} />
        </header>

        <div className="objective-link-search contacts-quick-search">
          <Icon name="search" />
          <input
            aria-label="Buscar contactos"
            disabled={loading || saving}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscador universal"
            value={query}
          />
        </div>

        <div className="objective-link-summary">
          {loading ? "Leyendo contactos..." : `${selectedContactIds.size} vinculados`}
        </div>

        <div className="objective-link-list">
          {!loading && filteredContacts.length ? (
            filteredContacts.map((contact) => {
              const checked = selectedContactIds.has(contact.id);
              return (
                <button
                  className={`objective-link-row ${checked ? "selected" : ""}`}
                  disabled={saving}
                  key={contact.id}
                  onClick={() => toggleContact(contact.id)}
                  type="button"
                >
                  <span className={`objective-link-check ${checked ? "checked" : ""}`}>
                    {checked ? <Icon name="check" /> : null}
                  </span>
                  <span>
                    <strong>{contact.display_name || "Contacto sin nombre"}</strong>
                    <em>{contactCaption(contact)}</em>
                  </span>
                </button>
              );
            })
          ) : null}
          {!loading && !filteredContacts.length ? <EmptyValue>sin coincidencias</EmptyValue> : null}
        </div>

        {message ? <div className="modal-message danger-text">{message}</div> : null}

        <footer className="modal-actions">
          <Button onClick={onClose}>Cancelar</Button>
          <Button disabled={loading || saving} onClick={saveLinks} tone="primary">
            {saving ? "Guardando..." : "Cerrar"}
          </Button>
        </footer>
      </section>
    </div>
  );
}

function contactSearchText(contact: ContactRow) {
  return [
    contact.display_name,
    contact.company,
    contact.role,
    contact.networking_status,
    ...(contact.contact_emails ?? []).map((email) => email.email),
    ...(contact.contact_phones ?? []).map((phone) => phone.phone)
  ].join(" ");
}

function contactCaption(contact: ContactRow) {
  const firstMethod = joinCompact([(contact.contact_emails ?? [])[0]?.email, (contact.contact_phones ?? [])[0]?.phone], " · ");
  return joinCompact([formatContactCompanyRole(contact.company, contact.role), firstMethod], " · ") || "sin datos";
}

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compareContactsForObjectivePicker(a: ContactRow, b: ContactRow, selectedContactIds: Set<string>) {
  const selectedA = selectedContactIds.has(a.id);
  const selectedB = selectedContactIds.has(b.id);
  if (selectedA !== selectedB) return selectedA ? -1 : 1;
  return (a.display_name || "").localeCompare(b.display_name || "", "es", { sensitivity: "base" });
}

function compareObjectivesByPriority(a: ObjectiveRow, b: ObjectiveRow) {
  const priorityCompare = priorityWeight(b.priority_level) - priorityWeight(a.priority_level);
  if (priorityCompare) return priorityCompare;
  return a.objective_name.localeCompare(b.objective_name, "es", { sensitivity: "base" });
}

function priorityToStars(priority: ObjectivePriority) {
  if (priority === "HIGH") return 3;
  if (priority === "MEDIUM") return 2;
  return 1;
}

function priorityFromStars(stars: number): ObjectivePriority {
  if (stars >= 3) return "HIGH";
  if (stars === 2) return "MEDIUM";
  return "LOW";
}

function priorityWeight(priority: ObjectivePriority) {
  return priorityToStars(priority);
}

function readableObjectiveError(error: unknown) {
  const message = error instanceof Error ? error.message : "No pude guardar el objetivo.";
  if (message.includes("uq_objectives_user_type_normalized_active")) {
    return "Ya existe un objetivo activo con ese nombre y tipo.";
  }
  return message;
}
