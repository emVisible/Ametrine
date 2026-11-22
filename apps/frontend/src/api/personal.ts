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
};
