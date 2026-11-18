import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as Popover from '@radix-ui/react-popover';
import * as icons from 'lucide-react';

const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function load(file,deps,expose=[]){
  const module={exports:{}};
  const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8')+(expose.length?'\nexport { '+expose.join(',')+' };':''),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,console,crypto,Intl,Date,setTimeout,clearTimeout,require(name){
    if(name==='react/jsx-runtime')return jsx;
    if(name in deps)return deps[name];
    throw Error('Unexpected dependency: '+name);
  }});
  return module.exports;
}
const {ViewSkeleton}=load('components/ui/ViewSkeleton.tsx',{});
const Button=({children,onClick,disabled,...props})=>React.createElement('button',{onClick,disabled,'aria-label':props['aria-label']},children);
const {OperationStatus}=load('components/ui/OperationStatus.tsx',{react:React,'@radix-ui/react-popover':Popover,'lucide-react':icons,
  '../../lib/operationState':load('lib/operationState.ts',{}),'./Button':{Button}});
const Panel=({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children);
const Icon=()=>null;
// Deterministic hook lifecycle: actual component effects and reads, controlled promises,
// no browser, network, clock sleeps or persistence.
function hooks(){
  const slots=[];let cursor=0,effects=[],dirty=false;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={...React,
    useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;dirty=true;}];},
    useRef(initial){const i=cursor++;slots[i]??={current:initial};return slots[i];},
    useMemo(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
    useCallback(fn,deps){return react.useMemo(()=>fn,deps);},
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const previous=slots[i];slots[i]={deps,cleanup:previous?.cleanup};effects.push(()=>{previous?.cleanup?.();slots[i].cleanup=fn();});}},
    useSyncExternalStore(_subscribe,get){return get();}
  };
  return {react,render(Component,props={}){let tree,round=0;do{dirty=false;cursor=0;tree=Component(props);const pending=effects;effects=[];pending.forEach(fn=>fn());if(++round>20)throw Error('render loop');}while(dirty);return tree;},
    unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
const html=tree=>renderToStaticMarkup(tree);
function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(predicate(tree))return tree;for(const child of React.Children.toArray(tree.props?.children)){const found=find(child,predicate);if(found)return found;}return null;}
function common(h,revision=()=>0){return {
  react:h.react,'./ui/ViewSkeleton':{ViewSkeleton},'./ui/Button':{Button},'./ui/Panel':{Panel},'./ui/OperationStatus':{OperationStatus},
  '../lib/networkingDataRevision':{subscribeNetworkingDataRevision(){},getNetworkingDataRevision:revision,getServerNetworkingDataRevision:()=>0,notifyNetworkingDataChanged(){}},
  '../lib/activitySyncExecution':{subscribeGlobalActivitySync(){},getGlobalActivitySyncSnapshot:()=>({}),getGlobalActivitySyncServerSnapshot:()=>({})}
};}

