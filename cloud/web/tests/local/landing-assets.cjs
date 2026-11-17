// Render real components as transparent, inert SVG/HTML compositions.
// No browser launcher, environment file, authentication or backend is used.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const postcss = require('postcss');
const {parseDocument} = require('htmlparser2');
const serialize = require('dom-serializer').default;
const root = path.resolve(__dirname, '../..');
const output = process.argv[2];
const only = process.argv[3];
if (!output || !path.isAbsolute(output)) throw Error('An absolute local output directory is required');
if (only && !['kanban','coach','inicio'].includes(only)) throw Error('Unknown composition');
for (const key of Object.keys(process.env)) if (/SUPABASE|TURNSTILE/.test(key)) delete process.env[key];
global.fetch = () => { throw Error('No network is allowed in landing fixtures'); };
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  module._compile(code, filename);
};
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {AppRouterContext} = require('next/dist/shared/lib/app-router-context.shared-runtime');
const {ContactTable} = require('../../components/ContactTable.tsx');
const {CoachModule} = require('../../components/CoachPreview.tsx');
const {GamificationPanel} = require('../../components/GamificationPanel.tsx');
const {buildGamification} = require('../../lib/gamificationModel.ts');
const {trackingFixture, coffee} = require('../trackingFixtures.ts');
const {NETWORKING_STATUSES} = require('../../lib/contactActions.ts');
const h = React.createElement;
const names = ['Ana Prado','Diego Soto','Valentina Ríos','Camilo Vera','Francisca Mora','Pablo Torres','Sofía Vidal','Martín Lagos','Elena Silva','Tomás Rojas','Clara Fuentes','Gabriel Díaz','Laura León','Nicolás Ruiz','Isabel Cruz'];
const contacts = names.map((display_name, i) => ({id:`synthetic-${i}`,display_name,
  company:['Estudio Norte','Consultora Sur','Tecnología Andina'][i%3],role:['Directora','Consultor','Gerente'][i%3],
  networking_status:NETWORKING_STATUSES[Math.floor(i/3)],networking_focus:true,is_active:true,is_headhunter:false,
  contact_emails:[],contact_phones:[],headhunter_domains:[],contact_objective_assignments:[],last_interaction_at:null}));
const todos = contacts.slice(0,4).map((contact,i)=>({id:`todo-${i}`,object_id:contact.id,object_type:'contact',todo_type:'NETWORKING_STATUS_CHANGE',
  created_at:'2026-11-12T12:00:00Z',summary:contact.display_name,contact_name:contact.display_name,
  current_state:JSON.stringify({networking_status:i%2?'Agendado':'Pendiente'}),suggested_state:JSON.stringify({networking_status:i%2?'Cita concretada':'Contactado'}),
  reason:i%2?'Ya tuvieron una conversación.':'Ya enviaron un primer mensaje.',evidence:JSON.stringify({contact_name:contact.display_name}),actions_json:[],status:'active'}));
const snapshot=trackingFixture();
snapshot.as_of='2026-11-18T16:00:00Z';
snapshot.cycle.started_at='2026-08-01T12:00:00Z';
snapshot.contacts=Array.from({length:12},(_,i)=>({id:`c${i}`,company:'Empresa ficticia',networking_status:i<6?'Cita concretada':'Agendado',networking_focus:true,is_active:true,is_headhunter:false,headhunter_domains:[],contact_emails:[]}));
snapshot.transitions=[];snapshot.interactions=[];snapshot.participants=[];snapshot.sources=[];snapshot.assignments=[];
const past=['2026-11-17','2026-11-17','2026-11-10','2026-11-10','2026-11-03','2026-10-27'];
for(let i=0;i<6;i++)coffee(snapshot,`past${i}`,past[i]+'T15:00:00Z',`c${i}`);
for(let i=6;i<10;i++)coffee(snapshot,`future${i}`,'2026-11-24T15:00:00Z',`c${i}`);
const model=buildGamification({contacts:snapshot.contacts,interactions:snapshot.interactions,participants:snapshot.participants,sources:snapshot.sources,
  extra:{cycles:[{id:'synthetic-cycle',objective_type:'JOB_SEARCH',status:'active'}],opportunities:[{id:'synthetic-process',stage:'in_process',situation:'active'}],priorities:[{id:'synthetic-priority'}],assignments:snapshot.contacts.slice(0,4).map(c=>({contact_id:c.id,objective_id:'synthetic-priority'})),transitions:[]},
  history:{since:'2026-10-19T03:00:00Z',through:snapshot.as_of,complete:true,events:past.map((day,i)=>({id:`past${i}`,contactId:`c${i}`,occurredAt:day+'T15:00:00Z',confirmed:true}))}
},Date.parse(snapshot.as_of),'America/Santiago');
if(!model.route?.every(step=>step.done))throw Error('Synthetic figures must complete the route');
const slides={
  kanban:h(ContactTable,{contacts,view:'states'}),
  coach:h(CoachModule,{todos,total:todos.length,maxVisible:4}),
  inicio:h(GamificationPanel,{model})
};
const stylesheet=postcss.parse(['styles/tokens.css','styles/components.css','styles/invitations.css','styles/tracking.css','styles/shell.css','app/globals.css','styles/gamification.css'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n'));
// Freeze the desktop composition: an SVG's embedded media queries otherwise
// respond to the displayed image width instead of the 1280px source canvas.
stylesheet.walkAtRules(rule=>{if(['import','media','container'].includes(rule.name))rule.remove();});
const css=stylesheet.toString();
const composition=fs.readFileSync(path.join(__dirname,'landing-compositions.css'),'utf8');
const escapeXml=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
fs.mkdirSync(output,{recursive:true});
for(const [id,component] of Object.entries(slides)){
  if(only && only!==id)continue;
  const markup=renderToStaticMarkup(h(AppRouterContext.Provider,{value:{push(){},replace(){},refresh(){},prefetch(){},back(){},forward(){}}},component));
  const dom=parseDocument(markup,{xmlMode:true});
  const namespaceSvg=node=>{
    if(node.name==='svg')node.attribs.xmlns='http://www.w3.org/2000/svg';
    if(node.name==='img' && /^\/gamification\/[a-z]+\.svg$/.test(node.attribs.src??''))node.attribs.src='data:image/svg+xml;base64,'+fs.readFileSync(path.join(root,'public',node.attribs.src)).toString('base64');
    for(const child of node.children??[])namespaceSvg(child);
  };
  namespaceSvg(dom);
  const stage=`<div class="product-stage"><div class="product-${id}">${serialize(dom,{xmlMode:true})}</div></div>`;
  fs.writeFileSync(path.join(output,`${id}.html`),`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'"><title>${id} - fixture sintético</title><style>${css}\n${composition}</style></head><body>${stage}</body></html>`);
  // foreignObject preserves the actual DOM and CSS, without scripts, effects or
  // a raster background. SVG-as-image is inert; transparency is native.
  fs.writeFileSync(path.join(output,`${id}.svg`),`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="700" viewBox="0 0 1280 700"><foreignObject width="1280" height="700"><div xmlns="http://www.w3.org/1999/xhtml"><style>${escapeXml(css+'\n'+composition)}</style>${stage}</div></foreignObject></svg>`);
}
console.log('PASS: transparent real-component SVG/HTML compositions; synthetic data only.');
