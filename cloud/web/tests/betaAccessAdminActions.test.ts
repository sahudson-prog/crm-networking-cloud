import test from "node:test";
import assert from "node:assert/strict";

import {
  BETA_ACCESS_DIAGNOSTIC_RPC,
  betaAllowlistLabel,
  betaEffectiveAccessLabel,
  betaRegistrationLabel,
  mapBetaAccessDiagnosticResponse,
  mapBetaAccessDiagnosticRow,
  mapBetaAccessRow,
  normalizeAdminEmailInput
} from "../lib/betaAccessAdminActions.ts";

test("normaliza email admin solo para presentacion/envio a RPC", () => {
  assert.equal(normalizeAdminEmailInput("  USER@Example.COM  "), "user@example.com");
});

test("mapea allowlist autorizado registrado", () => {
  const row = mapBetaAccessRow({
    access_allowed: true,
    access_reason: "allowed",
    allowlist_status: "authorized",
    capabilities: ["contacts.manage"],
    email: "user@example.invalid",
    registered: true,
    roles: ["user"],
    user_id: "user-1"
  });

  assert.equal(betaAllowlistLabel(row.allowlistStatus), "Autorizado");
  assert.equal(betaRegistrationLabel(row), "Sí");
  assert.equal(betaEffectiveAccessLabel(row), "Acceso permitido — allowed");
  assert.deepEqual(row.roles, ["user"]);
  assert.deepEqual(row.capabilities, ["contacts.manage"]);
});

test("mapea allowlist revocado registrado como acceso bloqueado", () => {
  const row = mapBetaAccessRow({
    access_allowed: false,
    access_reason: "revoked",
    allowlist_status: "revoked",
    email: "user@example.invalid",
    registered: true,
    user_id: "user-1"
  });

  assert.equal(betaAllowlistLabel(row.allowlistStatus), "Revocado");
  assert.equal(betaRegistrationLabel(row), "Sí");
  assert.equal(betaEffectiveAccessLabel(row), "Acceso bloqueado — revoked");
});

test("mapea autorizado aun no registrado sin inventar usuario", () => {
  const row = mapBetaAccessRow({
    allowlist_status: "authorized",
    email: "invited@example.invalid",
    registered: false
  });

  assert.equal(row.userId, "");
  assert.equal(betaRegistrationLabel(row), "No");
  assert.equal(betaEffectiveAccessLabel(row), "Sin usuario registrado");
});

test("mapea diagnostico missing para usuario registrado sin allowlist", () => {
  const row = mapBetaAccessRow({
    access_allowed: false,
    access_reason: "not_allowlisted",
    account_status: "active",
    allowlist_status: "missing",
    beta_access_status: "approved",
    capabilities: [],
    email: "registered@example.invalid",
    plan_code: "beta_personal",
    registered: true,
    roles: ["user"],
    user_id: "user-2"
  });

  assert.equal(betaAllowlistLabel(row.allowlistStatus), "Sin autorización");
  assert.equal(betaRegistrationLabel(row), "Sí");
  assert.equal(betaEffectiveAccessLabel(row), "Acceso bloqueado — not_allowlisted");
  assert.equal(row.userId, "user-2");
});

test("mapea usuario registrado con acceso denegado", () => {
  const row = mapBetaAccessRow({
    access_allowed: false,
    access_reason: "access_not_approved",
    account_status: "active",
    allowlist_status: "authorized",
    beta_access_status: "pending",
    email: "denied@example.invalid",
    registered: true,
    user_id: "user-3"
  });

  assert.equal(betaEffectiveAccessLabel(row), "Acceso bloqueado — access_not_approved");
  assert.equal(row.betaAccessStatus, "pending");
});

test("mapea usuario registrado sin access profile como diagnostico incompleto", () => {
  const row = mapBetaAccessRow({
    access_allowed: false,
    access_reason: "account_inactive",
    allowlist_status: "authorized",
    email: "missing-profile@example.invalid",
    registered: true,
    user_id: "user-4"
  });

  assert.equal(row.accountStatus, "");
  assert.equal(row.betaAccessStatus, "");
  assert.equal(row.planCode, "");
  assert.equal(betaEffectiveAccessLabel(row), "Acceso bloqueado — account_inactive");
});

test("mapea fila de diagnostico como usuario registrado aunque la RPC no envie registered", () => {
  const row = mapBetaAccessDiagnosticRow({
    allowed: false,
    reason: "not_allowlisted",
    allowlist_status: "missing",
    email: "registered@example.invalid",
    user_id: "user-5"
  });

  assert.equal(row.registered, true);
  assert.equal(betaRegistrationLabel(row), "Sí");
});

test("mapea diagnostico permitido desde contrato SQL allowed/reason", () => {
  const row = mapBetaAccessDiagnosticRow({
    allowed: true,
    reason: "allowed",
    allowlist_status: "authorized",
    email: "allowed@example.invalid",
    user_id: "user-6"
  });

  assert.equal(row.accessAllowed, true);
  assert.equal(row.accessReason, "allowed");
  assert.equal(betaEffectiveAccessLabel(row), "Acceso permitido — allowed");
});

test("mapea diagnostico bloqueado desde contrato SQL allowed/reason", () => {
  const row = mapBetaAccessDiagnosticRow({
    allowed: false,
    reason: "not_allowlisted",
    allowlist_status: "missing",
    email: "blocked@example.invalid",
    user_id: "user-7"
  });

  assert.equal(row.accessAllowed, false);
  assert.equal(row.accessReason, "not_allowlisted");
  assert.equal(betaEffectiveAccessLabel(row), "Acceso bloqueado — not_allowlisted");
});

test("mapea respuesta diagnostica vacia como null", () => {
  assert.equal(mapBetaAccessDiagnosticResponse([]), null);
  assert.equal(mapBetaAccessDiagnosticResponse(null), null);
});

test("helper de diagnostico usa la RPC admin esperada", () => {
  assert.equal(BETA_ACCESS_DIAGNOSTIC_RPC, "admin_get_app_access_diagnostic");
});
