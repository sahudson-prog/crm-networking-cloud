import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';

// Invoked only by the isolated PG harness, after checking its container identity/network.
export async function exerciseLifecycleHttp({root,docker,sql,name,label,run,user,other,cycle,token,contact,pause}) {
  const inspected=JSON.parse(docker(['inspect',name]))[0];
  assert.equal(inspected.Config.Labels[label],run);assert.equal(inspected.HostConfig.NetworkMode,'none');
  const image='public.ecr.aws/supabase/postgrest:v16.4';
  const apiName=`${name}-rest`, secret=randomUUID()+randomUUID();
  let identity=''; const created=[]; const interactions=Array.from({length:401},()=>randomUUID());
  const foreign=randomUUID();
  const req=createRequire(join(root,'cloud/web/package.json'));
  const ts=req('typescript');const {PostgrestClient}=req('@supabase/postgrest-js');
  try {
    // Some isolated PG images expose only the legacy per-claim auth.uid(). Bridge
    // the synthetic JWT claim, without changing app functions or weakening RLS.
    sql(`create function public.opportunity_test_claim_adapter() returns void language plpgsql as $$
      begin perform pg_catalog.set_config('request.jwt.claim.sub',current_setting('request.jwt.claims',true)::jsonb->>'sub',true); end; $$;
      revoke all on function public.opportunity_test_claim_adapter() from public;
      grant execute on function public.opportunity_test_claim_adapter() to authenticated;`);
    sql(`insert into public.interactions(id,user_id,interaction_type,subject)
      select x,'${user}','manual','Synthetic' from unnest(array[${interactions.map(id=>`'${id}'`).join(',')}]::uuid[]) x;
      insert into public.interaction_participants(user_id,interaction_id,contact_id)
        select '${user}',x,'${contact}' from unnest(array[${interactions.map(id=>`'${id}'`).join(',')}]::uuid[]) x;
      insert into public.interactions(id,user_id,interaction_type) values('${foreign}','${other}','manual');`);
    docker(['image','inspect',image,'--format','{{.Id}}']);
    identity=docker(['create','--pull=never','--name',apiName,'--label',`${label}=${run}`,'--network',`container:${name}`,
      '-e','PGRST_DB_URI=postgres://postgres@127.0.0.1:5432/postgres','-e','PGRST_DB_SCHEMAS=public',
      '-e','PGRST_DB_ANON_ROLE=anon','-e',`PGRST_JWT_SECRET=${secret}`,'-e','PGRST_SERVER_PORT=3010',
      '-e','PGRST_DB_MAX_ROWS=100','-e','PGRST_DB_PRE_REQUEST=public.opportunity_test_claim_adapter',image]);
    docker(['start',apiName]);
    const makeClient=who=>{
      const body=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+
        Buffer.from(JSON.stringify({sub:who,role:'authenticated',exp:Math.floor(Date.now()/1000)+600})).toString('base64url');
      const jwt=body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
      return new PostgrestClient('http://127.0.0.1:3010',{headers:{Authorization:`Bearer ${jwt}`},fetch:async(url,options={})=>{
        assert.equal(new URL(url).origin,'http://127.0.0.1:3010');
        const args=['exec',name,'curl','-sS','--max-time','15','-D','-','-X',options.method||'GET'];
        for(const [key,value] of new Headers(options.headers))args.push('-H',`${key}: ${value}`);
        if(options.body)args.push('--data',String(options.body));args.push(String(url));
        const raw=docker(args),end=raw.indexOf('\r\n\r\n')>=0?raw.indexOf('\r\n\r\n'):raw.indexOf('\n\n');
        const header=raw.slice(0,end),data=raw.slice(end+(raw.slice(end,end+4)==='\r\n\r\n'?4:2));
        const lines=header.split(/\r?\n/),status=Number(lines.shift().split(' ')[1]);
        const headers=new Headers();for(const line of lines){const at=line.indexOf(':');if(at>0)headers.set(line.slice(0,at),line.slice(at+1).trim());}
        return new Response(status===204?null:data,{status,headers});
      }});
    };
    const rest=makeClient(user),foreignRest=makeClient(other);
    let ready=false;
    for(let i=0;i<60;i++){const r=await rest.from('opportunities').select('id').limit(1);if(!r.error){ready=true;break;}await pause(100);}
    assert.ok(ready,'isolated PostgREST ready');
    const load=(file,imports)=>{
      const module={exports:{}};
      const source=readFileSync(join(root,'cloud/web/lib',file+'.ts'),'utf8');
      const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
      vm.runInNewContext(code,{module,exports:module.exports,console,require:key=>{
        if(!(key in imports))throw new Error('Unexpected import');return imports[key];
      }});return module.exports;
    };
    const model=load('opportunityModel',{}),diagnostics=load('opportunityDiagnostics',{});
    const actions=load('opportunityActions',{'./opportunityModel':model,'./opportunityDiagnostics':diagnostics,
      './supabaseClient':{supabase:{auth:{getUser:async()=>({data:{user:{id:user}},error:null})},from:rest.from.bind(rest),rpc:rest.rpc.bind(rest)}},
      './networkingCycles':{expectedNetworkingContext:async()=>({cycleId:cycle,token})}});
    const first=await rest.from('interaction_participants').select('id,interaction_id',{count:'exact'})
      .eq('user_id',user).eq('contact_id',contact).order('id').range(0,199);
    assert.equal(first.error,null);assert.equal(first.data.length,100);assert.equal(first.count,401);
    const choices=await actions.readEligibleOpportunityInteractions([contact]);
    assert.equal(choices.length,401);assert.equal(new Set(choices.map(row=>row.id)).size,401);
    const input={creationRequestId:randomUUID(),title:'HTTP title only',company:'',applicationUrl:'',stage:'identified',situation:'active',
      result:null,resultNote:'',contactIds:[],objectiveIds:[],interactionIds:[]};
    const id=await actions.saveOpportunity(input);created.push(id);
    assert.equal(await actions.saveOpportunity(input),id);
    const withContact=await actions.saveOpportunity({...input,creationRequestId:randomUUID(),contactIds:[contact]});created.push(withContact);
    const linked=await actions.saveOpportunity({...input,creationRequestId:randomUUID(),contactIds:[contact],interactionIds:[interactions[0],interactions[0]]});created.push(linked);
    assert.equal(sql(`select count(*) from public.opportunity_interactions where opportunity_id='${linked}';`),'1');
    const failInput={...input,creationRequestId:randomUUID(),interactionIds:[interactions[1]]};
    await assert.rejects(actions.saveOpportunity(failInput),/opportunity_rejected/);
    assert.equal(sql(`select count(*) from public.opportunities where creation_request_id='${failInput.creationRequestId}';`),'0');
    await assert.rejects(actions.saveOpportunity({...input,creationRequestId:randomUUID(),contactIds:[contact],interactionIds:[foreign]}),/opportunity_rejected/);
    assert.deepEqual((await foreignRest.from('opportunities').select('id')).data,[]);
    assert.deepEqual((await foreignRest.rpc('read_opportunity_interactions_v1',{p_ids:[interactions[0]]})).data,[]);
    assert.ok((await rest.from('opportunities').insert({title:'Forbidden'})).error,'direct DML denied');
    assert.ok((await rest.rpc('opportunity_interaction_active_v1',{p_row:{}})).error,'internal helper not exposed');
    for(const metadata of [{deleted:true},{dismissed:true},{deleted:'true'},{deleted:1},{deleted:{}},{dismissed:[]}]) {
      sql(`update public.interactions set metadata='${JSON.stringify(metadata)}'::jsonb where id='${interactions[1]}';`);
      assert.equal((await actions.readEligibleOpportunityInteractions([contact])).length,400);
      await assert.rejects(actions.saveOpportunity({...input,creationRequestId:randomUUID(),contactIds:[contact],interactionIds:[interactions[1]]}),/opportunity_rejected/);
    }
    sql(`update public.interactions set metadata='{"deleted":false,"dismissed":null}' where id='${interactions[1]}';`);
    assert.equal((await actions.readEligibleOpportunityInteractions([contact])).length,401);
    if(sql(`select exists(select 1 from pg_attribute where attrelid='public.interactions'::regclass and attname='is_deleted' and not attisdropped);`)==='t') {
      sql(`update public.interactions set is_deleted=true where id='${interactions[1]}';`);
      assert.equal((await actions.readEligibleOpportunityInteractions([contact])).length,400);
      await assert.rejects(actions.saveOpportunity({...input,creationRequestId:randomUUID(),contactIds:[contact],interactionIds:[interactions[1]]}),/opportunity_rejected/);
      sql(`update public.interactions set is_deleted=false where id='${interactions[1]}';`);
    }
    sql(`update public.interactions set metadata='{"dismissed":true}' where id='${interactions[0]}';`);
    await actions.saveOpportunity({...input,id:linked,expectedUpdatedAt:sql(`select updated_at from public.opportunities where id='${linked}';`),
      contactIds:[contact],interactionIds:[interactions[0]],title:'Retain historical link'});
    assert.equal(sql(`select count(*) from public.opportunity_interactions where opportunity_id='${linked}';`),'1');
    const eventCount=sql(`select count(*) from public.opportunity_events where opportunity_id='${linked}';`);
    await assert.rejects(actions.saveOpportunity({...input,id:linked,expectedUpdatedAt:'2000-01-01T00:00:00Z',title:'Stale'}),/opportunity_stale/);
    assert.equal(sql(`select count(*) from public.opportunity_events where opportunity_id='${linked}';`),eventCount);
    console.log('PASS HTTP real actions: 401/401 cap100, title/contact/interaction create, retry, metadata lifecycle, optional column, ownership, ACL/RLS, stale/rollback, retained history');
  } finally {
    if(identity){const info=JSON.parse(docker(['inspect',apiName]))[0];if(info.Id===identity&&info.Config.Labels[label]===run)docker(['rm','-f',apiName]);}
    if(created.length)sql(`delete from public.opportunities where id=any(array[${created.map(id=>`'${id}'`).join(',')}]::uuid[]) and user_id='${user}';`);
    sql(`delete from public.interactions where id=any(array[${[...interactions,foreign].map(id=>`'${id}'`).join(',')}]::uuid[]);
      drop function if exists public.opportunity_test_claim_adapter();`);
  }
}
