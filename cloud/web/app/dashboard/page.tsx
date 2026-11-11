"use client";

import { AuthGate } from "../../components/AuthGate";
import { HomeView } from "../../components/StructuralViews";
import { Shell } from "../../components/Shell";

export default function DashboardPage() {
  return (
    <AuthGate>
      <Shell>
        <HomeView />
      </Shell>
    </AuthGate>
  );
}
