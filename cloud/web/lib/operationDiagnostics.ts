type Stage = "contact-auth" | "contact-previous" | "contact-context" | "contact-invocation" | "contact-completion" | "contact-write" | "contact-audit" | "contact-coach" | "board-write" | "board-reconcile" | "opportunity-read" | "opportunity-context" | "opportunity-rows" | "opportunity-links" | "opportunity-versions";
type Timing = { stage: Stage; ms: number; outcome: "ok" | "error"; code?: string };
const timings: Timing[] = [];
export function getOperationTimings() { return timings.map(item => ({ ...item })); }
export function diagnosticCode(error: unknown) {
  const source = error as { code?: unknown; message?: unknown } | null;
  const code = typeof source?.code === "string" ? source.code : "";
  if (/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(code)) return code;
  if (source?.message === "read_superseded") return "read_superseded";
  if (source?.message === "opportunity_read_incomplete") return "opportunity_read_incomplete";
  if (source?.message === "opportunity_version_changed") return "opportunity_version_changed";
  if (source?.message === "opportunity_context_changed") return "opportunity_context_changed";
  return "client_or_transport";
}
export async function measureOperation<T>(stage: Stage, work: () => PromiseLike<T>): Promise<T> {
  const start = performance.now();
  let outcome: Timing["outcome"] = "ok", code: string | undefined;
  try {
    const value = await work();
    if (value && typeof value === "object" && "error" in value && value.error) {
      outcome = "error"; code = diagnosticCode(value.error);
    }
    return value;
  }
  catch (error) { outcome = "error"; code = diagnosticCode(error); throw error; }
  finally {
    const entry = { stage, ms: Math.round(performance.now() - start), outcome, ...(code ? { code } : {}) };
    timings.push(entry); if (timings.length > 100) timings.shift();
    if (outcome === "error" || process.env.NODE_ENV === "development") console.info("Operational timing", entry);
  }
}
