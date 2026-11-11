import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { GOOGLE_GMAIL_ENABLED, GOOGLE_CALENDAR_OWNED_SCOPE, calendarScopeGranted, googleProductOperationEnabled } from "../lib/googleProductPolicy.ts";
import { verifyGoogleAuthorizationEvidence } from "../lib/googleConnectedAccountVerification.ts";
import { resolveCalendarPeriodicStartIso, calendarRollingWindowIso, latestIsoInstant } from "../lib/syncDate.ts";
import { mapCalendarEventToExternalInteraction } from "../lib/googleInteractionAdapter.ts";
import { bindGlobalActivitySyncScope, getGlobalActivitySyncSnapshot, resetGlobalActivitySyncCoordinatorForTests, startGlobalActivitySync, withActivitySyncLock } from "../lib/activitySyncExecution.ts";
import { readGoogleCalendarEvents } from "../lib/googleInteractionClient.ts";

test("Calendar owned scope alone passes server evidence; wrong identity/audience/expiry fail closed", () => {
  const evidence = { expectedClientId: "synthetic-client", sessionEmail: "tester@example.invalid",
    tokenInfo: { aud: "synthetic-client", expires_in: 3600, scope: GOOGLE_CALENDAR_OWNED_SCOPE },
    userInfo: { email: "tester@example.invalid", email_verified: true, sub: "synthetic" } };
  const result = verifyGoogleAuthorizationEvidence(evidence);
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.deepEqual(result.capabilities,{calendar_read:true,contacts_read:false,gmail_read:false});
  for(const input of [
    {...evidence,sessionEmail:"other@example.invalid"},
    {...evidence,tokenInfo:{...evidence.tokenInfo,aud:"other"}},
    {...evidence,tokenInfo:{...evidence.tokenInfo,expires_in:0}}
  ]) assert.equal(verifyGoogleAuthorizationEvidence(input).status,"error");
  assert.equal(calendarScopeGranted(["https://www.googleapis.com/auth/calendar.readonly"]),true);
  assert.equal(GOOGLE_GMAIL_ENABLED,false);
  assert.equal(googleProductOperationEnabled("email"),false);
});

test("new account without legacy date uses rolling window; valid legacy can narrow it, invalid configured values fail", () => {
  const now=new Date("2026-11-06T12:00:00Z"), window=calendarRollingWindowIso(now);
  assert.equal(resolveCalendarPeriodicStartIso(null,now),null);
  assert.equal(window.since,"2026-10-30T12:00:00.000Z");
  assert.equal(window.until,"2026-12-06T12:00:00.000Z");
  assert.equal(latestIsoInstant(window.since,resolveCalendarPeriodicStartIso("2026-11-01",now)),"2026-11-01T00:00:00.000Z");
  assert.equal(latestIsoInstant(window.since,resolveCalendarPeriodicStartIso("2020-01-01",now)),window.since);
  for(const value of ["invalid","2027-01-01"]) assert.throws(()=>resolveCalendarPeriodicStartIso(value,now));
});

test("two focused attendees map to one event with two participants; reschedule preserves external identity", () => {
  const event={id:"event",start:{dateTime:"2026-11-06T12:00:00Z"},attendees:[{email:"a@example.invalid"},{email:"b@example.invalid"}]};
  const input={event,userEmail:"owner@example.invalid",contactsByEmail:{"a@example.invalid":{contactId:"a"},"b@example.invalid":{contactId:"b"}}};
  const original=mapCalendarEventToExternalInteraction(input)!;
  assert.equal(original.participants?.length,2);
  const moved=mapCalendarEventToExternalInteraction({...input,event:{...event,start:{dateTime:"2027-01-01T12:00:00Z"}}})!;
  assert.equal(moved.externalId,original.externalId);
  assert.notEqual(moved.occurredAt,original.occurredAt);
  assert.equal(mapCalendarEventToExternalInteraction({...input,contactsByEmail:{}}),null);
});

test("Calendar follows nextPageToken even on an empty page; a failed page is not a success", async () => {
  const urls:string[]=[];
  const input={accessToken:"synthetic",timeMin:"2026-10-30T12:00:00Z",timeMax:"2026-12-06T12:00:00Z",maxPages:3};
  const result=await readGoogleCalendarEvents({...input,fetchImpl:async(url)=>{
    urls.push(String(url));return new Response(JSON.stringify(urls.length===1?{items:[],nextPageToken:"p2"}:{items:[{id:"event"}]}));
  }});
  assert.equal(result.complete,true);assert.equal(result.events.length,1);assert.equal(urls.length,2);
  assert.ok(urls.every(url=>url.includes("/calendars/primary/events")));
  let calls=0;
  await assert.rejects(()=>readGoogleCalendarEvents({...input,fetchImpl:async()=>{
    calls++;return new Response(JSON.stringify(calls===1?{items:[],nextPageToken:"p2"}:{error:{message:"synthetic"}}),{status:calls===1?200:500});
  }}));
  const limited=await readGoogleCalendarEvents({...input,maxPages:1,fetchImpl:async()=>new Response(JSON.stringify({items:[],nextPageToken:"p2"}))});
  assert.equal(limited.complete,false);
});

