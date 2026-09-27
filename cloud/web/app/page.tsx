"use client";

import { AuthGate } from "../components/AuthGate";
import { ReadOnlyContacts } from "../components/ReadOnlyContacts";
import { Shell } from "../components/Shell";

export default function Page() {
  return (
    <AuthGate>
      <Shell>
        <ReadOnlyContacts />
      </Shell>
    </AuthGate>
  );
}
