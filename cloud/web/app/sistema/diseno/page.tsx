"use client";

import { DesignSystemPreview } from "../../../components/DesignSystemPreview";
import { SystemCapabilityGate } from "../../../components/SystemAccess";

export default function DisenoPage() {
  return (
    <SystemCapabilityGate surface="design">
          <DesignSystemPreview />
        </SystemCapabilityGate>
  );
}
