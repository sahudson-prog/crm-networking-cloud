import { readCompletePages } from "./completeRead.ts";
import { reportReadFailure } from "./readDiagnostics.ts";
import { isMissingInteractionLifecycleColumn, legacyInteractionColumns } from "./interactionSchemaCompatibility.ts";
import type { FirstCoffeeHistory, TrackingSnapshot } from "./trackingModel";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Minimal technical fields, complete owner-scoped reads under existing RLS. */
export async function readFirstCoffeeHistory(client: SupabaseClient, allInteractions=false, verifiedOwner?:string): Promise<FirstCoffeeHistory> {
  const auth=verifiedOwner?null:await client.auth.getUser();
  const owner=verifiedOwner??auth?.data.user?.id;
  if(auth?.error || !owner)throw Error("coffee_history_access_denied");
  async function complete<T extends {id:string}>(table:string,columns:string,calendar=false):Promise<T[]> {
    return readCompletePages<T>(async(from,to)=>{
      const page=async()=>{
        let query=client.from(table).select(columns,{count:"exact"}).eq("user_id",owner);
        if(calendar&&!allInteractions)query=query.eq("interaction_type","calendar");
        return await query.order("id").range(from,to).returns<T[]>();
      };
      const result=await page();
      // DEV legacy lacks optional lifecycle columns; retain metadata and source lifecycle.
      if(calendar && isMissingInteractionLifecycleColumn(result.error)){
        columns=legacyInteractionColumns(columns.split(",")).join(",");
        return page();
      }
      return result;
    }).catch(error=>{reportReadFailure(`first_coffee.${table}`,error);throw error;});
  }
  const [interactions,participants,sources,transitions,profile]=await Promise.all([
    complete<TrackingSnapshot["interactions"][number]>("interactions","id,interaction_type,occurred_at,is_deleted,metadata",true),
    complete<{id:string;interaction_id:string;contact_id:string|null}>("interaction_participants","id,interaction_id,contact_id"),
    complete<TrackingSnapshot["sources"][number]&{id:string}>("external_interaction_sources","id,interaction_id,provider,source_service,sync_status,is_active"),
    complete<FirstCoffeeHistory["transitions"][number]>("contact_networking_transitions","id,contact_id,previous_status,next_status,changed_at,event_kind,changed_fields"),
    client.from("profiles").select("created_at").eq("id",owner).single()
  ]);
  if(profile.error || !Number.isFinite(Date.parse(profile.data?.created_at))){reportReadFailure("first_coffee.profiles",profile.error,profile.status);throw Error("coffee_history_coverage_unavailable");}
  return {interactions,participants:participants.filter((p):p is typeof p & {contact_id:string}=>p.contact_id!==null),sources,transitions,coverageSince:profile.data.created_at};
}
