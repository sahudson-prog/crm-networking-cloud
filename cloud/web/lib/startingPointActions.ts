import {
  EMPTY_STARTING_POINT,
  isProfessionalSituationCode,
  normalizeStartingPoint,
  type StartingPointValues
} from "./startingPoint";
import { parseDateSetting } from "./syncDate";
import { supabase } from "./supabaseClient";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no está configurado.");
  return supabase;
}

export async function readCurrentUserStartingPoint(): Promise<StartingPointValues> {
  const { data, error } = await requireSupabase().rpc("current_user_starting_point_v1");
  if (error) throw startingPointRpcError(error, "read");
  return parseStartingPoint(data);
}

export async function saveCurrentUserStartingPoint(
  values: StartingPointValues,
  fields: Array<keyof StartingPointValues> = ["fullName", "professionalSituationCode", "networkingStartDate"]
): Promise<StartingPointValues> {
  const normalized = normalizeStartingPoint(values);
  const { data, error } = await requireSupabase().rpc("save_current_user_starting_point_v1", {
    p_full_name: fields.includes("fullName") ? normalized.fullName : null,
    p_networking_start_date: fields.includes("networkingStartDate") ? normalized.networkingStartDate : null,
    p_professional_situation_code: fields.includes("professionalSituationCode")
      ? normalized.professionalSituationCode
      : null
  });
  if (error) throw startingPointRpcError(error, "save");
  return parseStartingPoint(data);
}

function parseStartingPoint(value: unknown): StartingPointValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_STARTING_POINT;
  const record = value as Record<string, unknown>;
  const situation = record.professional_situation_code;
  const rawNetworkingDate = typeof record.networking_start_date === "string" ? record.networking_start_date : "";
  const parsedNetworkingDate = parseDateSetting(rawNetworkingDate);
  return {
    fullName: typeof record.full_name === "string" ? record.full_name : "",
    networkingStartDate: parsedNetworkingDate?.toISOString().slice(0, 10) ?? rawNetworkingDate,
    professionalSituationCode: isProfessionalSituationCode(situation) ? situation : ""
  };
}

function startingPointRpcError(error: { message?: string }, operation: "read" | "save") {
  const message = String(error.message ?? "");
  if (message.includes("app_access_denied")) return new Error("Tu acceso ya no permite actualizar estos datos.");
  if (message.includes("starting_point_")) return new Error("Revisa los datos antes de guardarlos.");
  if (message.includes("current_user_starting_point_v1") || message.includes("save_current_user_starting_point_v1")) {
    return new Error("Falta aplicar el contrato de Tu punto de partida en este ambiente.");
  }
  return new Error(
    operation === "read"
      ? "No pudimos leer Tu punto de partida. Intenta nuevamente."
      : "No pudimos guardar Tu punto de partida. Intenta nuevamente."
  );
}
