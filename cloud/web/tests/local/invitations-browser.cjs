// Local synthetic UI only. No .env files, remote requests, Auth or provider operations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const localRequire = createRequire(path.join(root, 'package.json'));
const webpackBundle = localRequire('next/dist/compiled/webpack/webpack');
const webpack = webpackBundle.webpack;
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'coffeecito-invitations-ui-'));
const asImport = (file) => JSON.stringify(path.join(root, file).replaceAll('\\', '/'));
fs.writeFileSync(path.join(output, 'loader.cjs'), `const ts=require(${JSON.stringify(localRequire.resolve('typescript'))}); module.exports=function(src){return ts.transpileModule(src,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;};`);
fs.writeFileSync(path.join(output, 'providers.tsx'), `
import React from 'react';
export const OnboardingProvider = ({children}) => children;
export const InteractionSyncPreferencesProvider = OnboardingProvider;
export const SystemAccessProvider = OnboardingProvider;
export const useOnboarding = () => ({loading:false,routeReady:true,replay:()=>{window.replayed=true}});
export const useSystemAccess = () => ({status:'ready',grantedCapabilities:['admin.manage_access']});
export const ActivitySyncButton = () => <button className="button secondary square" aria-label="Sincronización simulada">↻</button>;
export const usePathname = () => '/contactos';
export const useRouter = () => ({replace:()=>{}});
export default function Link(props){return <a {...props}/>;}
`);
fs.writeFileSync(path.join(output, 'supabase.ts'), `
import {CURRENT_LEGAL_CONTRACT as legal} from ${asImport('lib/legalContract.ts')};
const scenario = new URLSearchParams(location.search).get('scenario') || 'normal';
window.calls=[]; window.authorizeCalls=0; window.adminPermission=true;
let session={user:{id:'synthetic-user',email:'owner@example.invalid'}};
let listener=()=>{};
const row=(id,email,status='pending')=>({id,email,status,authorized_at:new Date().toISOString(),expires_at:status==='pending'?new Date(Date.now()+48*3600000).toISOString():null,registered_at:status==='registered'?new Date().toISOString():null});
let state={personal_limit:5,used_slots:3,available_slots:2,next_expiry_at:new Date(Date.now()+48*3600000).toISOString(),global_capacity:500,used_capacity:3,invitations_enabled:true,registrations_enabled:true,invitations:[row('1','persona.uno@example.invalid'),row('2','persona.con.nombre.muy.largo.para.revisar.el.diseno@subdominio.de.ejemplo.example.invalid'),row('3','persona.tres@example.invalid','registered')]};
const adminState=()=>({invitations_enabled:state.invitations_enabled,registrations_enabled:state.registrations_enabled,global_capacity:state.global_capacity,pending_reservations:2,registered_users:1,used_capacity:3,available_capacity:state.global_capacity-3,updated_at:new Date().toISOString()});
if(scenario==='empty')state={...state,used_slots:0,available_slots:5,invitations:[]};
if(scenario==='paused')state.invitations_enabled=false;
if(scenario==='suspended')state.registrations_enabled=false;
if(scenario==='full')state.used_capacity=500;
if(scenario==='exhausted')state.available_slots=0;
if(scenario.startsWith('admin')){state.invitations_enabled=false;state.registrations_enabled=false;}
window.switchUser=()=>{session={user:{id:'other-synthetic',email:'other@example.invalid'}};listener('SIGNED_IN',session);};
window.releaseBootstrap=()=>{};
export const supabaseConfigError='';
export const supabase={
 auth:{getSession:async()=>({data:{session:scenario==='public'?null:session},error:null}),onAuthStateChange:(callback)=>{listener=callback;return {data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({error:null})},
 rpc:async(name,args)=>{
  window.calls.push({name,args});
  if(name==='current_user_has_capability')return {data:scenario!=='denied'&&window.adminPermission,error:null};
  if(name==='bootstrap_current_user_invitation_v1'){
   if(scenario==='bootstrap-wait')await new Promise(resolve=>{window.releaseBootstrap=resolve});
   return {data:[{allowed:scenario!=='guest-denied'&&session.user.id!=='other-synthetic',reason:'synthetic'}],error:null};
  }
  if(name==='current_user_app_access_status')return {data:[{allowed:true,reason:'allowed'}],error:null};
  if(name==='current_user_legal_acceptance_status_v1')return {data:[{accepted:true,accepted_at:'2026-10-25T12:00:00Z',terms_version:legal.termsVersion,privacy_version:legal.privacyVersion,terms_sha256:legal.termsSha256,privacy_sha256:legal.privacySha256}],error:null};
  if(name==='current_user_invitation_state_v1'){
   if(scenario==='loading')await new Promise(resolve=>{window.releaseLoad=resolve});
   if(scenario==='denied'||scenario==='admin-read-denied')return {data:null,error:{message:'invitation_capability_required'}};
   return {data:structuredClone(state),error:null};
  }
  if(name==='admin_invitation_program_state_v1'){
   if(scenario==='admin-read-denied')return {data:null,error:{message:'admin_manage_access_required'}};
   return {data:adminState(),error:null};
  }
  if(name==='authorize_current_user_invitation_v1'){
   window.authorizeCalls++;
   await new Promise(resolve=>setTimeout(resolve,80));
   if(scenario==='unavailable')return {data:null,error:{message:'invitation_email_blocked'}};
   const existing=state.invitations.find(row=>row.email===args.p_email);
   const created=existing||row('new',args.p_email);
   if(!existing){state.invitations.unshift(created);state.available_slots--;state.used_slots++;}
   if(scenario==='uncertain')throw new Error('simulated lost response');
   return {data:{...structuredClone(state),result:existing?'existing':'authorized',invitation_id:created.id},error:null};
  }
  if(name==='admin_update_invitation_program_v1'){state={...state,invitations_enabled:args.p_invitations_enabled,registrations_enabled:args.p_registrations_enabled,global_capacity:args.p_global_capacity};return {data:state,error:null};}
  if(name==='admin_cancel_invitation_v1'||name==='admin_lift_invitation_email_block_v1')return {data:{result:'synthetic'},error:null};
  throw new Error('Unexpected RPC '+name);
 }
};`);
fs.writeFileSync(path.join(output, 'entry.tsx'), `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Shell} from ${asImport('components/Shell.tsx')};
import {AuthGate} from ${asImport('components/AuthGate.tsx')};
import {InvitationAdminPanel} from ${asImport('components/InvitationAdminPanel.tsx')};
const scenario=new URLSearchParams(location.search).get('scenario');
createRoot(document.getElementById('root')).render(<AuthGate><Shell>{scenario?.startsWith('admin')?<InvitationAdminPanel/>:<section><h1>Contactos de prueba</h1><p>Datos sintéticos locales.</p></section>}</Shell></AuthGate>);
`);

