import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFirstCoffeeHistory } from "../lib/firstCoffeeRead.ts";
import { readTrackingSnapshot } from "../lib/trackingRead.ts";
import { readDiagnostic } from "../lib/readDiagnostics.ts";
import { readCompletePages } from "../lib/completeRead.ts";
import { buildTracking, selectFirstCoffee } from "../lib/trackingModel.ts";
import { attributedCoffeeHistory, buildGamification, coffeeWeeks, rollingCoffeeAverage } from "../lib/gamificationModel.ts";
import { shiftLocalDays } from "../lib/gamificationTime.ts";
import { trackingFixture, coffee } from "./trackingFixtures.ts";

function clientFixture(error: {code:string;message:string}|null=null) {
  const snapshot=trackingFixture();
  coffee(snapshot,"appointment","2026-10-28T12:00:00Z");
  const calls:Array<{table:string;columns:string;filters:Array<[string,unknown]>;from?:number}>=[];
  const rows:Record<string,any[]>={interactions:snapshot.interactions,interaction_participants:snapshot.participants.map((p,i)=>({...p,id:`p${i}`})),
    external_interaction_sources:snapshot.sources.map((s,i)=>({...s,id:`s${i}`})),contact_networking_transitions:snapshot.transitions};
  const client={auth:{getUser:async()=>({data:{user:{id:"test-owner"}},error:null})},rpc:async()=>({data:structuredClone(snapshot),error:null}),from(table:string){
    const call={table,columns:"",filters:[] as Array<[string,unknown]>,from:0};calls.push(call);
    const q={select(columns:string){call.columns=columns;return q;},eq(key:string,value:unknown){call.filters.push([key,value]);return q;},order(){return q;},
      range(from:number,to:number){call.from=from;return {returns:async()=>{
        if(table==="interactions"&&error&&call.columns.includes("is_deleted"))return {data:null,count:null,error,status:400};
        return {data:rows[table].slice(from,to+1),count:rows[table].length,error:null,status:200};
      }};},single:async()=>({data:{created_at:"2026-01-01T00:00:00Z"},error:null,status:200})};return q;
  }};
  return {client:client as any,snapshot,calls,rows};
}

test("legacy lifecycle fallback preserves complete paging, owner scope and original evidence",async()=>{
  const f=clientFixture({code:"42703",message:"column interactions.is_deleted does not exist"});
  f.rows.interactions=Array.from({length:205},(_,i)=>({...f.rows.interactions[0],id:`i${i}`}));
  const h=await readFirstCoffeeHistory(f.client);
  assert.equal(h.interactions.length,205);
  const calls=f.calls.filter(c=>c.table==="interactions");
  assert.equal(calls.length,3);assert.equal(calls[0].columns.includes("is_deleted"),true);
  assert.equal(calls[1].columns,"id,interaction_type,occurred_at,metadata");assert.equal(calls[2].from,200);
  for(const c of calls){assert.ok(c.filters.some(([k,v])=>k==="user_id"&&v==="test-owner"));assert.ok(c.filters.some(([k,v])=>k==="interaction_type"&&v==="calendar"));}
});

test("modern lifecycle deletion and cancellation remain excluded; no permissive fallback",async()=>{
  const f=clientFixture();f.rows.interactions[0].is_deleted=true;
  const h=await readFirstCoffeeHistory(f.client);
  assert.equal(h.interactions[0].is_deleted,true);
  assert.equal(selectFirstCoffee(f.snapshot.contacts,{...h,transitions:[]},f.snapshot.as_of).dates.size,0);
  assert.equal(f.calls.filter(c=>c.table==="interactions").length,1);
  for(const error of [{code:"42501",message:"permission denied"},{code:"42703",message:"column occurred_at does not exist"}]){
    const broken=clientFixture(error);
    await assert.rejects(readFirstCoffeeHistory(broken.client),/complete_read_failed/);
    assert.equal(broken.calls.filter(c=>c.table==="interactions").length,1);
  }
});

