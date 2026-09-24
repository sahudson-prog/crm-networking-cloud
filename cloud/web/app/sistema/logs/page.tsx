"use client";

import { AuthGate } from "../../../components/AuthGate";
import { Shell } from "../../../components/Shell";
import { SystemCapabilityGate } from "../../../components/SystemAccess";
import { SyncLogsPage } from "../../../components/SyncLogsPage";

export default function LogsPage() {
  return (
    <AuthGate>
      <Shell>
        <SystemCapabilityGate surface="logs">
          <div className="page-stack">
            <SyncLogsPage />
          </div>
        </SystemCapabilityGate>
      </Shell>
    </AuthGate>
  );
}
