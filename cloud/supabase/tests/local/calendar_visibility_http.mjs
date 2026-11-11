import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';

// Real PostgREST and production readers; only disposable, network-none PostgreSQL.
export async function withCalendarVisibilityHttp({ web, docker, sql, name, label, run, user, contact, cycle, token }, exercise) {
  const info = JSON.parse(docker(['inspect', name]))[0];
  assert.equal(info.Config.Labels[label], run);
  assert.equal(info.HostConfig.NetworkMode, 'none');
  const apiName = `${name}-visibility`, secret = randomUUID() + randomUUID();
  const image = 'public.ecr.aws/supabase/postgrest:v16.4';
  const req = createRequire(join(web, 'package.json'));
  const ts = req('typescript'), { PostgrestClient } = req('@supabase/postgrest-js');
  let identity = '';
  try {
    sql(`create function public.calendar_test_claim_adapter() returns void language plpgsql as $$
      begin perform pg_catalog.set_config('request.jwt.claim.sub',current_setting('request.jwt.claims',true)::jsonb->>'sub',true); end; $$;
      revoke all on function public.calendar_test_claim_adapter() from public;
      grant execute on function public.calendar_test_claim_adapter() to authenticated;`);
    docker(['image', 'inspect', image]);
    identity = docker(['create', '--pull=never', '--name', apiName, '--label', `${label}=${run}`, '--network', `container:${name}`,
      '-e', 'PGRST_DB_URI=postgres://postgres@127.0.0.1:5432/postgres', '-e', 'PGRST_DB_SCHEMAS=public',
      '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${secret}`, '-e', 'PGRST_SERVER_PORT=3010',
      '-e', 'PGRST_DB_MAX_ROWS=100', '-e', 'PGRST_DB_PRE_REQUEST=public.calendar_test_claim_adapter', image]);
    docker(['start', apiName]);
    const body = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' +
      Buffer.from(JSON.stringify({ sub: user, role: 'authenticated', exp: Math.floor(Date.now()/1000)+600 })).toString('base64url');
    const jwt = body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
    const rest = new PostgrestClient('http://127.0.0.1:3010', { headers: { Authorization: `Bearer ${jwt}` }, fetch: async (url, options = {}) => {
      assert.equal(new URL(url).origin, 'http://127.0.0.1:3010');
      const args = ['exec', name, 'curl', '-sS', '--max-time', '15', '-D', '-'];
      if (options.method === 'HEAD') args.push('-I'); else args.push('-X', options.method || 'GET');
      for (const [key, value] of new Headers(options.headers)) args.push('-H', `${key}: ${value}`);
      if (options.body) args.push('--data', String(options.body));
      args.push(String(url));
      const raw = docker(args), crlf = raw.includes('\r\n\r\n'), end = raw.indexOf(crlf ? '\r\n\r\n' : '\n\n');
      const lines = raw.slice(0, end).split(/\r?\n/), status = Number(lines.shift().split(' ')[1]);
      const headers = new Headers();
      for (const line of lines) { const at = line.indexOf(':'); if (at > 0) headers.set(line.slice(0, at), line.slice(at+1).trim()); }
      return new Response(status === 204 || options.method === 'HEAD' ? null : raw.slice(end + (crlf ? 4 : 2)), { status, headers });
    }});
    let ready = false;
    for (let i=0; i<60; i++) {
      try { const result = await rest.from('interactions').select('id').limit(1); if (!result.error) { ready=true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'isolated PostgREST ready');
    const load = (file, imports = {}) => {
      const module = { exports: {} };
      const code = ts.transpileModule(readFileSync(join(web, 'lib', file+'.ts'), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      vm.runInNewContext(code, { module, exports: module.exports, console, require: key => {
        if (!(key in imports)) throw Error('Unexpected test import: '+key); return imports[key];
      }});
      return module.exports;
    };
    const state = load('interactionState'), complete = load('completeRead');
    const client = { auth: { getUser: async () => ({ data: { user: { id: user } }, error: null }) }, from: rest.from.bind(rest), rpc: rest.rpc.bind(rest) };
    const readers = load('cloudData', { './supabaseClient': { supabase: client }, './interactionState': state,
      './completeRead': complete, './kpiCalculations': {}, './cycleObjectiveActions': {} });
    const actions = load('opportunityActions', { './supabaseClient': { supabase: client }, './interactionState': state,
      './opportunityModel': load('opportunityModel'), './opportunityDiagnostics': load('opportunityDiagnostics'),
      './networkingCycles': { expectedNetworkingContext: async () => ({ cycleId: cycle, token }), networkingContextFromCycles: () => ({ token }),
        readNetworkingCycles: async () => [{ id: cycle, status: 'active', objective_type: 'JOB_SEARCH' }] } });
    await exercise(readers, actions);
    // A provider/API page cap must not let tombstones consume the user's visible page.
    const ids = Array.from({ length: 401 }, () => randomUUID());
    sql(`insert into public.interactions(id,user_id,interaction_type,subject,occurred_at)
      select x,'${user}','manual','Synthetic visible',now()-interval '1 day' from unnest(array[${ids.map(id=>`'${id}'`).join(',')}]::uuid[]) x;
      insert into public.interaction_participants(user_id,interaction_id,contact_id)
      select '${user}',x,'${contact}' from unnest(array[${ids.map(id=>`'${id}'`).join(',')}]::uuid[]) x;`);
    assert.equal((await readers.readAllInteractions()).length, 403);
    assert.equal((await readers.readRecentInteractions(8)).length, 8);
    assert.equal((await readers.readContactInteractions(contact, 60)).length, 60);
    assert.equal((await readers.readAppSummary()).interactions, 403);
    console.log('PASS real PostgREST readers: anti-join, counts, contact join, page cap100/403 visible; no tombstone in normal reads.');
  } finally {
    if (identity) {
      const current = JSON.parse(docker(['inspect', apiName]))[0];
      assert.equal(current.Id, identity); assert.equal(current.Config.Labels[label], run);
      docker(['rm', '-f', apiName]);
    }
  }
}
