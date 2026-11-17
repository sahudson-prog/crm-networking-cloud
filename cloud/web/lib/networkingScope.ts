export type NetworkingContact = { id: string; networking_focus: boolean; is_active?: boolean };

// Tracking's RPC excludes inactive rows and omits is_active from its DTO.
// Missing Foco never grants eligibility; other readers also carry is_active.
export function isNetworkingContact(contact: NetworkingContact): boolean {
  return contact.networking_focus === true && contact.is_active !== false;
}

export function selectNetworkingContacts<T extends NetworkingContact>(contacts: readonly T[]): T[] {
  return [...new Map(contacts.filter(isNetworkingContact).map(contact => [contact.id, contact])).values()];
}

export function linkedNetworkingIds(
  links: readonly { interaction_id: string; contact_id: string | null }[], contactIds: ReadonlySet<string>
): Set<string> {
  return new Set(links.filter(link => link.contact_id !== null && contactIds.has(link.contact_id)).map(link => link.interaction_id));
}
