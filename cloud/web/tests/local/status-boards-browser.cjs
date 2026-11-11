// Mounted production boards with synthetic adapters. All non-loopback requests are blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'package.json'));
const { webpack } = req('next/dist/compiled/webpack/webpack');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'coffeecito-status-boards-'));
const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'coffeecito-status-board-screenshots-'));
const imp = file => JSON.stringify(path.join(root, file).replaceAll('\\', '/'));
const write = (name, source) => fs.writeFileSync(path.join(output, name), source);
let browser, server;
async function main() {
  write('loader.cjs', `const ts=require(${JSON.stringify(req.resolve('typescript'))});module.exports=src=>ts.transpileModule(src,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  const baseline = execFileSync('git', ['show', 'HEAD:cloud/web/components/ContactTable.tsx'], { cwd: root, encoding: 'utf8' });
  write('Baseline.tsx', baseline.replace(/from "(\.\.?\/[^"\n]+)"/g, (_, relative) => `from ${JSON.stringify(path.resolve(root, 'components', relative).replaceAll('\\', '/'))}`));
  write('contact-actions.ts', `
export const NETWORKING_STATUSES=['Pendiente','Contactado','Agendado','Cita concretada','Agradecimiento enviado'];
export async function updateContactNetworkingStatus(id,status){window.fixture.contactSaves.push([id,status]);window.fixture.contacts=window.fixture.contacts.map(c=>c.id===id?{...c,networking_status:status}:c);}
export const deactivateContacts=async()=>{throw Error('outside scope')};export const updateContactFlags=deactivateContacts;
`);
  write('stubs.tsx', `import React from 'react';
export const ContactEditorDialog=()=>null;export const ContactFilterControls=()=>null;
export const ContactDeactivationButton=()=>null;export const ContactDeactivationConfirmDialog=()=>null;
export const triggerCoachRuleReviewForContacts=async()=>{};export const readHeadhunterCompanyMaster=async()=>[];
export const OBJECTIVE_TYPES=[];export const OBJECTIVE_PRIORITIES=[{value:'HIGH',label:'Alta'},{value:'MEDIUM',label:'Media'},{value:'LOW',label:'Baja'}];export const objectiveTypeLabel=x=>x;export const objectivePriorityLabel=x=>x;
export async function readObjectives(){const f=window.fixture;f.priorityReads++;if(f.holdPriorities)await new Promise(resolve=>f.priorityResolvers.push(resolve));if(f.failPriorities)throw Error('synthetic priorities');return structuredClone(f.priorities);}
export async function saveObjective(input){const f=window.fixture;f.prioritySaves++;f.priorities=f.priorities.map(row=>row.id===input.objectiveId?{...row,objective_name:input.objectiveName}:row);}
export const deleteObjective=async()=>{throw Error('outside scope')};export const readContactIdsForObjective=async()=>[];
export const setObjectiveContactAssignments=async()=>{};export const readAllActiveContacts=async()=>[];
export const addObjectiveAssignmentsToContacts=async()=>{throw Error('outside scope')};
export default function Link({children,href,...props}){return <a href={href} {...props}>{children}</a>}
`);
  write('cycles.ts', `
export async function readNetworkingCycles(){const f=window.fixture;f.cycleReads++;if(f.holdCycles)await new Promise(resolve=>f.cycleResolvers.push(resolve));if(f.failCycles)throw Error('synthetic cycle');return structuredClone(f.cycles);}
export const expectedNetworkingContext=async()=>({token:window.fixture.staleCycle?'stale':'synthetic',cycleId:'cycle'});
export const networkingContextFromCycles=()=>({token:'synthetic',cycleId:'cycle'});
export const localDateTimeValue=()=> '2026-10-29T12:00';
export const startNetworkingCycle=async()=>{throw Error('outside scope')};export const closeNetworkingCycle=startNetworkingCycle;export const adoptConfirmedOwnClose=()=>{};
export async function readMyNetworkingPlanNotices(){const f=window.fixture;f.noticeReads++;if(f.holdNotices)await new Promise(resolve=>f.noticeResolvers.push(resolve));if(f.failNotices)throw Error('synthetic notices');return new Set();}
export const requestNetworkingPlanNotice=startNetworkingCycle;export const withdrawNetworkingPlanNotice=startNetworkingCycle;
export const readHistoryPolicy=async()=>({max_months:6,revision:1,earliest_start:'2026-04-29T00:00:00Z',as_of:'2026-10-29T12:00:00Z'});
`);
  write('actions.ts', `
export async function readOpportunities(){const f=window.fixture;f.opportunityReads++;if(f.failRead)throw Error('synthetic read');if(f.holdRead)await new Promise(resolve=>f.readResolvers.push(resolve));return structuredClone(f.rows);}
export async function saveOpportunity(input){const f=window.fixture;f.saves.push(structuredClone(input));if(f.holdSave)await new Promise(resolve=>f.saveResolvers.push(resolve));if(f.failSave)throw Error('synthetic rejection');const row=f.rows.find(r=>r.id===input.id);if(row.updated_at!==input.expectedUpdatedAt)throw Error('stale version');Object.assign(row,{stage:input.stage,situation:input.situation,result:input.result,result_note:input.resultNote,updated_at:String(++f.version)});return row.id;}
export const readOpportunityChoices=async()=>({contacts:{status:'fulfilled',value:[]},objectives:{status:'fulfilled',value:[]}});
export const readEligibleOpportunityInteractions=async()=>[];
export const voidOpportunity=async()=>{throw Error('outside scope')};
`);
  write('entry.tsx', `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ContactTable} from ${imp('components/ContactTable.tsx')};import {ContactTable as Baseline} from './Baseline';
import {OpportunityBoard} from ${imp('components/OpportunityBoard.tsx')};
import {ObjectivesPage} from ${imp('components/ObjectivesPage.tsx')};
import {OpportunityWorkspace} from ${imp('components/OpportunityWorkspace.tsx')};
const row=(id,title,stage='identified')=>({id,title,stage,situation:'active',result:null,updated_at:'0',contact_ids:[],objective_ids:[],interaction_ids:[]});
const contact=(id,display_name,hh=false)=>({id,display_name,company:hh?'Synthetic HH':'Synthetic',role:'Role',networking_status:'Pendiente',networking_focus:true,is_headhunter:hh,contact_emails:[],contact_phones:[],headhunter_domains:[],contact_objective_assignments:[],objectives:[],hashtags:[],last_interaction_at:null,days_since_last_interaction:null});
const delay=new URLSearchParams(location.search).has('delay');
window.fixture={rows:[row('o1','Alpha opportunity'),row('o2','Beta opportunity','applied')],contacts:[contact('c1','Alpha contact'),contact('c2','Beta contact',true),contact('c3','Gamma contact',true)],saves:[],contactSaves:[],version:0,readResolvers:[],saveResolvers:[],failRead:false,holdRead:delay,holdSave:false,failSave:false,
priorities:[{id:'p1',objective_name:'Synthetic priority',objective_type:'COMPANY',priority_level:'HIGH',is_active:true}],priorityReads:0,prioritySaves:0,priorityResolvers:[],holdPriorities:delay,failPriorities:false,
cycles:[{id:'cycle',objective_type:'JOB_SEARCH',status:'active',started_at:'2026-10-01T12:00:00Z',timezone_name:'UTC',cycle_name:'Synthetic cycle'}],cycleReads:0,cycleResolvers:[],holdCycles:delay,failCycles:false,
noticeReads:0,noticeResolvers:[],holdNotices:delay,failNotices:false,opportunityReads:0};
function App(){const [revision,setRevision]=useState(0);const [show,setShow]=useState(true);const [contacts,setContacts]=useState(window.fixture.contacts);window.setContacts=setContacts;window.reloadBoard=()=>setRevision(r=>r+1);window.hideBoard=()=>setShow(false);window.showBoard=()=>setShow(true);
const mode=new URLSearchParams(location.search).get('mode');const Table=mode==='baseline'?Baseline:ContactTable;
return <main className={"app-shell "+(["states","contact-list","workspace"].includes(mode)?"structural-view":"")}>{mode==='objectives'||mode==='onboarding'||mode==='priorities'?<ObjectivesPage showOpportunities={mode!=='priorities'} onboardingCoach={mode==='onboarding'?<p>Coach fixture</p>:undefined}/>:mode==='contacts'||mode==='baseline'||mode==='states'||mode==='contact-list'?<Table view={mode==='states'?'states':mode==='contact-list'?'contacts':'all'} contacts={contacts} onReload={()=>setContacts([...window.fixture.contacts])}/>:show?(mode==='workspace'?<OpportunityWorkspace/>:<OpportunityBoard revision={revision}/>):null}</main>}
createRoot(document.getElementById('root')).render(<App/>);
`);
  await new Promise((resolve, reject) => {
    const compiler = webpack({mode:'development',devtool:false,context:root,entry:path.join(output,'entry.tsx'),
      output:{path:output,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js','.json'],modules:[path.join(root,'node_modules'),'node_modules']},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[path.join(output,'loader.cjs')]}]},
      plugins:[new webpack.NormalModuleReplacementPlugin(/opportunityActions$/,path.join(output,'actions.ts')),
        new webpack.NormalModuleReplacementPlugin(/contactActions$/,path.join(output,'contact-actions.ts')),
        new webpack.NormalModuleReplacementPlugin(/(cycleObjectiveActions|cloudData|coachRuleTriggers|headhunterCompanyActions|ContactEditorDialog|ContactDeactivationButton|ContactDeactivationConfirmDialog|next\/link)$/,path.join(output,'stubs.tsx')),
        new webpack.NormalModuleReplacementPlugin(/(networkingCycles|networkingPlanNotice|historyPolicy)(\.ts)?$/,path.join(output,'cycles.ts')),
        new webpack.NormalModuleReplacementPlugin(/supabaseClient(\.ts)?$/,()=>{throw Error('Real transport forbidden in mounted fixture');})]});
    compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  server=http.createServer((request,response)=>{
    const pathname=new URL(request.url,'http://localhost').pathname;
    const files={'/bundle.js':[path.join(output,'bundle.js'),'text/javascript'],'/app/globals.css':[path.join(root,'app/globals.css'),'text/css'],
      '/styles/tokens.css':[path.join(root,'styles/tokens.css'),'text/css'],'/styles/components.css':[path.join(root,'styles/components.css'),'text/css'],'/styles/invitations.css':[path.join(root,'styles/invitations.css'),'text/css'],'/styles/tracking.css':[path.join(root,'styles/tracking.css'),'text/css']};
    if(files[pathname]){response.setHeader('Content-Type',files[pathname][1]);response.end(fs.readFileSync(files[pathname][0]));}
    else if(pathname==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/globals.css"><div id="root"></div><script src="/bundle.js"></script></html>');}
    else{response.statusCode=404;response.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/`;
  const {chromium}=require(process.env.OPPORTUNITY_PLAYWRIGHT_MODULE||'playwright');
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const external=[];
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(url).origin)return route.continue();external.push(route.request().url().split(':')[0]);return route.abort();});
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const ready=async(mode='')=>{await page.goto(url+mode);await page.locator('.contacts-status-card').first().waitFor();};
  const menu=()=>page.getByRole('button',{name:'Mover Alpha opportunity a otra etapa'});
  const stageLabel={identified:'Identificadas',applied:'Postuladas',in_process:'En proceso',offer_received:'Oferta recibida'};
  const moveTo=async(stage)=>{await menu().click();await page.getByRole('dialog',{name:'Mover a otra etapa'}).getByRole('button',{name:stageLabel[stage],exact:true}).click();};
  const status=()=>page.locator('.contacts-status-board [data-board-card="o1"]').evaluate(el=>el.closest('[data-board-status]').getAttribute('data-board-status'));
  const layout=()=>page.locator('.contacts-status-board').evaluate(el=>({y:el.getBoundingClientRect().y,height:el.getBoundingClientRect().height}));
  async function drop(cardSelector,columnSelector){const transfer=await page.evaluateHandle(()=>new DataTransfer());await page.locator(cardSelector).dispatchEvent('dragstart',{dataTransfer:transfer});await page.locator(columnSelector).dispatchEvent('dragover',{dataTransfer:transfer});await page.locator(columnSelector).dispatchEvent('drop',{dataTransfer:transfer});await transfer.dispose();}
  if(!process.env.UI_STRUCT_ONLY){
  await ready();
  assert.deepEqual(await page.locator('.opportunity-column').evaluateAll(columns=>columns.map(column=>getComputedStyle(column).backgroundColor)),
    ['rgb(242, 244, 247)','rgb(240, 246, 250)','rgb(244, 240, 248)','rgb(237, 247, 240)']);
  assert.equal(await page.locator('[data-board-card="o1"] select').count(),0);
  assert.equal(await page.locator('[data-board-card="o1"] .opportunity-counts .icon').count(),1);
  assert.ok(await page.getByRole('button',{name:'Finalizar Alpha opportunity'}).evaluate(button=>parseFloat(getComputedStyle(button).borderRadius)>10));
  await page.setViewportSize({width:320,height:740});
  await page.getByRole('button',{name:'Finalizar Alpha opportunity'}).click();
  await page.getByRole('dialog',{name:'Finalizar oportunidad'}).waitFor();
  await page.screenshot({path:path.join(shots,'opportunities-finalize-320.png')});
  assert.equal(await page.locator('.opportunity-action-popover').evaluate(el=>{
    const rect=el.getBoundingClientRect();return rect.left<0||rect.right>innerWidth||rect.bottom>innerHeight;
  }),false);
  assert.equal(await page.locator('.opportunity-editor-dialog[open]').count(),0);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog',{name:'Finalizar oportunidad'}).count(),0);
  assert.ok(await page.getByRole('button',{name:'Finalizar Alpha opportunity'}).evaluate(el=>el===document.activeElement));
  await page.setViewportSize({width:1280,height:900});
  const clockStart=Date.now();await page.clock.install({time:clockStart});await page.clock.pauseAt(clockStart+1000);const initial=await layout();
  await moveTo('applied');assert.equal(await status(),'applied');assert.equal(await page.evaluate(()=>window.fixture.saves.length),0);
  await page.getByText('Cambio pendiente de guardado.').waitFor();assert.deepEqual(await layout(),initial);
  await page.clock.fastForward(1000);await moveTo('in_process');await page.clock.fastForward(1599);assert.equal(await page.evaluate(()=>window.fixture.saves.length),0);
  await page.clock.fastForward(1);await page.getByText('Estados guardados.').waitFor();assert.equal(await page.evaluate(()=>window.fixture.saves.length),1);
  assert.equal(await page.evaluate(()=>window.fixture.saves[0].stage),'in_process');assert.deepEqual(await layout(),initial);
  assert.equal(await page.evaluate(()=>window.fixture.opportunityReads),2);
  await page.clock.fastForward(1799);assert.ok(await page.getByText('Estados guardados.',{exact:true}).isVisible());
  await page.clock.fastForward(1);assert.equal(await page.getByText('Estados guardados.',{exact:true}).count(),0);assert.deepEqual(await layout(),initial);
  console.log('PASS opportunity optimistic moves, shared 1600ms debounce/coalescing, stable layout and confirmed version');
  await moveTo('identified');await moveTo('in_process');await page.clock.fastForward(2000);assert.equal(await page.evaluate(()=>window.fixture.saves.length),1);
  await page.evaluate(()=>window.fixture.failSave=true);await moveTo('applied');await page.clock.fastForward(1600);
  await page.getByText('Algunos estados no se pudieron guardar.').waitFor();assert.equal(await status(),'in_process');
  await page.clock.fastForward(5000);assert.ok(await page.getByText('Algunos estados no se pudieron guardar.').isVisible());
  await page.evaluate(()=>{window.fixture.failSave=false;window.fixture.holdSave=true;});await moveTo('offer_received');await page.clock.fastForward(1600);
  await page.waitForFunction(()=>window.fixture.saveResolvers.length===1);assert.ok(await menu().isEnabled());
  const inFlightCount=await page.evaluate(()=>window.fixture.saves.length);
  await moveTo('in_process');await page.clock.fastForward(2000);
  assert.equal(await page.evaluate(()=>window.fixture.saves.length),inFlightCount);
  await page.evaluate(()=>{window.fixture.holdSave=false;window.fixture.saveResolvers.shift()();});
  await page.waitForFunction(()=>!document.querySelector('[data-board-card="o1"]').classList.contains('saving'));
  assert.equal(await status(),'in_process');await page.clock.fastForward(1600);await page.getByText('Estados guardados.').waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.saves.length),inFlightCount+1);
  assert.equal(await page.evaluate(()=>window.fixture.rows[0].stage),'in_process');
  assert.equal(await page.evaluate(()=>window.fixture.saves.at(-1).expectedUpdatedAt),await page.evaluate(()=>String(window.fixture.version-1)));
  console.log('PASS pending cancellation, rejection rollback and a newer move during saving retained with the confirmed version');
  await page.evaluate(()=>window.fixture.holdSave=false);await page.getByRole('button',{name:'Finalizar Alpha opportunity',exact:true}).click();
  await page.getByRole('dialog',{name:'Finalizar oportunidad'}).waitFor();assert.ok(await page.getByRole('button',{name:'Confirmar',exact:true}).isDisabled());
  assert.equal(await page.locator('.opportunity-action-popover input').count(),0);
  assert.deepEqual(await page.getByRole('combobox',{name:/^Resultado/}).locator('option').allTextContents(),['Seleccionar resultado','No seleccionado','Proceso retirado por mí','Vacante cancelada','Sin respuesta','Otro']);
  await page.getByRole('combobox',{name:/^Resultado/}).selectOption('not_selected');
  await page.getByLabel('Causa de cierre',{exact:false}).fill('Synthetic cause');
  await page.getByRole('button',{name:'Confirmar',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-board-card="o1"]'));
  await page.getByRole('button',{name:'Finalizadas',exact:true}).click();
  await page.locator('.opportunity-result').getByText('No seleccionado',{exact:true}).waitFor();
  assert.equal(await status(),'in_process');assert.equal(await menu().count(),0);
  assert.equal(await page.locator('[data-board-card="o1"]').getAttribute('draggable'),'false');
  await page.getByRole('button',{name:'Todas',exact:true}).click();assert.equal(await page.locator('.contacts-status-card').count(),2);
  await page.evaluate(()=>window.fixture.holdSave=true);await page.getByRole('button',{name:'Restaurar Alpha opportunity',exact:true}).click();
  await page.waitForFunction(()=>window.fixture.saveResolvers.length===1);
  assert.ok(await page.locator('.opportunity-result').getByText('No seleccionado',{exact:true}).isVisible());
  await page.evaluate(()=>{window.fixture.holdSave=false;window.fixture.saveResolvers.shift()();});await page.getByText('Estados guardados.').waitFor();
  assert.equal(await status(),'in_process');assert.equal(await page.evaluate(()=>window.fixture.rows[0].result_note),'');
  assert.equal(await page.evaluate(()=>window.fixture.rows[0].result),null);assert.equal(await page.locator('.opportunity-result').count(),0);
  await page.getByRole('button',{name:'Activas',exact:true}).click();
  await moveTo('identified');await page.clock.fastForward(1600);await page.getByText('Estados guardados.').waitFor();
  assert.equal(await page.locator('[data-board-status]').count(),4);
  console.log('PASS four columns, scoped closure/results/cause, Active/Finalized/All filters and confirmed same-stage reopening');
  const transfer=await page.evaluateHandle(()=>new DataTransfer());await page.locator('[data-board-card="o1"]').dispatchEvent('dragstart',{dataTransfer:transfer});
  const target=page.locator('[data-board-card="o2"]');const rect=await target.boundingBox();await target.dispatchEvent('dragover',{dataTransfer:transfer,clientY:rect.y+1});
  assert.equal(await page.locator('.contacts-status-drop-line').count(),1);await page.screenshot({path:path.join(shots,'opportunities-desktop-drop.png')});
  await page.locator('[data-board-status="applied"]').dispatchEvent('drop',{dataTransfer:transfer});await transfer.dispose();assert.equal(await status(),'applied');
  await page.clock.fastForward(1600);await page.getByText('Estados guardados.').waitFor();
  assert.ok(await page.getByText('Suelta una tarjeta acá').count()>0);console.log('PASS shared drag image, insertion line, drop and empty placeholder');
  await page.evaluate(()=>{window.fixture.holdRead=true;window.reloadBoard();});await page.waitForFunction(()=>window.fixture.readResolvers.length>0);
  assert.deepEqual(await layout(),initial);assert.equal(await page.locator('[data-board-card="o1"]').count(),1);
  await page.evaluate(()=>{window.fixture.holdRead=false;window.fixture.readResolvers.splice(0).forEach(resolve=>resolve());});
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Mover Alpha opportunity a otra etapa"]').disabled);
  await page.evaluate(()=>{window.fixture.failRead=true;window.reloadBoard();});await page.getByRole('button',{name:'Reintentar lectura de oportunidades'}).waitFor();
  assert.equal(await page.locator('[data-board-card="o1"]').count(),1);assert.deepEqual(await layout(),initial);assert.ok(await menu().isDisabled());
  await page.evaluate(()=>window.fixture.failRead=false);await page.getByRole('button',{name:'Reintentar lectura de oportunidades'}).click();await page.waitForFunction(()=>!document.querySelector('[aria-label="Mover Alpha opportunity a otra etapa"]').disabled);
  console.log('PASS refresh/error preserves board geometry and rows, failed read blocks stale writes, retry recovers');
  await ready();await page.evaluate(()=>window.fixture.holdSave=true);await moveTo('applied');await page.clock.fastForward(1600);
  await page.waitForFunction(()=>window.fixture.saveResolvers.length===1);
  await page.evaluate(()=>{window.fixture.rows=window.fixture.rows.filter(row=>row.id!=='o1');window.reloadBoard();});
  await page.waitForFunction(()=>!document.querySelector('[data-board-card="o1"]'));
  await page.evaluate(()=>window.fixture.saveResolvers.shift()());await page.clock.fastForward(2000);
  assert.equal(await page.locator('[data-board-card="o1"]').count(),0);
  assert.equal(await page.getByText('Estados guardados.',{exact:true}).count(),0);
  console.log('PASS late batch completion cannot restore a row or success message after context revision');
  await ready();
  await page.locator('[data-board-card="o1"]').dragTo(page.locator('[data-board-status="applied"]'));
  await page.getByText('Cambio pendiente de guardado.').waitFor();assert.equal(await status(),'applied');await page.clock.fastForward(1600);
  await page.getByText('Estados guardados.').waitFor();
  await menu().focus();await page.keyboard.press('Enter');
  await page.getByRole('dialog',{name:'Mover a otra etapa'}).getByRole('button',{name:'En proceso'}).focus();await page.keyboard.press('Enter');
  assert.equal(await status(),'in_process');await page.clock.fastForward(1600);await page.getByText('Estados guardados.').waitFor();
  console.log('PASS real pointer drag and native keyboard stage menu');
  await moveTo('applied');await page.clock.fastForward(1000);
  assert.ok(await page.getByText('Cambio pendiente de guardado.').isVisible());
  await page.evaluate(()=>{window.fixture.holdRead=true;window.stableCard=document.querySelector('[data-board-card="o2"]');window.stableCardColor=getComputedStyle(window.stableCard.querySelector('button')).color;});
  await page.clock.fastForward(600);await page.waitForFunction(()=>window.fixture.readResolvers.length===1);
  assert.equal(await page.getByText('Leyendo oportunidades...', {exact:true}).count(),0);
  assert.ok(await page.evaluate(()=>window.stableCard.isConnected));
  assert.equal(await page.getByRole('button',{name:'Editar Beta opportunity'}).evaluate(el=>el.disabled),false);
  assert.ok(await page.evaluate(()=>getComputedStyle(window.stableCard.querySelector('button')).color===window.stableCardColor));
  assert.ok(await menu().isEnabled());assert.equal(await page.getByText('Estados guardados.',{exact:true}).count(),0);
  await page.evaluate(()=>{window.fixture.holdRead=false;window.fixture.readResolvers.shift()();});await page.getByText('Estados guardados.').waitFor();
  await page.clock.fastForward(500);await moveTo('identified');await page.clock.fastForward(1300);
  assert.ok(await page.getByText('Cambio pendiente de guardado.').isVisible());
  await page.clock.fastForward(300);await page.getByText('Estados guardados.').waitFor();
  await page.evaluate(()=>window.hideBoard());await page.clock.fastForward(2000);await page.evaluate(()=>window.showBoard());await menu().waitFor();
  assert.equal(await page.getByText('Estados guardados.',{exact:true}).count(),0);
  console.log('PASS 1800ms success expiry, persistent errors, timer replacement/unmount and silent reconciliation without gray cards');
  await page.evaluate(()=>window.fixture.failRead=true);await moveTo('applied');await page.clock.fastForward(1600);
  await page.getByRole('button',{name:'Reintentar lectura de oportunidades'}).waitFor();
  assert.equal(await status(),'applied');assert.equal(await page.evaluate(()=>window.fixture.rows[0].stage),'applied');
  assert.equal(await page.getByText('Estados guardados.',{exact:true}).count(),0);assert.ok(await menu().isDisabled());
  const confirmedSaves=await page.evaluate(()=>window.fixture.saves.length);
  await page.evaluate(()=>window.fixture.failRead=false);await page.getByRole('button',{name:'Reintentar lectura de oportunidades'}).click();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Mover Alpha opportunity a otra etapa"]').disabled);
  assert.equal(await status(),'applied');assert.equal(await page.evaluate(()=>window.fixture.saves.length),confirmedSaves);
  assert.equal(await page.locator('.contacts-status-card.pending,.contacts-status-card.saving').count(),0);
  console.log('PASS failed post-write read retains optimistic data without false success; read retry reconciles without another write');
  for(const width of [1280,320]){
    await page.setViewportSize({width,height:900});await ready();await page.screenshot({path:path.join(shots,`opportunities-${width}.png`)});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const scroll=page.locator('.opportunity-board');if(width===320)assert.ok(await scroll.evaluate(el=>el.scrollWidth>el.clientWidth));
    const snapshots=[];
    for(const mode of ['baseline','contacts']){
      await ready(`?mode=${mode}`);await page.screenshot({path:path.join(shots,`${mode}-${width}.png`)});
      snapshots.push(await page.locator('.contacts-status-board').evaluate(el=>Array.from(el.querySelectorAll('.contacts-status-column,.contacts-status-card,.contacts-status-scroll')).map(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return {text:node.textContent,x:r.x,y:r.y,w:r.width,h:r.height,font:s.fontSize,family:s.fontFamily,color:s.color,bg:s.background,padding:s.padding,gap:s.gap};})));
    }
    assert.deepEqual(snapshots[1],snapshots[0]);
  }
  console.log('PASS Contactos HEAD/current exact geometry, text and computed styles at desktop/320px; opportunities own palette and contained scroll');
  await page.setViewportSize({width:1280,height:900});await ready('?mode=contacts');
  await drop('[data-board-card="c1"]','[data-board-status="Contactado"]');await page.getByText('Cambio pendiente de guardado.').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.fixture.contactSaves),[]);await page.clock.fastForward(1600);await page.getByText('Estados guardados.').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.fixture.contactSaves),[['c1','Contactado']]);
  await page.getByRole('button',{name:'Agrupar Headhunters',exact:true}).click();await page.getByRole('button',{name:'Agrupar',exact:true}).click();
  await drop('[data-board-card="hh:company:synthetic hh"]','[data-board-status="Agendado"]');await page.clock.fastForward(1600);await page.getByText('Estados guardados.').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.fixture.contactSaves.slice(1)),[['c2','Agendado'],['c3','Agendado']]);
  console.log('PASS mounted Contactos individual/grouped optimistic save and existing bulk membership');
  const release=async(name)=>page.evaluate(name=>{const f=window.fixture;const config={cycles:['holdCycles','cycleResolvers'],priorities:['holdPriorities','priorityResolvers'],opportunities:['holdRead','readResolvers']}[name];f[config[0]]=false;f[config[1]].splice(0).forEach(resolve=>resolve());},name);
  await page.goto(url+'?mode=objectives&delay');
  await page.getByText('Leyendo objetivos...', {exact:true}).waitFor();
  await page.waitForFunction(()=>window.fixture.cycleResolvers.length&&window.fixture.priorityResolvers.length&&window.fixture.readResolvers.length);
  assert.equal(await page.locator('#my-cycle-title').isVisible(),false);
  await release('cycles');await page.clock.fastForward(1000);assert.equal(await page.locator('#my-cycle-title').isVisible(),false);
  await release('priorities');await page.clock.fastForward(1000);assert.equal(await page.getByText('Synthetic priority',{exact:true}).isVisible(),false);
  await release('opportunities');await page.getByRole('heading',{name:'Mi objetivo',exact:true}).waitFor();
  assert.ok(await page.getByText('Synthetic priority',{exact:true}).isVisible());assert.ok(await menu().isVisible());
  assert.equal(await page.getByText('Leyendo objetivos...', {exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.fixture.noticeResolvers.length),1);
  assert.deepEqual(await page.evaluate(()=>[window.fixture.cycleReads,window.fixture.priorityReads,window.fixture.opportunityReads,window.fixture.noticeReads]),[1,1,1,1]);
  console.log('PASS unified initial Objectives presentation; three critical reads concurrent, optional notices do not block');
  await page.getByRole('button',{name:'Synthetic priority, mostrar acciones'}).click();await page.getByRole('button',{name:'Editar Synthetic priority',exact:true}).click();
  await page.getByRole('textbox',{name:'Nombre',exact:true}).fill('Updated priority');
  await page.evaluate(()=>{window.fixture.holdPriorities=true;window.priorityNode=document.querySelector('.objective-row');window.opportunityNode=document.querySelector('[data-board-card="o1"]');});
  await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await page.waitForFunction(()=>window.fixture.priorityResolvers.length===1);
  assert.equal(await page.getByText('Leyendo prioridades...', {exact:true}).count(),0);assert.equal(await page.getByText('Leyendo objetivos...', {exact:true}).count(),0);
  assert.ok(await page.evaluate(()=>window.priorityNode.isConnected&&window.opportunityNode.isConnected));
  await release('priorities');await page.getByText('Prioridad guardada.',{exact:true}).waitFor();
  assert.ok(await page.getByText('Updated priority',{exact:true}).isVisible());
  const priorityTop=await page.locator('.objectives-column-grid').evaluate(el=>el.getBoundingClientRect().top);
  await page.clock.fastForward(1800);assert.equal(await page.getByText('Prioridad guardada.',{exact:true}).count(),0);
  assert.equal(await page.locator('.objectives-column-grid').evaluate(el=>el.getBoundingClientRect().top),priorityTop);
  assert.equal(await page.evaluate(()=>window.fixture.opportunityReads),1);
  await page.getByRole('button',{name:'Editar Updated priority',exact:true}).click();await page.getByRole('textbox',{name:'Nombre',exact:true}).fill('Recovered priority');
  await page.evaluate(()=>window.fixture.failPriorities=true);await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();
  await page.getByRole('button',{name:'Reintentar lectura de Prioridades'}).waitFor();
  assert.ok(await page.getByText('Updated priority',{exact:true}).isVisible());
  assert.ok(await page.evaluate(()=>window.priorityNode.isConnected&&window.opportunityNode.isConnected));
  await page.clock.fastForward(5000);assert.ok(await page.getByText('No pudimos leer Prioridades. Intenta nuevamente.',{exact:true}).isVisible());
  await page.evaluate(()=>window.fixture.failPriorities=false);await page.getByRole('button',{name:'Reintentar lectura de Prioridades'}).click();
  await page.getByText('Recovered priority',{exact:true}).waitFor();
  console.log('PASS priority refresh preserves both modules/nodes, success expires, read failure retains data and retry recovers');
  await page.screenshot({path:path.join(shots,'objectives-1280.png')});await page.setViewportSize({width:320,height:900});
  await page.screenshot({path:path.join(shots,'objectives-320.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.goto(url+'?mode=objectives&delay');await page.getByText('Leyendo objetivos...', {exact:true}).waitFor();
  await page.waitForFunction(()=>window.fixture.priorityResolvers.length&&window.fixture.readResolvers.length&&window.fixture.cycleResolvers.length);
  await page.evaluate(()=>window.fixture.failPriorities=true);await release('opportunities');await release('priorities');await release('cycles');
  await page.getByRole('button',{name:'Reintentar lectura de Prioridades'}).waitFor();
  assert.equal(await page.getByText('sin prioridades',{exact:true}).count(),0);assert.ok(await menu().isVisible());
  console.log('PASS 320px initial/refresh layout and initial failed source never becomes a valid empty list');
  await page.goto(url+'?mode=onboarding&delay');await page.getByText('Leyendo objetivos...', {exact:true}).waitFor();
  await page.waitForFunction(()=>window.fixture.cycleResolvers.length&&window.fixture.priorityResolvers.length);
  await release('cycles');await release('priorities');await page.getByText('Coach fixture',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.opportunityReads),0);assert.equal(await page.locator('.opportunities-section').count(),0);
  console.log('PASS onboarding waits for its own critical sources without mounting/fetching opportunities');
  }
  await page.goto(url+'?mode=contact-list');
  await page.getByRole('heading',{name:'Empresas',exact:true}).waitFor();
  await page.evaluate(()=>{
    const base=window.fixture.contacts[0];
    window.fixture.contacts.push({...base,id:'c4',display_name:'No company A',company:''},
      {...base,id:'c5',display_name:'No company B',company:'sin empresa'},
      {...base,id:'c6',display_name:'Case variant',company:'synthetic'},
      {...base,id:'c7',display_name:'Trimmed company',company:' Synthetic '},
      {...base,id:'c8',display_name:'Outside focus',company:'Other',networking_focus:false});
    window.setContacts([...window.fixture.contacts]);
  });
  const companyRow=name=>page.locator('.companies-table tbody tr').filter({has:page.getByRole('checkbox',{name:'Filtrar contactos de '+name,exact:true})});
  await companyRow('Sin empresa').waitFor();
  assert.equal(await companyRow('Synthetic').locator('td').nth(2).innerText(),'2');
  assert.equal(await companyRow('Sin empresa').locator('td').nth(2).innerText(),'2');
  assert.equal(await companyRow('synthetic').locator('td').nth(2).innerText(),'1','exact names stay separate');
  assert.equal(await companyRow('Other').count(),0,'company counts respect focus');
  await page.getByRole('checkbox',{name:'Seleccionar Alpha contact',exact:true}).check();
  await page.getByRole('checkbox',{name:'Filtrar contactos de Synthetic HH',exact:true}).check();
  assert.equal(await page.locator('.contacts-table tbody tr').count(),2);
  assert.match(await page.locator('.contacts-selection-summary').innerText(),/1 seleccionados/);
  assert.equal(await page.locator('.companies-table tbody tr').count(),4,'selection does not shrink available companies');
  await page.getByRole('checkbox',{name:'Filtrar contactos de Sin empresa',exact:true}).check();
  assert.equal(await page.locator('.contacts-table tbody tr').count(),4,'selected companies are OR within contact filters');
  await page.getByRole('textbox',{name:'Buscador universal'}).fill('Alpha');
  await page.locator('.contacts-empty-state').waitFor();
  assert.equal(await companyRow('Synthetic').locator('td').nth(2).innerText(),'1','counts follow search before company selection');
  await page.getByRole('button',{name:'Limpiar selección de empresas',exact:true}).click();
  assert.equal(await page.getByRole('checkbox',{name:'Seleccionar Alpha contact',exact:true}).isChecked(),true);
  await page.getByRole('textbox',{name:'Buscador universal'}).fill('');
  await page.getByRole('button',{name:'Contactos',exact:true}).click();
  assert.equal(await page.locator('.companies-table tbody tr').first().locator('td').nth(2).innerText(),'1');
  await page.getByRole('button',{name:'Contactos',exact:true}).click();
  assert.equal(await page.locator('.companies-table tbody tr').first().locator('td').nth(2).innerText(),'2');
  await page.getByRole('button',{name:'Empresa',exact:true}).click();
  assert.equal((await page.locator('.companies-table th[aria-sort="ascending"]').textContent()).trim(),'Empresa');
  assert.deepEqual(await page.evaluate(()=>window.fixture.contactSaves),[],'company filters never mutate contacts');
  console.log('PASS BF-11: exact/trimmed/missing company, counts, focus/search intersection, OR selection, sorting, bulk selection retained and no writes');
  await page.evaluate(()=>{
    const statuses={c1:'Pendiente',c2:'Contactado',c3:'Agendado',c4:'invalid',c5:'',c6:'Agradecimiento enviado',c7:'Cita concretada',c8:'Agradecimiento enviado'};
    const dates={c1:['2026-10-01T12:00:00Z',40],c2:['2026-11-03T12:00:00Z',7],c3:['2026-11-10T12:00:00Z',0],c6:['2026-09-10T12:00:00Z',61],c7:['2026-11-09T09:00:00-03:00',1],c8:['2026-11-10T12:00:00Z',0]};
    window.fixture.contacts=window.fixture.contacts.map(c=>({...c,networking_status:statuses[c.id],company:c.id==='c8'?'Synthetic':c.company,last_interaction_at:dates[c.id]?.[0]??null,days_since_last_interaction:dates[c.id]?.[1]??null}));
    window.setContacts([...window.fixture.contacts]);
    window.contactsBeforeCompanyFilters=JSON.stringify(window.fixture.contacts);
  });
  const companyState=name=>companyRow(name).locator('.status');
  const companyAge=name=>companyRow(name).locator('td').nth(4);
  await page.getByRole('button',{name:'Estado más avanzado',exact:true}).waitFor();
  assert.equal(await companyState('Synthetic').innerText(),'Cita concretada');
  assert.equal(await companyState('Synthetic').getAttribute('class'),'status cita');
  assert.equal(await companyState('Synthetic HH').innerText(),'Agendado');
  assert.equal(await companyState('Sin empresa').innerText(),'sin estado','invalid values never become Pendiente');
  assert.equal(await companyState('synthetic').innerText(),'Agradecimiento enviado');
  assert.equal(await companyAge('Synthetic').innerText(),'1d');
  assert.equal(await companyAge('Synthetic HH').innerText(),'Hoy');
  assert.equal(await companyAge('Sin empresa').innerText(),'sin interacciones');
  assert.equal(await companyAge('Sin empresa').locator('.empty-value').count(),1);
  assert.equal(await companyAge('synthetic').innerText(),'2m 1d');
  await page.getByRole('textbox',{name:'Buscador universal'}).fill('Alpha');
  assert.equal(await companyState('Synthetic').innerText(),'Pendiente','state and count use the same search subset');
  assert.equal(await companyRow('Synthetic').locator('td').nth(2).innerText(),'1');
  assert.equal(await companyAge('Synthetic').innerText(),'1m 10d','latest interaction follows the same filtered contacts');
  await page.getByRole('textbox',{name:'Buscador universal'}).fill('');
  await page.locator('.contacts-filter-select').filter({hasText:'Foco'}).locator('select').selectOption('all');
  assert.equal(await companyState('Synthetic').innerText(),'Agradecimiento enviado');
  assert.equal(await companyAge('Synthetic').innerText(),'Hoy');
  await page.locator('.contacts-filter-select').filter({hasText:'Foco'}).locator('select').selectOption('true');
  assert.equal(await companyState('Synthetic').innerText(),'Cita concretada');
  assert.equal(await companyAge('Synthetic').innerText(),'1d');
  await page.getByRole('button',{name:'Más filtros',exact:true}).click();
  await page.getByRole('button',{name:'Contactado',exact:true}).click();
  assert.equal(await companyState('Synthetic HH').innerText(),'Contactado','status filter precedes the maximum');
  assert.equal(await companyRow('Synthetic HH').locator('td').nth(2).innerText(),'1');
  assert.equal(await companyAge('Synthetic HH').innerText(),'7d');
  await page.getByRole('button',{name:'Contactado',exact:true}).click();
  await page.getByRole('button',{name:'Más filtros',exact:true}).click();
  await page.getByRole('checkbox',{name:'Filtrar contactos de Synthetic HH',exact:true}).check();
  assert.equal(await companyState('Synthetic').innerText(),'Cita concretada','company selection does not change company aggregates');
  assert.equal(await companyAge('Synthetic').innerText(),'1d');
  await page.getByRole('checkbox',{name:'Filtrar contactos de Sin empresa',exact:true}).check();
  assert.equal(await page.locator('.contacts-table tbody tr').count(),4);
  await page.getByRole('button',{name:'Estado más avanzado',exact:true}).click();
  assert.deepEqual(await page.locator('.companies-table tbody .status').allTextContents(),['sin estado','Agendado','Cita concretada','Agradecimiento enviado']);
  await page.getByRole('button',{name:'Estado más avanzado',exact:true}).click();
  assert.deepEqual(await page.locator('.companies-table tbody .status').allTextContents(),['Agradecimiento enviado','Cita concretada','Agendado','sin estado']);
  const ages=()=>page.locator('.companies-table tbody tr td:nth-child(5)').allTextContents();
  await page.getByRole('button',{name:'Última interacción',exact:true}).click();
  assert.deepEqual(await ages(),['sin interacciones','2m 1d','1d','Hoy']);
  await page.getByRole('button',{name:'Última interacción',exact:true}).click();
  assert.deepEqual(await ages(),['Hoy','1d','2m 1d','sin interacciones']);
  assert.equal(await page.evaluate(()=>JSON.stringify(window.fixture.contacts)===window.contactsBeforeCompanyFilters),true);
  assert.deepEqual(await page.evaluate(()=>window.fixture.contactSaves),[]);
  await page.getByRole('button',{name:'Limpiar selección de empresas',exact:true}).click();
  await page.locator('.companies-block').screenshot({path:path.join(shots,'companies-advanced-state.png')});
  console.log('PASS BF-11 advanced state: canonical progress, invalid/empty, shared badges, search/focus/status scope, stable aggregates under multi-selection, ordinal sort and no mutation');
  console.log('PASS BF-11 latest interaction: same source/format as Contactos, most recent eligible contact, empty/Today/months/days, filtered aggregation and bidirectional age sort');
  for(const [width,height] of [[1440,900],[768,1024],[375,812],[390,844],[320,812]]){
    await page.setViewportSize({width,height});
    await page.goto(url+'?mode=states');
    await page.getByRole('heading',{name:'Estados de networking',exact:true}).waitFor();
    assert.equal(await page.locator('.contacts-status-board').count(),1);
    assert.equal(await page.locator('.contacts-table').count(),0);
    assert.equal(await page.getByRole('button',{name:'Crear contacto',exact:true}).count(),0);
    assert.ok(await page.locator('a[href*="contactId="]').count()>0);
    assert.equal(await page.locator('.contacts-filter-main').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'all contact filter controls fit without horizontal scrolling');
    await page.screenshot({path:path.join(shots,`ui-struct-states-${width}.png`)});
    await page.goto(url+'?mode=contact-list');
    await page.getByRole('heading',{name:'Contactos',exact:true}).waitFor();
    assert.equal(await page.locator('.contacts-status-board').count(),0);
    assert.equal(await page.locator('.contacts-table').count(),1);
    assert.equal(await page.getByRole('button',{name:'Crear contacto',exact:true}).count(),1);
    assert.equal(await page.locator('.contacts-bulk-bar').count(),1);
    assert.equal(await page.locator('.companies-block').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('.companies-block .table-wrap').evaluate(el=>getComputedStyle(el).overflowX),'auto','company columns retain contained horizontal scroll');
    await page.screenshot({path:path.join(shots,`ui-struct-contacts-${width}.png`)});
    await page.locator('.companies-block').screenshot({path:path.join(shots,`ui-struct-companies-${width}.png`)});
    await page.goto(url+'?mode=priorities');
    await page.getByRole('heading',{name:'Mis objetivos',exact:true}).waitFor();
    assert.equal(await page.locator('.opportunities-section').count(),0);
    assert.equal(await page.evaluate(()=>window.fixture.opportunityReads),0);
    assert.equal(await page.locator('.structural-priorities .panel').count(),0);
    assert.equal(await page.locator('.objectives-priorities').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(shots,`ui-struct-priorities-${width}.png`)});
  }
  await page.goto(url+'?mode=workspace');
  await page.locator('.opportunities-section').waitFor();
  const initialReads=await page.evaluate(()=>window.fixture.opportunityReads);
  for(const condition of ['unknown_start','empty','stale','error']){
    await page.evaluate(()=>window.hideBoard());
    await page.waitForFunction(()=>!document.querySelector('.opportunities-section'));
    await page.evaluate(condition=>{
      window.fixture.cycles=condition==='empty'?[]:[{id:'cycle',status:'active',started_at:condition==='unknown_start'?null:'2026-10-01T12:00:00Z'}];
      window.fixture.staleCycle=condition==='stale';window.fixture.failCycles=condition==='error';window.showBoard();
    },condition);
    const messages={unknown_start:'Configura el inicio en Objetivos para ver tus oportunidades.',empty:'No hay una búsqueda activa. Puedes iniciarla en Objetivos.',stale:'El ciclo cambió en otra pestaña. Actualiza esta página antes de guardar.',error:'No pudimos verificar la búsqueda activa.'};
    await page.getByText(messages[condition],{exact:false}).waitFor();
    assert.equal(await page.locator('.opportunities-section').count(),0);
    assert.equal(await page.evaluate(()=>window.fixture.opportunityReads),initialReads);
    if(condition==='error'){
      await page.evaluate(()=>window.fixture.failCycles=false);
      await page.getByRole('button',{name:'Reintentar',exact:true}).click();
      await page.locator('.opportunities-section').waitFor();
    }
  }
  console.log('PASS UI-STRUCT-01: states/list separation, original actions and links, priorities without opportunities or nested panels at 1440/768/375/390; cycle gate no start/empty/stale/error/retry');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS no browser errors, no external requests');console.log(`Screenshots: ${shots}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  if(path.dirname(output)===path.resolve(os.tmpdir())&&path.basename(output).startsWith('coffeecito-status-boards-'))fs.rmSync(output,{recursive:true,force:true});
});
