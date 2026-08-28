import { reviewNetworkingStatusSuggestions, type CoachRuleReviewResult } from "./coachRuleEngine.ts";

export async function triggerCoachRuleReviewForContacts(
  contactIds: Array<string | null | undefined>,
  source = "data_change"
): Promise<CoachRuleReviewResult | null> {
  const scopedContactIds = Array.from(new Set(contactIds.map((contactId) => contactId?.trim()).filter(isString)));
  if (!scopedContactIds.length) return null;

  try {
    return await reviewNetworkingStatusSuggestions({ contactIds: scopedContactIds, source });
  } catch (error) {
    console.warn("No pude revisar reglas del Coach despues del cambio.", error);
    return null;
  }
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
