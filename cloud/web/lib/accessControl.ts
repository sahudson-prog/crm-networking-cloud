import { supabase } from "./supabaseClient.ts";

export type CapabilityCode =
  | "admin.manage_access"
  | "admin.view_diagnostics"
  | "admin.manage_global_masters"
  | "contacts.import_google"
  | "contacts.manage"
  | "interactions.import_google"
  | "coach.use"
  | "coach.automate"
  | "data.export"
  | "data.delete_account";

export type CapabilityAccessState = {
  allowed: boolean;
  capabilityCode: CapabilityCode;
  checked: boolean;
  email: string;
  message: string;
  status: "allowed" | "denied" | "no_session" | "missing_model" | "error";
};

export async function checkCurrentUserCapability(capabilityCode: CapabilityCode): Promise<CapabilityAccessState> {
  if (!supabase) {
    return accessState(capabilityCode, "", "error", "Supabase no esta configurado.");
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    return accessState(capabilityCode, "", "error", "No pude revisar la sesion.");
  }

  const email = sessionData.session?.user.email ?? "";
  if (!sessionData.session?.user) {
    return accessState(capabilityCode, email, "no_session", "Necesitas iniciar sesion.");
  }

  const { data, error } = await supabase.rpc("current_user_has_capability", {
    p_capability_code: capabilityCode
  });

  if (error) {
    const message = String(error.message ?? "");
    const missingModel = message.includes("current_user_has_capability") || message.includes("function");
    return accessState(
      capabilityCode,
      email,
      missingModel ? "missing_model" : "error",
      missingModel
        ? "Falta ejecutar el modelo de acceso v0.1 y asignar un administrador."
        : "No pude validar permisos."
    );
  }

  return accessState(
    capabilityCode,
    email,
    data === true ? "allowed" : "denied",
    data === true ? "Permiso activo." : "Tu usuario no tiene permiso para esta accion."
  );
}

export async function requireCurrentUserCapability(
  capabilityCode: CapabilityCode,
  actionLabel = "esta accion"
): Promise<CapabilityAccessState> {
  const state = await checkCurrentUserCapability(capabilityCode);
  if (!state.allowed) {
    throw new Error(capabilityDeniedMessage(state, actionLabel));
  }
  return state;
}

export function capabilityDeniedMessage(state: CapabilityAccessState, actionLabel = "esta accion") {
  if (state.status === "no_session") return "Necesitas iniciar sesion para usar esta accion.";
  if (state.status === "missing_model") return "Falta activar el modelo de accesos antes de usar esta accion.";
  if (state.status === "error") return state.message || "No pude validar tus permisos.";
  return `Tu usuario no tiene permiso para ${actionLabel}.`;
}

function accessState(
  capabilityCode: CapabilityCode,
  email: string,
  status: CapabilityAccessState["status"],
  message: string
): CapabilityAccessState {
  return {
    allowed: status === "allowed",
    capabilityCode,
    checked: true,
    email,
    message,
    status
  };
}
