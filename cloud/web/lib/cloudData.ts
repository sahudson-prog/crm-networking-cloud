import { supabase } from "./supabaseClient";
import { activeInteractions } from "./interactionState";
import { buildDashboardKpis, parseLocalDate } from "./kpiCalculations";
import type {
  ContactRow,
  ExternalInteractionSourceRow,
  ContactProfileData,
  ContactReferralRow,
  HeadhunterCompanyRow,
  InteractionParticipantRow,
  InteractionRow,
  KpiPeriodMode,
  KpiTrend,
  MirrorSummary,
  ReferralActionRow,
  StatusCount,
  TodoRow
} from "./readModel";

const CONTACT_PAGE_SIZE = 500;
const CONTACT_MAX_ROWS = 2500;
const INTERACTION_MAX_ROWS = 2500;

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  return supabase;
}

async function countRows(table: string, filter?: (query: any) => any) {
  const client = requireSupabase();
  const base = client.from(table).select("*", { count: "exact", head: true });
  const { count, error } = await (filter ? filter(base) : base);
  if (error) throw error;
  return count ?? 0;
}

export async function readMirrorSummary(): Promise<MirrorSummary> {
  const [
    contacts,
    activeContacts,
    focusContacts,
    headhunters,
    interactions,
    todos,
    importBatches
  ] = await Promise.all([
    countRows("contacts"),
    countRows("contacts", (query) => query.eq("is_active", true)),
    countRows("contacts", (query) => query.eq("networking_focus", true).eq("is_active", true)),
    countRows("contacts", (query) => query.eq("is_headhunter", true).eq("is_active", true)),
    countRows("interactions"),
    countRows("todos", (query) => query.eq("status", "active")),
    countRows("import_batches")
  ]);

  return {
    contacts,
    activeContacts,
    focusContacts,
    headhunters,
    interactions,
    todos,
    importBatches
  };
}

export async function readStatusCounts(): Promise<StatusCount[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("contacts")
    .select("networking_status")
    .eq("is_active", true)
    .limit(CONTACT_MAX_ROWS);

  if (error) throw error;

  const grouped = ((data ?? []) as Array<{ networking_status: string | null }>).reduce<Record<string, number>>(
    (acc, row) => {
      const status = row.networking_status || "sin estado";
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    },
    {}
  );

  const officialOrder = [
    "Pendiente",
    "Contactado",
    "Agendado",
    "Cita concretada",
    "Agradecimiento enviado"
  ];

  return officialOrder
    .filter((status) => grouped[status])
    .map((status) => ({ status, count: grouped[status] }))
    .concat(
      Object.entries(grouped)
        .filter(([status]) => !officialOrder.includes(status))
        .map(([status, count]) => ({ status, count }))
    );
}

export async function readRecentContacts(limit = 8): Promise<ContactRow[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("contacts")
    .select("id,display_name,company,role,networking_status,networking_focus,is_headhunter,is_active,updated_at")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as ContactRow[];
}

export async function readRecentInteractions(limit = 8): Promise<InteractionRow[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("interactions")
    .select("id,legacy_entry_id,interaction_type,direction,occurred_at,subject,user_notes_raw,updated_at,metadata")
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;
  return activeInteractions((data ?? []) as InteractionRow[]);
}

export async function readAllInteractions(): Promise<InteractionRow[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("interactions")
    .select("id,legacy_entry_id,interaction_type,direction,occurred_at,subject,user_notes_raw,updated_at,metadata")
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .limit(INTERACTION_MAX_ROWS);

  if (error) throw error;
  return activeInteractions((data ?? []) as InteractionRow[]);
}

export async function readInteractionParticipants(): Promise<InteractionParticipantRow[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("interaction_participants")
    .select("interaction_id,contact_id,email_identity,role")
    .limit(INTERACTION_MAX_ROWS * 3);

  if (error) throw error;
  return (data ?? []) as InteractionParticipantRow[];
}

