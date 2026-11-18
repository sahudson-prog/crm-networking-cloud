import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
test('shared skeleton exposes pending state without fake values or technical visible copy',()=>{
  const module={exports:{}};
  const code=ts.transpileModule(readFileSync(new URL('../components/ui/ViewSkeleton.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:()=>jsx});
  for(const kind of ['table','board','list']){
    const html=renderToStaticMarkup(React.createElement(module.exports.ViewSkeleton,{kind,label:'Contactos'}));
    assert.match(html,/aria-busy="true"/);assert.match(html,/role="status"/);
    assert.doesNotMatch(html,/Cargando|Leyendo|Actualizando|Sin contactos/);
    assert.equal((html.match(/view-skeleton-row/g)||[]).length,5);
  }
});

test('Coach tasks start before contacts finish while preserving active-contact eligibility',async()=>{
  const module={exports:{}};let queried=false,finishContacts;
  const contacts=new Promise(resolve=>{finishContacts=resolve;});
  const tasks=[{id:'a',object_type:'contact',object_id:'active',summary:'old'},{id:'b',object_type:'contact',object_id:'inactive'}];
  const q={select(){return q;},eq(){return q;},order(){return q;},range(){return q;},then(ok){queried=true;return Promise.resolve({data:tasks}).then(ok);}};
  const code=ts.transpileModule(readFileSync(new URL('../lib/workspaceRead.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require(name){
    if(name==='./supabaseClient')return {supabase:{from:()=>q}};
    if(name==='./completeRead')return {readCompletePages:async read=>(await read(0,199)).data};
    throw Error(name);
  }});
  const pending=module.exports.readWorkspaceTodos(contacts);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(queried,true);
  finishContacts([{id:'active',is_active:true,display_name:'Synthetic'},{id:'inactive',is_active:false}]);
  const result=await pending;assert.equal(result.length,1);assert.equal(result[0].summary,'Synthetic');
});
