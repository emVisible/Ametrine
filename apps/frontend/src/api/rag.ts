// src/api/rag.ts
// 知识库资源的 HTTP 边界。返回类型集中在这里，页面层不再到处 `any`。
import useAuthStore from "../stores/useAuthStore";
import { t } from "../i18n";
import { apiClient } from "./client";
import { API_BASE } from "./base";
import type {
  KbChunk,
  KbChunkStats,
  KbCollection,
  KbDatabase,
  KbDocument,
} from "../types/knowledge";

export interface RecallHit {
  doc_id: string;
  document_title: string | null;
  chunk_id: number;
  relevance_score: number | null;
  text: string | null;
}

export interface RecallResult {
  mode: "rerank" | "vector";
  candidate_count: number;
  returned: number;
  results: RecallHit[];
}

export const databaseAPI = {
  getAll: () => apiClient<KbDatabase[]>("/relation/database/all"),
  getMine: () => apiClient<KbDatabase[]>("/relation/database/mine"),
  get: (name: string) =>
    apiClient<KbDatabase | null>(
      `/relation/database/get?name=${encodeURIComponent(name)}`,
    ),
  create: (data: {
    name: string;
    description?: string;
    tenant_id?: number | null;
  }) => apiClient<KbDatabase>("/relation/database/create", { method: "POST", body: data }),
  delete: (name: string) =>
    apiClient<{ message: string }>(
      `/relation/database/delete?name=${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),
};

export const collectionAPI = {
  getAll: () => apiClient<KbCollection[]>("/relation/collection/all"),
  getByDatabase: (database_id: number) =>
    apiClient<KbCollection[]>(
      `/relation/collection/all/specific?database_id=${database_id}`,
    ),
  get: (collection_name: string) =>
    apiClient<KbCollection | null>(
      `/relation/collection/get?collection_name=${encodeURIComponent(collection_name)}`,
    ),
  create: (data: {
    name: string;
    database_id: number;
    description?: string;
  }) => apiClient<KbCollection>("/relation/collection/create", { method: "POST", body: data }),
};

export const documentAPI = {
  /**
   * 检索预览（命中测试）：只跑检索与重排，不调用大模型。
   *
   * 「回答不对」其实是三种不同的病：没召回、召回了但排序靠后、
   * 召回也排第一但模型没用好。没有这个面板就只能改 .env 重启再猜。
   */
  recall: (body: {
    collection_name: string;
    database_name: string;
    query: string;
    top_k: number;
    rerank: boolean;
  }) =>
    apiClient<RecallResult>("/relation/document/recall", { method: "POST", body }),
  remove: (documentId: string) =>
    apiClient<{ message: string; removed_file: boolean }>(
      `/relation/document/${documentId}`,
      { method: "DELETE" },
    ),
  /**
   * 上传必须是裸 fetch：multipart 不能走 apiClient 的 JSON 序列化。
   * 后端需要同时拿到 database_name 与 collection_name —— 定位一个 Milvus
   * collection 靠的是这两个名字，而不是 id（见 docs/refactor/2026-09-28-backend-contract-and-console.md）。
   */
  upload: async (
    file: File,
    collectionName: string,
    databaseName: string,
  ): Promise<{
    document_id: string;
    filename: string;
    chunk_count: number;
    status: string;
  }> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("collection_name", collectionName);
    formData.append("database_name", databaseName);

    const token = useAuthStore.getState().token;
    const response = await fetch(`${API_BASE}/relation/document/upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    });

    if (response.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = "/login";
      throw new Error(t("errors.unauthorized"));
    }
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: `HTTP ${response.status}` }));
      throw new Error(error.detail || error.message || t("errors.uploadFailed"));
    }
    const result = await response.json();
    return result.data ?? result;
  },
  getAll: () => apiClient<KbDocument[]>("/relation/document/all"),
  getByCollection: (collection_id: number) =>
    apiClient<KbDocument[]>(
      `/relation/document/collection?collection_id=${collection_id}`,
    ),
  get: (document_id: string) =>
    apiClient<KbDocument | null>(
      `/relation/document/get?document_id=${encodeURIComponent(document_id)}`,
    ),
  getChunks: (doc_id: string) =>
    apiClient<KbChunk[]>(`/relation/document/chunk?doc_id=${doc_id}`),
  chunkStats: (collection_id: number) =>
    apiClient<Record<string, KbChunkStats>>(
      `/relation/document/chunk/stats?collection_id=${collection_id}`,
    ),

  /* ── 分块级控制 ───────────────────────────────────────────────
     切分不理想时，改一块 / 停用一块的代价远小于重传整份文档。
     停用是「不参与检索但内容留着」：正文与向量都不动，随时可以再打开；
     删除会连向量一起走，所以后端先删向量、后删关系行，失败可直接重试。 */
  setChunkEnabled: (doc_id: string, chunk_id: number, enabled: boolean) =>
    apiClient<{ chunk_id: number; enabled: boolean }>(
      `/relation/document/chunk/${doc_id}/${chunk_id}/enabled`,
      { method: "PATCH", body: { enabled } },
    ),
  setDocumentEnabled: (document_id: string, enabled: boolean) =>
    apiClient<{ document_id: string; enabled: boolean; changed: number }>(
      `/relation/document/${document_id}/enabled`,
      { method: "PATCH", body: { enabled } },
    ),
  updateChunk: (doc_id: string, chunk_id: number, content: string) =>
    apiClient<{ chunk_id: number; changed: boolean; enabled: boolean }>(
      `/relation/document/chunk/${doc_id}/${chunk_id}`,
      { method: "PUT", body: { content } },
    ),
  deleteChunk: (doc_id: string, chunk_id: number) =>
    apiClient<{ message: string; chunk_id: number }>(
      `/relation/document/chunk/${doc_id}/${chunk_id}`,
      { method: "DELETE" },
    ),
};
