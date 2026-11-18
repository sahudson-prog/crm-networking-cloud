import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {selectNetworkingContacts,linkedNetworkingIds} from "../lib/networkingScope.ts";
import {attributedCoffeeHistory,buildGamification,type GamificationInput} from "../lib/gamificationModel.ts";
import {buildTracking,type TrackingSnapshot} from "../lib/trackingModel.ts";
import {trackingFixture,coffee} from "./trackingFixtures.ts";

function input(s:TrackingSnapshot):GamificationInput {
  return {contacts:s.contacts,interactions:s.interactions,participants:s.participants,sources:s.sources,
    extra:{cycles:[{id:"cycle",objective_type:"JOB_SEARCH",status:"active",timezone_name:"America/Santiago"}],
      opportunities:s.opportunities,opportunityContacts:s.opportunities.flatMap(o=>o.contact_ids.map(contact_id=>({opportunity_id:o.id,contact_id}))),
      priorities:s.priorities,assignments:s.assignments.map((a,i)=>({...a,id:String(i)})),transitions:s.transitions,calendarSources:s.sources},
    history:attributedCoffeeHistory(s.contacts,{...s,coverageSince:"2026-01-01T00:00:00Z"},s.as_of)};
}
function model(i:GamificationInput,s:TrackingSnapshot){return buildGamification(i,Date.parse(s.as_of),"America/Santiago");}

test("canonical population is active explicit Foco, deduplicated; missing flags fail closed",()=>{
  const focused={id:"a",networking_focus:true,is_active:true};
  assert.deepEqual(selectNetworkingContacts([focused,focused,{id:"b",networking_focus:false},{id:"c",networking_focus:true,is_active:false}]),[focused]);
  assert.equal(selectNetworkingContacts([{id:"unknown"} as any]).length,0);
});

test("12 global interactions and only 3 linked to Foco cannot complete the ten-interaction milestone",()=>{
  const s=trackingFixture();s.contacts[1].networking_focus=false;
  for(let n=0;n<12;n++)coffee(s,`i${n}`,"2026-10-29T12:00:00Z",n<3?"a":"b","call");
  s.participants.push({interaction_id:"i0",contact_id:"c"},{interaction_id:"i0",contact_id:"b"},{interaction_id:"i0",contact_id:"a"});
  const ids=new Set(selectNetworkingContacts(s.contacts).map(c=>c.id));
  assert.equal(linkedNetworkingIds(s.participants,ids).size,3);
  assert.equal(model(input(s),s).route![3].done,false);
  s.contacts[1].networking_focus=true;
  assert.equal(model(input(s),s).route![3].done,true);
  s.contacts[1].networking_focus=false;
  assert.equal(model(input(s),s).route![3].done,false);
});

test("nine/ten distinct focused contacts and interactions; inactive, unlinked and discarded do not qualify",()=>{
  const s=trackingFixture();s.contacts=Array.from({length:11},(_,n)=>({...s.contacts[0],id:`c${n}`,networking_status:"Pendiente",networking_focus:n<9}));
  s.transitions=[];
  for(let n=0;n<11;n++)coffee(s,`i${n}`,"2026-10-29T12:00:00Z",`c${n}`,"call");
  coffee(s,"unlinked","2026-10-29T12:00:00Z","absent","call");
  assert.deepEqual(model(input(s),s).route!.slice(2,4).map(m=>m.done),[false,false]);
  s.contacts[9].networking_focus=true;
  assert.deepEqual(model(input(s),s).route!.slice(2,4).map(m=>m.done),[true,true]);
  s.interactions[9].metadata.dismissed=true;
  assert.equal(model(input(s),s).route![3].done,false);
  delete s.interactions[9].metadata.dismissed;s.interactions[9].is_deleted=true;
  assert.equal(model(input(s),s).route![3].done,false);
  s.interactions[9].is_deleted=false;
  const i=input(s);i.contacts![9].is_active=false;
  assert.deepEqual(model(i,s).route!.slice(2,4).map(m=>m.done),[false,false]);
});

