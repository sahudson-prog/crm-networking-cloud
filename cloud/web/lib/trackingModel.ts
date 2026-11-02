import { resolveHeadhunterCompany, type HeadhunterCompanyMasterRow } from "./headhunterCompanyMaster.ts";
import { localDateTimeCandidates, localDateTimeValue } from "./networkingCycleTime.ts";
import type { ObjectivePriority, ObjectiveType } from "./readModel.ts";
import { isInteractionDismissed } from "./interactionState.ts";

export type TrackingContact = {
  id: string; company: string | null; networking_status: string; networking_focus: boolean; is_headhunter: boolean;
  headhunter_domains: string[]; contact_emails: Array<{ domain: string | null; email?: string }>;
};
export type TrackingInteraction = {
  id: string; interaction_type: string; occurred_at: string | null; is_deleted?: unknown;
  metadata: { deleted?: unknown; dismissed?: unknown; ics_import?: { version?: number; status?: string | null; method?: string | null } | null };
};
export type TrackingOpportunity = {
  id: string; stage: string; situation: string; result: string | null;
  contact_ids: string[]; objective_ids: string[];
};
export type TrackingSnapshot = {
  version: 1; as_of: string;
  cycle: { id: string; started_at: string | null; timezone_name: string | null } | null;
  contacts: TrackingContact[];
  transitions: Array<{ id: string; contact_id: string | null; previous_status: string | null; next_status: string; changed_at: string }>;
  interactions: TrackingInteraction[];
  participants: Array<{ interaction_id: string; contact_id: string }>;
  sources: Array<{ interaction_id: string; provider: string; source_service: string; sync_status: string; is_active: boolean }>;
  priorities: Array<{ id: string; objective_name: string; objective_type: ObjectiveType; priority_level: ObjectivePriority }>;
  assignments: Array<{ contact_id: string; objective_id: string }>;
  opportunities: TrackingOpportunity[];
  companies: HeadhunterCompanyMasterRow[];
};
export type TrackingFilters = { priorityIds: string[]; headhunters: "all" | "only" | "exclude"; groupHeadhunters: boolean };
export function validateTrackingSnapshot(value: unknown): TrackingSnapshot {
  const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
  const string = (v: unknown) => typeof v === "string";
  const nullableString = (v: unknown) => v === null || string(v);
  const strings = (v: unknown) => Array.isArray(v) && v.every(string);
  const boolean = (v: unknown) => typeof v === "boolean";
  const date = (v: unknown) => string(v) && Number.isFinite(Date.parse(v as string));
  const fail = () => { throw new Error("tracking_incomplete"); };
  if (!object(value)) return fail();
  const v = value;
  if (v.version !== 1 || !date(v.as_of)) return fail();
  if (v.cycle !== null && (!object(v.cycle) || !string(v.cycle.id)
    || !(v.cycle.started_at === null || date(v.cycle.started_at)) || !nullableString(v.cycle.timezone_name))) return fail();
  const shapes: Record<string, (r: Record<string, unknown>) => boolean> = {
    contacts: r => string(r.id) && nullableString(r.company) && string(r.networking_status) && boolean(r.networking_focus) && boolean(r.is_headhunter)
      && strings(r.headhunter_domains) && Array.isArray(r.contact_emails) && r.contact_emails.every(e => object(e) && nullableString(e.domain)),
    transitions: r => string(r.id) && nullableString(r.contact_id) && nullableString(r.previous_status)
      && string(r.next_status) && date(r.changed_at),
    interactions: r => string(r.id) && string(r.interaction_type) && (r.occurred_at === null || date(r.occurred_at)) && object(r.metadata)
      && (r.is_deleted == null || boolean(r.is_deleted)),
    participants: r => string(r.interaction_id) && string(r.contact_id),
    sources: r => string(r.interaction_id) && string(r.provider) && string(r.source_service) && string(r.sync_status) && boolean(r.is_active),
    priorities: r => string(r.id) && string(r.objective_name) && string(r.objective_type) && string(r.priority_level),
    assignments: r => string(r.contact_id) && string(r.objective_id),
    opportunities: r => string(r.id) && string(r.stage) && string(r.situation) && nullableString(r.result)
      && strings(r.contact_ids) && strings(r.objective_ids),
    companies: r => string(r.id) && string(r.displayName) && string(r.normalizedName) && strings(r.domains)
  };
  for (const [key, shape] of Object.entries(shapes)) {
    const rows = v[key];
    if (!Array.isArray(rows) || rows.some(r => !object(r) || !shape(r))) return fail();
    if (["contacts", "interactions", "priorities", "opportunities", "companies"].includes(key)
      && new Set(rows.map(r => r.id)).size !== rows.length) return fail();
  }
  return value as TrackingSnapshot;
}
export const defaultTrackingFilters: TrackingFilters = { priorityIds: [], headhunters: "all", groupHeadhunters: false };
export type PeriodMode = "weekly" | "monthly";
const contactedStates = new Set(["Contactado", "Agendado", "Cita concretada", "Agradecimiento enviado"]);
const coffeeStates = new Set(["Cita concretada", "Agradecimiento enviado"]);

