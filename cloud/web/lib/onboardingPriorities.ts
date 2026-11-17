import type { ObjectiveRow, ObjectiveType } from "./readModel";

export const ONBOARDING_PRIORITY_GROUPS = [
  { type: "INDUSTRY", label: "Industrias", names: ["Tecnología", "Startups", "Banca y Finanzas", "Retail", "Consultoría"] },
  { type: "ROLE", label: "Cargos", names: ["Product Manager", "Diseño UX", "Desarrollador Full-Stack", "Data Analyst", "Gerente Comercial"] },
  { type: "COMPANY", label: "Empresas", names: ["Bci", "Falabella", "Mercado Libre", "Betterfly", "StartupCafe"] }
] as const;

export function priorityIdentity(name: string) {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}
export function onboardingPriorityCount(rows: ObjectiveRow[]) {
  return rows.filter(row => row.is_active && ONBOARDING_PRIORITY_GROUPS.some(group => group.type === row.objective_type)).length;
}
/** Reuse an existing priority, including its level and associations. Never delete. */
export function onboardingPriorityChange(rows: ObjectiveRow[], type: ObjectiveType, name: string, selected: boolean) {
  const clean = name.trim();
  if (!clean) throw new Error("Escribe una prioridad.");
  const matches = rows.filter(row => row.objective_type === type && priorityIdentity(row.objective_name) === priorityIdentity(clean));
  const active = matches.filter(row => row.is_active);
  if (active.length > 1 || (!active.length && matches.length > 1)) throw new Error("Hay prioridades coincidentes. Revísalas en Objetivos antes de continuar.");
  const existing = active[0] ?? matches[0];
  if (existing?.is_active === selected) return null;
  if (!selected && !existing) return null;
  return {
    objectiveId: existing?.id,
    objectiveName: existing?.objective_name ?? clean,
    objectiveType: type,
    priorityLevel: existing?.priority_level ?? "MEDIUM" as const,
    objectiveDescription: existing?.objective_description ?? "",
    isActive: selected
  };
}
