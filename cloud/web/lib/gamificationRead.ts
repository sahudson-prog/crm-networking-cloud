import { supabase } from "./supabaseClient";
import { readCompletePages } from "./completeRead";
import { reportReadFailure } from "./readDiagnostics";
import type { GamificationExtra } from "./gamificationModel";
import type { FirstCoffeeHistory } from "./trackingModel";

// Narrow metadata only. RLS and the existing Auth identity remain mandatory.
// Existing cycle/opportunity UI readers are cycle-scoped or capped, so they
// cannot certify all-user milestones. Reuse the exact-count paginator instead.
export async function readGamificationExtra(history?:FirstCoffeeHistory|Promise<FirstCoffeeHistory>,verifiedOwner?:string):Promise<GamificationExtra> {
  if(!supabase) throw new Error("gamification_unavailable");
  const client=supabase;
  const auth=verifiedOwner?null:await client.auth.getUser();
  const owner=verifiedOwner??auth?.data.user?.id;
  if(auth?.error||!owner) throw new Error("gamification_access_denied");
  const evidence=history?Promise.resolve(history).catch(()=>null):null;
  async function complete<T extends {id:string}>(table:string,columns:string,filter:(q:any)=>any=(q)=>q):Promise<T[]|null> {
    try {return await readCompletePages<T>(async(from,to)=>await filter(client.from(table).select(columns,{count:"exact"}).eq("user_id",owner)).order("id").range(from,to));}
    catch(error) {reportReadFailure(`gamification.${table}`,error);return null;}
  }
  async function opportunityContacts():Promise<GamificationExtra["opportunityContacts"]> {
    try {
      return await readCompletePages(async(from,to)=>{
        const result=await client.from("opportunity_contacts").select("opportunity_id,contact_id",{count:"exact"})
          .eq("user_id",owner).order("opportunity_id").order("contact_id").range(from,to);
        return {...result,data:result.data?.map(link=>({...link,id:`${link.opportunity_id}:${link.contact_id}`}))??null};
      });
    } catch(error) {reportReadFailure("gamification.opportunity_contacts",error);return null;}
  }
  const [cycles,opportunities,priorities,assignments,transitions,calendarSources,links]=await Promise.all([
    complete<NonNullable<GamificationExtra["cycles"]>[number]>("networking_cycles","id,objective_type,status,timezone_name"),
    complete<NonNullable<GamificationExtra["opportunities"]>[number]>("opportunities","id,stage,situation",q=>q.is("voided_at",null).neq("situation","voided")),
    complete<NonNullable<GamificationExtra["priorities"]>[number]>("objectives","id",q=>q.eq("is_active",true)),
    complete<NonNullable<GamificationExtra["assignments"]>[number]>("contact_objective_assignments","id,contact_id,objective_id"),
    evidence?evidence.then(h=>h?.transitions??null):complete<NonNullable<GamificationExtra["transitions"]>[number]>("contact_networking_transitions","id,contact_id,next_status"),
    evidence?evidence.then(h=>h?.sources??null):complete<NonNullable<GamificationExtra["calendarSources"]>[number]&{id:string}>("external_interaction_sources","id,interaction_id,provider,source_service,sync_status,is_active"),
    opportunityContacts()
  ]);
  return {cycles,opportunities,priorities,assignments,transitions,calendarSources,opportunityContacts:links};
}
