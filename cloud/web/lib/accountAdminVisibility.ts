import { supabase } from "./supabaseClient";

// Presentation only: each importer retains its existing authorization checks.
export async function readAccountAdminVisibility(userId: string): Promise<boolean> {
  if (!supabase || !userId) return false;
  const { data, error } = await supabase.from("user_role_assignments")
    .select("is_active, starts_at, expires_at, app_roles!inner(is_active)")
    .eq("user_id", userId).eq("role_code", "system_admin");
  if (error) throw error;
  return (data ?? []).some(row => {
    const role = Array.isArray(row.app_roles) ? row.app_roles[0] : row.app_roles;
    const now = Date.now();
    return row.is_active === true && role?.is_active === true
      && Date.parse(row.starts_at) <= now
      && (row.expires_at === null || Date.parse(row.expires_at) > now);
  });
}
