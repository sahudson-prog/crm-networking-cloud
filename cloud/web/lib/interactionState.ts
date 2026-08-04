import type { InteractionRow } from "./readModel";

type InteractionMetadata = NonNullable<InteractionRow["metadata"]>;

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
