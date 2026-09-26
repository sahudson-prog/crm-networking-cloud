"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { readContactListRows, readContactProfile } from "../lib/cloudData";
import type { ContactListRow, ContactProfileData } from "../lib/readModel";
import { ContactProfile } from "./ContactProfile";
import { ContactTable } from "./ContactTable";

async function retryOnce<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (firstError) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    try {
      return await read();
    } catch {
      throw firstError;
    }
  }
}

export function ReadOnlyContacts({
  beforeList,
  onContactsResolved
}: {
  beforeList?: ReactNode;
  onContactsResolved?: (contacts: ContactListRow[]) => void;
} = {}) {
  const searchParams = useSearchParams();
  const contactId = searchParams.get("contactId") ?? "";
  const [contacts, setContacts] = useState<ContactListRow[]>([]);
  const [profile, setProfile] = useState<ContactProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProfile = useCallback(async () => {
    if (!contactId) return;
    const data = await readContactProfile(contactId);
    setProfile(data);
  }, [contactId]);

  const loadContacts = useCallback(async () => {
    const data = await readContactListRows();
    setContacts(data);
    onContactsResolved?.(data);
  }, [onContactsResolved]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        if (contactId) {
          const data = await retryOnce(() => readContactProfile(contactId));
          if (!cancelled) setProfile(data);
        } else {
          const data = await retryOnce(readContactListRows);
          if (!cancelled) {
            setContacts(data);
            onContactsResolved?.(data);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "No se pudieron leer contactos.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [contactId, onContactsResolved]);

  if (loading) return <section className="panel">Leyendo contactos...</section>;
  if (error) return <section className="panel">Error: {error}</section>;
  if (contactId) {
    if (!profile) return <section className="panel">No encontre ese contacto.</section>;
    return <ContactProfile profile={profile} onReload={loadProfile} />;
  }

  const table = <ContactTable contacts={contacts} onReload={loadContacts} />;
  if (!beforeList) return table;
  return <div className="onboarding-contacts-view">{beforeList}{table}</div>;
}
