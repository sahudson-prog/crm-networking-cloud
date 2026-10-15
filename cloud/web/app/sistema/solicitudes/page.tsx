"use client";

import { AuthGate } from "../../../components/AuthGate";
import { ContactRequestsAdminPage } from "../../../components/ContactRequestsAdminPage";
import { Shell } from "../../../components/Shell";
import { SystemCapabilityGate } from "../../../components/SystemAccess";

export default function SolicitudesPage() {
  return (
    <AuthGate>
      <Shell>
        <SystemCapabilityGate surface="requests">
          <div className="page-stack">
            <ContactRequestsAdminPage />
          </div>
        </SystemCapabilityGate>
      </Shell>
    </AuthGate>
  );
}
