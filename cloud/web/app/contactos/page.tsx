"use client";

import { AuthGate } from "../../components/AuthGate";
import { ContactsView } from "../../components/StructuralViews";
import { Shell } from "../../components/Shell";

export default function ContactosPage() {
  return (
    <AuthGate>
      <Shell>
        <ContactsView />
      </Shell>
    </AuthGate>
  );
}
