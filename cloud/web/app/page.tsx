"use client";

import { AuthGate } from "../components/AuthGate";
import { ReadOnlyDashboard } from "../components/ReadOnlyDashboard";
import { Shell } from "../components/Shell";

export default function Page() {
  return (
    <AuthGate>
      <Shell>
        <ReadOnlyDashboard />
      </Shell>
    </AuthGate>
  );
}
