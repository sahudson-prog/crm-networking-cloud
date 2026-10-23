import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Archives only: no clone, refs, index, secrets or local contract overlays.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 16e6 }).trim();
const head = '88b6ad332a5acbc901fbad5d672595aafc27da58';
const main = 'cd6eb1014b64ed4f2fb21e23733dbd93ac57c3f7';
const base = 'e45cd4301c49f83e573a833fd7661903778616e4';
const candidates = [
  'cloud/supabase/verifiers/202610210001_verify_access_expand_pre_contract.sql',
  'cloud/supabase/tests/verify_access_security_definer.test.mjs',
  'cloud/supabase/tests/local/certify_google_expand_package.mjs',
  'cloud/supabase/tests/local/google_revocation_concurrency.mjs',
  'docs/ACTIVE_PLAN.md',
];
const excluded = [
  'cloud/supabase/migrations/202610210002_google_sync_capability_enforcement_contract_v1.sql',
  'cloud/supabase/verifiers/202610210002_verify_google_sync_capability_enforcement_contract_v1.sql',
  'cloud/supabase/tests/google_sync_capability_enforcement_contract.test.mjs',
  'cloud/supabase/verifiers/202609090002_verify_access.sql',
  'cloud/supabase/verifiers/202609290002_verify_merge_reset_grants.sql',
  'cloud/web/next-env.d.ts',
  'cloud/web/AGENTS.md',
];
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
assert.equal(git('branch', '--show-current'), 'codex/sec-google-01');
assert.equal(git('rev-parse', 'HEAD'), head);
assert.equal(git('rev-parse', 'origin/main'), main);
assert.equal(git('merge-base', head, main), base);
const protectedHashes = new Map(excluded.map((file) => [file, hash(join(repo, file))]));
const root = mkdtempSync(join(tmpdir(), 'coffeecito-expand-package-'));
console.log(JSON.stringify({ head, main, base, candidates, excluded, temporaryRoot: root }));
try {
  const branchFiles = git('diff', '--name-only', base, head).split('\n');
  const mainFiles = git('diff', '--name-only', base, main).split('\n');
  assert.deepEqual(branchFiles.filter((file) => mainFiles.includes(file)), [], 'Overlapping branches require explicit reconciliation');
  const packages = [];
  for (const [name, revision] of [['candidate', head], ['integrated', main]]) {
    const target = join(root, name);
    mkdirSync(target);
    const archive = join(root, `${name}.tar`);
    git('archive', '--format=tar', `--output=${archive}`, revision);
    execFileSync('tar', ['-xf', archive, '-C', target]);
    if (name === 'integrated') {
      // Disjoint path changes: overlay exact committed blobs, without Git's
      // checkout/autocrlf conversion or a merge/index in either repository.
      for (const file of branchFiles) {
        mkdirSync(dirname(join(target, file)), { recursive: true });
        writeFileSync(join(target, file), execFileSync('git', ['show', `${head}:${file}`], { cwd: repo, maxBuffer: 16e6 }));
      }
    }
    for (const file of candidates) {
      mkdirSync(dirname(join(target, file)), { recursive: true });
      copyFileSync(join(repo, file), join(target, file));
    }
    // Tracked baseline versions remain; none of the seven local overlays is copied.
    for (const file of excluded) {
      let published;
      try { published = execFileSync('git', ['show', `${head}:${file}`], { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }); }
      catch { assert.equal(existsSync(join(target, file)), false, file); continue; }
      assert.deepEqual(readFileSync(join(target, file)), published, file);
    }
    const tracked = git('ls-tree', '-r', '--name-only', revision).split('\n');
    assert.equal(tracked.some((file) => /(^|\/)\.env(?:\.|$)/.test(file) && !/example|sample/.test(file)), false);
    assert.equal(existsSync(join(target, '.git')), false);
    execFileSync(process.execPath, ['--test', '--test-reporter=spec',
      'cloud/supabase/tests/verify_access_security_definer.test.mjs',
      'cloud/supabase/tests/google_sync_capability_enforcement.test.mjs',
    ], { cwd: target, stdio: 'inherit' });
    console.log(`${name}: isolated static tests PASS`);
    packages.push(target);
  }
  const sqlFiles = git('ls-tree', '-r', '--name-only', head, 'cloud/supabase/migrations', 'cloud/supabase/seeds').split('\n');
  for (const file of sqlFiles) assert.equal(hash(join(packages[0], file)), hash(join(packages[1], file)), file);
  console.log('candidate/integrated migrations and seeds: byte-identical');
  if (process.argv.includes('--postgres')) {
    execFileSync(process.execPath, ['cloud/supabase/tests/local/google_revocation_concurrency.mjs'], {
      cwd: packages[0], stdio: 'inherit', timeout: 240000,
    });
  }
  console.log('Package certification PASS (concurrency observation is not a rollout approval)');
} finally {
  for (const [file, before] of protectedHashes) assert.equal(hash(join(repo, file)), before, file);
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(root.includes('coffeecito-expand-package-'));
  rmSync(root, { recursive: true });
  console.log('Temporary package copies removed; seven excluded files unchanged');
}
