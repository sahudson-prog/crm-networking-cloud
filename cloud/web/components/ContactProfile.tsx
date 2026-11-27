"use client";

import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isValidEmail, updateContactFlags, updateContactNetworkingStatus } from "../lib/contactActions";
import { readAllActiveContacts } from "../lib/cloudData";
import { cleanContactCompany, cleanContactRole, joinCompact, statusClass } from "../lib/format";
import { dismissReferrals } from "../lib/referralActions";
import { readGoogleOAuthOperationEligibility } from "../lib/googleSyncAuthorization";
import { whatsappPhoneForLink } from "../lib/phoneValidation";
import type {
  ContactProfileData,
  ContactReferralRow,
  ContactRow,
  InteractionRow
} from "../lib/readModel";
import { useWorkspace } from "./WorkspaceState";
import { CoachModule } from "./CoachPreview";
import { ContactDataSyncButton, type ContactDataSyncNotice } from "./ContactDataSyncButton";
import { ContactEditorDialog } from "./ContactEditorDialog";
import { groupParticipantsByInteraction, groupSourcesByInteraction, InteractionTimelineList } from "./InteractionTimelineList";
import { InteractionEditorDialog } from "./InteractionEditorDialog";
import { ContactPrioritiesEditor } from "./ContactPrioritiesEditor";
import { ReferralEditorDialog } from "./ReferralEditorDialog";
import { StatusBadge } from "./StatusBadge";
import { Button } from "./ui/Button";
import { ViewSkeleton } from "./ui/ViewSkeleton";
import { Icon, type IconName } from "./ui/Icon";

