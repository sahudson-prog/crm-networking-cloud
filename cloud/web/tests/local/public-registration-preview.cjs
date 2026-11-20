// Synthetic local preview. Never reads .env, creates an actual Supabase client or uses external services.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const localRequire = createRequire(path.join(root, 'package.json'));
const webpack = localRequire('next/dist/compiled/webpack/webpack').webpack;
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'coffeecito-reg-open-preview-'));
const source = file => JSON.stringify(path.join(root, file).replaceAll('\\', '/'));
const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1] || 3103);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3000, 3001, 3002].includes(port)) throw Error('Use an unused port outside 3000/3001/3002');

fs.writeFileSync(path.join(output, 'loader.cjs'), `const ts=require(${JSON.stringify(localRequire.resolve('typescript'))});module.exports=src=>ts.transpileModule(src,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
fs.writeFileSync(path.join(output, 'link.tsx'), `import React from 'react';export default function Link(props){return <a {...props}/>;}`);
fs.writeFileSync(path.join(output, 'google.ts'), `export const clearRememberedGoogleRequestedScopes=()=>{};export const signInWithGoogleForAuth=async()=>{window.fixtureSignIn='google';};`);
fs.writeFileSync(path.join(output, 'supabase.ts'), `
const query=new URLSearchParams(location.search);
const scenario=query.get('scenario')||'off';
const view=query.get('view')||'landing';
let state={enabled:scenario==='on',revision:4};
window.fixtureCalls=[];window.fixturePermission=true;window.fixtureRecovered=false;
window.fixtureReleaseWrite=()=>{};
window.fixtureRecover=()=>{window.fixturePermission=true;window.fixtureRecovered=true;};
const result=(data,error=null)=>({data,error});
export const supabaseConfigError='';
export const supabase={
 auth:{getSession:async()=>({data:{session:view==='admin'?{user:{id:'synthetic-admin',email:'admin@example.invalid'}}:null},error:null}),
 onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null}),
 signInWithOtp:async()=>{window.fixtureSignIn='email';return {error:null};}},
 rpc:async(name,args)=>{
  window.fixtureCalls.push({name,args});
  if(name==='current_user_has_capability'){
   if(scenario==='permission-error'&&!window.fixtureRecovered)return result(null,{message:'synthetic permission lookup failed'});
   return result(window.fixturePermission&&(scenario!=='denied'||window.fixtureRecovered));
  }
  if(name==='public_registration_status_v1'){
   if(scenario==='loading')return new Promise(()=>{});
   if(scenario==='error')return result(null,{code:'PGRST202',message:'synthetic missing RPC'});
   return result({enabled:state.enabled});
  }
  if(name==='admin_public_registration_state_v1'){
   if((scenario==='error'||scenario==='read-denied')&&!window.fixtureRecovered)return result(null,{code:'42501'});
   if(scenario==='reconcile-error'&&window.fixtureCalls.some(call=>call.name==='admin_set_public_registration_v1')&&!window.fixtureRecovered)return result(null,{code:'PGRST202'});
   return result({...state});
  }
  if(name==='admin_set_public_registration_v1'){
   if(args.p_expected_revision!==state.revision)return result(null,{message:'public_registration_revision_conflict'});
   if(scenario==='conflict'){state={enabled:false,revision:state.revision+1};return result(null,{message:'public_registration_revision_conflict'});}
   if(scenario==='timeout')await new Promise(resolve=>{window.fixtureReleaseWrite=resolve;});
   state={enabled:args.p_enabled,revision:state.revision+1};
   if(scenario==='ambiguous'||scenario==='reconcile-error')throw Error('synthetic lost response');
   return result({...state});
  }
  throw Error('Unexpected fixture RPC: '+name);
 }
};`);
fs.writeFileSync(path.join(output, 'entry.tsx'), `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {PublicLanding} from ${source('components/PublicLanding.tsx')};
import {PublicRegistrationAdminPanel} from ${source('components/PublicRegistrationAdminPanel.tsx')};
import {AuthGate} from ${source('components/AuthGate.tsx')};
const view=new URLSearchParams(location.search).get('view')||'landing';
createRoot(document.getElementById('root')).render(view==='admin'
 ? <main style={{maxWidth:900,margin:'24px auto',padding:16}}><PublicRegistrationAdminPanel/></main>
 : view==='login'?<AuthGate><p>Private fixture must remain unmounted</p></AuthGate>:<PublicLanding/>);
`);

async function main() {
  await new Promise((resolve, reject) => {
    const compiler = webpack({mode:'development',devtool:false,context:root,entry:path.join(output,'entry.tsx'),
      output:{path:output,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js','.json'],modules:[path.join(root,'node_modules'),'node_modules']},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[path.join(output,'loader.cjs')]}]},
      plugins:[new webpack.NormalModuleReplacementPlugin(/supabaseClient(?:\.ts)?$/,path.join(output,'supabase.ts')),
        new webpack.NormalModuleReplacementPlugin(/^next\/link$/,path.join(output,'link.tsx')),
        new webpack.NormalModuleReplacementPlugin(/googleAuthSession(?:\.ts)?$/,path.join(output,'google.ts')),
        new webpack.DefinePlugin({'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY':JSON.stringify('')})]});
    compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  const mime={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'};
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'");
    if(pathname==='/'||pathname==='/ingresar'){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/globals.css"><link rel="stylesheet" href="/swiper.css"><title>REG-OPEN-01 local synthetic preview</title><div id="root"></div><script src="/bundle.js"></script></html>');return;
    }
    let file;
    if(pathname==='/bundle.js')file=path.join(output,'bundle.js');
    else if(pathname==='/swiper.css')file=localRequire.resolve('swiper/css');
    else if(pathname==='/app/globals.css')file=path.join(root,'app/globals.css');
    else if(/^\/styles\/[a-z0-9-]+\.css$/.test(pathname))file=path.join(root,pathname.slice(1));
    else if(/^\/(brand|landing)\/[a-z0-9-]+\.(svg|webp|png)$/.test(pathname))file=path.join(root,'public',pathname.slice(1));
    if(!file||!fs.existsSync(file)){res.statusCode=404;res.end('Not found');return;}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  server.on('error',error=>{console.error(error);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+port,output,syntheticOnly:true,
    views:['landing','login','admin'],scenarios:['on','off','error','loading','denied','permission-error','read-denied','ambiguous','conflict','reconcile-error','timeout']})));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
