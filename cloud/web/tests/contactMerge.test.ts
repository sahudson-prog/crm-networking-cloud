import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  defaultContactMergeResult,
  contactMergeDecisionFromPreviewChange,
  withContactMergeDecision,
  type ContactMergeResult,
  type ContactMergeSource
} from "../lib/contactMerge.ts";
import { contactMergeErrorDiagnostic, normalizeContactDeepMergeInput } from "../lib/contactMergeActions.ts";
import type { SyncPreviewChange } from "../lib/syncOrchestrator.ts";

const baseChange: SyncPreviewChange = {
  defaultSelected: true,
  fields: [{ after: "Seminarium", before: "", changed: true, label: "Empresa" }],
  id: "google:modified:contact-1:people/1",
  metadata: {
    appContactId: "contact-1",
    externalId: "people/1"
  },
  title: "Josefina Camus",
  type: "modified"
};

test("contact merge adjunta y recupera la decision ajustada del preview", () => {
  const decision: ContactMergeResult = {
    company: "Seminarium",
    emails: ["josefina@example.com"],
    focus: true,
    headhunter: false,
    name: "Josefina Camus",
    networkingStatus: "Contactado",
    phones: ["+56912345678"],
    role: "Directora"
  };

  const adjustedChange = withContactMergeDecision(baseChange, decision);

  assert.deepEqual(contactMergeDecisionFromPreviewChange(adjustedChange), decision);
  assert.deepEqual(adjustedChange.metadata?.appContactId, "contact-1");
  assert.deepEqual(adjustedChange.metadata?.externalId, "people/1");
});

test("contact merge ignora decisiones incompletas o mal formadas", () => {
  const malformedChange: SyncPreviewChange = {
    ...baseChange,
    metadata: {
      ...baseChange.metadata,
      contactMergeDecision: {
        company: "Seminarium",
        name: "Josefina Camus"
      }
    }
  };

  assert.equal(contactMergeDecisionFromPreviewChange(malformedChange), null);
});

test("contact merge profundo normaliza inputs antes de llamar la base", () => {
  const normalized = normalizeContactDeepMergeInput({
    result: {
      company: " Duke ",
      emails: [" SERGIO@DUKE.CL ", "sergio@duke.cl"],
      focus: true,
      headhunter: false,
      name: " Sergio Hudson ",
      networkingStatus: "Contactado",
      phones: [" +56 9 1234 5678 ", "+56 9 1234 5678"],
      role: " CEO "
    },
    sourceContactIds: [" source-1 ", "source-1", "target-1"],
    targetContactId: " target-1 "
  });

  assert.deepEqual(normalized, {
    result: {
      company: "Duke",
      emails: ["sergio@duke.cl"],
      focus: true,
      headhunter: false,
      name: "Sergio Hudson",
      networkingStatus: "Contactado",
      phones: ["+56 9 1234 5678"],
      role: "CEO"
    },
    source: undefined,
    sourceContactIds: ["source-1"],
    targetContactId: "target-1"
  });
});

test("contact merge profundo exige nombre y maximo 3 contactos total", () => {
  assert.throws(() => normalizeContactDeepMergeInput({
    result: {
      company: "",
      emails: [],
      focus: true,
      headhunter: false,
      name: "",
      networkingStatus: "Pendiente",
      phones: [],
      role: ""
    },
    sourceContactIds: ["source-1"],
    targetContactId: "target-1"
  }), /nombre/i);

  assert.throws(() => normalizeContactDeepMergeInput({
    result: {
      company: "",
      emails: [],
      focus: true,
      headhunter: false,
      name: "Sergio Hudson",
      networkingStatus: "Pendiente",
      phones: [],
      role: ""
    },
    sourceContactIds: ["source-1", "source-2", "source-3"],
    targetContactId: "target-1"
  }), /maximo 3/i);
});

test("contact merge deduplica telefonos equivalentes sin perder telefonos distintos", () => {
  const sources: ContactMergeSource[] = [
    {
      company: "Redsalud",
      emails: ["THIAGO@EXAMPLE.COM"],
      focus: false,
      headhunter: false,
      id: "target",
      kind: "Guardado",
      name: "Thiago Lessa",
      networkingStatus: "Pendiente",
      phones: ["+56 9 9333 5679", "+56 2 2345 6789"],
      role: ""
    },
    {
      company: "Redsalud",
      emails: ["thiago@example.com", "thiago.lessa@example.com"],
      focus: false,
      headhunter: false,
      id: "source",
      kind: "Guardado",
      name: "Thiago Lessa",
      networkingStatus: "Pendiente",
      phones: ["56993335679", "+56 9 8111 2233"],
      role: ""
    }
  ];

  const result = defaultContactMergeResult(sources);

  assert.deepEqual(result.phones, ["+56 9 9333 5679", "+56 2 2345 6789", "+56 9 8111 2233"]);
  assert.deepEqual(result.emails, ["thiago@example.com", "thiago.lessa@example.com"]);
  assert.deepEqual(normalizeContactDeepMergeInput({
    result,
    sourceContactIds: ["source"],
    targetContactId: "target"
  }).result.phones, result.phones);
});

