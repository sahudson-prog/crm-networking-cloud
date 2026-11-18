import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {coffeeWeeks,rollingCoffeeAverage,weeklyGoals,initialRoute,projectedCoffees,shiftWeek,evidenceInstant,known,unavailable,buildGamification,selectedGoalId,canRotate,type CoffeeHistory,type GamificationInput} from "../lib/gamificationModel.ts";
import {rollingBoundaries,shiftLocalDays} from "../lib/gamificationTime.ts";
import {nextTrackingPeriodBoundary,periodKey} from "../lib/trackingModel.ts";
const now=Date.parse("2026-11-18T16:00:00Z"),zone="America/Santiago";
function history(weeks:number[],since="2026-10-19T03:00:00Z"):CoffeeHistory {
  return {since,through:new Date(now).toISOString(),complete:true,events:weeks.flatMap((count,index)=>Array.from({length:count},(_,i)=>({id:`${index}-${i}`,contactId:`c${i}`,occurredAt:`${shiftWeek("2026-11-16",-index)}T15:00:00Z`,confirmed:true})))};
}
test("streak: open week does not break, no grace after empty complete week",()=>{
 for(const [counts,n] of [[[1,1],2],[[0,1],1],[[1,0,1],1],[[0,0,1],0]] as [number[],number][])
   assert.equal(coffeeWeeks(history(counts),now,zone).streak.value,n);
});
test("average uses all four rolling bins including current activity and zeros, fixed divisor 4",()=>{
 const stats=coffeeWeeks(history([1,2,0,3]),now,zone);
 assert.equal(stats.average,1.5);assert.equal(stats.level,"fire");
});
test("short verified coverage uses available civil days, never the first coffee",()=>{
 assert.equal(coffeeWeeks(history([1,2],"2026-11-09T03:00:00Z"),now,zone).average,21/(9+13/24));
 const partial=coffeeWeeks(history([1],"2026-11-17T03:00:00Z"),now,zone);
 assert.equal(partial.current.value,null); // Event before its claimed evidence boundary.
 const pending=coffeeWeeks(history([1],"2026-11-16T03:00:00Z"),now,zone);
 assert.equal(pending.average,7/(2+13/24));assert.equal(pending.level,"rocket");
});

