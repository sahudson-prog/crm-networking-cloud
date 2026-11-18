import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root=fileURLToPath(new URL('../',import.meta.url));
const id='10000000-0000-4000-8000-000000000001';
function fixture(){
  let version=0,failTable='',rpcLost=false;
  const modules=new Map(),writes=[];
  const client={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},
    rpc:async(name)=>{writes.push(name);version++;if(rpcLost)throw Error('response lost');return {data:id,error:null};},
    from(table){let operation='select',single=false,payload;
      const query={select(){return query;},eq(){return query;},in(){return query;},is(){return query;},order(){return query;},
        insert(value){operation='insert';payload=value;return query;},update(value){operation='update';payload=value;return query;},
        delete(){operation='delete';return query;},upsert(value){operation='upsert';payload=value;return query;},
        single(){single=true;return query;},maybeSingle(){single=true;return query;},
        then(ok,no){
          if(operation!=='select'){
            writes.push(table+':'+operation);
            if(['contacts','referrals','interactions'].includes(table))version++;
          }
          const row={id,status:'active',is_active:true,networking_status:'Pendiente',metadata:{},...payload};
          return Promise.resolve({data:single?row:[row],error:table===failTable?Error('synthetic failure'):null}).then(ok,no);
        }};return query;}
  };
  function load(file){
    file=resolve(root,file);if(modules.has(file))return modules.get(file).exports;
    const module={exports:{}};modules.set(file,module);
    const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,console,performance,Date,Intl,Promise,process:{env:{NODE_ENV:'production'}},require(name){
      if(/supabaseClient/.test(name))return {supabase:client};
      if(/coachRuleTriggers/.test(name))return {triggerCoachRuleReviewForContacts:async()=>{}};
      if(/networkingCycles/.test(name))return {networkingWriteContext:async()=>'token',expectedNetworkingContext:async()=>({cycleId:'cycle',token:'token'})};
      if(/indicatorReads/.test(name))return {readSharedView:(_key,fn)=>fn()};
      if(/format$/.test(name))return {cleanContactCompany:s=>s,cleanContactRole:s=>s};
      let next=resolve(dirname(file),name);if(!existsSync(next))next+='.ts';return load(next);
    }});return module.exports;
  }
  const {ScopedReadCache}=load('lib/scopedReadCache.ts');
  const cache=new ScopedReadCache();cache.scope('owner');
  load('lib/networkingDataRevision.ts').subscribeNetworkingDataRevision(()=>cache.invalidate());
  return {load,writes,cache,read:()=>cache.read('view',async()=>version),
    fail(table){failTable=table;},loseRpc(){rpcLost=true;},get version(){return version;}};
}
const contact={displayName:'Synthetic',company:'',role:'',networkingStatus:'Pendiente',networkingFocus:false,isHeadhunter:false,headhunterDomains:[],emails:[],phones:[]};
const referral={referredByContactId:id,referredName:'Synthetic',referredCompany:'',referredRole:'',referredEmail:'',referredPhone:'',notes:''};

for(const [name,write] of [
  ['create without priorities (vCard)',f=>f.load('lib/contactActions.ts').saveContactFromEditor(contact)],
  ['edit without priorities',f=>f.load('lib/contactActions.ts').saveContactFromEditor({...contact,contactId:id})],
  ['deactivate',f=>f.load('lib/contactActions.ts').deactivateContacts([id])],
  ['status',f=>f.load('lib/contactActions.ts').updateContactNetworkingStatus(id,'Contactado')],
  ['Foco',f=>f.load('lib/contactActions.ts').updateContactFlags(id,{networkingFocus:true})],
  ['create referral',f=>f.load('lib/referralActions.ts').saveReferralFromEditor(referral)],
  ['edit referral',f=>f.load('lib/referralActions.ts').saveReferralFromEditor({...referral,referralId:id})],
  ['dismiss referral',f=>f.load('lib/referralActions.ts').dismissReferrals([id])]
]) test('confirmed '+name+' invalidates shared reads',async()=>{
  const f=fixture();assert.equal(await f.read(),0);await write(f);
  assert.ok(f.version>0);assert.equal(await f.read(),f.version);
});

test('partial contact write stays an error and invalidates the old list',async()=>{
  const f=fixture();await f.read();f.fail('contact_emails');
  await assert.rejects(f.load('lib/contactActions.ts').saveContactFromEditor(contact));
  assert.equal(f.writes.filter(w=>w==='contacts:insert').length,1);
  assert.equal(await f.read(),1);
});

