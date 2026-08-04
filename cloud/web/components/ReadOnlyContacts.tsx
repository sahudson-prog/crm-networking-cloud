"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { readAllActiveContacts, readContactProfile } from "../lib/cloudData";
import type { ContactProfileData, ContactRow } from "../lib/readModel";
import { ContactProfile } from "./ContactProfile";
import { ContactTable } from "./ContactTable";

export function ReadOnlyContacts() {
  const searchParams = useSearchParams();
  const contactId = searchParams.get("contactId") ?? "";
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [profile, setProfile] = useState<ContactProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProfile = useCallback(async () => {
    if (!contactId) return;
    const data = await readContactProfile(contactId);
    setProfile(data);
  }, [contactId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        if (contactId) {
          const data = await readContactProfile(contactId);
          if (!cancelled) setProfile(data);
        } else {
          const data = await readAllActiveContacts();
          if (!cancelled) setContacts(data);
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
  }, [contactId]);

  if (loading) return <section className="panel">Leyendo contactos...</section>;
  if (error) return <section className="panel">Error: {error}</section>;
  if (contactId) {
    if (!profile) return <section className="panel">No encontre ese contacto.</section>;
    return <ContactProfile profile={profile} onReload={loadProfile} />;
  }

  return <ContactTable contacts={contacts} />;
}
