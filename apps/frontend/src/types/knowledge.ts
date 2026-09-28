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
}

export interface Tenant {
  id: number;
  name: string;
  database?: string | null;
  database_name?: string | null;
  member_count?: number;
}
