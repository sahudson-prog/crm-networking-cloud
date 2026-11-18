import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as Popover from '@radix-ui/react-popover';
import * as icons from 'lucide-react';

function load(file,deps={},extra={}) {
  const module={exports:{}};
  const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,Error,performance,process:{env:{NODE_ENV:'production'}},console:{info(){}},
    require(name){if(name==='react/jsx-runtime')return jsx;if(name in deps)return deps[name];throw Error('Unexpected dependency '+name);},...extra});
  return module.exports;
}
const state=load('lib/operationState.ts');
const {OperationStatus}=load('components/ui/OperationStatus.tsx',{
  react:React,
  '@radix-ui/react-popover':Popover,'lucide-react':icons,'../../lib/operationState':state,
  './Button':{Button:({children})=>React.createElement('button',null,children)}});

test('status precedence never confirms initial reads, pending writes, reconciliation or errors',()=>{
  for(const [input,expected] of [
    [{resolved:false},'busy'],[{resolved:true},'ready'],[{resolved:true,busy:true},'busy'],
    [{resolved:false,error:'Read failed'},'error'],[{resolved:true,busy:true,error:'Uncertain'},'error'],
    [{resolved:true,error:'Save failed'},'error'],[{resolved:true,busy:false},'ready']
  ])assert.equal(state.operationPhase(input),expected);
});

test('all phases reserve the same slot and provide keyboard-accessible named status',()=>{
  for(const props of [{resolved:false},{resolved:true},{resolved:true,busy:true},{resolved:true,error:'Retry required',onRetry(){}}]){
    const html=renderToStaticMarkup(React.createElement(OperationStatus,{label:'Synthetic board',...props}));
    assert.match(html,/class="operation-status"/);
    if(props.resolved && !props.busy && !props.error) {
      assert.match(html,/data-phase="idle"/);assert.doesNotMatch(html,/<button/);
    } else {
      assert.match(html,/type="button"/);assert.match(html,/aria-label="Synthetic board:/);
    }
    assert.match(html,/role="status"/);
    assert.match(html,/aria-live="polite"/);assert.doesNotMatch(html,/Estados guardados|Cambio pendiente/);
  }
  const css=readFileSync(new URL('../styles/operation-status.css',import.meta.url),'utf8');
  assert.match(css,/28px/);assert.match(css,/prefers-reduced-motion/);assert.match(css,/animation:\s*none/);
});

function timedStatus(initial={resolved:false}) {
  const slots=[],timers=new Map();let cursor=0,effects=[],dirty=false,clock=0,id=0,props=initial,tree;
  const react={
    useRef(value){const i=cursor++;return slots[i]??=( {current:value} );},
    useState(value){const i=cursor++;slots[i]??={value};return [slots[i].value,next=>{
      if(!Object.is(slots[i].value,next)){slots[i].value=next;dirty=true;}
    }];},
    useEffect(fn,deps){const i=cursor++,old=slots[i];
      if(!old || !deps.every((v,n)=>Object.is(v,old.deps[n]))){
        slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});
      }
    }
  };
  const {OperationStatus:Component}=load('components/ui/OperationStatus.tsx',{
    react,'@radix-ui/react-popover':Popover,'lucide-react':icons,'../../lib/operationState':state,
    './Button':{Button:()=>null}}, {
    setTimeout(fn,delay){const key=++id;timers.set(key,{at:clock+delay,fn});return key;},
    clearTimeout(key){timers.delete(key);}
  });
  function render(next=props){props=next;let count=0;do{
    dirty=false;cursor=0;tree=Component({label:'Synthetic',...props});const pending=effects;effects=[];pending.forEach(fn=>fn());
    if(++count>10)throw Error('render loop');
  }while(dirty);return tree;}
  function find(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;
    for(const child of React.Children.toArray(node.props?.children)){const found=find(child,predicate);if(found)return found;}return null;}
  render();return {render,phase:()=>tree.props['data-phase'],timerCount:()=>timers.size,
    button:()=>find(tree,n=>n.type==='button'),popup:()=>find(tree,n=>n.type===Popover.Root),
    advance(ms){clock+=ms;for(const [key,timer] of timers)if(timer.at<=clock){timers.delete(key);timer.fn();}render();},
    unmount(){slots.forEach(slot=>slot.cleanup?.());}};
}

test('confirmation lasts exactly three seconds; ordinary renders and callback identities do not restart it',()=>{
  const f=timedStatus();f.advance(10000);assert.equal(f.phase(),'busy');assert.equal(f.timerCount(),0);
  f.render({resolved:true});assert.equal(f.phase(),'ready');assert.equal(f.timerCount(),1);
  f.advance(2000);f.render({resolved:true,label:'Changed heading',onRetry(){}});
  f.advance(999);assert.equal(f.phase(),'ready');f.advance(1);
  assert.equal(f.phase(),'idle');assert.equal(f.button(),null);assert.equal(f.timerCount(),0);
  f.render({resolved:true,onRetry(){}});assert.equal(f.phase(),'idle');
});

test('new work cancels expiry; errors stay visible until resolved and each real confirmation gets a new window',()=>{
  const f=timedStatus();f.render({resolved:true});f.advance(1000);
  f.render({resolved:true,busy:true,confirming:true});assert.equal(f.phase(),'busy');assert.equal(f.timerCount(),0);
  f.advance(5000);assert.equal(f.phase(),'busy');
  f.render({resolved:true,error:'Uncertain'});f.advance(10000);assert.equal(f.phase(),'error');
  f.render({resolved:true,busy:true,error:'Uncertain'});assert.equal(f.phase(),'error');
  f.render({resolved:true});assert.equal(f.phase(),'ready');f.advance(2999);assert.equal(f.phase(),'ready');
  f.advance(1);assert.equal(f.phase(),'idle');
});

