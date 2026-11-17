import { supabase } from "./supabaseClient.ts";
import { validateTrackingSnapshot, type TrackingSnapshot } from "./trackingModel.ts";
import { readFirstCoffeeHistory } from "./firstCoffeeRead.ts";
import { reportReadFailure } from "./readDiagnostics.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function readTrackingSnapshot(client: SupabaseClient|null = supabase): Promise<TrackingSnapshot> {
  if (!client) throw new Error("tracking_not_configured");
  const { data, error } = await client.rpc("current_user_tracking_snapshot_v1");
  if (error) {reportReadFailure("tracking.snapshot",error);throw new Error("tracking_read_failed");}
  let snapshot:TrackingSnapshot;
  try {snapshot=validateTrackingSnapshot(data);} catch(error){reportReadFailure("tracking.snapshot_shape",error);throw error;}
  try {snapshot.coffeeHistory=await readFirstCoffeeHistory(client);}
  catch {snapshot.coffeeHistoryError=true;}
  return snapshot;
}
