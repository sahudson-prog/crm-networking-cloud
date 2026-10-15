export function isIcsImportEnabled() {
  return process.env.NEXT_PUBLIC_ICS_IMPORT_ENABLED === "true";
}
