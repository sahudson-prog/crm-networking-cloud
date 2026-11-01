import { supabase } from "./supabaseClient";
import { validateTrackingSnapshot, type TrackingSnapshot } from "./trackingModel";

export async function readTrackingSnapshot(): Promise<TrackingSnapshot> {
  if (!supabase) throw new Error("tracking_not_configured");
  const { data, error } = await supabase.rpc("current_user_tracking_snapshot_v1");
  if (error) throw new Error("tracking_read_failed");
  return validateTrackingSnapshot(data);
}
