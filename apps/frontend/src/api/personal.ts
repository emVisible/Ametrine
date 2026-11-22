import { apiClient } from "./client";

export interface PersonalMemoryItem {
  event_id: string;
  phase: "barred" | "labile" | "stable" | "dormant" | "retired";
  strength: number;
  holds: boolean;
  reasons: string[];
  age: number | null;
  actor: string;
  date: string;
  excerpt: string;
}

export interface PersonalMemory {
  today: string;
  counts: Record<string, number>;
  holding: number;
  meter: { unit: string; count: number };
  items: PersonalMemoryItem[];
}

export interface PersonalAlias {
  alias: string;
  actor: string;
  kind: string;
  evidence_event: string;
  quote: string;
}

export interface PersonalGroup {
  name: string;
  members: string[];
  evidence_event: string;
  quote: string;
}

export interface PersonalAliases {
  aliases: PersonalAlias[];
  groups: PersonalGroup[];
  actors: string[];
}

export interface PersonalResolved {
  status: "resolved" | "unresolved" | "scanned";
  text?: string;
  phrases: {
    phrase: string;
    status: string;
    kind?: string;
    labels?: string[];
    reason?: string;
    span?: { start: number; end: number };
  }[];
  resolved: number;
  refused: number;
}

export interface PersonalDecision {
  event_id: string;
  seq: number;
  actor: string;
  at: string;
  marker: string;
  excerpt: string;
  status: "active" | "expired";
}

export interface PersonalPeriod {
  level: string;
  period_key: string;
  start_date: string;
  end_date: string;
  item_count: number;
  content_digest: string;
  parent_keys: string[];
}

export interface PersonalLedgerRow {
  seq: number;
  id: string;
  occurred_at: string;
  actor: string;
  source: string;
  kind: string;
  text: string;
  provenance: Record<string, unknown>;
}

export const personalAPI = {
  memory: () => apiClient<PersonalMemory>("/personal/memory"),
  ledger: (limit = 20) =>
    apiClient<PersonalLedgerRow[]>(`/personal/ledger?limit=${limit}`),
  search: (q: string, limit = 20) =>
    apiClient<PersonalLedgerRow[]>(
      `/personal/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  periods: (level = "week") =>
    apiClient<PersonalPeriod[]>(`/personal/periods?level=${level}`),
  decisions: () => apiClient<PersonalDecision[]>("/personal/decisions"),
  aliases: () => apiClient<PersonalAliases>("/personal/aliases"),
  resolve: (text: string) =>
    apiClient<PersonalResolved>("/personal/resolve", {
      method: "POST",
      body: { text, actor: "哥哥" },
    }),
  keep: (eventId: string) =>
    apiClient<{ kept: boolean; event_id: string; trace?: string }>(
      "/personal/keep",
      { method: "POST", body: { event_id: eventId } },
    ),
};