/** Only lifecycle persisted by existing writers is interpreted, never inferred attendance. */
export function coffeeEligibility(i: TrackingInteraction, sources: TrackingSnapshot["sources"]): "valid" | "excluded" {
  if (i.is_deleted || isInteractionDismissed({ metadata: {
    deleted: Boolean(i.metadata?.deleted), dismissed: Boolean(i.metadata?.dismissed)
  } })) return "excluded";
  if (sources.some(s => s.sync_status === "deleted_at_source")) return "excluded";
  if (i.interaction_type !== "calendar") return "excluded";
  const ics = i.metadata?.ics_import;
  if (ics?.status?.toUpperCase() === "CANCELLED" || ics?.method?.toUpperCase() === "CANCEL") return "excluded";
  // Local Calendar records need no external status or provenance confirmation.
  return "valid";
}

function instant(value: string | null | undefined) { return value ? Date.parse(value) : NaN; }
// PostgreSQL timestamps carry microseconds. Date alone would round both sides of a boundary down.
function instantMicros(value: string | null | undefined): bigint | null {
  const ms = instant(value);
  if (!Number.isFinite(ms)) return null;
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(value!)?.[1] ?? "";
  return BigInt(ms) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3, 6));
}
function earliest(map: Map<string, number>, key: string, at: number) { map.set(key, Math.min(map.get(key) ?? Infinity, at)); }

