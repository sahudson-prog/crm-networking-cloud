import type { ContactRow, InteractionParticipantRow, InteractionRow, KpiPeriodMode, KpiTrend } from "./readModel";

type KpiPeriod = {
  start: Date;
  end: Date;
  label: string;
};

export function buildDashboardKpis(input: {
  contacts: ContactRow[];
  interactions: InteractionRow[];
  participants: InteractionParticipantRow[];
  mode: KpiPeriodMode;
  networkingStartDate?: Date | null;
  today?: Date;
}): KpiTrend[] {
  const today = startOfDay(input.today ?? new Date());
  const periods = buildKpiPeriods(input.mode, today, input.networkingStartDate ?? null, 12);
  const participantsByInteraction = groupParticipants(input.participants);
  const contactsById = new Map(input.contacts.map((contact) => [contact.id, contact]));
  const firstContactAt = new Map<string, number>();
  const firstDomainAt = new Map<string, number>();

  for (const interaction of input.interactions) {
    const occurredAt = dateValue(interaction.occurred_at);
    const contactIds = contactIdsForContactMadeInteraction(interaction, participantsByInteraction);
    if (!occurredAt || !contactIds.length) continue;

    for (const contactId of contactIds) {
      if (!firstContactAt.has(contactId) || occurredAt < (firstContactAt.get(contactId) ?? occurredAt)) {
        firstContactAt.set(contactId, occurredAt);
      }

      const contact = contactsById.get(contactId);
      for (const domain of domainsForContact(contact)) {
        if (!firstDomainAt.has(domain) || occurredAt < (firstDomainAt.get(domain) ?? occurredAt)) {
          firstDomainAt.set(domain, occurredAt);
        }
      }
    }
  }

  const cafes = periods.map((period) => ({
    label: period.label,
    total: input.interactions.filter((interaction) => inPeriod(interaction.occurred_at, period) && isCoffeeInteraction(interaction)).length
  }));

  const contactados = periods.map((period) => {
    const contactsInPeriod = new Set<string>();
    const firstInPeriod = new Set<string>();

    for (const interaction of input.interactions) {
      if (!inPeriod(interaction.occurred_at, period)) continue;
      for (const contactId of contactIdsForContactMadeInteraction(interaction, participantsByInteraction)) {
        contactsInPeriod.add(contactId);
        const firstAt = firstContactAt.get(contactId);
        if (firstAt && firstAt >= period.start.getTime() && firstAt < period.end.getTime()) firstInPeriod.add(contactId);
      }
    }

    return { label: period.label, total: contactsInPeriod.size, firstTime: firstInPeriod.size };
  });

  const hhContactados = periods.map((period) => {
    const domainsInPeriod = new Set<string>();
    const firstDomainsInPeriod = new Set<string>();

    for (const interaction of input.interactions) {
      if (!inPeriod(interaction.occurred_at, period)) continue;
      for (const contactId of contactIdsForContactMadeInteraction(interaction, participantsByInteraction)) {
        const contact = contactsById.get(contactId);
        for (const domain of domainsForContact(contact)) {
          domainsInPeriod.add(domain);
          const firstAt = firstDomainAt.get(domain);
          if (firstAt && firstAt >= period.start.getTime() && firstAt < period.end.getTime()) firstDomainsInPeriod.add(domain);
        }
      }
    }

    return { label: period.label, total: domainsInPeriod.size, firstTime: firstDomainsInPeriod.size };
  });

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  return [
    buildTrend({
      title: "Total cafes",
      description: "Citas + llamadas.",
      accumulated: input.interactions.filter((interaction) => isCoffeeInteraction(interaction) && dateValue(interaction.occurred_at) < dateValueFromDate(tomorrow)).length,
      mode: input.mode,
      points: cafes
    }),
    buildTrend({
      title: "Contactos realizados",
      description: "Contactos distintos que recibieron uno o mas mensajes o correos.",
      accumulated: countMapUntil(firstContactAt, tomorrow),
      mode: input.mode,
      points: contactados
    }),
    buildTrend({
      title: "Contactos HH realizados",
      description: "Empresas headhunter distintas contactadas por correo o mensaje.",
      accumulated: countMapUntil(firstDomainAt, tomorrow),
      mode: input.mode,
      points: hhContactados
    })
  ];
}

export function parseLocalDate(value: string | null | undefined) {
  const text = (value ?? "").trim();
  if (!text) return null;

  const ddmmyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return startOfDay(new Date(Number(year), Number(month) - 1, Number(day)));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
}

function buildKpiPeriods(mode: KpiPeriodMode, today: Date, networkingStartDate: Date | null, maxPeriods: number) {
  const current = mode === "monthly" ? startOfMonth(today) : startOfWeek(today);
  const oldest = new Date(current);
  if (mode === "monthly") {
    oldest.setMonth(current.getMonth() - maxPeriods + 1);
  } else {
    oldest.setDate(current.getDate() - (maxPeriods - 1) * 7);
  }

  const minimum = networkingStartDate
    ? maxDate(oldest, mode === "monthly" ? startOfMonth(networkingStartDate) : startOfWeek(networkingStartDate))
    : oldest;

  const periods: KpiPeriod[] = [];
  const cursor = new Date(minimum);
  while (cursor.getTime() <= current.getTime() && periods.length < maxPeriods) {
    const start = new Date(cursor);
    const end = new Date(start);
    if (mode === "monthly") {
      end.setMonth(start.getMonth() + 1);
    } else {
      end.setDate(start.getDate() + 7);
    }
    periods.push({ start, end, label: mode === "monthly" ? monthLabel(start) : dayMonthLabel(start) });
    if (mode === "monthly") {
      cursor.setMonth(cursor.getMonth() + 1);
    } else {
      cursor.setDate(cursor.getDate() + 7);
    }
  }

  return periods.length ? periods : [{ start: current, end: nextPeriod(current, mode), label: mode === "monthly" ? monthLabel(current) : dayMonthLabel(current) }];
}

