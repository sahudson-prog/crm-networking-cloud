import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/202610080001_apply_ics_import_v1.sql", import.meta.url),
  "utf8"
);
const repairMigration = readFileSync(
  new URL("../../supabase/migrations/202610090001_repair_apply_ics_import_v1_record_guards.sql", import.meta.url),
  "utf8"
);
const allDayGuardMigration = readFileSync(
  new URL("../../supabase/migrations/202610100001_reject_all_day_ics_import_v1.sql", import.meta.url),
  "utf8"
);
const focusMigration = readFileSync(
  new URL("../../supabase/migrations/202610120001_require_ics_focus_contacts_v1.sql", import.meta.url),
  "utf8"
);
const networkingStartMigration = readFileSync(
  new URL("../../supabase/migrations/202610140001_enforce_ics_networking_start_v1.sql", import.meta.url),
  "utf8"
);
const focusVerifier = readFileSync(
  new URL("../../supabase/verifiers/202610120001_verify_ics_focus_contract.sql", import.meta.url),
  "utf8"
);
const focusBehaviorVerifier = readFileSync(
  new URL("../../supabase/verifiers/202610120001_verify_ics_focus_behavior.sql", import.meta.url),
  "utf8"
);
const networkingStartVerifier = readFileSync(
  new URL("../../supabase/verifiers/202610140001_verify_ics_networking_start_contract.sql", import.meta.url),
  "utf8"
);
const networkingStartBehaviorVerifier = readFileSync(
  new URL("../../supabase/verifiers/202610140001_verify_ics_networking_start_behavior.sql", import.meta.url),
  "utf8"
);
const verifier = readFileSync(
  new URL("../../supabase/verifiers/202610080001_verify_apply_ics_import_v1.sql", import.meta.url),
  "utf8"
);
const behaviorVerifier = readFileSync(
  new URL("../../supabase/verifiers/202610080001_verify_apply_ics_import_v1_behavior.sql", import.meta.url),
  "utf8"
);
const coreSchema = readFileSync(
  new URL("../../supabase/migrations/202609090001_core_schema.sql", import.meta.url), "utf8"
);
const accessSchema = readFileSync(
  new URL("../../supabase/migrations/202609090002_access_schema.sql", import.meta.url), "utf8"
);
const accessVerifier = readFileSync(
  new URL("../../supabase/verifiers/202609090002_verify_access.sql", import.meta.url), "utf8"
);

test("la migration expone una única RPC autenticada con límites y locks transaccionales", () => {
  assert.match(migration, /create or replace function public\.apply_ics_import_v1\(p_items jsonb\)/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /current_user_has_app_access\(\)/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /jsonb_array_length\(p_items\) > 500/i);
  assert.match(migration, /v_total_participants > 5000/i);
  assert.match(migration, /5 \* 1024 \* 1024/i);
  assert.match(migration, /grant execute on function public\.apply_ics_import_v1\(jsonb\)\s+to authenticated/i);
  assert.match(migration, /revoke all on function public\.apply_ics_import_v1\(jsonb\)\s+from public, anon, authenticated, service_role, supabase_auth_admin/i);
});
test("identidad y provenance se derivan en SQL sin aceptar campos del cliente", () => {
  assert.match(migration, /extensions\.digest\(pg_catalog\.convert_to\(v_uid, 'UTF8'\), 'sha256'\)/i);
  assert.match(migration, /'ics_uid_sha256_'/i);
  assert.match(migration, /key_name not in \('changeId', 'category', 'expected', 'event'\)/i);
  assert.match(migration, /'icalendar', 'ics_import',\s+'calendar_event'/i);
  assert.doesNotMatch(migration, /v_item->>'user_id'/i);
  assert.doesNotMatch(migration, /v_item->>'external_id'/i);
  assert.doesNotMatch(migration, /v_item->>'contact_id'/i);
});