export async function readInteractionParticipantsForInteractions(interactionIds: string[]): Promise<InteractionParticipantRow[]> {
  if (!interactionIds.length) return [];
  const client = requireSupabase();
  const { data, error } = await client
    .from("interaction_participants")
    .select("interaction_id,contact_id,email_identity,role,contacts(display_name)")
    .in("interaction_id", interactionIds)
    .limit(INTERACTION_MAX_ROWS * 3);

  if (error) throw error;
  return ((data ?? []) as Array<InteractionParticipantRow & { contacts?: { display_name?: string | null } | Array<{ display_name?: string | null }> | null }>).map((row) => ({
    interaction_id: row.interaction_id,
    contact_id: row.contact_id,
    email_identity: row.email_identity,
    role: row.role,
    contact_name: Array.isArray(row.contacts) ? row.contacts[0]?.display_name ?? null : row.contacts?.display_name ?? null
  }));
}

export async function readExternalSourcesForInteractions(interactionIds: string[]): Promise<ExternalInteractionSourceRow[]> {
  if (!interactionIds.length) return [];
  const client = requireSupabase();
  const { data, error } = await client
    .from("external_interaction_sources")
    .select("interaction_id,provider,source_service,external_object_type,external_id,external_thread_id,external_url,sync_status,prevent_reimport")
    .in("interaction_id", interactionIds)
    .eq("is_active", true)
    .limit(INTERACTION_MAX_ROWS * 2);

  if (error) throw error;
  return (data ?? []) as ExternalInteractionSourceRow[];
}

export async function readUserSetting(settingKey: string): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("user_settings")
    .select("setting_value")
    .eq("setting_key", settingKey)
    .maybeSingle();

  if (error) throw error;
  return data?.setting_value ?? "";
}

export async function readActiveTodos(input: { limit?: number; contactId?: string } = {}): Promise<TodoRow[]> {
  const client = requireSupabase();
  const limit = input.limit ?? 12;
  let query = client
    .from("todos")
    .select("id,todo_type,engine_type,status,summary,reason,created_at,object_type,object_id,current_state,suggested_state,evidence,actions_json")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.contactId) {
    query = query.eq("object_id", input.contactId);
  }

  const { data, error } = await query;

  if (error) throw error;
  return (data ?? []) as TodoRow[];
}

export async function readAllActiveContacts(): Promise<ContactRow[]> {
  const client = requireSupabase();
  const rows: ContactRow[] = [];

  for (let from = 0; from < CONTACT_MAX_ROWS; from += CONTACT_PAGE_SIZE) {
    const to = from + CONTACT_PAGE_SIZE - 1;
    const { data, error } = await client
      .from("contacts")
      .select(
        "id,display_name,company,role,networking_status,networking_focus,is_headhunter,headhunter_domains,is_active,updated_at,contact_emails(email,domain),contact_phones(phone)"
      )
      .eq("is_active", true)
      .order("display_name", { ascending: true })
      .range(from, to);

    if (error) throw error;
    const page = (data ?? []) as ContactRow[];
    rows.push(...page);
    if (page.length < CONTACT_PAGE_SIZE) break;
  }

  return rows;
}

export async function readContactById(contactId: string): Promise<ContactRow | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("contacts")
    .select(
      "id,display_name,company,role,networking_status,networking_focus,is_headhunter,headhunter_domains,is_active,updated_at,contact_emails(email,domain),contact_phones(phone)"
    )
    .eq("id", contactId)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as ContactRow | null;
}

export async function readContactInteractions(contactId: string, limit = 60): Promise<InteractionRow[]> {
  const client = requireSupabase();
  const { data: participantData, error: participantError } = await client
    .from("interaction_participants")
    .select("interaction_id")
    .eq("contact_id", contactId)
    .limit(limit * 3);

  if (participantError) throw participantError;
  const interactionIds = Array.from(
    new Set(((participantData ?? []) as Array<{ interaction_id: string }>).map((row) => row.interaction_id).filter(Boolean))
  ).slice(0, limit);

  if (!interactionIds.length) return [];

  const { data, error } = await client
    .from("interactions")
    .select("id,legacy_entry_id,interaction_type,direction,occurred_at,subject,user_notes_raw,updated_at,metadata")
    .in("id", interactionIds)
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;
  return activeInteractions((data ?? []) as InteractionRow[]);
}

