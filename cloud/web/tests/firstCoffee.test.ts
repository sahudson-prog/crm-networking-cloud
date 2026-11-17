import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {selectFirstCoffee,buildTracking,type FirstCoffeeHistory} from "../lib/trackingModel.ts";
import {attributedCoffeeHistory,buildGamification,coffeeWeeks} from "../lib/gamificationModel.ts";
import {readFirstCoffeeHistory} from "../lib/firstCoffeeRead.ts";
import {notifyNetworkingDataChanged,subscribeNetworkingDataRevision,getNetworkingDataRevision} from "../lib/networkingDataRevision.ts";
import {trackingFixture,coffee} from "./trackingFixtures.ts";

function fixture() {
  const s=trackingFixture();s.as_of="2026-11-18T16:00:00Z";
  const history:FirstCoffeeHistory={...s,coverageSince:"2026-01-01T00:00:00Z"};
  s.coffeeHistory=history;
  return {s,history};
}
function gam(s:ReturnType<typeof trackingFixture>) {
  return buildGamification({contacts:s.contacts,interactions:s.interactions,participants:s.participants,sources:s.sources,
    extra:{cycles:[],opportunities:[],opportunityContacts:[],priorities:[],assignments:[],transitions:s.transitions,calendarSources:s.sources},
    history:attributedCoffeeHistory(s.contacts,s.coffeeHistory,s.as_of)},Date.parse(s.as_of),"America/Santiago");
}
test("global appointment precedes cycle and wins in all three consumers",()=>{
  const {s}=fixture();coffee(s,"past","2026-11-17T15:00:00Z");s.cycle!.started_at="2026-11-18T12:00:00Z";
  const a=selectFirstCoffee(s.contacts,s.coffeeHistory!,s.as_of),track=buildTracking(s),g=gam(s);
  assert.equal(a.dates.get("a"),Date.parse("2026-11-17T15:00:00Z"));
  if(track.state!=="ready")throw Error();assert.equal(track.blue.get("person:a"),a.dates.get("a"));
  assert.equal(track.counts[1],1);assert.equal(g.metrics[2].metric.value,1);
  assert.equal(g.temporal.current.value,1);assert.equal(g.temporal.streak.value,1);assert.equal(g.temporal.average,.25);
});
test("later recorded appointment relocates first coffee, no additional weekly meeting",()=>{
  const {s}=fixture();s.transitions[0].changed_at="2026-11-17T12:00:00Z";
  assert.equal(gam(s).temporal.current.value,1);
  coffee(s,"late-import","2026-11-10T12:00:00Z");coffee(s,"another","2026-11-17T12:00:00Z");
  assert.equal(gam(s).temporal.current.value,0);assert.equal(gam(s).temporal.streak.value,1);
  assert.equal(gam(s).temporal.average,.25);assert.equal(gam(s).metrics[2].metric.value,1);
  s.contacts[0].networking_status="Agradecimiento enviado";assert.equal(gam(s).temporal.streak.value,1);
});
test("cancellations fall through next valid appointment then first Cita transition",()=>{
  const {s}=fixture();coffee(s,"first","2026-11-10T12:00:00Z");coffee(s,"second","2026-11-17T12:00:00Z");
  s.sources[0].sync_status="deleted_at_source";s.sources[0].is_active=false;
  assert.equal(gam(s).temporal.current.value,1);
  s.interactions[1].metadata.ics_import!.status="CANCELLED";
  const a=selectFirstCoffee(s.contacts,s.coffeeHistory!,s.as_of);
  assert.equal(a.byTransition.get("a"),Date.parse(s.transitions[0].changed_at));assert.equal(a.eligible.size,1);
  s.sources[0].sync_status="imported";assert.equal(gam(s).temporal.current.value,0);
});
test("initialized eligible state and direct thanks are not a transition to Cita",()=>{
  const {s,history}=fixture();history.transitions=[{...s.transitions[0],event_kind:"initialized",previous_status:null}];
  assert.equal(selectFirstCoffee(s.contacts,history,s.as_of).missing.size,1);
  history.transitions=[{...s.transitions[0],next_status:"Agradecimiento enviado"}];
  assert.equal(attributedCoffeeHistory(s.contacts,history,s.as_of)!.complete,false);
  assert.equal(gam(s).metrics[2].metric.value,1);assert.equal(gam(s).temporal.current.value,null);
});
test("focus-only change in Cita does not overwrite the actual first transition",()=>{
  const {s,history}=fixture();history.transitions=[{...s.transitions[0],changed_fields:["networking_focus"]}];
  assert.equal(selectFirstCoffee(s.contacts,history,s.as_of).missing.size,1);
  history.transitions.push({...s.transitions[0],changed_fields:["networking_status"],event_kind:"changed"});
  assert.equal(selectFirstCoffee(s.contacts,history,s.as_of).byTransition.size,1);
});
test("past/future and duplicate links; appointment alone never accredits a contact",()=>{
  const {s}=fixture();coffee(s,"future","2026-12-01T00:00:00Z");coffee(s,"pending","2026-11-17T00:00:00Z","b");
  coffee(s,"past","2026-11-17T00:00:00Z");s.participants.push({...s.participants[2]});
  assert.equal(gam(s).temporal.current.value,1);assert.equal(gam(s).metrics[2].metric.value,1);
  assert.equal(attributedCoffeeHistory(s.contacts,s.coffeeHistory,s.as_of)!.events.length,1);
});
test("missing timestamp preserves eligible total; no current-cycle fallback pretending full history",()=>{
  const {s,history}=fixture();history.transitions=[];coffee(s,"undated","2026-11-17T00:00:00Z");s.interactions[0].occurred_at=null;
  const track=buildTracking(s);if(track.state!=="ready")throw Error();
  assert.equal(track.counts[1],1);assert.equal(track.blue.size,0);assert.equal(track.unattributedCoffeeCount,1);
  assert.equal(gam(s).temporal.average,null);assert.equal(gam(s).goals[0].metric.value,null);
});
test("GAM and funnel apply current Foco to the shared first-coffee attribution",()=>{
  const {s}=fixture();coffee(s,"first","2026-11-17T12:00:00Z");s.contacts[0].networking_focus=false;
  const track=buildTracking(s);if(track.state!=="ready")throw Error();
  assert.equal(track.counts[1],0);assert.equal(track.blue.size,0);assert.equal(gam(s).temporal.current.value,0);
});
test("coverage anchor is account creation, zero weeks retained; older imported first coffee extends it",()=>{
  const {s,history}=fixture();history.coverageSince="2026-11-11T16:00:00Z";history.transitions=[];
  coffee(s,"first","2026-11-17T16:00:00Z");assert.equal(gam(s).temporal.average,1);assert.equal(gam(s).temporal.averageDays,7);
  coffee(s,"older","2026-10-01T12:00:00Z");assert.equal(gam(s).temporal.averageDays,28);assert.equal(gam(s).temporal.average,0);
});
test("attributed timestamps retain local Monday and DST boundaries",()=>{
  const {s,history}=fixture();s.as_of="2026-09-07T03:01:00Z";history.transitions=[];
  coffee(s,"sunday","2026-09-07T02:59:59Z");assert.equal(gam(s).temporal.current.value,0);assert.equal(gam(s).temporal.streak.value,1);
  s.interactions[0].occurred_at="2026-09-07T03:00:00Z";assert.equal(gam(s).temporal.current.value,1);
  assert.equal(coffeeWeeks(attributedCoffeeHistory(s.contacts,history,s.as_of),Date.parse(s.as_of),"America/Santiago").average,.25);
});

