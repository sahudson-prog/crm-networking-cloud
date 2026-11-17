import { coffeeEligibility, contactedStates, networkingContactIds, selectFirstCoffee, selectTrackingCalendar, nearestProjectedContacts, periodKey, type TrackingInteraction, type TrackingSnapshot, type FirstCoffeeHistory } from "./trackingModel.ts";
import { cycleStartFromDate, localDateTimeCandidates, localDateTimeValue } from "./networkingCycleTime.ts";
import { rollingBoundaries, shiftLocalDays } from "./gamificationTime.ts";
import { selectNetworkingContacts, linkedNetworkingIds, type NetworkingContact } from "./networkingScope.ts";

export const CONTACTED_STATES = contactedStates;
export type Metric = { value: number | null; reason?: string };
export const known = (value: number): Metric => ({ value });
export const unavailable = (reason: string): Metric => ({ value: null, reason });
export type CoffeeEvidence = { id: string; contactId: string; occurredAt: string; confirmed: boolean };
export type CoffeeHistory = {
  // This is an evidence boundary, not the first event date or a chart window.
  since: string; through: string; complete: boolean; events: CoffeeEvidence[];
  unattributedCount?: number;
};

/** Complete attribution of retained contacts, not a log of repeated meetings. */
export function attributedCoffeeHistory(contacts:ReadonlyArray<NetworkingContact & {networking_status:string}>,source:FirstCoffeeHistory|undefined,now:string):CoffeeHistory|null {
  if(!source || !Number.isFinite(Date.parse(source.coverageSince??"")))return null;
  const attribution=selectFirstCoffee(selectNetworkingContacts(contacts),source,now);
  // Account creation is the coverage anchor; imported older evidence extends it.
  let since=Date.parse(source.coverageSince!);
  for(const at of attribution.dates.values())since=Math.min(since,at);
  return {since:new Date(since).toISOString(),through:now,complete:attribution.missing.size===0,unattributedCount:attribution.missing.size,
    events:[...attribution.dates].map(([contactId,at])=>({id:`first:${contactId}`,contactId,occurredAt:new Date(at).toISOString(),confirmed:true}))};
}
export function shiftWeek(key: string, weeks: number) {
  const day = new Date(`${key}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + weeks * 7);
  return day.toISOString().slice(0, 10);
}
export function evidenceInstant(value: string, zone: string): number {
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(cycleStartFromDate(value, zone, null, 8640000000000000).startedAt);
    const timestamp = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!timestamp || !localDateTimeCandidates(timestamp[1], "UTC").length) return NaN;
    return Date.parse(value);
  } catch { return NaN; }
}
export function rollingCoffeeAverage(history: CoffeeHistory | null, now: number, zone: string) {
  const unavailable = {average:null as number|null, nextChange:null as number|null, averageDays:0};
  if (!history?.complete) return unavailable;
  const bounds = rollingBoundaries(now, zone);
  const tomorrow = evidenceInstant(shiftWeekDay(localDateTimeValue(new Date(now),zone).slice(0,10), 1), zone);
  const since=evidenceInstant(history.since,zone);
  if (!Number.isFinite(since) || evidenceInstant(history.through, zone) < now || !Number.isFinite(evidenceInstant(history.through, zone))) return unavailable;
  if (since > now) return unavailable;
  const start=Math.max(since,bounds[0]);
  // Compare civil wall times, not UTC duration across a DST transition.
  const civilTime=(at:number)=>Date.parse(`${localDateTimeValue(new Date(at),zone)}Z`);
  const averageDays=Math.min(28,Math.max(1,(civilTime(now)-civilTime(start))/86400000));
  const bins = bounds.slice(1).map(() => new Set<string>()), seen = new Map<string, number>();
  let nextChange = Infinity;
  for (const event of history.events) {
    if (!event.confirmed) continue;
    const at = evidenceInstant(event.occurredAt, zone);
    if (!Number.isFinite(at)) return unavailable;
    if (at < since) return unavailable;
    const identity = `${event.id}:${event.contactId}`;
    if (seen.has(identity) && seen.get(identity) !== at) return unavailable;
    seen.set(identity, at);
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(event.occurredAt);
    const end = dateOnly ? evidenceInstant(shiftWeekDay(event.occurredAt, 1), zone) : at;
    if (at > now) { nextChange=Math.min(nextChange,at+1);continue; }
    if (dateOnly && end > bounds[0] && at < now) {
      const bin = bins.findIndex((_, i) => at >= Math.max(start,bounds[i]) && end <= bounds[i + 1]);
      if (bin < 0) return {...unavailable,nextChange:tomorrow}; // Civil day straddles an hourly boundary.
      bins[bin].add(event.contactId);
    } else if (!dateOnly) {
      const bin = bins.findIndex((_, i) => at >= Math.max(start,bounds[i]) && at < bounds[i + 1]);
      if (bin >= 0) bins[bin].add(event.contactId);
    }
    for (const boundary of [at, end]) for (const days of [0, 7, 14, 21, 28]) {
      const crossing = (days === 0 ? boundary : shiftLocalDays(boundary, days, zone)) + 1;
      if (crossing > now) nextChange = Math.min(nextChange, crossing);
    }
  }
  // Revisit at the next local day as well: timezone transitions can make
  // inverse calendar arithmetic non-bijective. This is not a polling loop.
  nextChange = Math.min(nextChange, tomorrow);
  return {average:bins.reduce((total, bin) => total + bin.size, 0) * 7 / averageDays, averageDays, nextChange:Number.isFinite(nextChange)?nextChange:null};
}
function shiftWeekDay(day:string,days:number) {
  const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);
}

export function coffeeWeeks(history: CoffeeHistory | null, now: number, zone: string, pristine = false) {
  const streak = civilCoffeeWeeks(history, now, zone, pristine);
  const rolling = rollingCoffeeAverage(history, now, zone);
  const provisional = streak.current.value !== null && streak.current.value > 0 && streak.weeks === 0 && !streak.issues.length;
  const level = streak.initial ? "empty" : rolling.average !== null ? rolling.average < 2 ? "fire" : rolling.average < 3 ? "rocket" : "radiation" : provisional ? "fire" : "unknown";
  return {...streak, ...rolling, level};
}

function civilCoffeeWeeks(history: CoffeeHistory | null, now: number, zone: string, pristine = false) {
  const unknown = unavailable("Información histórica insuficiente");
  const empty = { streak: known(0), current: known(0), average: null as number | null, weeks: 0, level: "empty" as const, initial: true, issues: [] as string[] };
  if (pristine) return empty;
  if (!history?.complete || evidenceInstant(history.through, zone) < now || !Number.isFinite(evidenceInstant(history.through, zone)))
    return { streak: unknown, current: unknown, average: null, weeks: 0, level: "unknown" as const, initial: false, issues: ["coverage_unknown"] };
  const start = evidenceInstant(history.since, zone), current = periodKey(now, zone, "weekly");
  if (!Number.isFinite(start) || start > now) return { streak: unknown, current: unknown, average: null, weeks: 0, level: "unknown" as const, initial: false, issues: ["coverage_invalid"] };
  const first = periodKey(start, zone, "weekly"), grouped = new Map<string, Set<string>>(), seen = new Map<string, number>();
  const issues: string[] = [];
  for (const event of history.events) {
    if (!event.confirmed) continue;
    const at = evidenceInstant(event.occurredAt, zone);
    if (!Number.isFinite(at)) { issues.push("coffee_date_missing"); continue; }
    if (at > now) { issues.push("coffee_in_future"); continue; }
    if (at < start) { issues.push("coffee_before_coverage"); continue; }
    const identity = `${event.id}:${event.contactId}`;
    if (seen.has(identity) && seen.get(identity) !== at) { issues.push("coffee_identity_conflict"); continue; }
    seen.set(identity, at);
    const week = periodKey(at, zone, "weekly");
    if (!grouped.has(week)) grouped.set(week, new Set());
    grouped.get(week)!.add(event.contactId);
  }
  if (issues.some(issue => issue !== "coffee_in_future")) return { streak: unavailable("Fechas de cafés no verificables"), current: unavailable("Fechas de cafés no verificables"), average: null, weeks: 0, level: "unknown" as const, initial: false, issues };
  const count = (key: string) => grouped.get(key)?.size ?? 0;
  let key = count(current) ? current : shiftWeek(current, -1), streak = 0;
  while (key >= first && count(key)) { streak++; key = shiftWeek(key, -1); }
  // Only complete civil weeks wholly contained in verified coverage contribute.
  let sum = 0, weeks = 0;
  const firstWhole = start === evidenceInstant(first, zone) ? first : shiftWeek(first, 1);
  for (let i = 1; i <= 3; i++) { const week = shiftWeek(current, -i); if (week >= firstWhole) { sum += count(week); weeks++; } }
  const average = weeks ? sum / weeks : null;
  const total = [...grouped.values()].reduce((n, ids) => n + ids.size, 0);
  const level = !total ? "empty" : average === null || average < 2 ? "fire" : average < 3 ? "rocket" : "radiation";
  return { streak: known(streak), current: known(count(current)), average, weeks, level, initial: !total, issues };
}
export type Goal = { id: "realized" | "projected" | "prioritized"; title: string; metric: Metric; target: number; text: string; completed: boolean; progress: number };
export function weeklyGoals(realized: Metric, projected: Metric, numerator: number | null, denominator: number | null): Goal[] {
  const goal = (id: Goal["id"], title: string, metric: Metric, target: number, text: string): Goal => ({ id, title, metric, target, text, completed: metric.value !== null && metric.value >= target, progress: metric.value === null ? 0 : Math.min(100, 100 * metric.value / target) });
  const goals = [goal("realized", "Cafés concretados", realized, 2, `Llevas ${realized.value} de 2`), goal("projected", "Cafés proyectados", projected, 4, `${projected.value} de 4`)];
  if (goals.every(g => g.completed)) {
    const metric = numerator === null || denominator === null ? unavailable("Prioridades no disponibles") : denominator === 0 ? unavailable("Sin contactos para evaluar") : known(numerator === denominator ? 100 : Math.min(99, Math.floor(100 * numerator / denominator)));
    goals.push(goal("prioritized", "Prioridad cargada", metric, 100, metric.value === null ? metric.reason ?? "No disponible" : `${numerator} de ${denominator} (${metric.value}%)`));
  }
  return goals;
}
export type Milestone = { id: string; title: string; done: boolean; href: string };
export function initialRoute(input: { objective: boolean; moved: boolean; contacts: number; interactions: number; processes: number }): Milestone[] {
  return [
    { id: "objective", title: "Crea tu objetivo", done: input.objective, href: "/objetivos" },
    { id: "moved", title: "Mueve tu primer contacto", done: input.moved, href: "/registrar-avances" },
    { id: "contacts", title: "Llega a 10 contactos", done: input.contacts >= 10, href: "/contactos" },
    { id: "interactions", title: "Registra 10 interacciones", done: input.interactions >= 10, href: "/registrar-avances" },
    { id: "process", title: "Crea tu primer proceso laboral", done: input.processes > 0, href: "/registrar-avances" }
  ];
}
export function projectedCoffees(input: {contacts: (NetworkingContact & {networking_status:string})[]; events: {id:string; occurred_at:string|null; contactIds:string[]; valid:boolean}[]}, now:number, zone:string):Metric {
  const contacts=selectNetworkingContacts(input.contacts);
  const next = shiftWeek(periodKey(now,zone,"weekly"),1);
  const {futureCalendar,undatedProjection}=selectTrackingCalendar({
    interactions:input.events.map(e=>{
      const at=evidenceInstant(e.occurred_at??"",zone);
      return {id:e.id,interaction_type:"calendar",occurred_at:!Number.isFinite(at)?null:/^\d{4}-\d{2}-\d{2}$/.test(e.occurred_at!)?new Date(at).toISOString():e.occurred_at,metadata:{dismissed:!e.valid}};
    }),
    participants:input.events.flatMap(e=>e.contactIds.map(contact_id=>({interaction_id:e.id,contact_id}))),sources:[]
  },new Set(contacts.map(c=>c.id)),networkingContactIds(contacts).coffees,new Date(now).toISOString());
  if(undatedProjection)return unavailable("Hay citas sin fecha verificable");
  return known(nearestProjectedContacts(futureCalendar.map(e=>({key:e.contactId,at:e.at})),evidenceInstant(next,zone),evidenceInstant(shiftWeek(next,1),zone)).size);
}
export function selectedGoalId(previous:string,goals:Goal[]) { return goals.some(g=>g.id===previous)?previous:goals[0].id; }
export function canRotate({reduced,hidden,hover,paused}:{reduced:boolean;hidden:boolean;hover:boolean;paused:boolean}) { return !reduced&&!hidden&&!hover&&!paused; }

export type GamificationExtra = {
  // Production reads all lifecycle sources, including inactive ones, as Tracking does.
  calendarSources?: TrackingSnapshot["sources"] | null;
  cycles: {id:string;objective_type:string;status:string;timezone_name:string|null}[] | null;
  opportunities: {id:string;stage:string;situation:string}[] | null;
  opportunityContacts: {opportunity_id:string;contact_id:string}[] | null;
  priorities: {id:string}[] | null;
  assignments: {id:string;contact_id:string;objective_id:string}[] | null;
  transitions: {id:string;contact_id:string|null;next_status:string|null}[] | null;
};
export type GamificationInput = {
  contacts: (NetworkingContact & {networking_status:string})[] | null;
  interactions: TrackingInteraction[] | null;
  participants: {interaction_id:string;contact_id:string|null}[];
  sources: TrackingSnapshot["sources"];
  extra: GamificationExtra;
  // One attributed first coffee per contact; null when temporal evidence is missing.
  history: CoffeeHistory | null;
  historyReadFailed?: boolean;
};
export function buildGamification(input:GamificationInput,now:number,zone:string) {
  new Intl.DateTimeFormat("es-CL",{timeZone:zone}).format(now);
  const {interactions,extra}=input;
  const contacts=input.contacts?selectNetworkingContacts(input.contacts):null;
  const ids=new Set(contacts?.map(c=>c.id));
  const eligibility=contacts?networkingContactIds(contacts):null;
  const contacted=eligibility?[...eligibility.contacted]:null;
  const priorityIds=extra.priorities?new Set(extra.priorities.map(p=>p.id)):null;
  const prioritized=priorityIds&&extra.assignments?new Set(extra.assignments.filter(a=>ids.has(a.contact_id)&&priorityIds.has(a.objective_id)).map(a=>a.contact_id)):null;
  const processIds=extra.opportunityContacts?new Set(extra.opportunityContacts.filter(link=>ids.has(link.contact_id)).map(link=>link.opportunity_id)):null;
  const processRows=contacts&&processIds&&extra.opportunities?[...new Map(extra.opportunities.filter(o=>processIds.has(o.id)&&["active","finalized"].includes(o.situation)&&["in_process","offer_received"].includes(o.stage)).map(o=>[o.id,o])).values()]:null;
  const pristine=contacts?.length===0&&interactions?.length===0&&extra.cycles?.length===0&&extra.transitions?.length===0&&extra.opportunities?.length===0;
  const history=input.history?{...input.history,events:input.history.events.filter(e=>ids.has(e.contactId))}:null;
  const temporal={...coffeeWeeks(history,now,zone,pristine&&!input.historyReadFailed),readFailed:Boolean(input.historyReadFailed)};
  const participantMap=new Map<string,string[]>();
  const calendarSourceMap=new Map<string,TrackingSnapshot["sources"]>();
  for(const s of extra.calendarSources??input.sources)calendarSourceMap.set(s.interaction_id,[...(calendarSourceMap.get(s.interaction_id)??[]),s]);
  for(const p of input.participants) if(p.contact_id) participantMap.set(p.interaction_id,[...(participantMap.get(p.interaction_id)??[]),p.contact_id]);
  const projected=contacts&&interactions&&extra.calendarSources!==null?projectedCoffees({contacts,events:interactions.filter(i=>i.interaction_type==="calendar").map(i=>({id:i.id,occurred_at:i.occurred_at,valid:coffeeEligibility(i,calendarSourceMap.get(i.id)??[])==="valid",contactIds:participantMap.get(i.id)??[]}))},now,zone):unavailable("read_failed");
  const linked=linkedNetworkingIds(input.participants,ids);
  const countInteractions=contacts&&interactions&&extra.calendarSources!==null?new Set(interactions.filter(i=>linked.has(i.id)&&!i.is_deleted&&!i.metadata.deleted&&!i.metadata.dismissed&&(i.interaction_type!=="calendar"||coffeeEligibility(i,calendarSourceMap.get(i.id)??[])==="valid")).map(i=>i.id)).size:null;
  const moved=extra.transitions?.some(t=>Boolean(t.contact_id&&ids.has(t.contact_id)&&CONTACTED_STATES.has(t.next_status??"")))||Boolean(contacted?.length);
  const route=contacts&&countInteractions!==null&&extra.cycles&&processRows&&extra.transitions?initialRoute({objective:extra.cycles.some(c=>c.objective_type==="JOB_SEARCH"),moved,contacts:new Set(contacts.map(c=>c.id)).size,interactions:countInteractions,processes:processRows.length}):null;
  const metrics=[
    {id:"priorities",title:"Contactos priorizados",metric:contacts&&prioritized?known(prioritized.size):unavailable("Prioridades no disponibles")},
    {id:"contacted",title:"Ya contactados",metric:contacted?known(contacted.length):unavailable("Contactos no disponibles")},
    {id:"coffees",title:"Contactos con café concretado",metric:eligibility?known(eligibility.coffees.size):unavailable("Contactos no disponibles")},
    {id:"processes",title:"Procesos",metric:processRows?known(processRows.length):unavailable("Procesos no disponibles")},
    {id:"interviews",title:"Procesos en entrevista",metric:unavailable("El catálogo actual no identifica entrevistas")}
  ];
  return {temporal,goals:weeklyGoals(input.historyReadFailed?unavailable("read_failed"):temporal.current,projected,contacted&&prioritized?contacted.filter(id=>prioritized.has(id)).length:null,contacted?.length??null),route,metrics,zone};
}
export type GamificationModel=ReturnType<typeof buildGamification>;
