import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('lib/googleSyncAuthorization.ts', root), 'utf8');
function gate(rpc) {
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,require:key=>key==='./supabaseClient.ts'?{supabase:{rpc}}
      :key==='./googleProductPolicy.ts'?{GOOGLE_CALENDAR_OWNED_SCOPE:'calendar-owned',calendarScopeGranted:()=>true,googleProductOperationEnabled:()=>true}
      :(()=>{throw Error('Unexpected dependency')})()});
  return module.exports;
}

test('Calendar admin required for OAuth and sync even with Calendar capability',async()=>{
  const calls=[];
  const client=gate(async(name,args)=>{calls.push([name,args]);return {data:name==='current_user_can_use_calendar_admin_v1'?false:true,error:null};});
  assert.equal(await client.readGoogleOAuthOperationEligibility('calendar'),false);
  await assert.rejects(client.requireGoogleConnectedSyncAuthorization('synthetic-account','calendar'),/administradores/);
  assert.equal(calls.some(([name])=>name==='current_user_can_sync_connected_account_v1'),false);
});

test('Admin Calendar allowed, Google login and other sources unaffected by admin gate',async()=>{
  const calls=[];
  const client=gate(async(name,args)=>{calls.push([name,args]);return {data:true,error:null};});
  assert.equal(await client.readGoogleOAuthOperationEligibility('calendar'),true);
  await client.requireGoogleConnectedSyncAuthorization('synthetic-account','calendar');
  calls.length=0;
  assert.equal(await client.readGoogleOAuthOperationEligibility('contacts'),true);
  await client.requireGoogleConnectedSyncAuthorization('synthetic-account','contacts');
  assert.equal(calls.some(([name])=>name==='current_user_can_use_calendar_admin_v1'),false);
  const route=readFileSync(new URL('app/api/google/connected-account/finalize/route.ts',root),'utf8');
  assert.match(route,/requestedOperations\.includes\("calendar"\)/);
  assert.match(route,/current_user_can_use_calendar_admin_v1/);
  assert.match(route,/calendar_admin_required/);
  assert.match(route,/calendarScopeGranted\(effectiveScopes\) && !requestedOperations\.includes\("calendar"\)/);
  assert.match(route,/effectiveScopes = effectiveScopes\.filter/);
});