test("creación deja notas vacías, actualización no las reemplaza y auditoría evita PII", () => {
  assert.match(migration, /'calendar', 'unknown', v_occurred_at, v_subject, v_description,\s*'', v_interaction_metadata/i);
  const interactionUpdate = migration.match(/update public\.interactions[\s\S]*?where id = v_interaction\.id/i)?.[0] ?? "";
  assert.ok(interactionUpdate);
  assert.doesNotMatch(interactionUpdate, /user_notes_raw\s*=/i);
  const auditSection = migration.slice(migration.indexOf("insert into public.action_invocations"));
  assert.doesNotMatch(auditSection, /v_uid|v_email|v_description|user_notes_raw/i);
});

test("la reparación forward-only usa guards compatibles con el contrato operacional", () => {
  assert.match(repairMigration, /create or replace function public\.apply_ics_import_v1\(p_items jsonb\)/i);
  assert.match(repairMigration, /security definer/i);
  assert.match(repairMigration, /set search_path = ''/i);
  assert.match(repairMigration, /pg_catalog\.to_jsonb\(v_interaction\)->>'is_deleted'/i);
  assert.match(repairMigration, /pg_catalog\.to_jsonb\(v_interaction\)->>'prevent_reimport'/i);
  assert.match(repairMigration, /v_interaction\.metadata->'deleted'/i);
  assert.match(repairMigration, /v_interaction\.metadata->'dismissed'/i);
  assert.match(repairMigration, /v_interaction\.metadata->'prevent_reimport'/i);
  assert.match(repairMigration, /v_source\.prevent_reimport/i);
  assert.doesNotMatch(repairMigration, /v_interaction\.(?:is_deleted|prevent_reimport)\b/i);
  assert.match(repairMigration, /alter function public\.apply_ics_import_v1\(jsonb\) owner to postgres/i);
  assert.match(repairMigration, /revoke all on function public\.apply_ics_import_v1\(jsonb\)[\s\S]*?from public, anon, authenticated, service_role, supabase_auth_admin/i);
  assert.match(repairMigration, /grant execute on function public\.apply_ics_import_v1\(jsonb\)\s+to authenticated/i);
});

test("la migration forward-only excluye all-day y conserva seguridad de la RPC", () => {
  assert.match(allDayGuardMigration, /create or replace function public\.apply_ics_import_v1\(p_items jsonb\)/i);
  assert.match(allDayGuardMigration, /if v_start_kind = 'date' then\s+raise exception 'ICS_IMPORT_INVALID_PAYLOAD: all-day event is not supported'/i);
  assert.match(allDayGuardMigration, /security definer/i);
  assert.match(allDayGuardMigration, /set search_path = ''/i);
  assert.match(allDayGuardMigration, /alter function public\.apply_ics_import_v1\(jsonb\) owner to postgres/i);
  assert.match(allDayGuardMigration, /revoke all on function public\.apply_ics_import_v1\(jsonb\)[\s\S]*?grant execute[\s\S]*?to authenticated/i);
  assert.doesNotMatch(allDayGuardMigration, /\b(?:alter|create|drop)\s+(?:table|index|policy)\b/i);
});