test("diagnostico de merge conserva metadata tecnica y redacta identidades", () => {
  const diagnostic = contactMergeErrorDiagnostic({
    code: "23505",
    details: "Key (contact_id, normalized_phone)=(123e4567-e89b-12d3-a456-426614174000, +56 9 9333 5679) already exists for thiago@example.com",
    hint: "Review +56 9 9333 5679",
    message: "duplicate key value violates unique constraint uq_contact_phones_contact_normalized",
    name: "PostgrestError"
  });

  assert.equal(diagnostic.code, "23505");
  assert.match(diagnostic.message, /uq_contact_phones_contact_normalized/);
  assert.equal(diagnostic.details.includes("123e4567"), false);
  assert.equal(diagnostic.details.includes("thiago@example.com"), false);
  assert.equal(diagnostic.details.includes("9333 5679"), false);
  assert.equal(diagnostic.hint.includes("9333 5679"), false);
});

test("migration forward reinstala exactamente el merge canonico y valida sus indices", () => {
  const canonicalSql = readFileSync(
    new URL("../../supabase/migrations/202609090004_application_rpcs.sql", import.meta.url),
    "utf8"
  );
  const repairSql = readFileSync(
    new URL("../../supabase/migrations/202609290001_repair_merge_contacts_deep.sql", import.meta.url),
    "utf8"
  );
  const verifierSql = readFileSync(
    new URL("../../supabase/verifiers/202609290001_verify_merge_contacts_deep_contract.sql", import.meta.url),
    "utf8"
  );

  const canonicalFunction = sqlSection(
    canonicalSql,
    "create or replace function public.merge_contacts_deep(",
    "create or replace function public.reset_current_user_app_data_v0_1"
  );
  const repairedFunction = sqlSection(
    repairSql,
    "create or replace function public.merge_contacts_deep(",
    "alter function public.merge_contacts_deep"
  );

  assert.equal(repairedFunction, canonicalFunction);
  assert.match(repairedFunction, /on conflict \(user_id, contact_id, normalized_email\)/i);
  assert.match(repairedFunction, /on conflict \(user_id, contact_id, normalized_phone\)/i);
  assert.doesNotMatch(repairedFunction, /on conflict \(user_id, normalized_email\)/i);
  assert.doesNotMatch(repairedFunction, /on conflict \(user_id, normalized_phone\)/i);
  assert.doesNotMatch(repairSql, /\b(?:create|drop|alter)\s+(?:unique\s+)?index\b/i);

  for (const contractFragment of [
    "indisunique",
    "indisvalid",
    "indisready",
    "indpred is null",
    "indexprs is null",
    "array['user_id', 'contact_id', 'normalized_email']",
    "array['user_id', 'contact_id', 'normalized_phone']",
    "on conflict (user_id, contact_id, normalized_email)",
    "on conflict (user_id, contact_id, normalized_phone)"
  ]) {
    assert.match(verifierSql.toLowerCase(), new RegExp(escapeRegExp(contractFragment)));
  }
});

test("hardening forward restaura grants merge/reset sin tocar datos, RLS ni indices", () => {
  const migrationSql = readFileSync(
    new URL("../../supabase/migrations/202609290002_harden_merge_reset_grants.sql", import.meta.url),
    "utf8"
  );
  const verifierSql = readFileSync(
    new URL("../../supabase/verifiers/202609290002_verify_merge_reset_grants.sql", import.meta.url),
    "utf8"
  );

  assert.match(migrationSql, /revoke all privileges on table[\s\S]+from public, anon, authenticated, service_role, supabase_auth_admin;/i);
  assert.match(migrationSql, /alter function public\.reset_current_user_app_data_v0_1\(text\) owner to postgres;/i);
  assert.match(migrationSql, /alter function public\.reset_current_user_app_data_v0_1\(text\) security definer;/i);
  assert.match(migrationSql, /alter function public\.reset_current_user_app_data_v0_1\(text\) set search_path = '';/i);
  assert.match(migrationSql, /grant execute on function public\.reset_current_user_app_data_v0_1\(text\)[\s\S]+to authenticated;/i);
  assert.doesNotMatch(migrationSql, /^\s*(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+)/im);
  assert.doesNotMatch(migrationSql, /\b(?:create|drop|alter)\s+(?:unique\s+)?index\b/i);
  assert.doesNotMatch(migrationSql, /\b(?:enable|disable|force|no force)\s+row level security\b|\b(?:create|drop|alter)\s+policy\b/i);

  for (const contractFragment of [
    "authenticated must not UPDATE public.interaction_participants directly",
    "authenticated must not DELETE from public.interaction_participants directly",
    "authenticated must not DELETE from public.object_review_state directly",
    "authenticated must not UPDATE public.contact_objective_assignments directly",
    "Grant drift on public.%: role % privilege % is %, expected %",
    "Reset RPC search_path must be empty",
    "Merge RPC search_path must be empty",
    "PUBLIC must not execute reset or merge RPC"
  ]) {
    assert.match(verifierSql, new RegExp(escapeRegExp(contractFragment)));
  }
});

function sqlSection(sql: string, startMarker: string, endMarker: string) {
  const start = sql.indexOf(startMarker);
  const end = sql.indexOf(endMarker, start);
  assert.notEqual(start, -1, `No se encontro ${startMarker}`);
  assert.notEqual(end, -1, `No se encontro ${endMarker}`);
  return sql.slice(start, end).trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
