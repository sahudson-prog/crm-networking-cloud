"use client";

import { AdminMaintenancePage } from "../../../components/AdminMaintenancePage";
import { SystemCapabilityGate } from "../../../components/SystemAccess";

export default function MantencionPage() {
  return (
    <SystemCapabilityGate surface="maintenance">
          <div className="page-stack">
            <AdminMaintenancePage />
          </div>
        </SystemCapabilityGate>
  );
}
