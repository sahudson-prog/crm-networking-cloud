// Synthetic transport benchmark. No network, Auth session or environment files.
// node tests/local/perf-home-benchmark.cjs <baseline-cloud-web>
const {readFileSync,existsSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {performance}=require('node:perf_hooks');
const ts=require('typescript');
const current=path.resolve(__dirname,'../..'),baseline=process.argv[2];
if(require.main===module&&!baseline)throw Error('Supply the baseline cloud/web directory');

function environment(root,size) {
  const modules=new Map(),requests=[];
  const now='2026-11-18T15:00:00Z',owner='synthetic-owner';
  const tables={};let snapshot;
  async function response(name,data,count) {
    const start=performance.now();
    const bytes=Buffer.byteLength(JSON.stringify(data));
    await new Promise(r=>setTimeout(r,20));
    requests.push({name,bytes,ms:performance.now()-start});
    return {data,count,error:null};
  }
  const client={auth:{onAuthStateChange(){},getUser:()=>response('auth',{user:{id:owner}})},rpc:()=>response('snapshot',structuredClone(snapshot)),from(table){
    let from=0,to=Infinity,single=false,columns='';const filters=[];
    const q={select(c){columns=c;return q;},eq(k,v){filters.push(row=>row[k]===undefined||row[k]===v);return q;},
      is(){return q;},neq(){return q;},not(){return q;},or(){return q;},order(){return q;},
      in(k,ids){filters.push(row=>ids.includes(row[k]));return q;},limit(n){to=n-1;return q;},range(a,b){from=a;to=b;return q;},returns(){return q;},single(){single=true;return q;},maybeSingle(){single=true;return q;},
      then(ok,bad){
        const all=(tables[table]??[]).filter(row=>filters.every(fn=>fn(row)));
        const selected=all.slice(from,to+1).map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>columns.includes(key))));
        return response(table,single?selected[0]??null:selected,all.length).then(ok,bad);
      }};return q;
  }};
  function load(file) {
    file=path.resolve(root,file);if(modules.has(file))return modules.get(file).exports;
    const module={exports:{}};modules.set(file,module);
    const code=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,console,Date,Intl,Map,Set,Promise,URL,require(name){
      if(/supabaseClient/.test(name))return {supabase:client};
      if(/activitySyncExecution/.test(name))return {subscribeGlobalActivitySync(){},getGlobalActivitySyncSnapshot:()=>({})};
      if(/networkingDataRevision/.test(name))return {subscribeNetworkingDataRevision(){},notifyNetworkingDataChanged(){}};
      let resolved=path.resolve(path.dirname(file),name);if(!existsSync(resolved))resolved+='.ts';return load(resolved);
    }});return module.exports;
  }
  snapshot=load('tests/trackingFixtures.ts').trackingFixture();snapshot.as_of=now;
  snapshot.contacts=Array.from({length:size},(_,i)=>({...snapshot.contacts[0],id:'c'+i,networking_status:'Cita concretada'}));
  snapshot.interactions=snapshot.contacts.map((c,i)=>({id:'e'+i,interaction_type:'calendar',occurred_at:new Date(Date.parse(now)-(i+1)*3600000).toISOString(),metadata:{}}));
  snapshot.participants=snapshot.contacts.map((c,i)=>({interaction_id:'e'+i,contact_id:c.id}));snapshot.transitions=[];snapshot.sources=[];
  tables.contacts=snapshot.contacts.map(c=>({...c,display_name:'Synthetic',is_active:true,contact_phones:[],updated_at:now}));
  tables.interactions=snapshot.interactions.map(i=>({...i,subject:'Synthetic',user_notes_raw:'x'.repeat(1000),updated_at:now}));
  tables.interaction_participants=snapshot.participants.map((p,i)=>({...p,id:'p'+i}));
  tables.profiles=[{id:owner,created_at:'2025-01-01T00:00:00Z'}];
  tables.networking_cycles=[{...snapshot.cycle,status:'active',objective_type:'JOB_SEARCH',start_request_id:'request'}];
  tables.objectives=snapshot.priorities;tables.contact_objective_assignments=[];tables.opportunities=[];
  return {load,requests};
}

module.exports={environment};
if(require.main===module)(async()=>{
  for(const size of [100,500])for(const [name,root] of [['before',baseline],['after',current]]) {
    const env=environment(root,size),optimized=name==='after';
    // Load/transpile outside timing, as it is not part of application network latency.
    const tracking=env.load('lib/trackingRead.ts'),details=env.load('lib/dashboardDetails.ts'),gam=env.load('lib/gamificationRead.ts');
    const shared=optimized?env.load('lib/indicatorReads.ts'):null;
    const model=env.load('lib/gamificationModel.ts'),tm=env.load('lib/trackingModel.ts');
    for(const phase of ['cold','return','focus']) {
      const start=performance.now(),offset=env.requests.length;let snapshot,extra,detail,trackingMs,routeMs;
      if(optimized&&phase==='focus') {console.log(JSON.stringify({name,size,phase,requests:0,bytes:0,reason:'fresh focus suppressed; covered by hook test'}));continue;}
      if(optimized) [snapshot,extra]=await Promise.all([shared.readSharedTrackingSnapshot().then(s=>{trackingMs=performance.now()-start;return s;}),shared.readSharedGamificationExtra()]);
      else { [snapshot,detail]=await Promise.all([tracking.readTrackingSnapshot().then(s=>{trackingMs=performance.now()-start;return s;}),details.readDashboardDetails()]);extra=await gam.readGamificationExtra(snapshot.coffeeHistory); }
      routeMs=performance.now()-start;
      const cpu=performance.now();tm.buildTracking(snapshot);
      model.buildGamification({contacts:snapshot.contacts,interactions:optimized?snapshot.coffeeHistory.interactions:detail.interactions,participants:optimized?snapshot.coffeeHistory.participants:detail.participants,sources:snapshot.coffeeHistory.sources,extra,history:model.attributedCoffeeHistory(snapshot.contacts,snapshot.coffeeHistory,snapshot.as_of)},Date.parse(snapshot.as_of),'America/Santiago');
      const calls=env.requests.slice(offset),counts={};for(const call of calls)counts[call.name]=(counts[call.name]??0)+1;
      console.log(JSON.stringify({name,size,phase,trackingMs:Math.round(trackingMs),routeMs:Math.round(routeMs),cpuMs:Math.round(performance.now()-cpu),requests:calls.length,bytes:calls.reduce((n,r)=>n+r.bytes,0),counts}));
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