test('cached confirmed mount is quiet and unmount clears the only timer',()=>{
  const cached=timedStatus({resolved:true});assert.equal(cached.phase(),'idle');assert.equal(cached.timerCount(),0);
  const f=timedStatus();f.render({resolved:true});assert.equal(f.timerCount(),1);
  f.unmount();assert.equal(f.timerCount(),0);
});

test('unchanged revalidation is silent, but an explicit saved operation confirms once',()=>{
  const f=timedStatus({resolved:true});
  f.render({resolved:true,busy:true});assert.equal(f.phase(),'busy');
  f.render({resolved:true});assert.equal(f.phase(),'idle');assert.equal(f.timerCount(),0);
  f.render({resolved:true,confirming:true});assert.equal(f.phase(),'busy');
  f.render({resolved:true,confirming:false});assert.equal(f.phase(),'ready');
  f.advance(1000);f.render({resolved:true});f.advance(1999);assert.equal(f.phase(),'ready');
  f.advance(1);assert.equal(f.phase(),'idle');f.advance(3000);assert.equal(f.phase(),'idle');
});

test('background reads during a check preserve its original expiry, never extend it',()=>{
  const f=timedStatus();f.render({resolved:true});f.advance(1000);
  f.render({resolved:true,busy:true});assert.equal(f.phase(),'busy');f.advance(1000);
  f.render({resolved:true});assert.equal(f.phase(),'ready');f.advance(1000);
  assert.equal(f.phase(),'idle');f.render({resolved:true,busy:true});f.advance(100);
  f.render({resolved:true});assert.equal(f.phase(),'idle');
});

test('expiry removes the glyph without stealing focus or leaving an invisible tab stop',()=>{
  const f=timedStatus();f.render({resolved:true});f.button().props.onFocus();f.render();f.advance(3000);
  assert.equal(f.phase(),'idle');assert.ok(f.button());assert.equal(f.button().props.children,null);
  f.button().props.onBlur();f.render();assert.equal(f.button(),null);
});

test('an open accessible detail survives expiry and closes normally without restarting confirmation',()=>{
  const f=timedStatus();f.render({resolved:true});f.popup().props.onOpenChange(true);f.render();f.advance(3000);
  assert.equal(f.phase(),'idle');assert.equal(f.popup().props.open,true);
  f.popup().props.onOpenChange(false);f.render();assert.equal(f.popup(),null);assert.equal(f.timerCount(),0);
});

test('sanitized stage measurements retain bounded timings without payloads or raw error messages',async()=>{
  let clock=0;const logs=[];
  const d=load('lib/operationDiagnostics.ts',{}, {performance:{now:()=>clock},console:{info:(_label,row)=>logs.push(row)}});
  await d.measureOperation('contact-write',async()=>{clock+=125;return {error:{code:'42501',message:'private@example.test',details:'secret'}};});
  assert.deepEqual(JSON.parse(JSON.stringify(d.getOperationTimings()[0])),{stage:'contact-write',ms:125,outcome:'error',code:'42501'});
  await assert.rejects(d.measureOperation('board-reconcile',async()=>{throw Error('private@example.test');}));
  assert.equal(d.getOperationTimings().at(-1).code,'client_or_transport');
  for(let i=0;i<110;i++)await d.measureOperation('board-write',async()=>{clock++;});
  assert.equal(d.getOperationTimings().length,100);
  assert.doesNotMatch(JSON.stringify(logs),/private|secret|details/);
  const copy=d.getOperationTimings();copy[0].ms=999;assert.notEqual(d.getOperationTimings()[0].ms,999);
});

function readFixture(){
  const {ScopedReadCache}=load('lib/scopedReadCache.ts');const cache=new ScopedReadCache();
  let owner='synthetic-a',calls=0,resolve,failure;
  cache.scope(owner);
  const first=new Promise(ok=>{resolve=ok;});
  const api=load('lib/readOpportunityBoard.ts',{
    './indicatorReads':{getSharedReadOwner:()=>owner,readSharedView:(key,fn)=>cache.read(key,fn)},
    './opportunityActions':{readOpportunities:async()=>{calls++;if(failure)throw failure;return calls===1?first:['current'];}}});
  return {api,cache,resolve,calls:()=>calls,fail(){failure=Error('technical failure');},switch(){owner='synthetic-b';cache.scope(owner);}};
}
test('superseded opportunity cache read retries once with the current generation',async()=>{
  const f=readFixture();const pending=f.api.readOpportunityBoard();await Promise.resolve();
  f.cache.invalidate();f.resolve(['old']);assert.deepEqual(await pending,['current']);assert.equal(f.calls(),2);
});
test('opportunity retries never turn technical errors into empty results',async()=>{
  const f=readFixture();f.fail();await assert.rejects(f.api.readOpportunityBoard(),/technical failure/);assert.equal(f.calls(),1);
});
test('old opportunity reader cannot restart under a different user',async()=>{
  const f=readFixture();const pending=f.api.readOpportunityBoard();await Promise.resolve();
  f.switch();f.resolve(['old']);await assert.rejects(pending,/read_superseded/);assert.equal(f.calls(),1);
});