test("account changes discard late shared feedback; duplicate click reuses one execution",async()=>{
  resetGlobalActivitySyncCoordinatorForTests();bindGlobalActivitySyncScope("synthetic-A");
  let finish!:(value:[])=>void;
  const pending=new Promise<[]>(resolve=>finish=resolve);
  const first=startGlobalActivitySync(()=>pending);
  assert.equal(startGlobalActivitySync(()=>Promise.resolve([])).started,false);
  await Promise.resolve();
  bindGlobalActivitySyncScope("synthetic-B");finish([]);await first.promise;
  assert.equal(getGlobalActivitySyncSnapshot().completedAt,null);
  assert.equal(getGlobalActivitySyncSnapshot().running,false);
});

test("Calendar list deadline includes the response body, not only headers", async () => {
  await assert.rejects(readGoogleCalendarEvents({ accessToken: "synthetic", requestTimeoutMs: 5,
    fetchImpl: async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
      }
    }))
  }), /no respondio a tiempo/);
});

test("UI entry points do not resume sync after OAuth and no contact profile sync remains",()=>{
  const source=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
  const activity=source("../components/ActivitySyncButton.tsx");
  assert.doesNotMatch(activity.slice(activity.indexOf("useEffect(() =>"),activity.indexOf("async function reviewGlobalSync")),/startGlobalActivitySync/);
  assert.doesNotMatch(source("../components/ContactProfile.tsx"),/ActivitySyncButton|activitySyncNotice/);
  assert.match(source("../components/InteractionSyncPreferencesProvider.tsx"),/GOOGLE_GMAIL_ENABLED && preferences.gmailEnabled/);
  assert.match(source("../components/GoogleInteractionsSyncPanel.tsx"),/!GOOGLE_GMAIL_ENABLED \|\| !accessToken/);
  assert.match(source("../app/api/google/connected-account/finalize/route.ts"),/google_operation_disabled/);
});

test("last successful timestamp survives subsequent incomplete/failed attempts",async()=>{
  resetGlobalActivitySyncCoordinatorForTests();bindGlobalActivitySyncScope("synthetic");
  const timestamp="2026-11-06T12:00:00Z";
  await startGlobalActivitySync(()=>Promise.resolve([{service:"calendar",created:1,error:"",reauthorizationRequired:false,success:true,syncedAt:timestamp}])).promise;
  await startGlobalActivitySync(()=>Promise.resolve([{service:"calendar",created:0,error:"Incomplete",reauthorizationRequired:false,success:false,syncedAt:null}])).promise;
  assert.equal(getGlobalActivitySyncSnapshot().lastSuccess?.calendar,timestamp);
  await startGlobalActivitySync(()=>Promise.reject(new Error("Synthetic transport"))).promise;
  assert.equal(getGlobalActivitySyncSnapshot().lastSuccess?.calendar,timestamp);
});

test("cross-tab Web Lock rejects an overlapping operation and releases after failure",async()=>{
  const navigatorDescriptor=Object.getOwnPropertyDescriptor(globalThis,"navigator");
  let busy=false, calls=0;
  Object.defineProperty(globalThis,"window",{configurable:true,value:{}});
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{locks:{
    request:async(_key:string,_options:unknown,callback:(lock:object|null)=>Promise<unknown>)=>{
      if(busy)return callback(null);
      busy=true;try{return await callback({});}finally{busy=false;}
    }
  }}});
  try {
    let finish!:()=>void;
    const pending=new Promise<void>(resolve=>finish=resolve);
    const first=withActivitySyncLock("synthetic",async()=>{calls++;await pending;throw new Error("Synthetic");});
    await assert.rejects(()=>withActivitySyncLock("synthetic",async()=>{calls++;}),/otra pestaña/);
    finish();await assert.rejects(()=>first,/Synthetic/);
    await withActivitySyncLock("synthetic",async()=>{calls++;});
    assert.equal(calls,2);
  } finally {
    Reflect.deleteProperty(globalThis,"window");
    if(navigatorDescriptor)Object.defineProperty(globalThis,"navigator",navigatorDescriptor);
    else Reflect.deleteProperty(globalThis,"navigator");
  }
});