export async function readContactReferrals(contactId: string): Promise<ContactReferralRow[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("referrals")
    .select("id,referred_by_contact_id,linked_contact_id,referred_name,referred_company,referred_role,referred_email,referred_phone,notes,status,updated_at")
    .eq("referred_by_contact_id", contactId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(80);

  if (error) throw error;
  const referrals = (data ?? []) as Array<{
    id: string;
    referred_by_contact_id: string;
    linked_contact_id: string | null;
    referred_name: string;
    referred_company: string;
    referred_role: string;
    referred_email: string;
    referred_phone: string;
    notes: string;
    status: string;
  }>;
  const linkedIds = Array.from(new Set(referrals.map((row) => row.linked_contact_id).filter((id): id is string => Boolean(id))));
  const linkedContacts = linkedIds.length ? await readContactsByIds(linkedIds) : new Map<string, ContactRow>();

  return referrals.map((row) => {
    const linked = row.linked_contact_id ? linkedContacts.get(row.linked_contact_id) : null;
    return {
      id: row.id,
      referredByContactId: row.referred_by_contact_id,
      referredName: row.referred_name || "Referido sin nombre",
      referredCompany: row.referred_company || "",
      referredRole: row.referred_role || "",
      referredEmail: row.referred_email || "",
      referredPhone: row.referred_phone || "",
      notes: row.notes || "",
      status: row.status || "active",
      linkedContactId: row.linked_contact_id,
      linkedContactName: linked?.display_name || "",
      linkedContactStatus: linked?.networking_status || ""
    };
  });
}

export async function readContactProfile(contactId: string): Promise<ContactProfileData | null> {
  const [contact, interactions, referrals, todos] = await Promise.all([
    readContactById(contactId),
    readContactInteractions(contactId),
    readContactReferrals(contactId),
    readActiveTodos({ contactId, limit: 24 })
  ]);

  if (!contact) return null;
  const interactionIds = interactions.map((interaction) => interaction.id);
  const [interactionParticipants, externalInteractionSources] = await Promise.all([
    readInteractionParticipantsForInteractions(interactionIds),
    readExternalSourcesForInteractions(interactionIds)
  ]);
  return { contact, interactions, interactionParticipants, externalInteractionSources, referrals, todos };
}

async function readContactsByIds(contactIds: string[]) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("contacts")
    .select("id,display_name,company,role,networking_status,networking_focus,is_headhunter,is_active,updated_at")
    .in("id", contactIds);

  if (error) throw error;
  return new Map(((data ?? []) as ContactRow[]).map((contact) => [contact.id, contact]));
}

export async function readDashboardKpis(mode: KpiPeriodMode = "weekly"): Promise<KpiTrend[]> {
  const [contacts, interactions, participants, networkingStartValue] = await Promise.all([
    readAllActiveContacts(),
    readAllInteractions(),
    readInteractionParticipants(),
    readUserSetting("Fecha_Inicio_Networking")
  ]);

  return buildDashboardKpis({
    contacts,
    interactions,
    participants,
    mode,
    networkingStartDate: parseLocalDate(networkingStartValue)
  });
}

export async function readHeadhunterCompanies(limit = 8): Promise<HeadhunterCompanyRow[]> {
  const [contacts, interactions, participants] = await Promise.all([
    readAllActiveContacts(),
    readAllInteractions(),
    readInteractionParticipants()
  ]);

  const participantsByContact = new Map<string, Set<string>>();
  for (const participant of participants) {
    if (!participant.contact_id) continue;
    if (!participantsByContact.has(participant.contact_id)) participantsByContact.set(participant.contact_id, new Set());
    participantsByContact.get(participant.contact_id)?.add(participant.interaction_id);
  }
  const interactionsById = new Map(interactions.map((interaction) => [interaction.id, interaction]));
  const statusRank = new Map([
    ["Pendiente", 1],
    ["Contactado", 2],
    ["Agendado", 3],
    ["Cita concretada", 4],
    ["Agradecimiento enviado", 5]
  ]);

  const byDomain = new Map<string, {
    contacts: Set<string>;
    interactionIds: Set<string>;
    status: string;
    last: InteractionRow | null;
  }>();

  for (const contact of contacts.filter((item) => item.networking_focus && item.is_headhunter)) {
    for (const domain of domainsForContact(contact, true)) {
      if (!byDomain.has(domain)) {
        byDomain.set(domain, { contacts: new Set(), interactionIds: new Set(), status: "Pendiente", last: null });
      }
      const current = byDomain.get(domain);
      if (!current) continue;
      current.contacts.add(contact.id);
      if ((statusRank.get(contact.networking_status) ?? 0) > (statusRank.get(current.status) ?? 0)) {
        current.status = contact.networking_status;
      }
      for (const interactionId of participantsByContact.get(contact.id) ?? []) {
        current.interactionIds.add(interactionId);
        const interaction = interactionsById.get(interactionId);
        if (!interaction?.occurred_at) continue;
        if (!current.last || timestamp(interaction.occurred_at) > timestamp(current.last.occurred_at)) {
          current.last = interaction;
        }
      }
    }
  }

  const now = Date.now();
  return Array.from(byDomain.entries())
    .map(([domain, value]) => ({
      domain,
      contactCount: value.contacts.size,
      contactIds: Array.from(value.contacts),
      interactionIds: Array.from(value.interactionIds),
      status: value.status,
      lastInteractionAt: value.last?.occurred_at ?? null,
      daysSince: value.last?.occurred_at ? Math.floor((now - timestamp(value.last.occurred_at)) / 86400000) : null,
      type: value.last?.interaction_type ?? "Sin interaccion",
      subject: value.last?.subject ?? ""
    }))
    .sort((a, b) => (b.daysSince ?? 99999) - (a.daysSince ?? 99999))
    .slice(0, limit);
}

