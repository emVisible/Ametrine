import { API_BASE } from "./base";
import { apiClient } from "./client";
import useAuthStore from "../stores/useAuthStore";

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

export interface PersonalPeriodDetail extends PersonalPeriod {
  catalog: {
    date: string;
    session: string;
    actor: string;
    kind: string;
    id: string;
    first_line: string;
  }[];
  source_ids: string[];
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

export interface PersonalOntology {
  counts: { entities: number; relations: number; states: number; events: number };
  entities: { id: string; type: string; label: string; evidence: string[] }[];
  relations: unknown[];
  states: unknown[];
  built_from: Record<string, unknown>;
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

export interface PersonalAdminRow {
  tenant_id: number;
  tenant: string;
  user: { id: number; name: string; email: string | null; is_active: boolean } | null;
  ledger_rows: number;
  speech_rows: number;
  last_at: string | null;
  usage: {
    daily: number;
    monthly: number;
    total: number;
    daily_limit: number;
    monthly_limit: number;
    daily_unlimited: boolean;
    monthly_unlimited: boolean;
  } | null;
}

export interface PersonalSettings {
  actor: string;
  timezone: string;
}

export interface PersonalPassage {
  type: "passage";
  id: string;
  document_id: string;
  title: string;
  collection: string;
  database: string;
  text: string;
  excerpt: string;
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
  bootstrap: () =>
    apiClient<{ created: boolean; tenant_id: number; mode: string }>(
      "/personal/bootstrap",
      { method: "POST" },
    ),
  adminOverview: () => apiClient<PersonalAdminRow[]>("/personal/admin/overview"),
  updateQuota: (userId: number, daily: number, monthly: number) =>
    apiClient<{
      user_id: number;
      daily_token_limit: number;
      monthly_token_limit: number;
      daily_unlimited: boolean;
      monthly_unlimited: boolean;
    }>(`/personal/admin/quotas/${userId}`, {
      method: "PATCH",
      body: { daily_token_limit: daily, monthly_token_limit: monthly },
    }),
  settings: () => apiClient<PersonalSettings>("/personal/settings"),
  updateSettings: (body: PersonalSettings) =>
    apiClient<PersonalSettings>("/personal/settings", {
      method: "PATCH",
      body,
    }),
  exportLedger: async (): Promise<Blob> => {
    const token = useAuthStore.getState().token;
    const response = await fetch(`${API_BASE}/personal/ledger/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error(`导出失败：${response.status}`);
    return response.blob();
  },
  memory: () => apiClient<PersonalMemory>("/personal/memory"),
  ledger: (limit = 20) =>
    apiClient<PersonalLedgerRow[]>(`/personal/ledger?limit=${limit}`),
  ledgerOne: (eventId: string) =>
    apiClient<PersonalLedgerRow>(`/personal/ledger/${encodeURIComponent(eventId)}`),
  search: (q: string, limit = 20) =>
    apiClient<PersonalLedgerRow[]>(
      `/personal/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  scopeSearch: (q: string, limit = 20) =>
    apiClient<{ personal: PersonalLedgerRow[]; documents: PersonalPassage[] }>(
      `/personal/scope-search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  periods: (level = "week") =>
    apiClient<PersonalPeriod[]>(`/personal/periods?level=${level}`),
  period: (level: string, key: string) =>
    apiClient<PersonalPeriodDetail>(
      `/personal/periods/${level}/${encodeURIComponent(key)}`,
    ),
  decisions: () => apiClient<PersonalDecision[]>("/personal/decisions"),
  ontology: () => apiClient<PersonalOntology>("/personal/ontology"),
  aliases: () => apiClient<PersonalAliases>("/personal/aliases"),
  resolve: (text: string) =>
    apiClient<PersonalResolved>("/personal/resolve", {
      method: "POST",
      body: { text, actor: "哥哥" },
    }),
  retract: (eventId: string, reason: string) =>
    apiClient<{ ok: boolean; event_id: string; trace?: string }>(
      "/personal/retract",
      { method: "POST", body: { event_id: eventId, reason } },
    ),
  expire: (eventId: string, reason: string) =>
    apiClient<{ ok: boolean; event_id: string; trace?: string }>(
      "/personal/expire",
      { method: "POST", body: { event_id: eventId, reason } },
    ),
  keep: (eventId: string) =>
    apiClient<{ kept: boolean; event_id: string; trace?: string }>(
      "/personal/keep",
      { method: "POST", body: { event_id: eventId } },
    ),
};
