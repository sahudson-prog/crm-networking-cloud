import type { ExternalInteractionSourceRow, InteractionRow } from "./readModel";

type InteractionMetadata = NonNullable<InteractionRow["metadata"]>;

export function isCalendarDeletedAtSource(sources: (ExternalInteractionSourceRow & { is_active?: boolean })[]) {
  return sources.some(source => source.is_active !== false && source.provider === "google"
    && source.source_service === "calendar" && source.sync_status === "deleted_at_source");
}

// PostgREST anti-join: exclude tombstones before pagination/counting, not after a page.
// Sync/identity readers deliberately do not use this normal-list filter.
export const CALENDAR_VISIBILITY_JOIN = "cancelled_calendar:external_interaction_sources!left()";
type VisibilityFilter = { eq(column: string, value: string | boolean): VisibilityFilter; is(column: string, value: null): VisibilityFilter };
export function withoutCancelledCalendar<T>(query: T): T {
  return (query as T & VisibilityFilter).eq("cancelled_calendar.provider", "google")
    .eq("cancelled_calendar.source_service", "calendar")
    .eq("cancelled_calendar.is_active", true)
    .eq("cancelled_calendar.sync_status", "deleted_at_source")
    .is("cancelled_calendar", null) as T;
}

export function isInteractionDismissed(interaction: Pick<InteractionRow, "metadata">) {
  return Boolean(interaction.metadata?.deleted || interaction.metadata?.dismissed);
}

export function activeInteractions<T extends Pick<InteractionRow, "metadata">>(interactions: T[]) {
  return interactions.filter((interaction) => !isInteractionDismissed(interaction));
}

export function withDismissedInteractionMetadata(metadata: InteractionMetadata | null | undefined, input: {
  deletedAt: string;
  deletedBy: string;
  deleteReason: string;
  preventReimport?: boolean;
}) {
  return {
    ...(metadata ?? {}),
    deleted: true,
    dismissed: true,
    deleted_at: input.deletedAt,
    deleted_by: input.deletedBy,
    delete_reason: input.deleteReason,
    prevent_reimport: Boolean(input.preventReimport)
  };
}
