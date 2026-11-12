"use client";

import { SystemCapabilityGate } from "../../components/SystemAccess";
import { SystemReadiness } from "../../components/SystemReadiness";

export default function SistemaPage() {
  return (
    <SystemCapabilityGate surface="system">
          <SystemReadiness />
        </SystemCapabilityGate>
  );
}
