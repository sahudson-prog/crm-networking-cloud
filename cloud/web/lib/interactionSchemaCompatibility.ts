const OPTIONAL_INTERACTION_LIFECYCLE_COLUMNS = new Set(["is_deleted", "prevent_reimport"]);

export function isMissingInteractionLifecycleColumn(error: unknown) {
  if (!isObject(error)) return false;
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return (code === "42703" || code === "PGRST204")
    && Array.from(OPTIONAL_INTERACTION_LIFECYCLE_COLUMNS).some((column) => message.includes(column));
}

export function legacyInteractionColumns(columns: string[]) {
  return columns.filter((column) => !OPTIONAL_INTERACTION_LIFECYCLE_COLUMNS.has(column));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
