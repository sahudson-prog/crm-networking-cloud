"use client";

import { AuthGate } from "../../components/AuthGate";
import { Shell } from "../../components/Shell";
import { SystemReadiness } from "../../components/SystemReadiness";

export default function SistemaPage() {
  return (
    <AuthGate>
      <Shell>
        <SystemReadiness />
      </Shell>
    </AuthGate>
  );
}