test("partial average normalizes available days with a one-day floor and preserves DST",()=>{
 const h=history([1],new Date(shiftLocalDays(now,-7,zone)).toISOString());
 assert.equal(rollingCoffeeAverage(h,now,zone).average,1);
 assert.equal(rollingCoffeeAverage(h,now,zone).averageDays,7);
 h.since=new Date(now-3600000).toISOString();h.events[0].occurredAt=new Date(now-1800000).toISOString();
 assert.equal(rollingCoffeeAverage(h,now,zone).average,7);
 assert.equal(rollingCoffeeAverage(h,now,zone).averageDays,1);
 const dst=Date.parse("2026-09-09T16:00:00Z");
 h.since=new Date(shiftLocalDays(dst,-7,zone)).toISOString();h.through=new Date(dst).toISOString();h.events[0].occurredAt="2026-09-08T16:00:00Z";
 assert.equal(rollingCoffeeAverage(h,dst,zone).average,1);
 assert.equal(rollingCoffeeAverage(h,dst,zone).averageDays,7);
 h.complete=false;h.unattributedCount=3;
 assert.equal(rollingCoffeeAverage(h,dst,zone).average,1);
 assert.equal(coffeeWeeks(h,dst,zone).level,"fire");
});
test("same contact once per week, repeat meetings in separate weeks require distinct real dates",()=>{
 const h=history([1,1]);h.events.push({...h.events[0]},{...h.events[0],id:"second-meeting"});
 const result=coffeeWeeks(h,now,zone);assert.equal(result.current.value,1);assert.equal(result.streak.value,2);
 h.events.push({id:"status-only",contactId:"unproven",occurredAt:new Date(now).toISOString(),confirmed:false});
 assert.equal(coffeeWeeks(h,now,zone).current.value,1);
});
test("unknown or stale coverage cannot become an exact streak",()=>{
 for(const h of [null,{...history([1]),through:"2026-11-17T00:00:00Z"}]){
 assert.equal(coffeeWeeks(h,now,zone).streak.value,null);assert.equal(coffeeWeeks(h,now,zone).current.value,null);}
});
test("undated eligible coffees do not block dated streak, weekly goal, average or level",()=>{
 for(const [counts,n] of [[[3,1,1],3],[[2,1,1],3],[[0,1,1],2],[[1,0,1],1],[[0,0,1],0],[[],0]] as [number[],number][]){
  const result=coffeeWeeks({...history(counts),complete:false,unattributedCount:10},now,zone);
  assert.equal(result.streak.value,n);
  assert.equal(result.current.value,counts[0]??0);
  assert.equal(result.average,rollingCoffeeAverage(history(counts),now,zone).average);
  assert.equal(result.level,coffeeWeeks(history(counts),now,zone).level);
  if(!counts.length){assert.equal(result.average,0);assert.equal(result.level,"empty");}
  const goal=weeklyGoals(result.current,known(4),1,1)[0];
  assert.equal(goal.completed,(counts[0]??0)>=2);
  assert.equal(goal.text,`Llevas ${counts[0]??0} de 2`);
 }
});
test("partial evidence respects Monday rollover and cannot bridge a missing week",()=>{
 const h={...history([2]),complete:false};
 const next=evidenceInstant("2026-11-23",zone);h.through=new Date(next).toISOString();
 let t=coffeeWeeks(h,next,zone);assert.equal(t.current.value,0);assert.equal(t.streak.value,1);
 const later=evidenceInstant("2026-11-30",zone);h.through=new Date(later).toISOString();
 t=coffeeWeeks(h,later,zone);assert.equal(t.streak.value,0);
});
test("technical failure overrides even retained valid evidence, not just goal copy",()=>{
 const data=input();data.history=history([2,1]);data.historyReadFailed=true;
 const model=buildGamification(data,now,zone);
 assert.equal(model.temporal.readFailed,true);assert.equal(model.temporal.current.value,null);
 assert.equal(model.temporal.streak.value,null);assert.equal(model.temporal.average,null);
 assert.equal(model.temporal.level,"unknown");assert.equal(model.goals[0].metric.reason,"read_failed");
 assert.equal(model.goals[0].completed,false);
});
test("confirmed empty starts at zero; dates absent or conflicting are unavailable",()=>{
 assert.equal(coffeeWeeks(null,now,zone,true).streak.value,0);
 for(const date of ["","2026-11-18T10:00"]){const h=history([1]);h.events[0].occurredAt=date;assert.equal(coffeeWeeks(h,now,zone).current.value,null);}
 const h=history([1]);h.events.push({...h.events[0],occurredAt:"2026-11-17T15:00:00Z"});assert.equal(coffeeWeeks(h,now,zone).streak.value,null);
});
test("future coffee is excluded and reported without discarding backed metrics; equivalent instants deduplicate",()=>{
 const h=history([1,2]);h.events.push({...h.events[0],occurredAt:"2026-11-16T12:00:00-03:00"});
 h.events.push({id:"future",contactId:"future-contact",occurredAt:"2026-12-01T00:00:00Z",confirmed:true});
 const result=coffeeWeeks(h,now,zone);assert.equal(result.current.value,1);assert.equal(result.streak.value,2);assert.deepEqual(result.issues,["coffee_in_future"]);
});
test("level thresholds use unrounded average",()=>{
 for(const [counts,level] of [[[0,3,2,2],"fire"],[[0,3,3,2],"rocket"],[[0,4,4,3],"rocket"],[[0,4,4,4],"radiation"],[[0,0,0,0],"empty"]] as [number[],string][])
 assert.equal(coffeeWeeks(history(counts),now,zone).level,level);
});

test("rolling boundaries are semi-open, T0 excluded and unique contact in each bin",()=>{
 const bounds=rollingBoundaries(now,zone),h=history([]);
 h.events=bounds.map((at,i)=>({id:String(i),contactId:"same",occurredAt:new Date(at).toISOString(),confirmed:true}));
 h.events.push({...h.events[2],id:"another-real-meeting"});
 assert.equal(rollingCoffeeAverage(h,now,zone).average,1);
 const before=coffeeWeeks(h,now,zone).streak.value;
 assert.equal(coffeeWeeks({...h,since:"2026-11-01T00:00:00Z"},now,zone).average,null);
 assert.equal(before,5); // Four moving bins can intersect five civil weeks.
});

