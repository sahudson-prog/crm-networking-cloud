"use client";

import { AuthGate } from "../../../components/AuthGate";
import { HeadhunterCompanyMasterPage } from "../../../components/HeadhunterCompanyMasterPage";
import { Shell } from "../../../components/Shell";
import { SystemCapabilityGate } from "../../../components/SystemAccess";

export default function HeadhuntersPage() {
  return (
    <AuthGate>
      <Shell>
        <SystemCapabilityGate surface="headhunters">
          <div className="page-stack">
            <HeadhunterCompanyMasterPage />
          </div>
        </SystemCapabilityGate>
      </Shell>
    </AuthGate>
  );
}
