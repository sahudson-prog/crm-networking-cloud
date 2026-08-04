"use client";

import { AccountPage } from "../../components/AccountPage";
import { AuthGate } from "../../components/AuthGate";
import { Shell } from "../../components/Shell";

export default function CuentaPage() {
  return (
    <AuthGate>
      <Shell>
        <AccountPage />
      </Shell>
    </AuthGate>
  );
}
