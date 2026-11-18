// Same synthetic transport on both revisions; no environment, network or real data.
const {environment}=require('./perf-home-benchmark.cjs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const current=path.resolve(__dirname,'../..'),baseline=process.argv[2];
if(!baseline)throw Error('Supply baseline cloud/web directory');
(async()=>{
  for(const size of [100,500,3000]) {
    let expected;
    for(const [name,root] of [['before',baseline],['after',current]]) {
      const env=environment(root,size),data=env.load('lib/cloudData.ts');
      const details=env.load('lib/dashboardDetails.ts');
      for(const phase of ['cold','return']) {
        const offset=env.requests.length,start=performance.now();
        const [rows]=await Promise.all([data.readContactListRows(),data.readAllActiveContacts(true)]);
        const listMs=performance.now()-start;
        const canonical=JSON.stringify(rows.map(r=>[r.id,r.last_interaction_at,r.days_since_last_interaction]));
        if(size<=500&&phase==='cold'){if(name==='before')expected=canonical;else assert.equal(canonical,expected);}
        if(name==='after')assert.equal(rows.length,size);
        const detailStart=performance.now();await details.readDashboardDetails('planning');
        const calls=env.requests.slice(offset);
        console.log(JSON.stringify({name,size,phase,listMs:Math.round(listMs),detailMs:Math.round(performance.now()-detailStart),rows:rows.length,requests:calls.length,bytes:calls.reduce((n,r)=>n+r.bytes,0)}));
      }
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