test("historical reader is complete, owner-scoped, no cycle restriction or content fields",async()=>{
  const calls:Array<{table:string;columns:string;filters:Array<[string,unknown]>}>=[];
  const rows:Record<string,any[]>={interactions:Array.from({length:205},(_,i)=>({id:`i${i}`,interaction_type:"calendar",occurred_at:"2020-01-01T00:00:00Z",metadata:{}})),interaction_participants:[],external_interaction_sources:[],contact_networking_transitions:[]};
  const client={auth:{getUser:async()=>({data:{user:{id:"owner"}},error:null})},from(table:string){
    const call={table,columns:"",filters:[] as Array<[string,unknown]>};calls.push(call);
    const q={select(columns:string){call.columns=columns;return q;},eq(key:string,value:unknown){call.filters.push([key,value]);return q;},order(){return q;},range(from:number,to:number){return {returns:()=>Promise.resolve({data:rows[table].slice(from,Math.min(to+1,from+100)),count:rows[table].length,error:null})};},single(){return Promise.resolve({data:{created_at:"2020-01-01T00:00:00Z"},error:null});}};return q;
  }};
  const result=await readFirstCoffeeHistory(client as any);assert.equal(result.interactions.length,205);
  for(const c of calls){assert.ok(c.filters.some(([k,v])=>k===(c.table==="profiles"?"id":"user_id")&&v==="owner"));assert.doesNotMatch(c.columns,/subject|notes|email|token/);assert.ok(!c.filters.some(([k])=>k==="cycle_id"));}
});
test("local mutation invalidates subscribed readers, cleanup removes listeners",()=>{
  let seen=0;const before=getNetworkingDataRevision(),unsubscribe=subscribeNetworkingDataRevision(()=>seen++);
  notifyNetworkingDataChanged();assert.equal(seen,1);assert.equal(getNetworkingDataRevision(),before+1);
  unsubscribe();notifyNetworkingDataChanged();assert.equal(seen,1);
  for(const file of ["interactionActions.ts","contactActions.ts","coachActions.ts"]){
    assert.match(readFileSync(new URL(`../lib/${file}`,import.meta.url),"utf8"),/notifyNetworkingDataChanged\(\)/);
  }
  const dashboard=readFileSync(new URL("../components/ReadOnlyDashboard.tsx",import.meta.url),"utf8");
  assert.match(dashboard,/useSyncExternalStore\(subscribeNetworkingDataRevision/);assert.match(dashboard,/\[revision, dataRevision, calendarSyncedAt/);
});
