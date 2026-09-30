"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ContactMergeResult } from "../lib/contactMerge";
import { mergeContactsDeep } from "../lib/contactMergeActions";
import { startContactDuplicateMerge } from "../lib/contactDuplicateMergeFlow";
import { findContactDuplicateGroups, type ContactDuplicateGroup } from "../lib/contactDuplicateReview";
import { readAllActiveContacts } from "../lib/cloudData";
import type { ContactRow } from "../lib/readModel";
import { ContactMergeDialog } from "./ContactMergeDialog";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";
import { useBodyScrollLock } from "./useBodyScrollLock";

export function ContactDuplicateReviewPanel() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [groups, setGroups] = useState<ContactDuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<ContactDuplicateGroup | null>(null);
  const [manualMergeOpen, setManualMergeOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [mergeError, setMergeError] = useState("");
  const mergeInFlightRef = useRef<Promise<void> | null>(null);

  useBodyScrollLock(reviewOpen);

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
    try {
      const merge = startContactDuplicateMerge(
        result,
        mergeSources,
        { merge: mergeContactsDeep, refresh },
        mergeInFlightRef
      );
      if (!merge.started) return;
      setMerging(true);
      setMergeError("");
      setMessage("");
      await merge.operation;
      setSelectedGroup(null);
      setManualMergeOpen(false);
      setMessage("Contactos fusionados correctamente.");
    } catch {
      setMergeError("No pudimos fusionar estos contactos. Revisa la selección e inténtalo nuevamente.");
    } finally {
      setMerging(false);
    }
  }

  const reviewList = (
    <>
      <div className="duplicate-review-head">
        <div>
          <strong>{loading ? "Revisando..." : `${groups.length} grupos detectados`}</strong>
          <span>Los grupos de hasta 3 contactos se pueden fusionar aqui con el editor global.</span>
        </div>
        <div className="toolbar">
          <Button
            icon="users"
            disabled={loading || merging}
            onClick={() => {
              setMergeError("");
              setManualMergeOpen(true);
            }}
          >
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
                <Button
                  icon="edit"
                  disabled={merging}
                  onClick={() => {
                    setMergeError("");
                    setSelectedGroup(group);
                  }}
                >
                  Fusionar
                </Button>
              ) : (
                <span className="duplicate-review-blocked">Resolver en tandas</span>
              )}
            </article>
          );
        })}
      </div>
    </>
  );

  return (
    <Panel title="Revision de duplicados">
      <div className="duplicate-review-head compact">
        <div>
          <strong>{loading ? "Revisando..." : `${groups.length} grupos detectados`}</strong>
          <span>Gestiona contactos guardados que comparten correo o telefono.</span>
        </div>
        <Button
          disabled={loading || merging}
          icon="users"
          onClick={() => {
            setReviewOpen(true);
            void refresh();
          }}
        >
          Gestionar duplicados
        </Button>
      </div>

      {message && !reviewOpen ? <div className="duplicate-review-message">{message}</div> : null}

      {reviewOpen ? (
        <div className="modal-backdrop duplicate-review-backdrop" role="dialog" aria-modal="true">
          <section className="modal-card duplicate-review-dialog">
            <div className="modal-head">
              <div>
                <h2>Revision de duplicados</h2>
                <p>Fusiona grupos guardados con el editor global.</p>
              </div>
              <Button icon="close" onClick={() => setReviewOpen(false)} square />
            </div>
            <div className="duplicate-review-dialog-body">{reviewList}</div>
          </section>
        </div>
      ) : null}

      <ContactMergeDialog
        availableContacts={contacts}
        description="Elige el contacto resultante. Esta accion fusiona contactos ya guardados en la app."
        errorMessage={mergeError}
        note="Al fusionar, las interacciones, referidos, ToDos e IDs externos quedaran asociados al contacto resultante."
        onClose={() => {
          if (merging) return;
          setMergeError("");
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
