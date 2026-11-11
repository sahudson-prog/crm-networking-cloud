export const OPPORTUNITY_STAGES = [
  ["identified", "Identificadas"],
  ["applied", "Postuladas"],
  ["in_process", "En proceso"],
  ["offer_received", "Oferta recibida"]
] as const;

export const OPPORTUNITY_RESULTS = [
  ["offer_accepted", "Oferta aceptada"],
  ["offer_declined", "Oferta declinada"],
  ["offer_expired", "Oferta expirada"],
  ["not_selected", "No seleccionado"],
  ["discarded", "Descartada por mí"],
  ["application_deadline_expired", "Plazo de postulación vencido"],
  ["vacancy_cancelled", "Vacante cancelada"],
  ["application_withdrawn", "Postulación retirada por mí"],
  ["process_withdrawn", "Proceso retirado por mí"],
  ["no_response", "Sin respuesta"],
  ["other", "Otro"]
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number][0];
export type OpportunityResult = (typeof OPPORTUNITY_RESULTS)[number][0];
export type OpportunitySituation = "active" | "finalized" | "voided";
const RESULTS_BY_STAGE: Record<OpportunityStage, readonly OpportunityResult[]> = {
  identified: ["discarded", "application_deadline_expired", "vacancy_cancelled", "other"],
  applied: ["not_selected", "application_withdrawn", "vacancy_cancelled", "no_response", "other"],
  in_process: ["not_selected", "process_withdrawn", "vacancy_cancelled", "no_response", "other"],
  offer_received: ["offer_accepted", "offer_declined", "offer_expired", "other"]
};
export function opportunityResultsForStage(stage: OpportunityStage) {
  return RESULTS_BY_STAGE[stage].map((code) => OPPORTUNITY_RESULTS.find(([value]) => value === code)!);
}
export function opportunityClosureValid(stage: OpportunityStage, situation: string, result: OpportunityResult | null) {
  return situation === "active" ? Boolean(RESULTS_BY_STAGE[stage]) && result === null
    : situation === "finalized" && result !== null && Boolean(RESULTS_BY_STAGE[stage]?.includes(result));
}

export type Opportunity = {
  id: string;
  cycle_id: string;
  title: string;
  company: string | null;
  application_url: string | null;
  stage: OpportunityStage;
  situation: OpportunitySituation;
  result: OpportunityResult | null;
  result_note: string | null;
  voided_at: string | null;
  updated_at: string;
  contact_ids: string[];
  objective_ids: string[];
  interaction_ids: string[];
  visible_interaction_count?: number;
};

export function opportunityCounts(opportunities: Opportunity[]) {
  const current = opportunities.filter((opportunity) => opportunity.situation !== "voided" && !opportunity.voided_at);
  return {
    opportunities: current.length,
    offers: current.filter((opportunity) => opportunity.stage === "offer_received").length,
    successfulOffers: current.filter((opportunity) => opportunity.situation === "finalized"
      && opportunity.result === "offer_accepted").length
  };
}

export function opportunityStageLabel(stage: OpportunityStage) {
  return OPPORTUNITY_STAGES.find(([value]) => value === stage)?.[1] ?? stage;
}

export function opportunityResultLabel(result: OpportunityResult | null) {
  return OPPORTUNITY_RESULTS.find(([value]) => value === result)?.[1] ?? "";
}

export function opportunityMoveIntent(from: OpportunityStage, to: OpportunityStage) {
  if (from === to) return "unchanged";
  return "save_without_result";
}

export async function collectOpportunityPages<T>(read: (from: number, to: number) => Promise<{ rows: T[]; total: number | null }>) {
  const rows: T[] = [];
  const seen = new Set<string>();
  let expected: number | undefined;
  for (;;) {
    const page = await read(rows.length, rows.length + 199);
    if (page.total === null || !Number.isSafeInteger(page.total) || page.total < 0
      || (expected !== undefined && page.total !== expected)
      || rows.length + page.rows.length > page.total
      || (!page.rows.length && rows.length < page.total)) {
      throw new Error("opportunity_read_incomplete");
    }
    expected = page.total;
    for (const row of page.rows) {
      const key = JSON.stringify(row);
      if (seen.has(key)) throw new Error("opportunity_read_incomplete");
      seen.add(key); rows.push(row);
    }
    if (rows.length === expected) return rows;
  }
}
