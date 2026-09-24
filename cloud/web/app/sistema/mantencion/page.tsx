"use client";

import { AdminMaintenancePage } from "../../../components/AdminMaintenancePage";
import { AuthGate } from "../../../components/AuthGate";
import { Shell } from "../../../components/Shell";
import { SystemCapabilityGate } from "../../../components/SystemAccess";

export default function MantencionPage() {
  return (
    <AuthGate>
      <Shell>
        <SystemCapabilityGate surface="maintenance">
          <div className="page-stack">
            <AdminMaintenancePage />
          </div>
        </SystemCapabilityGate>
      </Shell>
    </AuthGate>
  );
}