export function buildTracking(snapshot: TrackingSnapshot, filters: TrackingFilters = defaultTrackingFilters) {
  const start = instant(snapshot.cycle?.started_at);
  const now = instant(snapshot.as_of);
  const startMicros = instantMicros(snapshot.cycle?.started_at), nowMicros = instantMicros(snapshot.as_of);
  const zone = snapshot.cycle?.timezone_name;
  if (!snapshot.cycle) return { state: "no_cycle" as const };
  if (!Number.isFinite(start) || !zone) return { state: "unknown_start" as const };
  if (startMicros === null || nowMicros === null || startMicros > nowMicros) throw new Error("tracking_invalid_time");
  // Validate IANA rather than silently interpreting an unknown zone in browser local time.
  new Intl.DateTimeFormat("en", { timeZone: zone }).format(new Date(now));
  const selected = new Set(filters.priorityIds);
  const assigned = new Map<string, Set<string>>();
  for (const a of snapshot.assignments) {
    if (!assigned.has(a.contact_id)) assigned.set(a.contact_id, new Set());
    assigned.get(a.contact_id)!.add(a.objective_id);
  }
  const contacts = snapshot.contacts.filter(c => c.networking_focus
    && (filters.headhunters === "all" || c.is_headhunter === (filters.headhunters === "only"))
    && (!selected.size || [...(assigned.get(c.id) ?? [])].some(id => selected.has(id))));
  const ids = new Set(contacts.map(c => c.id));
  const contacted = new Map<string, number>(contacts.filter(c => contactedStates.has(c.networking_status)).map(c => [c.id, 0]));
  const eligible = new Set(contacts.filter(c => coffeeStates.has(c.networking_status)).map(c => c.id));
  const enteredEligible = new Map<string, number>();
  const transitions = [...snapshot.transitions].sort((a, b) => {
    const aMicros = instantMicros(a.changed_at)!;
    const bMicros = instantMicros(b.changed_at)!;
    return aMicros < bMicros ? -1 : aMicros > bMicros ? 1 : a.id.localeCompare(b.id);
  });
  for (const t of transitions) {
    const at = instant(t.changed_at);
    const atMicros = instantMicros(t.changed_at);
    if (!t.contact_id || !ids.has(t.contact_id) || atMicros === null || atMicros < startMicros || atMicros > nowMicros) continue;
    if (!coffeeStates.has(t.next_status)) enteredEligible.delete(t.contact_id);
    else if (!coffeeStates.has(t.previous_status ?? "")) enteredEligible.set(t.contact_id, at);
  }
  const participants = new Map<string, Set<string>>();
  for (const p of snapshot.participants) {
    if (!ids.has(p.contact_id)) continue;
    if (!participants.has(p.interaction_id)) participants.set(p.interaction_id, new Set());
    participants.get(p.interaction_id)!.add(p.contact_id);
  }
  const sources = new Map<string, TrackingSnapshot["sources"]>();
  for (const s of snapshot.sources) sources.set(s.interaction_id, [...(sources.get(s.interaction_id) ?? []), s]);
  const pastCalendar = new Map<string, number>();
  const futureCalendar: Array<{ contactId: string; at: number }> = [];
  for (const i of snapshot.interactions) {
    const at = instant(i.occurred_at), linked = participants.get(i.id);
    const atMicros = instantMicros(i.occurred_at);
    if (atMicros === null || atMicros < startMicros || !linked?.size) continue;
    const eligibility = coffeeEligibility(i, sources.get(i.id) ?? []);
    if (eligibility !== "valid" || i.interaction_type !== "calendar") continue;
    for (const id of linked) {
      if (atMicros < nowMicros && eligible.has(id)) earliest(pastCalendar, id, at);
      else if (atMicros >= nowMicros && !eligible.has(id)) futureCalendar.push({ contactId: id, at });
    }
  }
  const groupKey = new Map(contacts.map(c => {
    const resolution = filters.groupHeadhunters && c.is_headhunter
      ? resolveHeadhunterCompany({ ...c, company: c.company ?? "", contact_emails: c.contact_emails.map(e => ({ domain: e.domain ?? "", email: "" })) }, snapshot.companies) : null;
    const key = resolution && (resolution.status === "matched_company" || resolution.status === "matched_domain")
      ? `hh:${resolution.company.id}` : `person:${c.id}`;
    return [c.id, key];
  }));
  const group = (evidence: Map<string, number>, priority?: string) => {
    const result = new Map<string, number>();
    for (const [id, at] of evidence) {
      if (priority && !assigned.get(id)?.has(priority)) continue;
      earliest(result, groupKey.get(id)!, at);
    }
    return result;
  };
  const groupEligible = (priority?: string) => new Set([...eligible]
    .filter(id => !priority || assigned.get(id)?.has(priority)).map(id => groupKey.get(id)!));
  const accredited = new Map<string, number>();
  const datedByMeeting = new Map<string, number>();
  const datedByStatus = new Map<string, number>();
  for (const id of eligible) {
    const meeting = pastCalendar.get(id);
    const at = meeting ?? enteredEligible.get(id);
    if (at !== undefined) accredited.set(id, at);
    if (meeting !== undefined) datedByMeeting.set(id, meeting);
    else if (at !== undefined) datedByStatus.set(id, at);
  }
  const futureEvents = futureCalendar.map(({ contactId, at }) => ({ key: groupKey.get(contactId)!, at }));
  const futureFirst = new Map<string, number>();
  for (const { key, at } of futureEvents) earliest(futureFirst, key, at);
  const focusedHH = new Set(snapshot.contacts.filter(c => c.networking_focus && c.is_headhunter).map(c => c.id));
  const opportunities = snapshot.opportunities.filter(o => ["active", "finalized"].includes(o.situation)
    && (!selected.size || o.objective_ids.some(id => selected.has(id)))
    && (filters.headhunters === "all" || o.contact_ids.some(id => focusedHH.has(id)) === (filters.headhunters === "only")));
  const blue = group(accredited), green = futureFirst;
  const actualByGroup = group(datedByMeeting), estimatedByGroup = group(datedByStatus);
  const blueActual = new Map<string, number>(), blueEstimated = new Map<string, number>();
  for (const [key, date] of blue) {
    if (actualByGroup.get(key) === date) blueActual.set(key, date);
    else if (estimatedByGroup.get(key) === date) blueEstimated.set(key, date);
  }
  const counts = [group(contacted).size, groupEligible().size,
    opportunities.filter(o => o.stage === "in_process" || o.stage === "offer_received").length,
    opportunities.filter(o => o.stage === "offer_received").length,
    opportunities.filter(o => o.situation === "finalized" && o.result === "offer_accepted").length];
  return {
    state: "ready" as const, start, startMicros, now, zone, counts, blue, blueActual, blueEstimated, green, futureEvents,
    unattributedCoffeeCount: counts[1] - blue.size,
    ratios: counts.slice(1).map((count, i) => counts[i] ? 100 * count / counts[i] : null),
    priorities: snapshot.priorities.filter(p => !selected.size || selected.has(p.id)).map(p => ({
      ...p, contactCount: group(contacted, p.id).size, coffeeCount: groupEligible(p.id).size,
      opportunityCount: opportunities.filter(o => o.situation === "active" && o.objective_ids.includes(p.id)).length
    }))
  };
}

