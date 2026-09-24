"use client";

import { DesignSystemPreview } from "../../../components/DesignSystemPreview";
import { AuthGate } from "../../../components/AuthGate";
import { Shell } from "../../../components/Shell";
import { SystemCapabilityGate } from "../../../components/SystemAccess";

export default function DisenoPage() {
  return (
    <AuthGate>
      <Shell>
        <SystemCapabilityGate surface="design">
          <DesignSystemPreview />
        </SystemCapabilityGate>
      </Shell>
    </AuthGate>
  );
}
