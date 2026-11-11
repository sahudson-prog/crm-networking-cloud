// Real coordinator, Supabase client, adapter and engine; fresh browser and synthetic I/O only.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..'), req = createRequire(path.join(root, 'package.json'));
const { webpack } = req('next/dist/compiled/webpack/webpack');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-manual-browser-'));
const imp = file => JSON.stringify(path.join(root, file).replaceAll('\\', '/'));
let browser;
async function main() {
  fs.writeFileSync(path.join(output, 'loader.cjs'), `const ts=require(${JSON.stringify(req.resolve('typescript'))});module.exports=src=>ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  fs.writeFileSync(path.join(output, 'entry.ts'), `
import {updateCalendarV2} from ${imp('lib/calendarManualSyncData.ts')};
import {bindGlobalActivitySyncScope,startGlobalActivitySync,executeActivitySyncServices,startCalendarRunControl,endCalendarRunControl,getGlobalActivitySyncSnapshot} from ${imp('lib/activitySyncExecution.ts')};
export async function run(){
 const account='00000000-0000-4000-8000-000000000001';
 bindGlobalActivitySyncScope(account);
 let diagnostic=null;
 const run=startGlobalActivitySync(()=>executeActivitySyncServices({includeMail:false,includeCalendar:true,runService:async service=>{
  try{
   const result=await updateCalendarV2({accessToken:'synthetic-only',connectedAccountId:account,timeMin:'2026-11-01T00:00:00Z',timeMax:'2026-12-01T00:00:00Z',signal:startCalendarRunControl()});
   return {service,created:result.created,error:'',reauthorizationRequired:false,success:true,syncedAt:result.synced_at};
  }catch(error){
   diagnostic={code:error.code,phase:error.phase,errorClass:error.errorClass,location:error.location,httpStatus:error.httpStatus};
   return {service,created:error.created??0,error:error.message,reauthorizationRequired:false,success:false,syncedAt:null};
  }finally{endCalendarRunControl();}
 }}));
 await run.promise;
 return {snapshot:getGlobalActivitySyncSnapshot(),diagnostic};
}
`);
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, context: root,
      entry: path.join(output, 'entry.ts'), output: { path: output, filename: 'bundle.js', library: { name: 'fixture', type: 'window' } },
      resolve: { extensions: ['.ts', '.js', '.json'], modules: [path.join(root, 'node_modules'), 'node_modules'] },
      module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: [path.join(output, 'loader.cjs')] }] },
      plugins: [new webpack.DefinePlugin({
        'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify('https://db.fixture.invalid'),
        'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('synthetic-public-only'),
        'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': 'undefined'
      })] });
    compiler.run((e, s) => compiler.close(() => e || s.hasErrors() ? reject(e || new Error(s.toString({ all: false, errors: true }))) : resolve()));
  });
  const { chromium } = require(process.env.CALENDAR_PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const mode of ['complete', 'incremental', 'invalid-context', 'invalid-renew', 'denied', 'invalid-json', 'transport', 'rpc-transport', 'lost-finish']) await scenario(mode);
}

async function scenario(mode) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const actions = [], google = [], unknown = [], runs = new Set();
  let saved = 0, finished = false, finishes = 0;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
    if (url.origin === 'http://127.0.0.1:43579') {
      if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(output, 'bundle.js'), 'utf8') });
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/bundle.js"></script>' });
    }
    if (url.origin === 'https://db.fixture.invalid' && url.pathname === '/rest/v1/rpc/calendar_manual_sync_v2') {
      const args = request.postDataJSON(), action = args.p_action;
      actions.push(action); runs.add(args.p_run);
      assert.equal(args.p_account, '00000000-0000-4000-8000-000000000001');
      if (mode === 'denied') return json({ code: '42501', message: 'synthetic private value' }, 403);
      if (mode === 'rpc-transport') return json({ code: 'private', message: 'synthetic private value' }, 503);
      if (action === 'begin') return json(mode === 'invalid-context' ? { status: 'unexpected' } : {
        status: 'running', token: mode === 'incremental' ? 'synthetic-cursor' : null,
        timeMin: args.p_payload.timeMin, timeMax: args.p_payload.timeMax
      });
      if (action === 'known') return json({ rows: [] });
      if (action === 'apply') { saved += args.p_payload.events.length; return json({ status: 'applied' }); }
      if (action === 'finish') {
        finished = true; finishes++;
        if (mode === 'lost-finish' && finishes === 1) return route.abort('failed');
        return json({ status: 'complete', created: saved, updated: 0, skipped: 0, synced_at: '2026-11-06T12:00:00Z' });
      }
      if (action === 'abort') return json({ status: 'aborted', created: saved });
      if (action === 'renew') return json({ status: mode === 'invalid-renew' ? 'unexpected' : 'running' });
    }
    if (url.origin === 'https://www.googleapis.com' && url.pathname === '/calendar/v3/calendars/primary/events') {
      google.push(url.searchParams.has('syncToken') ? 'changes' : 'discovery');
      assert.equal(request.headers().authorization, 'Bearer synthetic-only');
      if (mode === 'transport') return route.abort('failed');
      if (mode === 'invalid-json') return route.fulfill({ contentType: 'application/json', body: '{invalid synthetic private value' });
      if (mode === 'incremental') return json({ items: [], nextSyncToken: 'synthetic-next' });
      return json({ items: [{ id: 'synthetic-event', status: 'confirmed', updated: '2026-11-06T12:00:00Z', start: { dateTime: '2026-11-07T12:00:00Z' } }], nextSyncToken: 'synthetic-next' });
    }
    unknown.push(url.origin); await route.abort();
  });
  try {
    await page.goto('http://127.0.0.1:43579/');
    const result = await page.evaluate(() => window.fixture.run());
    const success = ['complete', 'incremental', 'lost-finish'].includes(mode);
    assert.deepEqual(unknown, []);
    assert.equal(runs.size, 1);
    assert.equal(result.snapshot.running, false);
    assert.equal(result.snapshot.outcomes[0].success, success,
      JSON.stringify({ mode, actions, google, diagnostic: result.diagnostic }));
    assert.equal(finished, success);
    if (success) {
      assert.deepEqual(google, mode === 'incremental' ? ['changes', 'discovery'] : ['discovery']);
      assert.equal(saved, mode === 'incremental' ? 0 : 1);
      assert.equal(result.snapshot.lastSuccess.calendar, '2026-11-06T12:00:00Z');
      if (mode === 'lost-finish') {
        assert.equal(finishes, 2);
        assert.equal(actions.filter(a => a === 'apply').length, 1);
        assert.equal(actions.includes('abort'), false);
      }
    } else {
      assert.equal(result.snapshot.lastSuccess?.calendar, undefined);
      assert.equal(saved, 0);
      if (mode === 'invalid-context' || mode === 'denied') assert.equal(google.length, 0);
      if (mode === 'invalid-context') assert.equal(result.diagnostic.code, 'CALENDAR_INVALID_CONTEXT');
      if (mode === 'denied') assert.equal(result.diagnostic.code, '42501');
      if (mode === 'invalid-renew') {
        assert.deepEqual(actions, ['begin', 'renew', 'abort']);
        assert.equal(google.length, 0);
        assert.equal(result.diagnostic.code, 'CALENDAR_INVALID_RESPONSE');
        assert.equal(result.diagnostic.phase, 'renew');
        assert.equal(result.diagnostic.location, 'calendar.rpc');
      }
      if (mode === 'rpc-transport') {
        assert.deepEqual(actions, ['begin', 'begin', 'begin', 'begin']);
        assert.equal(google.length, 0);
        assert.equal(result.diagnostic.code, 'CALENDAR_RPC_TRANSPORT');
        assert.equal(result.diagnostic.phase, 'begin');
        assert.equal(result.diagnostic.location, 'calendar.rpc');
      }
      if (mode === 'invalid-json') {
        assert.equal(result.diagnostic.code, 'CALENDAR_INVALID_RESPONSE');
        assert.equal(result.diagnostic.errorClass, 'SyntaxError');
        assert.equal(result.diagnostic.location, 'google.response.json');
      }
      if (mode === 'transport') {
        assert.deepEqual(actions, ['begin', 'renew', 'abort']);
        assert.equal(google.length, 4);
        assert.equal(result.diagnostic.errorClass, 'TypeError');
        assert.equal(result.diagnostic.location, 'google.fetch');
      }
      assert.doesNotMatch(JSON.stringify(result.diagnostic), /synthetic|private|Bearer|https:|@/);
    }
    console.log(`PASS ${mode}: Google requests=${google.length}; RPC actions=${actions.join(',')}`);
  } finally { await context.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); });
