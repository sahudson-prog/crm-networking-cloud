import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root=fileURLToPath(new URL('../',import.meta.url));
function fixture(globals={}) {
  let user='owner',authListener,revisionListener,syncListener,calendar=null,failed=null;
  const calls=[],modules=new Map();
  const now='2026-11-18T15:00:00Z';
  let base;
  const rows={};
  const client={auth:{onAuthStateChange(fn){authListener=fn;},getUser:async()=>{calls.push('auth');return {data:{user:user?{id:user}:null},error:null};}},
    rpc:async()=>{calls.push('snapshot');return {data:structuredClone(base),error:null};},
    from(table){let start=0,end=199;const filters=[];let columns;
      const query={select(c){columns=c;return query;},eq(k,v){filters.push([k,v]);return query;},is(){return query;},neq(){return query;},order(){return query;},range(a,b){start=a;end=b;return query;},returns(){return query;},single(){return query;},
        then(ok,bad){calls.push(table);assert.ok(filters.some(([k,v])=>(k==='user_id'||k==='id')&&v===user));
          assert.doesNotMatch(columns,/subject|user_notes|email|phone/);
          const data=table==='profiles'?{created_at:'2025-01-01T00:00:00Z'}:(rows[table]??[]).slice(start,end+1);
          return Promise.resolve({data,count:(rows[table]??[]).length,error:table===failed?{code:'42501'}:null}).then(ok,bad);
        }};return query;}
  };
  function load(file){
    file=resolve(root,file);if(modules.has(file))return modules.get(file).exports;
    const module={exports:{}};modules.set(file,module);
    const code=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,console:{warn(){},error(){}},Date,Intl,Map,Set,Promise,...globals,require(name){
      if(name in (globals.dependencies??{}))return globals.dependencies[name];
      if(/supabaseClient/.test(name))return {supabase:client};
      if(/activitySyncExecution/.test(name))return {subscribeGlobalActivitySync(fn){syncListener=fn;},getGlobalActivitySyncSnapshot:()=>({lastSuccess:{calendar}})};
      if(/networkingDataRevision/.test(name))return {subscribeNetworkingDataRevision(fn){revisionListener=fn;}};
      let path=resolve(dirname(file),name);if(!existsSync(path))path+='.ts';return load(path);
    }});return module.exports;
  }
  const {trackingFixture,coffee}=load('tests/trackingFixtures.ts');base=trackingFixture();base.as_of=now;
  coffee(base,'event','2026-11-17T15:00:00Z');
  rows.interactions=[...base.interactions,{id:'note',interaction_type:'note',occurred_at:now,metadata:{}}];
  rows.interaction_participants=[...base.participants.map((p,i)=>({...p,id:'p'+i})),{id:'pn',interaction_id:'note',contact_id:base.contacts[0].id}];
  rows.external_interaction_sources=base.sources.map((s,i)=>({...s,id:'s'+i}));
  rows.contact_networking_transitions=base.transitions;
  rows.networking_cycles=[{id:'cycle',objective_type:'JOB_SEARCH',status:'active',timezone_name:'America/Santiago'}];
  rows.objectives=base.priorities;rows.contact_objective_assignments=base.assignments.map((a,i)=>({...a,id:'assignment'+i}));
  rows.opportunities=[];rows.opportunity_contacts=[];
  return {calls,rows,load,base,client,read:load('lib/indicatorReads.ts'),
    mutation(){revisionListener();},sync(){calendar=String(Date.now());syncListener();},
    auth(id){user=id;authListener('SIGNED_OUT',id?{user:{id}}:null);},fail(table){failed=table;}};
}

test('real shared reader graph: parallel consumers issue one auth, snapshot and evidence set; no detail reader',async()=>{
  const f=fixture();
  const [snapshot,extra,second]=await Promise.all([f.read.readSharedTrackingSnapshot(),f.read.readSharedGamificationExtra(),f.read.readSharedTrackingSnapshot()]);
  assert.equal(snapshot,second);assert.equal(f.calls.filter(x=>x==='auth').length,1);
  for(const name of ['snapshot','interactions','interaction_participants','external_interaction_sources','contact_networking_transitions','profiles'])assert.equal(f.calls.filter(x=>x===name).length,1,name);
  assert.equal(snapshot.coffeeHistory.interactions.length,f.rows.interactions.length);
  assert.equal(extra.transitions,snapshot.coffeeHistory.transitions);assert.equal(extra.calendarSources,snapshot.coffeeHistory.sources);
  const before=f.calls.length;
  await Promise.all([f.read.readSharedTrackingSnapshot(),f.read.readSharedGamificationExtra()]);
  assert.deepEqual(f.calls.slice(before),['auth']);
  f.mutation();await f.read.readSharedTrackingSnapshot();assert.equal(f.calls.filter(x=>x==='snapshot').length,2);
  f.sync();await f.read.readSharedTrackingSnapshot();assert.equal(f.calls.filter(x=>x==='snapshot').length,3);
  f.auth(null);await assert.rejects(f.read.readSharedTrackingSnapshot(),/read_access_denied/);
  f.auth('second-owner');await f.read.readSharedTrackingSnapshot();assert.equal(f.calls.filter(x=>x==='snapshot').length,4);
});