test("DST preserves wall time, earlier fold and forward gap; not 168-hour arithmetic",()=>{
 const dstNow=Date.parse("2026-09-09T16:00:00Z"),bounds=rollingBoundaries(dstNow,zone);
 assert.equal(new Date(bounds[3]).toISOString(),"2026-09-02T17:00:00.000Z");
 assert.equal((bounds[4]-bounds[3])/3600000,167);
 assert.equal(new Date(shiftLocalDays(Date.parse("2026-03-15T06:30:00Z"),-7,"America/New_York")).toISOString(),"2026-03-08T07:30:00.000Z");
 assert.equal(new Date(shiftLocalDays(Date.parse("2026-11-08T06:30:00Z"),-7,"America/New_York")).toISOString(),"2026-11-01T05:30:00.000Z");
 assert.equal(new Date(shiftLocalDays(Date.parse("2024-03-07T12:00:00.123Z"),-7,"UTC")).toISOString(),"2024-02-29T12:00:00.123Z");
});

test("date-only evidence may count only if its entire civil day belongs to one bin",()=>{
 const h=history([]);h.events=[{id:"civil",contactId:"c",confirmed:true,occurredAt:"2026-11-10"}];
 assert.equal(rollingCoffeeAverage(h,now,zone).average,.25);
 h.events[0].occurredAt="2026-11-11";assert.equal(rollingCoffeeAverage(h,now,zone).average,null);
 h.events[0].occurredAt="";assert.equal(rollingCoffeeAverage(h,now,zone).average,null);
});

test("full coverage zero differs from incomplete history; next crossing is scheduled",()=>{
 assert.equal(rollingCoffeeAverage(history([]),now,zone).average,0);
 assert.equal(rollingCoffeeAverage({...history([]),since:new Date(rollingBoundaries(now,zone)[0]+1).toISOString()},now,zone).average,0);
 const h=history([]);h.events=[{id:"boundary",contactId:"c",confirmed:true,occurredAt:new Date(shiftLocalDays(now,-7,zone)+5000).toISOString()}];
 assert.equal(rollingCoffeeAverage(h,now,zone).nextChange,now+5001);
 const next=now+5002;h.through=new Date(next).toISOString();
 assert.equal(rollingCoffeeAverage(h,next,zone).average,.25);
});

