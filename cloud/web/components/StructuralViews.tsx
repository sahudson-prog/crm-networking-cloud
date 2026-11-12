"use client";

import { useSearchParams } from "next/navigation";
import { ReadOnlyContacts } from "./ReadOnlyContacts";
import { ReadOnlyDashboard } from "./ReadOnlyDashboard";
import { OpportunityWorkspace } from "./OpportunityWorkspace";

export function HomeView() {
  // Preserve old /?contactId=... bookmarks without keeping the contact list at /.
  const contactId = useSearchParams().get("contactId");
  return contactId ? <ReadOnlyContacts view="contacts" /> : <ReadOnlyDashboard view="home" />;
}
export function RegisterProgressView() {
  return <div className="grid structural-view">
    <ReadOnlyContacts view="states" />
    <OpportunityWorkspace />
    <ReadOnlyDashboard view="interactions" />
  </div>;
}
export function PlanningView() {
  return <ReadOnlyDashboard view="planning" />;
}
export function ContactsView() {
  const contactId = useSearchParams().get("contactId");
  return <div className="grid structural-view">
    <ReadOnlyContacts view="contacts" />
    {contactId ? null : <ReadOnlyDashboard view="referrals" />}
  </div>;
}
