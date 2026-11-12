// Focused visual checks on the existing isolated shell harness; no live DEV session.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
export async function runShellVisualCorrection({page,context,dir}) {
 const evidence=[];
 await page.evaluate(()=>{
  window.visualCorrection=true;
  window.companyContacts=[
   {id:'c1',company:'Empresa sintética con una denominación extraordinariamente larga '.repeat(5),networking_status:'Contactado',last_interaction_at:'2026-11-01T12:00:00Z',days_since_last_interaction:10},
   {id:'c2',company:'Empresa sintética con una denominación extraordinariamente larga '.repeat(5),networking_status:'Agendado',last_interaction_at:'2026-11-10T12:00:00Z',days_since_last_interaction:1},
   {id:'c3',company:'Beta sintética',networking_status:'Pendiente',last_interaction_at:null,days_since_last_interaction:null},
   {id:'c4',company:'Gamma sintética',networking_status:'Cita concretada',last_interaction_at:'2026-10-01T12:00:00Z',days_since_last_interaction:41}
  ];window.originalHeader=document.querySelector('.shell-header-v2');window.navigate('/contactos');
 });
 const table=page.getByRole('table',{name:'Empresas de los contactos'}),filter=page.getByRole('button',{name:'Filtros',exact:true});
 await table.waitFor();
 const appearance=()=>filter.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,border:s.border,bg:s.backgroundColor,animation:s.animationName,after:getComputedStyle(e,'::after').content};});
 const inactive=await appearance();assert.equal(inactive.animation,'none');assert.equal(inactive.after,'none');
 await filter.click();await page.getByLabel('Headhunter',{exact:true}).selectOption('true');await page.getByRole('button',{name:'Cerrar filtros'}).click();
 assert.equal(await filter.getAttribute('data-filters-active'),'true');
 const active=await appearance();assert.deepEqual({...active,bg:'',animation:'',after:''},{...inactive,bg:'',animation:'',after:''});assert.equal(active.bg,'rgba(139, 92, 190, 0.1)');
 const animation=await filter.evaluate(e=>{
  const own=e.getAnimations({subtree:true});const glow=own.find(a=>a.animationName==='shell-filter-active-glow'),sheen=own.find(a=>a.animationName==='shell-filter-active-sheen');
  if(!glow||!sheen)throw Error('Missing active animations');glow.pause();sheen.pause();
  const frames=[0,1000,2000,3000].map(t=>{glow.currentTime=t;sheen.currentTime=t;const s=getComputedStyle(e),p=getComputedStyle(e,'::after');return {t,shadow:s.boxShadow,left:parseFloat(p.left),width:parseFloat(p.width),skew:p.transform};});
  const p=getComputedStyle(e,'::after');return {frames,glowDuration:glow.effect.getTiming().duration,sheenDuration:sheen.effect.getTiming().duration,pointer:p.pointerEvents,overflow:getComputedStyle(e).overflow,gradient:p.backgroundImage};
 });
 assert.equal(animation.glowDuration,4000);assert.equal(animation.sheenDuration,4000);assert.equal(animation.pointer,'none');assert.equal(animation.overflow,'hidden');assert.match(animation.gradient,/0.45/);
 assert.match(animation.frames[0].shadow,/0\.16.*0px 0px 8px 1px/);assert.match(animation.frames[2].shadow,/0\.28.*0px 0px 15px 3px/);
 assert.ok(animation.frames[0].left<0);assert.ok(animation.frames[2].left>active.w);assert.equal(animation.frames[2].left,animation.frames[3].left);
 await filter.hover();assert.doesNotMatch(await filter.evaluate(e=>getComputedStyle(e).boxShadow),/89, 112, 134/);
 await page.mouse.move(1400,890);
 for(const width of [1440,768,390,375,320]){
  await page.setViewportSize({width,height:width===1440?900:width===768?1024:width===375?812:844});
  await page.waitForFunction(w=>(document.querySelector('nav').getBoundingClientRect().y>200)===(w<=760),width);
  const metrics=await page.evaluate(()=>{
   const top=document.querySelector('.shell-top-region'),s=getComputedStyle(top),region=top.getBoundingClientRect(),nav=document.querySelector('nav'),main=document.querySelector('#workspace-main'),t=document.querySelector('.companies-table'),cells=[...t.querySelector('thead tr').cells].map(c=>c.getBoundingClientRect().width);
   const last=t.querySelector('th:last-child button'),span=last.querySelector('span'),name=document.querySelector('.companies-name-value[title^="Empresa"]'),panel=document.querySelector('.companies-block');
   return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,body:getComputedStyle(document.body).backgroundColor,html:getComputedStyle(document.documentElement).backgroundColor,header:s.backgroundColor,headerShadow:getComputedStyle(top,"::before").boxShadow,border:getComputedStyle(top,'::after').height,borderColor:getComputedStyle(top,'::after').backgroundColor,
    panel:getComputedStyle(panel).backgroundColor,panelBorder:getComputedStyle(panel).borderColor,panelShadow:getComputedStyle(panel).boxShadow,navBackground:getComputedStyle(nav).backgroundColor,navBeforeMain:!!(nav.compareDocumentPosition(main)&Node.DOCUMENT_POSITION_FOLLOWING),
    cells,total:t.getBoundingClientRect().width,checkbox:getComputedStyle(t.querySelector('input')).width,lastFits:last.scrollWidth<=last.clientWidth,labelHeight:span.getBoundingClientRect().height,nameTruncated:name.scrollWidth>name.clientWidth,fullName:name.title,
    continuous:[...top.querySelectorAll('.shell-header-v2,.shell-toolbar')].every(e=>{const b=e.getBoundingClientRect();return b.top>=region.top&&b.bottom<=region.bottom;})};
  });
  assert.equal(metrics.overflow,false);assert.equal(metrics.body,'rgb(255, 253, 251)');assert.equal(metrics.html,metrics.body);assert.equal(metrics.header,'rgb(250, 244, 236)');assert.match(metrics.headerShadow,/250, 244, 236/);assert.equal(metrics.border,'1px');assert.equal(metrics.borderColor,'rgb(217, 222, 232)');assert.equal(metrics.panel,'rgb(255, 255, 255)');assert.notEqual(metrics.panelShadow,'none');assert.equal(metrics.continuous,true);
  assert.equal(metrics.navBeforeMain,width>760);if(width<=760)assert.equal(metrics.navBackground,'rgb(255, 255, 255)');
  assert.ok(Math.abs(metrics.cells[0]-42)<1);assert.equal(metrics.checkbox,'16px');for(const [i,fraction] of [.36,.12,.28,.24].entries())assert.ok(Math.abs(metrics.cells[i+1]-(metrics.total-42)*fraction)<1,JSON.stringify(metrics));assert.equal(metrics.lastFits,true);assert.ok(metrics.labelHeight<25);assert.equal(metrics.nameTruncated,true);assert.ok(metrics.fullName.length>100);
  const wrap=table.locator('..');assert.ok(await wrap.evaluate(e=>{e.scrollLeft=e.scrollWidth;const ok=e.scrollWidth<=e.clientWidth||e.scrollLeft>0;e.scrollLeft=0;return ok;}));
  const coach=await page.evaluate(()=>{
   const btn=document.querySelector('.shell-coach-trigger'),face=btn.querySelector('.coach-bot-head'),ant=btn.querySelector('.coach-bot-antenna'),bubble=btn.querySelector('.shell-coach-count'),r=ant.getBoundingClientRect(),p=getComputedStyle(ant,'::after'),f=face.getBoundingClientRect(),b=bubble.getBoundingClientRect(),trigger=btn.getBoundingClientRect();
   // Existing antenna has a 10px tip plus a 4px halo, scaled with the face.
   const tip={left:r.x+r.width/2-9*.375,right:r.x+r.width/2+9*.375,top:r.y+(parseFloat(p.top)-4)*.375,bottom:r.y+(parseFloat(p.top)+14)*.375};
   const intersections=[tip,...[...face.querySelectorAll('.coach-bot-eye,.coach-bot-mouth')].map(e=>e.getBoundingClientRect())].some(a=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top);
   return {tip,bubble:b.toJSON(),features:[...face.querySelectorAll(".coach-bot-eye,.coach-bot-mouth")].map(e=>e.getBoundingClientRect().toJSON()),button:trigger.width,faceWidth:f.width,faceHeight:f.height,antennaTop:tip.top,buttonTop:trigger.top,bubbleIntersects:intersections,overflow:getComputedStyle(btn.querySelector('.shell-coach-face')).overflow,mouthAnimation:getComputedStyle(face.querySelector('.coach-bot-mouth')).animationName};
  });
  await page.locator('.shell-header-v2').screenshot({path:path.join(dir,`coach-geometry-${width}.png`)});
  assert.equal(coach.button,width>760?36:44);assert.equal(coach.faceWidth,24);assert.equal(coach.faceHeight,19.5);assert.ok(coach.antennaTop>=coach.buttonTop);assert.equal(coach.overflow,'visible');assert.equal(coach.bubbleIntersects,false,JSON.stringify(coach));assert.equal(coach.mouthAnimation,'coachTalk');
  // Put the reflection at the midpoint of its traversal for the evidence.
  await filter.evaluate(e=>e.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=1000;}));
  await page.screenshot({path:path.join(dir,`final-visual-${width}.png`),fullPage:true});
  const sync=page.getByRole('button',{name:'Sincronización',exact:true});await sync.click();
  const syncPopover=page.getByRole('dialog',{name:'Estado de sincronización'});await syncPopover.waitFor();
  assert.ok(await syncPopover.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.bottom-10));}),'existing inline Sync popup is not clipped or covered '+width);
  assert.equal(await page.evaluate(()=>window.syncCalls),0);await sync.click();
  evidence.push({width,metrics,coach});
 }
 await page.setViewportSize({width:1440,height:900});
 const longRow=table.locator('tbody tr').filter({has:page.locator('.companies-name-value[title^="Empresa"]')});assert.equal(await longRow.locator('td').nth(2).innerText(),'2');assert.match(await longRow.locator('td').nth(3).innerText(),/Agendado/);assert.equal(await longRow.locator('td').nth(4).innerText(),'1d');
 await longRow.getByRole('checkbox').check();await table.getByRole('button',{name:'Contactos',exact:true}).click();await table.getByRole('button',{name:'Contactos',exact:true}).click();assert.equal(await longRow.getByRole('checkbox').isChecked(),true);
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await filter.evaluate(e=>getComputedStyle(e).animationName),'none');assert.equal(await filter.evaluate(e=>getComputedStyle(e,'::after').animationName),'none');assert.equal(await filter.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(139, 92, 190, 0.1)');assert.notEqual(await filter.evaluate(e=>getComputedStyle(e).boxShadow),'none');assert.equal(await page.locator('.shell-coach-face .coach-bot-mouth').evaluate(e=>getComputedStyle(e).animationName),'none');
 await page.screenshot({path:path.join(dir,'final-reduced-motion.png')});await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{window.savedTodos=window.todos;window.todos=[];window.workspace.refresh();});await page.getByRole('button',{name:'Coach: 0 sugerencias pendientes'}).waitFor();assert.equal(await page.locator('.shell-coach-count').count(),0);assert.equal(await page.locator('.shell-coach-face .coach-bot-mouth').evaluate(e=>getComputedStyle(e).height),'2px');assert.equal(await page.locator('.shell-coach-face .coach-bot-mouth').evaluate(e=>getComputedStyle(e).animationName),'none');await page.locator('.shell-header-v2').screenshot({path:path.join(dir,'final-coach-zero.png')});
 await page.evaluate(()=>{window.todos=window.savedTodos;window.workspace.refresh();});await page.getByRole('button',{name:'Coach: 2 sugerencias pendientes'}).waitFor();await page.locator('.shell-header-v2').screenshot({path:path.join(dir,'final-coach-pending.png')});
 await filter.click();await page.getByRole('button',{name:'Restablecer filtros'}).click();await page.getByRole('button',{name:'Cerrar filtros'}).click();assert.equal(await filter.getAttribute('data-filters-active'),null);assert.equal((await appearance()).animation,'none');assert.equal((await appearance()).after,'none');await page.screenshot({path:path.join(dir,'final-inactive.png')});
 // Focused navigation/Sync preservation; the Sync adapter has no provider transport.
 await page.getByRole('link',{name:'Planificar',exact:true}).click();assert.equal(await filter.getAttribute('data-filters-active'),null);await page.getByRole('button',{name:'Cuenta',exact:true}).click();await page.getByRole('menuitem',{name:'Configuración',exact:true}).click();await page.getByRole('button',{name:'Sincronización',exact:true}).click();await page.getByRole('dialog',{name:'Estado de sincronización'}).waitFor();
 assert.deepEqual(await page.evaluate(()=>({same:window.originalHeader===document.querySelector('.shell-header-v2'),mounts:window.syncMounts,unmounts:window.syncUnmounts,calls:window.syncCalls})),{same:true,mounts:1,unmounts:0,calls:0});
 const legacy=await context.newPage();await legacy.goto('http://127.0.0.1:43582/onboarding?legacy=1');await legacy.locator('.topbar').waitFor();assert.equal(await legacy.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(246, 247, 251)');await legacy.close();
 // Unmount the private shell and confirm the scoped page color disappears.
 await page.evaluate(()=>window.navigate('/public-fixture'));assert.equal(await page.locator('.application-shell-v2').count(),0);assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(246, 247, 251)');
 fs.writeFileSync(path.join(dir,'final-visual-measurements.json'),JSON.stringify({animation,evidence},null,2));
 console.log('PASS Cream continuity/private Warm White, white panels/mobile nav, optional-filter tint/glow/sheen/reduced motion, BF11 proportions/scroll/selection, Coach antenna/zero/pending, persistent navigation/Sync adapter.');
}