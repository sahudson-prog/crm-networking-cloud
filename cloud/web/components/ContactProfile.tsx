"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { updateContactFlags, updateContactNetworkingStatus } from "../lib/contactActions";
import { readAllActiveContacts } from "../lib/cloudData";
import { cleanContactCompany, cleanContactRole, joinCompact, shortDate, statusClass } from "../lib/format";
import { dismissReferrals } from "../lib/referralActions";
import type {
  ContactProfileData,
  ContactReferralRow,
  ContactRow,
  ExternalInteractionSourceRow,
  InteractionParticipantRow,
  InteractionRow
} from "../lib/readModel";
import { ActivitySyncButton } from "./ActivitySyncButton";
import { CoachModule } from "./CoachPreview";
import { ContactEditorDialog } from "./ContactEditorDialog";
import { InteractionEditorDialog } from "./InteractionEditorDialog";
import { ReferralEditorDialog } from "./ReferralEditorDialog";
import { StatusBadge } from "./StatusBadge";
import { Button } from "./ui/Button";
import { Icon, type IconName } from "./ui/Icon";
import { ProviderIcon } from "./ui/ProviderIcon";

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
  const [editorOpen, setEditorOpen] = useState(false);
  const [interactionEditorOpen, setInteractionEditorOpen] = useState(false);
  const [editingInteraction, setEditingInteraction] = useState<InteractionRow | null>(null);

  useEffect(() => {
    setStatusValue(contact.networking_status || "Pendiente");
    setNetworkingFocus(Boolean(contact.networking_focus));
    setIsHeadhunter(Boolean(contact.is_headhunter));
    setStatusFeedback("");
    setFlagFeedback("");
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
              <ActivitySyncButton contact={contact} onSynced={onReload} showMessage square variant="single_contact" />
              <Button aria-label="Editar contacto" icon="edit" onClick={() => setEditorOpen(true)} square />
            </div>
          </div>

          <div className="contact-method-grid">
            <ContactEmailMethods values={emails.map((item) => item.email)} />
            <ContactPhoneMethods values={phones.map((item) => item.phone)} />
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
          <div className="contact-interaction-list">
            {interactions.length ? (
              interactions.map((interaction) => (
                <ContactInteraction
                  isOpen={expandedInteractions.has(interaction.id)}
                  key={interaction.id}
                  onOpenChange={(open) => setInteractionOpen(interaction.id, open)}
                  onEdit={() => openInteractionEditor(interaction)}
                  interaction={interaction}
                  participants={participantsByInteraction.get(interaction.id) ?? []}
                  sources={sourcesByInteraction.get(interaction.id) ?? []}
                />
              ))
            ) : (
              <div className="empty">Sin interacciones registradas.</div>
            )}
          </div>
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

function ContactInteraction({
  interaction,
  isOpen,
  onEdit,
  onOpenChange,
  participants,
  sources
}: {
  interaction: InteractionRow;
  isOpen: boolean;
  onEdit: () => void;
  onOpenChange: (open: boolean) => void;
  participants: InteractionParticipantRow[];
  sources: ExternalInteractionSourceRow[];
}) {
  const icon = interactionIcon(interaction.interaction_type);
  const title = interaction.subject || interactionLabelShort(interaction);
  const detail = interaction.user_notes_raw?.trim() || "";
  const preview = detail.replace(/\s+/g, " ").slice(0, 110);
  const sharedTooltip = sharedInteractionTooltip(participants);

  return (
    <details
      className={`contact-timeline-item ${interaction.interaction_type}`}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      open={isOpen}
    >
      <summary>
        <span className="contact-timeline-date">{shortDate(interaction.occurred_at)}</span>
        <span className={`interaction-icon ${interaction.interaction_type}`}>
          <Icon name={icon} />
        </span>
        <span className="shared-interaction-slot">
          {sharedTooltip ? (
            <span className="shared-interaction-indicator" title={sharedTooltip}>
              <Icon name="users" />
            </span>
          ) : null}
        </span>
        <span className="contact-timeline-main">
          <strong>{title}</strong>
          <span className="contact-timeline-preview">{preview}</span>
        </span>
        <ExternalSourceIndicator sources={sources} />
        <Button
          aria-label="Editar minuta"
          icon="edit"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onEdit();
          }}
          square
        />
      </summary>
      <div className="contact-timeline-detail">
        <p>{detail || "Sin minuta editable."}</p>
      </div>
    </details>
  );
}

