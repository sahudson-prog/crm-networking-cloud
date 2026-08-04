export type ContactEmailRow = {
  email: string;
  domain: string | null;
};

export type ContactPhoneRow = {
  phone: string;
};

export type ContactRow = {
  id: string;
  display_name: string;
  company: string;
  role: string;
  networking_status: string;
  networking_focus: boolean;
  is_headhunter: boolean;
  headhunter_domains?: string[];
  is_active: boolean;
  updated_at: string;
  contact_emails?: ContactEmailRow[];
  contact_phones?: ContactPhoneRow[];
};

export type ContactReferralRow = {
  id: string;
  referredByContactId: string;
  referredName: string;
  referredCompany: string;
  referredRole: string;
  referredEmail: string;
  referredPhone: string;
  notes: string;
  status: string;
  linkedContactId: string | null;
  linkedContactName: string;
  linkedContactStatus: string;
};

export type InteractionRow = {
  id: string;
  legacy_entry_id?: string | null;
  interaction_type: "email" | "calendar" | "call" | "message" | "manual";
  direction: "inbound" | "outbound" | "internal" | "unknown" | null;
  occurred_at: string | null;
  subject: string | null;
  user_notes_raw?: string | null;
  updated_at?: string | null;
  metadata?: {
    deleted?: boolean;
    dismissed?: boolean;
    deleted_at?: string;
    deleted_by?: string;
    delete_reason?: string;
    prevent_reimport?: boolean;
    legacy_contact_label?: string;
    legacy_google_id?: string;
    [key: string]: unknown;
  } | null;
};

export type TodoRow = {
  id: string;
  todo_type: string;
  engine_type: "RULE" | "HYBRID" | "AI";
  status: string;
  summary: string;
  reason: string;
  created_at: string;
  object_type?: string | null;
  object_id?: string | null;
  current_state?: string | null;
  suggested_state?: string | null;
  evidence?: string | null;
  actions_json?: unknown;
  dedup_key?: string | null;
  source_fingerprint?: string | null;
};

export type StatusCount = {
  status: string;
  count: number;
};

export type MirrorSummary = {
  contacts: number;
  activeContacts: number;
  focusContacts: number;
  headhunters: number;
  interactions: number;
  todos: number;
  importBatches: number;
};

export type InteractionParticipantRow = {
  interaction_id: string;
  contact_id: string | null;
  email_identity: string | null;
  role?: string | null;
  contact_name?: string | null;
};

export type ExternalInteractionSourceRow = {
  interaction_id: string;
  provider: string;
  source_service: string;
  external_object_type: string;
  external_id: string;
  external_thread_id?: string | null;
  external_url?: string | null;
  sync_status?: string | null;
  prevent_reimport?: boolean | null;
};

export type KpiTrendPoint = {
  label: string;
  total: number;
  firstTime?: number;
};

export type KpiPeriodMode = "weekly" | "monthly";

export type KpiTrend = {
  title: string;
  description: string;
  accumulated: number;
  periodMode: KpiPeriodMode;
  previousChange: {
    label: string;
    value: number;
    percent: number | null;
  };
  points: KpiTrendPoint[];
};

export type HeadhunterCompanyRow = {
  domain: string;
  contactCount: number;
  contactIds: string[];
  interactionIds: string[];
  status: string;
  lastInteractionAt: string | null;
  daysSince: number | null;
  type: string;
  subject: string;
};

export type ReferralActionRow = {
  id: string;
  referrerName: string;
  referredName: string;
  status: string;
  notes: string;
};

export type ContactProfileData = {
  contact: ContactRow;
  interactions: InteractionRow[];
  interactionParticipants: InteractionParticipantRow[];
  externalInteractionSources: ExternalInteractionSourceRow[];
  referrals: ContactReferralRow[];
  todos: TodoRow[];
};