test("Inicio carousel and popover presentation stays isolated from the default editorial instance",()=>{
 const panel=readFileSync(new URL("../components/GamificationPanel.tsx",import.meta.url),"utf8");
 assert.doesNotMatch(panel,/ChevronLeft|ChevronRight|Pausar metas|Reanudar metas/);
 assert.match(panel,/Popover\.Content/);assert.match(panel,/últimos 28 días/);
 assert.match(panel,/Concreta tu primer café para empezar tu racha/);
 assert.doesNotMatch(panel,/Información histórica insuficiente|t.streak.reason/);
 assert.match(panel,/t.streak.value\?\?"—"/);assert.match(panel,/const level=t.initial\?"empty":t.level/);
 assert.doesNotMatch(panel,/Por determinar|Completa las fechas de tus cafés|t.streak.lowerBound/);
 assert.match(panel,/goalDisplayText\(goal\)/);assert.match(panel,/goal.metric.reason/);
 const editorial=readFileSync(new URL("../components/EditorialFeed.tsx",import.meta.url),"utf8");
 assert.doesNotMatch(editorial,/useHomeCarousel|editorial-dots|home=false/);
 assert.match(editorial,/delay:7000,disableOnInteraction:false,pauseOnMouseEnter:true/);
 assert.match(editorial,/Novedad anterior/);assert.match(editorial,/Novedad siguiente/);
 const policy=readFileSync(new URL("../components/useHomeCarousel.ts",import.meta.url),"utf8");
 assert.match(policy,/manual = true/);assert.doesNotMatch(policy,/manual = false/);assert.match(policy,/!p\.focus/);assert.match(policy,/visibilitychange/);
});
test("IANA Monday and DST are civil intervals, not fixed 168 UTC hours",()=>{
 const sunday=Date.parse("2026-09-07T02:59:59Z");assert.equal(periodKey(sunday,zone,"weekly"),"2026-08-31");
 const monday=nextTrackingPeriodBoundary(sunday,zone,"weekly");assert.equal(new Date(monday).toISOString(),"2026-09-07T03:00:00.000Z");
 const previous=evidenceInstant("2026-08-31",zone);assert.equal((monday-previous)/3600000,167);
 assert.equal(periodKey(monday,zone,"weekly"),"2026-09-07");
 assert.equal(evidenceInstant("2026-02-30",zone),NaN);
 assert.equal(evidenceInstant("2026-02-30T12:00:00Z",zone),NaN);
 assert.equal(evidenceInstant("2026-11-18T25:00:00Z",zone),NaN);
 assert.equal(evidenceInstant("2024-02-29T12:00:00-03:00",zone),Date.parse("2024-02-29T15:00:00Z"));
 assert.equal(shiftWeek("2027-01-04",-1),"2026-12-28");
});
test("projected calendar dates next week only, unique scheduled contacts and valid events",()=>{
 const input={contacts:[{id:"a",networking_status:"Agendado",networking_focus:true},{id:"b",networking_status:"Cita concretada",networking_focus:true}],events:[{id:"e",occurred_at:"2026-11-23",contactIds:["a","b"],valid:true},{id:"e2",occurred_at:"2026-11-25T12:00:00Z",contactIds:["a"],valid:true},{id:"gone",occurred_at:null,contactIds:["a"],valid:false}]};
 assert.equal(projectedCoffees(input,now,zone).value,1);
 input.events[0].occurred_at=null;assert.equal(projectedCoffees(input,now,zone).value,null);
});
test("third goal conditional; real values above target and no false 100%",()=>{
 const presented=weeklyGoals(known(2),known(4),4,12)[2];assert.equal(presented.title,"Prioridad cargada");assert.equal(presented.text,"4 de 12 (33%)");
 assert.equal(weeklyGoals(known(2),known(4),null,null)[2].text,"Prioridades no disponibles");
 let g=weeklyGoals(known(3),known(5),999,1000);assert.equal(g.length,3);assert.equal(g[0].progress,100);assert.equal(g[0].metric.value,3);assert.equal(g[2].metric.value,99);
 assert.equal(weeklyGoals(known(2),known(4),0,0)[2].completed,false);
 assert.equal(weeklyGoals(known(2),known(4),2,2)[2].completed,true);
 assert.equal(weeklyGoals(known(1),known(4),2,2).length,2);
 assert.equal(weeklyGoals(unavailable("unknown"),known(4),2,2).length,2);
});

