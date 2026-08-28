"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { updateContactFlags, updateContactNetworkingStatus } from "../lib/contactActions";
import { readAllActiveContacts } from "../lib/cloudData";
import { cleanContactCompany, cleanContactRole, joinCompact, statusClass } from "../lib/format";
import { dismissReferrals } from "../lib/referralActions";
import type {
  ContactProfileData,
  ContactReferralRow,
  ContactRow,
  InteractionRow
} from "../lib/readModel";
import { ActivitySyncButton, type ActivitySyncNotice } from "./ActivitySyncButton";
import { CoachModule } from "./CoachPreview";
import { ContactDataSyncButton, type ContactDataSyncNotice } from "./ContactDataSyncButton";
import { ContactEditorDialog } from "./ContactEditorDialog";
import { groupParticipantsByInteraction, groupSourcesByInteraction, InteractionTimelineList } from "./InteractionTimelineList";
import { InteractionEditorDialog } from "./InteractionEditorDialog";
import { ObjectiveChips } from "./ObjectiveSelector";
import { ReferralEditorDialog } from "./ReferralEditorDialog";
import { StatusBadge } from "./StatusBadge";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

type ContactProfileProps = {
  profile: ContactProfileData;
  onReload: () => void;
};

const NETWORKING_STATUSES = [
  "Pendiente",
  "Contactado",
  "Agendado",
  "Cita concretada",
  "Agradecimiento enviado"
];

