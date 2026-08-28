import { supabase } from "./supabaseClient";
import { requireCurrentUserCapability } from "./accessControl";

export type AccessCapability = {
  capabilityCode: string;
  displayName: string;
  capabilityArea: string;
  description: string;
  isActive: boolean;
};

export type AccessRole = {
  displayName: string;
  isActive: boolean;
  roleCode: string;
};

export type AccessPlan = {
  displayName: string;
  isActive: boolean;
  planCode: string;
  tierRank: number;
};

export type AccessUser = {
  accountStatus: string;
  betaAccessStatus: string;
  email: string;
  fullName: string;
  planCode: string;
  roles: AccessUserRole[];
  userId: string;
};

export type AccessUserRole = {
  assignmentId: string;
  isActive: boolean;
  roleCode: string;
};

export type AccessAdminModel = {
  capabilities: AccessCapability[];
  currentUserId: string;
  plans: AccessPlan[];
  roles: AccessRole[];
  users: AccessUser[];
};

export async function loadAccessAdminModel(): Promise<AccessAdminModel> {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  await requireCurrentUserCapability("admin.manage_access", "administrar accesos");
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const currentUserId = authData.user?.id;
  if (!currentUserId) throw new Error("No pude identificar el usuario actual.");

  const [profiles, accessProfiles, roles, plans, capabilities, assignments] = await Promise.all([
    selectProfiles(),
    selectAccessProfiles(),
    selectRoles(),
    selectPlans(),
    selectCapabilities(),
    selectRoleAssignments()
  ]);

  const accessByUser = new Map(accessProfiles.map((profile) => [profile.user_id, profile]));
  const rolesByUser = groupBy(assignments, (assignment) => assignment.user_id);

  return {
    capabilities,
    currentUserId,
    plans,
    roles,
    users: profiles.map((profile) => {
      const access = accessByUser.get(profile.id);
      return {
        accountStatus: access?.account_status ?? "sin perfil",
        betaAccessStatus: access?.beta_access_status ?? "sin perfil",
        email: profile.email ?? "",
        fullName: profile.full_name ?? "",
        planCode: access?.plan_code ?? "",
        roles: (rolesByUser.get(profile.id) ?? []).map((role) => ({
          assignmentId: role.id,
          isActive: role.is_active,
          roleCode: role.role_code
        })),
        userId: profile.id
      };
    })
  };
}

export async function saveUserPlan(userId: string, planCode: string) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  await requireCurrentUserCapability("admin.manage_access", "administrar accesos");

  const { error } = await supabase
    .from("user_access_profiles")
    .upsert({
      account_status: "active",
      beta_access_status: "approved",
      plan_code: planCode,
      user_id: userId
    });
  if (error) throw error;
}

export async function grantUserRole(userId: string, roleCode: string) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  await requireCurrentUserCapability("admin.manage_access", "administrar accesos");

  const { error } = await supabase
    .from("user_role_assignments")
    .insert({
      assignment_reason: "Asignado desde Mantencion admin",
      role_code: roleCode,
      user_id: userId
    });
  if (error) throw error;
}

export async function setUserRoleActive(assignmentId: string, isActive: boolean) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  await requireCurrentUserCapability("admin.manage_access", "administrar accesos");

  const { error } = await supabase
    .from("user_role_assignments")
    .update({ is_active: isActive })
    .eq("id", assignmentId);
  if (error) throw error;
}

async function selectProfiles() {
  const { data, error } = await supabase!
    .from("profiles")
    .select("id,email,full_name,created_at,updated_at")
    .order("email", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Array<{ email: string | null; full_name: string | null; id: string }>;
}

async function selectAccessProfiles() {
  const { data, error } = await supabase!
    .from("user_access_profiles")
    .select("user_id,plan_code,account_status,beta_access_status");
  if (error) throw error;
  return (data ?? []) as Array<{
    account_status: string;
    beta_access_status: string;
    plan_code: string | null;
    user_id: string;
  }>;
}

async function selectRoles(): Promise<AccessRole[]> {
  const { data, error } = await supabase!
    .from("app_roles")
    .select("role_code,display_name,is_active")
    .order("display_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((role: any) => ({
    displayName: role.display_name ?? "",
    isActive: role.is_active !== false,
    roleCode: role.role_code ?? ""
  }));
}

async function selectPlans(): Promise<AccessPlan[]> {
  const { data, error } = await supabase!
    .from("subscription_plans")
    .select("plan_code,display_name,tier_rank,is_active")
    .order("tier_rank", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((plan: any) => ({
    displayName: plan.display_name ?? "",
    isActive: plan.is_active !== false,
    planCode: plan.plan_code ?? "",
    tierRank: Number(plan.tier_rank) || 0
  }));
}

async function selectCapabilities(): Promise<AccessCapability[]> {
  const { data, error } = await supabase!
    .from("app_capabilities")
    .select("capability_code,display_name,capability_area,description,is_active")
    .order("capability_area", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((capability: any) => ({
    capabilityArea: capability.capability_area ?? "",
    capabilityCode: capability.capability_code ?? "",
    description: capability.description ?? "",
    displayName: capability.display_name ?? "",
    isActive: capability.is_active !== false
  }));
}

async function selectRoleAssignments() {
  const { data, error } = await supabase!
    .from("user_role_assignments")
    .select("id,user_id,role_code,is_active")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; is_active: boolean; role_code: string; user_id: string }>;
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const current = result.get(key) ?? [];
    current.push(item);
    result.set(key, current);
  }
  return result;
}