test("final presentation preserves uniform ordered milestones, honest figures and local artwork",()=>{
 const panel=readFileSync(new URL("../components/GamificationPanel.tsx",import.meta.url),"utf8");
 assert.match(panel,/<ol className="gam-tiles"/);assert.match(panel,/model.route.map\(\(m,i\)/);
 assert.doesNotMatch(panel,/gam-route-compact|gam-completed-list|compact&&m.done/);
 assert.match(panel,/m.done\?<div className="gam-tile is-done"/);
 const css=readFileSync(new URL("../styles/gamification.css",import.meta.url),"utf8");
 assert.match(css,/grid-auto-rows: 1fr/);assert.match(css,/li:not\(:first-child\)::before/);
 assert.match(css,/\.gam-stat-icon svg \{ width: 26px; height: 26px/);
 assert.doesNotMatch(panel,/esta semana|semana anterior|gam-stat-delta/);
 assert.match(panel,/filter\(stat=>stat.id!=="interviews"\)/);
 assert.match(panel,/de tus contactos ya contactados/);assert.match(panel,/side="top".*avoidCollisions/);
 for(const text of ["Nivel 1","Nivel 2","Nivel nuclear!","Sin cafés"])assert.ok(panel.includes(text));
 for(const name of ["empty","fire","rocket","radiation"]){const svg=readFileSync(new URL(`../public/gamification/${name}.svg`,import.meta.url),"utf8");assert.match(svg,/viewBox="0 0 96 96"/);assert.match(svg,/linearGradient/);assert.doesNotMatch(svg,/<script|<image|<foreignObject|<animate|href=|https?:\/\/(?!www.w3.org\/2000\/svg)/);}
 assert.equal(buildGamification(input(),now,zone).metrics[1].title,"Ya contactados");
});
test("milestones 0/9/10, arbitrary order, removal and actual CTA routes",()=>{
 for(const n of [0,9,10]){const r=initialRoute({objective:true,moved:true,contacts:n,interactions:n,processes:1});assert.equal(r.every(m=>m.done),n===10);assert.equal(r[2].done,n>=10);assert.equal(r[3].done,n>=10);assert.equal(r[0].href,"/objetivos");}
 assert.equal(initialRoute({objective:false,moved:true,contacts:10,interactions:10,processes:0}).filter(m=>m.done).length,3);
});
test("carousel identity survives metric changes and removal, policy cannot resume manual pause",()=>{
 const two=weeklyGoals(known(0),known(0),0,0);assert.equal(selectedGoalId("projected",two),"projected");assert.equal(selectedGoalId("prioritized",two),"realized");
 for(const key of ["reduced","hidden","hover","paused"] as const)assert.equal(canRotate({reduced:false,hidden:false,hover:false,paused:false,[key]:true}),false);
 assert.equal(canRotate({reduced:false,hidden:false,hover:false,paused:false}),true);
});
function input():GamificationInput{return {contacts:[{id:"a",networking_status:"Agradecimiento enviado",networking_focus:true}],interactions:[],participants:[],sources:[],extra:{cycles:[{id:"cy",objective_type:"JOB_SEARCH",status:"active",timezone_name:zone}],opportunities:[],opportunityContacts:[],priorities:[{id:"p"}],assignments:[{id:"a1",contact_id:"a",objective_id:"p"}],transitions:[]},history:null};}
test("current states can infer moved but cannot manufacture dated coffee or interviews",()=>{
 const m=buildGamification(input(),now,zone);assert.equal(m.route?.[1].done,true);assert.equal(m.temporal.current.value,null);assert.equal(m.metrics[2].metric.value,1);assert.equal(m.metrics[4].metric.value,null);
});
test("cancellations/dismissals excluded, missing dependencies do not masquerade as route",()=>{
 const i=input();i.interactions=[{id:"e",interaction_type:"calendar",occurred_at:"2026-11-23T12:00:00Z",metadata:{}}];i.contacts![0].networking_status="Agendado";i.participants=[{interaction_id:"e",contact_id:"a"}];
 i.sources=[{interaction_id:"e",provider:"google",source_service:"calendar",sync_status:"deleted_at_source",is_active:true}];assert.equal(buildGamification(i,now,zone).goals[1].metric.value,0);
 i.extra.cycles=null;assert.equal(buildGamification(i,now,zone).route,null);
 i.extra.priorities=null;assert.equal(buildGamification(i,now,zone).metrics[0].metric.value,null);
});
test("production adapter uses shared first-coffee attribution, never chart buckets or updated_at",()=>{
 const source=readFileSync(new URL("../components/HomeGamification.tsx",import.meta.url),"utf8");assert.match(source,/attributedCoffeeHistory\(snapshot.contacts,evidence,snapshot.as_of\)/);assert.doesNotMatch(source,/blueEstimated|updated_at|tracked\.counts/);
 const reader=readFileSync(new URL("../lib/gamificationRead.ts",import.meta.url),"utf8");assert.match(reader,/readCompletePages/);assert.match(reader,/\.eq\("user_id",owner\)/);assert.doesNotMatch(reader,/\.insert\(|\.update\(|\.rpc\(/);
});

test("initial loading preserves goals and streak layout; refresh retains the last model",()=>{
 const panel=readFileSync(new URL("../components/GamificationPanel.tsx",import.meta.url),"utf8");
 const pending=panel.slice(panel.indexOf("if(!model&&loading)"),panel.indexOf("if(!model)return"));
 assert.match(pending,/className="panel gam-goals"/);
 assert.match(pending,/className="gam-streak"/);
 assert.match(pending,/Metas de la semana/);assert.match(pending,/Racha de networking/);
 assert.match(pending,/role="status">Cargando Inicio/);
 assert.doesNotMatch(pending,/Leyendo tus avances|title="Tu networking"|gam-streak-value|progressbar|gam-level-trigger/);
 assert.doesNotMatch(panel,/if\(!model\|\|loading\)/);
 assert.match(panel,/aria-label="Networking personal" aria-busy=\{loading\}/);
});