test("current Foco controls first coffee, dated goals, streak, rolling average, projected and priority counts",()=>{
  const s=trackingFixture();s.as_of="2026-11-18T16:00:00Z";s.transitions=[];
  s.contacts[0].networking_status="Agradecimiento enviado";
  s.contacts[1].networking_status="Cita concretada";s.contacts[1].networking_focus=false;
  coffee(s,"focused","2026-11-17T12:00:00Z","a");coffee(s,"other","2026-11-10T12:00:00Z","b");
  coffee(s,"future","2026-11-24T12:00:00Z","c");
  let g=model(input(s),s);const t=buildTracking(s);assert.equal(t.state,"ready");if(t.state!=="ready")throw Error();
  assert.deepEqual(g.metrics.slice(0,3).map(m=>m.metric.value),[1,1,1]);assert.deepEqual(t.counts.slice(0,2),[1,1]);
  assert.equal(g.temporal.current.value,1);assert.equal(g.temporal.streak.value,1);assert.equal(g.temporal.average,.25);assert.equal(g.goals[1].metric.value,1);
  s.contacts[0].networking_focus=false;s.contacts[2].networking_focus=false;
  g=model(input(s),s);assert.equal(g.temporal.current.value,0);assert.equal(g.temporal.streak.value,0);assert.equal(g.temporal.average,0);assert.equal(g.goals[1].metric.value,0);
  assert.equal(g.route![1].done,false);
});

test("non-Foco missing dates do not poison focal coverage; undated focal coffee preserves accumulated total",()=>{
  const s=trackingFixture();s.contacts[0].networking_focus=false;s.transitions=[];
  let g=model(input(s),s);assert.equal(g.temporal.streak.value,0);
  s.contacts[0].networking_focus=true;g=model(input(s),s);
  assert.equal(g.metrics[2].metric.value,1);assert.equal(g.temporal.streak.value,0);assert.equal(g.temporal.current.value,0);assert.equal(g.temporal.average,0);
});

test("processes require actual Foco associations, deduplicate links, and fail closed when links cannot be read",()=>{
  const s=trackingFixture();s.contacts[1].networking_focus=false;
  s.opportunities[1].contact_ids=["b"];
  const i=input(s);i.extra.opportunityContacts!.push({...i.extra.opportunityContacts![0]});
  assert.equal(model(i,s).metrics[3].metric.value,1);
  const t=buildTracking(s);if(t.state!=="ready")throw Error();assert.equal(t.counts[2],1);
  s.contacts[0].networking_focus=false;
  assert.equal(model(input(s),s).metrics[3].metric.value,0);assert.equal(model(input(s),s).route![4].done,false);
  i.extra.opportunityContacts=null;assert.equal(model(i,s).metrics[3].metric.value,null);assert.equal(model(i,s).route,null);
});

test("inactive cancellation source never contributes to focal interaction milestone",()=>{
  const s=trackingFixture();
  for(let n=0;n<10;n++)coffee(s,`i${n}`,"2026-10-29T12:00:00Z","a");
  s.sources[9].sync_status="deleted_at_source";s.sources[9].is_active=false;
  const i=input(s);i.sources=[];
  assert.equal(model(i,s).route![3].done,false);
});

test("Foco writes invalidate existing readers; planning and Producir use canonical scope, no per-contact reads",()=>{
  const actions=readFileSync(new URL("../lib/contactActions.ts",import.meta.url),"utf8");
  assert.match(actions,/\.update\(\{ \.\.\.effectivePatch[\s\S]*?if \(updateError\) throw updateError;\s*notifyNetworkingDataChanged\(\)/);
  const dashboard=readFileSync(new URL("../components/ReadOnlyDashboard.tsx",import.meta.url),"utf8");
  assert.match(dashboard,/view === "referrals" \? details\?\.contacts \?\? \[\] : selectNetworkingContacts/);
  const reader=readFileSync(new URL("../lib/gamificationRead.ts",import.meta.url),"utf8");
  assert.match(reader,/from\("opportunity_contacts"\)[\s\S]*?\.eq\("user_id",owner\)\.order\("opportunity_id"\)\.order\("contact_id"\)/);
});

test("goal confirmation matches title typography and uses a 26px check with wrapping",()=>{
  const css=readFileSync(new URL("../styles/gamification.css",import.meta.url),"utf8");
  for(const selector of [".gam-goal h3", ".gam-complete"]){
    const rule=css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    assert.match(rule,/font-size: 16px/);assert.match(rule,/font-weight: 700/);
  }
  assert.match(css,/\.gam-complete svg \{ width: 26px; height: 26px/);
  assert.match(css,/\.gam-goal-heading \{[^}]*flex-wrap: wrap/);
});