function nextPeriod(start: Date, mode: KpiPeriodMode) {
  const end = new Date(start);
  if (mode === "monthly") end.setMonth(start.getMonth() + 1);
  else end.setDate(start.getDate() + 7);
  return end;
}

function countMapUntil(map: Map<string, number>, until: Date) {
  const untilValue = dateValueFromDate(until);
  let count = 0;
  for (const value of map.values()) {
    if (value < untilValue) count += 1;
  }
  return count;
}

function buildTrend(input: {
  title: string;
  description: string;
  accumulated: number;
  mode: KpiPeriodMode;
  points: Array<{ label: string; total: number; firstTime?: number }>;
}): KpiTrend {
  const current = input.points.at(-1)?.total ?? 0;
  const previous = input.points.at(-2)?.total ?? 0;
  const value = current - previous;
  const percent = previous === 0 ? (current === 0 ? 0 : null) : Math.round((value / previous) * 100);

  return {
    title: input.title,
    description: input.description,
    accumulated: input.accumulated,
    periodMode: input.mode,
    previousChange: {
      label: input.mode === "monthly" ? "vs mes anterior" : "vs semana anterior",
      value,
      percent
    },
    points: input.points
  };
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function startOfWeek(value: Date) {
  const date = startOfDay(value);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function maxDate(a: Date, b: Date) {
  return a.getTime() >= b.getTime() ? a : b;
}

function dateValue(value: string | null | undefined) {
  if (!value) return 0;
  const datePart = value.slice(0, 10);
  const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    return Date.UTC(Number(year), Number(month) - 1, Number(day));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 0;
  return Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function dateValueFromDate(value: Date) {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
}

function inPeriod(value: string | null | undefined, period: KpiPeriod) {
  const time = dateValue(value);
  return time >= dateValueFromDate(period.start) && time < dateValueFromDate(period.end);
}

function dayMonthLabel(value: Date) {
  return `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: Date) {
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${months[value.getMonth()]} ${String(value.getFullYear()).slice(-2)}`;
}

function isCoffeeInteraction(interaction: InteractionRow) {
  return interaction.interaction_type === "calendar" || interaction.interaction_type === "call";
}

function contactIdsForContactMadeInteraction(
  interaction: InteractionRow,
  participantsByInteraction: Map<string, InteractionParticipantRow[]>
) {
  if (!isContactMadeInteraction(interaction)) return [];
  const participants = participantsByInteraction.get(interaction.id) ?? [];
  if (interaction.direction === "outbound" || interaction.direction === "internal") {
    return contactIdsFromParticipants(participants);
  }

  const roleBasedParticipants = participants.filter((participant) => participantRoleLooksOutbound(participant.role));
  if (roleBasedParticipants.length) return contactIdsFromParticipants(roleBasedParticipants);

  return legacyContactLabelLooksOutbound(interaction.metadata?.legacy_contact_label) ? contactIdsFromParticipants(participants) : [];
}

function isContactMadeInteraction(interaction: InteractionRow) {
  if (interaction.interaction_type !== "email" && interaction.interaction_type !== "message") return false;
  if (interaction.direction === "outbound" || interaction.direction === "internal") return true;
  if (interaction.direction === "inbound") return false;
  return true;
}

function contactIdsFromParticipants(participants: InteractionParticipantRow[]) {
  return Array.from(
    new Set(
      participants
        .map((participant) => participant.contact_id)
        .filter((contactId): contactId is string => Boolean(contactId))
    )
  );
}

function participantRoleLooksOutbound(value: string | null | undefined) {
  const role = (value ?? "").trim().toUpperCase();
  return role === "TO" || role === "CC" || role === "BCC" || role === "MANUAL";
}

function legacyContactLabelLooksOutbound(value: string | null | undefined) {
  const text = (value ?? "").trim();
  const lower = text.toLowerCase();
  return (
    text.toUpperCase().startsWith("TO:") ||
    text.toUpperCase().startsWith("CC:") ||
    text.toUpperCase().startsWith("BCC:") ||
    lower.includes("sergiohudson@gmail.com") ||
    lower.includes("sergio hudson") ||
    lower.includes("usuario app")
  );
}

function groupParticipants(participants: InteractionParticipantRow[]) {
  return participants.reduce<Map<string, InteractionParticipantRow[]>>((acc, participant) => {
    if (!acc.has(participant.interaction_id)) acc.set(participant.interaction_id, []);
    acc.get(participant.interaction_id)?.push(participant);
    return acc;
  }, new Map());
}

function domainsForContact(contact: ContactRow | undefined) {
  if (!contact || !contact.is_headhunter || !contact.networking_focus || !contact.is_active) return [];
  const domains = new Set<string>();
  for (const domain of contact.headhunter_domains ?? []) {
    if (domain) domains.add(normalizeDomain(domain));
  }
  for (const email of contact.contact_emails ?? []) {
    if (email.domain) domains.add(normalizeDomain(email.domain));
  }
  return Array.from(domains).filter(Boolean);
}

function normalizeDomain(domain: string) {
  const clean = domain.trim().toLowerCase();
  if (!clean) return "";
  return clean.startsWith("@") ? clean : `@${clean}`;
}
