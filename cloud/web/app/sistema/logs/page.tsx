"use client";

import { SystemCapabilityGate } from "../../../components/SystemAccess";
import { SyncLogsPage } from "../../../components/SyncLogsPage";

export default function LogsPage() {
  return (
    <SystemCapabilityGate surface="logs">
          <div className="page-stack">
            <SyncLogsPage />
          </div>
        </SystemCapabilityGate>
  );
}
