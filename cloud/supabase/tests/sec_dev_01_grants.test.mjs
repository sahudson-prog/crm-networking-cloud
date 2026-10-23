import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const remediationPath = new URL(
  "../operations/dev/202610220001_reconcile_sec_dev_01_grants.sql",
  import.meta.url,
);
const verifierPath = new URL(
  "../operations/dev/202610220001_verify_sec_dev_01_grants.sql",
  import.meta.url,
);
const recoveryPath = new URL(
  "../operations/dev/202610220000_capture_sec_dev_01_recovery.sql",
  import.meta.url,
);
const fixturePath = new URL(
  "../operations/dev/testing/202610220001_seed_sec_dev_01_drift.sql",
  import.meta.url,
);
const recoveryBuilderPath = new URL(
  "../operations/dev/New-SecDev01ExactRecovery.ps1",
  import.meta.url,
);
const canonicalAccessVerifierPath = new URL(
  "../verifiers/202609090002_verify_access.sql",
  import.meta.url,
);
const expandPreContractAccessVerifierPath = new URL(
  "../operations/dev/202610220002_verify_access_expand_pre_contract.sql",
  import.meta.url,
);
const validatorBodyDiagnosticPath = new URL(
  "../operations/dev/202610220005_diagnose_sec_dev_01_validator_bodies.sql",
  import.meta.url,
);
const validatorFunctionRepairPath = new URL(
  "../operations/dev/202610230001_repair_sec_dev_01_validator_functions.sql",
  import.meta.url,
);
const validatorFunctionRecoveryPath = new URL(
  "../operations/dev/202610230002_recover_sec_dev_01_validator_functions.sql",
  import.meta.url,
);
const validatorFunctionFixturePath = new URL(
  "../operations/dev/testing/202610230001_seed_sec_dev_01_validator_function_drift.sql",
  import.meta.url,
);

const remediation = readFileSync(remediationPath, "utf8");
const verifier = readFileSync(verifierPath, "utf8");
const recovery = readFileSync(recoveryPath, "utf8");
const fixture = readFileSync(fixturePath, "utf8");
const recoveryBuilder = readFileSync(recoveryBuilderPath, "utf8");
const canonicalAccessVerifier = readFileSync(canonicalAccessVerifierPath, "utf8");
const expandPreContractAccessVerifier = readFileSync(
  expandPreContractAccessVerifierPath,
  "utf8",
);
const validatorBodyDiagnostic = readFileSync(validatorBodyDiagnosticPath, "utf8");
const validatorFunctionRepair = readFileSync(validatorFunctionRepairPath, "utf8");
const validatorFunctionRecovery = readFileSync(
  validatorFunctionRecoveryPath,
  "utf8",
);
const validatorFunctionFixture = readFileSync(validatorFunctionFixturePath, "utf8");

const approvedTables = [
  "app_capabilities",
  "app_role_capabilities",
  "app_roles",
  "headhunter_companies",
  "headhunter_company_domains",
  "organization_memberships",
  "organizations",
  "profiles",
  "service_connectors",
  "subscription_plan_capabilities",
  "subscription_plans",
  "user_access_profiles",
  "user_capability_overrides",
  "user_plan_sponsorships",
  "user_role_assignments",
];

test("SEC-DEV-01 operation is transactionally isolated outside migrations", () => {
  assert.match(remediation, /^-- DEV-only SEC-DEV-01/m);
  assert.match(remediation, /\bbegin;[\s\S]*\bcommit;/i);
  assert.doesNotMatch(remediation, /on all tables|on all functions|on all sequences/i);
  assert.match(remediation, /expected exact 15-table manifest/i);
  assert.match(remediation, /SEC_DEV_01_TARGET_MISMATCH/);
  assert.doesNotMatch(remediation, /current_setting|set_config/i);
  for (const table of approvedTables) {
    assert.match(remediation, new RegExp(`\\('${table}'\\)`));
  }
});

test("SEC-DEV-01 restores the canonical authenticated matrix on the demonstrated drift", () => {
  assert.match(
    remediation,
    /revoke select, insert, update, delete, truncate, references, trigger, maintain on table public\.%I from anon, authenticated, service_role/i,
  );
  assert.match(remediation, /sec_dev_01_authenticated_expected/);
  assert.match(remediation, /SEC_DEV_01_AUTHENTICATED_MATRIX_MISMATCH/);
  assert.match(remediation, /SEC_DEV_01_UNSUPPORTED_TABLE_DRIFT/);
  assert.match(remediation, /grant select on table[\s\S]+to authenticated;/i);
  assert.match(remediation, /grant insert on table[\s\S]+to authenticated;/i);
  assert.match(remediation, /grant update on table[\s\S]+to authenticated;/i);
  assert.doesNotMatch(remediation, /grant delete on table[\s\S]+to authenticated;/i);
});

