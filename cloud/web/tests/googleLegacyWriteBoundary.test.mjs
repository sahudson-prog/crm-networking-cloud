import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

test('real shared writer preserves Gmail/context/diagnostics but never dispatches legacy Calendar', async () => {
  const dir=mkdtempSync(join(tmpdir(),'google-legacy-boundary-'));
  try {
    for(const name of ['externalInteractionSync','syncItemDiagnostics']) {
      const src=readFileSync(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
      const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
        .replaceAll('./supabaseClient','./supabase.mjs').replaceAll('./syncItemDiagnostics.ts','./syncItemDiagnostics.mjs');
      writeFileSync(join(dir,`${name}.mjs`),js);
    }
    writeFileSync(join(dir,'supabase.mjs'),`export const state={calls:[],mode:'ok'};
      export const supabase={rpc:async(name,args)=>{state.calls.push({name,args});
        if(state.mode==='transport')throw new Error('synthetic private detail');
        if(state.mode==='reject')return {status:403,error:{code:'42501',message:'synthetic private detail'}};
        if(state.mode==='bad')return {status:200,data:{status:'invalid'}};
        return {status:200,data:{status:'created',interaction_id:'synthetic',participants_inserted:1}};
      }};`);
    const {syncExternalInteraction}=await import(pathToFileURL(join(dir,'externalInteractionSync.mjs')));
    const {state}=await import(pathToFileURL(join(dir,'supabase.mjs')));
    const gmail={provider:'google',sourceService:'gmail',externalObjectType:'email_message',externalId:'GMAIL_OriginalCase',interactionType:'email',connectedAccountId:'synthetic-account'};
    await assert.rejects(syncExternalInteraction({...gmail,connectedAccountId:null}),e=>e.code==='SYNC_ACCOUNT_REQUIRED');
    for(const sourceService of ['calendar',' Calendar ']) await assert.rejects(syncExternalInteraction({...gmail,sourceService,interactionType:'calendar'}),e=>e.code==='GOOGLE_LEGACY_CALENDAR_DENIED');
    assert.equal(state.calls.length,0);
    assert.equal((await syncExternalInteraction(gmail)).status,'created');
    assert.equal(state.calls[0].name,'apply_google_periodic_v1');
    assert.equal(state.calls[0].args.p_connected_account_id,'synthetic-account');
    assert.equal(state.calls[0].args.p_item.externalId,'gmail_originalcase');
    const context={cycle_id:'synthetic-cycle'};
    await syncExternalInteraction({...gmail,historyWindow:context});
    assert.equal(state.calls[1].name,'apply_google_history_v1');
    assert.deepEqual(state.calls[1].args.p_context,context);
    for(const [mode,code,outcome] of [['reject','42501','rejected'],['bad','SYNC_RESPONSE_INVALID','uncertain'],['transport','SYNC_TRANSPORT_UNCERTAIN','uncertain']]) {
      state.mode=mode;
      await assert.rejects(syncExternalInteraction(gmail),e=>e.code===code&&e.outcome===outcome&&!JSON.stringify(e).includes('private detail'));
    }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