export async function readReferralActions(limit = 8): Promise<ReferralActionRow[]> {
  const [contacts, interactions] = await Promise.all([readAllActiveContacts(), readAllInteractions()]);
  const client = requireSupabase();
  const { data, error } = await client
    .from("referrals")
    .select("id,referred_by_contact_id,linked_contact_id,referred_name,notes,status,created_at")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit * 3);

  if (error) throw error;

  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const interactionContactIds = new Set<string>();
  const participants = await readInteractionParticipants();
  const interactionIds = new Set(interactions.map((interaction) => interaction.id));
  for (const participant of participants) {
    if (participant.contact_id && interactionIds.has(participant.interaction_id)) {
      interactionContactIds.add(participant.contact_id);
    }
  }

  return ((data ?? []) as Array<{
    id: string;
    referred_by_contact_id: string;
    linked_contact_id: string | null;
    referred_name: string;
    notes: string;
    status: string;
  }>)
    .filter((row) => interactionContactIds.has(row.referred_by_contact_id) || !row.linked_contact_id)
    .slice(0, limit)
    .map((row) => {
      const referrer = contactsById.get(row.referred_by_contact_id);
      const linked = row.linked_contact_id ? contactsById.get(row.linked_contact_id) : null;
      return {
        id: row.id,
        referrerName: referrer?.display_name || "Desconocido",
        referredName: linked?.display_name || row.referred_name || "Referido sin nombre",
        status: linked?.networking_status || "Sin contacto CRM",
        notes: row.notes || ""
      };
    });
}

function timestamp(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function groupParticipants(participants: InteractionParticipantRow[]) {
  return participants.reduce<Map<string, InteractionParticipantRow[]>>((acc, participant) => {
    if (!acc.has(participant.interaction_id)) acc.set(participant.interaction_id, []);
    acc.get(participant.interaction_id)?.push(participant);
    return acc;
  }, new Map());
}

function contactIdsForInteraction(interactionId: string, participantsByInteraction: Map<string, InteractionParticipantRow[]>) {
  return Array.from(
    new Set(
      (participantsByInteraction.get(interactionId) ?? [])
        .map((participant) => participant.contact_id)
        .filter((contactId): contactId is string => Boolean(contactId))
    )
  );
}

function domainsForContact(contact: ContactRow | undefined, includeNoEmail = false) {
  if (!contact) return [];
  const domains = new Set<string>();
  for (const domain of contact.headhunter_domains ?? []) {
    if (domain) domains.add(normalizeDomain(domain));
  }
  for (const email of contact.contact_emails ?? []) {
    if (email.domain) domains.add(normalizeDomain(email.domain));
  }
  const clean = Array.from(domains).filter(Boolean);
  return clean.length ? clean : includeNoEmail ? ["NO EMAIL"] : [];
}

function normalizeDomain(domain: string) {
  const clean = domain.trim().toLowerCase();
  if (!clean) return "";
  return clean.startsWith("@") ? clean : `@${clean}`;
}
