import test from "node:test";
import assert from "node:assert/strict";
import {buildTracking,defaultTrackingFilters,networkingContactIds,selectTrackingCalendar,nearestProjectedContacts,trackingPeriods,periodKey} from "../lib/trackingModel.ts";
import {buildGamification,projectedCoffees,evidenceInstant,shiftWeek,type GamificationInput} from "../lib/gamificationModel.ts";
import {trackingFixture,coffee} from "./trackingFixtures.ts";

function models(s=trackingFixture()) {
  const input:GamificationInput={contacts:s.contacts,interactions:s.interactions,participants:s.participants,sources:s.sources,
    extra:{cycles:[],opportunities:[],opportunityContacts:[],priorities:[],assignments:[],transitions:s.transitions,calendarSources:s.sources},history:null};
  const gam=buildGamification(input,Date.parse(s.as_of),s.cycle?.timezone_name??"America/Santiago");
  const track=buildTracking(s);
  return {gam,track,input};
}

test("same population: GAM accumulated counts equal funnel, even without any dates",()=>{
  const s=trackingFixture();s.transitions=[];
  s.contacts[1].networking_status="Agradecimiento enviado";
  s.contacts[2].networking_status="Contactado";
  const {gam,track}=models(s);assert.equal(track.state,"ready");if(track.state!=="ready")throw Error();
  assert.equal(gam.metrics[1].metric.value,track.counts[0]);
  assert.equal(gam.metrics[2].metric.value,track.counts[1]);
  assert.equal(gam.metrics[2].metric.value,2);assert.equal(track.blue.size,0);
  assert.equal(gam.temporal.current.value,null);
  assert.deepEqual([...networkingContactIds([...s.contacts,s.contacts[0]]).coffees],["a","b"]);
});

test("GAM retains Foco but does not inherit cycle/HH/priority presentation restrictions",()=>{
  const s=trackingFixture();s.contacts[1].networking_status="Agradecimiento enviado";s.contacts[1].networking_focus=false;
  s.contacts[2].networking_status="Contactado";s.contacts[2].networking_focus=false;
  const {gam,track}=models(s);if(track.state!=="ready")throw Error();
  assert.deepEqual([track.counts[0],track.counts[1]],[1,1]);
  assert.deepEqual([gam.metrics[1].metric.value,gam.metrics[2].metric.value],[1,1]);
  s.cycle=null;assert.equal(models(s).track.state,"no_cycle");assert.equal(models(s).gam.metrics[2].metric.value,1);
  s.cycle={id:"new",started_at:"2026-10-30T15:00:00Z",timezone_name:"America/Santiago"};
  const filtered=buildTracking(s,{...defaultTrackingFilters,priorityIds:["not-assigned"]});
  if(filtered.state!=="ready")throw Error();assert.equal(filtered.counts[1],0);
  assert.equal(models(s).gam.metrics[2].metric.value,1);
  s.contacts=s.contacts.filter(c=>c.id!=="b");assert.equal(models(s).gam.metrics[2].metric.value,1);
});

test("green scheduling evidence supports Pending/Contacted, excludes already accredited and deduplicates",()=>{
  const s=trackingFixture();s.contacts[1].networking_status="Contactado";
  coffee(s,"b-first","2026-11-03T12:00:00Z","b");
  coffee(s,"b-second","2026-11-04T12:00:00Z","b");
  coffee(s,"c-pending","2026-11-05T12:00:00Z","c");
  coffee(s,"a-already-coffee","2026-11-04T12:00:00Z","a");
  s.participants.push({interaction_id:"b-first",contact_id:"b"});
  const {gam,track}=models(s);if(track.state!=="ready")throw Error();
  const week=shiftWeek(periodKey(Date.parse(s.as_of),track.zone,"weekly"),1);
  assert.equal(trackingPeriods(track,"weekly").periods.find(p=>p?.key===week)?.green,2);
  assert.equal(gam.goals[1].metric.value,2);
  assert.equal(track.green.get("person:b"),Date.parse("2026-11-03T12:00:00Z"));
});

