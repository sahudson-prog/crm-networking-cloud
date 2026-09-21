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
import { knownValuesFromExternalContactSnapshots } from "./externalContactSnapshots.ts";
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

type ExternalContactSnapshotRow = {
  externalId: string;
  emails?: unknown;
  phones?: unknown;
  isDeleted?: boolean | null;
};

export type PrepareGoogleContactSyncInput = {
  accessToken: string;
  connectedAccountId?: string | null;
  cursorLabel?: string;
  forceFullSync?: boolean;
  maxPages?: number;
  onCheckpoint?: (checkpoint: GoogleContactSyncCheckpoint) => void;
};

export type PrepareGoogleContactSyncResult = SyncRunResult & {
  googleRead: {
    mode: GoogleContactsReadResult["mode"];
    pagesRead: number;
    totalItems: number | null;
  };
  cursorExpired: boolean;
};

export type GoogleContactSyncCheckpoint = {
  detail?: string;
  step: string;
};

type PrepareGoogleContactSyncDependencies = {
  readAppContacts: () => Promise<ContactRow[]>;
  readExternalContactLinks: (input: { connectedAccountId?: string | null; provider: string }) => Promise<ExternalContactLink[]>;
  readKnownExternalContactValues: (input: { links: ExternalContactLink[]; provider: string }) => Promise<KnownExternalContactValue[]>;
  readCursor: (input: { cursorLabel?: string; provider: string }) => Promise<string | null>;
  markCursorExpired: (input: { cursorLabel?: string; provider: string }) => Promise<void>;
  readProviderContacts: (input: {
    accessToken: string;
    connectedAccountId?: string | null;
    maxPages?: number;
    requestSyncToken?: boolean;
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
const SUPABASE_READ_PAGE_SIZE = 1000;

export async function prepareGoogleContactSyncPreview(
  input: PrepareGoogleContactSyncInput,
  dependencies: Partial<PrepareGoogleContactSyncDependencies> = {}
): Promise<PrepareGoogleContactSyncResult> {
  const deps = defaultDependencies(dependencies);
  const cursorLabel = input.cursorLabel ?? "";
  emitCheckpoint(input, {
    detail: input.forceFullSync ? "Revision completa solicitada." : "Revision incremental solicitada.",
    step: "Inicio"
  });
  const [appContacts, externalLinks, storedCursor] = await Promise.all([
    deps.readAppContacts(),
    deps.readExternalContactLinks({ connectedAccountId: input.connectedAccountId, provider: GOOGLE_PROVIDER }),
    input.forceFullSync ? Promise.resolve(null) : deps.readCursor({ cursorLabel, provider: GOOGLE_PROVIDER })
  ]);
  emitCheckpoint(input, {
    detail: `${appContacts.length} contactos app, ${externalLinks.length} vinculos Google, cursor ${storedCursor ? "presente" : "ausente"}.`,
    step: "Base app"
  });
  const knownValues = await deps.readKnownExternalContactValues({ links: externalLinks, provider: GOOGLE_PROVIDER });
  emitCheckpoint(input, {
    detail: `${knownValues.length} valores conocidos desde snapshots Google.`,
    step: "Snapshots"
  });

  let cursorExpired = false;
  let googleRead: GoogleContactsReadResult;
  let cursorBefore = storedCursor;

  try {
    emitCheckpoint(input, {
      detail: storedCursor ? "Leyendo cambios desde cursor incremental." : "Leyendo contactos completos desde Google.",
      step: "Google Contacts"
    });
    googleRead = await deps.readProviderContacts({
      accessToken: input.accessToken,
      connectedAccountId: input.connectedAccountId,
      maxPages: input.maxPages,
      syncToken: storedCursor
    });
  } catch (error) {
    if (!storedCursor && isGoogleInvalidArgument(error)) {
      emitCheckpoint(input, {
        detail: "Google rechazo la lectura completa con solicitud de cursor. Reintentando sin pedir cursor incremental.",
        step: "Google Contacts"
      });
      googleRead = await deps.readProviderContacts({
        accessToken: input.accessToken,
        connectedAccountId: input.connectedAccountId,
        maxPages: input.maxPages,
        requestSyncToken: false,
        syncToken: null
      });
    } else {
      if (!(error instanceof GoogleContactsClientError) || error.code !== "GOOGLE_CONTACTS_EXPIRED_SYNC_TOKEN") {
        emitCheckpoint(input, {
          detail: error instanceof Error ? error.message : "Error desconocido leyendo Google Contacts.",
          step: "Error Google Contacts"
        });
        throw error;
      }

      cursorExpired = true;
      cursorBefore = null;
      emitCheckpoint(input, {
        detail: `${error.message} Reintentando lectura completa.`,
        step: "Cursor Google"
      });
      await deps.markCursorExpired({ cursorLabel, provider: GOOGLE_PROVIDER });
      emitCheckpoint(input, {
        detail: "Cursor marcado como vencido/incompatible en la app.",
        step: "Cursor Google"
      });
      googleRead = await deps.readProviderContacts({
        accessToken: input.accessToken,
        connectedAccountId: input.connectedAccountId,
        maxPages: input.maxPages,
        syncToken: null
      });
    }
  }
  emitCheckpoint(input, {
    detail: `${googleRead.contacts.length} contactos leidos, ${googleRead.pagesRead} pagina(s), modo ${googleRead.mode}, total Google ${googleRead.totalItems ?? "sin total"}.`,
    step: "Lectura Google lista"
  });

  const preview = await deps.buildPreview({
    appContacts,
    cursorAfter: googleRead.nextSyncToken,
    cursorBefore,
    externalContacts: googleRead.contacts,
    externalIdToContactId: linksToMap(externalLinks),
    knownExternalValuesByContactId: valuesToMap(knownValues),
    mode: googleRead.mode === "incremental" ? "incremental" : "historical"
  });
  emitCheckpoint(input, {
    detail: checkpointPreviewSummary(preview.preview ?? []),
    step: "Preview listo"
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

function isGoogleInvalidArgument(error: unknown) {
  return error instanceof GoogleContactsClientError
    && error.status === 400
    && error.message.toLowerCase().includes("invalid argument");
}

function emitCheckpoint(input: PrepareGoogleContactSyncInput, checkpoint: GoogleContactSyncCheckpoint) {
  input.onCheckpoint?.(checkpoint);
}

function checkpointPreviewSummary(changes: Array<{ type: string }>) {
  const counts = changes.reduce<Record<string, number>>((acc, change) => {
    acc[change.type] = (acc[change.type] ?? 0) + 1;
    return acc;
  }, {});
  return [
    `${changes.length} filas`,
    `${counts.new ?? 0} nuevos`,
    `${counts.modified ?? 0} modificaciones`,
    `${(counts.deleted ?? 0) + (counts.deactivated ?? 0)} eliminaciones`,
    `${counts.unchanged ?? 0} sin cambios`
  ].join(", ");
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
  const data: Array<{ external_id: string; contact_id: string }> = [];
  let offset = 0;

  while (true) {
    let query = db
      .from("external_contact_ids")
      .select("external_id,contact_id")
      .eq("user_id", userId)
      .eq("provider", input.provider)
      .eq("is_active", true)
      .order("external_id", { ascending: true });

    if (input.connectedAccountId) query = query.eq("connected_account_id", input.connectedAccountId);

    const { data: page, error } = await query.range(offset, offset + SUPABASE_READ_PAGE_SIZE - 1);
    if (error) throw error;
    data.push(...((page ?? []) as Array<{ external_id: string; contact_id: string }>));
    if ((page ?? []).length < SUPABASE_READ_PAGE_SIZE) break;
    offset += SUPABASE_READ_PAGE_SIZE;
  }

  return data.map((row: { external_id: string; contact_id: string }) => ({
    contactId: row.contact_id,
    externalId: row.external_id
  }));
}

async function readKnownExternalContactValues(input: { links: ExternalContactLink[]; provider: string }): Promise<KnownExternalContactValue[]> {
  const db = requireSupabase();
  const userId = await currentUserId();
  const data: Array<{
    external_id: string;
    emails?: unknown;
    phones?: unknown;
    is_deleted?: boolean | null;
  }> = [];
  let offset = 0;

  while (true) {
    const { data: page, error } = await db
      .from("external_contact_snapshots")
      .select("external_id,emails,phones,is_deleted")
      .eq("user_id", userId)
      .eq("provider", input.provider)
      .order("external_id", { ascending: true })
      .range(offset, offset + SUPABASE_READ_PAGE_SIZE - 1);
    if (error) throw error;
    data.push(...((page ?? []) as Array<{
      external_id: string;
      emails?: unknown;
      phones?: unknown;
      is_deleted?: boolean | null;
    }>));
    if ((page ?? []).length < SUPABASE_READ_PAGE_SIZE) break;
    offset += SUPABASE_READ_PAGE_SIZE;
  }

  return knownValuesFromExternalContactSnapshots({
    links: input.links,
    snapshots: (data as Array<{
      external_id: string;
      emails?: unknown;
      phones?: unknown;
      is_deleted?: boolean | null;
    }>).map((row): ExternalContactSnapshotRow => ({
      emails: row.emails,
      externalId: row.external_id,
      isDeleted: row.is_deleted,
      phones: row.phones
    }))
  });
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
