"use client";

import { useEffect, useMemo, useState } from "react";
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
} from "../lib/objectiveActions";
import { readAllActiveContacts } from "../lib/cloudData";
import { formatContactCompanyRole, joinCompact } from "../lib/format";
import type { ContactRow, ObjectivePriority, ObjectiveRow, ObjectiveType } from "../lib/readModel";
import { Button } from "./ui/Button";
import { EmptyValue } from "./ui/EmptyValue";
import { Icon } from "./ui/Icon";

const OBJECTIVE_PAGE_TYPES: ObjectiveType[] = ["INDUSTRY", "COMPANY", "ROLE", "FUNCTION"];

const emptyDraft: ObjectiveEditorInput = {
  objectiveName: "",
  objectiveType: "COMPANY",
  priorityLevel: "MEDIUM",
  objectiveDescription: "",
  isActive: true
};

export function ObjectivesPage() {
  const [objectives, setObjectives] = useState<ObjectiveRow[]>([]);
  const [draft, setDraft] = useState<ObjectiveEditorInput>(emptyDraft);
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prioritySavingId, setPrioritySavingId] = useState("");
  const [message, setMessage] = useState("");
  const [selectedObjectiveId, setSelectedObjectiveId] = useState("");
  const [linkingObjective, setLinkingObjective] = useState<ObjectiveRow | null>(null);

  const grouped = useMemo(() => groupObjectives(objectives), [objectives]);

  useEffect(() => {
    void loadObjectives();
  }, []);

  async function loadObjectives() {
    setLoading(true);
    setMessage("");
    try {
      const rows = await readObjectives();
      setObjectives(rows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pude leer objetivos.");
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
  }

  function resetDraft() {
    setEditingId("");
    setDraft(emptyDraft);
    setMessage("");
  }

  async function submitDraft() {
    if (!draft.objectiveName.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      await saveObjective({ ...draft, objectiveId: editingId || undefined });
      resetDraft();
      await loadObjectives();
      setMessage("Objetivo guardado.");
    } catch (error) {
      setMessage(readableObjectiveError(error));
    } finally {
      setSaving(false);
    }
  }

  async function removeObjective(objective: ObjectiveRow) {
    const confirmed = window.confirm(`Eliminar ${objective.objective_name}? Tambien se quitará de los contactos asociados.`);
    if (!confirmed) return;
    setSaving(true);
    setMessage("");
    try {
      await deleteObjective(objective.id);
      if (selectedObjectiveId === objective.id) setSelectedObjectiveId("");
      await loadObjectives();
      setMessage("Objetivo eliminado.");
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
    <div className="objectives-page">
      <section className="panel objectives-editor-panel">
        <div className="panel-header">
          <h2 className="panel-title">Objetivos</h2>
        </div>
        <div className="objectives-editor-grid">
          <label className="field">
            <span>Nombre</span>
            <input
              placeholder="Empresa, industria, cargo o funcion"
              value={draft.objectiveName}
              onChange={(event) => setDraft({ ...draft, objectiveName: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Tipo</span>
            <select
              value={draft.objectiveType}
              onChange={(event) => setDraft({ ...draft, objectiveType: event.target.value as ObjectiveType })}
            >
              {OBJECTIVE_PAGE_TYPES.map((type) => (
                <option key={type} value={type}>{objectiveTypeLabel(type)}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Prioridad</span>
            <select
              value={draft.priorityLevel}
              onChange={(event) => setDraft({ ...draft, priorityLevel: event.target.value as ObjectivePriority })}
            >
              {OBJECTIVE_PRIORITIES.map((priority) => (
                <option key={priority.value} value={priority.value}>{objectivePriorityLabel(priority.value)}</option>
              ))}
            </select>
          </label>
          <label className="contact-editor-toggle objectives-active-toggle">
            <span>Activo</span>
            <input
              checked={draft.isActive}
              onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
              type="checkbox"
            />
            <i aria-hidden="true" />
          </label>
        </div>
        <label className="field objectives-description-field">
          <span>Descripcion</span>
          <textarea
            placeholder="Opcional"
            value={draft.objectiveDescription}
            onChange={(event) => setDraft({ ...draft, objectiveDescription: event.target.value })}
          />
        </label>
        <div className="objectives-editor-actions">
          {editingId ? <Button onClick={resetDraft}>Cancelar edicion</Button> : null}
          <Button disabled={!draft.objectiveName.trim() || saving} onClick={submitDraft} tone="primary">
            {saving ? "Guardando..." : editingId ? "Guardar cambios" : "Crear objetivo"}
          </Button>
        </div>
        {message ? <p className={message.includes("No pude") || message.includes("ya existe") ? "danger-text" : "form-success"}>{message}</p> : null}
      </section>

      {loading ? <section className="panel">Leyendo objetivos...</section> : null}

      {!loading ? (
        <section className="objectives-column-grid">
          {OBJECTIVE_PAGE_TYPES.map((type) => {
            const rows = grouped.get(type) ?? [];
            return (
              <div className="panel objectives-group" key={type}>
                <div className="objectives-group-head">
                  <h3>{objectiveTypeLabel(type)}</h3>
                  <span>{rows.length}</span>
                </div>
                {rows.length ? (
                  <div className="objectives-list">
                    {rows.map((objective) => (
                      <div
                        className={`objective-row ${objective.is_active ? "" : "inactive"} ${selectedObjectiveId === objective.id ? "selected" : ""}`}
                        key={objective.id}
                        onClick={() => setSelectedObjectiveId((current) => current === objective.id ? "" : objective.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedObjectiveId((current) => current === objective.id ? "" : objective.id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="objective-row-main">
                          <strong>{objective.objective_name}</strong>
                          {objective.objective_description ? <p>{objective.objective_description}</p> : null}
                        </div>
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
                              aria-label={`Eliminar ${objective.objective_name}`}
                            />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyValue>sin objetivos</EmptyValue>
                )}
              </div>
            );
          })}
        </section>
      ) : null}
      <ObjectiveContactLinkDialog
        objective={linkingObjective}
        onClose={() => setLinkingObjective(null)}
        onSaved={() => {
          setLinkingObjective(null);
          void loadObjectives();
        }}
      />
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
