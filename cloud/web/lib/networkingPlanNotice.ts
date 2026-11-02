"use client";

import { supabase } from "./supabaseClient.ts";
import { FUTURE_NETWORKING_PLANS, type FutureNetworkingPlan } from "./networkingPlanNoticeFlow.ts";

function requireClient() {
  if (!supabase) throw new Error("Supabase no está configurado.");
  return supabase;
}

export async function readMyNetworkingPlanNotices(): Promise<Set<FutureNetworkingPlan>> {
  const client = requireClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  if (!userData.user?.id) throw new Error("No hay usuario autenticado.");
  const { data, error } = await client.from("networking_plan_interest")
    .select("objective_type").eq("user_id", userData.user.id);
  if (error) throw error;
  const allowed = new Set<string>(FUTURE_NETWORKING_PLANS);
  return new Set((data ?? []).map((row) => row.objective_type)
    .filter((value): value is FutureNetworkingPlan => allowed.has(value)));
}

async function changeNotice(modality: FutureNetworkingPlan, rpc: string) {
  const { error } = await requireClient().rpc(rpc, { p_objective_type: modality });
  if (error) throw error;
}

export const requestNetworkingPlanNotice = (modality: FutureNetworkingPlan) =>
  changeNotice(modality, "request_networking_plan_notice_v1");

export const withdrawNetworkingPlanNotice = (modality: FutureNetworkingPlan) =>
  changeNotice(modality, "withdraw_networking_plan_notice_v1");
