import {
  checkCurrentUserCapability,
  type CapabilityAccessState,
  type CapabilityCode
} from "./accessControl.ts";

export const SYSTEM_CAPABILITY_CODES = [
  "admin.view_diagnostics",
  "admin.manage_access",
  "admin.manage_global_masters"
] as const satisfies readonly CapabilityCode[];

export type SystemCapabilityCode = (typeof SYSTEM_CAPABILITY_CODES)[number];
export type SystemSurface = "system" | "design" | "logs" | "maintenance" | "headhunters";

export type SystemAccessState =
  | { status: "checking"; grantedCapabilities: SystemCapabilityCode[] }
  | { status: "ready"; grantedCapabilities: SystemCapabilityCode[] }
  | { status: "error"; grantedCapabilities: SystemCapabilityCode[]; message: string };

type CapabilityChecker = (capabilityCode: CapabilityCode) => Promise<CapabilityAccessState>;

const SYSTEM_SURFACE_REQUIREMENTS: Record<SystemSurface, readonly SystemCapabilityCode[]> = {
  design: ["admin.view_diagnostics"],
  headhunters: ["admin.manage_global_masters"],
  logs: ["admin.view_diagnostics"],
  maintenance: ["admin.manage_access"],
  system: SYSTEM_CAPABILITY_CODES
};

export function initialSystemAccessState(): SystemAccessState {
  return { grantedCapabilities: [], status: "checking" };
}

export async function loadSystemAccessState(
  checkCapability: CapabilityChecker = checkCurrentUserCapability
): Promise<SystemAccessState> {
  try {
    const checks = await Promise.all(
      SYSTEM_CAPABILITY_CODES.map((capabilityCode) => checkCapability(capabilityCode))
    );
    return resolveSystemAccessChecks(checks);
  } catch {
    return systemAccessError();
  }
}

export function resolveSystemAccessChecks(checks: readonly CapabilityAccessState[]): SystemAccessState {
  const expectedChecks = new Map(checks.map((check) => [check.capabilityCode, check]));
  const missingCheck = SYSTEM_CAPABILITY_CODES.some((capabilityCode) => !expectedChecks.has(capabilityCode));
  const invalidCheck = checks.some((check) => check.status !== "allowed" && check.status !== "denied");

  if (missingCheck || invalidCheck) return systemAccessError();

  return {
    grantedCapabilities: SYSTEM_CAPABILITY_CODES.filter(
      (capabilityCode) => expectedChecks.get(capabilityCode)?.allowed === true
    ),
    status: "ready"
  };
}

export function hasSystemSurfaceAccess(
  grantedCapabilities: readonly SystemCapabilityCode[],
  surface: SystemSurface
) {
  const granted = new Set(grantedCapabilities);
  return SYSTEM_SURFACE_REQUIREMENTS[surface].some((capabilityCode) => granted.has(capabilityCode));
}

export function canRenderSystemSurface(state: SystemAccessState, surface: SystemSurface) {
  return state.status === "ready" && hasSystemSurfaceAccess(state.grantedCapabilities, surface);
}

function systemAccessError(): SystemAccessState {
  return {
    grantedCapabilities: [],
    message: "No pude validar los permisos de Sistema.",
    status: "error"
  };
}