test('failed mandatory status audit is not a confirmed movement and does not repeat the contact update',async()=>{
  const f=fixture();await f.read();f.fail('audit_log');
  await assert.rejects(f.load('lib/contactActions.ts').updateContactNetworkingStatus(id,'Contactado'));
  assert.equal(f.writes.filter(w=>w==='contacts:update').length,1);
  assert.equal(await f.read(),1);
});

test('partial interaction write invalidates even when participant creation fails',async()=>{
  const f=fixture();await f.read();f.fail('interaction_participants');
  await assert.rejects(f.load('lib/interactionActions.ts').saveInteractionFromEditor({contactId:id,interactionType:'call',direction:'outbound',occurredAt:'2026-11-18T12:00:00Z',subject:'Synthetic',userNotesRaw:''}));
  assert.equal(await f.read(),1);assert.equal(f.writes.filter(w=>w==='interactions:insert').length,1);
});

test('uncertain contact merge invalidates without treating the RPC as confirmed',async()=>{
  const f=fixture();await f.read();f.loseRpc();
  await assert.rejects(f.load('lib/contactMergeActions.ts').mergeContactsDeep({targetContactId:id,sourceContactIds:['source'],result:{name:'Synthetic',company:'',role:'',emails:[],phones:[],focus:false,headhunter:false,networkingStatus:'Pendiente'}}));
  assert.equal(await f.read(),1);assert.equal(f.writes.length,1);
});

const opportunity={title:'Synthetic',company:'',applicationUrl:'',stage:'applied',situation:'active',result:null,resultNote:'',contactIds:[],objectiveIds:[],interactionIds:[]};
test('uncertain opportunity save/void does not reconcile from pre-write cache or retry the writer',async()=>{
  const f=fixture();const actions=f.load('lib/opportunityActions.ts');
  await f.read();f.loseRpc();
  await assert.rejects(actions.saveOpportunity({...opportunity,id}));
  assert.equal(await f.read(),1);
  await assert.rejects(actions.voidOpportunity(id));assert.equal(await f.read(),2);
  assert.equal(f.writes.length,2);
});
test('uncertain priority and assignment RPCs invalidate and remain errors',async()=>{
  const f=fixture(),actions=f.load('lib/cycleObjectiveActions.ts');f.loseRpc();
  const writes=[()=>actions.saveObjective({objectiveName:'Synthetic',objectiveType:'COMPANY',priorityLevel:'MEDIUM',objectiveDescription:'',isActive:true}),
    ()=>actions.deleteObjective(id),()=>actions.setContactObjectiveAssignments({contactId:id,objectiveIds:[id]}),
    ()=>actions.setObjectiveContactAssignments({objectiveId:id,contactIds:[id]}),()=>actions.addObjectiveAssignmentsToContacts({contactIds:[id],objectiveIds:[id]})];
  for(const write of writes){await f.read();await assert.rejects(write());assert.equal(await f.read(),f.version);}
  assert.equal(f.writes.length,5);
});
test('invalidation rejects late reads; user change clears values and pending requests',async()=>{
  const f=fixture();let resolveOld;const old=f.cache.read('late',()=>new Promise(resolve=>{resolveOld=resolve;}));
  await Promise.resolve();f.cache.invalidate();resolveOld('old');await assert.rejects(old,/read_superseded/);
  await f.read();f.cache.scope('another-owner');assert.equal(f.cache.peek('view'),null);
  assert.equal(await f.cache.read('view',async()=>'new-owner'),'new-owner');
  f.cache.scope(null);await assert.rejects(f.read(),/read_access_denied/);
});

test('both boards submit explicit moves to the tab-owned coordinator without debounce',()=>{
  const contacts=readFileSync(new URL('../components/ContactTable.tsx',import.meta.url),'utf8');
  const opportunities=readFileSync(new URL('../components/OpportunityBoard.tsx',import.meta.url),'utf8');
  for(const source of [contacts,opportunities]) assert.doesNotMatch(source,/useDeferredBoardSave|flushBoard/);
  assert.match(contacts,/moveContactCard\(contact.id, nextStatus, Boolean\(tutorial\)\)/);
  assert.match(opportunities,/moveOpportunityCard\(row.id, stage\)/);
});

test('queued writers refuse changed owner or networking context before any mutation',async()=>{
  const f=fixture();
  for(const expected of [{expectedOwner:'another-owner'},{expectedOwner:'owner',expectedContext:'obsolete'}]) {
    await assert.rejects(f.load('lib/contactActions.ts').updateContactNetworkingStatus(id,'Contactado','test',expected));
  }
  for(const expected of [{owner:'another-owner',context:'token'},{owner:'owner',context:'obsolete'}]) {
    await assert.rejects(f.load('lib/opportunityActions.ts').saveOpportunity({...opportunity,id},expected));
  }
  assert.equal(f.writes.length,0);
});
