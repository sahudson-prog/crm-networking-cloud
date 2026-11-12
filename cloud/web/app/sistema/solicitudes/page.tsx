"use client";

import { ContactRequestsAdminPage } from "../../../components/ContactRequestsAdminPage";
import { SystemCapabilityGate } from "../../../components/SystemAccess";

export default function SolicitudesPage() {
  return (
    <SystemCapabilityGate surface="requests">
          <div className="page-stack">
            <ContactRequestsAdminPage />
          </div>
        </SystemCapabilityGate>
  );
}