test('new minimal evidence preserves pyramid, chart, milestones, streak and goals with identical scopes',async()=>{
  const f=fixture();const [snapshot,extra]=await Promise.all([f.read.readSharedTrackingSnapshot(),f.read.readSharedGamificationExtra()]);
  const {buildTracking}=f.load('lib/trackingModel.ts'),{attributedCoffeeHistory,buildGamification}=f.load('lib/gamificationModel.ts');
  const calendarOnly={...snapshot,coffeeHistory:{...snapshot.coffeeHistory,interactions:snapshot.coffeeHistory.interactions.filter(i=>i.interaction_type==='calendar')}};
  const comparable=v=>JSON.stringify(v,(_k,x)=>typeof x==='bigint'?String(x):x instanceof Map?[...x]:x instanceof Set?[...x]:x);
  assert.equal(comparable(buildTracking(snapshot)),comparable(buildTracking(calendarOnly)));
  const input={contacts:snapshot.contacts,interactions:f.rows.interactions,participants:f.rows.interaction_participants,sources:f.rows.external_interaction_sources,extra,
    history:attributedCoffeeHistory(snapshot.contacts,snapshot.coffeeHistory,snapshot.as_of)};
  const direct=buildGamification(input,Date.parse(snapshot.as_of),'America/Santiago');
  const shared=buildGamification({...input,interactions:snapshot.coffeeHistory.interactions,participants:snapshot.coffeeHistory.participants,sources:snapshot.coffeeHistory.sources},Date.parse(snapshot.as_of),'America/Santiago');
  assert.equal(comparable(shared),comparable(direct));
});

test('technical failures remain errors and are retried, never retained as successful empty evidence',async()=>{
  const f=fixture();f.fail('interactions');const broken=await f.read.readSharedTrackingSnapshot();
  assert.equal(broken.coffeeHistoryError,true);assert.equal(broken.coffeeHistory,undefined);
  f.fail(null);const recovered=await f.read.readSharedTrackingSnapshot();assert.ok(recovered.coffeeHistory);
  assert.equal(f.calls.filter(x=>x==='interactions').length,2);
});

test('focus is fresh for a minute; civil week boundary forces refresh; hidden tab does not poll',()=>{
  let effect,clock=Date.parse('2026-11-18T15:00:00Z'),refreshes=0,timer;
  const events={},document={hidden:false,addEventListener:(name,fn)=>{events[name]=fn;},removeEventListener(){}};
  class Clock extends Date {static now(){return clock;}}
  const f=fixture({Date:Clock,window:{addEventListener:(name,fn)=>{events[name]=fn;},removeEventListener(){}},document,
    setTimeout:(fn,delay)=>{timer={fn,delay};return 1;},clearTimeout(){},
    dependencies:{react:{useEffect:fn=>{effect=fn;}},'react/jsx-runtime':{},'./GamificationPanel':{}}});
  const {useHomeRefresh}=f.load('components/HomeGamification.tsx');useHomeRefresh(true,'America/Santiago',()=>{refreshes++;});const cleanup=effect();
  events.focus();events.visibilitychange();assert.equal(refreshes,0);
  clock+=60000;document.hidden=true;events.visibilitychange();assert.equal(refreshes,0);
  document.hidden=false;events.focus();events.visibilitychange();assert.equal(refreshes,1);
  assert.ok(timer.delay>0);timer.fn();assert.equal(refreshes,2);cleanup();
});

test('initial priority goal waits for auxiliary data; background refresh preserves visible goals',()=>{
  const pending={goals:[{id:'prioritized',metric:{value:null}}],route:null};
  const previous={goals:[{id:'prioritized',metric:{value:50}}],route:{}};
  function render(retained){
    let state=0;
    const f=fixture({dependencies:{
      react:{useState:initial=>[state++===2?retained:typeof initial==='function'?initial():initial,()=>{}],useMemo:fn=>fn(),useEffect(){}},
      'react/jsx-runtime':{jsx:(_type,props)=>props},'./GamificationPanel':{},
      '../lib/indicatorReads':{peekGamificationExtra:()=>null},
      '../lib/gamificationModel':{attributedCoffeeHistory:()=>({}),buildGamification:()=>pending}
    }});
    return f.load('components/HomeGamification.tsx').HomeGamification({snapshot:f.base,snapshotKey:'current',readKey:'current',loading:false,error:false,onRetry(){}});
  }
  const initial=render(null);
  assert.equal(initial.goalsLoading,true);assert.equal(initial.error,false);
  const refresh=render(previous);
  assert.equal(refresh.goalsLoading,false);assert.equal(refresh.model,previous);
});

test('completed primary goals reveal loaded priorities after the initial auxiliary read',()=>{
  const slots=[null,true,null];
  let slot=0;
  const extra={priorities:[{id:'priority'}]};
  const f=fixture({dependencies:{
    react:{useState(initial){const index=slot++;return [slots[index]??(index===2?null:slots[index]),value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useMemo:fn=>fn(),useEffect(){}},
    'react/jsx-runtime':{jsx:(_type,props)=>props},'./GamificationPanel':{},
    '../lib/indicatorReads':{peekGamificationExtra:()=>null},
    '../lib/gamificationModel':{attributedCoffeeHistory:()=>({}),buildGamification:({extra:input})=>({
      goals:[{id:'realized',metric:{value:2}},{id:'projected',metric:{value:4}},
        {id:'prioritized',metric:{value:input.priorities?100:null}}],route:{},temporal:{}
    })}
  }});
  const Home=f.load('components/HomeGamification.tsx').HomeGamification;
  const props={snapshot:f.base,snapshotKey:'current',readKey:'current',loading:false,error:false,onRetry(){}};
  const render=()=>{slot=0;return Home(props);};
  const pending=render();
  assert.deepEqual(pending.model.goals.slice(0,2).map(goal=>goal.metric.value),[2,4]);
  assert.equal(pending.model.goals[2].metric.value,null);
  assert.equal(pending.goalsLoading,true);
  assert.equal(pending.error,false);

  slots[0]={key:'current',extra};slots[1]=false;
  const ready=render();
  assert.equal(ready.goalsLoading,false);
  assert.equal(ready.model.goals[2].metric.value,100);
  assert.equal(ready.error,false);
});
