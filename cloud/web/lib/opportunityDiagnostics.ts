export type OpportunityPhase = "auth" | "participants" | "interactions" | "context" | "rpc";
export class OpportunityFailure extends Error {
  constructor(readonly phase: OpportunityPhase, readonly kind: "rejected" | "stale" | "uncertain",
    readonly code: string, readonly status: number | null) {
    super(`opportunity_${kind}`);
  }
}

// Never retain server messages, payloads, identities or URLs in diagnostics.
export function opportunityFailure(phase: OpportunityPhase, error: unknown, status?: number): OpportunityFailure {
  if (error instanceof OpportunityFailure) return error;
  const source = error as { code?: unknown; message?: unknown; status?: unknown } | null;
  const rawCode = typeof source?.code === "string" ? source.code : "";
  const code = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(rawCode) ? rawCode : "client_or_transport";
  const http = typeof status === "number" ? status : typeof source?.status === "number" ? source.status : null;
  const stale = code === "40001" || (typeof source?.message === "string"
    && /opportunity_request_conflict|networking_context_stale/.test(source.message));
  const kind = stale ? "stale" : code !== "client_or_transport" || (http !== null && http >= 400 && http < 500)
    ? "rejected" : "uncertain";
  const result = new OpportunityFailure(phase, kind, code, http);
  console.warn("Opportunity operation failed", { phase, kind, code, status: http });
  return result;
}

export async function opportunityPhase<T>(phase: OpportunityPhase, action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) { throw opportunityFailure(phase, error); }
}
