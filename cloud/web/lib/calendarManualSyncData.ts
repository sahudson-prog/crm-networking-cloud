import { supabase } from "./supabaseClient.ts";
import { CalendarV2Error, runCalendarManualSync, type CalendarV2Progress } from "./calendarManualSync.ts";

export async function updateCalendarV2(input: {
  accessToken: string; connectedAccountId: string; timeMin: string; timeMax: string;
  progress?: (value: CalendarV2Progress) => void; signal?: AbortSignal;
}) {
  if (!supabase) throw new CalendarV2Error("CALENDAR_CONFIG", "begin");
  const db = supabase, run = crypto.randomUUID();
  return runCalendarManualSync(input, {
    // Native browser fetch requires Window as its receiver, not the dependencies object.
    fetch: (...args) => globalThis.fetch(...args), progress: input.progress, signal: input.signal,
    rpc: async (action, payload) => {
      let response;
      try {
        response = await db.rpc("calendar_manual_sync_v2", {
          p_account: input.connectedAccountId, p_run: run, p_action: action, p_payload: payload
        });
      } catch (error) { throw rpcTransportError(action, error); }
      const { data, error, status } = response;
      if (error) {
        if (!status || status >= 500) throw rpcTransportError(action);
        const allowed = ["42501", "40001", "55P03", "P0001", "22P02", "23514", "PGRST202"];
        throw new CalendarV2Error(allowed.includes(error.code) ? error.code : "CALENDAR_REJECTED", action, undefined, "calendar.rpc");
      }
      if (!data || typeof data !== "object" || Array.isArray(data)
        || (action === "renew" && data.status !== "running")) {
        throw new CalendarV2Error("CALENDAR_INVALID_RESPONSE", action, undefined, "calendar.rpc");
      }
      return data;
    }
  });
}

function rpcTransportError(action: string, cause?: unknown) {
  const error = new CalendarV2Error("CALENDAR_RPC_TRANSPORT", action, cause, "calendar.rpc");
  error.retryable = true;
  return error;
}