export type ReadyTracking = Extract<ReturnType<typeof buildTracking>, { state: "ready" }>;
function civilDate(at: number, zone: string) { return localDateTimeValue(new Date(at), zone).slice(0, 10); }
function utcDate(date: string) { return new Date(`${date}T12:00:00Z`); }
function dateKey(date: Date) { return date.toISOString().slice(0, 10); }
export function periodKey(at: number, zone: string, mode: PeriodMode) {
  const civil = civilDate(at, zone);
  if (mode === "monthly") return `${civil.slice(0, 7)}-01`;
  const date = utcDate(civil);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return dateKey(date);
}
function shift(key: string, delta: number, mode: PeriodMode) {
  const date = utcDate(key);
  if (mode === "monthly") date.setUTCMonth(date.getUTCMonth() + delta);
  else date.setUTCDate(date.getUTCDate() + 7 * delta);
  return dateKey(date);
}
export function futureHorizonEnd(at: number, zone: string, mode: PeriodMode) {
  if (mode === "monthly") {
    let boundary = at;
    for (let month = 0; month < 3; month++) boundary = nextTrackingPeriodBoundary(boundary, zone, "monthly");
    return boundary;
  }
  const wall = new Date(`${localDateTimeValue(new Date(at), zone)}Z`);
  wall.setUTCDate(wall.getUTCDate() + 14);
  const millis = ((at % 1000) + 1000) % 1000;
  for (let minute = 0; minute <= 180; minute++) {
    const candidates = localDateTimeCandidates(wall.toISOString().slice(0, 19), zone);
    if (candidates.length) return candidates[0].getTime() + millis;
    wall.setUTCMinutes(wall.getUTCMinutes() + 1);
  }
  throw new Error("tracking_horizon_invalid_time");
}
/** Civil period keys avoid fabricating UTC midnights at IANA DST gaps/folds. */
export function trackingPeriods(model: ReadyTracking, mode: PeriodMode, at = model.now) {
  const first = periodKey(model.start, model.zone, mode);
  const partialStart = localDateTimeValue(new Date(model.start), model.zone) !== `${first}T00:00:00`
    || model.startMicros % 1_000_000n !== 0n;
  const current = periodKey(at, model.zone, mode);
  const blue = new Map<string, number>(), blueActual = new Map<string, number>(), blueEstimated = new Map<string, number>(), green = new Map<string, number>();
  for (const date of model.blue.values()) {
    const key = periodKey(date, model.zone, mode);
    blue.set(key, (blue.get(key) ?? 0) + 1);
  }
  for (const [evidence, bucket] of [[model.blueActual, blueActual], [model.blueEstimated, blueEstimated]] as const) {
    for (const date of evidence.values()) {
      const key = periodKey(date, model.zone, mode);
      bucket.set(key, (bucket.get(key) ?? 0) + 1);
    }
  }
  const horizon = futureHorizonEnd(at, model.zone, mode);
  const nearest = new Map<string, number>();
  for (const event of model.futureEvents) {
    if (event.at >= at && event.at < horizon) earliest(nearest, event.key, event.at);
  }
  for (const date of nearest.values()) {
    const key = periodKey(date, model.zone, mode);
    green.set(key, (green.get(key) ?? 0) + 1);
  }
  const periods = Array.from({ length: 12 }, (_, index) => {
    const key = shift(current, index - 9, mode);
    return key < first ? null : { key, blue: blue.get(key) ?? 0, blueActual: blueActual.get(key) ?? 0,
      blueEstimated: blueEstimated.get(key) ?? 0, green: green.get(key) ?? 0, partial: key === first && partialStart };
  });
  return { periods, current };
}

/** Schedule a display-only rollover at the next civil period in the cycle's IANA zone. */
export function nextTrackingPeriodBoundary(at: number, zone: string, mode: PeriodMode) {
  const key = periodKey(at, zone, mode);
  let lower = at, upper = at + (mode === "weekly" ? 8 : 32) * 86_400_000;
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (periodKey(middle, zone, mode) === key) lower = middle;
    else upper = middle;
  }
  return upper;
}