test("next-week window selects nearest within that week, not the chart's nearest from today",()=>{
  const s=trackingFixture();coffee(s,"current","2026-10-31T12:00:00Z","b");coffee(s,"next","2026-11-03T12:00:00Z","b");
  const {gam,track}=models(s);if(track.state!=="ready")throw Error();
  assert.equal(track.green.get("person:b"),Date.parse("2026-10-31T12:00:00Z"));
  assert.equal(gam.goals[1].metric.value,1);
  const next=evidenceInstant("2026-11-02",track.zone),end=evidenceInstant("2026-11-09",track.zone);
  assert.equal(nearestProjectedContacts(track.futureEvents,next,end).size,1);
});

test("cancellation lifecycle is identical including inactive sources; totals remain state-based",()=>{
  const s=trackingFixture();coffee(s,"cancel","2026-11-03T12:00:00Z","b");
  s.sources[0].sync_status="deleted_at_source";s.sources[0].is_active=false;
  const {gam,track}=models(s);if(track.state!=="ready")throw Error();
  assert.equal(track.green.size,0);assert.equal(gam.goals[1].metric.value,0);
  assert.equal(gam.metrics[2].metric.value,1);
  for(const metadata of [{ics_import:{status:"CANCELLED"}},{ics_import:{method:"CANCEL"}},{dismissed:true},{deleted:true}]){
    s.sources=[];s.interactions[0].metadata=metadata;assert.equal(models(s).gam.goals[1].metric.value,0);
  }
  s.interactions[0].metadata={};s.interactions[0].is_deleted=true;assert.equal(models(s).gam.goals[1].metric.value,0);
});

test("missing dates/source coverage do not manufacture projection, and do not erase accumulated cafes",()=>{
  const s=trackingFixture();coffee(s,"missing","2026-11-03T12:00:00Z","b");s.interactions[0].occurred_at=null;
  const {gam,input}=models(s);assert.equal(gam.goals[1].metric.value,null);assert.equal(gam.metrics[2].metric.value,1);
  input.extra.calendarSources=null;
  assert.equal(buildGamification(input,Date.parse(s.as_of),"America/Santiago").goals[1].metric.value,null);
});

test("oldest past meeting / estimated transition are attribution, not exhaustive attendance history",()=>{
  const s=trackingFixture();coffee(s,"old","2026-09-01T12:00:00Z");coffee(s,"new","2026-10-29T12:00:00Z");
  const {gam,track}=models(s);if(track.state!=="ready")throw Error();
  assert.equal(track.blueActual.get("person:a"),Date.parse("2026-09-01T12:00:00Z"));
  assert.equal(track.counts[1],1);assert.equal(gam.temporal.current.value,null);assert.equal(gam.temporal.average,null);
  s.interactions=[];s.participants=[];s.sources=[];
  const fallback=models(s);if(fallback.track.state!=="ready")throw Error();
  assert.equal(fallback.track.blueEstimated.size,1);assert.equal(fallback.gam.temporal.streak.value,null);
});

test("shared projection retains local Monday/DST and exclusive endpoint",()=>{
  const zone="America/Santiago",now=Date.parse("2026-09-02T16:00:00Z");
  const from=evidenceInstant("2026-09-07",zone),to=evidenceInstant("2026-09-14",zone);
  const contacts=["a","b","c"].map(id=>({id,networking_status:"Pendiente",networking_focus:true}));
  const events=[from-1,from,to].map((at,i)=>({id:String(i),occurred_at:new Date(at).toISOString(),contactIds:[contacts[i].id],valid:true}));
  assert.equal(projectedCoffees({contacts,events},now,zone).value,1);
  events[1].occurred_at="2026-09-07";assert.equal(projectedCoffees({contacts,events},now,zone).value,1);
  const s=trackingFixture();s.as_of="2026-10-30T16:00:00.000001Z";
  coffee(s,"micro","2026-10-30T16:00:00.000000Z","b");
  const selected=selectTrackingCalendar(s,new Set(s.contacts.map(c=>c.id)),networkingContactIds(s.contacts).coffees,s.as_of,s.cycle!.started_at!);
  assert.equal(selected.futureCalendar.length,0);
});
