import { requireCurrentUserCapability } from "./accessControl";
import { supabase } from "./supabaseClient";

export type ResetCurrentUserAppDataRow = {
  deletedRowCount: number;
  deletedTableName: string;
};

export async function resetCurrentUserAppData(confirmation: string): Promise<ResetCurrentUserAppDataRow[]> {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  await requireCurrentUserCapability("data.delete_account", "reiniciar tus datos");

  const { data, error } = await supabase.rpc("reset_current_user_app_data_v0_1", {
    p_confirmation: confirmation
  });

  if (error) {
    if (String(error.message ?? "").includes("reset_current_user_app_data_v0_1")) {
      throw new Error("Falta ejecutar la funcion de reinicio de datos en Supabase.");
    }
    throw error;
  }

  return ((data ?? []) as Array<{ deleted_row_count?: number; deleted_table_name?: string }>).map((row) => ({
    deletedRowCount: Number(row.deleted_row_count ?? 0),
    deletedTableName: row.deleted_table_name ?? ""
  }));
}
