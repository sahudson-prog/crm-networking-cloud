import {
  GoogleContactsClientError,
  readGoogleContacts,
  type GoogleContactsReadResult
} from "./googleContactsClient.ts";
import { readSyncCursor, markSyncCursorExpired } from "./syncCursorStore.ts";
import {
  syncContacts,
  type ExternalContactInput,
  type SyncRunResult
} from "./syncOrchestrator.ts";
import { supabase } from "./supabaseClient.ts";
import type { ContactRow } from "./readModel.ts";

export type ExternalContactLink = {
  externalId: string;
  contactId: string;
};

export type KnownExternalContactValue = {
  contactId: string;
  kind: "email" | "phone";
  value: string;
};

export type PrepareGoogleContactSyncInput = {
  accessToken: string;
  connectedAccountId?: string | null;
  cursorLabel?: string;
  forceFullSync?: boolean;
  maxPages?: number;
};

export type PrepareGoogleContactSyncResult = SyncRunResult & {
  googleRead: {
    mode: GoogleContactsReadResult["mode"];
    pagesRead: number;
    totalItems: number | null;
  };
  cursorExpired: boolean;
};

type PrepareGoogleContactSyncDependencies = {
  readAppContacts: () => Promise<ContactRow[]>;
  readExternalContactLinks: (input: { connectedAccountId?: string | null; provider: string }) => Promise<ExternalContactLink[]>;
  readKnownExternalContactValues: (input: { provider: string }) => Promise<KnownExternalContactValue[]>;
  readCursor: (input: { cursorLabel?: string; provider: string }) => Promise<string | null>;
  markCursorExpired: (input: { cursorLabel?: string; provider: string }) => Promise<void>;
  readProviderContacts: (input: {
    accessToken: string;
    connectedAccountId?: string | null;
    maxPages?: number;
    syncToken?: string | null;
  }) => Promise<GoogleContactsReadResult>;
  buildPreview: (input: {
    appContacts: ContactRow[];
    cursorBefore: string | null;
    cursorAfter: string | null;
    externalContacts: ExternalContactInput[];
    externalIdToContactId: Record<string, string>;
    knownExternalValuesByContactId: Record<string, Array<{ kind: "email" | "phone"; value: string }>>;
    mode: "incremental" | "historical";
  }) => Promise<SyncRunResult>;
};

const GOOGLE_PROVIDER = "google";

export async function prepareGoogleContactSyncPreview(
  input: PrepareGoogleContactSyncInput,
  dependencies: Partial<PrepareGoogleContactSyncDependencies> = {}
): Promise<PrepareGoogleContactSyncResult> {
  const deps = defaultDependencies(dependencies);
  const cursorLabel = input.cursorLabel ?? "";
  const [appContacts, externalLinks, knownValues, storedCursor] = await Promise.all([
    deps.readAppContacts(),
    deps.readExternalContactLinks({ connectedAccountId: input.connectedAccountId, provider: GOOGLE_PROVIDER }),
    deps.readKnownExternalContactValues({ provider: GOOGLE_PROVIDER }),
    input.forceFullSync ? Promise.resolve(null) : deps.readCursor({ cursorLabel, provider: GOOGLE_PROVIDER })
  ]);

  let cursorExpired = false;
  let googleRead: GoogleContactsReadResult;
  let cursorBefore = storedCursor;

  try {
    googleRead = await deps.readProviderContacts({
      accessToken: input.accessToken,
      connectedAccountId: input.connectedAccountId,
      maxPages: input.maxPages,
      syncToken: storedCursor
    });
  } catch (error) {
    if (!(error instanceof GoogleContactsClientError) || error.code !== "GOOGLE_CONTACTS_EXPIRED_SYNC_TOKEN") {
      throw error;
    }

    cursorExpired = true;
    cursorBefore = null;
    await deps.markCursorExpired({ cursorLabel, provider: GOOGLE_PROVIDER });
    googleRead = await deps.readProviderContacts({
      accessToken: input.accessToken,
      connectedAccountId: input.connectedAccountId,
      maxPages: input.maxPages,
      syncToken: null
    });
  }

  const preview = await deps.buildPreview({
    appContacts,
    cursorAfter: googleRead.nextSyncToken,
    cursorBefore,
    externalContacts: googleRead.contacts,
    externalIdToContactId: linksToMap(externalLinks),
    knownExternalValuesByContactId: valuesToMap(knownValues),
    mode: googleRead.mode === "incremental" ? "incremental" : "historical"
  });

  return {
    ...preview,
    cursorAfter: googleRead.nextSyncToken,
    cursorBefore,
    googleRead: {
      mode: googleRead.mode,
      pagesRead: googleRead.pagesRead,
      totalItems: googleRead.totalItems
    },
    cursorExpired,
    warnings: [
      ...preview.warnings,
      ...googleRead.warnings,
      ...(cursorExpired ? ["El cursor anterior vencio; prepare una revision completa de contactos."] : [])
    ]
  };
}

