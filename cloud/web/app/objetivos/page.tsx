"use client";

import { AuthGate } from "../../components/AuthGate";
import { ObjectivesPage } from "../../components/ObjectivesPage";
import { Shell } from "../../components/Shell";

export default function ObjetivosPage() {
  return (
    <AuthGate>
      <Shell>
        <ObjectivesPage />
      </Shell>
    </AuthGate>
  );
}
