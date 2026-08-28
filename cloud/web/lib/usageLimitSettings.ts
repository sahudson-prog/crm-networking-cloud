import { readUserSetting } from "./cloudData";
import {
  ACTIVITY_SYNC_LIMIT_IDS,
  ACTIVITY_SYNC_MAX_CALENDAR_EVENTS,
  ACTIVITY_SYNC_MAX_CALENDAR_PAGES,
  ACTIVITY_SYNC_MAX_CONTACT_PAGES,
  ACTIVITY_SYNC_MAX_MAIL_MESSAGES,
  ACTIVITY_SYNC_MAX_MAIL_PAGES
} from "./interactionSyncLimits";
import { USAGE_LIMIT_DEFINITIONS } from "./usageLimitCatalog";

export const LIMIT_OVERRIDES_SETTING = "admin_usage_limit_overrides_v0_1";

export type LimitOverride = {
  appMax?: number;
  providerMax?: number;
};

export type LimitOverrides = Record<string, LimitOverride>;

export type ActivitySyncLimitValues = {
  calendarEvents: number;
  calendarPages: number;
  contactPages: number;
  mailMessages: number;
  mailPages: number;
};

export async function loadUsageLimitOverrides(): Promise<LimitOverrides> {
  const value = await readUserSetting(LIMIT_OVERRIDES_SETTING);
  if (!value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, item]) => {
        if (!isRecord(item)) return [];
        return [[
          key,
          {
            appMax: numberValue(item.appMax),
            providerMax: numberValue(item.providerMax)
          }
        ]];
      })
    );
  } catch {
    return {};
  }
}

export function cleanUsageLimitOverrides(overrides: LimitOverrides) {
  return Object.fromEntries(
    USAGE_LIMIT_DEFINITIONS.map((definition) => {
      const override = overrides[definition.id] ?? {};
      return [
        definition.id,
        {
          appMax: override.appMax ?? definition.appDefault,
          providerMax: override.providerMax ?? definition.providerDefault
        }
      ];
    })
  );
}

export function usageLimitAppValue(id: string, overrides: LimitOverrides) {
  const definition = USAGE_LIMIT_DEFINITIONS.find((item) => item.id === id);
  const fallback = definition?.appDefault ?? 0;
  return Math.max(0, Math.floor(overrides[id]?.appMax ?? fallback));
}

export async function loadActivitySyncLimitValues(): Promise<ActivitySyncLimitValues> {
  const overrides = await loadUsageLimitOverrides();
  return {
    calendarEvents: usageLimitAppValue(ACTIVITY_SYNC_LIMIT_IDS.calendarEventsPerReview, overrides) || ACTIVITY_SYNC_MAX_CALENDAR_EVENTS,
    calendarPages: usageLimitAppValue(ACTIVITY_SYNC_LIMIT_IDS.calendarPagesPerReview, overrides) || ACTIVITY_SYNC_MAX_CALENDAR_PAGES,
    contactPages: usageLimitAppValue(ACTIVITY_SYNC_LIMIT_IDS.contactsPagesPerReview, overrides) || ACTIVITY_SYNC_MAX_CONTACT_PAGES,
    mailMessages: usageLimitAppValue(ACTIVITY_SYNC_LIMIT_IDS.mailMessagesPerReview, overrides) || ACTIVITY_SYNC_MAX_MAIL_MESSAGES,
    mailPages: usageLimitAppValue(ACTIVITY_SYNC_LIMIT_IDS.mailPagesPerReview, overrides) || ACTIVITY_SYNC_MAX_MAIL_PAGES
  };
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