function defaultDependencies(overrides: Partial<PrepareGoogleContactSyncDependencies>): PrepareGoogleContactSyncDependencies {
  return {
    buildPreview: async (input) => syncContacts({
      appContacts: input.appContacts,
      cursorAfter: input.cursorAfter,
      cursorBefore: input.cursorBefore,
      externalIdToContactId: input.externalIdToContactId,
      items: input.externalContacts,
      knownExternalValuesByContactId: input.knownExternalValuesByContactId,
      mode: input.mode,
      provider: GOOGLE_PROVIDER,
      resourceType: "contacts"
    }),
    markCursorExpired: async (input) => {
      await markSyncCursorExpired({
        cursorLabel: input.cursorLabel,
        provider: input.provider,
        resourceType: "contacts"
      });
    },
    readAppContacts: async () => {
      const { readAllActiveContacts } = await import("./cloudData.ts");
      return readAllActiveContacts();
    },
    readCursor: async (input) => {
      const cursor = await readSyncCursor({
        cursorLabel: input.cursorLabel,
        provider: input.provider,
        resourceType: "contacts"
      });
      return cursor?.status === "ok" ? cursor.cursor_value : null;
    },
    readExternalContactLinks,
    readKnownExternalContactValues,
    readProviderContacts: readGoogleContacts,
    ...overrides
  };
}

async function readExternalContactLinks(input: { connectedAccountId?: string | null; provider: string }): Promise<ExternalContactLink[]> {
  const db = requireSupabase();
  const userId = await currentUserId();
  let query = db
    .from("external_contact_ids")
    .select("external_id,contact_id")
    .eq("user_id", userId)
    .eq("provider", input.provider)
    .eq("is_active", true);

  if (input.connectedAccountId) query = query.eq("connected_account_id", input.connectedAccountId);

  const { data, error } = await query.limit(5000);
  if (error) throw error;
  return (data ?? []).map((row: { external_id: string; contact_id: string }) => ({
    contactId: row.contact_id,
    externalId: row.external_id
  }));
}

async function readKnownExternalContactValues(input: { provider: string }): Promise<KnownExternalContactValue[]> {
  const db = requireSupabase();
  const userId = await currentUserId();
  const [{ data: emails, error: emailsError }, { data: phones, error: phonesError }] = await Promise.all([
    db
      .from("contact_emails")
      .select("contact_id,email")
      .eq("user_id", userId)
      .eq("source", input.provider)
      .limit(5000),
    db
      .from("contact_phones")
      .select("contact_id,phone")
      .eq("user_id", userId)
      .eq("source", input.provider)
      .limit(5000)
  ]);
  if (emailsError) throw emailsError;
  if (phonesError) throw phonesError;

  return [
    ...((emails ?? []) as Array<{ contact_id: string; email: string }>).map((row) => ({
      contactId: row.contact_id,
      kind: "email" as const,
      value: row.email
    })),
    ...((phones ?? []) as Array<{ contact_id: string; phone: string }>).map((row) => ({
      contactId: row.contact_id,
      kind: "phone" as const,
      value: row.phone
    }))
  ];
}

function linksToMap(links: ExternalContactLink[]) {
  return Object.fromEntries(links.map((link) => [link.externalId, link.contactId]));
}

function valuesToMap(values: KnownExternalContactValue[]) {
  return values.reduce<Record<string, Array<{ kind: "email" | "phone"; value: string }>>>((acc, value) => {
    acc[value.contactId] = acc[value.contactId] ?? [];
    acc[value.contactId].push({ kind: value.kind, value: value.value });
    return acc;
  }, {});
}

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  return supabase;
}

async function currentUserId() {
  const db = requireSupabase();
  const { data, error } = await db.auth.getUser();
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");
  return userId;
}