test('Contacts: initial, confirmed empty, warm return, silent refresh and error preserve loaded rows',async()=>{
  const h=hooks();let revision=0,read=deferred();
  const component=load('components/ReadOnlyContacts.tsx',{
    ...common(h,()=>revision),'next/navigation':{useSearchParams:()=>new URLSearchParams()},
    '../lib/indicatorReads':{peekSharedView:()=>null},
    '../lib/cloudData':{readContactListRows:()=>read.promise},
    './ContactProfile':{ContactProfile:()=>null},
    './ContactTable':{ContactTable:({contacts})=>React.createElement('p',null,contacts.length?contacts.map(c=>c.id).join(','):'confirmed-empty')}
  }).ReadOnlyContacts;
  let tree=h.render(component,{view:'contacts'});
  assert.match(html(tree),/view-skeleton-table/);assert.doesNotMatch(html(tree),/confirmed-empty/);
  read.resolve([]);await tick();tree=h.render(component,{view:'contacts'});assert.match(html(tree),/confirmed-empty/);
  revision++;read=deferred();tree=h.render(component,{view:'contacts'});assert.doesNotMatch(html(tree),/view-skeleton/);
  read.resolve([{id:'verified'}]);await tick();assert.match(html(h.render(component,{view:'contacts'})),/verified/);
  h.unmount();
  const warm=hooks();
  const Warm=load('components/ReadOnlyContacts.tsx',{
    ...common(warm),'next/navigation':{useSearchParams:()=>new URLSearchParams()},
    '../lib/indicatorReads':{peekSharedView:()=>[{id:'verified'}]},
    '../lib/cloudData':{readContactListRows:async()=>{throw Error('synthetic');}},
    './ContactProfile':{ContactProfile:()=>null},'./ContactTable':{ContactTable:({contacts})=>React.createElement('p',null,contacts[0].id)}
  }).ReadOnlyContacts;
  assert.doesNotMatch(html(warm.render(Warm)),/view-skeleton/);
  await new Promise(resolve=>setTimeout(resolve,380));
  tree=warm.render(Warm);assert.match(html(tree),/verified/);assert.match(html(tree),/Reintentar/);assert.doesNotMatch(html(tree),/confirmed-empty|Actualizando/);
});

function dashboardFixture(){
  const h=hooks();let revision=0,primary=deferred(),detail=deferred(),primaryCalls=0,detailCalls=0;
  const deps={...common(h,()=>revision),
    'lucide-react':{Binoculars:Icon,Building2:Icon,ChartColumn:Icon,ChartSpline:Icon,Handshake:Icon,MessagesSquare:Icon},
    '../lib/indicatorReads':{peekTrackingSnapshot:()=>null,peekSharedView:()=>null,invalidateIndicatorReads(){},readSharedTrackingSnapshot:()=>{primaryCalls++;return primary.promise;}},
    '../lib/dashboardDetails':{readDashboardDetails:()=>{detailCalls++;return detail.promise;}},
    '../lib/trackingModel':{defaultTrackingFilters:{priorityIds:[],headhunters:'all'},buildTracking:s=>({state:'ready',priorities:s.priorities})},
    '../lib/networkingScope':{selectNetworkingContacts:c=>c},'./WorkspaceState':{useWorkspace:()=>({})},
    './EditorialFeed':{EditorialFeed:()=>null},'./HomeGamification':{HomeGamification:()=>null,useHomeRefresh(){}},
    './useTrackingViewFilters':{useTrackingViewFilters:()=>({filters:{priorityIds:[],headhunters:'all'},quickQuery:'',selectedDomains:new Set(),setFilters(){},setQuickQuery(){},setSelectedDomains(){}})},
    '../lib/cloudData':{buildHeadhunterCompanies:c=>c},'../lib/contactFilters':{DEFAULT_CONTACT_FILTERS:{},filterContacts:c=>c},
    '../lib/objectiveMetrics':{buildObjectiveMetrics:()=>[]},'./ContactFilterControls':{ContactFilterControls:()=>null},
    './TrackingView':{TrackingView:()=>null,TrackingPyramid:()=>null,TrackingBars:()=>null},
    './ObjectiveMetricsTable':{ObjectiveMetricsTable:({rows})=>React.createElement('p',null,'primary-'+rows.map(r=>r.contactCount).join(','))},
    './HeadhunterCompanies':{HeadhunterCompanies:({rows})=>React.createElement('p',null,'detail-'+rows.map(r=>r.id).join(','))},
    './InteractionTimelineList':{InteractionTimelineList:()=>null,groupParticipantsByInteraction:()=>new Map(),groupSourcesByInteraction:()=>new Map()},
    './ReferralActions':{ReferralActions:()=>null}
  };
  const Component=load('components/ReadOnlyDashboard.tsx',deps).ReadOnlyDashboard;
  return {render:()=>h.render(Component,{view:'planning'}),h,
    snapshot:n=>({cycle:{id:'cycle'},priorities:[{id:'priority',contactCount:n,coffeeCount:0}]}),
    details:n=>({contacts:[{id:String(n)}],interactions:[],participants:[],sources:[],referrals:[]}),
    get primary(){return primary;},get detail(){return detail;},calls:()=>[primaryCalls,detailCalls],
    refresh(){revision++;primary=deferred();detail=deferred();}};
}
test('Planning: parallel reads, early primary, coherent refresh, late generations ignored',async()=>{
  const f=dashboardFixture();assert.match(html(f.render()),/view-skeleton/);assert.deepEqual(f.calls(),[1,1]);
  f.primary.resolve(f.snapshot(1));await tick();let screen=html(f.render());assert.match(screen,/primary-1/);assert.match(screen,/view-skeleton/);
  f.detail.resolve(f.details(1));await tick();screen=html(f.render());assert.match(screen,/detail-1/);
  f.refresh();f.render();f.primary.resolve(f.snapshot(2));await tick();screen=html(f.render());assert.match(screen,/primary-1/);assert.match(screen,/detail-1/);assert.doesNotMatch(screen,/view-skeleton/);
  const oldDetail=f.detail;f.refresh();f.render();oldDetail.resolve(f.details(2));await tick();assert.doesNotMatch(html(f.render()),/detail-2/);
  f.primary.resolve(f.snapshot(3));f.detail.resolve(f.details(3));await tick();screen=html(f.render());assert.match(screen,/primary-3/);assert.match(screen,/detail-3/);
});
test('Planning: secondary failure retains primary and retry does not reset content',async()=>{
  const f=dashboardFixture();f.render();f.primary.resolve(f.snapshot(1));f.detail.reject(Error('secondary'));await tick();
  let tree=f.render();assert.match(html(tree),/primary-1/);assert.match(html(tree),/Reintentar detalle/);assert.doesNotMatch(html(tree),/Sin indicadores|view-skeleton/);
  f.refresh();f.render();f.primary.resolve(f.snapshot(2));f.detail.resolve(f.details(2));await tick();assert.match(html(f.render()),/detail-2/);
  f.refresh();f.render();f.primary.reject(Error('primary'));f.detail.resolve(f.details(3));await tick();tree=f.render();
  assert.match(html(tree),/primary-2/);assert.match(html(tree),/detail-2/);assert.match(html(tree),/Reintentar/);assert.doesNotMatch(html(tree),/detail-3/);
});