type ContactProfileProps = {
  onboardingCoach?: ReactNode;
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

export function ContactProfile({ onboardingCoach, profile, onReload }: ContactProfileProps) {
  const workspace=useWorkspace();
  useEffect(()=>{workspace?.setProfile({profile,onReload});return()=>workspace?.setProfile(null);},[profile,onReload,workspace?.setProfile]);
  const { contact, interactions, interactionParticipants, externalInteractionSources, referrals, todos } = profile;
  const emails = contact.contact_emails ?? [];
  const phones = contact.contact_phones ?? [];
  const usableEmails = uniqueMedia(emails.map((item) => item.email), (value) => value.trim().toLowerCase(), isValidEmail);
  const usablePhones = uniqueMedia(phones.map((item) => item.phone), whatsappPhoneForLink, (value) => Boolean(whatsappPhoneForLink(value)));
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [interactionEditorOpen, setInteractionEditorOpen] = useState(false);
  const [editingInteraction, setEditingInteraction] = useState<InteractionRow | null>(null);
  const [contactSyncEnabled, setContactSyncEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    setContactSyncEnabled(false);
    readGoogleOAuthOperationEligibility("contacts").then(enabled => { if (active) setContactSyncEnabled(enabled); }).catch(() => {});
    return () => { active = false; };
  }, [contact.id]);

  useEffect(() => {
    setStatusValue(contact.networking_status || "Pendiente");
    setNetworkingFocus(Boolean(contact.networking_focus));
    setIsHeadhunter(Boolean(contact.is_headhunter));
    setStatusFeedback("");
    setFlagFeedback("");
    setContactDataSyncNotice(null);
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
      {(!workspace || onboardingCoach) ? <section className="contact-profile-coach" aria-label="Coach IA">
        {onboardingCoach ?? (
          <CoachModule
            contactId={contact.id}
            interactions={interactions}
            maxVisible={4}
            onExecuted={onReload}
            todos={todos}
            total={todos.length}
            variant="contact"
          />
        )}
      </section> : null}

      <div className={`contact-profile-grid ${onboardingCoach ? "onboarding-contact-profile-grid" : ""}`}>
        <section className="panel contact-identity-panel">
          <div className="contact-identity-head">
            <div>
              <h1>{contact.display_name || "Contacto sin nombre"}</h1>
            </div>
            <div className="contact-identity-actions">
              {contactSyncEnabled ? <ContactDataSyncButton
                contact={contact}
                onNoticeChange={setContactDataSyncNotice}
                onSynced={onReload}
              /> : null}
              <Button aria-label="Editar contacto" icon="edit" onClick={() => setEditorOpen(true)} square />
            </div>
          </div>
          <div className="contact-identity-subtitle">
            <ContactCompanyRoleLine company={contact.company} role={contact.role} />
            <button aria-label={isHeadhunter ? "Cambiar a Persona" : "Cambiar a Headhunter"}
              aria-pressed={isHeadhunter} className={`contact-type-toggle ${isHeadhunter ? "headhunter" : "person"}`}
              disabled={savingFlag !== null} onClick={() => saveContactFlag("is_headhunter", !isHeadhunter)} type="button"
              title={isHeadhunter ? "Headhunter" : "Persona"}>
              <span className="contact-type-icon"><Icon name={isHeadhunter ? "circleDot" : "user"} /></span>
              {isHeadhunter ? <span>Headhunter</span> : null}
            </button>
          </div>

          {contactDataSyncNotice ? (
            <div
              className={`contact-sync-notice ${contactDataSyncNotice.tone} ${contactDataSyncNotice.busy ? "busy" : ""}`}
              role={contactDataSyncNotice.tone === "error" ? "alert" : "status"}
            >
              {contactDataSyncNotice.text}
            </div>
          ) : null}

          <div className="contact-state-strip">
            <ContactFlagToggle
              active={networkingFocus}
              disabled={savingFlag !== null}
              label={networkingFocus ? "En foco" : "Fuera de foco"}
              onChange={(nextValue) => saveContactFlag("networking_focus", nextValue)}
            />
            <div className="contact-status-control">
              <span className="sr-only">Estado networking</span>
              <select
                aria-label="Estado networking"
                style={{ width: `calc(${statusValue.length + 2}ch + 44px)` }}
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
          <div className="contact-objectives-block">
            <span className="contact-mini-label">Prioridades</span>
            <ContactPrioritiesEditor contactId={contact.id} objectives={objectives} onSaved={onReload} />
          </div>
          <div className="contact-primary-actions">
            <Button tone="primary" icon="plus" onClick={() => openInteractionEditor(null)}>Registrar interacción</Button>
            <div className="contact-secondary-actions">
              <ContactMediumAction label="Café" icon="coffee" media={usableEmails}
                href={(email) => `https://calendar.google.com/calendar/render?action=TEMPLATE&add=${encodeURIComponent(email)}`} external />
              <ContactMediumAction label="Correo" icon="mail" media={usableEmails}
                href={(email) => `mailto:${encodeURIComponent(email)}`} />
              <ContactMediumAction label="WhatsApp" icon="whatsapp" media={usablePhones}
                href={(phone) => `https://wa.me/${whatsappPhoneForLink(phone)}`} external />
            </div>
          </div>
          <h2 className="panel-title contact-data-title">Datos de contacto</h2>
          <div className="contact-method-grid">
            <ContactEmailMethods values={emails.map((item) => item.email)} />
            <ContactPhoneMethods values={phones.map((item) => item.phone)} />
          </div>
        </section>

        <aside className="contact-side-stack">
          <ContactReferrals contact={contact} onReload={onReload} referrals={referrals} />
        </aside>

        <section className="panel contact-interactions-panel">
          <div className="panel-header">
            <h2 className="panel-title">Historia</h2>
            <div className="toolbar">
              <Button
                aria-label="Expandir todas"
                icon="expand"
                onClick={() => setExpandedInteractions(new Set(interactions.map((interaction) => interaction.id)))}
                square
              />
              <Button aria-label="Contraer todas" icon="collapse" onClick={() => setExpandedInteractions(new Set())} square />
            </div>
          </div>
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

function ContactMediumAction({ label, icon, media, href, external = false }: {
  label: string; icon: IconName; media: string[]; href: (value: string) => string; external?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const symbol = <Icon name={icon} className={icon === "whatsapp" ? "whatsapp" : ""} />;
  const linkProps = external ? { target: "_blank", rel: "noreferrer" } : {};
  if (!media.length) return <button className="button secondary" type="button" disabled>{symbol}{label}</button>;
  if (media.length === 1) return <a className="button secondary" href={href(media[0])} {...linkProps}>{symbol}{label}</a>;
  return <Popover.Root open={open} onOpenChange={setOpen} modal>
    <Popover.Trigger asChild><button className="button secondary" type="button" aria-label={`Elegir medio para ${label}`}>
      {symbol}{label}
    </button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="contact-medium-popover" align="start" sideOffset={6} collisionPadding={12} aria-label={`Elegir medio para ${label}`}>
      {media.map((value) => <a key={value.toLowerCase()} href={href(value)} {...linkProps} onClick={() => setOpen(false)}>{value}</a>)}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

function uniqueMedia(values: string[], normalize: (value: string) => string, valid: (value: string) => boolean) {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    const key = normalize(value);
    if (!key || !valid(value) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
      {cleanValues.length ? (
        cleanValues.map((value) => (
          <div className="contact-method-row" key={value}>
            <a className="contact-method-value" href={`mailto:${encodeURIComponent(value)}`}><Icon name="mail" /><span>{value}</span></a>
          </div>
        ))
      ) : (
        <span className="contact-method-empty"><Icon name="mail" />Sin correo registrado</span>
      )}
    </div>
  );
}

function ContactPhoneMethods({ values }: { values: string[] }) {
  const cleanValues = values.map((value) => value.trim()).filter(Boolean);
  return (
    <div className="contact-method-card">
      {cleanValues.length ? (
        cleanValues.map((value) => {
          const phoneForLink = normalizePhoneForLink(value);
          return (
            <div className="contact-method-row" key={value}>
              <a className="contact-method-value" href={phoneForLink ? `tel:${phoneForLink}` : undefined}><Icon name="phone" /><span>{value}</span></a>
            </div>
          );
        })
      ) : (
        <span className="contact-method-empty"><Icon name="phone" />Sin teléfono registrado</span>
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
      {loadingContacts ? <ViewSkeleton kind="inline" label="Contactos vinculables" /> : null}
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
  const linkedActive = linked && referral.linkedContactActive;
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
          {linkedActive ? (
            <>
              <Link href={`/contactos?contactId=${encodeURIComponent(referral.linkedContactId || "")}`}>
                {referral.linkedContactName || "Contacto vinculado"}
              </Link>
              <StatusBadge status={referral.linkedContactStatus || "Pendiente"} />
            </>
          ) : null}
        </div>
        <Button onClick={onEdit} tone={linkedActive ? "positive" : "primary"}>{linkedActive ? "Vinculado" : "Vincular"}</Button>
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
