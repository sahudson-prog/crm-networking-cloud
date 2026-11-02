// Real mounted editor; synthetic transport only. No env files, sessions or external requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'package.json'));
const { webpack } = req('next/dist/compiled/webpack/webpack');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'coffeecito-opportunities-ui-'));
const imp = file => JSON.stringify(path.join(root, file).replaceAll('\\', '/'));
let server, browser;
async function main() {
  fs.writeFileSync(path.join(output, 'loader.cjs'), `const ts=require(${JSON.stringify(req.resolve('typescript'))});module.exports=src=>ts.transpileModule(src,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  fs.writeFileSync(path.join(output, 'actions.ts'), `
import {OpportunityFailure} from ${imp('lib/opportunityDiagnostics.ts')};
window.fixture={failReads:false,holdReads:false,holdSave:false,failFirstSave:false,saves:[],reads:[],pendingSaves:[]};
export const readOpportunityChoices=async()=>({contacts:{status:'fulfilled',value:[{id:'c1',display_name:'Alpha'},{id:'c2',display_name:'Beta'}]},objectives:{status:'fulfilled',value:[{id:'p1',objective_name:'Priority',objective_type:'COMPANY',priority_level:'HIGH'}]}});
export async function readEligibleOpportunityInteractions(ids){
 const f=window.fixture;
 if(f.holdReads)return new Promise((resolve,reject)=>f.reads.push({ids,resolve,reject}));
 if(f.failReads)throw new Error('synthetic read failure');
 return ids.includes('c1')?[{id:'i1',subject:'Synthetic interaction',interaction_type:'manual',occurred_at:null}]:[];
}
export async function saveOpportunity(input){
 const f=window.fixture;f.saves.push(structuredClone(input));
 if(f.holdSave)await new Promise(resolve=>f.pendingSaves.push(resolve));
 if(f.failFirstSave&&f.saves.length===1)throw new OpportunityFailure('rpc','uncertain','client_or_transport',null);
 return '00000000-0000-4000-8000-000000000001';
}
export const voidOpportunity=async()=>{throw new Error('void outside fixture scope')};
`);
  fs.writeFileSync(path.join(output, 'objectives.ts'), `export const OBJECTIVE_TYPES=['COMPANY','INDUSTRY','ROLE','FUNCTION'].map(value=>({value,label:value}));export const objectivePriorityLabel=x=>x;export const objectiveTypeLabel=x=>x;export const readObjectives=()=>{throw new Error('unexpected read')};`);
  fs.writeFileSync(path.join(output, 'entry.tsx'), `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {OpportunityEditor} from ${imp('components/OpportunityEditor.tsx')};
function App(){const [request,setRequest]=useState(null);window.openOpportunity=r=>setRequest(r||{});
return <><button onClick={()=>setRequest({})}>Open</button><OpportunityEditor request={request} onClose={()=>setRequest(null)} onSaved={()=>setRequest(null)}/></>}
createRoot(document.getElementById('root')).render(<App/>);
`);
  await new Promise((resolve, reject) => {
    const compiler = webpack({mode:'development',devtool:false,context:root,entry:path.join(output,'entry.tsx'),
      output:{path:output,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js','.json'],modules:[path.join(root,'node_modules'),'node_modules']},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[path.join(output,'loader.cjs')]}]},
      plugins:[new webpack.NormalModuleReplacementPlugin(/opportunityActions$/,path.join(output,'actions.ts')),
        new webpack.NormalModuleReplacementPlugin(/cycleObjectiveActions$/,path.join(output,'objectives.ts'))]});
    compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  server=http.createServer((request,response)=>{
    const files={'/bundle.js':[path.join(output,'bundle.js'),'text/javascript'],
      '/app/globals.css':[path.join(root,'app/globals.css'),'text/css'],
      '/styles/tokens.css':[path.join(root,'styles/tokens.css'),'text/css'],
      '/styles/components.css':[path.join(root,'styles/components.css'),'text/css'],
      '/styles/invitations.css':[path.join(root,'styles/invitations.css'),'text/css']};
    const file=files[request.url];
    if(file){response.setHeader('Content-Type',file[1]);response.end(fs.readFileSync(file[0]));}
    else if(request.url==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/globals.css"><div id="root"></div><script src="/bundle.js"></script></html>');}
    else {response.statusCode=404;response.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/`;
  const {chromium}=require(process.env.OPPORTUNITY_PLAYWRIGHT_MODULE||'playwright');
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Synthetic UI:',error.message);});
  const save=()=>page.getByRole('button',{name:'Guardar',exact:true});
  const open=async()=>{await page.goto(url);await page.getByRole('button',{name:'Open',exact:true}).click();await page.getByRole('combobox',{name:'Contactos'}).waitFor();};
  const contact=async(name)=>{await page.getByRole('combobox',{name:'Contactos'}).fill(name);await page.getByRole('option',{name,exact:true}).click();};
  await open();await page.getByLabel('Título',{exact:true}).fill('Title only');
  assert.ok(await save().isEnabled());await save().click();await page.waitForFunction(()=>window.fixture.saves.length===1);
  assert.deepEqual(await page.evaluate(()=>window.fixture.saves[0].interactionIds),[]);
  console.log('PASS mounted title-only create');
  await open();await page.evaluate(()=>window.fixture.failReads=true);await contact('Alpha');
  await page.getByText('No pudimos cargar Interacciones. Reintenta abrir el editor.').waitFor();
  await page.getByRole('button',{name:/Priority/}).click();
  await page.getByLabel('Título',{exact:true}).fill('Contact only');assert.ok(await save().isEnabled());
  await save().click();await page.waitForFunction(()=>window.fixture.saves.length===1);
  assert.deepEqual(await page.evaluate(()=>window.fixture.saves[0].contactIds),['c1']);
  assert.deepEqual(await page.evaluate(()=>window.fixture.saves[0].interactionIds),[]);
  assert.deepEqual(await page.evaluate(()=>window.fixture.saves[0].objectiveIds),['p1']);
  console.log('PASS mounted contact-only create after interaction failure');
  await open();await page.getByLabel('Título',{exact:true}).fill('Selected interaction');await contact('Alpha');
  await page.getByRole('checkbox',{name:/Synthetic interaction/}).check();
  await page.evaluate(()=>window.fixture.failReads=true);await contact('Beta');
  await page.getByText('No pudimos cargar Interacciones. Reintenta abrir el editor.').waitFor();
  assert.ok(await save().isDisabled());assert.equal(await page.evaluate(()=>window.fixture.saves.length),0);
  console.log('PASS mounted selected interactions fail closed');
  const row={id:'o1',title:'Existing',stage:'identified',result:null,updated_at:'version',contact_ids:['c1'],objective_ids:['p1'],interaction_ids:['i1']};
  await page.goto(url);await page.getByRole('button',{name:'Open'}).waitFor();
  await page.evaluate(row=>{window.fixture.failReads=true;window.openOpportunity({opportunity:row});},row);
  await page.getByText('No pudimos cargar Interacciones. Reintenta abrir el editor.').waitFor();
  assert.ok(await save().isDisabled());await page.getByLabel('Título',{exact:true}).fill('Edited');assert.ok(await save().isDisabled());
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.evaluate(row=>{window.fixture.failReads=false;window.openOpportunity({opportunity:row});},row);
  await page.getByRole('checkbox',{name:/Synthetic interaction/}).waitFor();await save().click();
  await page.waitForFunction(()=>window.fixture.saves.length===1);
  assert.deepEqual(await page.evaluate(()=>window.fixture.saves[0].interactionIds),['i1']);
  assert.deepEqual(await page.evaluate(()=>window.fixture.saves[0].objectiveIds),['p1']);
  console.log('PASS mounted edit retains links across read failure/reopen');
  await page.goto(url);await page.getByRole('button',{name:'Open'}).waitFor();
  await page.evaluate(row=>window.openOpportunity({opportunity:row}),row);
  await page.getByRole('checkbox',{name:/Synthetic interaction/}).waitFor();
  await page.getByRole('button',{name:'Desvincular Alpha'}).click();
  let warned=false;page.once('dialog',async dialog=>{warned=true;await dialog.dismiss();});
  await save().click();assert.ok(warned);assert.equal(await page.evaluate(()=>window.fixture.saves.length),0);
  page.once('dialog',dialog=>dialog.accept());await save().click();await page.waitForFunction(()=>window.fixture.saves.length===1);
  assert.deepEqual(await page.evaluate(()=>window.fixture.saves[0].interactionIds),[]);
  console.log('PASS mounted removal requires explicit warning/confirmation');
  await open();await page.evaluate(()=>window.fixture.failFirstSave=true);await page.getByLabel('Título',{exact:true}).fill('Retry');
  await save().click();await page.getByText('No pudimos confirmar el guardado. Puedes reintentar sin duplicar la oportunidad.').waitFor();
  await save().click();await page.waitForFunction(()=>window.fixture.saves.length===2);
  const keys=await page.evaluate(()=>window.fixture.saves.map(s=>s.creationRequestId));assert.equal(keys[0],keys[1]);
  console.log('PASS mounted uncertain retry keeps request identity');
  await open();await page.evaluate(()=>window.fixture.holdReads=true);await contact('Alpha');
  await page.waitForFunction(()=>window.fixture.reads.length===1);await page.getByRole('button',{name:'Desvincular Alpha'}).click();await contact('Beta');
  await page.waitForFunction(()=>window.fixture.reads.length===2);
  await page.evaluate(()=>{window.fixture.reads[1].resolve([]);window.fixture.reads[0].resolve([{id:'late',subject:'Late forbidden',interaction_type:'manual'}]);});
  await page.getByText('Sin elementos disponibles',{exact:true}).waitFor();assert.equal(await page.getByText(/Late forbidden/).count(),0);
  console.log('PASS mounted late interaction response ignored');
  await open();await page.evaluate(()=>window.fixture.holdSave=true);await page.getByLabel('Título',{exact:true}).fill('Old request');await save().click();
  await page.waitForFunction(()=>window.fixture.pendingSaves.length===1);await page.evaluate(()=>window.openOpportunity({}));
  await page.getByLabel('Título',{exact:true}).fill('New request');await page.evaluate(()=>window.fixture.pendingSaves[0]());
  assert.equal(await page.getByLabel('Título',{exact:true}).inputValue(),'New request');assert.ok(await page.locator('dialog').isVisible());
  console.log('PASS mounted late save cannot close another editor');
  await page.evaluate(()=>window.openOpportunity({opportunity:{id:'finalized',title:'Closed',stage:'offer_received',situation:'finalized',result:'offer_accepted',result_note:'',contact_ids:[],objective_ids:[],interaction_ids:[]}}));
  await page.getByRole('heading',{name:'Editar oportunidad'}).waitFor();assert.ok(await save().isEnabled());
  assert.equal(await page.getByText('Oferta recibida',{exact:true}).count(),1);
  assert.equal(await page.getByRole('combobox',{name:/^Etapa/}).count(),0);
  await page.getByRole('combobox',{name:/^Resultado/}).selectOption('offer_declined');
  await page.getByLabel('Causa de cierre',{exact:false}).fill('Optional for every result');
  await page.setViewportSize({width:320,height:740});
  assert.equal(await page.locator('dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  assert.deepEqual(errors,[]);console.log('PASS mounted required result and 320px overflow');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  const target=path.resolve(output),parent=path.resolve(os.tmpdir());
  if(path.dirname(target)===parent&&path.basename(target).startsWith('coffeecito-opportunities-ui-'))fs.rmSync(target,{recursive:true,force:true});
});
