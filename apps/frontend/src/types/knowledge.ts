// src/types/knowledge.ts
// 知识库领域的响应类型。此前各页面一律用 `any`，字段名写错也不报错。
// 字段以后端 relation 模型为准（models.py 的 Database / Collection / Document / DocumentChunk）。

export type IndexStatus = "pending" | "indexed" | "failed";

export interface KbDatabase {
  id: number;
  name: string;
  description?: string | null;
  is_active?: boolean;
  tenant_id?: number | null;
  tenant_name?: string | null;
  collection_count?: number;
  document_count?: number;
  created_at?: string;
}

export interface KbCollection {
  id: number;
  name: string;
  description?: string | null;
  database_id?: number;
  database_name?: string | null;
  document_count?: number;
  created_at?: string;
}

export interface KbDocument {
  id: number;
  title: string;
  uploader?: string | null;
  collection_id?: number;
  created_at?: string;
  meta?: {
    index_status?: IndexStatus;
    chunk_count?: number;
    index_error?: string;
    sha256?: string;
    stored_path?: string;
    embedding_model?: string;
  } | null;
}

export interface KbChunk {
  id: number;
  doc_id?: number;
  content: string;
  created_at?: string;
  /** false = 停用：正文与向量都留着，但检索取不到它，因此不会进 prompt 与引用 */
  enabled?: boolean;
}

/** GET /relation/document/chunk/stats —— 每个文档现算的分块计数。
 *  刻意不读 document.meta.chunk_count：那是上传时写死的一次性数字，
 *  删过一块之后它不会自己变小。 */
export interface KbChunkStats {
  total: number;
  enabled: number;
}

export interface Tenant {
  id: number;
  name: string;
  database?: string | null;
  database_name?: string | null;
  member_count?: number;
}

/* ── GET /relation/tenant/overview ──────────────────────────────
   融合后的管理台一次取回四张表。原来的调用形状是「列租户 1 次 +
   每展开一个租户再要 1 次成员 + 每个人的授权又要 1 次」。          */

export interface TenantOverviewMember {
  user_id: number;
  name: string;
  role: string;
  joined_at: string | null;
  /** legacy = 这条归属只存在于旧的 user.tenant_id 上，TenantMember 里没有对应行 */
  source: "member" | "legacy";
}

export interface TenantOverviewRow {
  id: number;
  name: string;
  member_count: number;
  owner_count: number;
  database: { id: number; name: string; collection_count: number } | null;
  members: TenantOverviewMember[];
}

export interface TenantOverviewDatabase {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  collection_count: number;
  tenant_id: number | null;
}

export interface TenantOverviewGrant {
  user_id: number;
  database_id: number;
  database_name: string | null;
  can_read: boolean;
  can_write: boolean;
  can_manage: boolean;
}

/** 总览里的用户行带上了配额字段：折叠面板里就地编辑角色/配额，
    不需要再为每个人回查 /user/{id}，面板才真的能只发一次请求。 */
export interface TenantOverviewUser {
  id: number;
  name: string;
  role_id: number;
  is_active: boolean;
  email?: string | null;
  tenant_id?: number | null;
  last_login_at?: string | null;
  daily_token_limit?: number | null;
  daily_token_used?: number | null;
  monthly_token_limit?: number | null;
  monthly_token_used?: number | null;
  total_token_used?: number | null;
}

export interface TenantOverview {
  tenants: TenantOverviewRow[];
  databases: TenantOverviewDatabase[];
  grants: TenantOverviewGrant[];
  users: TenantOverviewUser[];
  unaffiliated_user_count: number;
}