test('Opportunity gate: cached board remains mounted on verification error, retry recovers',async()=>{
  const h=hooks();let read=deferred();const ready={cycles:[{status:'active',started_at:'2026-01-01'}],stale:false};
  const Component=load('components/OpportunityWorkspace.tsx',{
    ...common(h),'../lib/viewCycleRead':{peekViewCycle:()=>ready,readViewCycle:()=>read.promise},
    './OpportunityBoard':{WingedBriefcase:Icon,OpportunityBoard:({enabled=true})=>React.createElement('p',null,enabled?'board-enabled':'board-disabled')}
  }).OpportunityWorkspace;
  assert.match(html(h.render(Component)),/board-enabled/);read.reject(Error('technical'));await tick();let tree=h.render(Component);
  assert.match(html(tree),/board-disabled/);assert.match(html(tree),/Reintentar/);assert.doesNotMatch(html(tree),/view-skeleton|No hay una/);
  read=deferred();find(tree,n=>n.type===Button).props.onClick();h.render(Component);read.resolve(ready);await tick();assert.match(html(h.render(Component)),/board-enabled/);
});

test('shared cycle view keeps context verification and starts independent reads together',async()=>{
  const cycles=deferred(),context=deferred();const calls=[];
  const reader=load('lib/viewCycleRead.ts',{
    './indicatorReads':{readSharedView:(_key,fn)=>fn()},
    './networkingCycles':{readNetworkingCycles:()=>{calls.push('cycles');return cycles.promise;},expectedNetworkingContext:()=>{calls.push('context');return context.promise;},networkingContextFromCycles:()=>({token:'current'})}
  });
  const pending=reader.readViewCycle();assert.deepEqual(calls,['cycles','context']);cycles.resolve([]);context.resolve({token:'older'});assert.equal((await pending).stale,true);
});

