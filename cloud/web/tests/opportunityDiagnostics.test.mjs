import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const source=readFileSync(new URL('../lib/opportunityDiagnostics.ts',import.meta.url),'utf8');
const module={exports:{}},logs=[];
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {module,exports:module.exports,console:{warn:(...args)=>logs.push(args)}});
const {opportunityFailure,opportunityPhase}=module.exports;
test('diagnostics classify rejection, stale context and uncertain transport without private fields',()=>{
  const privateData={message:'private@example.invalid token=secret',details:{id:'private-id'},payload:{email:'private@example.invalid'}};
  assert.equal(opportunityFailure('rpc',{...privateData,code:'42501'},403).kind,'rejected');
  assert.equal(opportunityFailure('context',{code:'40001',message:'networking_context_stale'},500).kind,'stale');
  assert.equal(opportunityFailure('rpc',privateData,0).kind,'uncertain');
  assert.equal(opportunityFailure('rpc',{code:'22023',message:'opportunity_request_conflict'},400).kind,'stale');
  assert.doesNotMatch(JSON.stringify(logs),/private|secret|payload|details/);
});
test('failure preserves phase across nested wrappers',async()=>{
  await assert.rejects(opportunityPhase('interactions',()=>opportunityPhase('auth',async()=>{throw {code:'40101'};})),
    error=>error.phase==='auth'&&error.kind==='rejected');
});