test("SEC-DEV-01 fixes only postgres default ACLs", () => {
  assert.match(remediation, /alter default privileges for role postgres\s+revoke execute on functions/i);
  assert.match(remediation, /alter default privileges for role postgres in schema public/i);
  assert.doesNotMatch(remediation, /alter default privileges for role supabase_admin/i);
});

test("SEC-DEV-01 preserves narrow service-role and auth-hook execution", () => {
  assert.match(remediation, /finalize_google_connected_account_verified\(uuid,text,text\[\]\)/);
  assert.match(remediation, /submit_contact_request_v1\(text,text,text,text,text,uuid\)/);
  assert.match(remediation, /hook_enforce_app_access_allowlist\(jsonb\)/);
  assert.match(remediation, /current_user_can_start_connected_oauth_v1\(text\)/);
  assert.match(remediation, /apply_google_contact_sync_change_v1\(uuid,jsonb\)/);
  assert.match(remediation, /SEC_DEV_01_UNCLASSIFIED_FUNCTIONS/);
  assert.match(remediation, /v_internal_functions constant regprocedure\[\]/);
});

test("SEC-DEV-01 verifier checks effective BYPASSRLS role behavior and defaults", () => {
  assert.match(verifier, /rolname = 'service_role' and rolbypassrls/);
  assert.match(verifier, /values \('anon'\), \('service_role'\), \('supabase_auth_admin'\)/);
  assert.match(verifier, /has_table_privilege\([\s\S]+grantee\.role_name/);
  assert.match(verifier, /has_function_privilege\('service_role'/);
  assert.match(verifier, /authenticated SELECT mismatch on public\.%/);
  assert.match(verifier, /authenticated INSERT mismatch on public\.%/);
  assert.match(verifier, /array\['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'\]/);
  assert.match(verifier, /authenticated % mismatch on public\.%/);
  assert.match(verifier, /PUBLIC retains a direct public table privilege/);
  assert.match(verifier, /postgres retains a forbidden default ACL/);
  assert.match(verifier, /begin transaction read only;[\s\S]*rollback;/i);
});

test("SEC-DEV-01 recovery capture is read-only and emits restoration statements", () => {
  assert.match(recovery, /begin transaction read only;/i);
  assert.match(recovery, /'snapshot_version', 3/);
  assert.match(recovery, /'integrity_algorithm', 'sha256-row-fingerprints-v2'/);
  assert.match(recovery, /recovery_sql/);
  assert.match(recovery, /alter default privileges for role %I/i);
  assert.match(recovery, /sec_dev_01_recovery_snapshot/);
  assert.match(recovery, /sequence_acl_exception_count/);
  assert.match(recovery, /entries_sha256/);
  assert.match(recovery, /objects_sha256/);
  assert.match(recovery, /entry_fingerprint/);
  assert.match(recovery, /object_fingerprint/);
  assert.match(recovery, /default_acl_state_count/);
  assert.match(recovery, /default_acl_states_sha256/);
  assert.match(recovery, /row_present/);
  assert.match(recovery, /acl_entries_sha256/);
  assert.match(recovery, /relation\.relkind = 'S'/);
  assert.match(recovery, /rollback;/i);
  assert.doesNotMatch(recovery, /\b(insert|update|delete|revoke)\b/i);
});

test("SEC-DEV-01 exact recovery builder validates integrity and stops on sequence drift", () => {
  assert.match(recoveryBuilder, /snapshot_version -ne 3/);
  assert.match(recoveryBuilder, /sha256-row-fingerprints-v2/);
  assert.match(recoveryBuilder, /SEC_DEV_01_SNAPSHOT_INTEGRITY/);
  assert.match(recoveryBuilder, /SEC_DEV_01_SEQUENCE_DRIFT_STOP/);
  assert.match(recoveryBuilder, /SEC_DEV_01_RECOVERY_OBJECT_INVENTORY_MISMATCH/);
  assert.match(recoveryBuilder, /entry\.surface -eq 'schema'.*entry\.grantor -eq 'pg_database_owner'/s);
  assert.match(recoveryBuilder, /revoke select, usage, update on sequence/);
  assert.match(recoveryBuilder, /grant execute on functions to PUBLIC/);
  assert.match(recoveryBuilder, /SEC_DEV_01_RECOVERY_ACL_MISMATCH/);
  assert.match(recoveryBuilder, /SEC_DEV_01_RECOVERY_DEFAULT_ACL_STATE_MISMATCH/);
  assert.match(recoveryBuilder, /SEC_DEV_01_RECOVERY_DEFAULT_ACL_ENTRY_MISMATCH/);
  assert.ok(
    recoveryBuilder.indexOf("SEC_DEV_01_RECOVERY_ACL_MISMATCH") <
      recoveryBuilder.indexOf("$lines.Add('commit;')"),
  );
  assert.match(recoveryBuilder, /WriteAllLines/);
  assert.doesNotMatch(
    recoveryBuilder,
    /\b(?:Invoke-Sqlcmd|docker|psql)\b|supabase\s+(?:db|migration|start)/i,
  );
});

test("SEC-DEV-01 expand/pre-contract verifier changes only the justified EXECUTE allowlists", () => {
  const expandFunctions = [
    "current_user_can_start_connected_oauth_v1(text)",
    "current_user_can_sync_connected_account_v1(uuid,text)",
    "apply_google_contact_sync_change_v1(uuid,jsonb)",
    "apply_google_interaction_sync_v1(uuid,jsonb)",
  ];

  assert.match(
    expandPreContractAccessVerifier,
    /begin transaction read only;[\s\S]*rollback;/i,
  );
  for (const signature of expandFunctions) {
    assert.match(
      expandPreContractAccessVerifier,
      new RegExp(`'public\\.${signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'::regprocedure`),
    );
  }
  assert.match(
    expandPreContractAccessVerifier,
    /internal_functions[\s\S]*'public\.user_has_provider_rollout_for_user_v1\(uuid,text\)'::regprocedure[\s\S]*authenticated_functions/,
  );

  const allowedAdditions = new Set([
    ...expandFunctions,
    "user_has_provider_rollout_for_user_v1(uuid,text)",
  ]);
  const normalize = (sql) =>
    sql
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((line) => !line.startsWith("-- DEV-only, read-only variant"))
      .filter((line) => !line.startsWith("-- SEC-GOOGLE-01 expand/pre-contract"))
      .filter((line) => line.trim() !== "begin transaction read only;")
      .filter((line) => line.trim() !== "rollback;")
      .filter(
        (line) =>
          ![...allowedAdditions].some((signature) =>
            line.includes(`public.${signature}`),
          ),
      )
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  assert.equal(
    normalize(expandPreContractAccessVerifier),
    normalize(canonicalAccessVerifier),
  );
});

test("SEC-DEV-01 local fixture reproduces the demonstrated three-role table drift", () => {
  assert.match(fixture, /LOCAL DISPOSABLE DATABASE ONLY/);
  assert.match(fixture, /SEC_DEV_01_FIXTURE_LOCAL_OPT_IN_REQUIRED/);
  assert.match(
    fixture,
    /grant select, insert, update, delete, truncate, references, trigger, maintain on table public\.%I to anon, authenticated, service_role/i,
  );
  for (const table of approvedTables) {
    assert.match(fixture, new RegExp(`'${table}'`));
  }
  assert.match(fixture, /\bbegin;[\s\S]*\bcommit;/i);
});

test("SEC-DEV-01 validator diagnosis preserves exact bodies and normalizes only line endings", () => {
  assert.match(
    validatorBodyDiagnostic,
    /begin transaction read only;[\s\S]*rollback;/i,
  );
  assert.match(
    validatorBodyDiagnostic,
    /replace\(\s*replace\(actual\.actual_body, chr\(13\) \|\| chr\(10\), chr\(10\)\),\s*chr\(13\),\s*chr\(10\)\s*\)/s,
  );
  assert.match(validatorBodyDiagnostic, /actual_body_sha256_raw/);
  assert.match(validatorBodyDiagnostic, /actual_body_sha256_normalized/);
  assert.match(validatorBodyDiagnostic, /actual_crlf_count/);
  assert.match(validatorBodyDiagnostic, /actual_standalone_cr_count/);
  assert.match(validatorBodyDiagnostic, /actual_standalone_lf_count/);
  assert.match(validatorBodyDiagnostic, /actual_literal_backslash_n_count/);
  assert.match(validatorBodyDiagnostic, /pg_catalog\.pg_get_functiondef/);
  assert.match(validatorBodyDiagnostic, /aclexplode/);
  assert.match(validatorBodyDiagnostic, /'proacl_is_null'/);
  assert.match(validatorBodyDiagnostic, /'proacl_raw'/);
  assert.match(validatorBodyDiagnostic, /'grantor'/);
  assert.match(validatorBodyDiagnostic, /'grantable'/);
  assert.match(
    validatorBodyDiagnostic,
    /dependency\.refclassid = 'pg_catalog\.pg_class'::regclass/,
  );
  assert.match(validatorBodyDiagnostic, /structure_matches_when_expected_present/);
  assert.match(validatorBodyDiagnostic, /valid_ready_live_when_expected_present/);
  assert.match(validatorBodyDiagnostic, /full_index_contract_matches/);
  assert.doesNotMatch(
    validatorBodyDiagnostic,
    /regexp_replace\([^\n]+E'\\\\r\\\\n\?'[\s\S]{0,120}E'\\\\n'/,
  );
  assert.doesNotMatch(
    validatorBodyDiagnostic,
    /\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\s+(?:table|function|schema|role|on)\b/i,
  );
});

test("SEC-DEV-01 validator repair is DEV-only, transactional, and fail-closed", () => {
  assert.match(validatorFunctionRepair, /^-- DEV-only SEC-DEV-01 repair/m);
  assert.match(validatorFunctionRepair, /\bbegin;[\s\S]*\bcommit;/i);
  assert.match(validatorFunctionRepair, /current_user <> 'postgres'/);
  assert.match(validatorFunctionRepair, /SEC_DEV_01_PRECONDITION/);
  assert.match(validatorFunctionRepair, /SEC_DEV_01_POSTCONDITION/);
  assert.match(validatorFunctionRepair, /set local lock_timeout = '5s'/i);
  assert.match(validatorFunctionRepair, /set local statement_timeout = '60s'/i);
  assert.match(
    validatorFunctionRepair,
    /replace\(\s*replace\([^,]+, chr\(13\) \|\| chr\(10\), chr\(10\)\),\s*chr\(13\),\s*chr\(10\)\s*\)/s,
  );
  assert.doesNotMatch(
    validatorFunctionRepair,
    /regexp_replace\([^\n]+E'\\\\r\\\\n\?'[\s\S]{0,120}E'\\\\n'/,
  );
});

test("SEC-DEV-01 validator repair checks the closed table and index manifests before changes", () => {
  const firstChange = validatorFunctionRepair.indexOf(
    "create temporary table sec_dev_01_validator_function_snapshot",
  );
  const preconditions = validatorFunctionRepair.slice(0, firstChange);

  assert.ok(firstChange > 0);
  for (const table of [
    "external_contact_snapshots",
    "contact_emails",
    "contact_phones",
    "headhunter_companies",
    "headhunter_company_domains",
  ]) {
    assert.match(preconditions, new RegExp(`'${table}'`));
  }
  for (const index of [
    "uq_external_contact_snapshots_provider_external",
    "uq_contact_emails_contact_normalized",
    "uq_contact_phones_contact_normalized",
    "uq_contact_emails_user_normalized",
    "uq_contact_phones_user_normalized",
    "uq_headhunter_companies_name_active",
    "uq_headhunter_company_domains_domain_active",
    "uq_headhunter_companies_user_name_active",
    "uq_headhunter_company_domains_user_domain_active",
  ]) {
    assert.match(preconditions, new RegExp(`'${index}'`));
  }
  assert.match(preconditions, /indisvalid/);
  assert.match(preconditions, /indisready/);
  assert.match(preconditions, /indislive/);
  assert.match(preconditions, /expected_user_id/);
  assert.doesNotMatch(preconditions, /alter function|create or replace function/i);
});

test("SEC-DEV-01 validator repair changes only the two confirmed drifts and preserves ACLs", () => {
  assert.match(
    validatorFunctionRepair,
    /alter function public\.validate_contact_sync_storage_v0_1\(\)\s+set search_path = '';/i,
  );
  assert.match(
    validatorFunctionRepair,
    /create or replace function public\.validate_headhunter_company_master_v0_1\(\)[\s\S]*set search_path = ''/i,
  );
  assert.match(validatorFunctionRepair, /uq_headhunter_companies_name_active/);
  assert.match(
    validatorFunctionRepair,
    /uq_headhunter_company_domains_domain_active/,
  );
  assert.match(
    validatorFunctionRepair,
    /v_function\.proacl is distinct from v_snapshot\.proacl/,
  );
  assert.match(validatorFunctionRepair, /v_function\.oid is distinct from v_snapshot\.oid/);
  assert.doesNotMatch(validatorFunctionRepair, /\b(?:grant|revoke)\b/i);
  assert.doesNotMatch(validatorFunctionRepair, /alter default privileges/i);
});

test("SEC-DEV-01 specific recovery requires repaired state and restores only the diagnosed prior definitions", () => {
  assert.match(validatorFunctionRecovery, /^-- DEV-only SEC-DEV-01 recovery/m);
  assert.match(validatorFunctionRecovery, /\bbegin;[\s\S]*\bcommit;/i);
  assert.match(validatorFunctionRecovery, /SEC_DEV_01_RECOVERY_PRECONDITION/);
  assert.match(validatorFunctionRecovery, /SEC_DEV_01_RECOVERY_POSTCONDITION/);
  assert.match(
    validatorFunctionRecovery,
    /alter function public\.validate_contact_sync_storage_v0_1\(\)\s+set search_path = public, pg_temp;/i,
  );
  assert.match(
    validatorFunctionRecovery,
    /create or replace function public\.validate_headhunter_company_master_v0_1\(\)[\s\S]*set search_path = public, pg_temp/i,
  );
  assert.match(validatorFunctionRecovery, /uq_headhunter_companies_user_name_active/);
  assert.match(
    validatorFunctionRecovery,
    /uq_headhunter_company_domains_user_domain_active/,
  );
  assert.match(
    validatorFunctionRecovery,
    /v_function\.proacl is distinct from v_snapshot\.proacl/,
  );
  assert.doesNotMatch(validatorFunctionRecovery, /\b(?:grant|revoke)\b/i);
  assert.doesNotMatch(validatorFunctionRecovery, /alter default privileges/i);
});

test("SEC-DEV-01 validator fixture reproduces only the two diagnosed function drifts", () => {
  assert.match(validatorFunctionFixture, /LOCAL DISPOSABLE DATABASE ONLY/);
  assert.match(
    validatorFunctionFixture,
    /validate_contact_sync_storage_v0_1\(\)[\s\S]*set search_path = public, pg_temp/i,
  );
  assert.match(
    validatorFunctionFixture,
    /validate_headhunter_company_master_v0_1\(\)[\s\S]*set search_path = public, pg_temp/i,
  );
  assert.match(
    validatorFunctionFixture,
    /uq_headhunter_companies_user_name_active/,
  );
  assert.match(
    validatorFunctionFixture,
    /uq_headhunter_company_domains_user_domain_active/,
  );
  assert.match(validatorFunctionFixture, /uq_headhunter_companies_name_active/);
  assert.match(
    validatorFunctionFixture,
    /uq_headhunter_company_domains_domain_active/,
  );
  assert.match(
    validatorFunctionFixture,
    /grant execute on function public\.validate_contact_sync_storage_v0_1\(\)\s+to authenticated/i,
  );
});

test("SEC-DEV-01 validator fixture fails closed before destructive DDL", () => {
  const destructiveDdl = validatorFunctionFixture.indexOf(
    "drop schema if exists public cascade",
  );

  assert.ok(destructiveDdl > 0);
  assert.ok(
    validatorFunctionFixture.indexOf("SEC_DEV_01_VALIDATOR_FIXTURE_WRONG_ROLE") <
      destructiveDdl,
  );
  assert.ok(
    validatorFunctionFixture.indexOf("SEC_DEV_01_VALIDATOR_FIXTURE_WRONG_DATABASE") <
      destructiveDdl,
  );
  assert.ok(
    validatorFunctionFixture.indexOf(
      "SEC_DEV_01_VALIDATOR_FIXTURE_LOCAL_OPT_IN_REQUIRED",
    ) < destructiveDdl,
  );
  assert.match(
    validatorFunctionFixture,
    /current_database\(\) is distinct from 'coffeecito_sec_dev_01_validator_fixture'/,
  );
  assert.match(
    validatorFunctionFixture,
    /current_setting\('coffeecito\.sec_dev_01_local_fixture', true\) is distinct from 'on'/,
  );
  assert.match(validatorFunctionFixture, /\bbegin;[\s\S]*\bcommit;/i);
});
