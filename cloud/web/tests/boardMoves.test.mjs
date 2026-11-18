import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function load(file,deps){
  const module={exports:{}};
  const code=ts.transpileModule(readFileSync(new URL('../lib/'+file,import.meta.url),'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require(name){if(!(name in deps))throw Error('Unexpected import: '+name);return deps[name];}});
  return module.exports;
}
function fixture(){
  let owner='synthetic-owner',token='cycle-token',peek=true,fail=false,lose=false,readFailure=false,authChanged;
  const contacts=new Map([['c1','Pendiente'],['c2','Pendiente']]);
  const row={id:'o1',cycle_id:'cycle',stage:'identified',situation:'active',updated_at:'0',title:'Synthetic',
    company:'Example',contact_ids:['c1'],objective_ids:['p1'],interaction_ids:['i1']};
  const writes=[],reads=[],filters=[],invalidations=[],coach=[];let release,hold=false,coachRelease,holdCoach=false;
  const deps={
    './coachRuleTriggers':{triggerCoachRuleReviewForContacts:async(ids)=>{coach.push(ids);if(holdCoach)await new Promise(resolve=>{coachRelease=resolve;});return null;}},
    './operationDiagnostics':{measureOperation:(_stage,work)=>work()},
    './boardMoveQueue':load('boardMoveQueue.ts',{}),
    './indicatorReads':{getSharedReadOwner:()=>owner},
    './networkingCycles':{peekNetworkingContext:()=>peek?{token,cycleId:'cycle'}:null,expectedNetworkingContext:async()=>({token,cycleId:'cycle'})},
    './networkingDataRevision':{notifyNetworkingDataChanged:()=>invalidations.push(true)},
    './contactActions':{async updateContactNetworkingStatus(id,target,source,options){
      writes.push({id,target,source,options});if(hold)await new Promise(resolve=>{release=resolve;});
      if(fail)throw Error('rejected');const previousStatus=contacts.get(id);contacts.set(id,target);
      if(lose)throw Error('response lost');return {previousStatus,status:target};
    }},
    './opportunityActions':{
      async readOpportunities(id){reads.push(id);if(readFailure)throw Error('read failed');return [structuredClone(row)];},
      async saveOpportunity(input,expected){
        writes.push({input,expected});if(hold)await new Promise(resolve=>{release=resolve;});
        if(fail)throw Error('rejected');assert.equal(input.expectedUpdatedAt,row.updated_at);
        Object.assign(row,{stage:input.stage,updated_at:String(Number(row.updated_at)+1)});
        if(lose)throw Error('response lost');
      }
    },
    './supabaseClient':{supabase:{auth:{onAuthStateChange(fn){authChanged=fn;}},from(table){
      assert.equal(table,'contacts');const q={select(fields){assert.equal(fields,'networking_status');return q;},
        eq(field,value){filters.push([field,value]);return q;},async maybeSingle(){
          if(readFailure)return {error:Error('read failed')};
          const id=filters.filter(([name])=>name==='id').at(-1)[1];
          return {data:{networking_status:contacts.get(id)}};
        }};return q;
    }}}
  };
  const actions=load('boardMoves.ts',deps);
  const hook=load('useBoardMoves.ts',{'./boardMoves':actions,react:{useSyncExternalStore:(_subscribe,snapshot)=>snapshot()}});
  return {actions,hook,contacts,row,writes,reads,filters,invalidations,coach,
    holdCoach(){holdCoach=true;},releaseCoach(){coachRelease();},
    hold(){hold=true;},release(){hold=false;release();},fail(){fail=true;},lose(){lose=true;},failRead(){readFailure=true;},recover(){readFailure=false;},
    cold(){peek=false;},cycle(){token='another-cycle';},logout(){owner=null;authChanged('SIGNED_OUT',null);}};
}

test('real card adapter starts and reconciles a contact with fixed owner and context, including cold context',async()=>{
  const f=fixture();f.cold();const done=f.actions.moveContactCard('c1','Contactado',true);
  assert.equal(f.hook.useBoardMoves('contact:').pending.has('c1'),true);
  await done;assert.equal(f.writes.length,1);
  assert.equal(f.writes[0].options.expectedOwner,'synthetic-owner');
  assert.equal(f.writes[0].options.expectedContext,'cycle-token');
  assert.equal(f.filters.length,0); // Persisted receipt avoids a redundant read.
  assert.equal(f.actions.boardMoves.getSnapshot()[0].confirmation.previous,'Pendiente');
});

test('confirmed card is not blocked by slow Coach; one invalidation and no redundant read',async()=>{
  const f=fixture();f.holdCoach();await f.actions.moveContactCard('c1','Contactado',true);
  assert.equal(f.hook.useBoardMoves('contact:').pending.size,0);
  assert.equal(f.coach.length,1);assert.equal(f.invalidations.length,1);
  assert.equal(f.filters.length,0);assert.equal(f.writes[0].options.reviewCoach,false);
  assert.equal(f.writes[0].options.invalidate,false);
  assert.equal(f.actions.boardMoves.getSnapshot()[0].confirmation.actual,'Contactado');
  f.releaseCoach();
});

test('explicit reconciliation clears the failure only after a real read, never another write',async()=>{
  const f=fixture();f.lose();await f.actions.moveContactCard('c1','Contactado',true);
  assert.equal(f.hook.useBoardMoves('contact:').failed,true);
  await f.actions.boardMoves.reconcile('contact:c1');
  assert.equal(f.hook.useBoardMoves('contact:').failed,false);
  assert.equal(f.writes.length,1);
  assert.equal(f.actions.boardMoves.getSnapshot()[0].confirmation,undefined);
});

test('opportunity moves reread current versions and preserve the latest relations for each serialized intent',async()=>{
  const f=fixture();f.hold();const one=f.actions.moveOpportunityCard('o1','applied');await tick();
  const two=f.actions.moveOpportunityCard('o1','in_process');assert.equal(f.writes.length,1);
  f.row.contact_ids=['c2'];f.release();await Promise.all([one,two]);
  assert.equal(f.writes.length,2);assert.equal(f.writes[0].input.expectedUpdatedAt,'0');
  assert.equal(f.writes[1].input.expectedUpdatedAt,'1');assert.equal(f.writes[1].input.contactIds[0],'c2');
  assert.ok(f.reads.every(id=>id==='o1'));assert.equal(f.row.stage,'in_process');
  assert.equal(f.hook.useBoardMoves('opportunity:').pending.size,0);
});

test('lost opportunity response triggers a fresh read, not a second save',async()=>{
  const f=fixture();f.lose();await f.actions.moveOpportunityCard('o1','applied');
  assert.equal(f.writes.length,1);assert.equal(f.row.stage,'applied');
  assert.equal(f.hook.useBoardMoves('opportunity:').failed,true);
  await f.actions.boardMoves.reconcile('opportunity:o1');assert.equal(f.writes.length,1);
});

test('read failure retains an error and reconciliation does not optimistically reapply the failed target',async()=>{
  const f=fixture();f.fail();await f.actions.moveContactCard('c1','Contactado');
  assert.equal(f.hook.useBoardMoves('contact:').optimistic.c1,'Pendiente');
  const retry=f.actions.boardMoves.reconcile('contact:c1');
  assert.equal(f.hook.useBoardMoves('contact:').optimistic.c1,'Pendiente');await retry;
  f.failRead();await f.actions.boardMoves.reconcile('contact:c1');
  await assert.rejects(f.actions.moveContactCard('c1','Agendado'),/reconciliation_required/);
  assert.equal(f.writes.length,1);assert.equal(f.hook.useBoardMoves('contact:').failed,true);
});

test('logout discards queued private state but does not cancel or reuse the active transport',async()=>{
  const f=fixture();f.hold();const one=f.actions.moveContactCard('c1','Contactado');await tick();
  const two=f.actions.moveContactCard('c1','Agendado');f.logout();f.release();await Promise.all([one,two]);
  assert.equal(f.writes.length,1);assert.equal(f.actions.boardMoves.getSnapshot().length,0);
  assert.equal(f.invalidations.length,0);assert.throws(()=>f.actions.moveContactCard('c1','Contactado'),/context_unavailable/);
});

test('cycle change stops queued intents and never calls a writer with the old context',async()=>{
  const f=fixture();f.hold();const one=f.actions.moveContactCard('c1','Contactado');await tick();
  const two=f.actions.moveContactCard('c1','Agendado');f.cycle();f.release();await Promise.all([one,two]);
  assert.equal(f.writes.length,1);assert.equal(f.actions.boardMoves.getSnapshot()[0].unresolved,true);
  assert.equal(f.hook.useBoardMoves('contact:').failed,true);
});
