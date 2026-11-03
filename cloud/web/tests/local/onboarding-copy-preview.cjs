// Synthetic, loopback-only visual fixture. No credentials, Auth or remote reads.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'package.json'));
const { webpack } = req('next/dist/compiled/webpack/webpack');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'coffeecito-onboarding-copy-'));
const baseline = 'e0092dbb8b4b8530ad0fdc66a9690a76322ec9b4';
const original = file => execFileSync('git', ['show', `${baseline}:cloud/web/${file}`], { cwd: root, encoding: 'utf8' });
const write = (name, content) => fs.writeFileSync(path.join(output, name), content);
const imp = name => JSON.stringify(path.join(root, name).replaceAll('\\', '/'));
const files = ['components/OnboardingIntroSlides.tsx', 'components/OnboardingRoutePage.tsx',
  'components/CoachPreview.tsx', 'components/StartingPointFields.tsx'];
const originals = Object.fromEntries(files.map(file => [path.join(root, file).toLowerCase(), original(file)]));
write('originals.json', JSON.stringify(originals));
write('loader.cjs', `const ts=require(${JSON.stringify(req.resolve('typescript'))});const originals=require('./originals.json');module.exports=function(src){if(this.getOptions().before)src=originals[this.resourcePath.toLowerCase()]||src;return ts.transpileModule(src,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;};`);
write('transport.ts', 'export const supabase=null;export const supabaseConfigError="Synthetic preview: no transport";');
write('data.ts', `export async function readContactListRows(){return [{id:'synthetic'}];}export async function readContactProfile(){return {contact:{id:'synthetic'}};}`);
write('fields.ts', `export async function readCurrentUserStartingPoint(){return {fullName:'Persona de prueba',professionalSituationCode:'employed',networkingStartDate:'2026-10-01'};}export async function saveCurrentUserStartingPoint(values){return values;}`);
write('fixtures.tsx', `import React,{createContext,useContext,useState,useEffect} from 'react';
const C=createContext(null);const steps=['intro','starting_point','objectives','google','contacts','contact','final'];
export function PreviewProvider({children}){const [step,setStep]=useState(new URLSearchParams(location.search).get('step')||'intro');const [done,setDone]=useState(false);return <C.Provider value={{step,done,loading:false,routeReady:true,loadFailed:false,error:'',replaying:new URLSearchParams(location.search).get('replay')!=='false',completing:false,start:()=>setStep('starting_point'),moveTo:async s=>setStep(s),openIntro:()=>setStep('intro'),exit:()=>setDone(true),complete:()=>setDone(true)}}>{children}</C.Provider>;}
export const useOnboarding=()=>useContext(C);export const OnboardingProvider=({children})=>children;
export const AuthGate=({children})=>children;export const Shell=({children})=><main className="app-shell">{children}</main>;
export function ObjectivesPage({onboardingCoach,onCycleReadyChange}){useEffect(()=>onCycleReadyChange?.(true),[onCycleReadyChange]);return <div className="objectives-page">{onboardingCoach}<section className="panel"><h2>Mi objetivo</h2><p>Contenido operativo sintético; no se guardan datos.</p></section></div>;}
export function ReadOnlyContacts({beforeList,onContactsResolved}){useEffect(()=>onContactsResolved?.([{id:'synthetic'}]),[onContactsResolved]);return <div className="onboarding-contacts-view">{beforeList}<section className="panel">Contactos de prueba</section></div>;}
export const ContactProfile=({onboardingCoach})=><div>{onboardingCoach}<section className="panel">Ficha de prueba</section></div>;
export const AccountPage=()=> <section className="panel"><h2>Contactos</h2><button className="button" disabled>Importar archivo vCard</button></section>;`);
write('entry.tsx', `import React from 'react';import {createRoot} from 'react-dom/client';import {OnboardingRoutePage} from ${imp('components/OnboardingRoutePage.tsx')};import {StartingPointFields} from ${imp('components/StartingPointFields.tsx')};import {PreviewProvider,useOnboarding} from './fixtures';function App(){const s=useOnboarding();return s.done?<p role="status">Recorrido sintético terminado</p>:new URLSearchParams(location.search).has('account')?<StartingPointFields mode="account"/>:<OnboardingRoutePage key={s.step} routeId={s.step}/>;}createRoot(document.getElementById('root')).render(<PreviewProvider><App/></PreviewProvider>);`);

async function build(before) {
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, context: root,
      entry: path.join(output, 'entry.tsx'), output: { path: output, filename: before ? 'before.js' : 'after.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js', '.json'], modules: [path.join(root, 'node_modules')] },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: path.join(output, 'loader.cjs'), options: { before } }] }] },
      plugins: [
        new webpack.NormalModuleReplacementPlugin(/(AuthGate|Shell|OnboardingProvider|ObjectivesPage|ReadOnlyContacts|ContactProfile|AccountPage)$/, path.join(output, 'fixtures.tsx')),
        new webpack.NormalModuleReplacementPlugin(/cloudData$/, path.join(output, 'data.ts')),
        new webpack.NormalModuleReplacementPlugin(/startingPointActions$/, path.join(output, 'fields.ts')),
        new webpack.NormalModuleReplacementPlugin(/supabaseClient(\.ts)?$/, path.join(output, 'transport.ts'))
      ] });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
      ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
}
async function main() {
  await build(true); await build(false);
  const beforeCss = original('styles/components.css');
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const before = url.pathname.startsWith('/before/');
    const pathname = url.pathname.replace(/^\/(before|after)(?=\/)/, '');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; font-src 'self'");
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Onboarding editorial - fixture ${before ? 'antes' : 'después'}</title><link rel="stylesheet" href="/${before ? 'before' : 'after'}/app/globals.css"><link rel="stylesheet" href="/swiper.css"><div id="root"></div><script src="/${before ? 'before' : 'after'}.js"></script></html>`); return;
    }
    const assets = { '/before.js': path.join(output, 'before.js'), '/after.js': path.join(output, 'after.js'),
      '/swiper.css': req.resolve('swiper/css/bundle'), '/styles/tokens.css': path.join(root, 'styles/tokens.css'),
      '/app/globals.css': path.join(root, 'app/globals.css'),
      '/styles/invitations.css': path.join(root, 'styles/invitations.css'),
      '/styles/tracking.css': path.join(root, 'styles/tracking.css'),
      '/styles/components.css': path.join(root, 'styles/components.css'),
      '/brand/coffeecito-isotipo.svg': path.join(root, 'public/brand/coffeecito-isotipo.svg'),
      '/brand/coffeecito-onboarding-bg.webp': path.join(root, 'public/brand/coffeecito-onboarding-bg.webp') };
    if (!assets[pathname]) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.svg') ? 'image/svg+xml' : pathname.endsWith('.webp') ? 'image/webp' : 'text/javascript');
    response.end(before && pathname === '/styles/components.css' ? beforeCss : fs.readFileSync(assets[pathname]));
  });
  server.listen(0, '127.0.0.1', () => console.log(`PREVIEW http://127.0.0.1:${server.address().port}/after/ (before: /before/)`));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
