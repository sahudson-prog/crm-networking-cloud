"use client";

import * as Popover from "@radix-ui/react-popover";
import { useEffect, useState } from "react";
import { readObjectives, setContactObjectiveAssignments } from "../lib/cycleObjectiveActions";
import type { ObjectiveRow } from "../lib/readModel";
import { ObjectiveChips, ObjectiveSelector } from "./ObjectiveSelector";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

export function ContactPrioritiesEditor({ contactId, objectives, onSaved }: {
  contactId: string; objectives: ObjectiveRow[]; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<ObjectiveRow[]>([]);
  const [selected, setSelected] = useState(objectives.map(row => row.id));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => { setSelected(objectives.map(row => row.id)); }, [objectives.map(row => row.id).join(","), contactId]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setReadError("");
    readObjectives({ activeOnly: true }).then(rows => { if (active) setChoices(rows); })
      .catch(() => { if (active) setReadError("No pudimos cargar tus prioridades."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, retry, contactId]);
  const available = [...new Map([...objectives, ...choices].map(row => [row.id, row])).values()];
  async function change(ids: string[]) {
    if (saving) return;
    const before = selected;
    setSelected(ids); setSaving(true); setError("");
    try {
      await setContactObjectiveAssignments({ contactId, objectiveIds: ids, source: "contact_profile" });
      onSaved();
    } catch {
      setSelected(before); setError("No pudimos guardar las prioridades. Inténtalo de nuevo");
      onSaved();
    } finally { setSaving(false); }
  }
  return <div className="contact-priorities-editor">
    {selected.length ? <ObjectiveChips objectives={available.filter(row => selected.includes(row.id))} /> : null}
    <Popover.Root modal open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild><button className="contact-priority-trigger" aria-label={selected.length ? "Editar prioridades" : "Agregar prioridades"} type="button">{selected.length ? "Editar" : "+ Agregar"}</button></Popover.Trigger>
      <Popover.Portal><Popover.Content className="contact-priority-popover" sideOffset={8} collisionPadding={16} aria-label="Editar prioridades">
        <Popover.Close asChild><button type="button" className="contact-priority-close" aria-label="Cerrar prioridades"><Icon name="close" /></button></Popover.Close>
        <ObjectiveSelector hideHeading searchable choices={available} choicesLoading={loading} choicesError={readError} disabled={saving} selectedObjectiveIds={selected} onChange={change} />
        {readError ? <Button onClick={() => setRetry(value => value + 1)}>Reintentar</Button> : null}
        {error ? <p role="alert" className="danger-text">{error}</p> : null}
        <span className="sr-only" role="status">{saving ? "Guardando prioridades" : ""}</span>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  </div>;
}
