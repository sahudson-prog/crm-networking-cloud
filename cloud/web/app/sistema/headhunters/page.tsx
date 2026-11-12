"use client";

import { HeadhunterCompanyMasterPage } from "../../../components/HeadhunterCompanyMasterPage";
import { SystemCapabilityGate } from "../../../components/SystemAccess";

export default function HeadhuntersPage() {
  return (
    <SystemCapabilityGate surface="headhunters">
          <div className="page-stack">
            <HeadhunterCompanyMasterPage />
          </div>
        </SystemCapabilityGate>
  );
}
