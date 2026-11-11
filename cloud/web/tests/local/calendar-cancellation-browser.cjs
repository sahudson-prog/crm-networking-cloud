// Render real SQL fixture rows and mounted Contacts reader. No real network or authentication.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'), req=createRequire(path.join(root,'package.json'));
const {webpack}=req('next/dist/compiled/webpack/webpack');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'calendar-cancellation-ui-'));
const imp=f=>JSON.stringify(path.join(root,f).replaceAll('\\','/'));
let browser;
async function main(){
 const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 assert.equal(data.sources.filter(s=>s.sync_status==='deleted_at_source').length,2);
 fs.writeFileSync(path.join(out,'loader.cjs'),`const ts=require(${JSON.stringify(req.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
 fs.writeFileSync(path.join(out,'data.ts'),`export async function readContactProfile(){window.reads++;return {contact:{},interactions:window.rows.interactions,interactionParticipants:window.rows.participants,externalInteractionSources:window.rows.sources,referrals:[],todos:[]};} export async function readContactListRows(){return [];}`);
 fs.writeFileSync(path.join(out,'nav.tsx'),`import React from 'react';export const useSearchParams=()=>new URLSearchParams('contactId=synthetic');export default function Link(p){return <a {...p}/>;}`);
 fs.writeFileSync(path.join(out,'profile.tsx'),`import React from 'react';import {InteractionTimelineList,groupParticipantsByInteraction,groupSourcesByInteraction} from ${imp('components/InteractionTimelineList.tsx')};export function ContactProfile({profile}){return <InteractionTimelineList interactions={profile.interactions} sourcesByInteraction={groupSourcesByInteraction(profile.externalInteractionSources)} participantsByInteraction={groupParticipantsByInteraction(profile.interactionParticipants)}/>;}export const ContactTable=()=>null;`);
 fs.writeFileSync(path.join(out,'entry.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {ReadOnlyContacts} from ${imp('components/ReadOnlyContacts.tsx')};
import {bindGlobalActivitySyncScope,startGlobalActivitySync,clearGlobalActivitySyncFeedback} from ${imp('lib/activitySyncExecution.ts')};
window.rows=${JSON.stringify(data)};window.reads=0;
bindGlobalActivitySyncScope('synthetic-account');
window.complete=async(success=true,reactivate=false)=>{
 if(success) window.rows.sources=window.rows.sources.map(s=>({...s,sync_status:reactivate&&s.external_id==='CALENDAR_moved'?'synced':'deleted_at_source'}));
 await startGlobalActivitySync(async()=>[{service:'calendar',created:0,error:success?'':'synthetic failure',reauthorizationRequired:false,success,syncedAt:success?new Date().toISOString():null}]).promise;
};
window.clearFeedback=clearGlobalActivitySyncFeedback;
createRoot(document.getElementById('root')).render(<ReadOnlyContacts/>);
`);
 await new Promise((resolve,reject)=>{const c=webpack({mode:'development',target:'web',devtool:false,context:root,entry:path.join(out,'entry.tsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js','.json'],modules:[path.join(root,'node_modules')]},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[path.join(out,'loader.cjs')]}]},plugins:[new webpack.NormalModuleReplacementPlugin(/cloudData$/,path.join(out,'data.ts')),new webpack.NormalModuleReplacementPlugin(/(next\/link|next\/navigation)$/,path.join(out,'nav.tsx')),new webpack.NormalModuleReplacementPlugin(/(ContactProfile|ContactTable)$/,path.join(out,'profile.tsx'))]});c.run((e,s)=>c.close(()=>e||s.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve()));});
 const {chromium}=require(process.env.CALENDAR_PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({channel:'msedge',headless:true});
 for(const width of [1280,320]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage();
  const unexpected=[];
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());if(u.origin!=='http://127.0.0.1:43579'){unexpected.push(u.origin);return route.abort();}
   if(u.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(out,'bundle.js'),'utf8')});
   if(u.pathname==='/styles.css')return route.fulfill({contentType:'text/css; charset=utf-8',body:['styles/tokens.css','styles/components.css','app/globals.css'].map(f=>fs.readFileSync(path.join(root,f),'utf8').replace(/^@import.*$/gm,'')).join('\n')});
   return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>'});
  });
  await page.goto('http://127.0.0.1:43579/');await page.waitForSelector('details.contact-timeline-item');
  const initial=await page.locator('details.contact-timeline-item').count();
  assert.equal(initial,1,'only the unaffected recurrence is visible');
  assert.equal(await page.getByText('Cancelada en Google Calendar',{exact:true}).count(),0);
  await page.evaluate(()=>window.complete());await page.waitForTimeout(400);
  const reads=await page.evaluate(()=>window.reads);
  console.log(JSON.stringify({width,initialVisible:initial,readsAfterSuccess:reads}));
  assert.equal(reads,2);
  assert.equal(await page.locator('details.contact-timeline-item').count(),0);
  await page.getByText('Sin interacciones registradas.',{exact:true}).waitFor();
  await page.evaluate(()=>window.clearFeedback());await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.reads),2);
  await page.evaluate(()=>window.complete(false));await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.reads),2);
  await page.evaluate(()=>window.complete());await page.waitForTimeout(150);
  assert.equal(await page.locator('details.contact-timeline-item').count(),0,'unchanged click cannot resurrect tombstones');
  await page.evaluate(()=>window.complete(true,true));await page.waitForSelector('details.contact-timeline-item');
  assert.equal(await page.locator('details.contact-timeline-item').count(),1);
  assert.equal(await page.evaluate(()=>window.rows.interactions.length),3,'no physical deletion');
  assert.equal(await page.getByText('Cancelada en Google Calendar',{exact:true}).count(),0);
  await page.locator('details.contact-timeline-item').first().locator('summary').click();
  assert.ok((await page.locator('.contact-timeline-detail').allTextContents()).some(t=>t.includes('Synthetic retained note')));
  assert.deepEqual(unexpected,[]);
  await page.screenshot({path:path.join(out,`timeline-${width}.png`),fullPage:true});
  await context.close();console.log(`PASS mounted timeline/refresh ${width}px; hidden, empty state, unchanged click, reactivation/notes; no reads on error/feedback expiry.`);
 }
 console.log('Synthetic screenshots:',out);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
