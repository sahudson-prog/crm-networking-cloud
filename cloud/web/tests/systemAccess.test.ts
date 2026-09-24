import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canRenderSystemSurface,
  hasSystemSurfaceAccess,
  resolveSystemAccessChecks,
  type SystemCapabilityCode
} from "../lib/systemAccess.ts";
import type { CapabilityAccessState, CapabilityCode } from "../lib/accessControl.ts";

test("usuario base conserva Cuenta y no ve Sistema", () => {
  const shellSource = source("../components/Shell.tsx");

  assert.equal(hasSystemSurfaceAccess([], "system"), false);
  assert.match(shellSource, /showSystem \? \(/);
  assert.match(shellSource, /href="\/cuenta"/);
});

test("diagnosticos habilita Sistema, Guia y Logs solamente", () => {
  const granted: SystemCapabilityCode[] = ["admin.view_diagnostics"];

  assert.equal(hasSystemSurfaceAccess(granted, "system"), true);
  assert.equal(hasSystemSurfaceAccess(granted, "design"), true);
  assert.equal(hasSystemSurfaceAccess(granted, "logs"), true);
  assert.equal(hasSystemSurfaceAccess(granted, "maintenance"), false);
  assert.equal(hasSystemSurfaceAccess(granted, "headhunters"), false);
});

test("administracion de acceso habilita Sistema y Mantencion solamente", () => {
  const granted: SystemCapabilityCode[] = ["admin.manage_access"];

  assert.equal(hasSystemSurfaceAccess(granted, "system"), true);
  assert.equal(hasSystemSurfaceAccess(granted, "maintenance"), true);
  assert.equal(hasSystemSurfaceAccess(granted, "design"), false);
  assert.equal(hasSystemSurfaceAccess(granted, "logs"), false);
  assert.equal(hasSystemSurfaceAccess(granted, "headhunters"), false);
});

test("administracion de maestros habilita Sistema y HeadHunter solamente", () => {
  const granted: SystemCapabilityCode[] = ["admin.manage_global_masters"];

  assert.equal(hasSystemSurfaceAccess(granted, "system"), true);
  assert.equal(hasSystemSurfaceAccess(granted, "headhunters"), true);
  assert.equal(hasSystemSurfaceAccess(granted, "design"), false);
  assert.equal(hasSystemSurfaceAccess(granted, "logs"), false);
  assert.equal(hasSystemSurfaceAccess(granted, "maintenance"), false);
});

test("las tres capabilities administrativas habilitan todas las superficies", () => {
  const granted: SystemCapabilityCode[] = [
    "admin.view_diagnostics",
    "admin.manage_access",
    "admin.manage_global_masters"
  ];

  for (const surface of ["system", "design", "logs", "maintenance", "headhunters"] as const) {
    assert.equal(hasSystemSurfaceAccess(granted, surface), true);
  }
});

test("resolucion pendiente o con error falla cerrada", () => {
  assert.equal(canRenderSystemSurface({ grantedCapabilities: [], status: "checking" }, "system"), false);
  assert.equal(canRenderSystemSurface({
    grantedCapabilities: [],
    message: "No pude validar los permisos de Sistema.",
    status: "error"
  }, "system"), false);

  const result = resolveSystemAccessChecks([
    accessCheck("admin.view_diagnostics", "allowed"),
    accessCheck("admin.manage_access", "error"),
    accessCheck("admin.manage_global_masters", "denied")
  ]);
  assert.equal(result.status, "error");
  assert.deepEqual(result.grantedCapabilities, []);
});

test("todas las rutas de Sistema autentican y guardan antes de montar contenido privado", () => {
  const routes = [
    ["../app/sistema/page.tsx", "system", "SystemReadiness"],
    ["../app/sistema/diseno/page.tsx", "design", "DesignSystemPreview"],
    ["../app/sistema/logs/page.tsx", "logs", "SyncLogsPage"],
    ["../app/sistema/mantencion/page.tsx", "maintenance", "AdminMaintenancePage"],
    ["../app/sistema/headhunters/page.tsx", "headhunters", "HeadhunterCompanyMasterPage"]
  ] as const;

  for (const [path, surface, privateComponent] of routes) {
    const routeSource = source(path);
    assert.match(routeSource, /<AuthGate>/);
    assert.match(routeSource, /<Shell>/);
    assert.match(routeSource, new RegExp(`<SystemCapabilityGate surface="${surface}">[\\s\\S]*<${privateComponent}`));
  }
});

test("el indice no lee cargas sin capability de diagnostico", () => {
  const readinessSource = source("../components/SystemReadiness.tsx");
  const guardIndex = readinessSource.indexOf("if (!canViewDiagnostics) return;");
  const queryIndex = readinessSource.indexOf('.from("import_batches")');

  assert.ok(guardIndex >= 0);
  assert.ok(queryIndex > guardIndex);
});

test("la guia visual usa fixtures inequivocamente ficticios", () => {
  const designSource = source("../components/DesignSystemPreview.tsx");
  const mergeSource = source("../components/ContactMergePreview.tsx");

  assert.match(designSource, /Contacto Demo/);
  assert.match(designSource, /@example\.invalid/);
  assert.match(mergeSource, /Contacto Demo/);
  assert.match(mergeSource, /@example\.invalid/);
});

function accessCheck(
  capabilityCode: CapabilityCode,
  status: CapabilityAccessState["status"]
): CapabilityAccessState {
  return {
    allowed: status === "allowed",
    capabilityCode,
    checked: true,
    email: "user@example.invalid",
    message: "",
    status
  };
}

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
