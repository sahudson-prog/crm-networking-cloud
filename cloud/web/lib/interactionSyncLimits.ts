export const ACTIVITY_SYNC_LIMIT_IDS = {
  calendarEventsPerReview: "google_calendar_events_per_review",
  calendarPagesPerReview: "google_calendar_pages_per_review",
  contactsPagesPerReview: "google_contacts_pages_per_review",
  mailMessagesPerReview: "gmail_messages_per_review",
  mailPagesPerReview: "gmail_pages_per_review"
} as const;

export const ACTIVITY_SYNC_MAX_CALENDAR_EVENTS = 2500;
export const ACTIVITY_SYNC_MAX_CALENDAR_PAGES = 2;
export const ACTIVITY_SYNC_MAX_CONTACT_PAGES = 20;
export const ACTIVITY_SYNC_MAX_MAIL_MESSAGES = 250;
export const ACTIVITY_SYNC_MAX_MAIL_PAGES = 3;