test("real snapshot assembly recovers legacy; history failure preserves accumulated data without cycle-date fallback",async()=>{
  const legacy=clientFixture({code:"42703",message:"column interactions.is_deleted does not exist"});
  const snapshot=await readTrackingSnapshot(legacy.client);
  assert.ok(snapshot.coffeeHistory);assert.equal(snapshot.coffeeHistoryError,undefined);
  const failed=clientFixture({code:"42501",message:"permission denied"});
  const partial=await readTrackingSnapshot(failed.client);
  assert.equal(partial.coffeeHistoryError,true);assert.deepEqual(partial.contacts,failed.snapshot.contacts);
  const model=buildTracking(partial);assert.equal(model.state,"ready");
  if(model.state!=="ready")throw Error();
  assert.equal(model.counts[1],1);assert.equal(model.blue.size,0);
  await assert.rejects(readTrackingSnapshot({...failed.client,rpc:async()=>({data:null,error:{code:"42501"}})}),/tracking_read_failed/);
});

test("diagnostics preserve technical phase/code, never response content or identity",async()=>{
  const error={code:"42501",message:"private@example.com",details:"private notes",hint:"secret"};
  assert.deepEqual(readDiagnostic(error,403),{code:"42501",status:403});
  assert.deepEqual(readDiagnostic({code:"SECRET_TOKEN_VALUE",status:700}),{code:"READ_FAILED",status:null});
  await assert.rejects(readCompletePages(async()=>({data:null,count:null,error,status:403})),e=>{
    assert.equal((e as any).code,"42501");assert.equal((e as any).status,403);
    assert.doesNotMatch(JSON.stringify(e),/private|secret/);return true;
  });
});

test("short complete history averages 1/7/14/28 civil days, including DST and local Monday",()=>{
  const zone="America/Santiago",now=Date.parse("2026-09-07T16:00:00Z");
  for(const days of [1,7,14,28]){
    const h={since:new Date(shiftLocalDays(now,-days,zone)).toISOString(),through:new Date(now).toISOString(),complete:true,
      events:[{id:"first",contactId:"c",confirmed:true,occurredAt:"2026-09-07T03:00:00Z"}]};
    const average=rollingCoffeeAverage(h,now,zone),weeks=coffeeWeeks(h,now,zone);
    assert.equal(average.averageDays,days);assert.equal(average.average,7/days);
    assert.equal(weeks.current.value,1);assert.equal(weeks.streak.value,1);
    h.events[0].occurredAt="2026-09-07T02:59:59Z";
    assert.equal(coffeeWeeks(h,now,zone).current.value,0);
  }
});

test("zero, partial dates and failed read stay distinct without discarding attributed evidence",()=>{
  const f=clientFixture();const s=f.snapshot;
  s.contacts[1].networking_status="Agradecimiento enviado";
  const history=attributedCoffeeHistory(s.contacts,{...s,coverageSince:"2026-01-01T00:00:00Z"},s.as_of)!;
  assert.equal(history.complete,false);assert.equal(history.unattributedCount,1);assert.equal(history.events.length,1);
  const extra={cycles:[],opportunities:[],opportunityContacts:[],priorities:[],assignments:[],transitions:[],calendarSources:[]};
  const input={contacts:[],interactions:[],participants:[],sources:[],extra,history:null};
  const empty=buildGamification(input,Date.parse(s.as_of),"UTC");
  assert.equal(empty.temporal.streak.value,0);assert.equal(empty.goals[0].metric.value,0);assert.equal(empty.temporal.level,"empty");
  const failed=buildGamification({...input,historyReadFailed:true},Date.parse(s.as_of),"UTC");
  assert.equal(failed.temporal.streak.value,null);assert.equal(failed.goals[0].metric.value,null);assert.equal(failed.temporal.readFailed,true);
  const partial=buildGamification({...input,contacts:s.contacts,history},Date.parse(s.as_of),"UTC");
  assert.equal(partial.metrics[2].metric.value,2);assert.equal(partial.temporal.average,.25);assert.equal(partial.temporal.readFailed,false);
});

test("product states avoid internal coverage language and accessible false zeros",()=>{
  const panel=readFileSync(new URL("../components/GamificationPanel.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(panel,/Información histórica insuficiente|t.streak.reason/);
  assert.match(panel,/Concreta tu primer café para empezar tu racha/);
  assert.match(panel,/goal.metric.value===null\?undefined:Math.min/);
  const home=readFileSync(new URL("../components/HomeGamification.tsx",import.meta.url),"utf8");
  assert.match(home,/error=\{!error&&!snapshot\?\.coffeeHistoryError/);
  assert.match(home,/historyReadFailed:!snapshot\|\|Boolean\(snapshot.coffeeHistoryError\)/);
});
