"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { subscribeGlobalActivitySync, getGlobalActivitySyncSnapshot, getGlobalActivitySyncServerSnapshot } from "../lib/activitySyncExecution";
import { readContactListRows, readContactProfile } from "../lib/cloudData";
import type { ContactListRow, ContactProfileData } from "../lib/readModel";
import { ContactProfile } from "./ContactProfile";
import { ContactTable } from "./ContactTable";
import { ViewSkeleton } from "./ui/ViewSkeleton";
import { OperationStatus } from "./ui/OperationStatus";
import { Button } from "./ui/Button";
import { peekSharedView } from "../lib/indicatorReads";
import { getNetworkingDataRevision, getServerNetworkingDataRevision, subscribeNetworkingDataRevision, notifyNetworkingDataChanged } from "../lib/networkingDataRevision";

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
  onContactsResolved,
  view = "all"
}: {
  beforeList?: ReactNode;
  onContactsResolved?: (contacts: ContactListRow[]) => void;
  view?: "all" | "states" | "contacts";
} = {}) {
  const searchParams = useSearchParams();
  const contactId = searchParams.get("contactId") ?? "";
  const profileVersion = useRef(0);
  const [cached]=useState(()=>peekSharedView<ContactListRow[]>("contact-list"));
  const [contacts, setContacts] = useState<ContactListRow[]>(cached??[]);
  const [profile, setProfile] = useState<ContactProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resolvedKey,setResolvedKey]=useState<string|null>(cached?"":null);
  const [listResolved, setListResolved] = useState(Boolean(cached));
  const [retry,setRetry]=useState(0);
  const revision=useSyncExternalStore(subscribeNetworkingDataRevision,getNetworkingDataRevision,getServerNetworkingDataRevision);
  const calendarSyncedAt = useSyncExternalStore(subscribeGlobalActivitySync,
    getGlobalActivitySyncSnapshot, getGlobalActivitySyncServerSnapshot).lastSuccess?.calendar;

  const loadProfile = useCallback(async () => {
    if (!contactId) return;
    const version = ++profileVersion.current;
    const data = await readContactProfile(contactId);
    if (version === profileVersion.current) setProfile(data);
  }, [contactId]);

  const loadContacts = useCallback(async () => {
    notifyNetworkingDataChanged();
    await readContactListRows();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        if (contactId) {
          const data = await retryOnce(() => readContactProfile(contactId));
          if (!cancelled) {setProfile(data);setResolvedKey(contactId);}
        } else {
          const data = await retryOnce(readContactListRows);
          if (!cancelled) {
            setContacts(data);
            setListResolved(true);
            setResolvedKey("");
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
      profileVersion.current++;
    };
  }, [contactId, onContactsResolved, calendarSyncedAt,revision,retry]);

  const feedback=error?<div role="alert">No pudimos actualizar los contactos. <Button onClick={()=>setRetry(n=>n+1)}>Reintentar</Button></div>:null;
  if (contactId ? resolvedKey !== contactId : !listResolved) return <>{feedback}
    <section className="panel contacts-workspace functional-block">
      <div className="panel-header contacts-header"><h2 className="panel-title">{contactId ? "Contacto" : view === "states" ? "Estados de networking" : "Contactos"}<OperationStatus label="Contactos" resolved={false} busy={loading} error={error ? "No pudimos leer los contactos." : ""} onRetry={() => setRetry(n => n + 1)} /></h2></div>
      <div className="contacts-status-toolbar" aria-hidden="true"><ViewSkeleton kind="inline" /></div>
      <div className="view-loading-region">{loading ? <ViewSkeleton kind={view === "states" ? "board" : "table"} label="Contactos" /> : null}</div>
    </section>
    {!contactId && view === "contacts" ? <section className="panel functional-block"><h2 className="panel-title">Empresas<OperationStatus label="Empresas" resolved={false} busy={loading} error={error ? "No pudimos leer las empresas." : ""} onRetry={() => setRetry(n => n + 1)} /></h2>
      <div className="view-loading-region">{loading ? <ViewSkeleton label="Empresas" /> : null}</div>
    </section> : null}
  </>;
  if (contactId) {
    if (!profile) return <section className="panel">No encontre ese contacto.</section>;
    return <>{feedback}<ContactProfile profile={profile} onReload={loadProfile} /></>;
  }

  const table = <>{feedback}<ContactTable contacts={contacts} onReload={loadContacts} view={view}
    readState={{ resolved: listResolved, busy: loading, error: error ? "No pudimos actualizar los contactos." : "", onRetry: () => setRetry(n => n + 1) }} /></>;
  if (!beforeList) return table;
  return <div className="onboarding-contacts-view">{beforeList}{table}</div>;
}