export function ContactProfile({ profile, onReload }: ContactProfileProps) {
  const { contact, interactions, interactionParticipants, externalInteractionSources, referrals, todos } = profile;
  const emails = contact.contact_emails ?? [];
  const phones = contact.contact_phones ?? [];
  const objectives = (contact.contact_objective_assignments ?? [])
    .map((assignment) => assignment.objective)
    .filter((objective): objective is NonNullable<typeof objective> => Boolean(objective));
  const participantsByInteraction = useMemo(
    () => groupParticipantsByInteraction(interactionParticipants),
    [interactionParticipants]
  );
  const sourcesByInteraction = useMemo(
    () => groupSourcesByInteraction(externalInteractionSources),
    [externalInteractionSources]
  );
  const [expandedInteractions, setExpandedInteractions] = useState<Set<string>>(new Set());
  const [statusValue, setStatusValue] = useState(contact.networking_status || "Pendiente");
  const [statusFeedback, setStatusFeedback] = useState("");
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [networkingFocus, setNetworkingFocus] = useState(Boolean(contact.networking_focus));
  const [isHeadhunter, setIsHeadhunter] = useState(Boolean(contact.is_headhunter));
  const [savingFlag, setSavingFlag] = useState<"networking_focus" | "is_headhunter" | null>(null);
  const [flagFeedback, setFlagFeedback] = useState("");
  const [contactDataSyncNotice, setContactDataSyncNotice] = useState<ContactDataSyncNotice | null>(null);
  const [activitySyncNotice, setActivitySyncNotice] = useState<ActivitySyncNotice | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [interactionEditorOpen, setInteractionEditorOpen] = useState(false);
  const [editingInteraction, setEditingInteraction] = useState<InteractionRow | null>(null);

  useEffect(() => {
    setStatusValue(contact.networking_status || "Pendiente");
    setNetworkingFocus(Boolean(contact.networking_focus));
    setIsHeadhunter(Boolean(contact.is_headhunter));
    setStatusFeedback("");
    setFlagFeedback("");
    setContactDataSyncNotice(null);
    setActivitySyncNotice(null);
    setExpandedInteractions(new Set());
  }, [contact.id, contact.networking_focus, contact.is_headhunter, contact.networking_status]);

  async function saveNetworkingStatus(nextStatus: string) {
    const previous = statusValue;
    setStatusValue(nextStatus);
    setStatusFeedback("");
    setIsSavingStatus(true);
    try {
      await updateContactNetworkingStatus(contact.id, nextStatus);
      setStatusFeedback("Guardado");
      onReload();
    } catch (error) {
      setStatusValue(previous);
      setStatusFeedback(error instanceof Error ? error.message : "No pude guardar el estado.");
    } finally {
      setIsSavingStatus(false);
    }
  }

  async function saveContactFlag(flag: "networking_focus" | "is_headhunter", nextValue: boolean) {
    const previousFocus = networkingFocus;
    const previousHeadHunter = isHeadhunter;
    if (flag === "networking_focus") setNetworkingFocus(nextValue);
    else setIsHeadhunter(nextValue);
    setFlagFeedback("");
    setSavingFlag(flag);

    try {
      await updateContactFlags(contact.id, {
        networkingFocus: flag === "networking_focus" ? nextValue : undefined,
        isHeadhunter: flag === "is_headhunter" ? nextValue : undefined,
        source: "contact_profile"
      });
      setFlagFeedback("Guardado");
      onReload();
    } catch (error) {
      setNetworkingFocus(previousFocus);
      setIsHeadhunter(previousHeadHunter);
      setFlagFeedback(error instanceof Error ? error.message : "No pude guardar el cambio.");
    } finally {
      setSavingFlag(null);
    }
  }

  function setInteractionOpen(interactionId: string, open: boolean) {
    setExpandedInteractions((previous) => {
      const next = new Set(previous);
      if (open) next.add(interactionId);
      else next.delete(interactionId);
      return next;
    });
  }

  function openInteractionEditor(interaction: InteractionRow | null) {
    setEditingInteraction(interaction);
    setInteractionEditorOpen(true);
  }

  return (
    <div className="contact-profile-page">
      <Link className="button secondary contact-back-link" href="/contactos">
        <Icon name="arrowLeft" />
        <span>Contactos</span>
      </Link>

      <div className="contact-profile-grid">
        <section className="panel contact-identity-panel">
          <div className="contact-identity-head">
            <div>
              <h1>{contact.display_name || "Contacto sin nombre"}</h1>
              <ContactCompanyRoleLine company={contact.company} role={contact.role} />
            </div>
            <div className="contact-identity-actions">
              <ContactDataSyncButton
                contact={contact}
                onNoticeChange={setContactDataSyncNotice}
                onSynced={onReload}
              />
              <Button aria-label="Editar contacto" icon="edit" onClick={() => setEditorOpen(true)} square />
            </div>
          </div>

          {contactDataSyncNotice ? (
            <div
              className={`contact-sync-notice ${contactDataSyncNotice.tone} ${contactDataSyncNotice.busy ? "busy" : ""}`}
              role={contactDataSyncNotice.tone === "error" ? "alert" : "status"}
            >
              {contactDataSyncNotice.text}
            </div>
          ) : null}

          <div className="contact-method-grid">
            <ContactEmailMethods values={emails.map((item) => item.email)} />
            <ContactPhoneMethods values={phones.map((item) => item.phone)} />
          </div>

          <div className="contact-objectives-block">
            <span className="contact-mini-label">Objetivos</span>
            <ObjectiveChips objectives={objectives} />
          </div>

          <div className="contact-state-strip">
            <ContactFlagToggle
              active={networkingFocus}
              disabled={savingFlag !== null}
              label="Foco networking"
              onChange={(nextValue) => saveContactFlag("networking_focus", nextValue)}
            />
            <ContactFlagToggle
              active={isHeadhunter}
              disabled={savingFlag !== null}
              label="Headhunter"
              onChange={(nextValue) => saveContactFlag("is_headhunter", nextValue)}
            />
            <div className="contact-status-control">
              <span className="contact-mini-label">Estado networking</span>
              <select
                className={`contact-status-select ${statusClass(statusValue)}`}
                disabled={isSavingStatus}
                onChange={(event) => saveNetworkingStatus(event.target.value)}
                value={statusValue}
              >
                {NETWORKING_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              {statusFeedback ? <span className="contact-status-feedback">{statusFeedback}</span> : null}
            </div>
            {flagFeedback ? <span className="contact-status-feedback contact-flag-feedback">{flagFeedback}</span> : null}
          </div>
        </section>

        <aside className="contact-side-stack">
          <section className="panel contact-coach-panel">
            <CoachModule
              botSize="mini"
              contactId={contact.id}
              interactions={interactions}
              maxVisible={4}
              onExecuted={onReload}
              todos={todos}
              total={todos.length}
              variant="contact"
            />
          </section>

          <ContactReferrals contact={contact} onReload={onReload} referrals={referrals} />
        </aside>

        <section className="panel contact-interactions-panel">
          <div className="panel-header">
            <h2 className="panel-title">Ultimas interacciones</h2>
            <div className="toolbar">
              <ActivitySyncButton
                contact={contact}
                onNoticeChange={setActivitySyncNotice}
                onSynced={onReload}
                square
                variant="single_contact"
              />
              <Button
                aria-label="Expandir todas"
                icon="expand"
                onClick={() => setExpandedInteractions(new Set(interactions.map((interaction) => interaction.id)))}
                square
              />
              <Button aria-label="Contraer todas" icon="collapse" onClick={() => setExpandedInteractions(new Set())} square />
              <Button aria-label="Agregar interaccion" icon="plus" onClick={() => openInteractionEditor(null)} square />
            </div>
          </div>
          {activitySyncNotice ? (
            <div
              className={`contact-sync-notice ${activitySyncNotice.tone} ${activitySyncNotice.busy ? "busy" : ""}`}
              role={activitySyncNotice.tone === "error" ? "alert" : "status"}
            >
              {activitySyncNotice.text}
            </div>
          ) : null}
          <InteractionTimelineList
            expandedIds={expandedInteractions}
            interactions={interactions}
            participantsByInteraction={participantsByInteraction}
            sourcesByInteraction={sourcesByInteraction}
            onEdit={openInteractionEditor}
            onOpenChange={setInteractionOpen}
          />
        </section>
      </div>
      <ContactEditorDialog
        contact={contact}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={() => onReload()}
      />
      <InteractionEditorDialog
        contact={contact}
        interaction={editingInteraction}
        open={interactionEditorOpen}
        onClose={() => setInteractionEditorOpen(false)}
        onSaved={onReload}
      />
    </div>
  );
}

function ContactCompanyRoleLine({ company, role }: { company: string; role: string }) {
  const cleanCompany = cleanContactCompany(company);
  const cleanRole = cleanContactRole(role);
  return (
    <p className="contact-company-role-line">
      <span className={cleanCompany ? "" : "empty-meta"}>{cleanCompany || "Sin empresa"}</span>
      <span className="contact-meta-separator">·</span>
      <span className={cleanRole ? "" : "empty-meta"}>{cleanRole || "Sin cargo"}</span>
    </p>
  );
}

function ContactEmailMethods({ values }: { values: string[] }) {
  const cleanValues = values.map((value) => value.trim()).filter(Boolean);
  return (
    <div className="contact-method-card">
      <span className="contact-mini-label">Correos</span>
      {cleanValues.length ? (
        cleanValues.map((value) => (
          <div className="contact-method-row" key={value}>
            <strong>{value}</strong>
            <div className="contact-method-actions">
              <a className="contact-method-icon" href={`mailto:${encodeURIComponent(value)}`} title="Redactar correo">
                <Icon name="mail" />
              </a>
              <a
                className="contact-method-icon"
                href={`https://calendar.google.com/calendar/render?action=TEMPLATE&add=${encodeURIComponent(value)}`}
                rel="noreferrer"
                target="_blank"
                title="Crear cita"
              >
                <Icon name="calendar" />
              </a>
            </div>
          </div>
        ))
      ) : (
        <em>sin datos</em>
      )}
    </div>
  );
}

function ContactPhoneMethods({ values }: { values: string[] }) {
  const cleanValues = values.map((value) => value.trim()).filter(Boolean);
  return (
    <div className="contact-method-card">
      <span className="contact-mini-label">Telefonos</span>
      {cleanValues.length ? (
        cleanValues.map((value) => {
          const phoneForLink = normalizePhoneForLink(value);
          return (
            <div className="contact-method-row" key={value}>
              <strong>{value}</strong>
              <div className="contact-method-actions">
                <a className="contact-method-icon" href={phoneForLink ? `tel:${phoneForLink}` : "#"} title="Llamar">
                  <Icon name="phone" />
                </a>
                <a
                  className="contact-method-icon"
                  href={phoneForLink ? `https://wa.me/${phoneForLink.replace(/^\+/, "")}` : "#"}
                  rel="noreferrer"
                  target="_blank"
                  title="Escribir mensaje"
                >
                  <Icon name="chat" />
                </a>
              </div>
            </div>
          );
        })
      ) : (
        <em>sin datos</em>
      )}
    </div>
  );
}

function ContactFlagToggle({
  active,
  disabled,
  label,
  onChange
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onChange: (active: boolean) => void;
}) {
  return (
    <button
      aria-label={`${label}: ${active ? "activo" : "inactivo"}`}
      aria-pressed={active}
      className="readonly-toggle-wrap flag-toggle-button"
      disabled={disabled}
      onClick={() => onChange(!active)}
      type="button"
    >
      <span className="contact-mini-label">{label}</span>
      <span className={`readonly-toggle ${active ? "active" : ""}`}>
        <span />
      </span>
    </button>
  );
}

function ContactReferrals({
  contact,
  onReload,
  referrals
}: {
  contact: ContactRow;
  onReload: () => void;
  referrals: ContactReferralRow[];
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingReferral, setEditingReferral] = useState<ContactReferralRow | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [deletingReferrals, setDeletingReferrals] = useState(false);
  const [selectedReferralIds, setSelectedReferralIds] = useState<Set<string>>(new Set());
  const [loadMessage, setLoadMessage] = useState("");

  useEffect(() => {
    setSelectedReferralIds((previous) => new Set(referrals.filter((referral) => previous.has(referral.id)).map((referral) => referral.id)));
  }, [referrals]);

  async function ensureContactsLoaded(force = false) {
    if (!force && (contacts.length || loadingContacts)) return;
    setLoadingContacts(true);
    setLoadMessage("");
    try {
      setContacts(await readAllActiveContacts());
    } catch (error) {
      setLoadMessage(error instanceof Error ? error.message : "No pude cargar contactos para vincular.");
    } finally {
      setLoadingContacts(false);
    }
  }

  function openReferralEditor(referral: ContactReferralRow | null) {
    setEditingReferral(referral);
    setEditorOpen(true);
    void ensureContactsLoaded();
  }

  function toggleReferralSelection(referralId: string, selected: boolean) {
    setSelectedReferralIds((previous) => {
      const next = new Set(previous);
      if (selected) next.add(referralId);
      else next.delete(referralId);
      return next;
    });
  }

  async function deleteSelectedReferrals() {
    const ids = Array.from(selectedReferralIds);
    if (!ids.length) return;
    const confirmed = window.confirm(`Eliminar ${ids.length} referido${ids.length === 1 ? "" : "s"} de esta ficha?`);
    if (!confirmed) return;

    setDeletingReferrals(true);
    setLoadMessage("");
    try {
      await dismissReferrals(ids, "contact_profile");
      setSelectedReferralIds(new Set());
      onReload();
    } catch (error) {
      setLoadMessage(error instanceof Error ? error.message : "No pude eliminar los referidos.");
    } finally {
      setDeletingReferrals(false);
    }
  }

  return (
    <section className="panel contact-referrals-panel">
      <div className="panel-header">
        <h2 className="panel-title">Contactos referidos</h2>
        <div className="toolbar">
          {selectedReferralIds.size ? (
            <Button
              aria-label="Eliminar referidos seleccionados"
              disabled={deletingReferrals}
              icon="trash"
              onClick={deleteSelectedReferrals}
              square
              tone="danger"
            />
          ) : null}
          <Button aria-label="Agregar referido" icon="plus" onClick={() => openReferralEditor(null)} square />
        </div>
      </div>
      <div className="contact-referral-list">
        {referrals.length ? (
          referrals.map((referral) => (
            <ContactReferralCard
              key={referral.id}
              onEdit={() => openReferralEditor(referral)}
              onSelect={(selected) => toggleReferralSelection(referral.id, selected)}
              referral={referral}
              selected={selectedReferralIds.has(referral.id)}
            />
          ))
        ) : (
          <div className="empty">Aun no hay contactos referidos vinculados a este perfil.</div>
        )}
      </div>
      {loadingContacts ? <span className="meta">Cargando contactos...</span> : null}
      {loadMessage ? <span className="danger-text">{loadMessage}</span> : null}
      <ReferralEditorDialog
        contacts={contacts}
        open={editorOpen}
        referral={editingReferral}
        referrerContact={contact}
        onClose={() => setEditorOpen(false)}
        onContactSaved={() => {
          void ensureContactsLoaded(true);
          onReload();
        }}
        onSaved={onReload}
      />
    </section>
  );
}

function ContactReferralCard({
  onEdit,
  onSelect,
  referral,
  selected
}: {
  onEdit: () => void;
  onSelect: (selected: boolean) => void;
  referral: ContactReferralRow;
  selected: boolean;
}) {
  const linked = Boolean(referral.linkedContactId);
  return (
    <div className="contact-referral-card">
      <label className="contact-referral-check" title="Seleccionar referido">
        <input checked={selected} onChange={(event) => onSelect(event.target.checked)} type="checkbox" />
      </label>
      <div className="contact-referral-note">
        <strong>{referral.referredName}</strong>
        <span>{joinCompact([referral.notes, referral.referredCompany, referral.referredRole])}</span>
      </div>
      <div className="contact-referral-link-row">
        <div>
          {linked ? (
            <>
              <Link href={`/contactos?contactId=${encodeURIComponent(referral.linkedContactId || "")}`}>
                {referral.linkedContactName || "Contacto vinculado"}
              </Link>
              <StatusBadge status={referral.linkedContactStatus || "Pendiente"} />
            </>
          ) : null}
        </div>
        <Button onClick={onEdit} tone={linked ? "positive" : "primary"}>{linked ? "Vinculado" : "Vincular"}</Button>
      </div>
    </div>
  );
}

function normalizePhoneForLink(value: string) {
  const clean = value.replace(/[^\d+]/g, "");
  if (!clean) return "";
  if (clean.startsWith("+")) return clean;
  return clean;
}
