import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  applyAccessRevalidationResult,
  parseAppAccessRpcResponse,
  resetAppAccessForLogout,
  resolveAppAccessForSession,
  shouldPreservePrivateUiDuringAccessRevalidation,
  type AppAccessGateState,
  type AppAccessResolution,
  type AppAccessRpcClient
} from "../lib/appAccess.ts";

test("app access no consulta RPC cuando no hay sesion", async () => {
  const client = fakeRpcClient([{ allowed: true, reason: "allowed" }]);

  const result = await resolveAppAccessForSession(null, client);

  assert.deepEqual(result, { status: "unauthenticated" });
  assert.equal(client.calls.length, 0);
});

test("app access permite entrar cuando la RPC responde allowed", async () => {
  const client = fakeRpcClient([{ allowed: true, reason: "allowed" }]);

  const result = await resolveAppAccessForSession({ user: { email: "user@example.invalid" } }, client);

  assert.deepEqual(result, { status: "allowed" });
  assert.deepEqual(client.calls, ["current_user_app_access_status"]);
});

test("app access bloquea cuando la RPC responde denied", async () => {
  const client = fakeRpcClient([{ allowed: false, reason: "not_allowlisted" }]);

  const result = await resolveAppAccessForSession({ user: { email: "user@example.invalid" } }, client);

  assert.deepEqual(result, { status: "denied", reason: "not_allowlisted" });
});

test("app access falla cerrado cuando la RPC retorna error", async () => {
  const client = fakeRpcClient(null, "rpc unavailable");

  const result = await resolveAppAccessForSession({ user: { email: "user@example.invalid" } }, client);

  assert.deepEqual(result, { status: "error", message: "rpc unavailable" });
});

test("app access falla cerrado cuando la RPC rechaza inesperadamente", async () => {
  const client: AppAccessRpcClient & { calls: string[] } = {
    calls: [],
    rpc(functionName: "current_user_app_access_status") {
      this.calls.push(functionName);
      return Promise.reject(new Error("network failed"));
    }
  };

  const result = await resolveAppAccessForSession({ user: { email: "user@example.invalid" } }, client);

  assert.deepEqual(result, { status: "error", message: "No se pudo revisar el acceso." });
  assert.deepEqual(client.calls, ["current_user_app_access_status"]);
});

test("app access no queda cargando indefinidamente si la RPC no responde", async () => {
  const client: AppAccessRpcClient & { calls: string[] } = {
    calls: [],
    rpc(functionName: "current_user_app_access_status") {
      this.calls.push(functionName);
      return new Promise(() => {});
    }
  };

  const result = await resolveAppAccessForSession({ user: { email: "user@example.invalid" } }, client, 1);

  assert.deepEqual(result, { status: "error", message: "No se pudo revisar el acceso." });
  assert.deepEqual(client.calls, ["current_user_app_access_status"]);
});

test("logout deja el acceso en estado no autenticado", () => {
  assert.deepEqual(resetAppAccessForLogout(), { status: "unauthenticated" });
});

test("cambio de sesion fuerza una nueva evaluacion", async () => {
  const client = fakeRpcClient([{ allowed: true, reason: "allowed" }]);

  await resolveAppAccessForSession({ user: { email: "one@example.invalid" } }, client);
  await resolveAppAccessForSession({ user: { email: "two@example.invalid" } }, client);

  assert.deepEqual(client.calls, ["current_user_app_access_status", "current_user_app_access_status"]);
});

test("TOKEN_REFRESHED del mismo usuario conserva UI privada mientras revalida", () => {
  assert.equal(shouldPreservePrivateUiDuringAccessRevalidation({
    currentAccess: { status: "allowed" },
    event: "TOKEN_REFRESHED",
    nextSession: { user: { email: "USER@example.invalid", id: "user-1" } },
    previousSession: { user: { email: "user@example.invalid", id: "user-1" } }
  }), true);
});

test("logout o cambio de usuario no conserva UI privada", () => {
  assert.equal(shouldPreservePrivateUiDuringAccessRevalidation({
    currentAccess: { status: "allowed" },
    event: "SIGNED_OUT",
    nextSession: null,
    previousSession: { user: { email: "user@example.invalid", id: "user-1" } }
  }), false);
  assert.equal(shouldPreservePrivateUiDuringAccessRevalidation({
    currentAccess: { status: "allowed" },
    event: "TOKEN_REFRESHED",
    nextSession: { user: { email: "other@example.invalid", id: "user-2" } },
    previousSession: { user: { email: "user@example.invalid", id: "user-1" } }
  }), false);
});

test("access denied tras revalidacion bloquea aunque la UI se haya preservado durante la consulta", () => {
  const currentAccess: AppAccessGateState = { status: "allowed" };
  const denied: AppAccessResolution = { status: "denied", reason: "not_allowlisted" };

  assert.deepEqual(applyAccessRevalidationResult(currentAccess, denied, true), denied);
});

test("error transitorio al revalidar mismo usuario no desmonta UI privada vigente", () => {
  const currentAccess: AppAccessGateState = { status: "allowed" };
  const transientError: AppAccessResolution = { status: "error", message: "No se pudo revisar el acceso." };

  assert.deepEqual(applyAccessRevalidationResult(currentAccess, transientError, true), currentAccess);
  assert.deepEqual(applyAccessRevalidationResult(currentAccess, transientError, false), transientError);
});

test("AuthGate no reemplaza children por loading durante refresh de token del mismo usuario", () => {
  const source = readFileSync(new URL("../components/AuthGate.tsx", import.meta.url), "utf8");

  assert.match(source, /shouldPreservePrivateUiDuringAccessRevalidation/);
  assert.match(source, /if \(!preservePrivateUi\) commitAccess\(\{ status: "checking" \}\)/);
});

test("Cuenta distingue loading Google de desconectado", () => {
  const source = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");

  assert.match(source, /createInitialAccountState\(true\)/);
  assert.match(source, /label: "Revisando conexión"/);
  assert.match(source, /googleConnectionLoading: false/);
});

test("respuesta RPC con shape inesperado se trata como error", () => {
  assert.deepEqual(parseAppAccessRpcResponse([{ enabled: true }]), {
    status: "error",
    message: "La respuesta de acceso no tiene el formato esperado."
  });
});

test("respuesta RPC con reason inesperado se trata como error", () => {
  assert.deepEqual(parseAppAccessRpcResponse([{ allowed: false, reason: 403 }]), {
    status: "error",
    message: "La respuesta de acceso no tiene el formato esperado."
  });
});

function fakeRpcClient(data: unknown, errorMessage = ""): AppAccessRpcClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async rpc(functionName: "current_user_app_access_status") {
      calls.push(functionName);
      return {
        data,
        error: errorMessage ? { message: errorMessage } : null
      };
    }
  };
}
