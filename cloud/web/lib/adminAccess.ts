import {
  checkCurrentUserCapability,
  type CapabilityAccessState,
  type CapabilityCode
} from "./accessControl";

export type AdminAccessState = CapabilityAccessState;

export async function loadAdminAccessState(
  capabilityCode: CapabilityCode = "admin.view_diagnostics"
): Promise<AdminAccessState> {
  return checkCurrentUserCapability(capabilityCode);
}
