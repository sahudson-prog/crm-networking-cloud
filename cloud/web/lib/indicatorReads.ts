import {supabase} from "./supabaseClient";
import {ScopedReadCache} from "./scopedReadCache";
import {readFirstCoffeeHistory} from "./firstCoffeeRead";
import {readTrackingSnapshot} from "./trackingRead";
import {readGamificationExtra} from "./gamificationRead";
import {subscribeNetworkingDataRevision} from "./networkingDataRevision";
import {subscribeGlobalActivitySync,getGlobalActivitySyncSnapshot} from "./activitySyncExecution";
import type {TrackingSnapshot} from "./trackingModel";
import type {GamificationExtra} from "./gamificationModel";

const cache=new ScopedReadCache();
let authPending:Promise<string>|null=null, authGeneration=0, currentOwner:string|null=null;
export function invalidateIndicatorReads(){cache.invalidate();}
export const peekTrackingSnapshot=()=>cache.peek<TrackingSnapshot>("tracking");
export const peekGamificationExtra=()=>cache.peek<GamificationExtra>("gamification");
subscribeNetworkingDataRevision(invalidateIndicatorReads);
let syncedAt=getGlobalActivitySyncSnapshot().lastSuccess?.calendar;
subscribeGlobalActivitySync(()=>{const next=getGlobalActivitySyncSnapshot().lastSuccess?.calendar;if(next!==syncedAt){syncedAt=next;cache.invalidate();}});
supabase?.auth.onAuthStateChange((_event,session)=>{
  const next=session?.user.id??null;
  if(next!==currentOwner){currentOwner=next;authGeneration++;authPending=null;cache.scope(next);}
});
async function owner(){
  if(!supabase)throw Error("tracking_not_configured");
  if(authPending)return authPending;
  const generation=authGeneration;
  const pending=supabase.auth.getUser().then(({data,error})=>{
    if(generation!==authGeneration&&currentOwner!==data.user?.id)throw Error("read_superseded");
    if(error||!data.user){cache.scope(null);throw Error("read_access_denied");}
    currentOwner=data.user.id;cache.scope(currentOwner);return currentOwner;
  }).finally(()=>{if(authPending===pending)authPending=null;});
  authPending=pending;return pending;
}
function history(user:string){return cache.read("interaction-evidence",()=>readFirstCoffeeHistory(supabase!,true,user));}
export async function readSharedTrackingSnapshot(){
  const user=await owner();
  if(user!==currentOwner)throw Error("read_superseded");
  return cache.read("tracking",()=>readTrackingSnapshot(supabase,history(user)),result=>!result.coffeeHistoryError);
}
export async function readSharedGamificationExtra(){
  const user=await owner();
  if(user!==currentOwner)throw Error("read_superseded");
  return cache.read("gamification",()=>readGamificationExtra(history(user),user),result=>Object.values(result).every(value=>value!==null));
}
