/** Technical codes only: never include response bodies, URLs, IDs or user content. */
export function readDiagnostic(error: unknown, status?: number) {
  const value = error as { code?: unknown; status?: unknown } | null;
  const code = typeof value?.code === "string" && /^(?:[A-Z0-9]{5}|PGRST\d{3}|complete_read_[a-z_]+)$/.test(value.code)
    ? value.code : "READ_FAILED";
  const httpStatus = status ?? value?.status;
  return { code, status: typeof httpStatus === "number" && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null };
}

export function reportReadFailure(operation: string, error: unknown, status?: number) {
  console.warn("[data-read]", JSON.stringify({ operation, ...readDiagnostic(error, status) }));
}
