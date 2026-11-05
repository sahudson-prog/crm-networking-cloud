// Real components and adapters, synthetic transport. Never reads env or credentials.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),req=createRequire(path.join(root,'package.json'));
const {webpack}=req('next/dist/compiled/webpack/webpack');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'coffeecito-uxdate-ui-'));
const imp=f=>JSON.stringify(path.join(root,f).replaceAll('\\','/'));
let server,browser;
async function main(){
 fs.writeFileSync(path.join(out,'loader.cjs'),`const ts=require(${JSON.stringify(req.resolve('typescript'))});module.exports=src=>ts.transpileModule(src,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
 fs.writeFileSync(path.join(out,'supabase.ts'),`
 const now=new Date(); const earliest=new Date(now);earliest.setUTCMonth(now.getUTCMonth()-6);
 window.fixture={calls:[],months:6,revision:1,failSave:false,missing:false,stale:false,windowMode:new URLSearchParams(location.search).get('scenario')==='availability'?'error':'ready'};
 export const supabaseConfigError='';
 export const supabase={rpc:async(name,args)=>{
  const f=window.fixture;f.calls.push({name,args});
  const policy={max_months:f.months,revision:f.revision,earliest_start:earliest.toISOString(),as_of:now.toISOString()};
  if(name==='current_user_networking_history_policy_v1')return {data:policy};
  if(name==='current_user_history_window_v1'){
   if(f.windowMode==='error')return {error:{message:'synthetic transport failure'}};
   const response=f.missing?{error:{message:'history_active_cycle_required'}}:{data:{cycle_id:'synthetic-cycle',context:'active:synthetic',max_months:f.months,revision:f.revision,timezone:'UTC',effective_start:earliest.toISOString()}};
   if(f.windowMode==='hold')return new Promise(resolve=>{f.releaseWindow=()=>resolve(response);});
   return response;
  }
  if(name==='admin_set_networking_history_policy_v1'){
   if(f.stale)return {error:{message:'history_policy_stale'}};
   f.months=args.p_months;f.revision++;return {data:{...policy,max_months:f.months,revision:f.revision}};
  }
  if(name==='current_user_starting_point_v1'||name==='save_current_user_starting_point_v1'){
   if(name.startsWith('save')&&f.failSave)return {error:{message:'synthetic'}};
   return {data:{full_name:args?.p_full_name??'Synthetic',professional_situation_code:args?.p_professional_situation_code??'employed',networking_start_date:'2020-01-01'}};
  }
  if(name==='apply_ics_import_v2')return {data:{createdCount:1,updatedCount:0,unchangedCount:0,participantsInserted:0,participantsLinked:0,items:[]}};
  if(name==='apply_google_history_v1'||name==='apply_google_periodic_v1')return {data:{status:'created',interaction_id:'synthetic'}};
  throw new Error('Unexpected fixture RPC '+name);
 }};`);
 fs.writeFileSync(path.join(out,'cycles.ts'),`
 const legacy=new URLSearchParams(location.search).get('scenario')==='legacy';
 const active=new URLSearchParams(location.search).get('scenario')==='active';
 const consecutive=new URLSearchParams(location.search).get('scenario')==='consecutive';
 const rows=legacy?[{id:'legacy',status:'active',started_at:null,timezone_name:null,origin:'legacy'}]:active?[{id:'active',status:'active',started_at:'2026-11-01T12:00:00Z',timezone_name:'UTC',origin:'user'}]:consecutive?[{id:'closed',status:'closed',started_at:'2026-11-01T00:00:00Z',closed_at:'2026-11-04T10:30:00.000456Z',timezone_name:'UTC'}]:[];
 export const readNetworkingCycles=async()=>rows;
 export const expectedNetworkingContext=async()=>({token:'synthetic'});
 export const networkingContextFromCycles=()=>({token:'synthetic'});
 export const localDateTimeValue=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,19);
 export const startNetworkingCycle=async input=>{window.cycleInput=input;};
 export const closeNetworkingCycle=async()=>{window.closeCalls=(window.closeCalls||0)+1;throw {message:'cycle_end_invalid'};};
 export const adoptConfirmedOwnClose=()=>{};`);
 fs.writeFileSync(path.join(out,'notices.ts'),`export const readMyNetworkingPlanNotices=async()=>new Set();export const requestNetworkingPlanNotice=async()=>{throw new Error('not in fixture')};export const withdrawNetworkingPlanNotice=requestNetworkingPlanNotice;`);
 fs.writeFileSync(path.join(out,'entry.tsx'),`
 import React,{useRef} from 'react';import {createRoot} from 'react-dom/client';
 import {StartingPointFields} from ${imp('components/StartingPointFields.tsx')};
 import {NetworkingCyclePanel} from ${imp('components/NetworkingCyclePanel.tsx')};
 import {HistoryPolicyAdminPanel} from ${imp('components/HistoryPolicyAdminPanel.tsx')};
 import {HistoryImportNotice,HistoryImportAvailabilityFeedback,useHistoryImportAvailability} from ${imp('components/HistoryImportNotice.tsx')};
 import {readHistoryWindow,revalidateHistoryWindow} from ${imp('lib/historyPolicy.ts')};
 import {syncExternalInteraction} from ${imp('lib/externalInteractionSync.ts')};
 import {applyIcsImportSelection} from ${imp('lib/icsImportApply.ts')};
 import {buildIcsImportReviewSnapshot} from ${imp('lib/icsImportReview.ts')};
 import {parseIcsCalendar} from ${imp('lib/icsImport.ts')};
 window.testHistory=async()=>{const saved=await readHistoryWindow();window.fixture.revision++;try{await revalidateHistoryWindow(saved);return false;}catch{return true;}};
 window.testWriters=async()=>{
  const context=await readHistoryWindow();const item={provider:'google',sourceService:'calendar',externalObjectType:'calendar_event',externalId:'synthetic',connectedAccountId:'synthetic-account',interactionType:'calendar',occurredAt:new Date().toISOString()};
  await syncExternalInteraction({...item,historyWindow:context});await syncExternalInteraction(item);
  const parsed=parseIcsCalendar('BEGIN:VCALENDAR\\r\\nVERSION:2.0\\r\\nBEGIN:VEVENT\\r\\nUID:fixture@example.invalid\\r\\nDTSTART:20261104T130000Z\\r\\nATTENDEE:mailto:focus@example.invalid\\r\\nEND:VEVENT\\r\\nEND:VCALENDAR');
  const snapshot=buildIcsImportReviewSnapshot({parsed,existingIcsSources:[],calendarInteractions:[],focusContactIdsByEmail:new Map([['focus@example.invalid','00000000-0000-4000-8000-000000000001']]),minimumStartIso:context.effective_start});
  snapshot.historyWindow=context;await applyIcsImportSelection({snapshot,selectedChangeIds:snapshot.changes.map(c=>c.id)});
  window.fixture.revision++;try{await applyIcsImportSelection({snapshot,selectedChangeIds:snapshot.changes.map(c=>c.id)});return false;}catch{return true;}
 };
 function App(){const ref=useRef(null);return <main style={{padding:16}}><section className="panel"><h2>Tu punto de partida</h2><StartingPointFields ref={ref} mode="onboarding"/><button className="button" onClick={()=>ref.current.save()}>Siguiente</button></section><section className="panel"><NetworkingCyclePanel/></section><section className="panel"><HistoryPolicyAdminPanel/><HistoryImportNotice/></section></main>}
 function Availability(){const state=useHistoryImportAvailability();window.retryAvailability=state.retry;return <><HistoryImportAvailabilityFeedback {...state}/><button disabled={state.status!=='ready'}>Importar prueba</button></>}
 const root=createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();
 root.render(new URLSearchParams(location.search).get('scenario')==='availability'?<Availability/>:<App/>);`);
 await new Promise((resolve,reject)=>{
  const compiler=webpack({mode:'development',devtool:false,context:root,entry:path.join(out,'entry.tsx'),output:{path:out,filename:'bundle.js'},
   resolve:{extensions:['.tsx','.ts','.js','.json'],modules:[path.join(root,'node_modules'),'node_modules']},
   module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[path.join(out,'loader.cjs')]}]},plugins:[
    new webpack.NormalModuleReplacementPlugin(/supabaseClient(?:\.ts)?$/,path.join(out,'supabase.ts')),
    new webpack.NormalModuleReplacementPlugin(/networkingCycles(?:\.ts)?$/,path.join(out,'cycles.ts')),
    new webpack.NormalModuleReplacementPlugin(/networkingPlanNotice(?:\.ts)?$/,path.join(out,'notices.ts'))]});
  compiler.run((e,s)=>compiler.close(()=>e||s.hasErrors()?reject(e||new Error(s.toString({all:false,errors:true}))):resolve()));
 });
 server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');
  const file=url.pathname==='/bundle.js'?path.join(out,'bundle.js'):url.pathname==='/app/globals.css'||url.pathname.startsWith('/styles/')?path.join(root,url.pathname):null;
  if(file&&file.startsWith(root)||file===path.join(out,'bundle.js')){response.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');response.end(fs.readFileSync(file));return;}
  response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/globals.css"><div id="root"></div><script src="/bundle.js"></script></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const {chromium}=require(process.env.UXDATE_PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({timezoneId:'UTC'});await context.route('**/*',route=>new URL(route.request().url()).origin===url?route.continue():route.abort());
 const page=await context.newPage();await page.clock.install({time:new Date('2026-11-04T12:00:00Z')});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1280,320]){
  await page.setViewportSize({width,height:900});await page.goto(url);await page.getByLabel('¿Cómo te llamamos?').waitFor();
  await page.waitForFunction(()=>!document.querySelector('.starting-point-fields').getAttribute('aria-busy')||document.querySelector('.starting-point-fields').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('input[type=date]').count(),0);
  assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.name.startsWith('save')).length),0);
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();await page.getByText('Datos guardados.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.calls.find(c=>c.name==='save_current_user_starting_point_v1').args.p_networking_start_date),null);
  await page.screenshot({path:path.join(out,'fields-'+width+'.png'),fullPage:true});
  await page.getByRole('button',{name:'Comenzar proceso',exact:true}).click();await page.locator('dialog[open]').waitFor();
  await page.getByText('Puedes elegir una fecha de hasta 6 meses atrás.',{exact:true}).waitFor();
  await page.locator('input[type=date]').fill('2020-01-01');
  assert.equal(await page.locator('dialog').getByRole('button',{name:'Comenzar proceso',exact:true}).isDisabled(),true);
  await page.locator('input[type=date]').fill('2026-11-05');
  await page.getByText('La fecha no tiene un inicio permitido antes del presente.',{exact:true}).waitFor();
  assert.equal(await page.locator('dialog').getByRole('button',{name:'Comenzar proceso',exact:true}).isDisabled(),true);
  assert.ok(await page.locator('input[type=date]').getAttribute('min'));
  assert.equal(await page.locator('input[type=datetime-local]').count(),0);
  await page.screenshot({path:path.join(out,'cycle-'+width+'.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.testWriters()),true);
  const calls=await page.evaluate(()=>window.fixture.calls);
  assert.equal(calls.filter(c=>c.name==='apply_ics_import_v2').length,1);
  assert.ok(calls.find(c=>c.name==='apply_google_history_v1').args.p_context);
  assert.equal(calls.find(c=>c.name==='apply_google_periodic_v1').args.p_context,undefined);
  assert.equal(await page.evaluate(()=>window.testHistory()),true);
  await page.getByLabel('Máximo de meses hacia atrás').fill('13');assert.equal(await page.getByRole('button',{name:'Guardar límite'}).isDisabled(),true);
 }
 for(const width of [1280,320]){
  await page.setViewportSize({width,height:900});await page.goto(url+'?scenario=active');
  await page.getByRole('button',{name:'Finalizar proceso',exact:true}).click();
  const dialog=page.locator('dialog[open]'),field=dialog.locator('input[type=datetime-local]');
  const confirm=dialog.getByRole('button',{name:'Finalizar proceso',exact:true});
  await dialog.getByLabel('Resultado').selectOption({index:1});
  assert.equal(await field.getAttribute('min'),'2026-11-01T12:01');
  assert.equal(await field.getAttribute('step'),'60');
  assert.equal((await field.inputValue()).length,16);
  for(const value of ['', '2026-10-31T12:00','2026-11-01T12:00','2026-11-05T12:00']){
   await field.fill(value);assert.equal(await confirm.isDisabled(),true);
   assert.equal(await field.getAttribute('aria-invalid'),'true');
  }
  assert.equal(await page.evaluate(()=>window.closeCalls||0),0);
  await field.fill('2026-11-01T12:01');assert.equal(await confirm.isEnabled(),true);
  await confirm.click();await dialog.getByText('El fin debe ser posterior al inicio y no puede estar en el futuro.',{exact:true}).waitFor();
  assert.equal(await confirm.isEnabled(),true); // Server/transport errors must permit retry.
  assert.equal(await page.evaluate(()=>window.closeCalls),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(out,'close-validation-'+width+'.png'),fullPage:true});
 }
 await page.goto(url+'?scenario=legacy');await page.getByRole('button',{name:'Comenzar proceso',exact:true}).click();
 await page.getByText(/Este proceso existente admite/).waitFor();await page.locator('input[type=date]').fill('2020-01-01');
 assert.equal(await page.getByRole('button',{name:'Completar proceso',exact:true}).isEnabled(),true);
 await page.goto(url+'?scenario=consecutive');await page.getByRole('button',{name:'Comenzar proceso',exact:true}).click();
 await page.getByText('Puedes elegir una fecha de hasta 6 meses atrás.',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Fecha de inicio',{exact:true}).getAttribute('min'),'2026-11-04');
 await page.getByLabel('Fecha de inicio',{exact:true}).fill('2026-11-03');
 assert.equal(await page.locator('dialog[open]').getByRole('button',{name:'Comenzar proceso',exact:true}).isDisabled(),true);
 await page.getByLabel('Fecha de inicio',{exact:true}).fill('2026-11-04');
 await page.locator('dialog[open]').getByRole('button',{name:'Comenzar proceso',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.cycleInput.localStart),'2026-11-04T10:30:01');
 await page.goto(url+'?scenario=availability');
 await page.getByRole('alert').waitFor();
 assert.match(await page.getByRole('alert').innerText(),/No pudimos comprobar/);
 assert.equal(await page.getByRole('button',{name:'Importar prueba'}).isDisabled(),true);
 await page.evaluate(()=>{window.fixture.windowMode='hold';});
 await page.getByRole('button',{name:'Reintentar lectura',exact:true}).click();
 await page.getByRole('status').waitFor();
 assert.equal(await page.getByRole('button',{name:'Importar prueba'}).isDisabled(),true);
 await page.waitForFunction(()=>!!window.fixture.releaseWindow);
 await page.evaluate(()=>window.fixture.releaseWindow());
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Importar prueba').disabled);
 await page.evaluate(()=>{window.fixture.missing=true;window.fixture.windowMode='ready';window.retryAvailability();});
 await page.getByText('Configura el inicio de tu proceso en Objetivos antes de importar correos o citas.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('alert').count(),0);
 assert.equal(await page.getByRole('button',{name:'Importar prueba'}).isDisabled(),true);
 // A late success from an earlier attempt must not overwrite the latest error.
 await page.evaluate(()=>{window.fixture.missing=false;window.fixture.windowMode='hold';window.fixture.releaseWindow=null;window.retryAvailability();});
 await page.waitForFunction(()=>!!window.fixture.releaseWindow);
 await page.evaluate(()=>{window.fixture.windowMode='error';window.retryAvailability();});
 await page.getByRole('alert').waitFor();
 await page.evaluate(()=>window.fixture.releaseWindow());
 assert.equal(await page.getByRole('button',{name:'Importar prueba'}).isDisabled(),true);
 assert.match(await page.getByRole('alert').innerText(),/No pudimos comprobar/);
 await page.evaluate(()=>{window.fixture.windowMode='hold';window.fixture.releaseWindow=null;window.retryAvailability();});
 await page.waitForFunction(()=>!!window.fixture.releaseWindow);
 await page.evaluate(()=>{window.unmountFixture();window.fixture.releaseWindow();});
 assert.equal(await page.locator('#root').innerText(),'');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',viewports:[1280,320],artifacts:out,syntheticOnly:true}));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));});
