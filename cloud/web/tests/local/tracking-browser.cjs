// Real mounted Seguimiento, synthetic RPC, no session and no non-loopback requests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),req=createRequire(path.join(root,'package.json'));
const {webpack}=req('next/dist/compiled/webpack/webpack');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'coffeecito-tracking-browser-'));
const shots=fs.mkdtempSync(path.join(os.tmpdir(),'coffeecito-tracking-screenshots-'));
const imp=f=>JSON.stringify(path.join(root,f).replaceAll('\\','/'));
const write=(file,body)=>fs.writeFileSync(path.join(output,file),body);
let browser,server;
async function main(){
  write('loader.cjs',`const ts=require(${JSON.stringify(req.resolve('typescript'))});module.exports=src=>ts.transpileModule(src,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  write('read.ts',`export async function readTrackingSnapshot(){window.reads++;if(window.hold)await new Promise(r=>window.waiters.push(r));if(window.fail)throw Error('synthetic');return structuredClone(window.data);}`);
  write('details.ts',`export async function readDashboardDetails(){window.detailReads++;if(window.detailHold)await new Promise(r=>window.detailWaiters.push(r));if(window.detailFail)throw Error('synthetic');return structuredClone(window.details);}`);
  write('transport.ts','export const supabase=null;export const supabaseConfigError="synthetic transport forbidden";');
  write('shell-stubs.tsx',`import React from 'react';
    export default function Link({children,href,...props}){return <a href={href} {...props}>{children}</a>;}
    export const usePathname=()=>'/dashboard';
    export const OnboardingProvider=({children})=>children;export const SystemAccessProvider=OnboardingProvider;export const InteractionSyncPreferencesProvider=OnboardingProvider;
    export const useOnboarding=()=>({loading:false,routeReady:true,loadFailed:false,replay:()=>{}});
    export const useSystemAccess=()=>({status:'ready',grantedCapabilities:[]});export const canRenderSystemSurface=()=>false;
    export const expectedNetworkingCycleId=async()=>null;
    export const ActivitySyncButton=()=> <button className="button square" aria-label="Sync">S</button>;
    export const InvitationButton=()=> <button className="button square" aria-label="Invitar">5</button>;`);
  write('entry.tsx',`
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ReadOnlyDashboard} from ${imp('components/ReadOnlyDashboard.tsx')};
    import {Shell} from ${imp('components/Shell.tsx')};
    import {bindGlobalActivitySyncScope,startGlobalActivitySync,clearGlobalActivitySyncFeedback} from ${imp('lib/activitySyncExecution.ts')};
    let syncSequence=0;
    window.completeCalendar=async(success=true)=>{bindGlobalActivitySyncScope('synthetic-ui-struct');await startGlobalActivitySync(async()=>[{service:'calendar',created:0,error:success?'':'synthetic failure',reauthorizationRequired:false,success,syncedAt:success?String(++syncSequence):null}]).promise;};
    window.clearCalendarFeedback=clearGlobalActivitySyncFeedback;
    import {trackingFixture,coffee} from ${imp('tests/trackingFixtures.ts')};
    window.data=trackingFixture();coffee(window.data,'a','2026-10-28T12:00:00Z');coffee(window.data,'b','2026-10-31T12:00:00Z','b');
    window.data.contacts[2].networking_status='Agradecimiento enviado';
    window.data.transitions.push({id:'c-entry',contact_id:'c',previous_status:'Pendiente',next_status:'Agradecimiento enviado',changed_at:'2026-10-29T12:00:00Z'});
    window.data.interactions.forEach(i=>i.metadata={});window.data.sources=[];
    window.details={contacts:window.data.contacts.map(c=>({...c,display_name:'Persona '+c.id,role:'',is_active:true,updated_at:window.data.as_of,
      networking_status:c.networking_status,is_headhunter:c.id==='c',headhunter_domains:c.id==='c'?['@hh.invalid']:[],contact_phones:[],
      contact_objective_assignments:window.data.assignments.filter(a=>a.contact_id===c.id).map(a=>({...a,objective:window.data.priorities.find(p=>p.id===a.objective_id)}))})),
      interactions:window.data.interactions.map(i=>({...i,subject:'Café sintético',direction:'unknown',user_notes_raw:null})),participants:window.data.participants,referrals:[],sources:[]};
    window.detailReads=0;window.detailHold=false;window.detailFail=false;window.detailWaiters=[];
    window.reads=0;window.hold=true;window.fail=false;window.waiters=[];
    function App(){const [visible,setVisible]=useState(true);const [view,setView]=useState('all');window.setView=setView;window.hide=()=>setVisible(false);window.show=()=>setVisible(true);return <Shell>{visible?<ReadOnlyDashboard view={view}/>:null}</Shell>;}
    createRoot(document.getElementById('root')).render(<App/>);`);
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',devtool:false,context:root,entry:path.join(output,'entry.tsx'),
      output:{path:output,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js','.json'],modules:[path.join(root,'node_modules')]},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[path.join(output,'loader.cjs')]}]},
      plugins:[new webpack.NormalModuleReplacementPlugin(/trackingRead$/,path.join(output,'read.ts')),
        new webpack.NormalModuleReplacementPlugin(/dashboardDetails$/,path.join(output,'details.ts')),
        new webpack.NormalModuleReplacementPlugin(/(next\/link|next\/navigation|OnboardingProvider|SystemAccess|InteractionSyncPreferencesProvider|ActivitySyncButton|InvitationButton|systemAccess|networkingCycles)$/,path.join(output,'shell-stubs.tsx')),
        new webpack.NormalModuleReplacementPlugin(/supabaseClient(\.ts)?$/,path.join(output,'transport.ts'))]});
    compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  server=http.createServer((request,response)=>{
    const pathname=new URL(request.url,'http://localhost').pathname;
    if(pathname==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/globals.css"><div id="root"></div><script src="/bundle.js"></script></html>');return;}
    const file=pathname==='/bundle.js'?path.join(output,'bundle.js'):pathname==='/brand/coffeecito-isotipo.svg'?path.join(root,'public',pathname.slice(1)):(['/app/globals.css','/styles/tokens.css','/styles/components.css','/styles/invitations.css','/styles/tracking.css'].includes(pathname)?path.join(root,pathname.slice(1)):null);
    if(!file){response.statusCode=404;response.end();return;}
    response.setHeader('Content-Type',pathname.endsWith('.css')?'text/css':pathname.endsWith('.svg')?'image/svg+xml':'text/javascript');response.end(fs.readFileSync(file));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}/`;
  const {chromium}=require(process.env.OPPORTUNITY_PLAYWRIGHT_MODULE||'playwright');
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const external=[],errors=[];
  await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():(external.push('blocked'),r.abort()));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-10-30T16:00:00Z')});
  if(process.env.HIDDEN_FILTERS_ONLY){
    await page.goto(url);
    await page.getByText('Leyendo seguimiento...', {exact:true}).waitFor();
    await page.evaluate(()=>window.hide());
    await page.waitForFunction(()=>!document.querySelector('.tracking-dashboard'));
    await page.evaluate(()=>{
      window.hold=false;window.waiters.splice(0).forEach(r=>r());
      const base=window.details.contacts[0];
      window.details.contacts.push({...base,id:'outside-focus',display_name:'Fuera de foco',networking_focus:false});
      const ids=['a','b','c','outside-focus'];
      window.details.interactions=ids.map(id=>({id:'interaction-'+id,interaction_type:'manual',occurred_at:'2026-10-29T12:00:00Z',subject:'Actividad '+id,metadata:{}}));
      window.details.interactions.push({id:'before-cycle',interaction_type:'manual',occurred_at:'2010-01-01T12:00:00Z',subject:'Anterior al ciclo',metadata:{}});
      window.details.participants=ids.map(id=>({interaction_id:'interaction-'+id,contact_id:id}));
      window.details.participants.push({interaction_id:'before-cycle',contact_id:'a'});
      window.details.referrals=ids.map(id=>({id:'referral-'+id,referredByContactId:id,referrerName:'Persona '+id,referrerStatus:'Pendiente',referredName:'Referido '+id,linkedContactId:null}));
      window.restrictiveQuery=JSON.stringify({filters:{priorityIds:['p'],headhunters:'only',groupHeadhunters:true},quickQuery:'sin coincidencias',domains:['@missing.invalid']});
      window.history.replaceState(null,'','/?'+new URLSearchParams({'ux-tracking':window.restrictiveQuery}));
      window.dispatchEvent(new PopStateEvent('popstate'));window.setView('interactions');window.show();
    });
    await page.waitForFunction(()=>document.querySelectorAll('.dashboard-interaction-list details').length===3);
    for(const [width,height] of [[1440,900],[375,812]]){
      await page.setViewportSize({width,height});
      await page.evaluate(()=>window.setView('interactions'));
      await page.getByRole('heading',{name:'Últimas interacciones',exact:true}).waitFor();
      assert.equal(await page.locator('.dashboard-filter-bar,.contact-filter-controls').count(),0);
      assert.equal(await page.locator('.dashboard-interaction-list details').count(),3,'optional filters ignored; focus and cycle still enforced');
      assert.equal(await page.getByText('Anterior al ciclo',{exact:true}).count(),0);
      await page.screenshot({path:path.join(shots,`no-lower-filters-interactions-${width}.png`)});
      await page.evaluate(()=>window.setView('referrals'));
      await page.getByRole('heading',{name:'Referidos',exact:true}).waitFor();
      assert.equal(await page.locator('.dashboard-filter-bar,.contact-filter-controls').count(),0);
      assert.deepEqual(await page.locator('.dashboard-referral-referred strong').allTextContents(),['Referido a','Referido b','Referido c']);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:path.join(shots,`no-lower-filters-referrals-${width}.png`)});
    }
    for(const view of ['home','planning']){
      await page.evaluate(view=>window.setView(view),view);
      await page.getByRole('textbox',{name:'Buscar en interacciones y empresas'}).waitFor();
      assert.equal(await page.locator('.contact-filter-controls').count(),1);
      assert.equal(await page.getByRole('textbox',{name:'Buscar en interacciones y empresas'}).inputValue(),'sin coincidencias');
      assert.equal(await page.locator('.contacts-filter-select').filter({hasText:'Headhunter'}).locator('select').inputValue(),'true');
    }
    assert.equal(await page.evaluate(()=>new URLSearchParams(location.search).get('ux-tracking')===window.restrictiveQuery),true,'editable filter context is not cleared');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log('PASS hidden lower filters: bars absent, interactions/referrals remain populated despite stale URL filters, focus/cycle preserved, Inicio/Planificar context retained, no errors/external requests');
    console.log('Screenshots: '+shots);
    return;
  }
  await page.goto(url);await page.getByText('Leyendo seguimiento...', {exact:true}).waitFor();
  assert.equal(await page.locator('.tracking-pyramid').count(),0);
  await page.evaluate(()=>{window.hold=false;window.waiters.splice(0).forEach(r=>r());});
  await page.locator('.tracking-pyramid').waitFor();
  assert.equal(await page.evaluate(()=>window.reads),1);
  assert.equal(await page.getByRole('button',{name:'Actualizar Seguimiento'}).count(),0);
  assert.equal(await page.locator('.tracking-pyramid li').count(),5);
  assert.equal(await page.locator('.contact-filter-controls .contacts-filter-main').count(),1);
  assert.equal(await page.getByLabel('Foco').inputValue(),'true');
  assert.equal(await page.getByLabel('Foco').isDisabled(),true);
  assert.equal(await page.getByLabel('Headhunter').inputValue(),'all');
  assert.equal(await page.getByRole('button',{name:'Más filtros'}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Agrupar Headhunters'}).count(),1);
  assert.equal(await page.locator('.tracking-chart-controls .tracking-group-toggle').count(),1);
  assert.deepEqual(await page.locator('.tracking-level-label').allTextContents(),['Contactados','Cafés','Procesos','Ofertas recibidas','Ofertas exitosas']);
  assert.equal(await page.locator('.tracking-conversion').count(),4);
  assert.equal(await page.locator('.tracking-note').count(),0);
  assert.equal(await page.getByText(/^Total acumulado:/).count(),0);
  assert.equal(await page.locator('.tracking-pyramid strong').nth(1).innerText(),'2');
  assert.equal(await page.locator('.tracking-pyramid').getByText('Oportunidades',{exact:true}).count(),0);
  assert.equal(await page.locator('.tracking-dashboard').getByText(/ciclo/i).count(),0);
  assert.equal(await page.getByText(/vigencia verificable|indeterminada/).count(),0);
  assert.equal(await page.locator('.kpi-time-slot').count(),12);
  assert.equal(await page.locator('.kpi-chart-hit').count(),12);
  assert.equal(await page.locator('.kpi-time-slot[data-index="9"]').getAttribute('data-visible'),'true');
  assert.equal(await page.locator('.tracking-chart').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  assert.equal(await page.getByRole('button',{name:/Períodos anteriores|Períodos siguientes/}).count(),0);
  assert.deepEqual(await page.locator('.objective-metrics-table thead th').allTextContents(),['Objetivo','Tipo','Prioridad','Oportunidades','Contactos','Cafes','Ultima actividad','Mayor estado']);
  assert.equal(await page.locator('.tracking-main-panel .panel').count(),0,'no nested cards');
  for(const name of ['¿Cómo voy?','Últimas interacciones','Empresas headhunter','Contactos referidos'])await page.getByRole('heading',{name,exact:true}).waitFor();
  assert.equal(await page.locator('.kpi-total-line').count(),0);
  assert.equal(await page.locator('.kpi-total-dot').count(),0);
  assert.equal(await page.locator('.kpi-total-label').count(),12);
  for(const label of ['contactos con café realizado','contactos con café realizado (fecha estimada)','contactos con café proyectado'])
    assert.equal(await page.getByText(label,{exact:true}).count(),1);
  const totals=await page.locator('.kpi-time-slot').evaluateAll(groups=>groups.map(g=>{
    const blue=g.querySelector('.kpi-realized-bar'),estimated=g.querySelector('.kpi-estimated-bar'),green=g.querySelector('.kpi-future-bar');
    return {blue:blue?+blue.getAttribute('height'):0,estimated:estimated?+estimated.getAttribute('height'):0,green:green?+green.getAttribute('height'):0};
  }));
  assert.ok(totals.some(v=>v.blue>0&&v.estimated>0&&v.green>0));
  const stacks=await page.locator('.kpi-realized-bar').evaluateAll(rects=>rects.map(r=>{
    const estimated=r.nextElementSibling,green=estimated.nextElementSibling;
    return {x:r.getAttribute('x'),y:+r.getAttribute('y'),h:+r.getAttribute('height'),
      estimated:{x:estimated.getAttribute('x'),y:+estimated.getAttribute('y'),h:+estimated.getAttribute('height')},
      green:{x:green.getAttribute('x'),y:+green.getAttribute('y'),h:+green.getAttribute('height')}};
  }));
  assert.ok(stacks.some(r=>r.h>0&&r.estimated.h>0&&r.green.h>0));
  for(const r of stacks){assert.equal(r.x,r.estimated.x);assert.equal(r.x,r.green.x);
    assert.ok(Math.abs(r.estimated.y+r.estimated.h-r.y)<0.001);
    assert.ok(Math.abs(r.green.y+r.green.h-r.estimated.y)<0.001);}
  for(const viewportWidth of [1440,1200,1024,900,768,375,320]){
    await page.setViewportSize({width:viewportWidth,height:900});
    await page.waitForFunction(()=>{
      const frame=document.querySelector('.tracking-chart'),svg=frame?.querySelector('svg');
      return frame&&svg&&Math.abs(svg.viewBox.baseVal.width-frame.getBoundingClientRect().width)<1;
    });
    const geometry=await page.evaluate(()=>{
      const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};};
      const bars=[...document.querySelectorAll('.kpi-realized-bar')].slice(0,2);
      const barWidth=+bars[0].getAttribute('width');
      const gap=+bars[1].getAttribute('x')- +bars[0].getAttribute('x')-barWidth;
      const tiers=[...document.querySelectorAll('.tracking-level')].map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,right:r.right,height:r.height,width:r.width};});
      const ratios=[...document.querySelectorAll('.tracking-conversion')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,bottom:r.bottom};});
      const labels=[...document.querySelectorAll('.kpi-axis-label')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right};});
      const stacked=[...document.querySelectorAll('.kpi-time-slot')].map(e=>[...e.querySelectorAll('rect')].reduce((sum,r)=>sum+Number(r.getAttribute('height')),0));
      const controls=rect('.tracking-chart-controls');
      return {pageWidth:document.documentElement.scrollWidth,panel:rect('.tracking-main-panel'),
        pyramid:rect('.tracking-pyramid'),coffee:rect('.tracking-coffee'),chart:rect('.tracking-chart'),barWidth,gap,tiers,ratios,labels,controls,maxBar:Math.max(...stacked)};
    });
    assert.ok(geometry.pageWidth<=viewportWidth,`${viewportWidth}: no horizontal overflow`);
    if(viewportWidth<=375)assert.ok(await page.locator('.contacts-filter-main').evaluate(e=>e.scrollWidth<=e.clientWidth),`${viewportWidth}: all top filters visible without inner scrolling`);
    assert.ok(geometry.pyramid.left>=geometry.panel.left-1&&geometry.chart.right<=geometry.panel.right+1,`${viewportWidth}: contained`);
    const overlapX=Math.min(geometry.pyramid.right,geometry.coffee.right)-Math.max(geometry.pyramid.left,geometry.coffee.left);
    const overlapY=Math.min(geometry.pyramid.bottom,geometry.coffee.bottom)-Math.max(geometry.pyramid.top,geometry.coffee.top);
    assert.ok(overlapX<=1||overlapY<=1,`${viewportWidth}: no overlap`);
    assert.ok(Math.abs(geometry.gap/geometry.barWidth-1)<0.02,`${viewportWidth}: bar gap equals bar width`);
    assert.equal(geometry.tiers.length,5);
    assert.equal(geometry.ratios.length,4);
    for(let i=0;i<5;i++)assert.ok(Math.abs(geometry.tiers[i].height-27)<1,`${viewportWidth}: rectangular tier height 27px`);
    assert.equal(await page.locator('.tracking-level').first().evaluate(e=>getComputedStyle(e,'::before').clipPath),'none');
    assert.ok(geometry.maxBar<=130.5,`${viewportWidth}: reduced plotting height`);
    assert.ok(geometry.controls.right<=geometry.coffee.right+1,`${viewportWidth}: chart controls contained`);
    for(let i=1;i<5;i++){
      assert.ok(geometry.tiers[i].right<geometry.ratios[i-1].left,`${viewportWidth}: ratio right of trapezoid`);
      assert.ok(Math.abs((geometry.tiers[i].top+geometry.tiers[i].bottom)/2-(geometry.ratios[i-1].top+geometry.ratios[i-1].bottom)/2)<1,`${viewportWidth}: ratio vertically centered`);
    }
    assert.ok(geometry.ratios.every(r=>Math.abs(r.left-geometry.ratios[0].left)<1),`${viewportWidth}: ratio column aligned`);
    const visual=geometry.tiers.slice().sort((a,b)=>a.top-b.top);
    for(let i=1;i<visual.length;i++)assert.ok(visual[i].top-visual[i-1].bottom>=3&&visual[i].top-visual[i-1].bottom<=5,`${viewportWidth}: uniform 4px tier gap, got ${visual[i].top-visual[i-1].bottom}`);
    for(let i=1;i<geometry.labels.length;i++)assert.ok(geometry.labels[i].left>=geometry.labels[i-1].right-1,`${viewportWidth}: axis labels do not overlap ${JSON.stringify([geometry.labels[i-1],geometry.labels[i]])}`);
    console.log(`Layout ${viewportWidth}px: bar ${geometry.barWidth.toFixed(2)}px, gap ${geometry.gap.toFixed(2)}px`);
    if(viewportWidth>=768){assert.ok(geometry.pyramid.right<=geometry.coffee.left+1,`${viewportWidth}: horizontal layout`);
      assert.ok(geometry.barWidth>=11.5,`${viewportWidth}: horizontal bars remain legible`);}
    else assert.ok(geometry.pyramid.bottom<=geometry.coffee.top+1,`${viewportWidth}: stacked layout`);
    await page.screenshot({path:path.join(shots,`weekly-${viewportWidth}.png`),fullPage:viewportWidth<=375,animations:'disabled'});
    await page.getByRole('button',{name:'Mensual',exact:true}).click();
    assert.equal(await page.locator('.kpi-axis-label').count(),await page.locator('.kpi-time-slot[data-visible="true"]').count(),`${viewportWidth}: all eligible months labeled`);
    assert.equal(await page.locator('.kpi-axis-label.current').count(),1,`${viewportWidth}: one bold current month`);
    assert.equal(await page.locator('.kpi-axis-label.current').evaluate(e=>getComputedStyle(e).fontWeight),'700');
    await page.screenshot({path:path.join(shots,`monthly-${viewportWidth}.png`),fullPage:viewportWidth<=375,animations:'disabled'});
    await page.getByRole('button',{name:'Semanal',exact:true}).click();
    assert.equal(await page.locator('.kpi-axis-label.current').count(),1,`${viewportWidth}: one bold current week`);
  }
  await page.setViewportSize({width:1280,height:900});
  await page.waitForFunction(()=>Math.abs(document.querySelector('.tracking-chart svg').viewBox.baseVal.width-document.querySelector('.tracking-chart').getBoundingClientRect().width)<1);
  await page.waitForFunction(()=>document.querySelector('.kpi-axis-label')?.getAttribute('transform')?.startsWith('rotate(-45 '));
  await page.locator('.kpi-chart-hit').nth(9).hover();await page.getByRole('tooltip').waitFor();
  assert.match(await page.getByRole('tooltip').innerText(),/1 con cita pasada, 1 con fecha estimada, 1 proyectados\. Total 3\./);
  await page.mouse.move(0,0);
  const definitions=[
    'Contactos en estado Contactado o superior.',
    'Contactos en estado Cita concretada o Agradecimiento enviado.',
    'Oportunidades en etapa En proceso u Oferta recibida.',
    'Oportunidades en etapa Oferta recibida.',
    'Oportunidades finalizadas con oferta aceptada.',
  ];
  const formulas=['Cafés / Contactados','Procesos / Cafés','Ofertas recibidas / Procesos','Ofertas exitosas / Ofertas recibidas'];
  for(let i=0;i<definitions.length;i++){
    await page.locator('.tracking-level').nth(i).hover();
    assert.equal(await page.getByRole('tooltip').innerText(),definitions[i]);
    await page.mouse.move(0,0);
  }
  for(let i=0;i<formulas.length;i++){
    await page.locator('.tracking-conversion .help-tooltip').nth(i).hover();
    assert.equal(await page.getByRole('tooltip').innerText(),formulas[i]);
    await page.mouse.move(0,0);
  }
  const number=page.locator('.tracking-level').first();await number.hover();await page.getByRole('tooltip').waitFor();
  assert.equal(await page.getByRole('tooltip').evaluate(e=>e.parentElement===document.body),true,'pyramid help escapes trapezoid stacking');
  const numberBounds=await page.getByRole('tooltip').boundingBox();
  assert.ok(numberBounds.x>=0&&numberBounds.x+numberBounds.width<=1280&&numberBounds.y>=0);
  await page.screenshot({path:path.join(shots,'pyramid-number.png'),animations:'disabled'});
  await number.focus();await page.keyboard.press('Escape');assert.equal(await page.getByRole('tooltip').count(),0);
  await number.evaluate(e=>e.blur());
  await page.locator('.tracking-conversion .help-tooltip').first().hover();await page.getByRole('tooltip').waitFor();
  assert.equal(await page.getByRole('tooltip').evaluate(e=>e.parentElement===document.body),true);
  await page.screenshot({path:path.join(shots,'pyramid-conversion.png'),animations:'disabled'});
  await page.mouse.move(0,0);
  await page.locator('.tracking-level').first().evaluate(e=>e.blur());
  assert.equal(await page.getByText('Coach',{exact:true}).count(),0);
  await page.screenshot({path:path.join(shots,'desktop.png'),fullPage:true,animations:'disabled'});
  const countsBefore=await page.locator('.tracking-pyramid strong').allTextContents();
  await page.getByRole('textbox',{name:'Buscar en interacciones y empresas'}).fill('Persona a');
  assert.equal(await page.locator('.dashboard-interaction-list details').count(),1);
  assert.deepEqual(await page.locator('.tracking-pyramid strong').allTextContents(),countsBefore,'detail search does not redefine metrics');
  await page.getByRole('textbox',{name:'Buscar en interacciones y empresas'}).fill('');
  await page.getByRole('button',{name:'Mensual',exact:true}).click();
  await page.getByRole('button',{name:'Más filtros'}).click();
  assert.equal(await page.locator('.contacts-filter-expanded').count(),1);
  assert.equal(await page.locator('.contacts-status-filter-row').count(),0,'tracking does not expose contact status filter');
  await page.getByRole('button',{name:'Tecnología',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.reads),1,'filters/periods do not reread');
  assert.equal(await page.locator('.objective-metrics-table tbody tr').count(),1);
  await page.getByRole('button',{name:'Agrupar Headhunters'}).click();
  assert.equal(await page.getByRole('button',{name:'Agrupar Headhunters'}).getAttribute('aria-pressed'),'true');
  await page.locator('.contacts-filter-select').filter({hasText:'Headhunter'}).locator('select').selectOption('true');
  assert.equal(await page.locator('.tracking-pyramid strong').nth(1).innerText(),'0');
  await page.locator('.contacts-filter-select').filter({hasText:'Headhunter'}).locator('select').selectOption('all');
  const readsBeforeError=await page.evaluate(()=>({snapshot:window.reads,detail:window.detailReads}));
  await page.evaluate(()=>{window.hold=true;window.hide();});
  await page.waitForFunction(()=>!document.querySelector('.tracking-dashboard'));
  await page.evaluate(()=>window.show());
  await page.waitForFunction(()=>window.waiters.length>0);
  assert.equal(await page.evaluate(()=>window.reads),readsBeforeError.snapshot+1,'return reads snapshot once');
  assert.equal(await page.evaluate(()=>window.detailReads),readsBeforeError.detail+1,'return reads details once');
  await page.evaluate(()=>{window.fail=true;window.hold=false;window.waiters.splice(0).forEach(r=>r());});
  await page.getByRole('alert').waitFor();assert.equal(await page.locator('.tracking-pyramid li').count(),0);
  await page.evaluate(()=>{window.fail=false;});await page.getByRole('button',{name:'Reintentar',exact:true}).click();
  await page.locator('.tracking-pyramid').waitFor();
  await page.waitForFunction(()=>!document.querySelector('[role=alert]'));
  await page.evaluate(()=>{window.detailFail=true;window.hide();});
  await page.waitForFunction(()=>!document.querySelector('.tracking-dashboard'));
  await page.evaluate(()=>window.show());
  await page.getByText('No pudimos actualizar el detalle.',{exact:false}).waitFor();
  assert.equal(await page.locator('.tracking-pyramid li').count(),5);
  assert.equal(await page.getByRole('button',{name:'Reintentar detalle'}).count(),1);
  await page.evaluate(()=>{window.detailFail=false;});await page.getByRole('button',{name:'Reintentar detalle'}).click();
  await page.waitForFunction(()=>!document.querySelector('[role=alert]'));
  await page.setViewportSize({width:320,height:850});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=320),'no viewport overflow');
  await page.waitForFunction(()=>document.querySelector('.kpi-axis-label')?.getAttribute('transform')?.startsWith('rotate(-65 '));
  await page.getByRole('button',{name:'Semanal',exact:true}).click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='Semanal'&&e.getAttribute('aria-pressed')==='true'));
  await page.getByRole('button',{name:'Semanal',exact:true}).evaluate(e=>e.blur());await page.mouse.move(0,0);
  assert.equal(await page.getByRole('button',{name:'Semanal',exact:true}).isEnabled(),true);
  await page.screenshot({path:path.join(shots,'mobile-320.png'),fullPage:true,animations:'disabled'});
  await page.locator('.kpi-chart-hit').first().focus();
  assert.equal(await page.locator('.kpi-chart-hit').first().evaluate(e=>e===document.activeElement),true);
  await page.getByRole('tooltip').waitFor();
  const tooltipBounds=await page.getByRole('tooltip').boundingBox();
  assert.ok(tooltipBounds.x>=0&&tooltipBounds.x+tooltipBounds.width<=320,'mobile chart help fits viewport');
  await page.locator('.tracking-level').first().focus();
  const pyramidHelp=await page.getByRole('tooltip').boundingBox();
  assert.ok(pyramidHelp.x>=0&&pyramidHelp.x+pyramidHelp.width<=320,'mobile pyramid help fits viewport');
  await page.getByRole('button',{name:'Más filtros'}).click();
  const priorityWasSelected=await page.getByRole('button',{name:'Tecnología',exact:true}).getAttribute('aria-pressed');
  await page.getByRole('button',{name:'Tecnología',exact:true}).focus();await page.keyboard.press('Enter');
  assert.notEqual(await page.getByRole('button',{name:'Tecnología',exact:true}).getAttribute('aria-pressed'),priorityWasSelected);
  await page.evaluate(()=>{window.hold=true;window.hide();});
  await page.waitForFunction(()=>!document.querySelector('.tracking-dashboard'));
  await page.evaluate(()=>window.show());
  await page.waitForFunction(()=>window.waiters.length>0);
  await page.evaluate(()=>window.hide());await page.waitForFunction(()=>!document.querySelector('.tracking-dashboard'));
  await page.evaluate(()=>{window.waiters.splice(0).forEach(r=>r());window.hold=false;window.data.cycle=null;window.show();});
  await page.getByText('No hay una búsqueda activa. Puedes iniciarla en Objetivos.').waitFor();
  await page.evaluate(()=>{window.hide();window.data.cycle={id:'legacy',started_at:null,timezone_name:null};});
  await page.waitForFunction(()=>!document.querySelector('.tracking-dashboard'));
  await page.evaluate(()=>window.show());
  await page.getByText('Configura el inicio y la zona horaria en Objetivos para ver tus avances.').waitFor();
  await page.evaluate(()=>{window.hide();window.data.cycle={id:'cycle',started_at:'2026-10-26T03:00:00Z',timezone_name:'America/Santiago'};window.data.as_of='2026-10-30T16:00:00Z';});
  await page.waitForFunction(()=>!document.querySelector('.tracking-dashboard'));
  await page.evaluate(()=>window.show());
  await page.waitForFunction(()=>document.querySelectorAll('.kpi-time-slot[data-visible="true"]').length===3);
  assert.equal(await page.locator('.kpi-time-slot[data-visible="false"]').count(),9);
  assert.equal(await page.locator('.kpi-time-slot[data-index="9"]').getAttribute('data-visible'),'true');
  assert.deepEqual((await page.locator('.kpi-axis-label').allTextContents()).map(s=>s.trim()),['26 oct 26','2 nov 26','9 nov 26']);
  assert.equal(await page.locator('.kpi-chart-hit').count(),3);
  await page.clock.fastForward(4*24*60*60*1000);
  await page.waitForFunction(()=>document.querySelectorAll('.kpi-time-slot[data-visible="true"]').length===4);
  assert.deepEqual((await page.locator('.kpi-axis-label').allTextContents()).map(s=>s.trim()),['26 oct 26','2 nov 26','9 nov 26','16 nov 26']);
  await page.getByRole('button',{name:'Mensual',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.kpi-axis-label').length===4);
  assert.deepEqual((await page.locator('.kpi-axis-label').allTextContents()).map(s=>s.trim()),['oct','nov','dic','ene']);
  assert.equal(await page.locator('.tracking-chart').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  for(const route of ['Contactos','Oportunidades']){
    const before=await page.evaluate(()=>({snapshot:window.reads,detail:window.detailReads}));
    await page.evaluate(()=>window.hide());
    await page.waitForFunction(()=>!document.querySelector('.tracking-dashboard'));
    await page.evaluate(routeName=>{
      if(routeName==='Contactos')window.data.contacts.forEach(c=>{c.networking_status='Pendiente';});
      else window.data.opportunities.forEach(o=>{o.stage='identified';});
      window.show();
    },route);
    await page.locator('.tracking-pyramid').waitFor();
    assert.equal(await page.evaluate(()=>window.reads),before.snapshot+1,`${route}: one snapshot read on return`);
    assert.equal(await page.evaluate(()=>window.detailReads),before.detail+1,`${route}: one detail read on return`);
    assert.equal(await page.locator('.tracking-pyramid strong').nth(route==='Contactos'?1:2).innerText(),'0',`${route}: changed data visible after return`);
  }
  // UI-STRUCT-01: real presentation variants, shared filter context and independent cards.
  await page.evaluate(()=>{window.history.replaceState(null,'','/');window.dispatchEvent(new PopStateEvent('popstate'));window.setView('home');});
  for(const [width,height] of [[1440,900],[768,1024],[375,812],[390,844],[320,812]]){
    await page.setViewportSize({width,height});
    await page.getByRole('heading',{name:'Indicadores de avance',exact:true}).waitFor();
    assert.equal(await page.locator('.structural-home-blocks > .panel').count(),2);
    assert.equal(await page.locator('.structural-home-blocks .panel .panel').count(),0);
    const boxes=await page.locator('.structural-home-blocks > .panel').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y};}));
    assert.equal(Math.abs(boxes[0].y-boxes[1].y)<2,width>=768);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('.tracking-dashboard .contacts-quick-search').count(),1);
    assert.equal(await page.locator('.functional-block .panel-title > svg').count(),2);
    const beforeSearch=await page.locator('.tracking-pyramid strong').allTextContents();
    await page.getByRole('textbox',{name:'Buscar en interacciones y empresas'}).fill('sin coincidencias');
    assert.deepEqual(await page.locator('.tracking-pyramid strong').allTextContents(),beforeSearch,'home search retains detail-only semantics');
    await page.getByRole('textbox',{name:'Buscar en interacciones y empresas'}).fill('');
    await page.getByRole('button',{name:'Mensual',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Mensual',exact:true}).getAttribute('aria-pressed'),'true');
    await page.screenshot({path:path.join(shots,`ui-struct-home-${width}.png`)});
  }
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>window.setView('planning'));
  await page.getByRole('heading',{name:'Progreso de tus prioridades - ¿dónde debo enfocarme?',exact:true}).waitFor();
  assert.equal(await page.locator('.tracking-pyramid').count(),0);
  assert.equal(await page.getByRole('heading',{name:'Últimas interacciones',exact:true}).count(),0);
  await page.locator('.contacts-filter-select').filter({hasText:'Headhunter'}).locator('select').selectOption('true');
  await page.locator('.hh-company-table input[type="checkbox"]').first().check();
  const carried = await page.getByRole('link',{name:'Registrar avances',exact:true}).getAttribute('href');
  assert.ok(carried.includes('ux-tracking='));
  await page.screenshot({path:path.join(shots,'ui-struct-planning-1440.png')});
  for(const [width,height] of [[768,1024],[390,844],[375,812],[320,812]]){
    await page.setViewportSize({width,height});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const heading=page.getByRole('heading',{name:'Progreso de tus prioridades - ¿dónde debo enfocarme?',exact:true});
    assert.equal(await heading.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),16);
    assert.equal(await heading.evaluate(el=>el.getBoundingClientRect().right<=innerWidth),true);
    await page.screenshot({path:path.join(shots,`ui-struct-planning-${width}.png`)});
  }
  await page.evaluate(()=>{window.hide();});
  await page.waitForFunction(()=>!document.querySelector('.tracking-dashboard'));
  await page.evaluate(url=>{window.history.pushState(null,'',url);window.dispatchEvent(new PopStateEvent('popstate'));window.setView('interactions');window.show();},carried);
  await page.getByRole('heading',{name:'Últimas interacciones',exact:true}).waitFor();
  assert.equal(await page.locator('.contact-filter-controls').count(),0);
  await page.getByText('Interacciones de contactos en foco',{exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Empresas headhunter',exact:true}).count(),0);
  await page.evaluate(()=>window.setView('referrals'));
  await page.getByRole('heading',{name:'Referidos',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Últimas interacciones',exact:true}).count(),0);
  assert.equal(await page.getByRole('navigation',{name:'Navegacion principal'}).getByRole('link').count(),5);
  for (const view of ['home','planning','interactions','referrals']) {
    await page.evaluate(view=>window.setView(view),view);
    await page.waitForTimeout(100);
    const before=await page.evaluate(()=>[window.reads,window.detailReads]);
    await page.evaluate(()=>window.completeCalendar());
    await page.waitForFunction(([a,b])=>window.reads===a+1&&window.detailReads===b+1,before);
    await page.waitForTimeout(100);
    const after=await page.evaluate(()=>[window.reads,window.detailReads]);
    assert.deepEqual(after,before.map(n=>n+1),'one snapshot/detail refresh after Calendar success: '+view);
    await page.evaluate(async()=>{window.clearCalendarFeedback();await window.completeCalendar(false);});
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(()=>[window.reads,window.detailReads]),after,'no refresh for feedback expiry/error: '+view);
  }
  console.log('PASS reconciled Calendar refresh: home/planning/interactions/referrals refresh once per success, none for errors or expired feedback');
  console.log('PASS UI-STRUCT-01: two home cards at 1440/768 and stacked 375/390, planning/activity/referral variants, temporal controls, carried filters and five links');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS mounted Edge: initial load, Contactos/Oportunidades return reads, retry, unmount/late response, empty/legacy, 320px, keyboard, no external transport');
  console.log('Screenshots: '+shots);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
  if(path.dirname(output)===path.resolve(os.tmpdir())&&path.basename(output).startsWith('coffeecito-tracking-browser-'))fs.rmSync(output,{recursive:true,force:true});
});