test("A3.4 revalida Focus inequívoco y expone reparación autenticada sin cambiar tablas", () => {
  assert.match(focusMigration, /create or replace function public\.apply_ics_import_v1\(p_items jsonb\)/i);
  assert.match(focusMigration, /'focusContactIds'/i);
  assert.match(focusMigration, /having pg_catalog\.count\(distinct contact\.id\) = 1/i);
  assert.match(focusMigration, /pg_catalog\.bool_and\(contact\.networking_focus\)/i);
  assert.match(focusMigration, /raise exception 'ICS_IMPORT_STALE_FOCUS'/i);
  assert.match(focusMigration, /set contact_id = v_contact_id/i);
  assert.match(focusMigration, /create or replace function public\.reconcile_ics_focus_participants_v1\(p_apply boolean default false\)/i);
  assert.match(focusMigration, /source\.provider = 'icalendar'/i);
  assert.match(focusMigration, /source\.source_service = 'ics_import'/i);
  assert.match(focusMigration, /participant\.contact_id is null/i);
  assert.match(focusMigration, /grant execute on function public\.reconcile_ics_focus_participants_v1\(boolean\)\s+to authenticated/i);
  assert.doesNotMatch(focusMigration, /\b(?:alter|create|drop)\s+(?:table|index|policy)\b/i);
  assert.match(focusVerifier, /ICS Focus function grants are incorrect/i);
  assert.match(focusVerifier, /lower\(pg_catalog\.pg_get_functiondef\([\s\S]*?'ics_import_stale_focus'/i);
  assert.doesNotMatch(focusVerifier, /lower\(pg_catalog\.pg_get_functiondef\([\s\S]*?'ICS_IMPORT_STALE_FOCUS'/);
  assert.match(focusBehaviorVerifier, /Expected ambiguous Focus conflict/i);
  assert.match(focusBehaviorVerifier, /Focus recovery preview mutated data/i);
  assert.match(focusBehaviorVerifier, /^rollback;\s*$/im);
  assert.match(accessVerifier, /public\.reconcile_ics_focus_participants_v1\(boolean\)/i);
});

test("A3.5 exige una fecha civil vigente y rechaza eventos anteriores sin cambiar schema", () => {
  assert.match(networkingStartMigration, /create or replace function public\.apply_ics_import_v1\(p_items jsonb\)/i);
  assert.match(networkingStartMigration, /setting\.setting_key = 'Fecha_Inicio_Networking'/i);
  assert.match(networkingStartMigration, /v_utc_today date := \(v_now at time zone 'UTC'\)::date/i);
  assert.match(networkingStartMigration, /v_networking_start_date < \(v_utc_today - interval '12 months'\)::date/i);
  assert.match(networkingStartMigration, /pg_catalog\.make_date\([\s\S]*?pg_catalog\.split_part\(v_networking_start_value, '\/', 3\)/i);
  assert.match(networkingStartMigration, /v_event_start_date := \(v_occurred_at at time zone 'UTC'\)::date/i);
  assert.doesNotMatch(networkingStartMigration, /v_event_start_date := pg_catalog\.left\(v_start_local, 10\)::date/i);
  assert.match(networkingStartMigration, /v_event_start_date < v_minimum_start_date/i);
  assert.match(networkingStartMigration, /raise exception 'ICS_IMPORT_NETWORKING_START_REQUIRED'/i);
  assert.match(networkingStartMigration, /raise exception 'ICS_IMPORT_BEFORE_NETWORKING_START'/i);
  assert.match(networkingStartMigration, /security definer/i);
  assert.match(networkingStartMigration, /set search_path = ''/i);
  assert.match(networkingStartMigration, /revoke all on function public\.apply_ics_import_v1\(jsonb\)[\s\S]*?grant execute[\s\S]*?to authenticated/i);
  assert.doesNotMatch(networkingStartMigration, /\b(?:alter|create|drop)\s+(?:table|index|policy)\b/i);
  assert.doesNotMatch(networkingStartMigration, /create or replace function public\.reconcile_ics_focus_participants_v1/i);

  assert.match(networkingStartVerifier, /apply_ics_import_v1 networking-start contract changed/i);
  assert.match(networkingStartVerifier, /has_function_privilege\('authenticated'/i);
  assert.match(networkingStartBehaviorVerifier, /Expected missing networking start rejection/i);
  assert.match(networkingStartBehaviorVerifier, /Expected future networking start rejection/i);
  assert.match(networkingStartBehaviorVerifier, /Expected old networking start rejection/i);
  assert.match(networkingStartBehaviorVerifier, /Inclusive networking start did not import/i);
  assert.match(networkingStartBehaviorVerifier, /Expected event-before-networking-start rejection/i);
  assert.match(networkingStartBehaviorVerifier, /UTC civil boundary rejected a valid offset instant/i);
  assert.match(networkingStartBehaviorVerifier, /Expected UTC instant before networking-start rejection/i);
  assert.match(networkingStartBehaviorVerifier, /Calendar-month networking boundary changed/i);
  assert.match(networkingStartBehaviorVerifier, /Rejected networking-start fixture persisted data/i);
  assert.match(networkingStartBehaviorVerifier, /^rollback;\s*$/im);
  assert.doesNotMatch(networkingStartBehaviorVerifier, /exception when others/i);
});

test("los records de Apply solo referencian campos disponibles en el contrato compatible", () => {
  const interactionFields = [...repairMigration.matchAll(/\bv_interaction\.([a-z_]+)/gi)]
    .map((match) => match[1].toLowerCase());
  const sourceFields = [...repairMigration.matchAll(/\bv_source\.([a-z_]+)/gi)]
    .map((match) => match[1].toLowerCase());

  assert.deepEqual([...new Set(interactionFields)].sort(), [
    "id", "interaction_type", "metadata", "occurred_at", "provider", "provider_event_id",
    "source_detail", "subject", "updated_at"
  ]);
  assert.deepEqual([...new Set(sourceFields)].sort(), [
    "content_hash", "external_object_type", "id", "interaction_id", "metadata", "prevent_reimport", "updated_at"
  ]);
});

test("Preview y Apply comparten contenido material sin ruido técnico", () => {
  const contentSection = migration.match(/v_content_json :=[\s\S]*?v_content_hash :=/)?.[0] ?? "";
  assert.match(contentSection, /v_material_start/i);
  assert.match(contentSection, /v_material_end/i);
  assert.match(contentSection, /v_material_organizer/i);
  assert.match(contentSection, /v_material_attendees/i);
  assert.match(contentSection, /v_material_status/i);
  assert.doesNotMatch(contentSection, /'method'/i);
  assert.match(migration, /v_end_kind := null;[\s\S]*?v_end_kind := v_end->>'valueType';[\s\S]*?v_end_instant := \(v_end->>'instant'\)::timestamptz;/i);
  assert.match(migration, /jsonb_agg\([\s\S]*?order by canonical\.participant->>'email'/i);
  assert.doesNotMatch(migration, /v_interaction\.metadata->'ics_import' is not distinct from v_ics_metadata/i);
  assert.doesNotMatch(migration, /delete from public\.interaction_participants/i);
});

test("el verifier comprueba ACL, owner, search_path e índice parcial compatible", () => {
  assert.match(verifier, /uq_external_interaction_sources|external_interaction_sources/i);
  assert.match(verifier, /indisunique/i);
  assert.match(verifier, /indisvalid/i);
  assert.match(verifier, /indisready/i);
  assert.match(verifier, /indpred is not null/i);
  assert.match(verifier, /in \('is_active', 'is_active=true', 'is_activeistrue'\)/i);
  assert.doesNotMatch(verifier, /strpos\([\s\S]*?pg_get_expr[\s\S]*?'is_active'/i);
  assert.match(verifier, /pg_get_userbyid\(procedure\.proowner\) <> 'postgres'/i);
  assert.match(verifier, /has_function_privilege\('authenticated'/i);
  assert.match(verifier, /PUBLIC can execute apply_ics_import_v1/i);
  assert.match(verifier, /pg_catalog\.to_jsonb\(v_interaction\)->>'is_deleted'/i);
  assert.match(verifier, /pg_catalog\.to_jsonb\(v_interaction\)->>'prevent_reimport'/i);
  assert.match(verifier, /v_interaction\.metadata->'deleted'/i);
  assert.match(verifier, /v_interaction\.metadata->'dismissed'/i);
  assert.match(verifier, /v_interaction\.metadata->'prevent_reimport'/i);
  assert.match(verifier, /v_interaction\.is_deleted[\s\S]*?> 0/i);
  assert.match(verifier, /all-day event is not supported/i);
  assert.match(
    accessVerifier,
    /authenticated_functions regprocedure\[\][\s\S]*?'public\.apply_ics_import_v1\(jsonb\)'::regprocedure/i
  );
});

test("el verifier funcional prepara casos de auth, ownership, idempotencia y rollback", () => {
  assert.match(behaviorVerifier, /ICS_IMPORT_NOT_AUTHENTICATED/i);
  assert.match(behaviorVerifier, /ICS_IMPORT_ACCESS_DENIED/i);
  assert.match(behaviorVerifier, /isolate identical UIDs by owner/i);
  assert.match(behaviorVerifier, /Exact reimport was not idempotent/i);
  assert.match(behaviorVerifier, /preserve user notes/i);
  assert.match(behaviorVerifier, /UID casing was not preserved/i);
  assert.match(behaviorVerifier, /Potential duplicate Apply modified a Google interaction/i);
  assert.match(behaviorVerifier, /Apply modified a protected manual interaction/i);
  assert.match(behaviorVerifier, /Expected all-day rejection/i);
  assert.match(behaviorVerifier, /Rejected all-day fixture persisted data/i);
  assert.match(behaviorVerifier, /ICS_IMPORT_BLOCKED_IDENTITY/i);
  assert.match(behaviorVerifier, /Expected dismissed interaction failure/i);
  assert.match(behaviorVerifier, /Expected interaction prevent-reimport failure/i);
  assert.match(behaviorVerifier, /Expected source prevent-reimport failure/i);
  assert.match(behaviorVerifier, /Expected duplicate UID batch failure/i);
  assert.match(
    behaviorVerifier,
    /Expected forged ownership failure[\s\S]*?sqlerrm <> 'ICS_IMPORT_INVALID_PAYLOAD: invalid item shape'/i
  );
  assert.match(
    repairMigration,
    /raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid item shape'/i
  );
  assert.match(behaviorVerifier, /Late Apply failure did not roll back atomically/i);
  assert.match(behaviorVerifier, /ICS_IMPORT_LIMIT_EXCEEDED/i);
  assert.match(behaviorVerifier, /source\.external_id = v_external_id/i);
  assert.doesNotMatch(behaviorVerifier, /source\.external_id = external_id\b/i);
  assert.doesNotMatch(behaviorVerifier, /^\s{2}(?:external_id|interaction_id|source_id|result|expected|item)\s+[a-z]/im);
  assert.match(behaviorVerifier, /^rollback;\s*$/im);
});

test("el verifier funcional deduplica contactos Foco resueltos por múltiples emails", () => {
  assert.match(behaviorVerifier, /jsonb_agg\(resolved\.contact_id order by resolved\.contact_id\)/i);
  assert.match(behaviorVerifier, /select distinct matched_email\.contact_id/i);
});

test("el verifier no califica expresiones especiales como funciones SQL", () => {
  const qualifiedSpecial = /(?:\b[a-z_][\w$]*|"[^"]+")\s*\.\s*"?(?:coalesce|nullif|greatest|least)"?\s*\(/i;
  assert.doesNotMatch(behaviorVerifier, qualifiedSpecial);
  assert.match(behaviorVerifier, /\bCOALESCE\(interaction\.metadata, '\{\}'::jsonb\)/);
  for (const keyword of ["COALESCE", "NULLIF", "GREATEST", "LEAST"]) {
    assert.match(`pg_catalog.${keyword}(a, b)`, qualifiedSpecial);
    assert.match(`"pg_catalog"."${keyword}"(a, b)`, qualifiedSpecial);
  }
});

test("variables y columnas del verifier respetan el schema y la variante legacy", () => {
  const sqlWithoutLiterals = behaviorVerifier.replace(/--[^\r\n]*|'(?:''|[^'])*'/g, " ");
  const declarations = behaviorVerifier.match(/do \$verify\$\s+declare([\s\S]*?)\nbegin/i)?.[1];
  assert.ok(declarations);
  const names = [...declarations.matchAll(/^\s+(\w+)\s+/gm)].map((match) => match[1]);
  assert.ok(names.length > 0);
  assert.ok(names.every((name) => name.startsWith("v_")));
  for (const [name] of behaviorVerifier.matchAll(/\bv_\w+\b/g)) {
    assert.ok(names.includes(name), `Variable no declarada: ${name}`);
  }

  function columnsFor(table: string) {
    const block = `${coreSchema}\n${accessSchema}`.match(new RegExp(
      `create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`, "i"
    ))?.[1];
    assert.ok(block, `Tabla no encontrada: ${table}`);
    const columns = new Set([...block.matchAll(/^  (\w+)\s+(?:uuid|text|jsonb|boolean|timestamptz)\b/gm)]
      .map((match) => match[1]));
    if (table === "interactions") {
      for (const optional of ["is_deleted", "prevent_reimport", "deleted_at", "deleted_by", "delete_reason"]) {
        columns.delete(optional);
      }
    }
    return columns;
  }

  const aliases: Record<string, string> = {
    interaction: "interactions", source: "external_interaction_sources",
    participant: "interaction_participants", access_profile: "user_access_profiles",
    invocation: "action_invocations", audit: "audit_log", new: "audit_log"
  };
  for (const [alias, table] of Object.entries(aliases)) {
    const columns = columnsFor(table);
    for (const match of sqlWithoutLiterals.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, "gi"))) {
      assert.ok(columns.has(match[1]), `Columna incompatible: ${table}.${match[1]}`);
    }
  }
  for (const match of behaviorVerifier.matchAll(/insert into public\.(\w+)\s*\(([^)]+)\)\s*values/gi)) {
    const columns = columnsFor(match[1]);
    for (const column of match[2].split(",").map((value) => value.trim())) {
      assert.ok(columns.has(column), `INSERT incompatible: ${match[1]}.${column}`);
    }
  }
});

test("el verifier propaga errores inesperados y no acepta resultados NULL como exito", () => {
  assert.doesNotMatch(behaviorVerifier, /exception when others/i);
  const handlers = [...behaviorVerifier.matchAll(/exception when raise_exception then([\s\S]*?)end if;/gi)];
  assert.equal(handlers.length, 13);
  const rpcErrors = new Set(
    [...allDayGuardMigration.matchAll(/raise exception '([^']+)'/gi)].map((match) => match[1])
  );
  for (const handler of handlers) {
    assert.match(handler[1], /if sqlerrm <> '(?:ICS_IMPORT_[^']+|ics apply verifier forced rollback)' then\s+raise;/i);
    const expectedError = handler[1].match(/if sqlerrm <> '([^']+)'/i)?.[1];
    assert.ok(expectedError);
    assert.ok(
      expectedError === "ics apply verifier forced rollback" || rpcErrors.has(expectedError),
      `Error esperado no emitido por Apply: ${expectedError}`
    );
  }
  assert.doesNotMatch(behaviorVerifier, /v_result->>'\w+Count'\s*<>/i);
  assert.match(behaviorVerifier, /into strict v_source_id/i);
  assert.match(behaviorVerifier, /into strict v_interaction_updated_at/i);
  assert.match(behaviorVerifier, /array\['deleted', 'dismissed'\]/i);
  assert.match(behaviorVerifier, /'\{"deleted":false,"dismissed":false\}'::jsonb/);
  assert.match(behaviorVerifier, /jsonb_build_object\(v_dismissal_flag, true\)/i);
});

test("fixtures y DDL permanecen transaccionales y rollback comprueba las cinco tablas", () => {
  const withoutComments = behaviorVerifier.replace(/--[^\r\n]*/g, "").trim();
  assert.match(withoutComments, /^begin;\s+create function pg_temp\./i);
  assert.match(withoutComments, /end;\s+\$verify\$;\s+rollback;$/i);
  assert.doesNotMatch(withoutComments, /\bcommit\s*;/i);
  assert.match(withoutComments, /drop trigger verify_force_ics_apply_rollback on public\.audit_log/);
  const before = withoutComments.match(/v_before_rollback_counts := array\[([\s\S]*?)\];/)?.[1];
  const after = withoutComments.match(/v_before_rollback_counts is distinct from array\[([\s\S]*?)\] then/)?.[1];
  assert.ok(before && after);
  assert.equal(before, after);
  for (const table of ["interactions", "external_interaction_sources", "interaction_participants", "action_invocations", "audit_log"]) {
    assert.match(before, new RegExp(`from public\\.${table}\\b`));
  }
});