test('operational loading copy is removed, while explicit saving feedback stays',()=>{
  for(const name of ['ReadOnlyContacts','ReadOnlyDashboard','OpportunityWorkspace','OpportunityBoard','ObjectivesPage','NetworkingCyclePanel','OpportunityEditor','ObjectiveSelector','ContactProfile']){
    const source=readFileSync(new URL('../components/'+name+'.tsx',import.meta.url),'utf8');
    assert.doesNotMatch(source,/Cargando (?:contactos)|Cargando\.\.\.|Leyendo(?:\.\.\.| (?:tu ciclo|contactos|detalle|objetivos|relaciones|interacciones))|Actualizando\.\.\./,name);
  }
  const objectives=readFileSync(new URL('../components/ObjectivesPage.tsx',import.meta.url),'utf8');
  assert.match(objectives,/Guardando\.\.\./);assert.doesNotMatch(objectives,/hidden=\{!initialComplete\}/);
  assert.match(html(React.createElement(ViewSkeleton,{kind:'board',columns:4})),/repeat\(4,/);
});

test('Tutorial priorities: no false deselection during first read; errors retry without a write',async()=>{
  const h=hooks();let read=deferred(),writes=0;
  const model=load('lib/onboardingPriorities.ts',{});
  const Component=load('components/OnboardingPriorities.tsx',{
    ...common(h),'./ui/Icon':{Icon},'../lib/indicatorReads':{peekSharedView:()=>null},
    '../lib/onboardingPriorities':model,
    '../lib/cycleObjectiveActions':{readObjectives:()=>read.promise,saveObjective:async()=>{writes++;}}
  }).OnboardingPriorities;
  const props={onReadyChange(){},onBusyChange(){}};
  let tree=h.render(Component,props);assert.match(html(tree),/view-skeleton-chips/);assert.doesNotMatch(html(tree),/aria-pressed/);
  read.reject(Error('read'));await tick();tree=h.render(Component,props);
  assert.match(html(tree),/Reintentar lectura/);assert.doesNotMatch(html(tree),/aria-pressed/);
  read=deferred();find(tree,n=>n.type===Button).props.onClick();h.render(Component,props);
  read.resolve([{id:'one',objective_type:'COMPANY',objective_name:'Synthetic',is_active:true}]);await tick();
  tree=h.render(Component,props);assert.match(html(tree),/aria-pressed="true"/);assert.equal(writes,0);
});

function tutorialFixture(){
  const h=hooks();let read=deferred(),revision=0,confirmations=0;
  const state={loading:true,routeReady:false,state:{},confirmBoardExercise:async()=>{confirmations++;}};
  const Table=({contacts})=>React.createElement('p',null,contacts.length?contacts.map(c=>c.id).join(','):'confirmed-empty');
  const no=()=>null;
  const loaded=load('components/OnboardingRoutePage.tsx',{
    ...common(h,()=>revision),'../lib/indicatorReads':{peekSharedView:()=>null},'../lib/cloudData':{readContactListRows:()=>read.promise},
    '../lib/onboarding':{currentOnboardingStep:()=> 'google'},'./OnboardingProvider':{useOnboarding:()=>state,OnboardingProvider:no},
    './AuthGate':{AuthGate:no},'./ui/BrandBetaWordmark':{BrandBetaWordmark:no},'./CoachPreview':{CoachModule:({children})=>children},
    './ContactTable':{ContactTable:Table},'./NetworkingCyclePanel':{NetworkingCyclePanel:no},'./OnboardingPriorities':{OnboardingPriorities:no},
    './OnboardingIntroSlides':{OnboardingIntroSlides:no},'./Shell':{Shell:no},'./ShellHeader':{ShellHeader:no},'./StartingPointFields':{StartingPointFields:no}
  },['OnboardingRouteContent','OnboardingNetworkStep']);
  return {h,loaded,state,Table,read:()=>read,refresh(){revision++;read=deferred();},confirmations:()=>confirmations};
}
test('Tutorial gate renders geometry only until ready; failed gate retains retry',()=>{
  const f=tutorialFixture();let screen=html(f.h.render(f.loaded.OnboardingRouteContent,{routeId:'google'}));
  assert.match(screen,/view-skeleton/);assert.doesNotMatch(screen,/Saltar|Siguiente|confirmed-empty|Preparando/);
  f.state.loadFailed=true;f.state.error='Access error';screen=html(f.h.render(f.loaded.OnboardingRouteContent,{routeId:'google'}));
  assert.match(screen,/Reintentar/);assert.doesNotMatch(screen,/Saltar|confirmed-empty/);
});
test('Tutorial contacts: first read, error, empty, refresh and obsolete response; no gesture credit',async()=>{
  const f=tutorialFixture(),render=()=>f.h.render(f.loaded.OnboardingNetworkStep,{step:'google'});
  let tree=render();assert.match(html(tree),/view-skeleton-table/);assert.doesNotMatch(html(tree),/confirmed-empty/);
  f.read().reject(Error('read'));await tick();tree=render();assert.match(html(tree),/Reintentar/);assert.equal(find(tree,n=>n.type===f.Table),null);
  f.refresh();render();f.read().resolve([]);await tick();tree=render();assert.match(html(tree),/confirmed-empty/);
  f.refresh();render();const old=f.read();f.refresh();render();old.resolve([{id:'obsolete'}]);await tick();assert.doesNotMatch(html(render()),/obsolete/);
  f.read().resolve([{id:'current'}]);await tick();tree=render();assert.match(html(tree),/current/);assert.doesNotMatch(html(tree),/view-skeleton/);
  assert.equal(f.confirmations(),0);
  await find(tree,n=>n.type===f.Table).props.onStatusSaved({previous:'Agendado',next:'Contactado'});assert.equal(f.confirmations(),0);
  await find(tree,n=>n.type===f.Table).props.onStatusSaved({previous:'Pendiente',next:'Contactado'});assert.equal(f.confirmations(),1);
});

test('Tutorial and pre-access loading contain no technical wait text',()=>{
  for(const name of ['OnboardingRoutePage','StartingPointFields','OnboardingPriorities','AuthGate','Shell','ApplicationFrame','ApplicationShellContent']){
    const source=readFileSync(new URL('../components/'+name+'.tsx',import.meta.url),'utf8');
    assert.doesNotMatch(source,/Preparando (?:tu tutorial|recorrido)|Leyendo contactos|Cargando(?: tus datos| tu punto de partida|\.\.\.|…)/,name);
    assert.match(source,/ViewSkeleton/);
  }
});

test('Tutorial progress failure is retryable without replaying the contact move; busy states do not overwrite each other',async()=>{
  const f=tutorialFixture(),render=()=>f.h.render(f.loaded.OnboardingNetworkStep,{step:'contacts'});
  render();f.read().resolve([{id:'synthetic'}]);await tick();
  let tree=render(),progress=deferred(),writes=0;
  f.state.confirmBoardExercise=()=>{writes++;return progress.promise;};
  const table=find(tree,n=>n.type===f.Table);
  table.props.onBusyChange(true);
  const saved=table.props.onStatusSaved({previous:'Pendiente',next:'Contactado'});
  table.props.onBusyChange(false);
  assert.equal(render().props.busy,true);
  progress.reject(Error('progress failed'));await assert.rejects(saved,/progress_not_confirmed/);
  tree=render();assert.match(html(tree),/El contacto quedó guardado, pero no tu avance/);
  assert.equal(tree.props.ready,false);assert.equal(tree.props.busy,false);assert.equal(writes,1);
  progress=deferred();find(tree,n=>n.type===Button&&n.props.children==='Reintentar').props.onClick();
  assert.equal(render().props.busy,true);progress.resolve();await tick();
  tree=render();assert.doesNotMatch(html(tree),/El contacto quedó guardado/);assert.equal(writes,2);
});

test('Objectives: stable sections, no false empty priorities, read error and recovery',async()=>{
  const h=hooks();let priorities=deferred();const Cycle=()=>null;
  const Component=load('components/ObjectivesPage.tsx',{
    ...common(h),'../lib/viewCycleRead':{peekViewCycle:()=>null},'../lib/indicatorReads':{peekSharedView:()=>null},
    '../lib/cycleObjectiveActions':{readObjectives:()=>priorities.promise,objectiveTypeLabel:t=>t},
    '../lib/cloudData':{},'../lib/format':{},'./ui/EmptyValue':{EmptyValue:({children})=>React.createElement('p',null,children)},
    './ui/Icon':{Icon},'./NetworkingCyclePanel':{NetworkingCyclePanel:Cycle},'./OpportunityBoard':{OpportunityBoard:()=>null},'./OpportunityEditor':{OpportunityEditor:()=>null}
  }).ObjectivesPage;
  let tree=h.render(Component,{showOpportunities:false});assert.match(html(tree),/Prioridades/);assert.doesNotMatch(html(tree),/sin prioridades|requieren un proceso/);
  const cycle=find(tree,n=>n.type===Cycle);cycle.props.onReadyChange(true);cycle.props.onLoadingChange(false);
  tree=h.render(Component,{showOpportunities:false});assert.match(html(tree),/view-skeleton/);
  priorities.reject(Error('technical'));await tick();tree=h.render(Component,{showOpportunities:false});
  assert.match(html(tree),/No pudimos leer Prioridades/);assert.doesNotMatch(html(tree),/sin prioridades/);
  priorities=deferred();find(tree,n=>n.type===Button&&n.props['aria-label']==='Reintentar lectura de Prioridades').props.onClick();h.render(Component,{showOpportunities:false});
  priorities.resolve([]);await tick();assert.match(html(h.render(Component,{showOpportunities:false})),/sin prioridades/);
});

test('Cycle cards: first read is not an inactive plan; slow notices do not block the real objective',async()=>{
  const h=hooks(),cycle=deferred(),notices=deferred();
  const Component=load('components/NetworkingCyclePanel.tsx',{
    ...common(h),'lucide-react':{BriefcaseBusiness:Icon,Handshake:Icon,Megaphone:Icon},'./ui/Icon':{Icon},
    '../lib/networkingCycles':{localDateTimeValue:()=> '2026-11-18T12:00'},
    '../lib/networkingCycleModel':{NETWORKING_CYCLE_RESULTS:[]},'../lib/networkingCycleCloseFlow':{createCycleCloseFlow:()=>()=>{}},
    '../lib/networkingPlanNotice':{readMyNetworkingPlanNotices:()=>notices.promise},'../lib/networkingPlanNoticeFlow':{},
    '../lib/networkingCycleTime':{cycleDateError:()=>'',cycleStartFromDate:()=>({}),localDateTimeCandidates:()=>[],cycleCloseInputMin:()=>''},
    '../lib/historyPolicy':{},'../lib/viewCycleRead':{peekViewCycle:()=>null,readViewCycle:()=>cycle.promise}
  }).NetworkingCyclePanel;
  let screen=html(h.render(Component));assert.match(screen,/Objetivo actual/);assert.doesNotMatch(screen,/Comenzar proceso|Organiza tu/);
  cycle.resolve({stale:false,cycles:[{id:'cycle',status:'active',cycle_name:'Real objective',started_at:'2026-01-01T12:00:00Z',timezone_name:'UTC'}]});await tick();
  screen=html(h.render(Component));assert.match(screen,/Real objective/);assert.match(screen,/Finalizar proceso/);assert.match(screen,/view-skeleton-inline/);assert.doesNotMatch(screen,/Cargando|Leyendo/);
  notices.resolve(new Set());await tick();screen=html(h.render(Component));assert.match(screen,/Avísame/);assert.doesNotMatch(screen,/view-skeleton/);
});
