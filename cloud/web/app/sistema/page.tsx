"use client";

import { AuthGate } from "../../components/AuthGate";
import { Shell } from "../../components/Shell";
import { SystemCapabilityGate } from "../../components/SystemAccess";
import { SystemReadiness } from "../../components/SystemReadiness";

export default function SistemaPage() {
  return (
    <AuthGate>
      <Shell>
        <SystemCapabilityGate surface="system">
          <SystemReadiness />
        </SystemCapabilityGate>
      </Shell>
    </AuthGate>
  );
}
