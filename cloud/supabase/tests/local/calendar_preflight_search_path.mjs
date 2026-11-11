import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const run = randomUUID(), name = `cc-calendar-path-${run.slice(0, 8)}`;
const label = 'coffeecito.calendar.searchpath-test';
const docker = (args, input) => execFileSync('docker', args, {
  encoding: 'utf8', input, timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'],
}).trim();
const sql = input => docker(['exec', '-i', name, 'psql', '-X', '-qAt', '-v',
  'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres'], input);
const signatures = ['user_has_provider_rollout_for_user_v1(uuid,text)',
  'finalize_google_connected_account_verified(uuid,text,text[])',
  'apply_google_interaction_sync_v1(uuid,jsonb)'];
const files = ['preflight/202611060001_preflight_calendar_independent.sql',
  'migrations/202611060001_calendar_independent.sql',
  'verifiers/202611060001_verify_calendar_independent.sql'];
let identity = '', checks = 0;
try {
  identity = docker(['create', '--pull=never', '--name', name, '--label', `${label}=${run}`,
    '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e',
    'PGDATA=/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]);
  docker(['start', name]);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { ready = sql('select 1;') === '1'; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready);
  const info = JSON.parse(docker(['inspect', name]))[0];
  assert.equal(info.HostConfig.NetworkMode, 'none');
  assert.equal(Object.keys(info.HostConfig.PortBindings ?? {}).length, 0);
  assert.match(sql('show server_version;'), /^17\./);
  for (const file of files) {
    const source = readFileSync(resolve(root, file), 'utf8');
    const guard = source.slice(source.indexOf('do $guard$'),
      source.indexOf("  if to_regprocedure('public.apply_google_periodic_v1")) + 'end;\n$guard$;';
    const bodies = [...guard.matchAll(/\$expected\$([\s\S]*?)\$expected\$/g)].map(m => m[1]);
    assert.equal(bodies.length, signatures.length);
    // Metadata fixtures only: store the exact bodies without resolving application tables.
    // Never invoke these synthetic functions; execute the real catalog guards instead.
    const setup = 'set check_function_bodies=off;\n' + signatures.map((signature, i) =>
      `create or replace function public.${signature} returns boolean language sql stable
       security definer set search_path='' as $fixture$${bodies[i]}$fixture$;
       revoke all on function public.${signature} from public, anon, authenticated, service_role;`
    ).join('\n');
    // Simulate Windows clipboard/editor transport without changing the DB body.
    const crlfGuard = guard.replace(/\r?\n/g, '\r\n');
    const mixedGuard = guard.replace(/\n(?=  )/g, '\r\n');
    for (const stored of [setup, setup.replace(/\r?\n/g, '\r\n')]) {
      sql(stored);
      for (const transported of [guard, crlfGuard, mixedGuard]) {
        sql(transported); checks++;
      }
    }
    for (const signature of signatures) {
      const alter = `alter function public.${signature}`;
      sql(`begin; select set_config('search_path','',true); ${alter} set search_path from current; ${guard} rollback;`);
      checks++;
      for (const change of [
        `${alter} set search_path=public;`, `${alter} set search_path=pg_temp;`,
        `${alter} reset search_path;`, `${alter} security invoker;`,
        `grant create on schema public to anon; ${alter} owner to anon;`,
        `grant execute on function public.${signature} to anon;`,
        `grant execute on function public.${signature} to public;`,
        `create or replace function public.${signature} returns boolean language sql stable security definer set search_path='' as $$select false;$$;`,
        `drop function public.${signature};`,
      ]) {
        for (const transported of [guard, crlfGuard]) {
          assert.throws(() => sql(`begin; ${change}\n${transported}\nrollback;`), /STOP: (incompatible|unexpected public execute)/);
          checks++;
        }
      }
    }
  }
  console.log(`PASS: ${checks} catalog-guard assertions; PostgreSQL 17, no network/ports, synthetic metadata only.`);
} finally {
  if (identity) {
    const info = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(info.Id, identity);
    assert.equal(info.Config.Labels[label], run);
    docker(['rm', '-f', name]);
  }
}