function ExternalSourceIndicator({ sources }: { sources: ExternalInteractionSourceRow[] }) {
  const source = preferredExternalSource(sources);
  if (!source) return <span className="external-source-slot" />;

  const label = externalSourceLabel(source);
  const href = externalSourceHref(source);
  const content = (
    <>
      <ProviderIcon name="google" />
      <span className="sr-only">{label}</span>
    </>
  );

  if (href) {
    return (
      <a className="external-source-indicator" href={href} rel="noreferrer" target="_blank" title={`${label}. Abrir origen.`}>
        {content}
      </a>
    );
  }

  return (
    <span className="external-source-indicator disabled" title={`${label}. Link directo aun no disponible.`}>
      {content}
    </span>
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

function interactionIcon(type: InteractionRow["interaction_type"]): IconName {
  if (type === "calendar") return "calendar";
  if (type === "call") return "phone";
  if (type === "message") return "chat";
  if (type === "manual") return "plus";
  return "mail";
}

function interactionLabelShort(interaction: InteractionRow) {
  if (interaction.interaction_type === "calendar") return "Cita";
  if (interaction.interaction_type === "call") return "Llamada";
  if (interaction.interaction_type === "message") return "Mensaje";
  if (interaction.interaction_type === "manual") return "Interaccion manual";
  return interaction.direction === "outbound" ? "Correo enviado" : "Correo";
}

function groupParticipantsByInteraction(participants: InteractionParticipantRow[]) {
  return participants.reduce<Map<string, InteractionParticipantRow[]>>((acc, participant) => {
    if (!acc.has(participant.interaction_id)) acc.set(participant.interaction_id, []);
    acc.get(participant.interaction_id)?.push(participant);
    return acc;
  }, new Map());
}

function groupSourcesByInteraction(sources: ExternalInteractionSourceRow[]) {
  return sources.reduce<Map<string, ExternalInteractionSourceRow[]>>((acc, source) => {
    if (!acc.has(source.interaction_id)) acc.set(source.interaction_id, []);
    acc.get(source.interaction_id)?.push(source);
    return acc;
  }, new Map());
}

function preferredExternalSource(sources: ExternalInteractionSourceRow[]) {
  return sources.find((source) => source.external_url) ?? sources[0] ?? null;
}

function externalSourceLabel(source: ExternalInteractionSourceRow) {
  const service = source.source_service === "calendar" ? "Google Calendar" : source.source_service === "gmail" ? "Gmail" : "Google";
  const status = source.prevent_reimport ? " reimportacion bloqueada" : ` estado ${source.sync_status || "vinculado"}`;
  return `Origen externo: ${service};${status}`;
}

function externalSourceHref(source: ExternalInteractionSourceRow) {
  if (source.external_url) return source.external_url;
  if (source.source_service === "gmail") {
    const gmailId = stripProviderPrefix(source.external_id, "GMAIL_");
    return gmailId ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(gmailId)}` : "";
  }
  return "";
}

function stripProviderPrefix(value: string | null | undefined, prefix: string) {
  if (!value) return "";
  return value.toUpperCase().startsWith(prefix) ? value.slice(prefix.length) : value;
}

function sharedInteractionTooltip(participants: InteractionParticipantRow[]) {
  const visibleParticipants = dedupeParticipants(participants);
  if (visibleParticipants.length <= 1) return "";
  const uniqueContacts = new Set(
    visibleParticipants.map((participant) => participant.contact_id || participant.email_identity || participant.contact_name).filter(Boolean)
  );
  const intro = uniqueContacts.size > 1
    ? "Interaccion compartida con otros contactos."
    : "Interaccion con multiples direcciones.";
  return [
    intro,
    "Participantes:",
    ...visibleParticipants.map((participant) => `${roleLabel(participant.role)}: ${participantLabel(participant)}`)
  ].join("\n");
}

function dedupeParticipants(participants: InteractionParticipantRow[]) {
  const seen = new Set<string>();
  return participants.filter((participant) => {
    const key = [
      participant.role || "",
      participant.contact_id || "",
      (participant.email_identity || "").toLowerCase(),
      (participant.contact_name || "").toLowerCase()
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function participantLabel(participant: InteractionParticipantRow) {
  const name = participant.contact_name?.trim();
  const email = participant.email_identity?.trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || "Participante sin dato";
}

function roleLabel(role: string | null | undefined) {
  const cleanRole = (role || "").toUpperCase();
  if (cleanRole === "FROM") return "De";
  if (cleanRole === "TO") return "Para";
  if (cleanRole === "CC") return "CC";
  if (cleanRole === "BCC") return "CCO";
  return "Sin rol";
}

function normalizePhoneForLink(value: string) {
  const clean = value.replace(/[^\d+]/g, "");
  if (!clean) return "";
  if (clean.startsWith("+")) return clean;
  return clean;
}
