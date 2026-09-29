// src/api/system.ts
// 概览页的聚合读数。单独一个文件是因为它的形状不属于「知识库」也不属于「用户」——
// 这是一份跨表的统计快照，且带 scope 字段说明这份统计是全站还是仅本人可见范围。
import { apiClient } from "./client";

export interface IndexBreakdown {
  indexed: number;
  pending: number;
  failed: number;
  unknown: number;
}

export interface SystemKnowledge {
  databases: number;
  collections: number;
  documents: number;
  chunks: number;
  empty_collections: number;
  index: IndexBreakdown;
}

export interface ActivityPoint {
  date: string;
  documents: number;
}

export interface TopCollection {
  id: number;
  name: string;
  database_id: number;
  database_name: string;
  document_count: number;
  indexed_count: number;
  failed_count: number;
}

export interface CompositionDatabase {
  id: number;
  name: string;
  collection_count: number;
  document_count: number;
}

export interface CompositionTenant {
  kind: "tenant";
  id: number;
  name: string;
  member_count: number;
  databases: CompositionDatabase[];
}

export interface ServiceProbe {
  ok: boolean;
  /** 失败时一定有；detail 只有管理员拿得到 */
  reason?: string;
  detail?: string;
}

export interface ModelProbe {
  endpoint: string | null;
  reachable: boolean;
  reason?: string;
  detail?: string;
  expected: Record<"llm" | "embedding" | "rerank", string>;
  missing: Array<"llm" | "embedding" | "rerank">;
  loaded: Array<{ name: string | null; type: string | null; status: string | null }>;
}

export interface SystemOverview {
  /** all = 全站（管理员）；granted = 仅本人可检索的范围。同一个数字两种含义，必须标出来 */
  scope: "all" | "granted";
  knowledge: SystemKnowledge;
  activity: ActivityPoint[];
  /** 窗口内没有新文档时，界面上仍然有这句真话可说，而不是只剩一张空图 */
  last_ingested_at: string | null;
  top_collections: TopCollection[];
  composition: {
    tenants: CompositionTenant[];
    unbound_databases: CompositionDatabase[];
  };
  services: Record<string, ServiceProbe>;
  models: ModelProbe;
}

export const systemAPI = {
  overview: () => apiClient<SystemOverview>("/system/overview"),
};
