// Local synthetic tables only; no app session, provider or remote request.
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),req=createRequire(path.join(root,'package.json'));
const {webpack}=req('next/dist/compiled/webpack/webpack');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coffeecito-planning-sort-ui-'));const imp=f=>JSON.stringify(path.join(root,f).replaceAll('\\','/'));const write=(name,s)=>fs.writeFileSync(path.join(dir,name),s);
let browser;
try{
write('loader.cjs',`const ts=require(${JSON.stringify(req.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
// Reuse the actual exported constants/labels; replace their transport imports only.
write('transport.ts',`export const supabase=null;export const supabaseConfigError='synthetic';`);
write('entry.tsx',`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ObjectiveMetricsTable} from ${imp('components/ObjectiveMetricsTable.tsx')};
import {HeadhunterCompanies} from ${imp('components/HeadhunterCompanies.tsx')};
import {TableSortHeader} from ${imp('components/ui/TableSortHeader.tsx')};
const priorities=[
 {objectiveId:'z',objectiveName:'Zulu',priorityLevel:'HIGH',contactCount:2,coffeeCount:1,objectiveType:'INDUSTRY',lastInteractionAt:'2026-01-01T12:00:00Z',daysSinceLastInteraction:45,networkingStatus:'Agendado'},
 {objectiveId:'a',objectiveName:'Alfa',priorityLevel:'LOW',contactCount:10,coffeeCount:10,objectiveType:'COMPANY',lastInteractionAt:'2026-02-01T12:00:00Z',daysSinceLastInteraction:14,networkingStatus:'Contactado'},
 {objectiveId:'n',objectiveName:'Sin actividad',priorityLevel:'MEDIUM',contactCount:0,coffeeCount:0,objectiveType:'ROLE',lastInteractionAt:null,daysSinceLastInteraction:null,networkingStatus:''}
].map(p=>({...p,focusContactCount:p.contactCount}));
const companies=[
 {domain:'zulu.test',contactCount:2,status:'Agendado',lastInteractionAt:'2026-01-01T12:00:00Z',daysSince:45,type:'message',subject:'Zulu'},
 {domain:'alfa.test',contactCount:10,status:'Contactado',lastInteractionAt:'2026-02-01T12:00:00Z',daysSince:14,type:'calendar',subject:'Alfa'},
 {domain:'missing.test',contactCount:1,status:'Pendiente',lastInteractionAt:null,daysSince:null,type:'',subject:''}
].map(c=>({...c,contactIds:[],interactionIds:[]}));
function App(){const [selected,setSelected]=useState(new Set()),[filtered,setFiltered]=useState(false);return <main className="app-shell"><button onClick={()=>setFiltered(v=>!v)}>Filtrar fixture</button><section id="priorities" className="panel"><h2>Progreso de tus prioridades</h2><ObjectiveMetricsTable rows={priorities} opportunityCounts={new Map([['a',2],['z',10]])}/></section><section id="companies" className="panel"><h2>Último contacto con Headhunters</h2><HeadhunterCompanies rows={filtered?companies.filter(c=>c.domain!=='zulu.test'):companies} selectedDomains={selected} onToggleDomain={id=>setSelected(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next;})} onClearSelection={()=>setSelected(new Set())}/></section></main>;}
createRoot(document.getElementById('root')).render(<App/>);`);
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',target:'web',devtool:false,context:root,entry:path.join(dir,'entry.tsx'),output:{path:dir,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js','.json'],modules:[path.join(root,'node_modules')]},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[path.join(dir,'loader.cjs')]}]},plugins:[new webpack.NormalModuleReplacementPlugin(/supabaseClient(\.ts)?$/,path.join(dir,'transport.ts'))]});compiler.run((e,s)=>compiler.close(()=>e||s.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve()));});
const {chromium}=req(process.env.OPPORTUNITY_PLAYWRIGHT_MODULE||'C:/Users/Sergio/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(5000);
await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!=='http://127.0.0.1:43583'){external.push(u.origin);return route.abort();}if(u.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(dir,'bundle.js'),'utf8')});if(u.pathname==='/style.css')return route.fulfill({contentType:'text/css',body:['styles/tokens.css','styles/components.css','styles/tracking.css'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n')+fs.readFileSync(path.join(root,'app/globals.css'),'utf8').replace(/^@import.*$/gm,'')});return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>'});});
await page.goto('http://127.0.0.1:43583/');const priorities=page.locator('#priorities'),companies=page.locator('#companies');await priorities.locator('tbody tr').first().waitFor();
const names=async(table,column)=>table.locator('tbody tr').evaluateAll((rows,i)=>rows.map(r=>r.cells[i].textContent.trim()),column);
assert.deepEqual(await names(priorities,0),['Zulu','Alfa']);assert.deepEqual(await names(companies,1),['missing.test','zulu.test','alfa.test']);assert.equal(await companies.locator('tbody tr').first().locator('td').nth(4).innerText(),'Sin registro');
await companies.getByRole('checkbox',{name:'Filtrar alfa.test',exact:true}).check();
for(const [table,count] of [[priorities,8],[companies,7]]){const buttons=table.locator('thead button');assert.equal(await buttons.count(),count);for(let i=0;i<count;i++){const button=buttons.nth(i),th=button.locator('..');const initial=await th.getAttribute('aria-sort');await button.click();const direction=await th.getAttribute('aria-sort');assert.equal(direction,initial==='ascending'?'descending':'ascending');await button.click();assert.equal(await th.getAttribute('aria-sort'),direction==='ascending'?'descending':'ascending');}}
// Manual counts are numeric, not a string comparison or the initial priority sort.
async function ascending(table,label){const button=table.getByRole('button',{name:label,exact:true});await button.click();if(await button.locator('..').getAttribute('aria-sort')!=='ascending')await button.click();}
await ascending(priorities,'Oportunidades');assert.deepEqual(await names(priorities,0),['Alfa','Zulu']);await priorities.getByRole('button',{name:'Oportunidades',exact:true}).click();assert.deepEqual(await names(priorities,0),['Zulu','Alfa']);
await priorities.getByRole('checkbox',{name:'Mostrar prioridades sin actividad'}).check();assert.equal(await priorities.locator('tbody tr').count(),3);await priorities.getByRole('checkbox',{name:'Mostrar prioridades sin actividad'}).uncheck();assert.equal(await priorities.locator('tbody tr').count(),2);
assert.equal(await companies.getByRole('checkbox',{name:'Filtrar alfa.test',exact:true}).isChecked(),true);await page.getByRole('button',{name:'Filtrar fixture'}).click();assert.equal(await companies.locator('tbody tr').count(),2);assert.equal(await companies.getByRole('checkbox',{name:'Filtrar alfa.test',exact:true}).isChecked(),true);await page.getByRole('button',{name:'Filtrar fixture'}).click();
await ascending(companies,'Contactos');assert.deepEqual(await names(companies,1),['missing.test','zulu.test','alfa.test']);await companies.getByRole('button',{name:'Contactos',exact:true}).click();assert.deepEqual(await names(companies,1),['alfa.test','zulu.test','missing.test']);
for(const width of [1440,768,390,375,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow '+width);for(const wrap of [priorities.locator('.objective-metrics-wrap'),companies.locator('.table-wrap')]){assert.ok(await wrap.evaluate(e=>{e.scrollLeft=e.scrollWidth;return e.scrollWidth<=e.clientWidth||e.scrollLeft>0;}),'table can scroll '+width);}
await page.screenshot({path:path.join(dir,`planning-${width}.png`),fullPage:true});}
await companies.getByRole('button',{name:'Limpiar empresas seleccionadas'}).click();assert.equal(await companies.getByRole('checkbox',{name:'Filtrar alfa.test',exact:true}).isChecked(),false);
assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS planning tables: all 15 data headers toggle, numeric/manual ordering, initial order, empty values, inactive toggle, selection/filter preservation, responsive scroll 1440/768/390/375/320. Evidence: '+dir);
}finally{if(browser)await browser.close();}