async function main() {
  await new Promise((resolve, reject) => {
    const compiler=webpack({ mode:'development', devtool:false, context:root, entry:path.join(output,'entry.tsx'),
      output:{path:output,filename:'bundle.js'}, resolve:{extensions:['.tsx','.ts','.js','.json'],modules:[path.join(root,'node_modules'),'node_modules']},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[path.join(output,'loader.cjs')]}]},
      plugins:[new webpack.NormalModuleReplacementPlugin(/supabaseClient(?:\.ts)?$/,path.join(output,'supabase.ts')),
        new webpack.NormalModuleReplacementPlugin(/(?:OnboardingProvider|SystemAccess|InteractionSyncPreferencesProvider|ActivitySyncButton)$|^next\/(?:link|navigation)$/,path.join(output,'providers.tsx')),
        new webpack.DefinePlugin({'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY':JSON.stringify('')})] });
    compiler.run((error,stats)=>{compiler.close(()=>{}); if(error||stats.hasErrors())reject(error||new Error(stats.toString({all:false,errors:true})));else resolve();});
  });
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const files={'/bundle.js':[path.join(output,'bundle.js'),'text/javascript'],
      '/app/globals.css':[path.join(root,'app/globals.css'),'text/css'],
      '/styles/tokens.css':[path.join(root,'styles/tokens.css'),'text/css'],
      '/styles/components.css':[path.join(root,'styles/components.css'),'text/css'],
      '/styles/invitations.css':[path.join(root,'styles/invitations.css'),'text/css'],
      '/brand/coffeecito-isotipo.svg':[path.join(root,'public/brand/coffeecito-isotipo.svg'),'image/svg+xml']};
    if(files[pathname]){res.setHeader('Content-Type',files[pathname][1]);res.end(fs.readFileSync(files[pathname][0]));}
    else if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/globals.css"><title>INV-01 local fixtures</title><div id="root"></div><script src="/bundle.js"></script></html>');}
    else{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/`;
  console.log(JSON.stringify({url,artifacts:output,syntheticOnly:true}));
  if(process.argv.includes('--serve'))return;
  let browser;
  try {
    const playwrightPath=process.env.INV_PLAYWRIGHT_MODULE || 'playwright';
    const {chromium}=require(playwrightPath);
    browser=await chromium.launch({channel:'msedge',headless:true});
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const goto=async(scenario='normal')=>{await page.goto(url+'?scenario='+scenario);await page.getByText('Contactos de prueba',{exact:true}).waitFor();};
    const open=async()=>{await page.getByRole('button',{name:/Invitar a Coffeecito/}).click();await page.getByRole('heading',{name:'Invitar a Coffeecito'}).waitFor();};
    await goto();
    await page.getByRole('button',{name:'Ver tutorial',exact:true}).waitFor();
    await page.getByRole('link',{name:'Sistema',exact:true}).waitFor();
    await page.getByRole('button',{name:'Sincronización simulada',exact:true}).waitFor();
    await page.getByRole('button',{name:'Ver tutorial',exact:true}).focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button',{name:'Ver tutorial',exact:true}).isVisible(),true);
    await page.screenshot({path:path.join(output,'desktop-header.png')});
    await open();
    await page.getByLabel('Email',{exact:true}).fill('new.person@example.invalid');
    await page.getByRole('button',{name:'Autorizar',exact:true}).dblclick();
    await page.getByRole('button',{name:'este link!'}).waitFor();
    assert.equal(await page.evaluate(()=>window.authorizeCalls),1);
    await page.getByLabel('Email',{exact:true}).fill('different@example.invalid');
    await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));
    await page.getByRole('button',{name:'este link!'}).click();
    const mail=await page.getByRole('link',{name:'Correo',exact:true}).getAttribute('href');
    assert.ok(mail.includes('new.person%40example.invalid')&&!mail.includes('different'));
    await page.screenshot({path:path.join(output,'desktop-share.png')});
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button',{name:'este link!'}).evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button',{name:/Invitar a Coffeecito/}).evaluate(el=>el===document.activeElement),true);
    await page.setViewportSize({width:320,height:740});await open();
    await page.screenshot({path:path.join(output,'mobile-dialog.png')});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.locator('dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await page.getByRole('button',{name:'Cerrar invitaciones',exact:true}).focus();await page.keyboard.press('Shift+Tab');
    assert.equal(await page.getByRole('button',{name:'Listo',exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Cerrar invitaciones',exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Escape');await page.getByLabel('Más acciones',{exact:true}).click();
    await page.getByRole('button',{name:'Ver tutorial',exact:true}).waitFor();
    await page.screenshot({path:path.join(output,'mobile-header.png')});
    for(const scenario of ['paused','suspended','full','exhausted','empty','unavailable','uncertain']){
      await goto(scenario);await open();
      if(['paused','full','exhausted'].includes(scenario))assert.equal(await page.getByRole('button',{name:'Autorizar',exact:true}).isDisabled(),true);
      if(scenario==='suspended')assert.equal(await page.getByRole('button',{name:'Autorizar',exact:true}).isEnabled(),true);
      if(scenario==='empty')await page.getByText('Aún no hay invitaciones.').waitFor();
      if(['unavailable','uncertain'].includes(scenario)){
        await page.getByLabel('Email',{exact:true}).fill('new.person@example.invalid');await page.getByRole('button',{name:'Autorizar',exact:true}).click();
        await page.getByRole('button',{name:'Revisar estado',exact:true}).waitFor();
        if(scenario==='unavailable')await page.getByText('No podemos autorizar este email.',{exact:true}).waitFor();
        else{await page.getByRole('button',{name:'Revisar estado',exact:true}).click();await page.getByRole('button',{name:'este link!'}).waitFor();assert.equal(await page.evaluate(()=>window.authorizeCalls),1);}
      }
      await page.screenshot({path:path.join(output,scenario+'.png')});
    }
    await goto();await open();await page.getByLabel('Email',{exact:true}).fill('invalid');await page.getByRole('button',{name:'Autorizar',exact:true}).click();
    await page.getByText('Introduce un email válido.').waitFor();assert.equal(await page.evaluate(()=>window.authorizeCalls),0);
    // Equivalent CSS viewport of a 640x900 window at 200% browser zoom.
    await page.setViewportSize({width:320,height:450});
    await page.screenshot({path:path.join(output,'zoom200-equivalent.png')});
    assert.equal(await page.locator('dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await page.goto(url+'?scenario=bootstrap-wait');await page.getByText('Cargando...',{exact:true}).waitFor();
    assert.equal(await page.getByText('Contactos de prueba',{exact:true}).count(),0);
    assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.name)),['bootstrap_current_user_invitation_v1']);
    await page.evaluate(()=>window.releaseBootstrap());await page.getByText('Contactos de prueba',{exact:true}).waitFor();
    await page.evaluate(()=>window.switchUser());await page.getByText('Cargando...',{exact:true}).waitFor();
    await page.evaluate(()=>window.releaseBootstrap());await page.getByRole('heading',{name:'No pudimos confirmar tu acceso'}).waitFor();
    assert.equal(await page.getByText('Contactos de prueba',{exact:true}).count(),0);
    await page.goto(url+'?scenario=admin');await page.getByRole('heading',{name:'Invitaciones Beta'}).waitFor();
    assert.equal(await page.getByLabel('Permitir nuevas invitaciones').isChecked(),false);
    assert.equal(await page.getByLabel('Permitir nuevos registros por invitación').isChecked(),false);
    assert.equal(await page.evaluate(()=>window.calls.some(c=>c.name.startsWith('admin_')&&c.name!=='admin_invitation_program_state_v1')),false);
    page.on('dialog',dialog=>dialog.accept());
    await page.getByLabel('Capacidad global',{exact:true}).fill('600');
    await page.getByRole('button',{name:'Guardar controles',exact:true}).click();
    await page.getByText('Operación confirmada.',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.name.startsWith('admin_')&&c.name!=='admin_invitation_program_state_v1')),[
      {name:'admin_update_invitation_program_v1',args:{p_invitations_enabled:false,p_registrations_enabled:false,p_global_capacity:600}}
    ]);
    await page.evaluate(()=>window.adminPermission=false);
    await page.getByRole('button',{name:'Guardar controles',exact:true}).click();
    await page.getByText('No tienes permiso para gestionar invitaciones.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name.startsWith('admin_')&&c.name!=='admin_invitation_program_state_v1').length),1);
    await page.goto(url+'?scenario=admin-read-denied');
    await page.getByText('No pudimos consultar el programa. Los controles permanecen bloqueados.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Guardar controles',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>window.calls.some(c=>c.name.startsWith('admin_')&&c.name!=='admin_invitation_program_state_v1')),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: real components; desktop/320px/zoom; focus/Escape; single mutation; sharing identity; uncertainty reconciliation; restrictions; bootstrap/private mounting; admin inert/read denial/revocation.');
  } finally { if(browser)await browser.close();await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
