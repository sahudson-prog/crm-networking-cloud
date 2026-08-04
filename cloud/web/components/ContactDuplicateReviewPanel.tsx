"use client";

import { useEffect, useMemo, useState } from "react";
import type { ContactMergeResult } from "../lib/contactMerge";
import { mergeContactsDeep } from "../lib/contactMergeActions";
import { findContactDuplicateGroups, type ContactDuplicateGroup } from "../lib/contactDuplicateReview";
import { readAllActiveContacts } from "../lib/cloudData";
import type { ContactRow } from "../lib/readModel";
import { ContactMergeDialog } from "./ContactMergeDialog";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";

export function ContactDuplicateReviewPanel() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [groups, setGroups] = useState<ContactDuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<ContactDuplicateGroup | null>(null);
  const [manualMergeOpen, setManualMergeOpen] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  const visibleGroups = useMemo(() => groups.slice(0, 12), [groups]);

  async function refresh() {
    setLoading(true);
    setMessage("");
    try {
      const rows = await readAllActiveContacts();
      setContacts(rows);
      setGroups(findContactDuplicateGroups(rows));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pude revisar duplicados.");
    } finally {
      setLoading(false);
    }
  }

  async function mergeSelectedGroup(result: ContactMergeResult, mergeSources = selectedGroup?.mergeSources ?? []) {
    const [target, ...sources] = mergeSources;
    if (!target || !sources.length) {
      setMessage("Elige 2 o 3 contactos para fusionar.");
      return;
    }
    setMerging(true);
    setMessage("");
    try {
      await mergeContactsDeep({
        result,
        source: "duplicate_review",
        sourceContactIds: sources.map((source) => source.id),
        targetContactId: target.id
      });
      setSelectedGroup(null);
      setManualMergeOpen(false);
      setMessage("Contactos fusionados. Actualice la lista de duplicados.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pude fusionar estos contactos.");
    } finally {
      setMerging(false);
    }
  }

  return (
    <Panel title="Revision de duplicados" caption="Detecta contactos guardados que comparten correo o telefono.">
      <div className="duplicate-review-head">
        <div>
          <strong>{loading ? "Revisando..." : `${groups.length} grupos detectados`}</strong>
          <span>Los grupos de hasta 3 contactos se pueden fusionar aqui con el editor global.</span>
        </div>
        <div className="toolbar">
          <Button icon="users" disabled={loading || merging} onClick={() => setManualMergeOpen(true)}>
            Fusionar manualmente
          </Button>
          <Button icon="sync" disabled={loading || merging} onClick={refresh}>
            Revisar
          </Button>
        </div>
      </div>

      {message ? <div className="duplicate-review-message">{message}</div> : null}

      <div className="duplicate-review-list">
        {!loading && !visibleGroups.length ? (
          <div className="sync-preview-empty">No se detectaron duplicados guardados.</div>
        ) : null}
        {visibleGroups.map((group) => {
          const canMerge = group.contacts.length <= 3;
          return (
            <article className="duplicate-review-card" key={group.id}>
              <div className="duplicate-review-card-main">
                <div className="duplicate-review-card-title">
                  <span>{group.contacts.length} contactos guardados</span>
                </div>
                <div className="duplicate-review-contacts">
                  {group.contacts.map((contact) => (
                    <a
                      className="duplicate-review-contact-link"
                      href={`/contactos?contactId=${encodeURIComponent(contact.id)}`}
                      key={contact.id}
                    >
                      {contact.display_name || "Contacto sin nombre"}
                    </a>
                  ))}
                </div>
                <div className="duplicate-review-reasons">
                  {group.duplicateKeys.slice(0, 3).map((key) => (
                    <span className="duplicate-review-reason" key={key.key}>
                      <span className="sync-preview-field-label">{key.label}</span>
                      <span className="sync-preview-operation match">coincide</span>
                      <span className="sync-preview-arrow">--&gt;</span>
                      <span className="sync-preview-data">{key.value}</span>
                    </span>
                  ))}
                </div>
              </div>
              {canMerge ? (
                <Button icon="edit" disabled={merging} onClick={() => setSelectedGroup(group)}>
                  Fusionar
                </Button>
              ) : (
                <span className="duplicate-review-blocked">Resolver en tandas</span>
              )}
            </article>
          );
        })}
      </div>

      <ContactMergeDialog
        availableContacts={contacts}
        description="Elige el contacto resultante. Esta accion fusiona contactos ya guardados en la app."
        note="Al fusionar, las interacciones, referidos, ToDos e IDs externos quedaran asociados al contacto resultante."
        onClose={() => {
          setSelectedGroup(null);
          setManualMergeOpen(false);
        }}
        onSave={mergeSelectedGroup}
        open={Boolean(selectedGroup) || manualMergeOpen}
        saveLabel={merging ? "Fusionando..." : "Fusionar"}
        saving={merging}
        sources={selectedGroup?.mergeSources ?? []}
        title={selectedGroup ? "Fusionar duplicados guardados" : "Fusionar contactos"}
      />
    </Panel>
  );
}
