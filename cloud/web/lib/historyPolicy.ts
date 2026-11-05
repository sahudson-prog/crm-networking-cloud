import { supabase } from "./supabaseClient.ts";

export type HistoryWindow = { cycle_id: string; context: string; max_months: number; revision: number; timezone: string; effective_start: string };
export type HistoryPolicy = { max_months: number; revision: number; earliest_start: string; as_of: string };
export class HistoryCycleRequiredError extends Error {}
export function historyImportCopy(months: number) {
  return `Traeremos tus correos y citas desde el inicio de tu proceso, con un máximo de ${months} meses hacia atrás.`;
}
function validPolicy(v: any) { return v && Number.isInteger(v.max_months) && v.max_months >= 1 && v.max_months <= 12 && Number.isSafeInteger(v.revision) && v.revision > 0; }
export function parseHistoryWindow(v: any): HistoryWindow {
  if (!validPolicy(v) || typeof v.cycle_id !== "string" || typeof v.context !== "string" || typeof v.timezone !== "string"
    || typeof v.effective_start !== "string" || !Number.isFinite(Date.parse(v.effective_start))) throw new Error("No pudimos validar la ventana de importación.");
  return { cycle_id: v.cycle_id, context: v.context, max_months: v.max_months, revision: v.revision, timezone: v.timezone, effective_start: v.effective_start };
}
async function rpc(name: string, args?: Record<string, unknown>) {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (/history_active_cycle_required|history_cycle_start_required/.test(error.message)) throw new HistoryCycleRequiredError("Configura el inicio de tu proceso en Objetivos antes de importar correos o citas.");
    if (/stale/.test(error.message)) throw new Error("El proceso o el límite cambió. Vuelve a revisar antes de aplicar.");
    throw new Error("No pudimos confirmar la política de importación. Reintenta.");
  }
  return data;
}
export async function readHistoryWindow() { return parseHistoryWindow(await rpc("current_user_history_window_v1")); }
export async function revalidateHistoryWindow(expected: HistoryWindow) {
  const current = await readHistoryWindow();
  if (Object.keys(current).some(key => current[key as keyof HistoryWindow] !== expected[key as keyof HistoryWindow])) {
    throw new Error("El proceso o el límite cambió. Vuelve a revisar antes de aplicar.");
  }
  return current;
}
export async function readHistoryPolicy(timezone: string): Promise<HistoryPolicy> {
  const data = await rpc("current_user_networking_history_policy_v1", { p_timezone: timezone });
  if (!validPolicy(data) || !Number.isFinite(Date.parse(data.earliest_start)) || !Number.isFinite(Date.parse(data.as_of))) throw new Error("No pudimos validar el límite vigente.");
  return data;
}
export async function saveHistoryPolicy(months: number, revision: number) {
  return rpc("admin_set_networking_history_policy_v1", { p_months: months, p_expected_revision: revision });
}
