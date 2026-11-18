// Real React consumers, in-memory writers only. Run, then open the printed local URL.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'package.json'));
const {webpack} = req('next/dist/compiled/webpack/webpack');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'coffeecito-status-expiry-'));
const imp = name => JSON.stringify(path.join(root, name).replaceAll('\\', '/'));
const write = (name, code) => fs.writeFileSync(path.join(output, name), code);
async function main() {
  write('loader.cjs', `const ts=require(${JSON.stringify(req.resolve('typescript'))});module.exports=src=>ts.transpileModule(src,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  write('store.ts', `
export const contact={id:'c1',display_name:'Synthetic contact',company:'Example',role:'Role',networking_status:'Pendiente',networking_focus:true,is_headhunter:false,contact_emails:[],contact_phones:[],headhunter_domains:[],contact_objective_assignments:[],objectives:[],hashtags:[],last_interaction_at:null,days_since_last_interaction:null};
export const row={id:'o1',title:'Synthetic opportunity',stage:'identified',situation:'active',result:null,updated_at:'0',contact_ids:[],objective_ids:[],interaction_ids:[]};
export let fail=false;export const setFailure=value=>{fail=value;};
export const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
`);
  write('reads.ts', `import {row,wait} from './store';
export const peekSharedView=key=>key==='opportunity-board'?[{...row}]:[];
export const getSharedReadOwner=()=> 'synthetic';
export const readSharedView=(_key,fn)=>fn();
export async function readOpportunityBoard(){await wait(50);return [{...row}];}
`);
  write('moves.ts', `import {BoardMoveQueue} from ${imp('lib/boardMoveQueue.ts')};
import {notifyNetworkingDataChanged} from ${imp('lib/networkingDataRevision.ts')};
import {contact,row,wait,fail} from './store';
export const boardMoves=new BoardMoveQueue(notifyNetworkingDataChanged);boardMoves.scope('synthetic');
export const moveContactCard=(_id,target,tutorial=false)=>boardMoves.enqueue({key:'contact:c1',target,tutorial,
write:async()=>{await wait(150);if(fail)throw Error('Synthetic write failure');const previous=contact.networking_status;contact.networking_status=target;return {previous,actual:target};},read:async()=>contact.networking_status});
export const moveOpportunityCard=(_id,target)=>boardMoves.enqueue({key:'opportunity:o1',target,
write:async()=>{await wait(150);if(fail)throw Error('Synthetic write failure');const previous=row.stage;row.stage=target;return {previous,actual:target};},read:async()=>row.stage});
`);
  write('stubs.tsx', `import React from 'react';
export default function Link({children,href}){return <a href={href}>{children}</a>}
export const useWorkspace=()=>null;
export const ContactEditorDialog=()=>null,ContactFilterControls=()=>null,ContactDeactivationButton=()=>null,ContactDeactivationConfirmDialog=()=>null,ContactImportButton=()=>null,OpportunityEditor=()=>null;
export const readHeadhunterCompanyMaster=async()=>[];export const readObjectives=async()=>[];
export const objectiveTypeLabel=x=>x;export const triggerCoachRuleReviewForContacts=async()=>null;
export const NETWORKING_STATUSES=['Pendiente','Contactado','Agendado','Cita concretada','Agradecimiento enviado'];
const forbidden=()=>{throw Error('Writer outside isolated fixture');};
export const deactivateContacts=forbidden,updateContactFlags=forbidden,updateContactNetworkingStatus=forbidden,addObjectiveAssignmentsToContacts=forbidden,saveOpportunity=forbidden;
`);
  write('entry.tsx', `
import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';
import {ContactTable} from ${imp('components/ContactTable.tsx')};
import {OpportunityBoard} from ${imp('components/OpportunityBoard.tsx')};
import {Panel} from ${imp('components/ui/Panel.tsx')};
import {contact,wait,setFailure} from './store';import {boardMoves,moveContactCard,moveOpportunityCard} from './moves';
const results=[];const check=(condition,name)=>{if(!condition)throw Error(name);results.push('PASS '+name);};
function App(){
 const [revision,setRevision]=useState(0),[contacts,setContacts]=useState([{...contact}]),[busy,setBusy]=useState(false),[running,setRunning]=useState(false),[report,setReport]=useState('Ready'),[initial,setInitial]=useState(false);
 const states=()=>[...document.querySelectorAll('.operation-status')];
 const all=phase=>states().length===5&&states().every(n=>n.dataset.phase===phase);
 const rerender=()=>{setContacts([{...contact}]);setRevision(n=>n+1);};
 useEffect(()=>{if(initial){setInitial(false);}},[initial]);
 async function run(){setRunning(true);results.length=0;try{
  await wait(200);check(all('idle'),'cached data mounts without checks');
  await wait(3000);check(all('idle'),'cached data at 3 seconds');
  await wait(3000);check(all('idle'),'cached data at 6 seconds');
  setBusy(true);setRevision(n=>n+1);await wait(100);setBusy(false);await wait(100);
  check(all('idle'),'unchanged revalidation never emits a check');
  const writes=Promise.all([moveContactCard('c1','Contactado',true),moveOpportunityCard('o1','applied')]);
  await wait(30);check(states().slice(0,4).every(n=>n.dataset.phase==='busy'),'real consumers show pending writers');
  await writes;rerender();await wait(200);
  check(states().slice(0,4).every(n=>n.dataset.phase==='ready'),'confirmed writers produce checks in real consumers');
  for(let i=0;i<3;i++){setContacts([{...contact}]);await wait(300);}
  check(states().slice(0,4).every(n=>n.dataset.phase==='ready'),'equivalent props do not remove confirmation early');
  await wait(2000);check(all('idle'),'confirmation expires by 3 seconds');
  await wait(3000);check(all('idle'),'no check fallback at 6 seconds');
  setFailure(true);await Promise.all([moveContactCard('c1','Agendado'),moveOpportunityCard('o1','in_process')]);await wait(100);
  check(states().slice(0,4).every(n=>n.dataset.phase==='error'),'failed writers remain errors');
  await wait(6100);check(states().slice(0,4).every(n=>n.dataset.phase==='error'),'errors persist past 6 seconds');
  setFailure(false);await Promise.all([boardMoves.reconcile('contact:c1'),boardMoves.reconcile('opportunity:o1')]);rerender();await wait(200);
  check(states().slice(0,4).every(n=>n.dataset.phase==='ready'),'confirmed reconciliation recovers with a check');
  await wait(3100);check(all('idle'),'recovery check expires');
  setInitial(true);await wait(100);check(states().at(-1).dataset.phase==='ready','shared Panel confirms its first read');
  await wait(3100);check(all('idle'),'first read check expires');await wait(3000);check(all('idle'),'first read remains quiet after 6 seconds');
  check(states().filter(n=>n.getClientRects().length).every(n=>n.getBoundingClientRect().width===28&&n.getBoundingClientRect().height===28),'visible slots remain 28 x 28; tutorial hidden header is unchanged');
  setReport(results.join('\\n'));document.title='PASS mounted OperationStatus';
 }catch(error){setReport(results.join('\\n')+'\\nFAIL '+error.message);document.title='FAIL mounted OperationStatus';}finally{setRunning(false);}}
 return <main><h1>Isolated OperationStatus regression</h1><button disabled={running} onClick={run}>Run regressions</button><pre role='status'>{running?'Running synthetic cases':report}</pre>
 <ContactTable contacts={contacts} view='contacts' readState={{resolved:true,busy}} onReload={async()=>rerender()}/>
 <ContactTable contacts={contacts} view='states' tutorial='board' readState={{resolved:true,busy}} onReload={async()=>rerender()}/>
 <OpportunityBoard revision={revision}/>
 <Panel title='Read-only shared consumer' status={{resolved:!initial,busy}}>Synthetic list</Panel>
 </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
`);
  const mapping = [
    [/boardMoves$/, 'moves.ts'],[/readOpportunityBoard$/, 'reads.ts'],[/indicatorReads$/, 'reads.ts'],
    [/(contactActions|opportunityActions|WorkspaceState|cycleObjectiveActions|coachRuleTriggers|headhunterCompanyActions|ContactEditorDialog|ContactDeactivationButton|ContactDeactivationConfirmDialog|ContactImportDialog|OpportunityEditor|next\/link)$/, 'stubs.tsx']
  ];
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',devtool:false,context:root,entry:path.join(output,'entry.tsx'),output:{path:output,filename:'bundle.js'},
      resolve:{extensions:['.tsx','.ts','.js','.json'],modules:[path.join(root,'node_modules'),'node_modules']},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[path.join(output,'loader.cjs')]}]},
      plugins:[...mapping.map(([pattern,file])=>new webpack.NormalModuleReplacementPlugin(pattern,path.join(output,file))),
        new webpack.NormalModuleReplacementPlugin(/supabaseClient(\.ts)?$/,()=>{throw Error('Remote transport forbidden');})]});
    compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  const server=http.createServer((request,response)=>{
    const pathname=new URL(request.url,'http://localhost').pathname;
    const relative=pathname.replace(/^\//,'');
    const stylesheet=relative==='app/globals.css'||/^styles\/[a-z-]+\.css$/.test(relative);
    if(pathname==='/bundle.js'||stylesheet){const file=pathname==='/bundle.js'?path.join(output,'bundle.js'):path.join(root,relative);
      response.setHeader('Content-Type',stylesheet?'text/css':'text/javascript');response.end(fs.readFileSync(file));}
    else if(pathname==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');
      response.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'");
      response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/globals.css"><div id="root"></div><script src="/bundle.js"></script></html>');}
    else{response.statusCode=404;response.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  console.log('FIXTURE_URL=http://127.0.0.1:'+server.address().port+'/');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
