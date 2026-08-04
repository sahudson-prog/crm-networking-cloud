export function statusClass(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized === "pendiente") return "pendiente";
  if (normalized === "contactado") return "contactado";
  if (normalized === "agendado") return "agendado";
  if (normalized === "cita concretada") return "cita";
  if (normalized === "agradecimiento enviado") return "agradecimiento";
  return "";
}

const EMPTY_META_VALUES = ["sin dato", "sin datos", "null", "undefined", "none", "n/a"];
const EMPTY_COMPANY_VALUES = new Set(["empresa", "sin empresa", ...EMPTY_META_VALUES]);
const EMPTY_ROLE_VALUES = new Set(["cargo", "sin cargo", ...EMPTY_META_VALUES]);

export function cleanContactCompany(value: string | null | undefined) {
  return cleanContactMetaValue(value, EMPTY_COMPANY_VALUES);
}

export function cleanContactRole(value: string | null | undefined) {
  return cleanContactMetaValue(value, EMPTY_ROLE_VALUES);
}

export function formatContactCompanyRole(company: string | null | undefined, role: string | null | undefined) {
  const cleanCompany = cleanContactCompany(company);
  const cleanRole = cleanContactRole(role);
  return joinCompact([cleanCompany || "Sin empresa", cleanRole || "Sin cargo"]);
}

function cleanContactMetaValue(value: string | null | undefined, emptyValues: Set<string>) {
  const clean = (value ?? "").trim();
  if (!clean) return "";
  return emptyValues.has(clean.toLowerCase()) ? "" : clean;
}

export function shortDate(value: string | null | undefined) {
  if (!value) return "sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sin fecha";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  }).format(date);
}

export function joinCompact(values: Array<string | null | undefined>, fallback = "sin datos") {
  const clean = values.map((value) => (value ?? "").trim()).filter(Boolean);
  return clean.length ? clean.join(" · ") : fallback;
}

export function interactionLabel(type: string | null | undefined, direction?: string | null) {
  const channel =
    type === "calendar"
      ? "Cita"
      : type === "call"
        ? "Llamada"
        : type === "message"
          ? "Mensaje"
          : type === "manual"
            ? "Manual"
            : "Correo";

  const directionText =
    direction === "outbound"
      ? "saliente"
      : direction === "inbound"
        ? "entrante"
        : direction === "internal"
          ? "interno"
          : "";

  return directionText ? `${channel} · ${directionText}` : channel;
}
