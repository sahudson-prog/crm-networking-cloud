import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(name,deps={}) {
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:n=>deps[n]??{}});
 return module.exports;
}
const {NETWORKING_STATUSES}=load('contactActions');
const {OBJECTIVE_PRIORITIES}=load('cycleObjectiveActions');
const {sortPriorityRows,sortHeadhunterRows,planningDate}=load('planningTableSort',{'./contactActions':{NETWORKING_STATUSES},'./cycleObjectiveActions':{OBJECTIVE_PRIORITIES}});
const p=(id,props={})=>({objectiveId:id,objectiveName:id,objectiveType:'INDUSTRY',priorityLevel:'HIGH',contactCount:2,focusContactCount:2,coffeeCount:1,lastInteractionAt:null,daysSinceLastInteraction:null,networkingStatus:'Pendiente',...props});
const h=(id,props={})=>({domain:id,contactCount:2,contactIds:[],interactionIds:[],status:'Pendiente',lastInteractionAt:null,daysSince:null,type:'',subject:'',...props});
const ids=rows=>Array.from(rows,r=>r.objectiveId??r.domain);
test('BF07 initial order applies all successive ties and stable identity without mutation',()=>{
 const rows=[p('opp'),p('coffee',{coffeeCount:2}),p('count',{contactCount:10}),p('b'),p('a'),p('low',{priorityLevel:'LOW',contactCount:0,coffeeCount:0})];
 const before=JSON.stringify(rows);const counts=new Map([['opp',1]]);
 assert.deepEqual(ids(sortPriorityRows(rows,counts,null)),['a','b','count','coffee','opp','low']);assert.equal(JSON.stringify(rows),before);
});
test('BF07 every manual column replaces initial priority ordering, ascending and descending',()=>{
 const columns={objectiveName:['Alfa','Zulu'],objectiveType:['COMPANY','ROLE'],priorityLevel:['LOW','HIGH'],contactCount:[2,10],coffeeCount:[2,10],lastInteractionAt:['2025-12-31T23:00:00Z','2026-01-01T00:00:00Z'],networkingStatus:['Contactado','Cita concretada']};
 for(const [key,[low,high]] of Object.entries(columns)){
  const rows=[p('a',{priorityLevel:'LOW',[key]:high}),p('b',{priorityLevel:'HIGH',[key]:low})];
  assert.deepEqual(ids(sortPriorityRows(rows,undefined,{key,direction:'asc'})),['b','a'],key);assert.deepEqual(ids(sortPriorityRows(rows,undefined,{key,direction:'desc'})),['a','b'],key);
 }
 const rows=[p('a',{priorityLevel:'LOW'}),p('b')],counts=new Map([['a',10],['b',2]]);
 assert.deepEqual(ids(sortPriorityRows(rows,counts,{key:'opportunities',direction:'asc'})),['b','a']);assert.deepEqual(ids(sortPriorityRows(rows,counts,{key:'opportunities',direction:'desc'})),['a','b']);
});
test('BF07 manual ties use identity only, dates use instants, unavailable details remain neutral',()=>{
 const rows=[p('a',{priorityLevel:'LOW',lastInteractionAt:'2026-01-02T00:00:00Z'}),p('b',{lastInteractionAt:'2026-01-01T23:59:59Z'})];
 assert.deepEqual(ids(sortPriorityRows(rows,undefined,{key:'contactCount',direction:'asc'})),['a','b']);
 assert.deepEqual(ids(sortPriorityRows(rows,undefined,{key:'lastInteractionAt',direction:'asc'})),['b','a']);
 assert.deepEqual(ids(sortPriorityRows(rows,undefined,{key:'lastInteractionAt',direction:'asc'},true)),['a','b']);
 assert.deepEqual(ids(sortPriorityRows([p('a',{networkingStatus:''}),p('b')],undefined,{key:'networkingStatus',direction:'asc'})),['a','b']);
 assert.equal(planningDate('invalid'),null);assert.equal(planningDate(null),null);
 assert.deepEqual(ids(sortPriorityRows([p('b',{lastInteractionAt:'2026-01-01'}),p('a')],undefined,{key:'lastInteractionAt',direction:'asc'})),['a','b']);
});
test('BF09 initial order puts missing first, then oldest, lesser status and company',()=>{
 const rows=[h('z',{status:'Contactado'}),h('no-date'),h('invalid',{lastInteractionAt:'invalid'}),h('b',{lastInteractionAt:'2026-01-01',status:'Contactado'}),h('a',{lastInteractionAt:'2026-01-01',status:'Contactado'}),h('old',{lastInteractionAt:'2025-01-01',status:'Agradecimiento enviado'}),h('pending',{lastInteractionAt:'2026-01-01'}),h('new',{lastInteractionAt:'2026-02-01'})];
 const before=JSON.stringify(rows);assert.deepEqual(ids(sortHeadhunterRows(rows,null)),['invalid','no-date','z','old','pending','a','b','new']);assert.equal(JSON.stringify(rows),before);
});
test('BF09 every manual column takes precedence over date and status',()=>{
 const columns={domain:['alfa','zulu'],contactCount:[2,10],status:['Contactado','Agendado'],lastInteractionAt:['2025-12-31','2026-01-01'],daysSince:[2,10],type:['calendar','message'],subject:['Alfa','Zulu']};
 for(const [key,[low,high]] of Object.entries(columns)){
  const rows=[h('a',{lastInteractionAt:'2025-01-01',[key]:high}),h('b',{lastInteractionAt:'2026-01-01',[key]:low})];
  const a=rows[0].domain,b=rows[1].domain;
  assert.deepEqual(ids(sortHeadhunterRows(rows,{key,direction:'asc'})),[b,a],key);assert.deepEqual(ids(sortHeadhunterRows(rows,{key,direction:'desc'})),[a,b],key);
 }
});
test('BF09 missing dates/ages remain first in both directions and all equal ties are deterministic',()=>{
 for(const key of ['lastInteractionAt','daysSince'])for(const direction of ['asc','desc']){
  assert.equal(ids(sortHeadhunterRows([h('b',{lastInteractionAt:'2026-01-01',daysSince:2}),h('a')],{key,direction}))[0],'a');
 }
 assert.deepEqual(ids(sortHeadhunterRows([h('b'),h('a')],{key:'contactCount',direction:'desc'})),['a','b']);
 assert.deepEqual(ids(sortHeadhunterRows([h('b',{subject:'Z'}),h('a',{subject:''})],{key:'subject',direction:'asc'})),['a','b']);
 assert.deepEqual(ids(sortHeadhunterRows([],null)),[]);
 assert.deepEqual(ids(sortPriorityRows([],undefined,null)),[]);
});
